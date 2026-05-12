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
// Rate is the only client-side playback tempo control. Pitch is forwarded to
// providers that support it server-side (Google pitch in semitones) so pitch
// and speed do not couple in the browser.

import { Lipsync } from 'wawa-lipsync';
import { apiFetch } from './apiClient.js';
import EventLogger from './eventLogger.js';

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
        // 2026-05-12 — fire the dying session's onEnd so callers that set
        // `speaking=true` in onStart always get a matching `speaking=false`.
        // Without this, a second beginSpeechSession() (or a cancel()) would
        // silently abort the previous session and the "Patient speaking…"
        // banner would stay stuck on while the mic stayed disabled. onEnd
        // is idempotent at every known callsite (setSpeaking(false)), so
        // firing it here even when flush() also fires it later is safe.
        const dying = _session;
        _session.aborted = true;
        try { _session.abort.abort(); } catch { /* noop */ }
        _session = null;
        if (dying.onEnd && !dying._endFired) {
            dying._endFired = true;
            try { dying.onEnd(); } catch (err) { console.warn('[VoiceService] teardown onEnd threw:', err); }
        }
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
//
// MAX_PCM_FRAME_BYTES caps a single frame so a corrupt/hostile uint32 length
// can't make `need()` allocate gigabytes and OOM the tab. Kokoro chunks are
// per-sentence at 24 kHz int16 mono, so 1s ≈ 48 KB and even a long sentence
// stays well under 1 MB. 2 MB is generous headroom.
const MAX_PCM_FRAME_BYTES = 2 * 1024 * 1024;

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
        if (frameLen > MAX_PCM_FRAME_BYTES) {
            throw new Error(`PCM frame too large (${frameLen} bytes); aborting stream`);
        }
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

// Runtime wire-capture for the diagnostic bar. The static resolver tells us
// what voice the runtime *would* play; this captures what was *actually* sent.
// The previous orchestrator was scolded for relying on static analysis when a
// user reported a wrong voice — this bridge closes that gap so future "I hear
// the wrong voice" reports can be triaged against the literal payload, not a
// resolver prediction.
//
// We keep a small ring buffer (last MAX_WIRE_HISTORY requests) so the user can
// see whether the voice changed mid-stream — a single "last" payload is
// misleading if sentence-1 used voice X and sentence-5 used voice Y. Each
// entry has a stable `id` for replay/audition.
let _lastTtsRequest = null;
const _wireHistory = [];
const MAX_WIRE_HISTORY = 12;
let _wireIdCounter = 0;

export function getLastTtsRequest() {
    return _lastTtsRequest;
}

export function getRecentTtsRequests() {
    // Newest first.
    return _wireHistory.slice().reverse();
}

function emitTtsRequest(detail) {
    _lastTtsRequest = detail;
    // Update or insert into the ring buffer keyed by sentAt+id. A request
    // emits multiple times across its lifecycle (pending → ok / error /
    // aborted); the buffer should reflect the latest known state for that
    // single request, not duplicate it.
    const existingIdx = _wireHistory.findIndex(w => w.id === detail.id);
    if (existingIdx >= 0) {
        _wireHistory[existingIdx] = detail;
    } else {
        _wireHistory.push(detail);
        if (_wireHistory.length > MAX_WIRE_HISTORY) _wireHistory.shift();
    }
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('rohy:tts-request', { detail })); }
        catch { /* CustomEvent may be polyfilled or restricted; ignore */ }
    }
}

