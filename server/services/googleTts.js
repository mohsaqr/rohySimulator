// Google Cloud Text-to-Speech.
//
// Most generous free tier of any cloud TTS:
//   - Neural2 / Chirp HD voices: 1 million chars/month free, then $16/$30 per 1M
//   - Standard voices:           4 million chars/month free, then $4   per 1M
//
// That's ~3,000 patient responses/month free on Neural2 — likely covers an
// entire teaching cohort at zero cost.
//
// API ref: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
//   POST https://texttospeech.googleapis.com/v1/text:synthesize?key=API_KEY
//   { input: { text }, voice: { languageCode, name }, audioConfig: {...} }
//
// Quirks:
//   - REST API is non-streaming. We yield the full PCM as a single chunk so
//     the route's pipePcmStream helper can use it uniformly.
//   - Google wraps LINEAR16 PCM in a 44-byte RIFF/WAVE header even when
//     the format is "raw PCM". We strip it before yielding raw samples.
//   - Auth uses an API key on the URL — same pattern as Cloud Speech-to-Text.

import { Buffer } from 'node:buffer';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const SAMPLE_RATE = 24000;

// Curated list. Google has 400+ voices across 50+ languages (call /voices to
// list them all); these are the natural-sounding ones in the 1M free tier
// that we expose by default. Add more here if students need other languages.
//
// Quality ranking (best → fine): Chirp 3 HD > Chirp HD > Neural2. All three
// share the SAME pricing tier (1M chars/month free, $16/1M after) — there is
// no cost reason to prefer Neural2. Chirp 3 HD voices are listed first so
// they sort to the top in voice pickers.
export const GOOGLE_VOICES = [
    // English (US) — Chirp 3 HD (2024+, most natural, 1M chars/month free)
    { filename: 'en-US-Chirp3-HD-Aoede',     displayName: 'Chirp3 HD-Aoede (US female)',     gender: 'female', language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Kore',      displayName: 'Chirp3 HD-Kore (US female)',      gender: 'female', language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Leda',      displayName: 'Chirp3 HD-Leda (US female)',      gender: 'female', language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Zephyr',    displayName: 'Chirp3 HD-Zephyr (US female)',    gender: 'female', language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Charon',    displayName: 'Chirp3 HD-Charon (US male)',      gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Puck',      displayName: 'Chirp3 HD-Puck (US male)',        gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Orus',      displayName: 'Chirp3 HD-Orus (US male)',        gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Chirp3-HD-Fenrir',    displayName: 'Chirp3 HD-Fenrir (US male)',      gender: 'male',   language: 'en-US' },

    // English (US) — Chirp HD (older but still very natural)
    { filename: 'en-US-Chirp-HD-D',          displayName: 'Chirp HD-D (US male)',            gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Chirp-HD-F',          displayName: 'Chirp HD-F (US female)',          gender: 'female', language: 'en-US' },
    { filename: 'en-US-Chirp-HD-O',          displayName: 'Chirp HD-O (US female)',          gender: 'female', language: 'en-US' },

    // English (US) — Neural2 (older generation, kept for backwards compat
    // with personas configured before the Chirp 3 HD voices were added).
    { filename: 'en-US-Neural2-A',           displayName: 'Neural2-A (US male)',             gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Neural2-C',           displayName: 'Neural2-C (US female)',           gender: 'female', language: 'en-US' },
    { filename: 'en-US-Neural2-D',           displayName: 'Neural2-D (US male)',             gender: 'male',   language: 'en-US' },
    { filename: 'en-US-Neural2-F',           displayName: 'Neural2-F (US female)',           gender: 'female', language: 'en-US' },
    { filename: 'en-US-Neural2-J',           displayName: 'Neural2-J (US male)',             gender: 'male',   language: 'en-US' },

    // English (UK) — Neural2
    { filename: 'en-GB-Neural2-A',           displayName: 'Neural2-A (UK female)',           gender: 'female', language: 'en-GB' },
    { filename: 'en-GB-Neural2-B',           displayName: 'Neural2-B (UK male)',             gender: 'male',   language: 'en-GB' },
    { filename: 'en-GB-Neural2-D',           displayName: 'Neural2-D (UK male)',             gender: 'male',   language: 'en-GB' },

    // English (Australia) — Neural2
    { filename: 'en-AU-Neural2-A',           displayName: 'Neural2-A (AU female)',           gender: 'female', language: 'en-AU' },
    { filename: 'en-AU-Neural2-B',           displayName: 'Neural2-B (AU male)',             gender: 'male',   language: 'en-AU' },
];

const VALID_VOICES = new Set(GOOGLE_VOICES.map(v => v.filename));

export function isGoogleVoice(name) {
    return typeof name === 'string' && VALID_VOICES.has(name);
}

// Env wins over a caller-supplied key so production deployments can keep
// secrets out of the database. Either source is acceptable.
function resolveApiKey(callerKey) {
    return process.env.GOOGLE_TTS_API_KEY
        || process.env.GOOGLE_API_KEY
        || callerKey
        || '';
}

// Streaming-shaped iterator (yields one chunk because the REST API is
// non-streaming). Per-sentence dispatch on the client still gives us
// first-sentence-fast playback, since each sentence is its own request.
export async function* synthesizeGoogleStream({ text, voice, speed, apiKey }) {
    if (!VALID_VOICES.has(voice)) {
        const err = new Error(`unknown Google voice "${voice}" (expected one of: ${[...VALID_VOICES].slice(0, 5).join(', ')}, …)`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    const key = resolveApiKey(apiKey);
    if (!key) {
        const err = new Error('Google TTS requires an API key. Set it in admin → Settings → Voice → Google TTS API key, or set GOOGLE_TTS_API_KEY in server/.env. Create one at console.cloud.google.com → APIs & Services → Credentials, after enabling the Text-to-Speech API.');
        err.code = 'NO_API_KEY';
        throw err;
    }

    // Voice name format is `<lang>-<region>-<engine>-<id>` (e.g. en-US-Neural2-A);
    // languageCode is the first two segments.
    const parts = voice.split('-');
    const languageCode = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';

    const res = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voice },
            audioConfig: {
                audioEncoding: 'LINEAR16',
                sampleRateHertz: SAMPLE_RATE,
                // Google's speakingRate is 0.25–4.0; the route layer clamps
                // the user-facing range before we get here.
                speakingRate: typeof speed === 'number' ? speed : 1,
                // headphone-class-device applies Google's headphone-tuned EQ.
                // Free, no quality regression on speakers, and noticeably
                // improves perceived clarity on headphones (where most of our
                // students are listening). One of the cheapest perceived-quality
                // wins in the API.
                effectsProfileId: ['headphone-class-device']
            }
        })
    });

    if (!res.ok) {
        let msg = `Google TTS HTTP ${res.status}`;
        try {
            const j = await res.json();
            if (j?.error?.message) msg = j.error.message;
        } catch { /* not json */ }
        const err = new Error(msg);
        err.code = res.status === 401 || res.status === 403 ? 'BAD_API_KEY' : 'UPSTREAM_ERROR';
        throw err;
    }

    const data = await res.json();
    if (!data?.audioContent) {
        throw new Error('Google TTS returned no audio content');
    }

    // audioContent is base64-encoded. Even with audioEncoding=LINEAR16 the
    // payload is wrapped in a 44-byte RIFF/WAVE header — strip it so we
    // hand the route handler raw int16 samples (matching Kokoro/OpenAI).
    const audioBuf = Buffer.from(data.audioContent, 'base64');
    const isWavWrapped = audioBuf.length > 44 && audioBuf.slice(0, 4).toString() === 'RIFF';
    const pcm = isWavWrapped ? audioBuf.slice(44) : audioBuf;

    yield { sampleRate: SAMPLE_RATE, pcm };
}

export async function synthesizeGoogleWav({ text, voice, speed, apiKey }) {
    const chunks = [];
    let totalLen = 0;
    for await (const { pcm } of synthesizeGoogleStream({ text, voice, speed, apiKey })) {
        chunks.push(pcm);
        totalLen += pcm.length;
    }
    const pcm = Buffer.concat(chunks, totalLen);
    return wrapPcmAsWav(pcm, SAMPLE_RATE);
}

function wrapPcmAsWav(pcm, sampleRate) {
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

export function listGoogleVoices() {
    return GOOGLE_VOICES.map(v => ({ ...v, sampleRate: SAMPLE_RATE }));
}
