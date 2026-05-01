// Voice service for Stack T:
//   - Browser SpeechRecognition for STT
//   - Server Piper for TTS (POST /api/tts → audio/wav)
//   - wawa-lipsync drives a per-frame dominant viseme stream
//
// No defaults here. The caller passes language, voice filename, rate, and
// pitch; all of those originate from /api/platform-settings/voice.

import { Lipsync } from 'wawa-lipsync';
import { apiUrl } from '../config/api.js';
import { AuthService } from './authService.js';

const SR = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

let _recognition = null;
let _audio = null;
let _audioUrl = null;
let _lipsync = null;
let _rafId = null;
let _started = false;

function teardown() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    if (_audio) {
        try { _audio.pause(); } catch { /* noop */ }
        try { _audio.removeAttribute('src'); _audio.load(); } catch { /* noop */ }
        _audio = null;
    }
    if (_audioUrl) {
        try { URL.revokeObjectURL(_audioUrl); } catch { /* noop */ }
        _audioUrl = null;
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
        // Cancel any in-flight playback before starting a new one.
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

            const blob = await res.blob();
            _audioUrl = URL.createObjectURL(blob);

            const audio = new Audio(_audioUrl);
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            _audio = audio;

            // wawa-lipsync owns its own AudioContext and connects the
            // MediaElementSource itself; we must not pre-connect the audio.
            _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
            _lipsync.connectAudio(audio);

            const tick = () => {
                if (!_lipsync || !_audio) return;
                _lipsync.processAudio();
                const dominant = _lipsync.viseme;       // e.g. "viseme_aa" or undefined
                if (dominant) {
                    // Emit weighted map with dominant=1; the avatar handles decay.
                    onVisemes?.({ [dominant]: 1 });
                }
                _rafId = requestAnimationFrame(tick);
            };

            audio.onplay = () => {
                if (_started) return;
                _started = true;
                onStart?.();
                tick();
            };
            audio.onended = () => {
                onVisemes?.({ viseme_sil: 1 });
                teardown();
                onEnd?.();
            };
            audio.onerror = () => {
                const err = new Error('audio playback failed');
                teardown();
                onError?.(err);
            };

            await audio.play();
        } catch (err) {
            teardown();
            onError?.(err);
        }
    },

    cancelSpeech() {
        teardown();
    },

    isSpeaking() {
        return _started && !!_audio;
    }
};
