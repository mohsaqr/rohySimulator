// Client-side mirror of server/services/voiceFallbacks.js. Last-chance
// fallback for ChatInterface.pickVoiceFile when no per-provider voice
// is configured for the patient's gender.
//
// IMPORTANT: keep in lockstep with the server copy. The two are small
// enough that hand-mirroring beats a build-time share.

export const PROVIDER_FALLBACK_VOICE = {
    kokoro: { female: 'af_bella',        male: 'am_michael',         child: 'af_bella' },
    openai: { female: 'nova',            male: 'onyx',               child: 'shimmer' },
    google: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-A',    child: 'en-US-Neural2-F' },
    piper:  { female: '',                male: '',                   child: '' }
};

export function fallbackVoiceFor(provider, gender) {
    return PROVIDER_FALLBACK_VOICE[provider]?.[gender] || '';
}
