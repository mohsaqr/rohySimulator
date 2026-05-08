// Deeper unit tests for server/services/googleTts.js — internal contracts.
//
// CONTRACT: this file complements tests/server/tts-route.test.js Block A. It
// does NOT spawn the Express app; it pokes the service module directly with a
// stubbed `globalThis.fetch` so we can assert the literal POST body that would
// hit texttospeech.googleapis.com. The route-level pitch checks already shipped
// in tts-route.test.js, so we only repeat the two extreme clamps here at the
// service layer (10 and -10) — that is the contract we want to lock against
// future refactors of clampPitchSemitones.
//
// Most surface tested here is reached through the public exports
// `synthesizeGoogleStream` and `synthesizeGoogleWav`. Private helpers
// (resolveApiKey, clampPitchSemitones, languageCode parsing) are exercised
// indirectly because the prompt forbids modifying the source to expose them.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import {
    synthesizeGoogleStream,
    synthesizeGoogleWav,
} from '../../../server/services/googleTts.js';

// CONTRACT: SAMPLE_RATE is documented in the source as 24000. It is not
// exported, but the yielded chunk's `sampleRate` field IS the public way to
// observe it, so we treat 24000 as the locked-in constant. If the source ever
// re-derives this from voice metadata, this constant has to move with it.
const SAMPLE_RATE = 24000;

// Minimal valid Google response. The service requires `audioContent`
// (base64). 64 zero bytes is enough — > 44 bytes and not RIFF-prefixed so the
// strip-WAV branch falls through to "yield as-is".
function makeGoogleResponse({ ok = true, status = 200, body = null } = {}) {
    const audioContent = Buffer.alloc(64).toString('base64');
    return {
        ok,
        status,
        json: async () => (body !== null ? body : { audioContent }),
    };
}

// Drain helper — synthesizeGoogleStream is an async generator; consume it.
async function drain(gen) {
    const out = [];
    for await (const chunk of gen) {
        out.push(chunk);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Voice validation against VALID_VOICES
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — voice validation', () => {
    let capturedUrl;
    let capturedBody;

    beforeEach(() => {
        capturedUrl = null;
        capturedBody = null;
        const fakeFetch = vi.fn(async (url, init) => {
            capturedUrl = url;
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        });
        vi.stubGlobal('fetch', fakeFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('accepts a known-good voice (en-US-Neural2-D) and reaches fetch', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            speed: 1,
            apiKey: 'fake',
        }));
        expect(capturedUrl).toMatch(/texttospeech\.googleapis\.com/);
        expect(capturedBody.voice.name).toBe('en-US-Neural2-D');
    });

    it('rejects a typo voice with code=UNKNOWN_VOICE before any fetch call', async () => {
        // CONTRACT: voice validation must happen BEFORE fetch is invoked, so
        // we don't burn a Google API call (and quota) on a bad name.
        await expect(drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neurall2-D', // typo
            apiKey: 'fake',
        }))).rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
        expect(capturedBody).toBeNull();
    });

    it('rejects a lowercased voice with code=UNKNOWN_VOICE (set lookup is case-sensitive)', async () => {
        await expect(drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-us-neural2-d',
            apiKey: 'fake',
        }))).rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
    });

    it('rejects an empty-string voice with code=UNKNOWN_VOICE', async () => {
        await expect(drain(synthesizeGoogleStream({
            text: 'hi',
            voice: '',
            apiKey: 'fake',
        }))).rejects.toMatchObject({ code: 'UNKNOWN_VOICE' });
    });

    it('UNKNOWN_VOICE message lists several valid voices to help the caller', async () => {
        let caught;
        try {
            await drain(synthesizeGoogleStream({
                text: 'hi',
                voice: 'totally-made-up',
                apiKey: 'fake',
            }));
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeDefined();
        expect(caught.code).toBe('UNKNOWN_VOICE');
        // Source quotes the bad voice and lists the first 5 valid voices.
        expect(caught.message).toContain('totally-made-up');
        // At least one en-US voice should appear in the suggestion list.
        expect(caught.message).toMatch(/en-US-/);
    });
});

