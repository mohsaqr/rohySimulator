import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Save, NotebookPen } from 'lucide-react';
import { fetchSessionNote, saveSessionNote } from '../../services/notesService';

const SAVE_DEBOUNCE_MS = 500;

export default function DiscussionNotes({ sessionId }) {
    const [text, setText] = useState('');
    const [collapsed, setCollapsed] = useState(false);
    const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const dirtyRef = useRef(false);
    const saveTimerRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        fetchSessionNote(sessionId)
            .then(({ note_text }) => { if (!cancelled) setText(note_text || ''); })
            .catch(() => { /* empty notes on first open is fine */ });
        return () => { cancelled = true; };
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId || !dirtyRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            setStatus('saving');
            try {
                await saveSessionNote(sessionId, text);
                dirtyRef.current = false;
                setStatus('saved');
            } catch (err) {
                console.error('[DiscussionNotes] save failed:', err);
                setStatus('error');
            }
        }, SAVE_DEBOUNCE_MS);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [text, sessionId]);

    const handleChange = (e) => {
        dirtyRef.current = true;
        setStatus('idle');
        setText(e.target.value);
    };

    return (
        <div className="flex flex-col h-full">
            <button
                type="button"
                onClick={() => setCollapsed(c => !c)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-200 border-b border-slate-700 hover:bg-slate-700/50"
            >
                <span className="flex items-center gap-2">
                    <NotebookPen className="w-4 h-4 text-indigo-400" />
                    Notes
                    {status === 'saving' && <span className="text-xs text-slate-400 font-normal">saving…</span>}
                    {status === 'saved' && <Save className="w-3.5 h-3.5 text-emerald-400" />}
                    {status === 'error' && <span className="text-xs text-rose-400 font-normal">save failed</span>}
                </span>
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            {!collapsed && (
                <textarea
                    value={text}
                    onChange={handleChange}
                    placeholder="Jot down what you want to remember from the debrief — auto-saves and stays private to you."
                    className="flex-1 w-full px-4 py-3 bg-slate-800 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none"
                />
            )}
        </div>
    );
}
