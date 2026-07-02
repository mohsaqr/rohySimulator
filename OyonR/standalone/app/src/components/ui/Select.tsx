import { type ChangeEvent } from 'react';
import { cn } from '@/lib/cn';

/*
 * <Select> — native <select> wrapped in our card pattern. Tier-3 dropdown
 * via Radix isn't necessary here; native is keyboard-accessible, supports
 * type-ahead, and matches the Slider's visual rhythm on the Settings page.
 */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  hint?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: SelectProps<T>) {
  const handle = (e: ChangeEvent<HTMLSelectElement>) =>
    onChange(e.target.value as T);
  const active = options.find((o) => o.value === value);
  return (
    <label
      className={cn(
        'flex flex-col gap-1.5 rounded border border-line bg-surface-0 p-3',
        disabled && 'opacity-60',
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-ink-2">
        {label}
      </span>
      <select
        value={value}
        onChange={handle}
        disabled={disabled}
        className="rounded border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {active?.hint ? (
        <span className="text-xs text-ink-3">{active.hint}</span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}
