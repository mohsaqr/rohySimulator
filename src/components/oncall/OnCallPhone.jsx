import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import OnCallAvatar from './OnCallAvatar';
import OnCallChat from './OnCallChat';
import OnCallCall from './OnCallCall';
import { CloseIcon, MessageIcon, PhoneIcon } from './phoneIcons';
import { useSpecialistThread } from './useSpecialistThread';
import { newCallId, reachabilityOf, specialistTypeForRoom, SPECIALTY_LABEL_KEYS, statusKeyFor } from './onCallModel';
import { formatRemaining } from '../../utils/agentWait';
import './onCallPhone.css';

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function clockLabel(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// The on-call phone: a handset (bezel, status bar) with three screens —
// contacts, a messaging thread, and a call — ported from the prototype.
// Contacting a specialist who is on call pages them first; the server decides
// whether that is instant or a wait.
//
// `team` is useOnCallTeam(sessionId): { specialists, loaded, now, page }.
// `patient` is App's patientInfo ({ name, age, gender, chief_complaint }):
// the same header the patient room shows, never the diagnosis.
export default function OnCallPhone({ sessionId, activeCase, patient = null, room = null, team, onClose, returnFocusRef = null }) {
    const { t } = useTranslation('oncall');
    const toast = useToast();
    const { caseLanguage } = useLanguage();
    const phoneRef = useRef(null);
    // Opened from a room a specialist owns (pathology, PACS/radiology, ECG),
    // the phone lands on that specialist's thread instead of the contact list
    // — you rang from their room. Anywhere else it opens on contacts.
    const roomSpecialist = specialistTypeForRoom(room);
    const [screen, setScreen] = useState(() => (roomSpecialist ? 'chat' : 'contacts'));
    const [selectedType, setSelectedType] = useState(() => roomSpecialist);
    const [pagingType, setPagingType] = useState(null);
    const [callId, setCallId] = useState(null);
    // The status-bar clock ticks on its own; team.now only ticks while paging.
    const [clockNow, setClockNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setClockNow(Date.now()), 15_000);
        return () => clearInterval(id);
    }, []);

    const agent = team.specialists.find(a => a.agent_type === selectedType) || null;
    const thread = useSpecialistThread({ sessionId, agent, activeCase, caseLanguage });

    // Focus moves into the handset on open and back to the button on close.
    // The button is read at CLOSE time, not captured at open: it lives in
    // each room's own header, so a room change while the handset is open
    // replaces it, and the node captured at open is detached by then.
    useEffect(() => {
        phoneRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately the ref's value at cleanup
        return () => returnFocusRef?.current?.focus?.();
    }, [returnFocusRef]);

    const reach = async (target) => {
        if (reachabilityOf(target) !== 'on_call') return;
        setPagingType(target.agent_type);
        try {
            await team.page(target);
        } catch (err) {
            console.error('[OnCallPhone] page failed:', err);
            toast?.error?.(t('page_failed', { name: target.name }));
        } finally {
            setPagingType(null);
        }
    };

    // Landing straight in a room specialist's thread pages them too — the
    // same thing clicking Message does. Runs once, when the phone opens.
    const pagedOnOpenRef = useRef(false);
    useEffect(() => {
        if (pagedOnOpenRef.current || !roomSpecialist || !team.loaded) return;
        const target = team.specialists.find(a => a.agent_type === roomSpecialist);
        if (!target) return;
        pagedOnOpenRef.current = true;
        reach(target);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reach reads live state
    }, [roomSpecialist, team.loaded, team.specialists]);

    const openChat = (target) => {
        setSelectedType(target.agent_type);
        setScreen('chat');
        reach(target);
    };

    const openCall = (target) => {
        setSelectedType(target.agent_type);
        setCallId(newCallId());
        setScreen('call');
        reach(target);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
        }
        if (e.key !== 'Tab' || !phoneRef.current) return;
        const nodes = Array.from(phoneRef.current.querySelectorAll(FOCUSABLE));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === phoneRef.current)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    const statusText = (a) => {
        const state = pagingType === a.agent_type ? 'paging' : reachabilityOf(a);
        const remaining = state === 'paging' && a.arrives_at ? formatRemaining(a.arrives_at, team.now) : '';
        return t(statusKeyFor(state, Boolean(remaining)), { remaining });
    };

    const reachability = agent ? reachabilityOf(agent) : 'unavailable';
    const pagingNow = agent ? pagingType === agent.agent_type : false;
    const patientLine = [patient?.name, patient?.age, patient?.gender].filter(Boolean).join(', ');

    return (
        <section
            ref={phoneRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="oncall-phone-title"
            data-testid="oncall-phone"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="oncall-phone"
        >
            <div className="glass">
            <span className="island" aria-hidden="true" />
            <div className="status">
                <span>{clockLabel(clockNow)}</span>
                <span className="right">
                    <span><span className="dot" />{t('status_bar')}</span>
                    <button type="button" className="status-close" onClick={onClose} aria-label={t('close_phone')}>
                        <CloseIcon />
                    </button>
                </span>
            </div>
            <h2 id="oncall-phone-title" className="sr-only">{t('phone_title')}</h2>

            {screen === 'contacts' || !agent ? (
                <div className="screen">
                    <div className="contacts-head">
                        <p className="eyebrow">{t('contacts_eyebrow')}</p>
                        <h1>{t('contacts_heading')}</h1>
                        {(patientLine || patient?.chief_complaint) && (
                            <div className="patient">
                                {patientLine && <strong>{patientLine}</strong>}
                                {patient?.chief_complaint && <span>{patient.chief_complaint}</span>}
                            </div>
                        )}
                    </div>
                    {!team.loaded && <p className="empty">{t('contacts_loading')}</p>}
                    {team.loaded && team.specialists.length === 0 && <p className="empty">{t('contacts_empty')}</p>}
                    <ul className="contact-list">
                        {team.specialists.map((a) => {
                            const r = reachabilityOf(a);
                            const labelKey = SPECIALTY_LABEL_KEYS[a.agent_type];
                            const unavailable = r === 'unavailable';
                            return (
                                <li key={a.agent_type} data-testid={`oncall-contact-${a.agent_type}`} className={`contact spec-${a.agent_type}`}>
                                    <OnCallAvatar agent={a} presence={r === 'available' ? 'online' : unavailable || r === 'no_answer' ? null : 'away'} />
                                    <button
                                        type="button"
                                        className="contact-open"
                                        onClick={() => !unavailable && openChat(a)}
                                        disabled={unavailable}
                                    >
                                        <span className="contact-name">{a.name}</span>
                                        <span className="contact-role">
                                            {labelKey && <span className="spec-tag">{t(labelKey)}</span>}
                                            {labelKey && ' · '}
                                            {a.role_title}
                                        </span>
                                        <span className="contact-last">{statusText(a)}</span>
                                    </button>
                                    <span className="contact-actions">
                                        <button
                                            type="button"
                                            className="icon-btn"
                                            onClick={() => openChat(a)}
                                            disabled={unavailable}
                                            aria-label={t('message_contact', { name: a.name })}
                                        >
                                            <MessageIcon />
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-btn"
                                            onClick={() => openCall(a)}
                                            disabled={unavailable}
                                            aria-label={t('call_contact', { name: a.name })}
                                        >
                                            <PhoneIcon />
                                        </button>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : screen === 'chat' ? (
                <OnCallChat
                    agent={agent}
                    reachability={reachability}
                    pagingNow={pagingNow}
                    statusLine={statusText(agent)}
                    thread={thread}
                    onBack={() => setScreen('contacts')}
                    onCall={() => openCall(agent)}
                    onPage={() => reach(agent)}
                />
            ) : (
                <OnCallCall
                    key={callId}
                    agent={agent}
                    reachability={reachability}
                    pagingNow={pagingNow}
                    now={team.now}
                    callId={callId}
                    caseLanguage={caseLanguage}
                    thread={thread}
                    onEnd={() => setScreen('chat')}
                />
            )}
            </div>
        </section>
    );
}
