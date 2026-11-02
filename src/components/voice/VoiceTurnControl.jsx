import { useTranslation } from 'react-i18next';
import { useHandsFreePreference } from './useHandsFreePreference';

// The shared pieces of every voice surface's controls. Each surface keeps
// its own look (the chat's full-width bar, the phone's round keys, the
// debrief's big disc, the Bedside room's glass disc) by passing classNames
// and children; what is shared is the behaviour:
//
//   VoiceTurnButton  the microphone: a tap drives the conversation engine
//                    (useVoiceConversation), and it is enabled exactly when
//                    a tap would do something — the same gate the Space key
//                    goes through.
//   VoiceTurnStatus  the hands-free status line ("Tap the microphone once to
//                    start…", "Listening…", "… speaking — talk to interrupt").
//   HandsFreeToggle  the one Hands-free switch (prefs.handsFreeConversation),
//                    shown wherever there is a microphone.

// Hands-free status → chat-namespace key. Static keys so i18next-parser sees them.
const HANDS_FREE_STATUS_KEYS = {
    idle: 'hands_free_tap_to_start',
    listening: 'hands_free_listening',
    speaking: 'hands_free_patient_speaking',
    thinking: 'hands_free_thinking',
};

const resolve = (value, conversation) => (typeof value === 'function' ? value(conversation) : value);

/**
 * The microphone button.
 * @param {{conversation: object, disabled?: boolean,
 *   className?: string|((c: object) => string), children?: *}} props
 *   `children` / `className` may be functions of the conversation state.
 */
export function VoiceTurnButton({ conversation, disabled = false, className, children, ...rest }) {
    return (
        <button
            type="button"
            onClick={conversation.tap}
            disabled={disabled || !conversation.canTap}
            aria-pressed={conversation.listening}
            data-voice-status={conversation.status ?? 'off'}
            data-voice-mode={conversation.mode}
            className={resolve(className, conversation)}
            {...rest}
        >
            {resolve(children, conversation)}
        </button>
    );
}

/**
 * The hands-free status line; renders nothing in push-to-talk.
 * @param {{conversation: object, speakingLabel?: string, className?: string}} props
 *   `speakingLabel` names who is speaking (default: the patient).
 */
export function VoiceTurnStatus({ conversation, speakingLabel = null, className = '' }) {
    const { t } = useTranslation('chat');
    if (!conversation.active || conversation.mode !== 'handsFree') return null;
    const { status } = conversation;
    const key = HANDS_FREE_STATUS_KEYS[status];
    if (!key) return null;
    const text = status === 'speaking' && speakingLabel ? speakingLabel : t(key);
    return (
        <div
            data-testid="hands-free-status"
            data-status={status}
            role="status"
            aria-live="polite"
            className={className}
        >
            {text}
        </div>
    );
}

/**
 * The Hands-free switch. Renders nothing where no preference store is
 * mounted. `children` may be a function of `on`.
 * @param {{className?: string|((on: boolean) => string), titleOff?: string, children?: *}} props
 */
export function HandsFreeToggle({ className, titleOff = null, children = null, ...rest }) {
    const { t } = useTranslation('chat');
    const { handsFree, setHandsFree, available } = useHandsFreePreference();
    if (!available) return null;
    return (
        <button
            type="button"
            data-testid="hands-free-toggle"
            aria-pressed={handsFree}
            onClick={() => setHandsFree(!handsFree)}
            title={handsFree ? t('hands_free_title_on') : (titleOff ?? t('hands_free_title_off_general'))}
            className={typeof className === 'function' ? className(handsFree) : className}
            {...rest}
        >
            {typeof children === 'function' ? children(handsFree) : (children ?? t('hands_free'))}
        </button>
    );
}

/**
 * Button and status line together, for surfaces with nothing to add.
 */
export default function VoiceTurnControl({ conversation, speakingLabel, statusClassName, ...buttonProps }) {
    return (
        <>
            <VoiceTurnButton conversation={conversation} {...buttonProps} />
            <VoiceTurnStatus conversation={conversation} speakingLabel={speakingLabel} className={statusClassName} />
        </>
    );
}
