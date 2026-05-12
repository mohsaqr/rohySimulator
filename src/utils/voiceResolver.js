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
// 2026-05-12 — RESOLUTION CHAIN COLLAPSED TO TWO TIERS.
// Previously the chain reached through three platform-level tiers
// (case_voice → Avatars-tab persona default → Voice-tab voice slot →
// hardcoded). Admins reported "I changed the voice in Voice Settings and
// nothing happened" — five times in two weeks. Two compounding problems:
//   1. The most prominent admin surface (Voice Settings tab) was tier 3 of
//      4; case_voice silently won. No UI hinted what was overriding.
//   2. A flat per-gender platform setting can only carry three voices
//      total (male / female / child). Discussions with three female
//      speakers can't sound different from there — making per-character
//      voice the only level where the *real* per-speaker decision belongs.
// The fix: collapse to one place. Per-character voice (case_voice from the
// case config, or from each agent persona) is THE source. Falls through
// to a hardcoded provider fallback so the first sample-play on a fresh
// install isn't silent.
//
// New chain (highest-precedence first):
//   1. case_voice                   → tier='override'
//      Set in CaseAvatarVoicePicker (for the patient) or in
//      AgentPersonaEditor (for each agent persona). This is THE source.
//   2. hardcoded provider fallback  → tier='hardcoded'
//      PROVIDER_FALLBACK_VOICE — kokoro = af_bella/am_michael/af_bella,
//      openai = nova/onyx/shimmer, google = Neural2-{F,A,F}, piper = empty.
//   3. catalog-first (editor only)  → tier='catalog-first'
//      Only used when the caller passes ttsVoices (the loaded provider
//      catalogue). Picks the first voice the engine actually has installed
//      so the persona editor's preview button can play *something* on a
//      fresh install. The runtime path leaves ttsVoices=null and prefers
//      the hardcoded fallback.
//
// Platform-level `voice_<provider>_<slot>` and `default_voice_<provider>_<slot>`
// fields are no longer read at all. The DB rows can stay (no destructive
// migration); the UI for setting them has been removed from
// VoiceSettingsTab and AvatarsSettingsTab.

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

    // Tier 1: per-character case_voice — THE source.
    if (voice?.case_voice) {
        return { file: voice.case_voice, provider, rate, pitch, tier: 'override' };
    }

    // Tier 2: hardcoded provider fallback. Empty string for Piper (no
    // baked-in default — admins must configure case_voice on every Piper
    // case, or rely on tier 3 in the editor preview path).
    const hardcoded = PROVIDER_FALLBACK_VOICE?.[provider]?.[slot];
    if (hardcoded) {
        return { file: hardcoded, provider, rate, pitch, tier: 'hardcoded' };
    }

    // Tier 3: catalog-first (editor preview only). Honoured only when the
    // caller explicitly passes ttsVoices. The runtime path leaves it null
    // so it falls through to file=null and the route layer 503s instead of
    // guessing at a voice the admin didn't pick.
    if (Array.isArray(ttsVoices) && ttsVoices.length > 0 && ttsVoices[0]?.filename) {
        return { file: ttsVoices[0].filename, provider, rate, pitch, tier: 'catalog-first' };
    }

    return { file: null, provider, rate, pitch, tier: null };
}

// Re-exported helper for callers that need just the slot (eg. legacy code
// passing slotGender to VoiceService for downstream use).
export { deriveSlot };
