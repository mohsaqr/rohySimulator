import { useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { writingActEvents, writingActSequences } from 'oyon';
import type { EmotionWindow } from 'oyon';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineSelect } from '@/components/group/InlineSelect';
import { useChannelOptions } from '@/lib/channelOptions';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useStoredEvents } from '@/lib/storedEvents';
import { buildSessionSequences, buildEventSequences } from '@/lib/tnaPooling';
import { channelUnit, channelLabel } from '@/lib/analyticsChannel';
import { useChannelStore } from '@/lib/channelStore';
import { loadDemoData } from '@/legacy/demoFixture.js';

/*
 * A person's state sequences, one per session, for the Analyze pages built on
 * ladyna (Patterns (next), Dynamics (next)): emotion windows, or the
 * signal-event log for every other channel, with the channel picker and the
 * empty states the old tabs had. The channel is shared through channelStore,
 * so it carries across the tabs. The page renders its sections from
 * `children(sequences, meta)` and puts `meta.lead` (the channel picker) first
 * on its own toolbar row, so the picker takes no row of its own.
 */
export interface SessionSequencesMeta {
  channel: string;
  /** What one state is, e.g. "one emotion window". */
  unit: string;
  /** The channel controls, for the start of the page's toolbar. */
  lead: ReactNode;
}

export function SessionSequences({ windows, isLoading = false, children }: {
  windows: EmotionWindow[];
  isLoading?: boolean;
  children: (sequences: (string | null)[][], meta: SessionSequencesMeta) => ReactNode;
}) {
  const { data: events = [], isLoading: eventsLoading } = useStoredEvents();
  const queryClient = useQueryClient();
  const channel = useChannelStore((s) => s.channel);
  const setChannel = useChannelStore((s) => s.setChannel);
  const writingLevel = useChannelStore((s) => s.writingLevel);
  const setWritingLevel = useChannelStore((s) => s.setWritingLevel);
  const loading = channel === 'emotion' ? isLoading : eventsLoading;
  // Offer only the channels this browser has records for, once both stores have loaded.
  const channelOptions = useChannelOptions(channel, isLoading || eventsLoading ? null : { windows, events });
  const channelEvents = useMemo(
    () => (channel === 'all' ? events : channel === 'writing' ? writingActEvents(events) : events.filter((event) => event.modality === channel)),
    [events, channel],
  );
  const recordCount = channel === 'emotion' ? windows.length : channelEvents.length;
  const unit = channelUnit(channel);

  const sequences = useMemo(
    () => (channel === 'emotion'
      ? buildSessionSequences(windows)
      : channel === 'writing' ? writingActSequences(events, { level: writingLevel })
        : buildEventSequences(events, channel === 'all' ? null : channel)) as (string | null)[][],
    [windows, events, channel, writingLevel],
  );

  const picker = (
    <>
      <InlineSelect label="channel" value={channel} options={channelOptions} onChange={setChannel} />
      {channel === 'writing' ? (
        <div className="inline-flex overflow-hidden rounded border border-line text-xs" role="group" aria-label="Grain of the writing acts">
          {(['main', 'detail'] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={writingLevel === level}
              onClick={() => setWritingLevel(level)}
              className={writingLevel === level ? 'bg-status-info-dim px-2.5 py-1 font-medium text-status-info' : 'px-2.5 py-1 text-ink-2 hover:bg-surface-2'}
            >
              {level === 'main' ? 'Main acts' : 'With detail'}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
  const pickerRow = <div className="flex flex-wrap items-center gap-2">{picker}</div>;

  if (loading) {
    return <div className="flex flex-col gap-4">{pickerRow}<EmptyState title="Loading stored data…" /></div>;
  }
  if (recordCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        {pickerRow}
        <EmptyState
          title={`No stored ${unit.plural} yet`}
          description={channel === 'emotion'
            ? 'Capture a real session, or load synthetic demo data.'
            : `Capture a session with ${channelLabel(channel)} activity, or switch channels.`}
          action={channel === 'emotion' ? (
            <Button variant="primary" size="sm" onClick={() => { loadDemoData(); queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY }); }}>
              <Database className="size-3.5" aria-hidden="true" /> Load demo data
            </Button>
          ) : undefined}
        />
      </div>
    );
  }
  return <>{children(sequences, { channel, unit: channel === 'emotion' ? 'one emotion window' : `one ${unit.singular}`, lead: picker })}</>;
}
