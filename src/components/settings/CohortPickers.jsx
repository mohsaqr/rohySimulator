import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Check, AlertTriangle } from 'lucide-react';
import { ApiError } from '../../services/apiClient';
import { roleLabel } from '../../constants/roleLabels';
import { listLibraryCases, listTenantUsers } from '../../services/cohortsService';

// Shared, controlled pickers used by both the rich create form and the
// per-cohort Settings panel so the search/checkbox/empty behaviour lives in
// exactly one place (no duplication between create and edit).

const INPUT =
    'w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500';

// Multi-select, searchable list of library cases. `selected` is a Set of
// numeric case ids; `onToggle(id)` flips one; `excludeIds` hides already
// assigned cases (used by the Settings "add cases" flow). The library list
// is fetched here (GET /cases — educator-accessible) so callers don't have
// to thread the fetch through.
export function CasePicker({ selected, onToggle, excludeIds = [], heightClass = 'max-h-56' }) {
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [q, setQ] = useState('');

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const data = await listLibraryCases();
                if (alive) setCases(Array.isArray(data?.cases) ? data.cases : []);
            } catch (e) {
                if (alive) {
                    setError(e instanceof ApiError ? (e.message || 'Failed to load cases') : 'Failed to load cases');
                }
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const exclude = useMemo(() => new Set(excludeIds.map(Number)), [excludeIds]);
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return cases
            .filter((c) => !exclude.has(Number(c.id)))
            .filter((c) => !needle || String(c.name || '').toLowerCase().includes(needle));
    }, [cases, q, exclude]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-24 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex items-center gap-2 p-3 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
        );
    }
    if (cases.length === 0) {
        return (
            <p className="text-sm text-neutral-500 p-3 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                No cases in the library yet. Create cases under Case Manager first,
                then assign them here.
            </p>
        );
    }

    return (
        <div>
            <div className="relative mb-2">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search cases"
                    aria-label="Search cases"
                    className={`${INPUT} pl-9`}
                />
            </div>
            <div className={`${heightClass} overflow-y-auto space-y-1 pr-1`}>
                {filtered.length === 0 ? (
                    <p className="text-sm text-neutral-500 p-2">No cases match “{q}”.</p>
                ) : (
                    filtered.map((c) => {
                        const id = Number(c.id);
                        const on = selected.has(id);
                        return (
                            <button
                                type="button"
                                key={id}
                                onClick={() => onToggle(id)}
                                aria-pressed={on}
                                className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                                    on
                                        ? 'bg-purple-600/20 border border-purple-600/50'
                                        : 'bg-neutral-800/50 border border-neutral-700 hover:border-neutral-600'
                                }`}
                            >
                                <span
                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                        on ? 'bg-purple-600 border-purple-600' : 'border-neutral-600'
                                    }`}
                                >
                                    {on && <Check className="w-3 h-3 text-white" />}
                                </span>
                                <span className="text-sm text-white truncate">{c.name || `Case ${id}`}</span>
                            </button>
                        );
                    })
                )}
            </div>
            <p className="text-xs text-neutral-500 mt-2">
                {selected.size} case{selected.size === 1 ? '' : 's'} selected
            </p>
        </div>
    );
}

