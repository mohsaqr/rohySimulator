// Voice 2.0 (VOICE2_PLAN.md §5) — the ONE authoritative module for
// per-provider voice catalogues, engine derivation, provider usability,
// and language-matched fallback resolution. Every consumer (/api/tts
// routing, /tts/voices listing, the settings PUT validation, the boot
// audit) calls THIS module; the saga's "multiple disagreeing validators"
// failure mode is structurally prevented by there being one validator.
//
// Core rule: THE VOICE OWNS ITS ENGINE. No provider is stored anywhere —
// the engine is derived from the voice id by exact catalogue membership.
// The catalogues are pairwise disjoint (enforced by
// tests/server/voiceIdentity.disjointness.test.js), so derivation is
// deterministic. Shape regexes (server/shared/voiceIdentity.js) are hints
// for error messages only; they never route.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import {
    TTS_PROVIDERS,
    KOKORO_PREFIX_LANGUAGE
} from '../shared/voiceIdentity.js';
import { LANGUAGES } from '../shared/languages.js';

const providersLog = logger('tts-providers');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Piper voices land here after install-piper.sh runs. PIPER_BIN override
// keeps old standalone-binary and Homebrew installs working.
export const PIPER_DIR = path.join(__dirname, '..', 'data', 'piper');
export const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, 'venv', 'bin', 'piper');

// Settings keys owned by this feature. One default voice per registry
// LANGUAGE (the fallback must speak the case's language or not speak at
// all — VOICE2_PLAN.md §5.5) and one enable toggle per provider (§5.2).
export const DEFAULT_VOICE_KEY_PREFIX = 'tts_default_voice_';
export const PROVIDER_ENABLED_KEY_PREFIX = 'tts_provider_enabled_';

export function defaultVoiceKey(lang) {
    return DEFAULT_VOICE_KEY_PREFIX + lang;
}

export function providerEnabledKey(provider) {
    return PROVIDER_ENABLED_KEY_PREFIX + provider;
}

export function defaultVoiceKeys() {
    return Object.keys(LANGUAGES).map(defaultVoiceKey);
}

export function providerEnabledKeys() {
    return TTS_PROVIDERS.map(providerEnabledKey);
}

// Default settings reader — the live platform_settings table. Functions
// that consult settings accept an optional `getSetting` override so the
// boot audit (and its unit tests) can read through THEIR db handle instead
// of the singleton; there is still exactly one validator, only the data
// source is injectable.
const defaultGetSetting = async (key) => {
    const row = await dbAdapter.get(
        'SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]
    );
    return row?.setting_value ?? null;
};

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

// Kokoro's usable voice set, WITHOUT loading the ~600 MB model. CAREFUL:
// the package ships 54 <id>.bin files (incl. Italian/Japanese/Chinese
// packs), but the runtime `tts.voices` map exposes only 28 — English
// a/b-prefix voices (verified against a live load, 2026-07-10). A .bin
// file is NOT synthesizable; the bundled VOICES map is. We parse the ids
// out of the package's dist bundle (exact match with the runtime map —
// self-updating on package upgrades), and once the model IS loaded the
// live instance map wins outright.
let _kokoroStaticIds = null;
function kokoroStaticIds() {
    if (_kokoroStaticIds) return _kokoroStaticIds;
    try {
        const req = createRequire(import.meta.url);
        const distEntry = req.resolve('kokoro-js');
        const src = fs.readFileSync(distEntry, 'utf8');
        const ids = new Set(src.match(/\b[a-z][fm]_[a-z]+\b/g) || []);
        if (ids.size > 0) {
            _kokoroStaticIds = ids;
            return _kokoroStaticIds;
        }
    } catch (err) {
        providersLog.warn('kokoro static voice listing failed', { error: err.message });
    }
    return null; // don't cache a failure — a later call may succeed
}

async function kokoroHasVoice(voiceId) {
    const { isKokoroLoaded, listKokoroVoices, isKokoroVoice } = await import('./kokoroTts.js');
    // The loaded model is THE catalogue — exact by construction.
    if (isKokoroLoaded()) return listKokoroVoices().some(v => v.filename === voiceId);
    const staticIds = kokoroStaticIds();
    if (staticIds) return staticIds.has(voiceId);
    // Bundle unparseable — ask the model (may trigger a load; only
    // reachable when the static path failed, which also means kokoro is
    // likely broken on this box anyway).
    return isKokoroVoice(voiceId);
}

function piperHasVoice(voiceId) {
    return typeof voiceId === 'string'
        && voiceId.endsWith('.onnx')
        && !voiceId.includes('/') && !voiceId.includes('\\') && !voiceId.includes('..')
        && fs.existsSync(path.join(PIPER_DIR, voiceId));
}

