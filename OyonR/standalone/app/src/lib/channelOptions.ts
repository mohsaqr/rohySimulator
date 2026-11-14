import { useMemo } from 'react';
import { recordKindsOf } from 'oyon';
import type { EmotionWindow, SignalEvent } from 'oyon';
import { useBridge } from './hostBridge';
import { CHANNEL_OPTIONS, type AnalyticsChannel } from './analyticsChannel';
import { offeredChannels } from './channelOffer.js';
import type { SelectOption } from '@/components/ui/Select';

/*
 * The channels the picker offers: all of them, those without records disabled (offeredChannels).
 * Over a host feed the records are the feed's — a host that runs no code is
 * not offered "Code runs". Without one they are the windows and events stored
 * in this browser, passed as `stored` once both have loaded; while they load
 * (`stored` null) every channel is offered.
 */
export function useChannelOptions(
  current: AnalyticsChannel,
  stored: { windows: EmotionWindow[]; events: SignalEvent[] } | null = null,
): SelectOption<AnalyticsChannel>[] {
  const fed = useBridge((s) => s.hostRecords);
  // The arrays, not the wrapper, are the dependencies: callers build `stored` inline.
  const windows = stored?.windows ?? null;
  const events = stored?.events ?? null;
  return useMemo(() => {
    const records = fed ?? (windows && events ? { windows, signalEvents: events } : null);
    if (!records) return CHANNEL_OPTIONS;
    return offeredChannels(CHANNEL_OPTIONS, recordKindsOf(records), current);
  }, [fed, windows, events, current]);
}
