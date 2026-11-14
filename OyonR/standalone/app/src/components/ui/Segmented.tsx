import { cn } from '@/lib/cn';

/*
 * A compact segmented tab row (role tablist): the view switch the group
 * Dynamics page and both Patterns pages share.
 */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded border border-line bg-surface-0 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium',
            o.id === value ? 'bg-surface-3 text-ink-0' : 'text-ink-2 hover:bg-surface-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
