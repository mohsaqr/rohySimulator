import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Keyboard, GraduationCap, MessagesSquare, NotebookPen, Play } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { sttLocaleFor, DEFAULT_LANGUAGE } from '../../i18n/languages';
import { caseDisplayLabel } from '../../utils/caseDisplayLabel';
import { fetchDiscussantForCase } from '../../services/discussionService';
import { useDiscussionEngine } from '../../hooks/useDiscussionEngine';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import VoiceControl from './VoiceControl';
import DiscussionTranscript from './DiscussionTranscript';
import TextComposerModal from './TextComposerModal';
import NotesDrawer from './NotesDrawer';
import PatientSummaryCard from './PatientSummaryCard';
import CaseSummaryModal from './CaseSummaryModal';

const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

export default function DiscussionScreen({ sessionId, activeCase, onClose, roomNav = null }) {
    const { t } = useTranslation('discussion');
    const { headManifest, platformAvatars, voiceSettings } = useVoice();
    const { user } = useAuth();
    const { caseLanguage } = useLanguage();
    // Debrief is fully student-facing — the authoring title is the diagnosis.
    // Gate it through the same role rule as every other room header (Bug 14,
    // 18.5.2026: this screen was the surface that bypassed caseDisplayLabel).
    const caseTitle = caseDisplayLabel(activeCase, user);
    const [discussant, setDiscussant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showText, setShowText] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    // Subtitle state — mirrors ChatInterface's pattern. `listening`/`interim`
    // are mirrored up from VoiceControl via onListeningChange. `subtitleReady`
    // gates the discussant's TTS caption by ~30% of the estimated audio
    // length so the trainee hears the start of the line before reading it.
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [subtitleReady, setSubtitleReady] = useState(false);
    // Seeded from prior history so reloading mid-debrief skips the Start gate.
    const [started, setStarted] = useState(() => {
        if (!sessionId) return false;
        try {
            const saved = localStorage.getItem(`rohy_discussion_history_${sessionId}`);
            const parsed = saved ? JSON.parse(saved) : null;
            return Array.isArray(parsed) && parsed.length > 0;
        } catch { return false; }
    });

    useEffect(() => {
        let cancelled = false;
        fetchDiscussantForCase(activeCase?.id)
            .then(d => { if (!cancelled) { setDiscussant(d); setLoading(false); } })
            .catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [activeCase?.id]);

    useEffect(() => {
        EventLogger.componentOpened(COMPONENTS.DISCUSSION_SCREEN, 'Discussion');
        return () => EventLogger.componentClosed(COMPONENTS.DISCUSSION_SCREEN, 'Discussion');
    }, []);

    // Voice mode is the default + only mode for streaming TTS playback. The
    // text composer is a fallback affordance, not a separate mode — sending
    // from text still triggers voice playback if the discussant has a voice.
    const { messages, busy, speaking, visemes, sendMessage, startConversation } = useDiscussionEngine({
        sessionId, activeCase, discussant, voiceMode: true,
        voiceSettings,
    });

    const handleStart = async () => {
        if (started || busy) return; // ignore double-taps
        setStarted(true);
        try {
            await startConversation();
        } catch (err) {
            console.warn('[DiscussionScreen] kick-off failed:', err);
            // If the kick-off blew up before any assistant message landed,
            // roll back the gate so the learner sees the Start button again
            // instead of a dead screen with a useless mic.
            if (messages.length === 0) setStarted(false);
        }
    };

    const lastAssistant = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.role === 'assistant' && messages[i].content) return messages[i].content;
        }
        return null;
    }, [messages]);

    // 30% reveal lag for the discussant's TTS. Same heuristic as
    // ChatInterface: estimated duration ≈ chars/15 ×1000ms, lag = 30% of
    // that, floored at 300ms and capped at 4s. The lastAssistant snapshot is
    // read synchronously inside the effect so a streaming-delta append
    // during TTS doesn't restart the timer.
    useEffect(() => {
        if (!speaking) {
            setSubtitleReady(false);
            return undefined;
        }
        const text = lastAssistant || '';
        const estimatedMs = Math.max(1000, (text.length / 15) * 1000);
        const lagMs = Math.min(estimatedMs * 0.30, 4000);
        const t = setTimeout(() => setSubtitleReady(true), lagMs);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speaking]);

    // Stable callback for VoiceControl so its useEffect dep doesn't churn.
    const handleListeningChange = useCallback((isListening, currentInterim) => {
        setListening(isListening);
        setInterim(currentInterim || '');
    }, []);

    // Session language wins over the platform-wide STT locale, mirroring the
    // patient-chat rule in ChatInterface.startVoiceTurn: an Italian debrief
    // listens in Italian; English sessions keep the platform setting.
    const sttLang = caseLanguage !== DEFAULT_LANGUAGE
        ? sttLocaleFor(caseLanguage)
        : (voiceSettings?.stt_language || 'en-US');

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-slate-700 to-slate-900 text-slate-100 flex flex-col overflow-hidden">
            {/* Topbar */}
            <header className="flex items-center justify-between px-6 py-3 bg-slate-900/80 backdrop-blur border-b border-slate-700">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <ArrowLeft className="w-4 h-4" /> {t('back_to_cases')}
                    </button>
                    <div className="flex items-center gap-2 text-sm">
                        <GraduationCap className="w-5 h-5 text-indigo-400" />
                        <span className="font-semibold text-slate-100">{t('case_debrief')}</span>
                        {caseTitle && (
                            <span className="text-slate-400">· {caseTitle}</span>
                        )}
                        {/* Discussant identity lives here so the centre column
                            stays free for the avatar + cinema subtitle band.
                            While the discussant is still being fetched the slot
                            shows an ellipsis placeholder (so the header doesn't
                            jump when the name arrives, and the loading state is
                            observable — DiscussionScreen.test CONTRACT 1). */}
                        {loading && !discussant ? (
                            <span className="text-slate-400">
                                · <span className="text-indigo-200">…</span>
                            </span>
                        ) : discussant?.name ? (
                            <span className="text-slate-400">
                                · <span className="text-indigo-200">{discussant.name}</span>
                                {discussant.roleTitle && (
                                    <span className="text-slate-500 ml-1">({discussant.roleTitle})</span>
                                )}
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        {t('notes')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowTranscript(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <MessagesSquare className="w-4 h-4" />
                        {t('transcript')} {messages.length > 0 && <span className="ml-0.5 px-1.5 py-0.5 rounded bg-slate-700 text-slate-200 text-xs">{messages.filter(m => m.role !== 'system').length}</span>}
                    </button>
                </div>
            </header>

            {/* Body — two-column: patient (left) + discussant (right). Notes in drawer. */}
            <div className="flex-1 min-h-0 grid grid-cols-[minmax(280px,1fr)_minmax(0,2fr)] gap-6 p-6">
                {/* Left: patient with 3D avatar */}
                <aside className="min-h-0 overflow-y-auto">
                    <PatientSummaryCard
                        activeCase={activeCase}
                        headManifest={headManifest}
                        platformAvatars={platformAvatars}
                        onViewSummary={() => setShowSummary(true)}
                    />
                </aside>

                {/* Right: discussant + voice */}
                <main className="min-h-0 flex flex-col items-center justify-between bg-slate-800/60 rounded-2xl border border-slate-700 shadow-xl p-8 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 w-full">
                        <div className="w-64 h-64 max-w-full">
                            <Suspense fallback={<div className="w-full h-full rounded-full bg-slate-700" />}>
                                <PatientAvatar
                                    patient={{ id: discussant?.id, name: discussant?.name, gender: discussant?.voice?.gender }}
                                    avatarId={discussant?.avatarUrl}
                                    headManifest={headManifest}
                                    speaking={speaking}
                                    visemes={visemes}
                                />
                            </Suspense>
                        </div>
                        {/* Discussant name + inline message bubble moved out:
                            the name now lives in the topbar; the spoken line
                            renders via the cinema subtitle band (below) so
                            the central column stays uncluttered. */}
                    </div>

                    <div className="w-full flex flex-col items-center gap-3 mt-6">
                        {!discussant && !loading ? (
                            <div className="text-sm text-slate-400 italic text-center max-w-md">
                                {t('no_discussant')}
                            </div>
                        ) : !started ? (
                            <button
                                type="button"
                                onClick={handleStart}
                                disabled={!discussant || busy}
                                className="px-8 py-4 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-base flex items-center gap-2 shadow-lg ring-4 ring-indigo-500/20 hover:ring-indigo-500/40 transition-all"
                            >
                                <Play className="w-5 h-5" />
                                {t('start_debrief')}
                            </button>
                        ) : (
                            <VoiceControl
                                onSend={sendMessage}
                                busy={busy}
                                speaking={speaking}
                                sttLang={sttLang}
                                onListeningChange={handleListeningChange}
                            />
                        )}
                        {started && (
                            <button
                                type="button"
                                onClick={() => setShowText(true)}
                                disabled={!discussant}
                                className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-300 disabled:opacity-40"
                            >
                                <Keyboard className="w-3.5 h-3.5" /> {t('type_instead')}
                            </button>
                        )}
                    </div>
                </main>

            </div>

            {/* Cinema subtitle band — mirrors the ChatInterface
                implementation. Captures BOTH speakers (user STT via the
                `listening` mirror from VoiceControl; discussant TTS via
                `speaking` + 30% lag gate). Pixel-anchored under the 256px
                discussant avatar (topbar ~52px + body pt-6 ~24px + main p-8
                ~32px + avatar 256px ≈ 364px → top: 23rem gives a small
                breathing gap). No speaker label; the topbar already
                identifies the discussant. Renders nothing when neither
                speaker is active. Click anywhere on the haze to open the
                full transcript. */}
            {!showTranscript && started && (() => {
                let line = null;
                if (listening && interim) {
                    line = interim;
                } else if (speaking && subtitleReady && lastAssistant) {
                    line = lastAssistant;
                }
                if (!line) return null;
                const hazeMask = 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 90%)';
                return (
                    <button
                        type="button"
                        onClick={() => setShowTranscript(true)}
                        aria-label={t('show_full_transcript')}
                        // Span only the right 2/3 of the viewport so flex
                        // centering lands on the discussant column's geometric
                        // centre, not the viewport's. The body grid is
                        // `1fr_2fr` with a 24px gap and 24px outer padding —
                        // the algebra works out to right-column-centre = 2W/3
                        // exactly (independent of viewport width). So
                        // `left-1/3 right-0 + flex justify-center` centres on
                        // 66.67% = the column centre.
                        className="fixed left-1/3 right-0 z-40 flex justify-center items-center px-6 py-8 text-center group"
                        style={{ top: '23rem', background: 'transparent' }}
                    >
                        <div
                            aria-hidden
                            className="absolute inset-0 backdrop-blur-sm"
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.30)',
                                WebkitMaskImage: hazeMask,
                                maskImage: hazeMask,
                            }}
                        />
                        <div
                            className="relative max-w-2xl pointer-events-none"
                            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.75)' }}
                        >
                            <p className="text-xl md:text-2xl font-medium text-white leading-snug whitespace-pre-wrap break-words">
                                {line}
                            </p>
                        </div>
                    </button>
                );
            })()}

            <NotesDrawer
                open={showNotes}
                onClose={() => setShowNotes(false)}
                sessionId={sessionId}
            />

            {showText && (
                <TextComposerModal
                    onClose={() => setShowText(false)}
                    onSend={(text) => { sendMessage(text); setShowText(false); }}
                    busy={busy}
                />
            )}
            {showSummary && (
                <CaseSummaryModal
                    activeCase={activeCase}
                    sessionId={sessionId}
                    onClose={() => setShowSummary(false)}
                />
            )}
            {showTranscript && (
                <DiscussionTranscript
                    messages={messages}
                    onClose={() => setShowTranscript(false)}
                />
            )}

            {/* Bottom RoomNavigator — same nav as every other in-session
                surface. Lets the user leave the consultant room without
                ending the session. */}
            {roomNav}
        </div>
    );
}
