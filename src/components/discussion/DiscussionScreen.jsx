import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Keyboard, GraduationCap, MessagesSquare, NotebookPen, Play } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
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

export default function DiscussionScreen({ sessionId, activeCase, onClose }) {
    const { headManifest, platformAvatars, voiceSettings } = useVoice();
    const [discussant, setDiscussant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showText, setShowText] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
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
        voiceSettings, platformAvatars,
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

    const sttLang = voiceSettings?.stt_language || 'en-US';

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
                        <ArrowLeft className="w-4 h-4" /> Back to Cases
                    </button>
                    <div className="flex items-center gap-2 text-sm">
                        <GraduationCap className="w-5 h-5 text-indigo-400" />
                        <span className="font-semibold text-slate-100">Case Debrief</span>
                        {activeCase?.name && (
                            <span className="text-slate-400">· {activeCase.name}</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        Notes
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowTranscript(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <MessagesSquare className="w-4 h-4" />
                        Transcript {messages.length > 0 && <span className="ml-0.5 px-1.5 py-0.5 rounded bg-slate-700 text-slate-200 text-xs">{messages.filter(m => m.role !== 'system').length}</span>}
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
                        <div className="text-center">
                            <div className="text-lg font-semibold text-slate-100">
                                {loading ? '…' : (discussant?.name || 'Discussant')}
                            </div>
                            <div className="text-sm text-slate-400">
                                {discussant?.roleTitle || 'Case Debrief Tutor'}
                            </div>
                        </div>
                        {lastAssistant && (
                            <div className="max-w-xl px-5 py-3 rounded-xl bg-indigo-950/60 border border-indigo-800/60 text-sm text-slate-100 whitespace-pre-wrap">
                                {lastAssistant}
                            </div>
                        )}
                    </div>

                    <div className="w-full flex flex-col items-center gap-3 mt-6">
                        {!discussant && !loading ? (
                            <div className="text-sm text-slate-400 italic text-center max-w-md">
                                No discussant configured. An admin can add one in Agent Templates.
                            </div>
                        ) : !started ? (
                            <button
                                type="button"
                                onClick={handleStart}
                                disabled={!discussant || busy}
                                className="px-8 py-4 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-base flex items-center gap-2 shadow-lg ring-4 ring-indigo-500/20 hover:ring-indigo-500/40 transition-all"
                            >
                                <Play className="w-5 h-5" />
                                Start debrief
                            </button>
                        ) : (
                            <VoiceControl
                                onSend={sendMessage}
                                busy={busy}
                                speaking={speaking}
                                sttLang={sttLang}
                            />
                        )}
                        {started && (
                            <button
                                type="button"
                                onClick={() => setShowText(true)}
                                disabled={!discussant}
                                className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-300 disabled:opacity-40"
                            >
                                <Keyboard className="w-3.5 h-3.5" /> Type instead
                            </button>
                        )}
                    </div>
                </main>

            </div>

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
        </div>
    );
}
