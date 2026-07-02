import { useEffect, useRef } from 'react';

/**
 * LegacyCanvas / LegacyContainer — thin React wrappers that mount a DOM
 * node and hand it to a legacy render function. We do this rather than
 * re-implementing the math in React: the legacy code in src/legacy/dashboard.js
 * is the proven, debugged source of truth (ported byte-identically from
 * standalone/logs-dashboard.js).
 */

export interface LegacyCanvasProps {
  /** Called with the canvas after mount and on every `deps` change. */
  draw: (canvas: HTMLCanvasElement) => void;
  /** Re-run draw whenever any value in this array changes. */
  deps: ReadonlyArray<unknown>;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function LegacyCanvas({ draw, deps, width = 900, height = 260, className, style }: LegacyCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    draw(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      style={{ width: '100%', display: 'block', ...style }}
    />
  );
}

export interface LegacyContainerProps {
  /** Called with the div after mount and on every `deps` change. */
  render: (el: HTMLDivElement) => void;
  deps: ReadonlyArray<unknown>;
  className?: string;
  style?: React.CSSProperties;
}

export function LegacyContainer({ render, deps, className, style }: LegacyContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    render(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div ref={ref} className={className} style={style} />;
}

export interface LegacyTableBodyProps {
  render: (tbody: HTMLTableSectionElement) => void;
  deps: ReadonlyArray<unknown>;
  headers: ReadonlyArray<{ label: string; width?: string; align?: 'left' | 'right' | 'center' }>;
  className?: string;
}

export function LegacyTable({ render, deps, headers, className }: LegacyTableBodyProps) {
  const ref = useRef<HTMLTableSectionElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    render(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <div className="overflow-auto">
      <table className={className ?? 'w-full border-collapse text-xs'}>
        <thead className="sticky top-0 bg-surface-2 text-ink-2">
          <tr>
            {headers.map((h) => (
              <th
                key={h.label}
                style={{ width: h.width, textAlign: h.align ?? 'left' }}
                className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider"
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={ref} />
      </table>
    </div>
  );
}
