import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeResponseText } from '../../utils/plainText';
import OnCallAvatar from './OnCallAvatar';
import { BackIcon, PhoneIcon, SendIcon } from './phoneIcons';
import { displayNameOf, failureKeyOf } from './onCallModel';

// Messaging thread with one specialist: chat bar, bubbles, composer.
// Replies render as plain text through the chat room's sanitiser. Call turns
// sit in the same thread, tagged "Call". A turn that went unanswered stays in
// the thread tagged "Not answered", with an operational error line and Retry
// below the thread — never as a bubble from the specialist.
export default function OnCallChat({ agent, reachability, pagingNow, statusLine, thread, onBack, onCall, onPage }) {
    const { t } = useTranslation('oncall');
    const [draft, setDraft] = useState('');
    const threadRef = useRef(null);
    const canSend = reachability === 'available' && !pagingNow;
    const name = displayNameOf(agent, t);
    const failureKey = failureKeyOf(thread.failure, agent);

    useEffect(() => {
        const el = threadRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [thread.messages.length, thread.sending, failureKey]);

    const sendText = async (text) => {
        const content = String(text || '').trim();
        if (!content || !canSend || thread.sending) return;
        await thread.send(content, { channel: 'chat' });
    };

    const submit = (e) => {
        e.preventDefault();
        const text = draft;
        setDraft('');
        sendText(text);
    };

    return (
        <div className={`screen spec-${agent.agent_type}`}>
            <div className="chat-bar">
                <button type="button" className="icon-btn plain" onClick={onBack} aria-label={t('back_to_contacts')}>
                    <BackIcon />
                </button>
                <OnCallAvatar agent={agent} presence={reachability === 'available' ? 'online' : 'away'} />
                <div className="chat-who">
                    <strong>{name}</strong>
                    <span>{statusLine}</span>
                </div>
                <button type="button" className="icon-btn" onClick={onCall} aria-label={t('call_contact', { name })}>
                    <PhoneIcon />
                </button>
            </div>

            <div className="thread" ref={threadRef} aria-live="polite">
                {!thread.loaded && <p className="sys">{t('chat_loading')}</p>}
                {thread.loaded && thread.messages.length === 0 && !thread.sending && (
                    <p className="day">{t('chat_empty', { name })}</p>
                )}
                {thread.messages.map((m, i) => {
                    const mine = m.role === 'user';
                    return (
                        <div
                            key={m.id ?? `${i}-${m.role}`}
                            className={`msg ${mine ? 'out' : 'in'}${m.failed ? ' failed' : ''}`}
                            data-testid={m.failed ? 'oncall-unanswered-turn' : undefined}
                        >
                            {m.channel === 'call' && <span className="via">{t('via_call')}</span>}
                            {mine ? m.content : sanitizeResponseText(m.content)}
                            {m.failed && <span className="via">{t('turn_unanswered')}</span>}
                        </div>
                    );
                })}
                {thread.sending && (
                    <div className="msg in typing" role="status">{t('typing', { name })}</div>
                )}
                {failureKey && !thread.sending && (
                    <p className="sys err" role="alert" data-testid="oncall-reply-failed">
                        {t(failureKey, { name })}
                        {thread.failure.kind !== 'no_answer' && (
                            <button type="button" onClick={() => thread.retry()}>{t('retry')}</button>
                        )}
                    </p>
                )}
                {(pagingNow || reachability === 'paging') && (
                    <p className="sys">{t('composer_waiting', { name })}</p>
                )}
                {reachability === 'no_answer' && (
                    <p className="sys" data-testid="oncall-no-answer">{t('chat_no_answer', { name })}</p>
                )}
                {!pagingNow && reachability === 'on_call' && (
                    <p className="sys">
                        {t('page_needed', { name })}
                        <button type="button" onClick={onPage}>{t('page_contact')}</button>
                    </p>
                )}
            </div>

            <form className="composer" onSubmit={submit}>
                <label htmlFor="oncall-composer" className="sr-only">{t('composer_label', { name })}</label>
                <textarea
                    id="oncall-composer"
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) submit(e);
                    }}
                    disabled={!canSend}
                    placeholder={t('composer_placeholder')}
                />
                <button
                    type="submit"
                    className="icon-btn send"
                    disabled={!canSend || thread.sending || !draft.trim()}
                    aria-label={t('send')}
                >
                    <SendIcon />
                </button>
            </form>
        </div>
    );
}
