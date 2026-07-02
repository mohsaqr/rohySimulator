import { cn } from '@/lib/cn';

/*
 * <Toggle> — boolean switch styled to match Slider/Select on the Settings
 * page. Implemented as a controlled checkbox so it's accessible (Space
 * toggles, keyboard focusable).
 */

export interface ToggleProps {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, checked, hint, onChange, disabled }: ToggleProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-3 rounded border border-line bg-surface-0 p-3',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-2">
          {label}
        </span>
        {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-status-ok' : 'bg-surface-3',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={label}
        />
        <span
          className={cn(
            'inline-block size-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
          aria-hidden="true"
        />
      </span>
    </label>
  );
}
