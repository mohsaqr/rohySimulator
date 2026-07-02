import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FilterX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFilterStore } from '@/lib/filterStore';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { summarizeSessions } from '@/lib/sessions';
import { distinctUsers, type FilterScope } from '@/lib/filterWindows';
import { shortDateTime } from '@/legacy/dashboard.js';

/*
 * FilterBar — the analytics scope every dashboard under /analyze and
 * /sessions inherits. Three controls:
 *
 *   1. Scope: Current (live capture session) / Past / All (aggregated).
 *   2. Sessions: optional multi-select narrowing.
 *   3. Users: optional multi-select narrowing (hidden when only one user
 *      exists in the data — single-user installs never see it).
 *
 * Options derive from the UNFILTERED window set so narrowing one dimension
 * never hides the others' choices.
 */

const SCOPES: Array<{ value: FilterScope; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

/*
 * FilterBar — the standalone bordered scope strip (full app). The embed uses
 * <FilterControls compact /> inline inside the unified EmbedHeader instead, so
 * the controls live in one component and both surfaces stay in sync.
 */
export function FilterBar() {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-1 px-4 py-2">
      <FilterControls />
    </div>
  );
}

export function FilterControls({ compact = false }: { compact?: boolean }) {
  const { allWindows, filtered, currentSessionId } = useFilteredWindows();
  const scope = useFilterStore((s) => s.scope);
  const sessionIds = useFilterStore((s) => s.sessionIds);
  const userIds = useFilterStore((s) => s.userIds);
  const setScope = useFilterStore((s) => s.setScope);
  const setSessionIds = useFilterStore((s) => s.setSessionIds);
  const setUserIds = useFilterStore((s) => s.setUserIds);
  const reset = useFilterStore((s) => s.reset);

  const sessions = useMemo(() => summarizeSessions(allWindows), [allWindows]);
  const users = useMemo(() => distinctUsers(allWindows), [allWindows]);

  const sessionOptions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => b.windowEnd - a.windowEnd)
        .map((s) => ({
          id: s.sessionId,
          label: `${s.sessionId.length > 28 ? `${s.sessionId.slice(0, 28)}…` : s.sessionId} · ${s.windowCount}w · ${shortDateTime(s.windowEnd)}`,
        })),
    [sessions],
  );

  const filtersActive = scope !== 'all' || sessionIds !== null || userIds !== null;

  // The Current/Past/All scope only means something while a capture session is
  // live: "Current" matches that session, "Past" excludes it. With no live
  // session (a retrospective viewer, or standalone between captures) the control
  // degenerates — "Current" filters to nothing and "Past" is identical to "All"
  // — so we hide it. Reset any stale current/past selection (left over from a
  // capture that has since ended) back to All first, so the dashboards can't get
  // stuck on an empty or redundant scope with no visible control to fix it.
  const showScope = Boolean(currentSessionId);
  useEffect(() => {
    if (!currentSessionId && scope !== 'all') setScope('all');
  }, [currentSessionId, scope, setScope]);

  return (
    <>
      {showScope ? (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Scope
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Window scope">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setScope(s.value)}
                className={cn(
                  'px-2.5 py-1 text-xs transition-colors',
                  scope === s.value
                    ? 'bg-accent text-white'
                    : 'bg-surface-0 text-ink-2 hover:bg-surface-2',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <MultiSelect
        label="Sessions"
        options={sessionOptions}
        selected={sessionIds}
        onChange={setSessionIds}
        emptyHint="No sessions yet"
      />

      {users.length > 1 ? (
        <MultiSelect
          label="Users"
          options={users.map((u) => ({ id: u, label: u }))}
          selected={userIds}
          onChange={setUserIds}
          emptyHint="No users"
        />
      ) : null}

      <span className={cn('text-[11px] tabular-nums text-ink-3', !compact && 'ml-auto')}>
        {filtered.length} / {allWindows.length} windows
      </span>
      {filtersActive ? (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-2 hover:bg-surface-2 hover:text-ink-0"
          aria-label="Reset filters"
        >
          <FilterX className="size-3" aria-hidden="true" />
          Reset
        </button>
      ) : null}
    </>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  emptyHint,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[] | null;
  onChange: (ids: string[] | null) => void;
  emptyHint: string;
}) {
  const [open, setOpen] = useState(false);
  const count = selected?.length ?? 0;

  const toggle = (id: string) => {
    const current = new Set(selected ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    onChange(current.size > 0 ? [...current] : null);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs transition-colors',
          count > 0 ? 'bg-accent/10 text-ink-0' : 'bg-surface-0 text-ink-2 hover:bg-surface-2',
        )}
        aria-expanded={open}
      >
        {label}
        {count > 0 ? <span className="font-semibold tabular-nums">({count})</span> : null}
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-line bg-surface-1 p-1.5 shadow-popover">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-ink-3">{emptyHint}</div>
          ) : (
            options.map((opt) => {
              const checked = selected?.includes(opt.id) ?? false;
              return (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-ink-1 hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    className="size-3 accent-[var(--accent)]"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              );
            })
          )}
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="mt-1 w-full rounded px-2 py-1 text-left text-[11px] text-ink-3 hover:bg-surface-2"
            >
              Clear selection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
