// Voice service for Stack T:
//   - Browser SpeechRecognition for STT
//   - Server TTS via /api/tts. Two response shapes are supported:
//       * application/x-rohy-pcm-stream (Kokoro streaming) — sentence chunks
//         scheduled gaplessly so the first sentence starts playing while the
//         rest are still being synthesized
//       * audio/wav (Piper, or Kokoro non-streaming) — decoded once and played
//   - wawa-lipsync drives a per-frame dominant viseme stream from the same
//     analyser node either path feeds into.
//
// The streaming path is used in TWO modes:
//   1. Single-shot:  VoiceService.speak({ text, voice, ... })
//      Sends the whole reply text in one /tts call. Used for non-LLM-stream
//      callers (agents, error fallbacks).
//   2. Per-sentence: VoiceService.beginSpeechSession({ voice, ... }) →
//      session.enqueue(sentence) called repeatedly during the LLM stream,
//      then session.flush() at the end. Each enqueue fires its own /tts
//      request immediately, but audio is scheduled onto a single shared
//      timeline cursor (`nextStartTime`) so playback is gapless across
//      sentences and order is preserved via a Promise chain. This lets
//      the patient start talking as soon as the LLM finishes its first
//      sentence, instead of after the whole reply is generated.
//
// We bypass wawa's connectAudio() (which uses createMediaElementSource on a
// blob: URL — broken on some Chrome versions) and feed an
// AudioBufferSourceNode straight into wawa's internal analyser instead.
//
// Pitch: applied client-side via AudioBufferSourceNode.playbackRate. This
// couples pitch with playback speed (lower pitch → slower audio); the
// independent tempo control lives server-side as `rate` (Kokoro speed /
// Piper --length-scale). No native independent pitch shift is available
// in Web Audio without a third-party DSP library, and the user has
// accepted the coupling.

import { Lipsync } from 'wawa-lipsync';
import { apiUrl } from './config.js';
import { AuthService } from './authService.js';

const SR = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

const SILENT_VISEME = { viseme_sil: 1 };

let _recognition = null;
let _lipsync = null;
let _activeSources = [];
let _rafId = null;
let _started = false;
let _session = null;  // active speech session (single-shot or per-sentence)

function teardown() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    for (const src of _activeSources) {
        try { src.stop(); } catch { /* noop */ }
        try { src.disconnect(); } catch { /* noop */ }
    }
    _activeSources = [];
    if (_session) {
        _session.aborted = true;
        try { _session.abort.abort(); } catch { /* noop */ }
        _session = null;
    }
    // Note: we deliberately do NOT close _lipsync.audioContext here. Browsers
    // cap the number of live AudioContexts (~6); recreating one per turn
    // exhausts that budget after a few exchanges. Reused across speak() calls.
    _started = false;
}

// Lazy-init or reuse the lipsync + analyser. AudioContext stays live for the
// whole session so we don't blow past the browser's ~6-context cap.
async function ensureLipsync() {
    if (_lipsync) return _lipsync;
    _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
    _lipsync.analyser.connect(_lipsync.audioContext.destination);
    await _lipsync.audioContext.resume();
    return _lipsync;
}

// Dedup wrapper around onVisemes — only fires when the dominant viseme
// actually changes, so we don't trigger 60 React re-renders per second.
function makeVisemeEmitter(onVisemes) {
    let last = null;
    return (dominant) => {
        if (dominant === last) return;
        last = dominant;
        onVisemes?.(dominant === 'viseme_sil' ? SILENT_VISEME : { [dominant]: 1 });
    };
}

function int16BytesToAudioBuffer(audioCtx, pcmBytes, sampleRate) {
    const numSamples = Math.floor(pcmBytes.byteLength / 2);
    const buf = audioCtx.createBuffer(1, numSamples, sampleRate);
    const channel = buf.getChannelData(0);
    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    for (let i = 0; i < numSamples; i++) {
        const s = view.getInt16(i * 2, true);
        channel[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
    }
    return buf;
}

// Read [4-byte LE length][N bytes pcm] frames from a fetch ReadableStream.
// First 4 bytes are the sample rate; trailing 4-zero-bytes is EOF.
async function* readPcmFrames(reader, headerSampleRateRef) {
    let buffer = new Uint8Array(0);
    const need = async (n) => {
        while (buffer.length < n) {
            const { value, done } = await reader.read();
            if (done) return false;
            const merged = new Uint8Array(buffer.length + value.length);
            merged.set(buffer, 0);
            merged.set(value, buffer.length);
            buffer = merged;
        }
        return true;
    };

    if (!(await need(4))) return;
    headerSampleRateRef.current = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, true);
    buffer = buffer.slice(4);

    while (true) {
        if (!(await need(4))) return;
        const frameLen = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, true);
        buffer = buffer.slice(4);
        if (frameLen === 0) return;
        if (!(await need(frameLen))) return;
        yield buffer.slice(0, frameLen);
        buffer = buffer.slice(frameLen);
    }
}

