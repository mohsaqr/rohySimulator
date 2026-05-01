// Voice service for Stack T:
//   - Browser SpeechRecognition for STT
//   - Server TTS via /api/tts. Two response shapes are supported:
//       * audio/wav (Piper, or Kokoro non-streaming) — decoded once and played
//       * application/x-rohy-pcm-stream (Kokoro streaming) — sentence chunks
//         scheduled gaplessly so the first sentence starts playing while the
//         rest are still being synthesized
//   - wawa-lipsync drives a per-frame dominant viseme stream from the same
//     analyser node either path feeds into.

import { Lipsync } from 'wawa-lipsync';
import { apiUrl } from '../config/api.js';
import { AuthService } from './authService.js';

const SR = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

let _recognition = null;
let _lipsync = null;
let _activeSources = []; // array of AudioBufferSourceNode for streaming path
let _rafId = null;
let _started = false;
let _streamAbort = null;
// Tracks the AudioContext time at which the *next* incoming chunk should
// start playing. Reset by teardown(). With chain:true, consecutive speak()
// calls write into the same lipsync context and append after this mark.
let _nextStartTime = 0;
// Serializes per-sentence scheduling so chunks from sentence N+1 don't race
// chunks from sentence N for the same time slot. Each speak() awaits the
// chain before scheduling, but its fetch+SSE parsing runs in parallel.
let _scheduleChain = Promise.resolve();

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
    if (_streamAbort) {
        try { _streamAbort.abort(); } catch { /* noop */ }
        _streamAbort = null;
    }
    _lipsync = null;
    _started = false;
    _nextStartTime = 0;
    _scheduleChain = Promise.resolve();
}

// Build int16 PCM bytes into a Float32 AudioBuffer at the given sample rate.
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

// Read a stream of [4-byte LE length][N bytes pcm] frames from a fetch
// ReadableStream. Yields Uint8Array chunks. Stops when length=0 or stream ends.
async function* readPcmFrames(reader, headerSampleRateRef) {
    let buffer = new Uint8Array(0);
    let sampleRateRead = false;

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
    const dv0 = new DataView(buffer.buffer, buffer.byteOffset, 4);
    headerSampleRateRef.current = dv0.getUint32(0, true);
    buffer = buffer.slice(4);
    sampleRateRead = true;

    while (sampleRateRead) {
        if (!(await need(4))) return;
        const lenView = new DataView(buffer.buffer, buffer.byteOffset, 4);
        const frameLen = lenView.getUint32(0, true);
        buffer = buffer.slice(4);
        if (frameLen === 0) return; // end-of-stream marker
        if (!(await need(frameLen))) return;
        yield buffer.slice(0, frameLen);
        buffer = buffer.slice(frameLen);
    }
}

