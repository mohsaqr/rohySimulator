// FilterBar — shared contextual filter bar for the log tables.
//
// Every log surface (Activity / Sessions / System / Chat / Moments) renders
// this ABOVE its LogGrid. The point: nobody should have to know a numeric
// user_id / case_id / session_id to filter — they pick a student by NAME,
// a case by TITLE, an attempt by a readable label. Ids stay internal (the
// option `value`); labels are what humans see.
//
// The component is fully controlled and dumb:
//
//   <FilterBar
//       filters={[{ key, label, options: [{ value, label, count? }] }]}
//       values={{ [key]: string, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }}
//       onChange={(key, valueOrNull) => …}   // null clears one filter
//       onClearAll={() => …}
//       showDates={true}                      // renders From / To date inputs
//   />
//
// Each filter renders as an in-house searchable combobox (input + filtered
// list, ArrowUp/Down + Enter/Escape, click-outside close) — no new npm
// dependency. Active filters show as removable chips + a "Clear all".
//
// The pure helpers exported below (deriveOptions, applyClientFilters,
// filterByDateRange, deriveSessionOptions, uniqueValues) are what the
// tables use to build options from their already-loaded rows and to apply
// the client-side filters — one copy of the logic, unit-tested in
// FilterBar.test.jsx.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Pure helpers (exported for the tables + tests)
// ---------------------------------------------------------------------------

const labelSort = (a, b) =>
    String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: 'base' });

/** Normalize a string option to `{ value, label }`. */
function normalizeOption(o) {
    if (o !== null && typeof o === 'object') {
        return { ...o, value: String(o.value), label: String(o.label ?? o.value) };
    }
    return { value: String(o), label: String(o) };
}

/**
 * Distinct options derived from loaded rows.
 *
 * @param {Array<object>} rows
 * @param {(row) => any} getValue  internal value (e.g. row.user_id)
 * @param {(row) => any} [getLabel] human label (e.g. row.username); defaults to the value
 * @returns {Array<{value: string, label: string, count: number}>} label-sorted
 */
export function deriveOptions(rows, getValue, getLabel = null) {
    const map = new Map();
    (rows || []).forEach((row) => {
        const raw = getValue(row);
        if (raw === null || raw === undefined || raw === '') return;
        const values = Array.isArray(raw) ? raw : [raw];
        values.forEach((one) => {
            if (one === null || one === undefined || one === '') return;
            const value = String(one);
            const existing = map.get(value);
            if (existing) {
                existing.count += 1;
            } else {
                const label = getLabel ? getLabel(row, value) : one;
                map.set(value, { value, label: String(label ?? one), count: 1 });
            }
        });
    });
    return [...map.values()].sort(labelSort);
}

