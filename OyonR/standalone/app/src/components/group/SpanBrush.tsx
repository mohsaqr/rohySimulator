import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { fmtTime } from './groupChart';

/*
 * The brush: one start/end time span that filters every panel. The page
 * recomputes on the filtered table, so the sliders commit after a short pause
 * instead of on every pixel of a drag.
 */

export interface BrushSpan {
  start_s: number;
  end_s: number;
}

export function SpanBrush({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: BrushSpan;
  onChange: (span: BrushSpan | null) => void;
}) {
  const [draft, setDraft] = useState<BrushSpan>(value);
  useEffect(() => setDraft(value), [value.start_s, value.end_s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (draft.start_s === value.start_s && draft.end_s === value.end_s) return undefined;
    const id = window.setTimeout(() => onChange(draft), 350);
    return () => window.clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const full = draft.start_s <= min && draft.end_s >= max;
  const slider = (which: 'start' | 'end') => (
    <input
      type="range"
      className="h-4 min-w-24 flex-1"
      min={min}
      max={max}
      step={step}
      value={which === 'start' ? draft.start_s : draft.end_s}
      aria-label={which === 'start' ? 'Span start (seconds)' : 'Span end (seconds)'}
      onChange={(e) => {
        const v = Number(e.target.value);
        setDraft((d) => (which === 'start'
          ? { start_s: Math.min(v, d.end_s - step), end_s: d.end_s }
          : { start_s: d.start_s, end_s: Math.max(v, d.start_s + step) }));
      }}
    />
  );
  return (
    <div className="flex min-w-72 flex-1 items-center gap-2 text-xs" title="Time span: every panel and network is recomputed on this span">
      <span className="text-ink-2">span</span>
      {slider('start')}
      {slider('end')}
      <span className="w-28 text-right tabular-nums text-ink-1">{fmtTime(draft.start_s)} – {fmtTime(draft.end_s)}</span>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={full} onClick={() => onChange(null)}>All</Button>
    </div>
  );
}
