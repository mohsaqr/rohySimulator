// Reference Express route. Drop this into your server's router after
// installing the providers' deps. Dispatches /api/tts to either Kokoro or
// Google based on the `provider` query param (default: kokoro), and serves
// either the raw WAV (single-buffer) or the kit's custom PCM stream
// (Accept: application/x-rohy-pcm-stream  or  ?stream=1).
//
// Usage:
//
//   import express from 'express';
//   import ttsRouter from './ttsRoute.js';
//   const app = express();
//   app.use(express.json({ limit: '64kb' }));
//   app.use('/api', ttsRouter);
//   app.listen(3000);
//
// Environment:
//   GOOGLE_TTS_API_KEY   (optional — only required to use ?provider=google)
//
// To gate this behind auth, mount your auth middleware ahead of it:
//   app.use('/api', authenticateToken, ttsRouter);
// — and make sure the kit's client-side AuthService.getToken() returns a
// valid token. The kit DOES NOT enforce auth itself; it's BYO.

import { Router } from 'express';
import { Buffer } from 'node:buffer';

const router = Router();

const TTS_TEXT_LIMIT = 4000;
const KNOWN_PROVIDERS = ['kokoro', 'google'];

router.post('/tts', async (req, res) => {
    const { text, voice, rate } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
    }
    if (text.length > TTS_TEXT_LIMIT) {
        return res.status(400).json({ error: `text exceeds ${TTS_TEXT_LIMIT} character limit` });
    }
    if (typeof voice !== 'string' || !voice) {
        return res.status(400).json({ error: 'voice required' });
    }

    // Pick provider: ?provider=kokoro|google overrides; default = kokoro.
    const provider = (typeof req.query.provider === 'string' && KNOWN_PROVIDERS.includes(req.query.provider))
        ? req.query.provider
        : 'kokoro';

    const wantStream = req.query.stream === '1'
        || req.headers.accept?.includes('application/x-rohy-pcm-stream');

    // Kokoro accepts speed 0.5–2.0; Google 0.25–4.0. Pick a conservative
    // shared range that's safe for both.
    const speed = (rate !== undefined && rate !== null && Number.isFinite(parseFloat(rate)))
        ? Math.max(0.7, Math.min(1.3, parseFloat(rate)))
        : 1;

    if (provider === 'kokoro') {
        const { synthesizeKokoro, synthesizeKokoroStream } = await import('./kokoroTts.js');
        if (wantStream) {
            try {
                await pipePcmStream(res, synthesizeKokoroStream({ text, voice, speed }));
                return;
            } catch (err) {
                if (!res.headersSent) {
                    return res.status(err.code === 'UNKNOWN_VOICE' ? 400 : 502).json({ error: err.message });
                }
                return res.end();
            }
        }
        try {
            const wav = await synthesizeKokoro({ text, voice, speed });
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(wav.length));
            return res.end(wav);
        } catch (err) {
            return res.status(err.code === 'UNKNOWN_VOICE' ? 400 : 502).json({ error: err.message });
        }
    }

    if (provider === 'google') {
        const { synthesizeGoogleStream, synthesizeGoogleWav } = await import('./googleTts.js');
        const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY || '';
        if (wantStream) {
            try {
                await pipePcmStream(res, synthesizeGoogleStream({ text, voice, speed, apiKey }));
                return;
            } catch (err) {
                if (!res.headersSent) {
                    const status = err.code === 'UNKNOWN_VOICE' ? 400
                        : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                        : 502;
                    return res.status(status).json({ error: err.message });
                }
                return res.end();
            }
        }
        try {
            const wav = await synthesizeGoogleWav({ text, voice, speed, apiKey });
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(wav.length));
            return res.end(wav);
        } catch (err) {
            const status = err.code === 'UNKNOWN_VOICE' ? 400
                : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                : 502;
            return res.status(status).json({ error: err.message });
        }
    }

    return res.status(400).json({ error: `unknown provider: ${provider}` });
});

// GET /api/tts/voices?provider=kokoro|google
// Returns the catalogue for the requested provider so the client can
// populate a voice picker. Auth-free by default.
router.get('/tts/voices', async (req, res) => {
    const provider = (typeof req.query.provider === 'string' && KNOWN_PROVIDERS.includes(req.query.provider))
        ? req.query.provider
        : 'kokoro';
    if (provider === 'kokoro') {
        const { listKokoroVoices, loadKokoro } = await import('./kokoroTts.js');
        await loadKokoro(); // ensure model is loaded so voices are populated
        return res.json({ provider, voices: listKokoroVoices() });
    }
    if (provider === 'google') {
        const { listGoogleVoices } = await import('./googleTts.js');
        return res.json({ provider, voices: listGoogleVoices() });
    }
    return res.status(400).json({ error: `unknown provider: ${provider}` });
});

// Shared PCM-stream framing. Wire format (little-endian throughout):
//   header:  4 bytes — sampleRate (uint32)
//   frames:  4 bytes — pcm byte length (uint32, 0 = end-of-stream)
//            N bytes — int16 PCM samples
async function pipePcmStream(res, asyncIter) {
    res.set('Content-Type', 'application/x-rohy-pcm-stream');
    res.set('Cache-Control', 'no-store');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket) res.socket.setNoDelay(true);
    let headerSent = false;
    for await (const { sampleRate, pcm } of asyncIter) {
        if (!headerSent) {
            const hdr = Buffer.alloc(4);
            hdr.writeUInt32LE(sampleRate, 0);
            res.write(hdr);
            headerSent = true;
        }
        if (!pcm || pcm.length === 0) continue;
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(pcm.length, 0);
        res.write(lenBuf);
        res.write(pcm);
    }
    if (!headerSent) {
        const hdr = Buffer.alloc(4);
        hdr.writeUInt32LE(24000, 0);
        res.write(hdr);
    }
    const eof = Buffer.alloc(4);
    eof.writeUInt32LE(0, 0);
    res.write(eof);
    res.end();
}

export default router;
