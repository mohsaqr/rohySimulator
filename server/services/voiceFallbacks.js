// Last-chance voice fallbacks per provider. Used when a stored voice ID
// doesn't match the active provider's catalogue (because it was set under
// a different provider, or the catalogue changed under us). Better to
// play *some* voice than to silently fail mid-conversation.
//
// Picked for naturalness and broad availability:
//   - kokoro: af_bella (warm female), am_michael (clear male)
//             — kokoro has no dedicated child voice; the youngest-sounding
//               female works best, so af_bella doubles for child.
//   - openai: nova / onyx — most natural pair on tts-1; shimmer skews younger
//             so it's a reasonable child fallback.
//   - google: en-US-Neural2-F / Neural2-A — natural Neural2 voices on the
//             1M chars/month free tier. Same female reused for child.
//   - piper:  empty — depends on what .onnx files are installed on the host;
//             routes look up the first available file when this is empty.
//
// IMPORTANT: keep this file in lockstep with src/utils/voiceFallbacks.js.
// They're tiny, mirroring by hand is cheaper than wiring a build-time share.

export const PROVIDER_FALLBACK_VOICE = {
    kokoro: { female: 'af_bella',        male: 'am_michael',         child: 'af_bella' },
    openai: { female: 'nova',            male: 'onyx',               child: 'shimmer' },
    google: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-A',    child: 'en-US-Neural2-F' },
    piper:  { female: '',                male: '',                   child: '' }
};

// Resolve a voice for (provider, gender) given a candidate that may or may
// not be valid. If `candidate` is empty, returns the fallback. Validation
// of the candidate against the provider's actual voice catalogue happens
// inside the synth services (UNKNOWN_VOICE), not here — this helper just
// supplies the fallback when one is needed.
export function fallbackVoiceFor(provider, gender) {
    return PROVIDER_FALLBACK_VOICE[provider]?.[gender] || '';
}