// ---------------------------------------------------------------------------
// languageCode parsing
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — languageCode derivation from voice name', () => {
    let capturedBody;

    beforeEach(() => {
        capturedBody = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('parses en-US-Neural2-D → languageCode "en-US"', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Neural2-D',
            apiKey: 'fake',
        }));
        expect(capturedBody.voice.languageCode).toBe('en-US');
    });

    it('parses en-GB-Neural2-A → languageCode "en-GB" (different region)', async () => {
        // CONTRACT: regional split for British English. Source iterates the
        // first two dash-segments — region is segment 2, not hardcoded en-US.
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-GB-Neural2-A',
            apiKey: 'fake',
        }));
        expect(capturedBody.voice.languageCode).toBe('en-GB');
    });

    it('voice with 4+ segments still uses just the first two segments (en-US-Chirp3-HD-Aoede)', async () => {
        // CONTRACT: Chirp 3 HD names have 5 segments. The languageCode
        // contract is "first two segments joined by '-'", not "first half".
        await drain(synthesizeGoogleStream({
            text: 'hi',
            voice: 'en-US-Chirp3-HD-Aoede',
            apiKey: 'fake',
        }));
        expect(capturedBody.voice.languageCode).toBe('en-US');
    });
});

// ---------------------------------------------------------------------------
// Pitch handling — service-level extreme clamps
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — pitch clamping', () => {
    let capturedBody;

    beforeEach(() => {
        capturedBody = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('pitch=999 clamps to audioConfig.pitch === 10 at the service layer', async () => {
        // CONTRACT: route-level test in tts-route.test.js Block A covers
        // pitch=50 → 10. Re-asserting at 999 here pins the upper bound to a
        // hard ceiling, not just "above the API range".
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', pitch: 999, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.pitch).toBe(10);
    });

    it('pitch=-999 clamps to audioConfig.pitch === -10 at the service layer', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', pitch: -999, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.pitch).toBe(-10);
    });

    it('omits pitch for Chirp voices instead of sending an unsupported control', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Chirp3-HD-Charon', pitch: 5, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig).not.toHaveProperty('pitch');
    });
});

// ---------------------------------------------------------------------------
// Speed parameter
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — speakingRate (speed)', () => {
    let capturedBody;

    beforeEach(() => {
        capturedBody = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('speed=0.7 → audioConfig.speakingRate === 0.7', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', speed: 0.7, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.speakingRate).toBe(0.7);
    });

    it('missing speed omits audioConfig.speakingRate (Google native default)', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig).not.toHaveProperty('speakingRate');
    });

    it('non-numeric speed omits audioConfig.speakingRate', async () => {
        // CONTRACT: speed coming from a config layer can be a string. The
        // service-level guard (`typeof speed === 'number'`) protects Google
        // from a 400 by omitting the field and letting the voice use its
        // native default pace.
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', speed: 'fast', apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig).not.toHaveProperty('speakingRate');
    });

    it('legacy Chirp HD omits speakingRate even when speed is set', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Chirp-HD-D', speed: 0.7, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig).not.toHaveProperty('speakingRate');
    });

    it('Chirp 3 HD keeps speakingRate because pace control is supported', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Chirp3-HD-Charon', speed: 0.7, apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.speakingRate).toBe(0.7);
    });
});

// ---------------------------------------------------------------------------
// effectsProfileId — perceived-quality win
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — effectsProfileId', () => {
    let capturedBody;

    beforeEach(() => {
        capturedBody = null;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('always sets effectsProfileId to ["headphone-class-device"]', async () => {
        // CONTRACT: documented in the source as one of the cheapest
        // perceived-quality wins. Removing it silently would regress audio
        // quality for headphone listeners with no log signal.
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }));
        expect(capturedBody.audioConfig.effectsProfileId).toEqual(['headphone-class-device']);
    });
});

// ---------------------------------------------------------------------------
// synthesizeGoogleWav — chunk concatenation
// ---------------------------------------------------------------------------

