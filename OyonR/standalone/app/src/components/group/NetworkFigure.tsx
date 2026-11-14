import { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';
import type { NetworkView } from '@/lib/groupNetworks';
import type { NetworkErrorInfo } from '@/lib/groupVarFit';
import { cn } from '@/lib/cn';
import { download } from './download';

/*
 * One network picture: the SVG string a ladyna painter returned, shown as it
 * is, with an SVG download, its caption (model + calls) and note behind a
 * "?", and its error. Nothing here draws a node or an edge.
 *
 * The string goes into a shadow root, not straight into the page: ladyna's
 * SVGs carry their own <style> (`text{…}`, `.title`, `.label`, …) and fixed
 * marker ids (`mcml-arrow-1`), which, inlined in the document, would restyle
 * the page's other charts and collide between figures. A shadow root keeps
 * each figure's styles and ids to itself and keeps the hover <title>s.
 */

export function NetworkErrorLine({ error }: { error: NetworkErrorInfo }) {
  return (
    <p className="m-0 text-xs text-status-bad">
      {error.source} <code>{error.code}</code> — {error.message}
    </p>
  );
}

function SvgHost({ svg, label }: { svg: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:flex;align-items:center;justify-content:center}svg{display:block;width:100%;height:auto;max-width:100%}</style>${svg}`;
  }, [svg]);
  // flex-1: in a row of figures every box takes the row's height, the drawing centred in it.
  return <div ref={ref} aria-label={label} className="w-full flex-1 overflow-hidden rounded border border-line bg-white" />;
}

export function NetworkFigure({ view, filePrefix }: { view: NetworkView; filePrefix: string }) {
  // The caption (model + calls) and, under a drawn figure, its note are detail:
  // behind the "?". A note standing in for a missing figure, and an error, stay
  // on the page — they say why there is no picture.
  const detailNote = view.svg ? view.note : null;
  return (
    <figure className="m-0 flex h-full min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-medium text-ink-1">{view.title}</span>
          {view.caption || detailNote ? (
            <InfoTip label={view.title}>
              {detailNote ? <p>{detailNote}</p> : null}
              {view.caption ? <p><code>{view.caption}</code></p> : null}
            </InfoTip>
          ) : null}
        </span>
        {view.svg ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => download({ name: `${filePrefix}-${view.file_name}`, content: view.svg ?? '', mime: 'image/svg+xml' })}
          >
            <Download className="size-3.5" aria-hidden="true" /> SVG
          </Button>
        ) : null}
      </div>
      {view.svg ? <SvgHost svg={view.svg} label={view.title} /> : null}
      {view.warning ? <p role="note" className="m-0 text-xs text-ink-2"><span aria-hidden="true">⚠ </span>{view.warning}</p> : null}
      {!view.svg && view.note ? <p className="m-0 rounded border border-dashed border-line p-3 text-xs text-ink-2">{view.note}</p> : null}
      {view.error ? <NetworkErrorLine error={view.error} /> : null}
    </figure>
  );
}

/** Figures in a responsive grid: one column, or two from lg up. */
export function Figures({ views, prefix, columns = 2 }: { views: NetworkView[]; prefix: string; columns?: 1 | 2 }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4', columns === 2 && 'lg:grid-cols-2')}>
      {views.map((v) => <NetworkFigure key={v.id} view={v} filePrefix={prefix} />)}
    </div>
  );
}
