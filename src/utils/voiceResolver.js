// Single source of truth for CLIENT-side voice resolution (Voice 2.0 —
// VOICE2_PLAN.md; v1.4 sovereignty semantics).
//
// 2026-05-12 — resolution collapsed to ONE tier (case_voice or mute) after
//              hidden fallback tiers spent three weeks lying to admins.
// 2026-07-10 — Voice 2.0: THE VOICE OWNS ITS ENGINE. Each voice's engine is
//              derived from the id itself (exact catalogue membership on
//              the server; the shape patterns are the client's cheap
//              mirror). There is no platform engine setting.
// 2026-07-10 — v1.4 (owner: "the case sound reigns supreme"): A CONFIGURED
//              VOICE IS LITERAL. If the case (or the persona template, when
//              the case has none) names a voice, that voice plays or the
//              speaker fails LOUDLY — no template stand-in, no default
//              stand-in, no cross-engine rescue. The per-language platform
//              default exists ONLY for speakers with no voice configured
//              at all. Errors are surfaced honestly everywhere; the
//              engine-off impact modal in Settings warns admins which
//              cases a toggle strands before they flip it.
//
// Chain (highest-precedence first):
//   1. case-level `case_voice` set → playable ? tier 'override'
//                                             : tier 'invalid' (LOUD)
//   2. template `case_voice` set   → playable ? tier 'override'
//                                             : tier 'invalid' (LOUD)
//   3. nothing configured → the platform's per-language default voice
//      (voiceSettings.tts_default_voice_<lang>) → tier 'default',
//      substituted: true, reason 'not_configured' — announced by every
//      consumer (toast/editor note). Never crosses a language boundary.
//   4. nothing playable at all → file null, tier null.
//
// "Playable" = the voice's shape-derived engine is usable per
// voiceSettings.providers (capability ∧ enabled, probed by the server).
// Before settings load the check fails OPEN — the server re-derives with
// the real catalogues and owns the final word either way.

import { deriveDemographicSlot } from './demographics.js';
import {
    isVoiceValidForProvider,
    guessVoiceProvider,
    voiceLanguage,
    voiceMatchesLanguage,
    primaryLanguage,
    TTS_PROVIDERS,
    PAID_TTS_PROVIDERS,
    isPaidProvider,
} from '../../server/shared/voiceIdentity.js';
import { isKnownLanguage, DEFAULT_LANGUAGE } from '../i18n/languages.js';

// Identity helpers live in server/shared/voiceIdentity.js (one module for
// client + server, like the language registry). Re-exported so existing
// imports from this file keep working.
export {
    isVoiceValidForProvider,
    guessVoiceProvider,
    voiceLanguage,
    voiceMatchesLanguage,
    primaryLanguage,
    TTS_PROVIDERS,
    PAID_TTS_PROVIDERS,
    isPaidProvider,
};

function deriveSlot(gender, age) {
    return deriveDemographicSlot(gender, age);
}

function pickNum(...vals) {
    for (const v of vals) {
        if (v == null || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
}

/**
 * Is this voice id playable on a usable engine, per the provider status
 * the server put in the settings payload? Fail-open before settings load.
 */
function playableOnUsableEngine(voiceId, providers) {
    const engine = guessVoiceProvider(voiceId);
    if (!engine) return false; // matches no engine's id shape → unplayable anywhere
    if (!Array.isArray(providers)) return true; // settings not loaded — server decides
    const status = providers.find(p => p.id === engine);
    return status ? !!status.usable : true;
}

/**
 * Resolve which voice file to play for a given speaker.
 *
 * @param {object}   args
 * @param {object}  [args.voice]          Case-level config — `case_voice`,
 *                                        `tts_rate`, `tts_pitch`.
 * @param {object}  [args.templateVoice]  The persona template's voice config,
 *                                        passed UNMERGED. The template is
 *                                        the configuration when the case
 *                                        sets nothing; it is NOT a stand-in
 *                                        for an unplayable case voice
 *                                        (sovereignty: a configured voice
 *                                        plays literally or fails loudly).
 * @param {object}  [args.voiceSettings]  Platform voice settings payload —
 *                                        `providers` (status array),
 *                                        `tts_default_voice_<lang>`,
 *                                        `tts_rate`, `tts_pitch`.
 * @param {string}  [args.language]       Registry code of the session/case
 *                                        language; selects WHICH default
 *                                        voice may substitute. Absent ⇒ 'en'.
 * @param {Function}[args.isValid]        Optional `(voiceId) => boolean`
 *                                        override of the playability check
 *                                        (tests, catalogue-backed callers).
 *
 * @returns {{
 *   file: string|null,           // what will play
 *   requestedFile: string|null,  // what the config asked for
 *   provider: string|null,       // derived engine of `file` (display truth)
 *   rate: number|undefined,
 *   pitch: number|undefined,
 *   tier: 'override'|'default'|'invalid'|null,
 *   substituted: boolean,
 *   substitutionReason: 'not_configured'|null
 * }}
 */
export function resolveVoice({ voice = {}, templateVoice = null, voiceSettings = null, language = null, isValid = null } = {}) {
    const playable = typeof isValid === 'function'
        ? isValid
        : (id) => playableOnUsableEngine(id, voiceSettings?.providers);
    const rate  = pickNum(voice?.tts_rate,  templateVoice?.tts_rate,  voiceSettings?.tts_rate);
    const pitch = pickNum(voice?.tts_pitch, templateVoice?.tts_pitch, voiceSettings?.tts_pitch);

    const caseVoice = voice?.case_voice || null;
    const tmplVoice = templateVoice?.case_voice || null;
    const requestedFile = caseVoice || tmplVoice || null;

    const result = (file, tier, substitutionReason = null) => ({
        file,
        requestedFile,
        provider: file ? guessVoiceProvider(file) : (requestedFile ? guessVoiceProvider(requestedFile) : null),
        rate,
        pitch,
        tier,
        substituted: !!substitutionReason,
        substitutionReason
    });

    // Sovereignty: whichever voice is CONFIGURED (case first, else the
    // persona template) is literal — it plays or the speaker fails loudly.
    // An unplayable configured voice never falls through to anything.
    if (requestedFile) {
        return playable(requestedFile)
            ? result(requestedFile, 'override')
            : result(null, 'invalid');
    }

    // Nothing configured → the platform's per-language default, announced
    // as a substitution. Strictly language-matched (the German directive).
    const lang = isKnownLanguage(language) ? language : DEFAULT_LANGUAGE;
    const defaultVoice = voiceSettings?.[`tts_default_voice_${lang}`] || null;
    if (defaultVoice && playable(defaultVoice)) {
        return result(defaultVoice, 'default', 'not_configured');
    }

    return result(null, null);
}

// Re-exported for callers that still need to render a demographic slot label
// in the UI (e.g., "inherits from female default" copy). The resolver itself
// no longer consults it.
export { deriveSlot };
