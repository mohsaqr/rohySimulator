import { type ChangeEvent } from 'react';
import { cn } from '@/lib/cn';

/*
 * <Slider> — labeled range input with a tabular-numeric value readout
 * and an optional unit/hint slot. Used across the Settings page so every
 * range control feels identical.
 *
 * Native <input type="range"> for accessibility — keyboard arrows step,
 * Home/End jump to bounds, screen readers announce value automatically.
 */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  hint,
  format,
  onChange,
  disabled,
}: SliderProps) {
  const handle = (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value));
  const display = format ? format(value) : String(value);
  return (
    <label
      className={cn(
        'flex flex-col gap-1.5 rounded border border-line bg-surface-0 p-3',
        disabled && 'opacity-60',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-2">
          {label}
        </span>
        <span className="tabular-nums text-sm font-medium text-ink-0">
          {display}
          {unit ? <span className="ml-1 text-xs text-ink-2">{unit}</span> : null}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handle}
        disabled={disabled}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-status-info"
        aria-label={label}
      />
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}
