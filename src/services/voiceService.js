// Voice service for Stack T:
//   - Browser SpeechRecognition for STT
//   - Server Piper for TTS (POST /api/tts → audio/wav)
//   - wawa-lipsync drives a per-frame dominant viseme stream
//
// We bypass wawa's connectAudio() (which uses createMediaElementSource on a
// blob: URL — broken on some Chrome versions: audio plays but the analyser
// sees zeros). Instead we decode the WAV ourselves and feed an
// AudioBufferSourceNode straight into wawa's internal analyser. That's the
// canonical Web Audio path and works reliably.

import { Lipsync } from 'wawa-lipsync';
import { apiUrl } from '../config/api.js';
import { AuthService } from './authService.js';

const SR = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

let _recognition = null;
let _lipsync = null;
let _bufferSource = null;
let _rafId = null;
let _started = false;

function teardown() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    if (_bufferSource) {
        try { _bufferSource.stop(); } catch { /* noop, already stopped */ }
        try { _bufferSource.disconnect(); } catch { /* noop */ }
        _bufferSource = null;
    }
    _lipsync = null;
    _started = false;
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

    async speak({ text, voice, rate, pitch, onVisemes, onStart, onEnd, onError }) {
        this.cancelSpeech();

        if (!text || typeof text !== 'string') {
            onError?.(new Error('text is required'));
            return;
        }
        if (!voice || typeof voice !== 'string') {
            onError?.(new Error('voice filename is required'));
            return;
        }

        try {
            const body = { text, voice };
            if (rate !== undefined && rate !== null) body.rate = rate;
            if (pitch !== undefined && pitch !== null) body.pitch = pitch;

            const res = await fetch(apiUrl('/tts'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AuthService.getToken()}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                let errMsg = `TTS request failed (${res.status})`;
                try {
                    const j = await res.json();
                    if (j?.error) errMsg = j.error;
                } catch { /* noop */ }
                throw new Error(errMsg);
            }

            const arrayBuffer = await res.arrayBuffer();

            // Build the lipsync analyser — wawa creates its own AudioContext
            // and analyser internally. We reuse those rather than calling
            // connectAudio (which expects an HTMLMediaElement).
            _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
            const audioCtx = _lipsync.audioContext;
            const analyser = _lipsync.analyser;
            await audioCtx.resume();

            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;

            // Single chain: source → analyser → destination. The analyser is
            // a transparent observer node; audio passes through unchanged on
            // its way to the speakers, but the analyser also gets to read
            // frequency data each frame.
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
            _bufferSource = source;

            const tick = () => {
                if (!_lipsync || !_bufferSource) return;
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
        } catch (err) {
            teardown();
            onError?.(err);
        }
    },

    cancelSpeech() {
        teardown();
    },

    isSpeaking() {
        return _started && !!_bufferSource;
    }
};
