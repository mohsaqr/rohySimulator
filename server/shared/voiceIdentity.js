// Voice 2.0 (VOICE2_PLAN.md §5.1): pure, id-based voice identity helpers,
// shared by server and client. Lives under server/shared/ (not src/) for the
// same reason as languages.js — the Docker runtime stage copies server/
// wholesale but NOT src/. Client code imports this via the re-exports in
// src/utils/voiceResolver.js.
//
// Everything in this file is derivable from the voice id STRING alone — no
// catalogue, no network, no model load. That makes these helpers safe as
// pre-flight hints and for naming providers in error messages. They are NOT
// the router: the authoritative engine derivation is exact catalogue
// membership in server/services/ttsProviders.js (deriveVoiceProvider). The
// saga rule stands — a regex may hint, only a catalogue may route.

// The four engines with a server-side voice catalogue. 'browser' (client
// Web Speech API) was confirmed vestigial in the 2026-07-09 Codex audit —
// no window.speechSynthesis consumer exists — and is not part of Voice 2.0.
export const TTS_PROVIDERS = ['kokoro', 'google', 'openai', 'piper'];

// Paid engines bill per character on submission; local engines are free.
// Used for picker badges and for the runtime paid-failure fallback
// (VOICE2_PLAN.md §5.3 step 4 — only paid failures trigger a retry).
export const PAID_TTS_PROVIDERS = ['google', 'openai'];

export function isPaidProvider(provider) {
    return PAID_TTS_PROVIDERS.includes(provider);
}

// Provider-specific voice-id shapes. The kokoro pattern covers the full
// shipped prefix set (a/b/e/f/h/i/j/p/z + f|m gender letter — af_bella,
// if_sara, zm_yunjian); the old `^[abf][bfm]_` form predated the
// multilingual packs and silently failed on if_sara. Shapes are pairwise
// disjoint by construction (dashes vs underscore-slug vs .onnx vs closed
// word list) — tests/server/voiceIdentity.disjointness.test.js enforces it
// against the real catalogues.
export const VOICE_ID_PATTERNS = {
    // Kokoro: <language-prefix><gender>_<name> — af_bella, if_sara, bm_lewis.
    kokoro:  /^[a-z][fm]_[a-z]+$/,
    // Google: en-US-Neural2-J, de-DE-Chirp3-HD-Aoede, fr-FR-Wavenet-B.
    google:  /^[a-z]{2,3}-[A-Z]{2,3}-/,
    // Piper: filename.onnx — en_US-amy-medium.onnx, fi_FI-harri-medium.onnx.
    piper:   /\.onnx$/,
    // OpenAI: short lowercase canonical names. Closed list; update when
    // OpenAI ships more voices.
    openai:  /^(alloy|echo|fable|onyx|nova|shimmer|coral|sage|ash|verse|ballad)$/i,
};

/**
 * Cheap pattern-based check: is this voice id plausibly valid for the given
 * provider? Fail-open on unknown providers (don't reject what we don't
 * recognise). A pre-flight hint only — never a router.
 */
export function isVoiceValidForProvider(voiceId, provider) {
    if (!voiceId) return false;
    const pattern = VOICE_ID_PATTERNS[provider];
    return pattern ? pattern.test(voiceId) : true;
}

/**
 * Shape-based provider GUESS for a voice id. Used to name the likely engine
 * in logs/toasts when the catalogue check is unavailable (e.g. kokoro's
 * dynamic import failing on a box without it) — never for routing.
 *
 * @returns {string|null} provider name or null when no shape matches.
 */
export function guessVoiceProvider(voiceId) {
    if (typeof voiceId !== 'string' || !voiceId) return null;
    // Piper first: an .onnx suffix wins over everything (a hypothetical
    // "af_bella.onnx" is a piper file, not a kokoro id).
    if (VOICE_ID_PATTERNS.piper.test(voiceId))  return 'piper';
    if (VOICE_ID_PATTERNS.google.test(voiceId)) return 'google';
    if (VOICE_ID_PATTERNS.openai.test(voiceId)) return 'openai';
    if (VOICE_ID_PATTERNS.kokoro.test(voiceId)) return 'kokoro';
    return null;
}

// Kokoro voice-id prefix letter → language of the pack. af_bella = American
// English female; if_sara = Italian female. Mirrors the kokoro-js shipped
// voice set (54 voices, 2026-07).
export const KOKORO_PREFIX_LANGUAGE = {
    a: 'en-US', b: 'en-GB', e: 'es-ES', f: 'fr-FR', h: 'hi-IN',
    i: 'it-IT', j: 'ja-JP', p: 'pt-BR', z: 'zh-CN'
};

/**
 * Derive the spoken language of a voice id for a given provider.
 *
 * @param {string} voiceId   e.g. 'en_US-amy-medium.onnx', 'de-DE-Chirp3-HD-Kore', 'af_bella'.
 * @param {string} provider  'piper' | 'google' | 'kokoro' | 'openai'.
 * @returns {string|null} BCP-47 tag, the sentinel 'multilingual' (provider
 *   follows the input text), or null when unknown — callers must NOT warn on
 *   null (don't reject what we don't recognise).
 */
export function voiceLanguage(voiceId, provider) {
    if (provider === 'openai') return 'multilingual';
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
 * Primary language subtag of a BCP-47 tag or registry code: 'de-DE' → 'de',
 * 'en' → 'en'. Null-safe.
 */
export function primaryLanguage(tag) {
    if (typeof tag !== 'string' || !tag) return null;
    return tag.split('-')[0].toLowerCase();
}

/**
 * Does this voice speak the given app language?
 *
 * @returns {boolean|null} true/false on a definite answer; null when the
 *   voice's language can't be derived (callers must not warn on null).
 */
export function voiceMatchesLanguage(voiceId, provider, languageCode) {
    if (!languageCode) return null;
    const spoken = voiceLanguage(voiceId, provider);
    if (spoken == null) return null;
    if (spoken === 'multilingual') return true;
    // Compare primary subtags only: it-IT matches 'it'; en-GB matches 'en-US'.
    return primaryLanguage(spoken) === primaryLanguage(languageCode);
}