async function speakStreaming({ text, voice, rate, chain, onVisemes, onStart, onEnd }) {
    const abort = new AbortController();
    _streamAbort = abort;

    const body = { text, voice };
    if (rate !== undefined && rate !== null) body.rate = rate;

    // Kick off the fetch immediately so the server can start synthesizing
    // even if a previous sentence is still scheduling. The Promise resolves
    // when the response headers arrive.
    const fetchPromise = fetch(apiUrl('/tts?stream=1'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AuthService.getToken()}`,
            'Accept': 'application/x-rohy-pcm-stream'
        },
        body: JSON.stringify(body),
        signal: abort.signal
    }).then(async (res) => {
        if (!res.ok) {
            let msg = `TTS request failed (${res.status})`;
            try {
                const j = await res.json();
                if (j?.error) msg = j.error;
            } catch { /* noop */ }
            throw new Error(msg);
        }
        const ctype = res.headers.get('Content-Type') || '';
        if (!ctype.includes('application/x-rohy-pcm-stream')) {
            throw new Error(`expected pcm-stream, got ${ctype}`);
        }
        return res;
    });

    // Reserve our place in the schedule queue. We won't actually pull bytes
    // off the response until the previous sentence has finished scheduling.
    const myTurn = _scheduleChain.then(async () => {
        const res = await fetchPromise;

        if (!chain || !_lipsync) {
            _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
            const audioCtx = _lipsync.audioContext;
            const analyser = _lipsync.analyser;
            analyser.connect(audioCtx.destination);
            await audioCtx.resume();
        }
        const audioCtx = _lipsync.audioContext;
        const analyser = _lipsync.analyser;

        let firstChunk = true;
        let endTime = 0;
        const sampleRateRef = { current: 24000 };

        const tick = () => {
            if (!_lipsync) return;
            _lipsync.processAudio();
            const dominant = _lipsync.viseme;
            if (dominant) onVisemes?.({ [dominant]: 1 });
            _rafId = requestAnimationFrame(tick);
        };

        const reader = res.body.getReader();

        try {
            for await (const pcmBytes of readPcmFrames(reader, sampleRateRef)) {
                if (abort.signal.aborted) return;
                const audioBuffer = int16BytesToAudioBuffer(audioCtx, pcmBytes, sampleRateRef.current);
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(analyser);

                const now = audioCtx.currentTime;
                const startAt = Math.max(now, _nextStartTime);
                source.start(startAt);
                _nextStartTime = startAt + audioBuffer.duration;
                endTime = _nextStartTime;
                _activeSources.push(source);

                if (firstChunk) {
                    firstChunk = false;
                    if (!_started) {
                        _started = true;
                        onStart?.();
                        tick();
                    }
                }
            }
        } finally {
            try { reader.releaseLock(); } catch { /* noop */ }
        }

        if (firstChunk) {
            throw new Error('no audio chunks received');
        }

        if (!chain) {
            const remainingMs = Math.max(0, (endTime - audioCtx.currentTime) * 1000);
            setTimeout(() => {
                if (_streamAbort === abort) {
                    onVisemes?.({ viseme_sil: 1 });
                    teardown();
                    onEnd?.();
                }
            }, remainingMs + 80);
        }
    });

    // Catch errors so a single sentence failure doesn't poison the chain.
    _scheduleChain = myTurn.catch((err) => {
        console.warn('[VoiceService] schedule error', err);
    });
    return myTurn;
}

async function speakOneShotWav({ text, voice, rate, onVisemes, onStart, onEnd }) {
    const body = { text, voice };
    if (rate !== undefined && rate !== null) body.rate = rate;

    const res = await fetch(apiUrl('/tts'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AuthService.getToken()}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        let msg = `TTS request failed (${res.status})`;
        try {
            const j = await res.json();
            if (j?.error) msg = j.error;
        } catch { /* noop */ }
        throw new Error(msg);
    }

    const arrayBuffer = await res.arrayBuffer();

    _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
    const audioCtx = _lipsync.audioContext;
    const analyser = _lipsync.analyser;
    await audioCtx.resume();

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    _activeSources.push(source);

    const tick = () => {
        if (!_lipsync) return;
        _lipsync.processAudio();
        const dominant = _lipsync.viseme;
        if (dominant) onVisemes?.({ [dominant]: 1 });
        _rafId = requestAnimationFrame(tick);
    };

    source.onended = () => {
        onVisemes?.({ viseme_sil: 1 });
        teardown();
        onEnd?.();
    };

    _started = true;
    onStart?.();
    source.start();
    tick();
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

    async speak(opts) {
        // chain: true means "queue this after the current playback instead of
        // cancelling it" — used by voice mode to pipe successive sentences
        // from a streaming LLM response into TTS without gaps.
        const { chain, text, voice, onError } = opts;
        if (!chain) this.cancelSpeech();
        if (!text || typeof text !== 'string') {
            onError?.(new Error('text is required'));
            return;
        }
        if (!voice || typeof voice !== 'string') {
            onError?.(new Error('voice filename is required'));
            return;
        }
        try {
            // Try streaming first; if the server doesn't support it (Piper
            // path returns audio/wav directly), fall back to one-shot WAV.
            try {
                await speakStreaming(opts);
            } catch (streamErr) {
                if (streamErr.name === 'AbortError') return;
                if (streamErr.message?.startsWith('expected pcm-stream')) {
                    await speakOneShotWav(opts);
                } else {
                    throw streamErr;
                }
            }
        } catch (err) {
            teardown();
            onError?.(err);
        }
    },

    cancelSpeech() {
        teardown();
    },

    // Caller signals "no more chained sentences will be queued". We wait
    // until all queued sentences have finished SCHEDULING, then for the
    // last scheduled audio to finish PLAYING, then tear down.
    async finishSpeaking({ onVisemes, onEnd } = {}) {
        // Wait for every queued speak() to finish scheduling.
        const chainAtCall = _scheduleChain;
        try { await chainAtCall; } catch { /* noop */ }
        if (!_lipsync) { onEnd?.(); return; }
        const audioCtx = _lipsync.audioContext;
        const remainingMs = Math.max(0, (_nextStartTime - audioCtx.currentTime) * 1000);
        setTimeout(() => {
            onVisemes?.({ viseme_sil: 1 });
            teardown();
            onEnd?.();
        }, remainingMs + 80);
    },

    isSpeaking() {
        return _started && _activeSources.length > 0;
    }
};
