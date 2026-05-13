// Single source of truth for voice resolution. Two NAMED tiers, no hidden
// fallbacks.
//
// 2026-05-12 — RESOLUTION CHAIN COLLAPSED TO ONE EXPLICIT SOURCE.
// 2026-05-13 — TIER 2 RE-ADDED FOR PLATFORM VOICE SLOTS.
//
// The 2026-05-12 collapse stripped every silent fallback to fix the
// three-week "I changed it and nothing happens" chase. That removed the
// `voice_<provider>_<slot>` platform-slot tier as a side effect, which
// meant a female patient with no per-case override silently played the
// patient template's voice (or nothing). The platform slots ARE a
// legitimate, admin-configured mechanism — what we needed to remove were
// the silent code-side defaults, not the named platform slots.
//
// Chain (highest-precedence first), each tier explicitly named so the
// DiagnosticBar can show what fired:
//   1. voice.case_voice                              → tier='override'
//      The per-character voice id. Patient template carries the default,
//      the case may override it (see mergePatientVoiceConfig in
//      ChatInterface). Agent personas store their own case_voice.
//   2. voiceSettings.voice_<provider>_<slot>         → tier='platform-slot'
//      Platform-wide default for the speaker's demographic slot (male,
//      female, child — see deriveDemographicSlot). Slot is derived from
//      the caller-supplied gender + age. Skipped silently if the caller
//      didn't pass gender/age — for those callsites the contract is
//      "override or null", same as before.
//   3. (nothing)                                     → tier=null, file=null
//      Surface explicitly so the UI can prompt the admin to set one. No
//      hardcoded provider voice, no catalogue scan.
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
 *                                          `tts_rate`, `tts_pitch`,
 *                                          `voice_<provider>_<slot>`.
 * @param {string}  [args.gender]           Speaker gender ("male"/"female"/…),
 *                                          used to pick a platform slot when
 *                                          no case_voice is set. Optional —
 *                                          if absent, tier 2 is skipped.
 * @param {number}  [args.age]              Speaker age — combined with gender
 *                                          to produce the slot. Age < 13
 *                                          maps to "child" regardless of
 *                                          gender.
 *
 * @returns {{
 *   file: string|null,
 *   provider: string|null,
 *   rate: number|undefined,
 *   pitch: number|undefined,
 *   tier: 'override'|'platform-slot'|null,
 *   slot: 'male'|'female'|'child'|null
 * }}
 *   `file` is null only when neither a case override NOR a platform slot
 *   is available. Callers should surface that to the admin rather than
 *   substituting a default — there are no defaults below this tier by
 *   design.
 */
export function resolveVoice({ voice = {}, voiceSettings = null, gender = null, age = null } = {}) {
    const provider = deriveProvider(voiceSettings);
    const { rate, pitch } = deriveRatePitch(voice, voiceSettings);

    if (voice?.case_voice) {
        return { file: voice.case_voice, provider, rate, pitch, tier: 'override', slot: null };
    }

    // Tier 2: platform voice slot for the speaker's demographic bucket.
    // Only attempts the lookup when caller supplied a gender — otherwise
    // we have no slot to read and fall straight through to null.
    if (provider && (gender != null || age != null)) {
        const slot = deriveSlot(gender, age);
        const slotKey = `voice_${provider}_${slot}`;
        const slotVoice = voiceSettings?.[slotKey];
        if (slotVoice && typeof slotVoice === 'string' && slotVoice.trim() !== '') {
            return { file: slotVoice.trim(), provider, rate, pitch, tier: 'platform-slot', slot };
        }
        return { file: null, provider, rate, pitch, tier: null, slot };
    }

    return { file: null, provider, rate, pitch, tier: null, slot: null };
}

// Re-exported for callers that still need to render a demographic slot label
// in the UI (e.g., "inherits from female default" copy). The resolver itself
// no longer consults it.
export { deriveSlot };
