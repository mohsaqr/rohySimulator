// Single source of truth for voice resolution. ONE tier, no fallbacks.
//
// 2026-05-12 — RESOLUTION CHAIN COLLAPSED TO ONE EXPLICIT SOURCE.
// 2026-05-13 — Re-confirmed after a brief tier-2 experiment: every shipped
//              persona row carries its own `case_voice` (set in
//              server/db.js DEFAULT_AGENTS). No demographic-slot fallback,
//              no per-provider hardcoded map, no catalogue scan.
//
// Chain (highest-precedence first):
//   1. voice.case_voice            → tier='override'
//      The per-character voice id. Patient template carries the default,
//      the case may override it (see mergePatientVoiceConfig in
//      ChatInterface). Agent personas store their own case_voice.
//   2. (nothing)                   → tier=null, file=null
//      Surface explicitly so the UI can prompt the admin to set one. No
//      hardcoded provider voice, no slot fallback, no catalogue scan.
//
// Provider is resolved separately from a single source: the platform's
// voiceSettings.tts_provider. Per-character tts_provider is no longer read
// at all — switching the active engine is a platform-level decision and
// reading it from anywhere else lets stale persona configs leak the wrong
// provider into the runtime (e.g., a Google voice id being shipped to
// Kokoro because the persona was authored under Google).

import { deriveDemographicSlot } from './demographics.js';

function deriveSlot(gender, age) {
    return deriveDemographicSlot(gender, age);
}

function deriveProvider(voiceSettings) {
    return voiceSettings?.tts_provider || null;
}

// Provider-specific voice-id shapes. Used by isVoiceValidForProvider()
// to give the resolver a cheap, no-network guard against the "Google
// id leaked onto Kokoro" class of bug. Brittle if a provider introduces
// a new id shape — for that scenario callers should pass their own
// `isValid` (e.g., one backed by a cached /tts/voices fetch).
const VOICE_ID_PATTERNS = {
    // Kokoro: <accent><gender>_<name> — af_bella, am_michael, bm_lewis, bf_emma.
    kokoro:  /^[abf][bfm]_[a-z]+$/,
    // Google: en-US-Neural2-J, en-US-Chirp3-HD-Orus, fr-FR-Wavenet-B.
    google:  /^[a-z]{2,3}-[A-Z]{2,3}-/,
    // Piper: filename.onnx — en_US-amy-medium.onnx, fi_FI-harri-medium.onnx.
    piper:   /\.onnx$/,
    // OpenAI: short lowercase canonical names. Update if OpenAI ships
    // more voices; until then the pattern is a closed list.
    openai:  /^(alloy|echo|fable|onyx|nova|shimmer|coral|sage|ash|verse|ballad)$/i,
};

/**
 * Cheap pattern-based check: is this voice id plausibly valid for the
 * given provider? Catches cross-provider contamination (the bug class
 * that drove three weeks of voice churn) without needing a catalogue
 * round-trip. If the provider isn't in the pattern map, returns true
 * (don't reject what we don't recognise).
 */
export function isVoiceValidForProvider(voiceId, provider) {
    if (!voiceId) return false;
    const pattern = VOICE_ID_PATTERNS[provider];
    return pattern ? pattern.test(voiceId) : true;
}

