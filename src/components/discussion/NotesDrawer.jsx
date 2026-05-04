import { X } from 'lucide-react';
import DiscussionNotes from './DiscussionNotes';

// Slide-out drawer for discussion notes. Hidden by default; opened via a
// topbar button. Click outside or the close icon to dismiss.
export default function NotesDrawer({ open, onClose, sessionId }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-md bg-slate-800 shadow-2xl border-l border-slate-700 flex flex-col h-full"
            >
                <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-900">
                    <h2 className="text-sm font-semibold text-slate-100">Notes</h2>
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
                        : <div className="p-4 text-sm text-slate-400 italic">No session — notes unavailable.</div>}
                </div>
            </div>
        </div>
    );
}