describe('synthesizeGoogleWav — concatenates streamed PCM chunks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns a WAV whose data section is the concatenation of all yielded chunks', async () => {
        // The REST-shaped service yields exactly one chunk per call. To
        // simulate "3 PCM chunks", we make fetch return three different
        // Google responses across three calls and drive the wav via the
        // public stream wrapper. But synthesizeGoogleWav calls the stream
        // exactly once. So instead: assert the simpler contract — one fetch
        // call's worth of PCM ends up at byte offset 44 of the WAV output,
        // wrapped in a 44-byte RIFF header. This is the actual contract;
        // the multi-chunk loop in source is forward-looking infra in case
        // the API ever becomes streaming.
        const pcmPayload = Buffer.alloc(128, 0xAB); // 128 bytes, all 0xAB
        const audioContent = pcmPayload.toString('base64');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ audioContent }),
        })));

        const wav = await synthesizeGoogleWav({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        });
        // RIFF header is 44 bytes; data section is the rest.
        expect(wav.slice(0, 4).toString()).toBe('RIFF');
        expect(wav.slice(8, 12).toString()).toBe('WAVE');
        const dataSection = wav.slice(44);
        // CONTRACT: data section equals concatenated yielded PCM chunks.
        // Even with N=1 today, the concat must be exact, byte-for-byte.
        expect(dataSection.equals(pcmPayload)).toBe(true);
        expect(dataSection.length).toBe(pcmPayload.length);
    });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — error mapping', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('400 with {error:{message}} → throws Error containing that message', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: { message: 'Invalid voice param' } }),
        })));
        await expect(drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }))).rejects.toThrow(/Invalid voice param/);
    });

    it('403 → throws with code=BAD_API_KEY (auth-class error)', async () => {
        // CONTRACT: 401/403 specifically map to BAD_API_KEY so the route
        // layer can render an admin-friendly "your API key is wrong" page.
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: 'Forbidden' } }),
        })));
        await expect(drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }))).rejects.toMatchObject({ code: 'BAD_API_KEY' });
    });

    it('network error from fetch propagates out of the iterator', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('ECONNREFUSED');
        }));
        await expect(drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }))).rejects.toThrow(/ECONNREFUSED/);
    });

    it('500-class error → throws with code=UPSTREAM_ERROR (non-auth)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'internal' } }),
        })));
        await expect(drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }))).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    });
});

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — API key resolution', () => {
    let capturedUrl;
    let originalEnvTts;
    let originalEnvGoogle;

    beforeEach(() => {
        capturedUrl = null;
        originalEnvTts = process.env.GOOGLE_TTS_API_KEY;
        originalEnvGoogle = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_TTS_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            capturedUrl = url;
            return makeGoogleResponse();
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (originalEnvTts === undefined) delete process.env.GOOGLE_TTS_API_KEY;
        else process.env.GOOGLE_TTS_API_KEY = originalEnvTts;
        if (originalEnvGoogle === undefined) delete process.env.GOOGLE_API_KEY;
        else process.env.GOOGLE_API_KEY = originalEnvGoogle;
    });

    it('env GOOGLE_TTS_API_KEY wins over caller-provided key (env-first policy)', async () => {
        // CONTRACT: source comment "Env wins over a caller-supplied key so
        // production deployments can keep secrets out of the database." We
        // lock that policy here. If this test starts failing because someone
        // flipped the precedence to caller-first, that change has to be a
        // deliberate, reviewed decision — not silent drift.
        process.env.GOOGLE_TTS_API_KEY = 'env-key-wins';
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'caller-key', // ignored
        }));
        expect(capturedUrl).toContain('key=env-key-wins');
        expect(capturedUrl).not.toContain('caller-key');
    });

    it('caller-provided apiKey is used when no env vars are set', async () => {
        await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'caller-fallback',
        }));
        expect(capturedUrl).toContain('key=caller-fallback');
    });

    it('throws code=NO_API_KEY when neither env nor caller key is set', async () => {
        await expect(drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D',
        }))).rejects.toMatchObject({ code: 'NO_API_KEY' });
    });
});

// ---------------------------------------------------------------------------
// Sample rate constant
// ---------------------------------------------------------------------------

describe('synthesizeGoogleStream — sample rate constant', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it(`yields chunks reporting sampleRate === ${SAMPLE_RATE} and sets audioConfig.sampleRateHertz to match`, async () => {
        let capturedBody;
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            capturedBody = JSON.parse(init.body);
            return makeGoogleResponse();
        }));

        const chunks = await drain(synthesizeGoogleStream({
            text: 'hi', voice: 'en-US-Neural2-D', apiKey: 'fake',
        }));
        expect(chunks).toHaveLength(1);
        expect(chunks[0].sampleRate).toBe(SAMPLE_RATE);
        expect(capturedBody.audioConfig.sampleRateHertz).toBe(SAMPLE_RATE);
    });
});
