import { X } from 'lucide-react';

export default function DiscussionTranscript({ messages, onClose }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-slate-700">
                <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-900/50 rounded-t-2xl">
                    <h2 className="text-base font-semibold text-slate-100">Conversation transcript</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1.5 hover:bg-slate-700 text-slate-300"
                        aria-label="Close transcript"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </header>
                <div className="overflow-y-auto px-5 py-4 space-y-3">
                    {messages.length === 0 && (
                        <div className="text-sm text-slate-400 italic text-center py-8">
                            No messages yet. Tap the mic to begin.
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div
                            key={i}
                            className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                                m.role === 'user'
                                    ? 'ml-auto bg-indigo-900/40 text-slate-100 border border-indigo-700/50'
                                    : m.error
                                        ? 'bg-red-900/40 text-red-100 border border-red-800/50'
                                        : 'bg-slate-900/60 text-slate-100 border border-slate-700'
                            }`}
                        >
                            <div className="text-xs font-semibold uppercase mb-1 text-slate-400">
                                {m.role === 'user' ? 'You' : 'Discussant'}
                            </div>
                            {m.content || <span className="italic text-slate-500">…</span>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
