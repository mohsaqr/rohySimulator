// Single source of truth for voice resolution. Replaces three previously-
// duplicated implementations:
//   - ChatInterface.pickVoiceFile + resolveRatePitch (patient + agent voices)
//   - AgentPersonaEditor.resolvedVoice (admin preview)
//   - useDiscussionEngine.resolveDiscussantVoice (post-case debrief)
//
// All three told the next dev to "keep in sync" by comment; nothing
// enforced it. Centralising here means future drift is impossible — any
// surface that asks "what voice should we play?" gets the same answer.
//
// The chain (highest-precedence first):
//   1. case_voice override          → tier='override'
//   2. platform persona default     → tier='platform-default'
//      (default_voice_<provider>_<slot> in /api/platform-settings/avatars)
//   3. platform voice slot          → tier='voice-slot'
//      (voice_<provider>_<slot> in /api/platform-settings/voice)
//   4. hardcoded provider fallback  → tier='hardcoded'
//      (PROVIDER_FALLBACK_VOICE — empty for piper today, populated for the
//      Kokoro and cloud providers)
//   5. catalog-first (editor only)  → tier='catalog-first'
//      Only used when the caller passes ttsVoices (the loaded provider
//      catalogue). Picks the first voice the engine actually has installed
//      so the persona editor's preview button can play *something* on a
//      fresh install with empty platform slots. The runtime would 503 here.

import { PROVIDER_FALLBACK_VOICE } from './voiceFallbacks';
import { deriveDemographicSlot } from './demographics.js';

// Slot is age-driven: <13 → child, otherwise male/female by gender prefix.
// Keep this aligned with the server's resolveTtsVoice (server/routes.js)
// or admin previews drift from runtime.
function deriveSlot(gender, age) {
    return deriveDemographicSlot(gender, age);
}

// Pick the active provider from the speaker config + platform default. The
// per-speaker tts_provider wins; otherwise the platform's default tts_provider
// applies. Last-resort default is 'kokoro' (matches server-side fallback).
function deriveProvider(voice, voiceSettings) {
    return voice?.tts_provider
        || voiceSettings?.tts_provider
        || 'kokoro';
}

// Effective rate/pitch for the speaker. Per-speaker override wins; otherwise
// inherit from the platform persona default (per-slot) or the global
// tts_rate / tts_pitch. Returns undefined when nothing applies so the caller
// can pass through and let the server clamp to its own default.
function deriveRatePitch({ voice, voiceSettings, platformAvatars, slot }) {
    const personaRate  = platformAvatars?.[`default_rate_${slot}`];
    const personaPitch = platformAvatars?.[`default_pitch_${slot}`];

    const pickNum = (...vals) => {
        for (const v of vals) {
            if (v == null || v === '') continue;
            const n = Number(v);
            if (Number.isFinite(n)) return n;
        }
        return undefined;
    };
    return {
        rate:  pickNum(voice?.tts_rate,  personaRate,  voiceSettings?.tts_rate),
        pitch: pickNum(voice?.tts_pitch, personaPitch, voiceSettings?.tts_pitch)
    };
}

/**
 * Resolve which voice file to play for a given speaker.
 *
 * @param {object}   args
 * @param {object}  [args.voice]            Per-speaker config (`config.voice`):
 *                                          { tts_provider?, case_voice?, tts_rate?, tts_pitch? }
 * @param {object}  [args.voiceSettings]    Platform voice settings (/api/platform-settings/voice).
 * @param {object}  [args.platformAvatars]  Platform avatar settings (/api/platform-settings/avatars).
 * @param {string}  [args.gender]           'male' | 'female' | '' (case-insensitive prefix).
 * @param {number}  [args.age]              Speaker age; <13 → child slot.
 * @param {Array}   [args.ttsVoices]        Optional loaded voice catalogue for catalog-first tier.
 *
 * @returns {{
 *   file: string|null,
 *   provider: string,
 *   rate: number|undefined,
 *   pitch: number|undefined,
 *   tier: 'override'|'platform-default'|'voice-slot'|'hardcoded'|'catalog-first'|null
 * }}
 *   `file` is null when nothing resolves AND no catalogue was provided —
 *   callers should treat that as "no preview available" / "503 at runtime".
 */
export function resolveVoice({
    voice = {},
    voiceSettings = null,
    platformAvatars = null,
    gender = '',
    age = 35,
    ttsVoices = null
} = {}) {
    const provider = deriveProvider(voice, voiceSettings);
    const slot = deriveSlot(gender, age);
    const { rate, pitch } = deriveRatePitch({ voice, voiceSettings, platformAvatars, slot });

    // Tier 1: explicit per-speaker override.
    if (voice?.case_voice) {
        return { file: voice.case_voice, provider, rate, pitch, tier: 'override' };
    }

    // Tier 2: platform persona default for this provider+slot.
    const personaDefault = platformAvatars?.[`default_voice_${provider}_${slot}`];
    if (personaDefault) {
        return { file: personaDefault, provider, rate, pitch, tier: 'platform-default' };
    }

    // Tier 3: platform voice slot.
    const slotted = voiceSettings?.[`voice_${provider}_${slot}`];
    if (slotted) {
        return { file: slotted, provider, rate, pitch, tier: 'voice-slot' };
    }

    // Tier 4: hardcoded provider fallback. Empty string for Piper (no
    // baked-in default — admins must configure or rely on tier 5).
    const hardcoded = PROVIDER_FALLBACK_VOICE?.[provider]?.[slot];
    if (hardcoded) {
        return { file: hardcoded, provider, rate, pitch, tier: 'hardcoded' };
    }

    // Tier 5: catalog-first. Only honoured when the caller explicitly passes
    // ttsVoices — the runtime path leaves it null so it correctly returns
    // file=null and 503s instead of guessing at a voice the admin didn't
    // configure.
    if (Array.isArray(ttsVoices) && ttsVoices.length > 0 && ttsVoices[0]?.filename) {
        return { file: ttsVoices[0].filename, provider, rate, pitch, tier: 'catalog-first' };
    }

    return { file: null, provider, rate, pitch, tier: null };
}

// Re-exported helper for callers that need just the slot (eg. legacy code
// passing slotGender to VoiceService for downstream use).
export { deriveSlot };
