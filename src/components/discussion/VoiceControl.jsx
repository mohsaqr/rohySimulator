import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
//
// Three additive props serve the 3D room, which uses this same control so
// there is one microphone in Rohy rather than two that drift apart. All
// three default to the debrief behaviour, which is unchanged:
//
//   onInterrupt  Barge-in. When given, the button stays live while the other
//                speaker talks; tapping it silences them FIRST and then
//                opens the mic. The debrief has no barge-in (the discussant
//                should finish its point), so it passes nothing and keeps
//                the disabled-while-speaking behaviour.
//   variant      'discussion' (indigo, on a light panel) or 'room' (teal, on
//                the dark 3D room). Palette only — same control, same states.
//   ref          Exposes toggle(), so a room-level push-to-talk key can drive
//                the same state machine the button drives instead of forking
//                a second one.
const VoiceControl = forwardRef(function VoiceControl({
    onSend,
    busy,
    speaking,
    sttLang = 'en-US',
    onListeningChange,
    onInterrupt = null,
    variant = 'discussion',
    unsupportedText = null,
}, ref) {
    const { t } = useTranslation('discussion');
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [supported] = useState(() => VoiceService.isSttSupported());
    const finalRef = useRef('');

    useEffect(() => () => VoiceService.stopListening(), []);

    // Auto-stop the mic if the discussant starts speaking, to avoid feedback.
    // A barge-in caller silences the speaker itself before opening the mic,
    // so this guard would otherwise close the mic it just opened.
    useEffect(() => {
        if (speaking && listening && !onInterrupt) {
            VoiceService.stopListening();
        }
    }, [speaking, listening, onInterrupt]);

    // Mirror listening + interim to the parent so the subtitle band can show
    // the user's words while they dictate.
    useEffect(() => {
        onListeningChange?.(listening, interim);
    }, [listening, interim, onListeningChange]);

    const start = () => {
        if (!supported || busy) return;
        // Without barge-in the caller wants the speaker to finish; with it,
        // the learner's tap outranks the patient's sentence.
        if (speaking) {
            if (!onInterrupt) return;
            onInterrupt();
        }
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

    const toggle = () => (listening ? stop() : start());

    // One state machine, two ways in: the button and (in the 3D room) a
    // push-to-talk key. The key drives this handle rather than a copy.
    // No dep array: the handle closes over listening/speaking/busy, so it is
    // rebuilt each render rather than handing a key a stale toggle.
    useImperativeHandle(ref, () => ({ toggle, listening }));

    if (!supported) {
        // The debrief's own wording points at its type-instead button; a
        // caller without one passes its own (already translated) sentence
        // rather than sending the learner looking for a button.
        return (
            <div className="text-center text-sm text-slate-400 italic px-4">
                {unsupportedText ?? t('voice_not_supported')}
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

    // Palette only. The room sits on black glass, so its resting state is a
    // rimmed dark disc rather than a filled indigo one; listening and
    // speaking read the same in both.
    const idle = variant === 'room'
        ? 'bg-neutral-950/85 text-teal-200 ring-2 ring-teal-500/40 backdrop-blur hover:text-white hover:ring-teal-400/70'
        : 'bg-indigo-600 hover:bg-indigo-700 text-white ring-2 ring-indigo-100 hover:ring-indigo-200';
    const waiting = variant === 'room'
        ? 'bg-neutral-950/85 text-teal-300/60 ring-2 ring-teal-500/20 backdrop-blur cursor-wait'
        : 'bg-indigo-300 text-white cursor-wait';
    const thinking = variant === 'room'
        ? 'bg-neutral-950/85 text-neutral-500 ring-2 ring-neutral-700 backdrop-blur cursor-wait'
        : 'bg-slate-300 text-slate-500 cursor-wait';

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={toggle}
                disabled={busy || (speaking && !onInterrupt)}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${
                    listening
                        ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-200 animate-pulse'
                        : speaking
                            ? waiting
                            : busy
                                ? thinking
                                : idle
                }`}
                aria-label={listening ? t('stop_listening') : t('start_listening')}
            >
                {listening
                    ? <Square className="w-7 h-7" />
                    : speaking && !onInterrupt
                        ? <MicOff className="w-8 h-8" />
                        : <Mic className="w-8 h-8" />}
            </button>
            <div className={`text-xs font-medium ${
                listening
                    ? 'text-rose-300'
                    : variant === 'room' ? 'text-neutral-400' : 'text-slate-400'
            }`}>
                {status}
            </div>
            {/* Interim transcript intentionally not rendered here — the
                DiscussionScreen subtitle band shows the live STT text. */}
        </div>
    );
});

export default VoiceControl;