// Audition a captured wire payload by re-firing /api/tts with the literal
// recorded body. It deliberately uses ttsFetch + attachSource so diagnostic
// playback is visible in the wire history and cancellable by shared teardown.
export async function auditionWirePayload(wire, opts = {}) {
    if (!wire?.voice || !wire?.provider) {
        throw new Error('cannot audition: wire entry missing voice or provider');
    }
    if (!wire.textPreview && !wire.text) {
        throw new Error('cannot audition: wire entry missing text');
    }
    teardown();
    const audioCtx = (await ensureLipsync()).audioContext;
    const text = wire.text || wire.textPreview;
    // Use a non-streaming WAV request so we get a single decodable blob; this
    // is the cheapest path for an audition, no PCM framing ceremony needed.
    const res = await ttsFetch(false, {
        text,
        voice: opts.voice ?? wire.voice,
        provider: opts.provider ?? wire.provider,
        ...(wire.rate != null && { rate: wire.rate }),
        ...(wire.pitch != null && { pitch: wire.pitch }),
        ...(wire.gender && { gender: wire.gender })
    });
    const buf = await res.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(buf.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(audioCtx.destination);
    source.start();
    attachSource(source);
    // Return a handle so the bar can stop playback if the user clicks again.
    return {
        stop: () => { try { source.stop(); } catch { /* noop */ } },
        durationSec: decoded.duration
    };
}

async function ttsFetch(streaming, body, signal) {
    const sentAt = Date.now();
    const id = ++_wireIdCounter;
    const fullText = typeof body?.text === 'string' ? body.text : '';
    const textPreview = fullText.length > 60 ? `${fullText.slice(0, 57)}…` : fullText;
    const wire = {
        id,
        sentAt,
        streaming,
        voice: body?.voice ?? null,
        provider: body?.provider ?? null,
        rate: body?.rate ?? null,
        pitch: body?.pitch ?? null,
        gender: body?.gender ?? null,
        textChars: fullText.length,
        textPreview,
        // Keep the full text in-memory only — never logged. Used by the
        // audition button so the bar can replay the literal sentence.
        text: fullText,
        status: 'pending',
        httpStatus: null,
        error: null,
        durationMs: null
    };
    emitTtsRequest(wire);

    try {
        const res = await apiFetch(streaming ? '/tts?stream=1' : '/tts', {
            method: 'POST',
            json: body,
            headers: streaming ? { Accept: 'application/x-rohy-pcm-stream' } : {},
            signal,
            parseAs: 'response',
        });
        if (!res.ok) {
            // Surface the upstream cause (Google/OpenAI/Piper error message)
            // instead of just "(502)" — that opaque fallback was masking
            // quota/region/voice failures and leaving users with nothing
            // actionable. Keep the status code in parens for telemetry.
            let detail = '';
            try {
                const j = await res.json();
                if (j?.error) detail = typeof j.error === 'string' ? j.error : (j.error?.message || JSON.stringify(j.error));
            } catch {
                try { detail = (await res.text()).slice(0, 200); } catch { /* nothing usable */ }
            }
            const msg = detail
                ? `TTS failed (${res.status}): ${detail}`
                : `TTS request failed (${res.status})`;
            emitTtsRequest({ ...wire, id, status: 'error', httpStatus: res.status, error: msg, durationMs: Date.now() - sentAt });
            throw new Error(msg);
        }
        if (streaming) {
            const ctype = res.headers.get('Content-Type') || '';
            if (!ctype.includes('application/x-rohy-pcm-stream')) {
                const err = `expected pcm-stream, got ${ctype}`;
                emitTtsRequest({ ...wire, status: 'error', httpStatus: res.status, error: err, durationMs: Date.now() - sentAt });
                throw new Error(err);
            }
        }
        emitTtsRequest({ ...wire, status: 'ok', httpStatus: res.status, durationMs: Date.now() - sentAt });
        return res;
    } catch (err) {
        if (err?.name === 'AbortError') {
            emitTtsRequest({ ...wire, status: 'aborted', durationMs: Date.now() - sentAt });
        } else if (_lastTtsRequest?.id === id && _lastTtsRequest?.status === 'pending') {
            // Network/transport failure before we got a response.
            emitTtsRequest({ ...wire, status: 'error', error: err?.message || String(err), durationMs: Date.now() - sentAt });
        }
        throw err;
    }
}

// Schedule one decoded AudioBuffer onto the session's running timeline cursor.
// Triggers onStart + the viseme tick loop on the very first chunk.
function scheduleChunk(session, audioCtx, analyser, audioBuffer) {
    if (session.aborted) return;
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = 1.0;
    source.connect(analyser);

    const startAt = Math.max(audioCtx.currentTime, session.nextStartTime);
    source.start(startAt);
    const playDuration = audioBuffer.duration;
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
    if (session.pitch != null) body.pitch = session.pitch;
    // Forward gender so the server can pick a gender-appropriate fallback
    // voice if the requested voice isn't in the active provider's catalogue.
    if (session.gender) body.gender = session.gender;
    // Provider override — when the caller explicitly named an engine
    // (eg. settings preview), forward it so the server doesn't silently
    // fall through to the platform default.
    if (session.provider) body.provider = session.provider;

    let res;
    let stream = session.provider !== 'piper';
    if (stream) {
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
    } else {
        res = await ttsFetch(false, body, session.abort.signal);
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
function beginSpeechSession({ voice, rate, pitch, gender, provider, onStart, onVisemes, onEnd, onError }) {
    teardown();  // cancel any prior session/single-shot

    const session = {
        aborted: false,
        startedFired: false,
        nextStartTime: 0,   // 0 = uninitialised; first scheduled chunk sets to currentTime
        endTime: 0,
        chain: Promise.resolve(),
        abort: new AbortController(),
        voice, rate, pitch, gender, provider,
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
            // 2026-05-12 — guarantee onEnd fires. Previously the two early-
            // return paths (session aborted OR _session !== session) bailed
            // without notifying the caller; whoever had setSpeaking(true)
            // in onStart was left with no matching false. The fireEnd helper
            // is idempotent via session._endFired so it's safe alongside
            // teardown()'s own onEnd fire.
            const fireEnd = () => {
                if (session._endFired) return;
                session._endFired = true;
                try { onEnd?.(); } catch (err) { console.warn('[VoiceService] flush onEnd threw:', err); }
            };
            if (session.aborted) {
                fireEnd();
                return;
            }
            // Watchdog: cap the wait on `session.chain` so a server-side
            // hang (a /tts route that holds the connection without writing
            // an EOF frame, an LLM stream that never closes, etc.) can't
            // strand the UI in "speaking=true" forever. The cap is generous
            // (90s) — typical patient replies finish in under 15s; this is
            // the last-resort escape valve, not a normal-path timer.
            const chainWithWatchdog = Promise.race([
                session.chain,
                new Promise((_, reject) => {
                    session._watchdogId = setTimeout(
                        () => reject(new Error('flush watchdog (90s) — TTS chain did not resolve')),
                        90_000,
                    );
                }),
            ]).finally(() => {
                if (session._watchdogId) {
                    clearTimeout(session._watchdogId);
                    session._watchdogId = null;
                }
            });
            try {
                await chainWithWatchdog;
            } catch (err) {
                console.warn('[VoiceService] flush watchdog:', err.message);
                // Abort any in-flight TTS fetches that may have been holding
                // the chain open, then fall through to fire onEnd.
                try { session.abort.abort(); } catch { /* noop */ }
                session.aborted = true;
                fireEnd();
                return;
            }
            const audioCtx = _lipsync?.audioContext;
            if (audioCtx && session.endTime > audioCtx.currentTime && !session.aborted) {
                const remainingMs = (session.endTime - audioCtx.currentTime) * 1000;
                await new Promise(r => setTimeout(r, remainingMs + 80));
            }
            // The "_session !== session" case means a newer session took
            // over while we were awaiting. The newer session will fire its
            // own onEnd; we still fire ours so the original caller's
            // speaking=true / speaking=false stays balanced.
            if (session.aborted || _session !== session) {
                fireEnd();
                return;
            }
            session.emit('viseme_sil');
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
            _started = false;
            _session = null;
            EventLogger.ttsPlayed({
                voice: session.voice || null,
                provider: session.provider || null,
            });
            fireEnd();
        },

        cancel() {
            session.aborted = true;
            try { session.abort.abort(); } catch { /* noop */ }
            // teardown() now fires onEnd for the dying session, but only if
            // _session points at it. If this session has already been
            // displaced (rare race), fire it here so the cancel caller's
            // speaking=true gets its balancing false.
            if (_session !== session && !session._endFired) {
                session._endFired = true;
                try { onEnd?.(); } catch (err) { console.warn('[VoiceService] cancel onEnd threw:', err); }
            }
            teardown();
        }
    };
}

export const VoiceService = {
    isSttSupported() {
        return !!SR;
    },

    startListening({ lang, onResult, onError, onEnd, continuous = true }) {
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
        // continuous=true keeps the mic open across pauses so a learner can
        // think mid-sentence without the recognizer ending the session.
        // The Web Speech API default is false (built for one-shot voice
        // commands); for conversational UX we want the opposite. Callers can
        // still opt out by passing continuous: false.
        rec.continuous = continuous;

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
            EventLogger.sttResult({
                finalLength: finalT.trim().length,
                interimLength: interim.trim().length,
                isFinal: !!finalT,
                lang: rec.lang,
            });
        };
        rec.onerror = (e) => {
            const message = e.error || 'speech recognition error';
            EventLogger.sttError(message, { lang: rec.lang });
            onError?.(new Error(message));
        };
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
    async speak({ text, voice, rate, pitch, gender, provider, onStart, onVisemes, onEnd, onError }) {
        if (!text || typeof text !== 'string') {
            onError?.(new Error('text is required'));
            return;
        }
        if (!voice || typeof voice !== 'string') {
            onError?.(new Error('voice filename is required'));
            return;
        }
        const session = beginSpeechSession({ voice, rate, pitch, gender, provider, onStart, onVisemes, onEnd, onError });
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
