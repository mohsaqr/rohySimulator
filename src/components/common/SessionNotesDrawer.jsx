import { X } from 'lucide-react';
import DiscussionNotes from '../discussion/DiscussionNotes';

// Reusable session-notes side drawer. Wraps the existing DiscussionNotes
// editor against /sessions/:id/discussion-notes so every full-page
// screen (exam, investigations, future workspaces) shares one clinical
// notepad per session. Title is parameterised so the drawer chrome can
// say what surface launched it.
//
// Notes from exam, labs, radiology, and debrief all land in the same
// per-(session, user) artifact by design: a learner's running notes
// while caring for the patient should be continuous across surfaces. If
// that ever needs to split, add a `kind` field server-side and pass it
// through here.
export default function SessionNotesDrawer({ open, onClose, sessionId, title = 'Session notes' }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-md bg-slate-800 shadow-2xl border-l border-slate-700 flex flex-col h-full"
            >
                <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-900">
                    <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
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