function pickNum(...vals) {
    for (const v of vals) {
        if (v == null || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
}

function deriveRatePitch(voice, voiceSettings) {
    return {
        rate:  pickNum(voice?.tts_rate,  voiceSettings?.tts_rate),
        pitch: pickNum(voice?.tts_pitch, voiceSettings?.tts_pitch)
    };
}

/**
 * Resolve which voice file to play for a given speaker.
 *
 * @param {object}   args
 * @param {object}  [args.voice]            Per-speaker config — only `case_voice`,
 *                                          `tts_rate`, `tts_pitch` are read.
 * @param {object}  [args.voiceSettings]    Platform voice settings — `tts_provider`,
 *                                          `tts_rate`, `tts_pitch`.
 * @param {Function}[args.isValid]          Optional `(voiceId) => boolean`. When
 *                                          supplied and the resolved `case_voice`
 *                                          isn't valid for the active provider's
 *                                          catalogue, returns `tier: 'invalid'`
 *                                          and `file: null` so the caller can
 *                                          fall back to the template / surface
 *                                          a clear empty state — instead of
 *                                          shipping a dead string to /api/tts
 *                                          where playback would 400.
 *
 * @returns {{
 *   file: string|null,
 *   provider: string|null,
 *   rate: number|undefined,
 *   pitch: number|undefined,
 *   tier: 'override'|'invalid'|null
 * }}
 *   `file` is null when no `case_voice` is set OR when the value is rejected
 *   by `isValid`. Callers should surface this to the admin instead of
 *   substituting a default — there are no defaults below this tier by design.
 */
export function resolveVoice({ voice = {}, voiceSettings = null, isValid = null } = {}) {
    const provider = deriveProvider(voiceSettings);
    const { rate, pitch } = deriveRatePitch(voice, voiceSettings);

    if (voice?.case_voice) {
        if (typeof isValid === 'function' && !isValid(voice.case_voice)) {
            return { file: null, provider, rate, pitch, tier: 'invalid' };
        }
        return { file: voice.case_voice, provider, rate, pitch, tier: 'override' };
    }

    return { file: null, provider, rate, pitch, tier: null };
}

// ---------------------------------------------------------------------------
// I18N (2026-07-08): voice LANGUAGE helpers. These are VALIDATION, not
// resolution — the one-tier case_voice design above is untouched. When the
// session's caseLanguage doesn't match the configured voice, callers warn
// loudly (diagnostic bar) and never substitute a different voice; fallback
// chains stay dead (I18N_PLAN.md §5).

// Kokoro voice-id prefix letter → language of the pack. af_bella = American
// English female; if_sara would be Italian female if a pack shipped.
const KOKORO_PREFIX_LANGUAGE = {
    a: 'en-US', b: 'en-GB', e: 'es-ES', f: 'fr-FR', h: 'hi-IN',
    i: 'it-IT', j: 'ja-JP', p: 'pt-BR', z: 'zh-CN'
};

/**
 * Derive the spoken language of a voice id for a given provider.
 *
 * @param {string} voiceId   e.g. 'en_US-amy-medium.onnx', 'en-US-Chirp3-HD-Kore', 'af_bella'.
 * @param {string} provider  'piper' | 'google' | 'kokoro' | 'openai' | 'browser'.
 * @returns {string|null} BCP-47 tag, the sentinel 'multilingual' (provider
 *   follows the input text), or null when unknown — callers must NOT warn on
 *   null (don't reject what we don't recognise, same stance as
 *   isVoiceValidForProvider).
 */
export function voiceLanguage(voiceId, provider) {
    if (provider === 'openai' || provider === 'browser') return 'multilingual';
    if (!voiceId || typeof voiceId !== 'string') return null;
    if (provider === 'piper') {
        const m = voiceId.match(/^([a-z]{2})_([A-Z]{2})-/);
        return m ? `${m[1]}-${m[2]}` : null;
    }
    if (provider === 'google') {
        const m = voiceId.match(/^([a-z]{2,3}-[A-Z]{2,3})-/);
        return m ? m[1] : null;
    }
    if (provider === 'kokoro') {
        const m = voiceId.match(/^([a-z])[fm]_[a-z]+$/);
        return m ? (KOKORO_PREFIX_LANGUAGE[m[1]] ?? null) : null;
    }
    return null;
}

/**
 * Does this voice speak the given app language?
 *
 * @param {string} voiceId       Provider voice id.
 * @param {string} provider      TTS provider name.
 * @param {string} languageCode  Registry code ('en', 'it', …) or a BCP-47 tag.
 * @returns {boolean|null} true/false on a definite answer; null when the
 *   voice's language can't be derived (callers must not warn on null).
 */
export function voiceMatchesLanguage(voiceId, provider, languageCode) {
    if (!languageCode) return null;
    const spoken = voiceLanguage(voiceId, provider);
    if (spoken == null) return null;
    if (spoken === 'multilingual') return true;
    // Compare primary subtags only: it-IT matches 'it'; en-GB matches 'en-US'.
    const spokenPrimary = spoken.split('-')[0].toLowerCase();
    const wantedPrimary = languageCode.split('-')[0].toLowerCase();
    return spokenPrimary === wantedPrimary;
}

// Re-exported for callers that still need to render a demographic slot label
// in the UI (e.g., "inherits from female default" copy). The resolver itself
// no longer consults it.
export { deriveSlot };