/**
 * Exact catalogue-membership check for one provider. Throws only on
 * infrastructure failure (import error) — a definite "not in catalogue"
 * resolves false.
 */
export async function providerHasVoice(provider, voiceId) {
    if (typeof voiceId !== 'string' || !voiceId) return false;
    switch (provider) {
        case 'kokoro': return kokoroHasVoice(voiceId);
        case 'google': {
            const { isGoogleVoice } = await import('./googleTts.js');
            return isGoogleVoice(voiceId);
        }
        case 'openai': {
            const { isOpenaiVoice } = await import('./openaiTts.js');
            return isOpenaiVoice(voiceId);
        }
        case 'piper': return piperHasVoice(voiceId);
        default: return false;
    }
}

/**
 * THE router (VOICE2_PLAN.md §5.1): derive a voice's engine by exact
 * catalogue membership. Tolerant of per-catalogue check errors — a
 * provider whose catalogue can't be checked is unusable anyway, so
 * derivation falls through and the caller goes to the fallback tier.
 *
 * @returns {{ provider: string|null, checkErrors: string[] }}
 *   provider null = the id is in no (checkable) catalogue. checkErrors
 *   names providers whose catalogue check itself failed, for honest
 *   logging ("couldn't check" ≠ "not found").
 */
export async function deriveVoiceProvider(voiceId) {
    const checkErrors = [];
    if (typeof voiceId !== 'string' || !voiceId) return { provider: null, checkErrors };
    // Local catalogues first (cheap, no network). Order is irrelevant for
    // correctness — catalogues are pairwise disjoint (tested invariant).
    for (const provider of ['kokoro', 'piper', 'openai', 'google']) {
        try {
            if (await providerHasVoice(provider, voiceId)) return { provider, checkErrors };
        } catch (err) {
            checkErrors.push(provider);
            providersLog.warn('voice catalogue check failed during derivation', {
                provider, voice: voiceId, error: err.message
            });
        }
    }
    return { provider: null, checkErrors };
}

// ---------------------------------------------------------------------------
// Capability + policy (VOICE2_PLAN.md §5.2)
// ---------------------------------------------------------------------------

/**
 * Capability = can this box synthesize with the provider right now?
 * Probed, never stored. The kokoro probe must not force a model load
 * (R10): "not disabled + package present" is capable; the actual load
 * happens on first synthesis (boot warmup usually beats it).
 */
async function probeCapability(provider, getSetting) {
    switch (provider) {
        case 'kokoro': {
            try {
                const { kokoroDisabledReason } = await import('./kokoroTts.js');
                const disabled = kokoroDisabledReason();
                if (disabled) return { capable: false, reason: `model failed to load (${disabled})` };
            } catch (err) {
                return { capable: false, reason: `kokoro unavailable (${err.message})` };
            }
            if (!kokoroStaticIds()) return { capable: false, reason: 'kokoro-js package not found' };
            return { capable: true, reason: null };
        }
        case 'piper': {
            if (!fs.existsSync(PIPER_BIN)) return { capable: false, reason: 'piper binary not installed' };
            let hasVoices = false;
            try {
                hasVoices = fs.existsSync(PIPER_DIR)
                    && fs.readdirSync(PIPER_DIR).some(f => f.endsWith('.onnx'));
            } catch { hasVoices = false; }
            if (!hasVoices) return { capable: false, reason: 'no piper voices installed' };
            return { capable: true, reason: null };
        }
        case 'google': {
            const keySet = !!(await getSetting('google_tts_api_key')) || !!process.env.GOOGLE_TTS_API_KEY;
            return keySet ? { capable: true, reason: null } : { capable: false, reason: 'no API key' };
        }
        case 'openai': {
            const explicit = !!(await getSetting('openai_tts_api_key')) || !!process.env.OPENAI_API_KEY;
            if (explicit) return { capable: true, reason: null };
            const llmProvider = await getSetting('llm_provider');
            const llmKey = await getSetting('llm_api_key');
            if (llmProvider === 'openai' && llmKey) return { capable: true, reason: null };
            return { capable: false, reason: 'no API key' };
        }
        default:
            return { capable: false, reason: `unknown provider "${provider}"` };
    }
}

async function providerEnabled(provider, getSetting) {
    const raw = await getSetting(providerEnabledKey(provider));
    // Default enabled: capability already gates cloud engines (no key ⇒
    // unusable); the toggle exists for the deliberate "keyed for LLM work
    // but voice must stay free" case (VOICE2_PLAN.md §5.2).
    return raw !== '0' && raw !== 'false';
}

