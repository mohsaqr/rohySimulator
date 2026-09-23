import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceService } from '../../services/voiceService';
import { apiFetch } from '../../services/apiClient';
import { useVoice } from '../../contexts/VoiceContext';
import { useToast } from '../../contexts/ToastContext';
import { sttLocaleFor, DEFAULT_LANGUAGE } from '../../i18n/languages';
import { resolveVoice } from '../../utils/voiceResolver';
import { parseConfig } from '../../utils/parseConfig';
import { sanitizeResponseText } from '../../utils/plainText';
import OnCallAvatar from './OnCallAvatar';
import { EndIcon, KeyboardIcon, MicIcon, SendIcon, SpeakerIcon } from './phoneIcons';
import { NO_ANSWER_RING_MS, formatCallDuration, isFailedReply } from './onCallModel';
import { formatRemaining } from '../../utils/agentWait';

// A voice call with one specialist. Push-to-talk like the patient chat: tap
// Talk, speak, tap Done and the transcript is sent as a 'call' turn under
// this call's id. The reply is shown as a live subtitle and read aloud in the
// agent's own voice (resolved exactly as ChatInterface resolves agent
// voices). Where the browser has no speech recognition, the learner types.
export default function OnCallCall({ agent, reachability, pagingNow, now, callId, caseLanguage, thread, onEnd }) {
    const { t } = useTranslation(['oncall', 'chat']);
    const toast = useToast();
    const { voiceSettings: contextVoiceSettings } = useVoice();
    const [ownVoiceSettings, setOwnVoiceSettings] = useState(null);
    const voiceSettings = contextVoiceSettings || ownVoiceSettings;

    const [sttSupported] = useState(() => VoiceService.isSttSupported());
    const [typing, setTyping] = useState(() => !VoiceService.isSttSupported());
    const [typed, setTyped] = useState('');
    const [listening, setListening] = useState(false);
    const [heard, setHeard] = useState('');
    const [speaking, setSpeaking] = useState(false);
    const [muted, setMuted] = useState(false);
    const [subtitle, setSubtitle] = useState('');
    const [connectedAt, setConnectedAt] = useState(null);
    const [clock, setClock] = useState(() => Date.now());
    const mutedRef = useRef(false);
    const endingRef = useRef(false);
    const substitutionToastedRef = useRef(false);

    const connected = reachability === 'available' && !pagingNow;
    // A specialist whose rooms the case switched off never picks up: the call
    // rings for a moment, then says so. Nothing is paged or sent.
    const [unanswered, setUnanswered] = useState(false);
    useEffect(() => {
        if (reachability !== 'no_answer') return undefined;
        const id = setTimeout(() => setUnanswered(true), NO_ANSWER_RING_MS);
        return () => clearTimeout(id);
    }, [reachability]);

    // VoiceContext holds the platform voice settings once the chat room has
    // loaded them. From a plugin room it may not have, so fetch our own copy.
    useEffect(() => {
        if (contextVoiceSettings) return undefined;
        let cancelled = false;
        apiFetch('/platform-settings/voice')
            .then((data) => { if (!cancelled) setOwnVoiceSettings(data); })
            .catch((err) => console.error('[OnCallCall] voice settings load failed:', err));
        return () => { cancelled = true; };
    }, [contextVoiceSettings]);

    // The timer starts when the specialist actually picks up (after any wait):
    // state adjusted during render from the clock tick, not an effect.
    if (connected && connectedAt === null) setConnectedAt(clock);
    useEffect(() => {
        const id = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // Leaving the call screen by any route silences both directions.
    // (endingRef is re-armed in the body so StrictMode's mount → cleanup →
    // mount cycle does not leave the call permanently "ending".)
    useEffect(() => {
        endingRef.current = false;
        return () => {
            endingRef.current = true;
            VoiceService.stopListening();
            VoiceService.cancelSpeech();
        };
    }, []);

    const speak = (reply) => {
        const spoken = sanitizeResponseText(reply);
        if (mutedRef.current || !spoken || isFailedReply(reply)) return;
        const r = resolveVoice({
            voice: parseConfig(agent.config).voice,
            templateVoice: null,
            voiceSettings,
            language: caseLanguage,
        });
        if (!r.file) {
            if (r.tier === 'invalid') {
                toast?.error?.(t('chat:voice_wrong_provider', { voice: r.requestedFile, provider: r.provider || '?' }));
            } else {
                toast?.error?.(t('chat:no_voice_configured_agent'));
            }
            return;
        }
        if (r.substituted && !substitutionToastedRef.current) {
            substitutionToastedRef.current = true;
            toast?.info?.(t('chat:voice_default_not_configured', { voice: r.file }));
        }
        VoiceService.speak({
            text: spoken,
            voice: r.file,
            rate: r.rate,
            pitch: r.pitch,
            provider: r.provider,
            language: caseLanguage,
            onStart: () => setSpeaking(true),
            onEnd: () => setSpeaking(false),
            onError: (err) => {
                console.error('[OnCallCall] TTS error:', err);
                setSpeaking(false);
                const msg = err?.message || t('chat:tts_failed');
                if (/unknown.*voice|not in catalog/i.test(msg)) toast?.error?.(t('chat:voice_not_valid_for_engine'));
                else if (/api.?key|API_KEY/i.test(msg)) toast?.error?.(t('chat:cloud_tts_missing_api_key'));
                else toast?.error?.(t('chat:voice_playback_failed', { msg }));
            },
        });
    };

    const sendTurn = async (text) => {
        const reply = await thread.send(text, { channel: 'call', callId });
        if (reply === null || endingRef.current) return;
        setSubtitle(sanitizeResponseText(reply));
        speak(reply);
    };

    const startTalking = () => {
        if (!VoiceService.isSttSupported()) {
            toast?.error?.(t('chat:stt_not_supported_browser'));
            return;
        }
        const sttLang = caseLanguage !== DEFAULT_LANGUAGE
            ? sttLocaleFor(caseLanguage)
            : voiceSettings?.stt_language;
        if (!sttLang) {
            toast?.error?.(t('chat:no_stt_language'));
            return;
        }
        VoiceService.cancelSpeech();
        setSpeaking(false);
        setHeard('');
        setListening(true);
        let sawError = false;
        VoiceService.startListening({
            lang: sttLang,
            onResult: ({ final, interim }) => setHeard(interim || final),
            onError: (err) => {
                sawError = true;
                const code = err?.message || 'unknown';
                if (code === 'not-allowed' || code === 'service-not-allowed') toast?.error?.(t('chat:mic_blocked'));
                else if (code === 'network') toast?.error?.(t('chat:stt_network_error'));
                else if (code === 'audio-capture') toast?.error?.(t('chat:no_microphone'));
                else if (code === 'no-speech') toast?.error?.(t('chat:no_speech_heard'));
                else if (code !== 'aborted') toast?.error?.(t('chat:stt_error', { code }));
                setListening(false);
            },
            onEnd: ({ final }) => {
                setListening(false);
                setHeard('');
                if (endingRef.current) return;
                if (final) sendTurn(final);
                else if (!sawError) toast?.error?.(t('chat:listening_ended_no_speech'));
            },
        });
    };

    const toggleTalk = () => {
        if (listening) VoiceService.stopListening();
        else startTalking();
    };

    const submitTyped = (e) => {
        e.preventDefault();
        const text = typed.trim();
        if (!text || !connected || thread.sending) return;
        setTyped('');
        sendTurn(text);
    };

    const toggleMute = () => {
        const next = !mutedRef.current;
        mutedRef.current = next;
        setMuted(next);
        if (next) {
            VoiceService.cancelSpeech();
            setSpeaking(false);
        }
    };

    const endCall = () => {
        endingRef.current = true;
        VoiceService.stopListening();
        VoiceService.cancelSpeech();
        onEnd();
    };

    let stateLine;
    if (reachability === 'no_answer') {
        stateLine = unanswered ? t('call_no_answer', { name: agent.name }) : t('call_calling');
    } else if (!connected) {
        const remaining = agent.arrives_at ? formatRemaining(agent.arrives_at, now) : '';
        stateLine = remaining ? t('call_paging_eta', { remaining }) : t('call_calling');
    } else if (listening) stateLine = t('call_listening');
    else if (thread.sending) stateLine = t('call_thinking', { name: agent.name });
    else if (speaking) stateLine = t('call_speaking', { name: agent.name });
    else stateLine = formatCallDuration(connectedAt ? clock - connectedAt : 0);

    const talkDisabled = !connected || thread.sending;
    // This call's transcript, in order: the turns tagged with its call id.
    const turns = thread.messages.filter(m => m.channel === 'call' && m.call_id === callId);
    const lastReplyIndex = turns.map(m => m.role).lastIndexOf('assistant');
    const callClass = ['call', `spec-${agent.agent_type}`, !connected && !unanswered ? 'ringing' : '', speaking ? 'speaking' : '']
        .filter(Boolean).join(' ');

    return (
        <div className="screen">
            <div className={callClass}>
                <OnCallAvatar agent={agent} big />
                <h2>{agent.name}</h2>
                {agent.role_title && <div className="call-role">{agent.role_title}</div>}
                <div className="call-state" role="status" data-testid="oncall-call-state">{stateLine}</div>

                <div className="captions" aria-live="polite">
                    {turns.map((m, i) => (
                        <p
                            key={m.id ?? `${i}-${m.role}`}
                            className={`cap ${m.role === 'user' ? 'you' : ''}`}
                            data-testid={i === lastReplyIndex ? 'oncall-subtitle' : undefined}
                        >
                            <b>{m.role === 'user' ? t('call_you') : agent.name}</b>
                            {m.role === 'user' ? m.content : sanitizeResponseText(m.content)}
                        </p>
                    ))}
                    {listening && heard && (
                        <p className="cap you">
                            <b>{t('call_you')}</b>
                            {heard}
                        </p>
                    )}
                    {lastReplyIndex === -1 && subtitle && (
                        <p className="cap" data-testid="oncall-subtitle"><b>{agent.name}</b>{subtitle}</p>
                    )}
                </div>

                <div className="call-note">{!sttSupported ? t('call_stt_unsupported') : ''}</div>

                {typing && (
                    <form className="call-type" onSubmit={submitTyped}>
                        <label htmlFor="oncall-call-input" className="sr-only">{t('call_type_label')}</label>
                        <input
                            id="oncall-call-input"
                            autoComplete="off"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            disabled={!connected}
                            placeholder={t('call_type_placeholder')}
                        />
                        <button
                            type="submit"
                            className="icon-btn send"
                            disabled={!connected || thread.sending || !typed.trim()}
                            aria-label={t('call_send_typed')}
                        >
                            <SendIcon />
                        </button>
                    </form>
                )}

                <div className="call-controls">
                    {sttSupported && (
                        <div className="ctl">
                            <button
                                type="button"
                                className={`round ${listening ? 'live' : ''}`}
                                onClick={toggleTalk}
                                disabled={talkDisabled && !listening}
                                aria-pressed={listening}
                                aria-label={listening ? t('call_done_label') : t('call_talk_label')}
                            >
                                <MicIcon />
                            </button>
                            <span className="round-label">{listening ? t('call_done') : t('call_talk')}</span>
                        </div>
                    )}
                    <div className="ctl">
                        <button type="button" className="round end" onClick={endCall} aria-label={t('call_end_label')}>
                            <EndIcon />
                        </button>
                        <span className="round-label">{t('call_end')}</span>
                    </div>
                    <div className="ctl">
                        <button
                            type="button"
                            className={`round ${muted ? '' : 'on'}`}
                            onClick={toggleMute}
                            aria-pressed={muted}
                            aria-label={muted ? t('call_unmute_label', { name: agent.name }) : t('call_mute_label', { name: agent.name })}
                        >
                            <SpeakerIcon on={!muted} />
                        </button>
                        <span className="round-label">{t('call_voice')}</span>
                    </div>
                    {sttSupported && (
                        <div className="ctl">
                            <button
                                type="button"
                                className={`round ${typing ? 'on' : ''}`}
                                onClick={() => setTyping(v => !v)}
                                aria-pressed={typing}
                                aria-label={t('call_type_instead')}
                            >
                                <KeyboardIcon />
                            </button>
                            <span className="round-label">{t('call_type')}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