/** Distinct raw values of one field — for LogGrid per-column select filters. */
export function uniqueValues(rows, getValue) {
    const seen = new Set();
    (rows || []).forEach((row) => {
        const v = getValue(row);
        if (v !== null && v !== undefined && v !== '') seen.add(String(v));
    });
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Keep the rows matching every ACTIVE equality filter.
 *
 * @param {Array<object>} rows
 * @param {Object<string, (row) => any>} accessors  filter key → row accessor
 * @param {Object<string, string>} values           filter key → selected value ('' = inactive)
 */
export function applyClientFilters(rows, accessors, values) {
    const active = Object.entries(accessors)
        .filter(([key]) => values[key] !== undefined && values[key] !== null && values[key] !== '');
    if (active.length === 0) return rows;
    return rows.filter((row) =>
        active.every(([key, get]) => {
            const raw = get(row);
            if (Array.isArray(raw)) return raw.map(String).includes(String(values[key]));
            return String(raw ?? '') === String(values[key]);
        }));
}

/**
 * Keep the rows whose timestamp falls inside the [from, to] date range
 * (native date-input strings, `to` inclusive of that whole day). Rows with
 * unparseable timestamps are kept — a filter must never silently hide data
 * it can't interpret.
 */
export function filterByDateRange(rows, getTs, values) {
    const { from, to } = values || {};
    if (!from && !to) return rows;
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T00:00:00`).getTime() + 86_400_000 : null;
    return rows.filter((row) => {
        const t = new Date(getTs(row)).getTime();
        if (Number.isNaN(t)) return true;
        if (fromMs !== null && !Number.isNaN(fromMs) && t < fromMs) return false;
        if (toMs !== null && !Number.isNaN(toMs) && t >= toMs) return false;
        return true;
    });
}

/**
 * Options for the OTHER-filters-applied contextual dropdown: derive `key`'s
 * options from the rows that already match every other active filter, so
 * counts and choices narrow as the user drills in.
 */
export function contextualOptions(rows, accessors, values, key, getLabel = null) {
    const others = { ...accessors };
    delete others[key];
    return deriveOptions(applyClientFilters(rows, others, values), accessors[key], getLabel);
}

/** "Jun 30, 14:02" — compact session-start label component. */
export function fmtSessionTime(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Session/attempt options with human labels, derived from loaded rows.
 * Label shape: "Attempt 2 — Chest pain — Jun 30, 14:02" (attempt falls back
 * to "Session #id"; case / time parts are skipped when unknown). The time is
 * the EARLIEST loaded row of that session, i.e. as close to the session
 * start as the loaded page allows. Sorted most-recent first.
 *
 * @param {Array<object>} rows
 * @param {{ id: (row) => any, ts?: (row) => any, attempt?: (row) => any, caseName?: (row) => any }} accessors
 */
export function deriveSessionOptions(rows, { id, ts, attempt, caseName }) {
    const map = new Map();
    (rows || []).forEach((row) => {
        const sid = id(row);
        if (sid === null || sid === undefined || sid === '') return;
        const key = String(sid);
        const t = ts ? new Date(ts(row)).getTime() : NaN;
        const existing = map.get(key);
        if (existing) {
            existing.count += 1;
            if (!Number.isNaN(t) && (existing.minTs === null || t < existing.minTs)) existing.minTs = t;
        } else {
            map.set(key, {
                value: key,
                count: 1,
                minTs: Number.isNaN(t) ? null : t,
                attempt: attempt ? attempt(row) : null,
                caseName: caseName ? (caseName(row) ?? null) : null,
            });
        }
    });
    return [...map.values()]
        .sort((a, b) => (b.minTs ?? -Infinity) - (a.minTs ?? -Infinity))
        .map((s) => ({
            value: s.value,
            count: s.count,
            label: [
                s.attempt !== null && s.attempt !== undefined ? `Attempt ${s.attempt}` : `Session #${s.value}`,
                s.caseName || null,
                s.minTs !== null ? fmtSessionTime(s.minTs) : null,
            ].filter(Boolean).join(' — '),
        }));
}

/**
 * Remember every option ever seen across reloads. Needed when a filter is a
 * SERVER param: picking "Alice" refetches only Alice's rows, and without
 * memory the Student dropdown would collapse to just Alice, making it
 * impossible to switch. Remembered-but-absent options keep their label and
 * drop their (now unknowable) count.
 */
export function useOptionMemory(options) {
    const seenRef = useRef(new Map());
    return useMemo(() => {
        options.forEach((o) => seenRef.current.set(String(o.value), String(o.label)));
        const current = new Map(options.map((o) => [String(o.value), o]));
        return [...seenRef.current.entries()]
            .map(([value, label]) => current.get(value) ?? { value, label })
            .sort(labelSort);
    }, [options]);
}

// ---------------------------------------------------------------------------
// Combobox — in-house searchable dropdown (no npm deps)
// ---------------------------------------------------------------------------

function optionText(o) {
    return o.count !== undefined && o.count !== null ? `${o.label} (${o.count})` : o.label;
}