/**
 * Status of one provider: usable = capable ∧ enabled.
 * @returns {{ id, capable, enabled, usable, reason: string|null }}
 */
export async function getProviderStatus(provider, { getSetting = defaultGetSetting } = {}) {
    const { capable, reason } = await probeCapability(provider, getSetting);
    const enabled = await providerEnabled(provider, getSetting);
    return {
        id: provider,
        capable,
        enabled,
        usable: capable && enabled,
        reason: !enabled ? 'disabled in settings' : reason
    };
}

/** Status of all four providers, for the settings payload and pickers. */
export async function getAllProviderStatus(opts = {}) {
    const out = [];
    for (const p of TTS_PROVIDERS) out.push(await getProviderStatus(p, opts));
    return out;
}

// ---------------------------------------------------------------------------
// Voice listings (per provider) — used by /tts/voices
// ---------------------------------------------------------------------------

export function inferVoiceGenderFromName(name) {
    const s = String(name || '').replace(/[_-]+/g, ' ');
    if (/\b(child|kid|youth|young)\b/i.test(s)) return 'child';
    if (/\b(amy|bella|aoede|kore|leda|zephyr|nova|shimmer|female|woman|girl)\b/i.test(s)) return 'female';
    if (/\b(ryan|michael|charon|puck|orus|fenrir|echo|fable|onyx|male|man|boy)\b/i.test(s)) return 'male';
    if (/\b(neutral|alloy)\b/i.test(s)) return 'neutral';
    return '';
}

export function readVoiceSidecar(filename) {
    const sidecar = path.join(PIPER_DIR, filename + '.json');
    if (!fs.existsSync(sidecar)) return null;
    try { return JSON.parse(fs.readFileSync(sidecar, 'utf8')); }
    catch { return null; }
}

// Kokoro listing that works BEFORE the model loads: ids from the static
// package catalogue, language from the prefix map, gender from the id's
// second letter (af_… female, am_… male). When the model IS loaded, the
// richer listKokoroVoices (names, traits) wins.
async function listKokoroVoicesAnySource() {
    const { isKokoroLoaded, listKokoroVoices } = await import('./kokoroTts.js');
    if (isKokoroLoaded()) return listKokoroVoices();
    const staticIds = kokoroStaticIds();
    if (!staticIds) return [];
    return [...staticIds].sort().map(id => ({
        filename: id,
        displayName: id.slice(3).replace(/^./, c => c.toUpperCase()),
        language: KOKORO_PREFIX_LANGUAGE[id[0]] || 'en-US',
        gender: id[1] === 'f' ? 'female' : 'male',
        sampleRate: 24000
    }));
}

function listPiperVoices() {
    if (!fs.existsSync(PIPER_DIR)) return [];
    let files;
    try {
        files = fs.readdirSync(PIPER_DIR).filter(f => f.endsWith('.onnx'));
    } catch { return []; }
    return files.map(filename => {
        const sidecar = readVoiceSidecar(filename);
        const language = sidecar?.language?.code || sidecar?.language?.name_native || 'unknown';
        const sampleRate = sidecar?.audio?.sample_rate || 22050;
        const m = filename.match(/^([a-z]{2}_[A-Z]{2})-([^-]+)-/);
        const speaker = m?.[2] || filename.replace(/\.onnx$/, '');
        const gender = inferVoiceGenderFromName(`${speaker} ${filename}`);
        return { filename, displayName: speaker, language, sampleRate, gender };
    });
}

/**
 * Voice catalogue for one provider. Never throws; an unlistable provider
 * returns []. (Whether it is USABLE is getProviderStatus's job.)
 */
export async function listVoicesForProvider(provider) {
    try {
        switch (provider) {
            case 'kokoro': return await listKokoroVoicesAnySource();
            case 'google': {
                const { listGoogleVoices } = await import('./googleTts.js');
                return listGoogleVoices();
            }
            case 'openai': {
                const { listOpenaiVoices } = await import('./openaiTts.js');
                return listOpenaiVoices();
            }
            case 'piper': return listPiperVoices();
            default: return [];
        }
    } catch (err) {
        providersLog.warn('voice listing failed', { provider, error: err.message });
        return [];
    }
}

// ---------------------------------------------------------------------------
// NOTE (VOICE2_PLAN.md v1.4 — sovereign case voices): the server-side
// language-matched fallback resolver that used to live here was removed.
// A configured voice is LITERAL — /api/tts plays it or fails honestly.
// The per-language `tts_default_voice_<lang>` keys remain, but they are a
// CLIENT-side resolver tier for speakers with no voice configured at all
// (src/utils/voiceResolver.js) and are audited at boot
// (server/healthChecks/voiceCatalogueAudit.js).
