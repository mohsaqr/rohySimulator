// Boot-time voice audit (Voice 2.0 v1.4 — sovereign case voices).
//
// Two jobs, both non-fatal (any throw is caught by the caller; the server
// keeps running and only the warning is lost):
//
//   1. Audit the per-language DEFAULT voices. Under v1.4 these serve ONLY
//      speakers with NO voice configured (a configured voice is literal —
//      never substituted), so a missing/unplayable default means "unset
//      personas in this language have nothing to play". Named loudly at
//      every boot because the gap only hurts mid-class, when it's too late.
//
//   2. Audit stored persona/case `case_voice` values against their OWN
//      derived engine's usability. There is no "active provider" anymore —
//      a voice is healthy iff the engine it belongs to (derived by exact
//      catalogue membership) is usable on this box. Every stale row is
//      enumerated with its blunt consequence: playback fails loudly until
//      it is re-picked or its engine is restored.

import {
    deriveVoiceProvider,
    getProviderStatus,
    defaultVoiceKey,
} from '../services/ttsProviders.js';
import {
    guessVoiceProvider,
    voiceMatchesLanguage,
} from '../shared/voiceIdentity.js';
import { LANGUAGES } from '../shared/languages.js';

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
            SELECT 'persona' AS kind, id, name, config FROM agent_templates
            WHERE config LIKE '%case_voice%'
            UNION ALL
            SELECT 'case' AS kind, id, name, config FROM cases
            WHERE config LIKE '%case_voice%'
        `, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

/**
 * Audit the per-language default voices. Returns one entry per registry
 * language: { language, voice, status: 'ok'|'unset'|'unplayable', detail }.
 * Also builds the "is there a playable default for lang X?" map the
 * case-voice audit uses for its will-play messages.
 */
async function auditDefaultVoices(dbAdapter, log, statusCache) {
    // Read provider policy/keys through the SAME db handle the audit was
    // given (tests pass a fake adapter; production passes the singleton).
    const settingsReader = (key) => getSetting(dbAdapter, key);
    const providerStatus = (provider) => getProviderStatus(provider, { getSetting: settingsReader });

    const defaults = [];
    for (const lang of Object.keys(LANGUAGES)) {
        const voice = await getSetting(dbAdapter, defaultVoiceKey(lang));
        if (!voice) {
            defaults.push({ language: lang, voice: null, status: 'unset', detail: null });
            log.warn('no default voice for language', {
                language: lang,
                key: defaultVoiceKey(lang),
                hint: `${LANGUAGES[lang].name} speakers with NO voice configured have nothing to play — set a default in Settings → Voice (a local Piper voice is outage-proof), or configure voices on every persona/case. Configured voices are unaffected: they are literal and never substituted.`
            });
            continue;
        }
        const { provider } = await deriveVoiceProvider(voice);
        let detail = null;
        if (!provider) {
            detail = `default voice "${voice}" is in no provider's catalogue`;
        } else {
            const status = statusCache[provider] ?? (statusCache[provider] = await providerStatus(provider));
            if (!status.usable) {
                detail = `default voice "${voice}" needs ${provider}, which is not usable (${status.reason})`;
            } else if (voiceMatchesLanguage(voice, provider, lang) === false) {
                detail = `default voice "${voice}" (${provider}) does not speak "${lang}"`;
            }
        }
        if (detail) {
            defaults.push({ language: lang, voice, status: 'unplayable', detail });
            log.warn('default voice unplayable', { language: lang, voice, detail });
        } else {
            defaults.push({ language: lang, voice, status: 'ok', detail: null });
        }
    }
    return defaults;
}

/**
 * Run the audit. Logs the per-language default gaps, then either
 * `voice catalogue audit clean` or `stale case_voice values detected`
 * with every offending row enumerated and its runtime consequence named.
 *
 * @param {{ get: Function, all: Function }} dbAdapter
 * @param {{ info: Function, warn: Function }} log
 * @returns {Promise<{ checked: number, stale: Array, defaults: Array }>}
 */
export async function auditPersonaAndCaseVoices(dbAdapter, log) {
    const settingsReader = (key) => getSetting(dbAdapter, key);
    const statusCache = {}; // provider → status, probed at most once per audit
    const defaults = await auditDefaultVoices(dbAdapter, log, statusCache);

    const rows = await fetchVoiceRows(dbAdapter);
    const stale = [];
    for (const row of rows) {
        const cv = extractCaseVoice(row);
        if (!cv) continue;

        let derived = null;
        try { derived = (await deriveVoiceProvider(cv)).provider; } catch { derived = null; }
        let problem = null;
        if (!derived) {
            problem = 'voice is in no provider\'s catalogue';
        } else {
            const status = statusCache[derived]
                ?? (statusCache[derived] = await getProviderStatus(derived, { getSetting: settingsReader }));
            if (!status.usable) problem = `its engine "${derived}" is not usable (${status.reason})`;
        }
        if (!problem) continue;

        // What will actually happen at play time (truth clause in the log):
        // a CONFIGURED voice is literal (VOICE2_PLAN.md v1.4 — the case
        // sound reigns supreme), so a stale row fails loudly, always. The
        // per-language defaults only serve rows with NO voice configured.
        const guess = derived || guessVoiceProvider(cv);
        stale.push({
            kind: row.kind,
            id: row.id,
            name: row.name,
            case_voice: cv,
            provider: guess,
            problem,
            consequence: 'playback fails loudly until re-picked or its engine is restored (configured voices are never substituted)'
        });
    }

    if (stale.length === 0) {
        log.info('voice catalogue audit clean', { checked: rows.length });
    } else {
        log.warn('stale case_voice values detected', {
            stale_count: stale.length,
            entries: stale,
            hint: 'Each row stores a voice whose engine cannot play it on this server. Re-pick in Settings → Agent Personas (kind=persona) or the case editor (kind=case); the "consequence" field says what plays meanwhile.'
        });
    }
    return { checked: rows.length, stale, defaults };
}
