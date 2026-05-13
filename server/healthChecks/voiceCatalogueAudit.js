// Boot-time audit: detect persona / case `case_voice` values that aren't
// valid for the platform's active TTS provider. The runtime returns
// 400 invalid_voice when this happens, but learners hit the error before
// admins notice — moving the detection to boot turns "voice broken on
// production for three weeks" into "single warn line on every restart
// that names every stale row."
//
// The audit is non-fatal. If anything in here throws (catalogue load
// failure, JSON in DB malformed, dbAdapter not yet ready) the server
// keeps running; the warning we'd have logged is the only thing lost.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Match server/routes/proxy-routes.js — the same dir piper voices land in
// after install-piper.sh runs. Keep this in lockstep; if the install path
// ever moves, both files have to follow.
const PIPER_DIR = path.join(__dirname, '..', 'data', 'piper');

async function buildValidator(provider) {
    switch (provider) {
        case 'kokoro': {
            const { isKokoroVoice } = await import('../services/kokoroTts.js');
            return (v) => isKokoroVoice(v);
        }
        case 'openai': {
            const { isOpenaiVoice } = await import('../services/openaiTts.js');
            return async (v) => isOpenaiVoice(v);
        }
        case 'google': {
            const { isGoogleVoice } = await import('../services/googleTts.js');
            return async (v) => isGoogleVoice(v);
        }
        case 'piper':
            return async (v) =>
                typeof v === 'string'
                && v.endsWith('.onnx')
                && fs.existsSync(path.join(PIPER_DIR, v));
        default:
            return null;
    }
}

function safeParseConfig(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

function extractCaseVoice(row) {
    const cfg = safeParseConfig(row.config);
    const cv = cfg?.voice?.case_voice;
    return typeof cv === 'string' && cv !== '' ? cv : null;
}

function getSetting(dbAdapter, key) {
    return new Promise((resolve, reject) => {
        dbAdapter.get(
            'SELECT setting_value FROM platform_settings WHERE setting_key = ?',
            [key],
            (err, row) => err ? reject(err) : resolve(row?.setting_value || null)
        );
    });
}

function fetchVoiceRows(dbAdapter) {
    // UNION ALL: cheaper than two round-trips and the result is small
    // (rows scale with #personas + #cases, both O(10)–O(100)).
    return new Promise((resolve, reject) => {
        dbAdapter.all(`
            SELECT 'persona' AS kind, id, name, is_default, agent_type, config FROM agent_templates
            WHERE config LIKE '%case_voice%'
            UNION ALL
            SELECT 'case' AS kind, id, name, NULL AS is_default, NULL AS agent_type, config FROM cases
            WHERE config LIKE '%case_voice%'
        `, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

// Detect the "this template forces every inheriting case to one voice"
// footgun: a patient persona row that's flagged is_default=1 AND has a
// case_voice set. Inheriting cases see the override-tier voice instead of
// the platform's gendered slot — the same Orus bug that bit production
// three weeks running. Always a configuration mistake to flag.
function fetchPatientDefaultsWithOverride(dbAdapter) {
    return new Promise((resolve, reject) => {
        dbAdapter.all(`
            SELECT id, name, config FROM agent_templates
            WHERE agent_type = 'patient'
              AND is_default = 1
              AND config LIKE '%case_voice%'
        `, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

// Read every platform voice-slot setting for the active provider. Each
// missing or invalid slot disables tier 2 of resolveVoice for that
// demographic — i.e. a female patient with no per-case override goes silent.
async function auditPlatformSlots(dbAdapter, provider, validator, log) {
    const slots = ['male', 'female', 'child'];
    const findings = [];
    for (const slot of slots) {
        const key = `voice_${provider}_${slot}`;
        const value = await getSetting(dbAdapter, key);
        if (!value || value.trim() === '') {
            findings.push({ slot, key, status: 'unset', value: null });
            continue;
        }
        let ok;
        try { ok = await validator(value.trim()); }
        catch { ok = false; }
        if (!ok) findings.push({ slot, key, status: 'invalid', value });
    }
    if (findings.length > 0) {
        log.warn('platform voice slot misconfigured', {
            provider,
            findings,
            hint: `These slots are the tier-2 fallback for patients without a per-case voice override. An unset/invalid slot means patients of that demographic go silent — set them in Settings → Voice for the "${provider}" provider.`
        });
    }
    return findings;
}

/**
 * Run the audit. Logs one of three outcomes:
 *   - `tts_provider unset; skipping voice catalogue audit` (no provider set)
 *   - `voice catalogue audit clean` (nothing stored or everything valid)
 *   - `stale case_voice values detected` with the offending rows enumerated
 *
 * The detected stale rows are also returned to the caller — useful for tests
 * and for potential follow-on remediation hooks (auto-clear behind a flag,
 * Prometheus gauge, etc.).
 *
 * @param {{ get: Function, all: Function }} dbAdapter
 * @param {{ info: Function, warn: Function }} log
 * @returns {Promise<{ provider: string|null, checked: number, stale: Array }>}
 */
export async function auditPersonaAndCaseVoices(dbAdapter, log) {
    const provider = await getSetting(dbAdapter, 'tts_provider');
    if (!provider) {
        log.info('tts_provider unset; skipping voice catalogue audit');
        return { provider: null, checked: 0, stale: [] };
    }

    const validator = await buildValidator(provider);
    if (!validator) {
        log.warn('cannot audit case_voice values; unknown provider', { provider });
        return { provider, checked: 0, stale: [] };
    }

    const rows = await fetchVoiceRows(dbAdapter);

    const stale = [];
    for (const row of rows) {
        const cv = extractCaseVoice(row);
        if (!cv) continue;
        let ok;
        try { ok = await validator(cv); }
        catch { ok = false; }
        if (!ok) {
            stale.push({ kind: row.kind, id: row.id, name: row.name, case_voice: cv });
        }
    }

    if (stale.length === 0) {
        log.info('voice catalogue audit clean', { provider, checked: rows.length });
    } else {
        log.warn('stale case_voice values detected', {
            provider,
            stale_count: stale.length,
            entries: stale,
            hint: `These rows store a voice id that the active "${provider}" provider doesn't have. /api/tts returns 400 invalid_voice until each one is re-picked in Settings → Agent Personas (for kind=persona) or the case editor (for kind=case).`
        });
    }

    // Footgun #1: patient defaults with case_voice set.
    const patientDefaultOverrides = await fetchPatientDefaultsWithOverride(dbAdapter);
    if (patientDefaultOverrides.length > 0) {
        log.warn('patient persona is_default carries case_voice override', {
            count: patientDefaultOverrides.length,
            entries: patientDefaultOverrides.map((r) => ({
                id: r.id, name: r.name, case_voice: extractCaseVoice(r),
            })),
            hint: 'A patient template flagged is_default=1 with a case_voice set forces EVERY case without its own override to that voice (and ignores the platform voice_<provider>_<gender> slots). Clear case_voice on the persona unless you genuinely want one voice for all inheriting cases.',
        });
    }

    // Footgun #2: platform voice slots unset / invalid → tier 2 misses.
    const slotFindings = await auditPlatformSlots(dbAdapter, provider, validator, log);

    return {
        provider,
        checked: rows.length,
        stale,
        patientDefaultOverrides: patientDefaultOverrides.map((r) => ({
            id: r.id, name: r.name, case_voice: extractCaseVoice(r),
        })),
        slotFindings,
    };
}
