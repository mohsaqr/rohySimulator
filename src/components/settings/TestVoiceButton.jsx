import { useEffect, useRef, useState } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { ApiError, apiFetch } from '../../services/apiClient.js';

// Click-to-preview a voice. Hits /api/tts with a fixed phrase, decodes the
// returned audio/wav, plays it once. Provider is sent as a query override so
// admins can audition voices without switching the platform's active TTS
// engine. Designed to drop in next to any voice picker.
//
// Props:
//   voice    — voice id (Piper .onnx filename, Kokoro slug, OpenAI voice
//              name, or Google voice name)
//   provider — 'piper' | 'kokoro' | 'openai' | 'google'
//   rate     — optional speech rate (defaults to platform value server-side)
//   pitch    — optional provider pitch in semitones (Google supports this)
//   text     — optional sample phrase (sensible default below)
//   size     — 'sm' (24px button, default) | 'md' (32px)

const DEFAULT_PHRASE = 'Hello, this is how I sound when I speak with you during the simulation.';

export default function TestVoiceButton({
    voice,
    provider,
    rate,
    pitch,
    text = DEFAULT_PHRASE,
    size = 'sm',
    title,
    disabled = false
}) {
    const [state, setState] = useState('idle');  // 'idle' | 'loading' | 'playing'
    const [error, setError] = useState(null);
    const audioRef = useRef(null);
    const abortRef = useRef(null);

    // Stop any in-flight playback when the component unmounts (e.g. settings
    // tab swap) or when the voice changes — otherwise a stale clip from the
    // previous voice keeps playing while the user is auditioning a new one.
    useEffect(() => {
        return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [voice, provider]);

    function stop() {
        if (audioRef.current) {
            try { audioRef.current.pause(); } catch { /* noop */ }
            try { URL.revokeObjectURL(audioRef.current.src); } catch { /* noop */ }
            audioRef.current = null;
        }
        if (abortRef.current) {
            try { abortRef.current.abort(); } catch { /* noop */ }
            abortRef.current = null;
        }
        setState('idle');
    }

    async function play() {
        if (!voice || !provider || state !== 'idle' || disabled) return;
        setError(null);
        setState('loading');
        const abort = new AbortController();
        abortRef.current = abort;

        try {
            const body = { text, voice };
            if (rate != null) body.rate = rate;
            if (pitch != null) body.pitch = pitch;
            let blob;
            try {
                blob = await apiFetch(`/tts?provider=${encodeURIComponent(provider)}`, {
                    method: 'POST',
                    json: body,
                    signal: abort.signal,
                    parseAs: 'blob',
                });
            } catch (err) {
                if (err instanceof ApiError) {
                    // If the server gave us an explicit error string in the
                    // body, surface it; otherwise fall back to a stable
                    // "(status)" form so users see the failure cause.
                    const serverMsg = err.body?.error || err.body?.message;
                    throw new Error(serverMsg || `TTS preview failed (${err.status})`);
                }
                throw err;
            }
            if (abort.signal.aborted) return;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => {
                URL.revokeObjectURL(url);
                if (audioRef.current === audio) audioRef.current = null;
                setState('idle');
            };
            audio.onerror = () => {
                URL.revokeObjectURL(url);
                setError('Audio decode failed');
                setState('idle');
            };
            await audio.play();
            setState('playing');
        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(err.message || 'Preview failed');
            }
            setState('idle');
        } finally {
            if (abortRef.current === abort) abortRef.current = null;
        }
    }

    function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        if (state === 'idle') play();
        else stop();
    }

    const dim = size === 'md' ? 'w-8 h-8' : 'w-6 h-6';
    const icon = size === 'md' ? 'w-4 h-4' : 'w-3 h-3';
    const Icon = state === 'loading' ? Loader2 : state === 'playing' ? Square : Play;
    const titleAttr = title ?? (
        state === 'loading' ? 'Loading…' :
        state === 'playing' ? 'Stop preview' :
        `Preview ${voice}`
    );

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled || !voice || !provider}
            title={error || titleAttr}
            className={`${dim} flex items-center justify-center rounded-full transition-colors ${
                error
                    ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60'
                    : state === 'playing'
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200 disabled:opacity-40 disabled:hover:bg-neutral-700'
            }`}
        >
            <Icon className={`${icon} ${state === 'loading' ? 'animate-spin' : ''}`} />
        </button>
    );
}
