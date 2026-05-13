import { X } from 'lucide-react';
import DiscussionNotes from '../discussion/DiscussionNotes';

// Side-notes drawer for the physical-exam screen. Mirrors the discussion
// debrief's NotesDrawer pattern and reuses the same DiscussionNotes editor.
//
// Notes are scoped per (session, user) by the existing
// /sessions/:id/discussion-notes endpoint. We intentionally share the same
// session-note between the exam and the debrief: a learner taking notes
// while examining the patient should see those same notes when reviewing
// the case afterwards — one clinical-notes artifact per session.
//
// If the future requires separating exam-notes from debrief-notes, add a
// `kind` field to the server endpoint and parametrise both screens.
export default function ExamNotesDrawer({ open, onClose, sessionId }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-md bg-slate-800 shadow-2xl border-l border-slate-700 flex flex-col h-full"
            >
                <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-900">
                    <h2 className="text-sm font-semibold text-slate-100">Exam notes</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1.5 hover:bg-slate-700 text-slate-300"
                        aria-label="Close notes"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </header>
                <div className="flex-1 min-h-0 overflow-hidden">
                    {sessionId
                        ? <DiscussionNotes sessionId={sessionId} />
                        : <div className="p-4 text-sm text-slate-400 italic">No active session — notes unavailable.</div>}
                </div>
            </div>
        </div>
    );
}
