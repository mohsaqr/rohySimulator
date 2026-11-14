import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { HubState } from '@/lib/groupStore';

/*
 * Sources: a bundle file (hub export `oyon-group-bundle-v1`, a windows array,
 * or long-table rows), the synthetic demo (ladyna simulateGroup; one group or six), or live
 * windows from a group hub over its WebSocket.
 */

export function SourcePanel({
  onFile,
  onDemo,
  onDemoGroups,
  hub,
  onConnect,
  onDisconnect,
  error,
}: {
  onFile: (text: string, name: string) => void;
  onDemo: () => void;
  onDemoGroups: () => void;
  hub: HubState;
  onConnect: (hubUrl: string, groupId: string) => void;
  onDisconnect: () => void;
  error: string | null;
}) {
  const [hubUrl, setHubUrl] = useState('http://127.0.0.1:8787');
  const [groupId, setGroupId] = useState('');
  const live = hub.status === 'open' || hub.status === 'connecting';

  const readFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => onFile(text, file.name), (err: Error) => onFile('', `${file.name}: ${err.message}`));
  };

  const input = 'rounded border border-line bg-surface-1 px-2 py-1 text-xs text-ink-0';
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-line px-2.5 py-1.5 text-ink-1 hover:bg-surface-2">
          <span>Load bundle…</span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={readFile} />
        </label>
        <Button size="sm" variant="outline" onClick={onDemo}>Load synthetic demo</Button>
        <Button size="sm" variant="outline" onClick={onDemoGroups}>Demo, 6 groups</Button>
        <span className="text-ink-3">hub export (oyon-group-bundle-v1), a windows array, or timeline rows</span>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (live) onDisconnect();
          else onConnect(hubUrl, groupId);
        }}
      >
        <span className="font-medium uppercase tracking-wider text-ink-2">Live</span>
        <input className={cn(input, 'w-56')} value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} aria-label="Hub URL" disabled={live} />
        <input className={cn(input, 'w-28')} value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="group id" aria-label="Group id" disabled={live} />
        <Button size="sm" variant={live ? 'danger' : 'secondary'} type="submit">{live ? 'Disconnect' : 'Connect'}</Button>
        {hub.status !== 'idle' ? (
          <span className="tabular-nums text-ink-2">
            {hub.status} · {hub.n_windows} windows
            {hub.replay_duplicates ? ` · ${hub.replay_duplicates} replay duplicates ignored` : ''}
            {hub.live_replaced ? ` · ${hub.live_replaced} re-sent windows replaced` : ''}
          </span>
        ) : null}
      </form>
      {hub.error ? <p className="m-0 text-status-bad">{hub.error}</p> : null}
      {error ? <p className="m-0 text-status-bad">{error}</p> : null}
    </div>
  );
}
