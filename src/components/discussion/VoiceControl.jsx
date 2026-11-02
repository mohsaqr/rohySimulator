import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Square } from 'lucide-react';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';
import { useHandsFreePreference } from '../voice/useHandsFreePreference';
import { VoiceTurnButton, VoiceTurnStatus, HandsFreeToggle } from '../voice/VoiceTurnControl';

// The round microphone of the debrief and the Bedside (3D) room, on the same
// voice-conversation engine as the patient chat and the phone
// (useVoiceConversation). Push-to-talk: press to start listening, press
// again to stop and send. Hands-free (the learner's one Hands-free
// preference): the turn ends on a pause and the mic reopens after the reply.
//
// onSend(text) may return a promise that settles when the reply is over —
// its audio finished, or at once when nothing is spoken. Hands-free reopens
// the mic on it; a caller that returns nothing reopens as soon as the reply
// stops loading and speaking.
//
// onListeningChange (optional): emitted whenever the listening flag or live
// interim transcript changes. Parent can use this to drive a subtitle band
// that captures both speakers (the user's live STT + the other side's TTS).
//
//   onInterrupt  Barge-in. When given, the learner may cut the other speaker
//                off: the button stays live while they talk and tapping it
//                silences them FIRST, then opens the mic; hands-free, talking
//                over them does the same. The debrief passes nothing — the
//                discussant should finish its point — so the button is
//                disabled while it speaks, and a mic open when it starts is
//                closed so we never record its audio.
//   getSpokenText  What the other side is saying now: hands-free tells the
//                learner's words from that echo (barge-in needs it).
//   speakingLabel  The hands-free status while the other side speaks.
//   variant      'discussion' (indigo, on a light panel) or 'room' (teal, on
//                the dark 3D room). Palette only — same control, same states.
//   ref          Exposes toggle(), so a room-level push-to-talk key can drive
//                the same engine the button drives instead of forking it.
const VoiceControl = forwardRef(function VoiceControl({
    onSend,
    busy,
    speaking,
    sttLang = 'en-US',
    onListeningChange,
    onInterrupt = null,
    getSpokenText,
    speakingLabel = null,
    variant = 'discussion',
    unsupportedText = null,
}, ref) {
    const { t } = useTranslation('discussion');
    const { mode } = useHandsFreePreference();
    const conversation = useVoiceConversation({
        enabled: true,
        mode,
        lang: sttLang,
        loading: Boolean(busy),
        speaking: Boolean(speaking),
        interruptible: Boolean(onInterrupt),
        cancelSpeech: onInterrupt ?? undefined,
        getSpokenText,
        send: (text) => onSend?.(text),
        onError: (code) => console.warn('[VoiceControl] STT error:', code),
    });
    const { listening, interim, supported } = conversation;

    // Mirror listening + interim to the parent so the subtitle band can show
    // the user's words while they dictate.
    useEffect(() => {
        onListeningChange?.(listening, interim);
    }, [listening, interim, onListeningChange]);

    // One engine, two ways in: the button and (in the 3D room) a
    // push-to-talk key. The key drives this handle rather than a copy.
    useImperativeHandle(ref, () => ({ toggle: conversation.tap, listening }), [conversation.tap, listening]);

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
    const room = variant === 'room';
    const idle = room
        ? 'bg-neutral-950/85 text-teal-200 ring-2 ring-teal-500/40 backdrop-blur hover:text-white hover:ring-teal-400/70'
        : 'bg-indigo-600 hover:bg-indigo-700 text-white ring-2 ring-indigo-100 hover:ring-indigo-200';
    const waiting = room
        ? 'bg-neutral-950/85 text-teal-300/60 ring-2 ring-teal-500/20 backdrop-blur cursor-wait'
        : 'bg-indigo-300 text-white cursor-wait';
    const thinking = room
        ? 'bg-neutral-950/85 text-neutral-500 ring-2 ring-neutral-700 backdrop-blur cursor-wait'
        : 'bg-slate-300 text-slate-500 cursor-wait';
    const statusColour = room ? 'text-neutral-400' : 'text-slate-400';

    return (
        <div className="flex flex-col items-center gap-2">
            <VoiceTurnButton
                conversation={conversation}
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
            </VoiceTurnButton>
            {conversation.mode === 'handsFree' ? (
                <VoiceTurnStatus
                    conversation={conversation}
                    // The debrief's discussant is not interrupted, so its
                    // line does not invite the learner to.
                    speakingLabel={speakingLabel ?? (onInterrupt ? null : t('status_speaking'))}
                    className={`text-xs font-medium text-center ${listening ? 'text-rose-300' : statusColour}`}
                />
            ) : (
                <div className={`text-xs font-medium ${listening ? 'text-rose-300' : statusColour}`}>
                    {status}
                </div>
            )}
            <HandsFreeToggle
                className={(on) => `rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                    on
                        ? (room ? 'bg-teal-500/20 text-teal-100 ring-1 ring-teal-400/60' : 'bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-300/60')
                        : (room ? 'bg-neutral-950/70 text-neutral-400 ring-1 ring-neutral-700 hover:text-neutral-200' : 'bg-slate-700/60 text-slate-300 ring-1 ring-slate-600 hover:text-white')
                }`}
            />
            {/* Interim transcript intentionally not rendered here — the
                caller's subtitle band shows the live STT text. */}
        </div>
    );
});

export default VoiceControl;