// Track each scheduled source so we can stop it on cancel and let it
// self-clean when it finishes naturally.
function attachSource(source) {
    _activeSources.push(source);
    source.onended = () => {
        const i = _activeSources.indexOf(source);
        if (i >= 0) _activeSources.splice(i, 1);
        try { source.disconnect(); } catch { /* noop */ }
    };
}

async function ttsFetch(streaming, body, signal) {
    const res = await fetch(apiUrl(streaming ? '/tts?stream=1' : '/tts'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AuthService.getToken()}`,
            ...(streaming && { 'Accept': 'application/x-rohy-pcm-stream' })
        },
        body: JSON.stringify(body),
        signal
    });
    if (!res.ok) {
        let msg = `TTS request failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* not json */ }
        throw new Error(msg);
    }
    if (streaming) {
        const ctype = res.headers.get('Content-Type') || '';
        if (!ctype.includes('application/x-rohy-pcm-stream')) {
            throw new Error(`expected pcm-stream, got ${ctype}`);
        }
    }
    return res;
}

// Schedule one decoded AudioBuffer onto the session's running timeline cursor.
// Triggers onStart + the viseme tick loop on the very first chunk.
function scheduleChunk(session, audioCtx, analyser, audioBuffer) {
    if (session.aborted) return;
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const playbackRate = (session.pitch != null && session.pitch > 0) ? session.pitch : 1.0;
    source.playbackRate.value = playbackRate;
    source.connect(analyser);

    const startAt = Math.max(audioCtx.currentTime, session.nextStartTime);
    source.start(startAt);
    const playDuration = audioBuffer.duration / playbackRate;
    session.nextStartTime = startAt + playDuration;
    session.endTime = session.nextStartTime;
    attachSource(source);

    if (!session.startedFired) {
        session.startedFired = true;
        _started = true;
        session.onStart?.();
        const tick = () => {
            if (!_lipsync || session.aborted) return;
            _lipsync.processAudio();
            session.emit(_lipsync.viseme);
            _rafId = requestAnimationFrame(tick);
        };
        tick();
    }
}

// Synthesise + schedule one sentence. Tries Kokoro streaming first, falls
// back to Piper / Kokoro-non-streaming WAV per request. Each sentence is
// independent at the network layer; ordering is enforced by the caller's
// promise chain so audio plays in the order sentences were enqueued.
async function speakOneSentence(session, text) {
    if (session.aborted) return;
    const body = { text, voice: session.voice };
    if (session.rate != null) body.rate = session.rate;
    // Forward gender so the server can pick a gender-appropriate fallback
    // voice if the requested voice isn't in the active provider's catalogue.
    if (session.gender) body.gender = session.gender;

    let res;
    let stream = true;
    try {
        res = await ttsFetch(true, body, session.abort.signal);
    } catch (err) {
        if (err.name === 'AbortError') return;
        if (err.message?.startsWith('expected pcm-stream')) {
            stream = false;
            res = await ttsFetch(false, body, session.abort.signal);
        } else {
            throw err;
        }
    }

    const lipsync = await ensureLipsync();
    const { audioContext: audioCtx, analyser } = lipsync;

    // First chunk of the very first sentence anchors the timeline at "now".
    if (session.nextStartTime === 0) {
        session.nextStartTime = audioCtx.currentTime;
    }

    if (stream) {
        const sampleRateRef = { current: 24000 };
        const reader = res.body.getReader();
        try {
            for await (const pcmBytes of readPcmFrames(reader, sampleRateRef)) {
                if (session.aborted) return;
                const audioBuffer = int16BytesToAudioBuffer(audioCtx, pcmBytes, sampleRateRef.current);
                scheduleChunk(session, audioCtx, analyser, audioBuffer);
            }
        } finally {
            try { reader.releaseLock(); } catch { /* noop */ }
        }
    } else {
        const arrayBuffer = await res.arrayBuffer();
        if (session.aborted) return;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        if (session.aborted) return;
        scheduleChunk(session, audioCtx, analyser, audioBuffer);
    }
}

