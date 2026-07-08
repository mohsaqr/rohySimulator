import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Square } from 'lucide-react';
import { VoiceService } from '../../services/voiceService';

// Voice-first input. Tap-to-toggle: press to start listening, press again to
// stop. Speech-recognition final result auto-sends. While the discussant is
// speaking back, the mic is suppressed so we don't capture our own audio.
//
// onListeningChange (optional): emitted whenever the listening flag or live
// interim transcript changes. Parent can use this to drive a subtitle band
// that captures both speakers (the user's live STT + the discussant's TTS).
export default function VoiceControl({ onSend, busy, speaking, sttLang = 'en-US', onListeningChange }) {
    const { t } = useTranslation('discussion');
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

    // Mirror listening + interim to the parent so the subtitle band can show
    // the user's words while they dictate.
    useEffect(() => {
        onListeningChange?.(listening, interim);
    }, [listening, interim, onListeningChange]);

    const start = () => {
        if (!supported || busy || speaking) return;
        finalRef.current = '';
        setInterim('');
        setListening(true);
        VoiceService.startListening({
            lang: sttLang,
            onResult: ({ final, interim: live, isFinal }) => {
                // In continuous mode the recognizer keeps streaming both
                // interim and successive final segments; finalT already
                // accumulates them in voiceService. We update the UI on
                // every callback but DO NOT stop on isFinal — the user
                // ends the session by tapping the button (or by the
                // discussant starting to speak via the speaking effect).
                if (live) setInterim(live);
                if (isFinal && final) {
                    finalRef.current = final;
                    setInterim(final);
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
                {t('voice_not_supported')}
            </div>
        );
    }

    const status = speaking
        ? t('status_speaking')
        : listening
            ? t('status_listening')
            : busy
                ? t('status_thinking')
                : t('status_tap_to_talk');

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={listening ? stop : start}
                disabled={busy || speaking}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${
                    listening
                        ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-200 animate-pulse'
                        : speaking
                            ? 'bg-indigo-300 text-white cursor-wait'
                            : busy
                                ? 'bg-slate-300 text-slate-500 cursor-wait'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white ring-2 ring-indigo-100 hover:ring-indigo-200'
                }`}
                aria-label={listening ? t('stop_listening') : t('start_listening')}
            >
                {listening
                    ? <Square className="w-7 h-7" />
                    : speaking
                        ? <MicOff className="w-8 h-8" />
                        : <Mic className="w-8 h-8" />}
            </button>
            <div className={`text-xs font-medium ${listening ? 'text-rose-300' : 'text-slate-400'}`}>
                {status}
            </div>
            {/* Interim transcript intentionally not rendered here — the
                DiscussionScreen subtitle band shows the live STT text. */}
        </div>
    );
}