function Combobox({ filterKey, label, options, value, onChange, width = 'w-44' }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const rootRef = useRef(null);
    const listRef = useRef(null);

    const selected = options.find((o) => String(o.value) === String(value)) || null;

    const q = query.trim().toLowerCase();
    const visible = q ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options;

    // Click-outside closes without changing the selection.
    useEffect(() => {
        if (!open) return undefined;
        const onDocMouseDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, [open]);

    // Keep the highlighted row scrolled into view.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.children[highlight];
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [open, highlight]);

    const openList = useCallback(() => {
        setQuery('');
        setHighlight(0);
        setOpen(true);
    }, []);

    const pick = useCallback((option) => {
        onChange(option ? option.value : null);
        setOpen(false);
        setQuery('');
    }, [onChange]);

    const onKeyDown = (e) => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            openList();
            return;
        }
        if (!open) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, visible.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (visible[highlight]) pick(visible[highlight]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setQuery('');
        }
    };

    return (
        <div ref={rootRef} className={`relative ${width}`} data-testid={`filterbar-${filterKey}`}>
            <label className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">
                {label}
            </label>
            <div className="relative">
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={label}
                    value={open ? query : (selected?.label ?? '')}
                    placeholder={open ? 'Type to search…' : `All ${label.toLowerCase()}`}
                    onFocus={openList}
                    onClick={() => { if (!open) openList(); }}
                    onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                    onKeyDown={onKeyDown}
                    className="w-full pl-2 pr-10 py-1.5 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 placeholder-neutral-600 focus:border-cyan-600 focus:outline-none"
                />
                {selected && !open && (
                    <button
                        type="button"
                        aria-label={`Clear ${label} filter`}
                        onMouseDown={(e) => { e.preventDefault(); pick(null); }}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-200"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
                <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            </div>
            {open && (
                <ul
                    ref={listRef}
                    role="listbox"
                    aria-label={`${label} options`}
                    className="absolute left-0 right-0 top-full mt-1 z-40 max-h-56 overflow-auto bg-neutral-950 border border-neutral-700 rounded shadow-lg py-1"
                >
                    {visible.length === 0 && (
                        <li className="px-2 py-1 text-xs text-neutral-500 italic">No matches</li>
                    )}
                    {visible.map((o, i) => {
                        const isSelected = String(o.value) === String(value);
                        return (
                            <li
                                key={o.value}
                                role="option"
                                aria-selected={isSelected}
                                onMouseEnter={() => setHighlight(i)}
                                // mousedown (not click) so the input's blur doesn't race the pick
                                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                                className={`px-2 py-1 text-xs cursor-pointer ${
                                    i === highlight ? 'bg-cyan-700/40 text-white' : 'text-neutral-200'
                                } ${isSelected ? 'font-semibold' : ''}`}
                            >
                                {optionText(o)}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export default function FilterBar({
    filters = [],            // [{ key, label, options, width? }]
    values = {},              // { [key]: string, from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
    onChange,                 // (key, valueOrNull) => void
    onClearAll,               // () => void
    showDates = true,
}) {
    const normalized = filters.map((f) => ({
        ...f,
        options: (f.options || []).map(normalizeOption),
    }));

    // Active chips: one per set filter, plus From / To when set.
    const chips = [];
    normalized.forEach((f) => {
        const v = values[f.key];
        if (v === undefined || v === null || v === '') return;
        const opt = f.options.find((o) => String(o.value) === String(v));
        chips.push({ key: f.key, text: `${f.label}: ${opt ? opt.label : v}` });
    });
    if (showDates && values.from) chips.push({ key: 'from', text: `From: ${values.from}` });
    if (showDates && values.to) chips.push({ key: 'to', text: `To: ${values.to}` });

    return (
        <div className="rohy-admin-light border-b border-neutral-700 px-3 pt-2 pb-2">
            <div className="flex flex-wrap items-end gap-2">
                {normalized.map((f) => (
                    <Combobox
                        key={f.key}
                        filterKey={f.key}
                        label={f.label}
                        options={f.options}
                        value={values[f.key] ?? ''}
                        onChange={(v) => onChange(f.key, v)}
                        width={f.width}
                    />
                ))}
                {showDates && (
                    <>
                        <div data-testid="filterbar-from">
                            <label className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">
                                From
                            </label>
                            <input
                                type="date"
                                aria-label="From date"
                                value={values.from ?? ''}
                                onChange={(e) => onChange('from', e.target.value || null)}
                                className="px-2 py-1 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 [color-scheme:dark] focus:border-cyan-600 focus:outline-none"
                            />
                        </div>
                        <div data-testid="filterbar-to">
                            <label className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">
                                To
                            </label>
                            <input
                                type="date"
                                aria-label="To date"
                                value={values.to ?? ''}
                                onChange={(e) => onChange('to', e.target.value || null)}
                                className="px-2 py-1 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 [color-scheme:dark] focus:border-cyan-600 focus:outline-none"
                            />
                        </div>
                    </>
                )}
            </div>
            {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {chips.map((chip) => (
                        <span
                            key={chip.key}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-900/40 border border-cyan-800 text-cyan-200 rounded-full text-[11px]"
                        >
                            {chip.text}
                            <button
                                type="button"
                                aria-label={`Remove ${chip.text} filter`}
                                onClick={() => onChange(chip.key, null)}
                                className="hover:text-white"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="px-2 py-0.5 text-[11px] text-neutral-400 hover:text-white underline underline-offset-2"
                    >
                        Clear all
                    </button>
                </div>
            )}
        </div>
    );
}