// People picker with a graceful capability split:
//  - admins CAN list tenant users (GET /users) → searchable multi-select
//    with select-all-of-filtered.
//  - educator-rank teachers get 403 on GET /users → we fall back to a
//    multi-line identifier textarea (one username/email per line). This is
//    the documented access reality, surfaced inline so the teacher knows
//    why they're typing instead of picking.
//
// `mode` = 'students' | 'teachers' only changes copy + the role filter for
// the list view. On submit the caller receives an array of identifiers
// (strings) regardless of which path produced them, so the calling code is
// uniform.
export function PeoplePicker({
    mode = 'students',
    excludeIds = [],
    onChange,
    heightClass = 'max-h-56',
}) {
    const [users, setUsers] = useState(null); // null = not-yet / unavailable
    const [loading, setLoading] = useState(true);
    const [canList, setCanList] = useState(true);
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState(() => new Set());
    const [typed, setTyped] = useState('');

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const data = await listTenantUsers();
                if (!alive) return;
                setUsers(Array.isArray(data?.users) ? data.users : []);
            } catch (e) {
                if (!alive) return;
                // 403 = educator without admin rights → identifier fallback.
                // Any other failure also falls back (typed entry always works
                // server-side via identifier resolution).
                if (e instanceof ApiError && e.status === 403) setCanList(false);
                else setCanList(false);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const exclude = useMemo(() => new Set(excludeIds.map(Number)), [excludeIds]);
    const eligible = useMemo(() => {
        const list = users || [];
        return list
            .filter((u) => !exclude.has(Number(u.id)))
            // For a student-add we hide existing teachers/owner is handled by
            // exclude; for a co-teacher add any tenant user is eligible
            // (server promotes a student membership in place).
            .filter((u) => {
                if (mode === 'students') return u.role === 'student' || u.role === 'user';
                return true;
            });
    }, [users, exclude, mode]);

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return eligible;
        return eligible.filter(
            (u) =>
                String(u.username || '').toLowerCase().includes(needle) ||
                String(u.name || '').toLowerCase().includes(needle),
        );
    }, [eligible, q]);

    // Emit identifiers upward whenever the selection / typed text changes.
    useEffect(() => {
        if (canList) {
            const byId = new Map((users || []).map((u) => [Number(u.id), u]));
            const ids = [...picked]
                .map((id) => byId.get(Number(id)))
                .filter(Boolean)
                .map((u) => u.username);
            onChange?.(ids);
        } else {
            const ids = typed
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean);
            onChange?.([...new Set(ids)]);
        }
    }, [picked, typed, canList, users, onChange]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-20 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }

    if (!canList) {
        const label =
            mode === 'students'
                ? 'Add students by username or email — one per line'
                : 'Add co-teachers by username or email — one per line';
        return (
            <div>
                <textarea
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    rows={4}
                    placeholder={`alice\nbob@example.com`}
                    aria-label={label}
                    className={`${INPUT} resize-y font-mono`}
                />
                <p className="text-xs text-neutral-500 mt-2">
                    {label}. Your account can’t browse the user directory
                    (admin-only), so enter identifiers directly — the server
                    resolves each one in your tenant.
                </p>
            </div>
        );
    }

    if (eligible.length === 0) {
        return (
            <p className="text-sm text-neutral-500 p-3 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                {mode === 'students'
                    ? 'No eligible students in this tenant yet.'
                    : 'No other users in this tenant to add as co-teachers.'}
            </p>
        );
    }

    const allFilteredPicked =
        filtered.length > 0 && filtered.every((u) => picked.has(Number(u.id)));

    const toggle = (id) =>
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const toggleAllFiltered = () =>
        setPicked((prev) => {
            const next = new Set(prev);
            if (allFilteredPicked) filtered.forEach((u) => next.delete(Number(u.id)));
            else filtered.forEach((u) => next.add(Number(u.id)));
            return next;
        });

    return (
        <div>
            <div className="relative mb-2">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={mode === 'students' ? 'Search students' : 'Search users'}
                    aria-label={mode === 'students' ? 'Search students' : 'Search users'}
                    className={`${INPUT} pl-9`}
                />
            </div>
            {filtered.length > 0 && (
                <button
                    type="button"
                    onClick={toggleAllFiltered}
                    className="text-xs text-purple-300 hover:text-purple-200 mb-2"
                >
                    {allFilteredPicked ? 'Clear all shown' : `Select all ${filtered.length} shown`}
                </button>
            )}
            <div className={`${heightClass} overflow-y-auto space-y-1 pr-1`}>
                {filtered.length === 0 ? (
                    <p className="text-sm text-neutral-500 p-2">No users match “{q}”.</p>
                ) : (
                    filtered.map((u) => {
                        const id = Number(u.id);
                        const on = picked.has(id);
                        return (
                            <button
                                type="button"
                                key={id}
                                onClick={() => toggle(id)}
                                aria-pressed={on}
                                className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                                    on
                                        ? 'bg-purple-600/20 border border-purple-600/50'
                                        : 'bg-neutral-800/50 border border-neutral-700 hover:border-neutral-600'
                                }`}
                            >
                                <span
                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                        on ? 'bg-purple-600 border-purple-600' : 'border-neutral-600'
                                    }`}
                                >
                                    {on && <Check className="w-3 h-3 text-white" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm text-white truncate">
                                        {u.name || u.username}
                                    </span>
                                    <span className="block text-xs text-neutral-400 truncate">
                                        {u.username}
                                        {u.role ? ` · ${roleLabel(u.role)}` : ''}
                                    </span>
                                </span>
                            </button>
                        );
                    })
                )}
            </div>
            <p className="text-xs text-neutral-500 mt-2">
                {picked.size} selected
            </p>
        </div>
    );
}