// Open a streaming speech session. Returned handle accepts sentences via
// enqueue(), each of which fires its own /tts request and gets scheduled
// onto the shared audio timeline. Call flush() when done to wait for all
// audio to drain and fire onEnd. cancel() aborts everything immediately.
function beginSpeechSession({ voice, rate, pitch, gender, onStart, onVisemes, onEnd, onError }) {
    teardown();  // cancel any prior session/single-shot

    const session = {
        aborted: false,
        startedFired: false,
        nextStartTime: 0,   // 0 = uninitialised; first scheduled chunk sets to currentTime
        endTime: 0,
        chain: Promise.resolve(),
        abort: new AbortController(),
        voice, rate, pitch, gender,
        emit: makeVisemeEmitter(onVisemes),
        onStart, onEnd, onError
    };
    _session = session;

    return {
        enqueue(text) {
            if (session.aborted) return;
            const trimmed = (text || '').trim();
            if (!trimmed) return;
            // Chain so sentences schedule in submission order, regardless of
            // which fetch finishes first. Errors in one sentence don't break
            // the chain — they're surfaced via onError and skipped.
            session.chain = session.chain
                .then(() => speakOneSentence(session, trimmed))
                .catch(err => {
                    if (err?.name === 'AbortError' || session.aborted) return;
                    console.error('TTS sentence failed:', err);
                    onError?.(err);
                });
        },

        async flush() {
            if (session.aborted) return;
            await session.chain;
            const audioCtx = _lipsync?.audioContext;
            if (audioCtx && session.endTime > audioCtx.currentTime && !session.aborted) {
                const remainingMs = (session.endTime - audioCtx.currentTime) * 1000;
                await new Promise(r => setTimeout(r, remainingMs + 80));
            }
            if (session.aborted || _session !== session) return;
            session.emit('viseme_sil');
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
            _started = false;
            _session = null;
            onEnd?.();
        },

        cancel() {
            session.aborted = true;
            try { session.abort.abort(); } catch { /* noop */ }
            teardown();
        }
    };
}

export const VoiceService = {
    isSttSupported() {
        return !!SR;
    },

    startListening({ lang, onResult, onError, onEnd }) {
        if (!SR) {
            onError?.(new Error('SpeechRecognition not supported in this browser'));
            return;
        }
        if (!lang || typeof lang !== 'string') {
            onError?.(new Error('lang is required (BCP-47 from voice settings)'));
            return;
        }
        this.stopListening();

        const rec = new SR();
        rec.lang = lang;
        rec.interimResults = true;
        rec.continuous = false;

        let finalT = '';
        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) finalT += r[0].transcript;
                else interim += r[0].transcript;
            }
            onResult?.({
                final: finalT.trim(),
                interim: interim.trim(),
                isFinal: !!finalT
            });
        };
        rec.onerror = (e) => onError?.(new Error(e.error || 'speech recognition error'));
        rec.onend = () => {
            _recognition = null;
            onEnd?.({ final: finalT.trim() });
        };

        _recognition = rec;
        try {
            rec.start();
        } catch (err) {
            _recognition = null;
            onError?.(err);
        }
    },

    stopListening() {
        if (_recognition) {
            try { _recognition.stop(); } catch { /* noop */ }
            _recognition = null;
        }
    },

    // Streaming session API for the LLM-token-stream → TTS path. Caller
    // calls .enqueue(sentence) as each LLM sentence completes, then .flush()
    // when the LLM stream ends. See module header.
    beginSpeechSession,

    // Single-shot speak. Sends the whole text in one TTS call. Wraps the
    // session API so there's still one audio code path.
    async speak({ text, voice, rate, pitch, gender, onStart, onVisemes, onEnd, onError }) {
        if (!text || typeof text !== 'string') {
            onError?.(new Error('text is required'));
            return;
        }
        if (!voice || typeof voice !== 'string') {
            onError?.(new Error('voice filename is required'));
            return;
        }
        const session = beginSpeechSession({ voice, rate, pitch, gender, onStart, onVisemes, onEnd, onError });
        session.enqueue(text);
        // flush() resolves after audio drains; we don't await it here so the
        // caller's `await speak()` returns once dispatch is in motion (matches
        // the pre-refactor behaviour). onEnd fires when audio actually ends.
        session.flush();
    },

    cancelSpeech() {
        teardown();
    },

    isSpeaking() {
        return _started && _activeSources.length > 0;
    }
};
