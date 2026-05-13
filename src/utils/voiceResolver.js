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
 *
 * @returns {{
 *   file: string|null,
 *   provider: string|null,
 *   rate: number|undefined,
 *   pitch: number|undefined,
 *   tier: 'override'|null
 * }}
 *   `file` is null when no `case_voice` is set. Callers should surface
 *   this to the admin instead of substituting a default — there are no
 *   defaults below this tier by design.
 */
export function resolveVoice({ voice = {}, voiceSettings = null } = {}) {
    const provider = deriveProvider(voiceSettings);
    const { rate, pitch } = deriveRatePitch(voice, voiceSettings);

    if (voice?.case_voice) {
        return { file: voice.case_voice, provider, rate, pitch, tier: 'override' };
    }

    return { file: null, provider, rate, pitch, tier: null };
}

// Re-exported for callers that still need to render a demographic slot label
// in the UI (e.g., "inherits from female default" copy). The resolver itself
// no longer consults it.
export { deriveSlot };
