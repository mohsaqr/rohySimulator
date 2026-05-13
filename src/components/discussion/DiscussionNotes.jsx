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
    // Captures the latest typed text so the unmount-flush below can save it
    // even when state/text closures have already torn down.
    const latestTextRef = useRef('');
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        fetchSessionNote(sessionId)
            .then(({ note_text }) => { if (!cancelled) setText(note_text || ''); })
            .catch(() => { /* empty notes on first open is fine */ });
        return () => { cancelled = true; };
    }, [sessionId]);

    useEffect(() => {
        latestTextRef.current = text;
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

    // Unmount-only: if a debounced save is still pending when the user
    // closes the drawer / screen, flush it synchronously (fire-and-forget)
    // so the last few characters typed aren't dropped. Without this, the
    // cleanup on the debounce effect cancels the timer without saving.
    useEffect(() => {
        return () => {
            if (!dirtyRef.current) return;
            const sid = sessionIdRef.current;
            if (!sid) return;
            // No await — we're in a synchronous cleanup. The promise runs
            // in the background; failures are logged like the debounced path.
            saveSessionNote(sid, latestTextRef.current).catch((err) => {
                console.error('[DiscussionNotes] unmount flush failed:', err);
            });
            dirtyRef.current = false;
        };
    }, []);

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
