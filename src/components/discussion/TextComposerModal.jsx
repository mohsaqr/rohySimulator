import { useState } from 'react';
import { X, Send } from 'lucide-react';

export default function TextComposerModal({ onClose, onSend, busy }) {
    const [text, setText] = useState('');

    const handleSend = () => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        onSend(trimmed);
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl border border-slate-700">
                <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-100">Type a message</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1.5 hover:bg-slate-700 text-slate-300"
                        aria-label="Close composer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </header>
                <div className="px-5 py-4">
                    <textarea
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Ask the discussant anything…"
                        rows={4}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                        disabled={busy}
                    />
                </div>
                <footer className="flex justify-end gap-2 px-5 py-3 border-t border-slate-700 bg-slate-900/40 rounded-b-2xl">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={busy || !text.trim()}
                        className="px-4 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                        <Send className="w-4 h-4" /> Send
                    </button>
                </footer>
            </div>
        </div>
    );
}
