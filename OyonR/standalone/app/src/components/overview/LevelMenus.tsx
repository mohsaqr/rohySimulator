import { Check } from 'lucide-react';
import { MenuPopover } from '@/components/shell/MenuPopover';
import { useBridge } from '@/lib/hostBridge';
import { useLevelSelection, type LevelView } from '@/lib/levelSelection';
import { cn } from '@/lib/cn';

/*
 * LevelMenus — the aggregation levels as a row of drop-downs in the top bar:
 *
 *     Class  Writing 101 ▾    Group  All ▾    Person  All ▾    Session  All ▾
 *
 * One drop-down per level the records carry, widest first. Each lists that
 * level's units; choosing some narrows the whole dashboard to them, and the
 * levels to its right then list only what is inside the choice (pick a group
 * and Person lists that group's people). "All" widens it again.
 *
 * On the Overview page a last drop-down, "View by", picks which level the
 * table lists; left on Auto it follows the drill-down.
 *
 * The trigger states the choice in words and a chosen unit carries a check
 * mark, so nothing depends on colour.
 */

function summaryOf(level: LevelView): string {
  // A level with a single unit has nothing to choose between: name it.
  if (level.selected === null) return level.rows.length === 1 ? level.rows[0].label : 'All';
  const labels = level.selected.map((id) => level.rows.find((row) => row.key === id)?.label ?? id);
  return labels.length === 1 ? labels[0] : `${labels.length} ${level.plural.toLowerCase()}`;
}

function contents(level: LevelView, row: LevelView['rows'][number]): string {
  if (level.key === 'session_id') return row.userLabel ?? '';
  const parts = [];
  if (level.key !== 'user_id') parts.push(`${row.people} ${row.people === 1 ? 'person' : 'people'}`);
  parts.push(`${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}`);
  return parts.join(' · ');
}

function Option({
  checked,
  onClick,
  label,
  detail,
  mono = false,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2',
        checked ? 'text-ink-0' : 'text-ink-1',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Check className="size-3.5 text-status-info" aria-hidden="true" /> : null}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', checked && 'font-medium', mono && 'font-mono text-xs')}>
        {label}
      </span>
      {detail ? <span className="shrink-0 text-xs tabular-nums text-ink-3">{detail}</span> : null}
    </button>
  );
}

function LevelMenu({ level, select }: { level: LevelView; select: (key: string, ids: string[] | null) => void }) {
  const chosen = new Set(level.selected ?? []);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    select(level.key, next.size > 0 ? [...next] : null);
  };
  return (
    <MenuPopover
      ariaLabel={`${level.label}: ${summaryOf(level)}`}
      active={level.selected !== null}
      label={
        <>
          <span className="text-ink-3">{level.label}</span>{' '}
          <span className="inline-block max-w-40 truncate align-bottom font-medium">{summaryOf(level)}</span>
        </>
      }
      panelClassName="w-80"
    >
      {() => (
        <div role="listbox" aria-multiselectable="true" aria-label={level.plural}>
          <Option
            checked={level.selected === null}
            onClick={() => select(level.key, null)}
            label={`All ${level.plural.toLowerCase()}`}
            detail={level.rows.length.toLocaleString()}
          />
          <div className="my-1 border-t border-line" />
          {level.rows.map((row) => (
            <Option
              key={row.key}
              checked={chosen.has(row.key)}
              onClick={() => toggle(row.key)}
              label={row.key === '__none__' ? `No ${level.label.toLowerCase()}` : row.label}
              detail={contents(level, row)}
              mono={level.key === 'session_id'}
            />
          ))}
        </div>
      )}
    </MenuPopover>
  );
}

/**
 * The level the Overview table lists when "View by" is on Auto: the widest
 * level that still splits what is in view — it has more than one unit and
 * is not narrowed to a single one. Falls back to the narrowest level.
 */
export function autoLevel(levels: LevelView[]): LevelView | undefined {
  return (
    levels.find((level) => level.units > 1 && !(level.selected !== null && level.selected.length === 1)) ??
    levels[levels.length - 1]
  );
}

export function LevelMenus({ viewBy = false }: { viewBy?: boolean }) {
  const { levels, select } = useLevelSelection();
  const overviewLevel = useBridge((s) => s.overviewLevel);
  const setOverviewLevel = useBridge((s) => s.setOverviewLevel);
  if (levels.length === 0) return null;

  // A level the reader cannot narrow here (the one session of a session
  // embed) has nothing to offer in a drop-down.
  const menus = levels.filter((level) => level.canNarrow);
  const auto = autoLevel(levels);
  const shown = levels.find((level) => level.id === overviewLevel) ?? auto;

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Aggregation levels">
      {menus.map((level) => (
        <LevelMenu key={level.id} level={level} select={select} />
      ))}
      {viewBy && levels.length > 1 && shown ? (
        <MenuPopover
          ariaLabel={`View by: ${shown.plural}`}
          label={
            <>
              <span className="text-ink-3">View by</span>{' '}
              <span className="font-medium">{shown.plural}</span>
            </>
          }
          panelClassName="w-64"
        >
          {(close) => (
            <div role="listbox" aria-label="View by">
              <Option
                checked={overviewLevel === null}
                onClick={() => { setOverviewLevel(null); close(); }}
                label="Auto"
                detail={auto ? auto.plural.toLowerCase() : undefined}
              />
              <div className="my-1 border-t border-line" />
              {levels.map((level) => (
                <Option
                  key={level.id}
                  checked={overviewLevel === level.id}
                  onClick={() => { setOverviewLevel(level.id); close(); }}
                  label={level.plural}
                  detail={level.units.toLocaleString()}
                />
              ))}
            </div>
          )}
        </MenuPopover>
      ) : null}
    </div>
  );
}
