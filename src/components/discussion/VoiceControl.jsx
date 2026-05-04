import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';
import { VoiceService } from '../../services/voiceService';

// Voice-first input. Tap-to-toggle: press to start listening, press again to
// stop. Speech-recognition final result auto-sends. While the discussant is
// speaking back, the mic is suppressed so we don't capture our own audio.
export default function VoiceControl({ onSend, busy, speaking, sttLang = 'en-US' }) {
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [supported] = useState(() => VoiceService.isSttSupported());
    const finalRef = useRef('');

    useEffect(() => () => VoiceService.stopListening(), []);

    // Auto-stop the mic if the discussant starts speaking, to avoid feedback.
    useEffect(() => {
        if (speaking && listening) {
            VoiceService.stopListening();
        }
    }, [speaking, listening]);

    const start = () => {
        if (!supported || busy || speaking) return;
        finalRef.current = '';
        setInterim('');
        setListening(true);
        VoiceService.startListening({
            lang: sttLang,
            onResult: ({ final, interim: live, isFinal }) => {
                if (live) setInterim(live);
                if (isFinal && final) {
                    finalRef.current = final;
                    setInterim(final);
                    VoiceService.stopListening();
                }
            },
            onError: (err) => {
                console.warn('[VoiceControl] STT error:', err.message);
                setListening(false);
                setInterim('');
            },
            onEnd: ({ final }) => {
                setListening(false);
                const sent = finalRef.current || final;
                finalRef.current = '';
                setInterim('');
                if (sent) onSend?.(sent);
            },
        });
    };

    const stop = () => {
        VoiceService.stopListening();
    };

    if (!supported) {
        return (
            <div className="text-center text-sm text-slate-400 italic px-4">
                Voice input isn't supported in this browser. Use the type button below.
            </div>
        );
    }

    const status = speaking
        ? 'Discussant is speaking…'
        : listening
            ? 'Listening — talk now'
            : busy
                ? 'Thinking…'
                : 'Tap to talk';

    return (
        <div className="flex flex-col items-center gap-3">
            <button
                type="button"
                onClick={listening ? stop : start}
                disabled={busy || speaking}
                className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${
                    listening
                        ? 'bg-rose-500 hover:bg-rose-600 text-white ring-8 ring-rose-200 animate-pulse'
                        : speaking
                            ? 'bg-indigo-300 text-white cursor-wait'
                            : busy
                                ? 'bg-slate-300 text-slate-500 cursor-wait'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white ring-4 ring-indigo-100 hover:ring-indigo-200'
                }`}
                aria-label={listening ? 'Stop listening' : 'Start listening'}
            >
                {listening
                    ? <Square className="w-10 h-10" />
                    : speaking
                        ? <MicOff className="w-12 h-12" />
                        : <Mic className="w-12 h-12" />}
            </button>
            <div className={`text-sm font-medium ${listening ? 'text-rose-300' : 'text-slate-300'}`}>
                {status}
            </div>
            {interim && (
                <div className="max-w-md px-4 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm italic text-center">
                    "{interim}"
                </div>
            )}
        </div>
    );
}
