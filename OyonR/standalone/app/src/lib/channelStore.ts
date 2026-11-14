import { create } from 'zustand';
import type { AnalyticsChannel } from './analyticsChannel';

/*
 * Channel store — the analytics channel the sequence-analytics surfaces
 * (Dynamics and Patterns) look at.
 *
 *   channel: 'emotion' (the default — pooled emotion windows) | one
 *            signal-event modality ('typing' | 'discourse' | 'interaction'
 *            | 'ai_assist') | 'all' (every modality interleaved).
 *
 * Lifted out of the two screens' local state so a channel picked on Dynamics
 * is still selected on Patterns (and vice versa) — the two tabs are one
 * investigation over one channel, not two independent pickers. Kept separate
 * from filterStore (WHICH sessions/users the dashboards look at): this store
 * describes WHICH signal stream they read, not its scope.
 */

export interface ChannelState {
  channel: AnalyticsChannel;
  setChannel: (channel: AnalyticsChannel) => void;
  /** The Writing acts channel's grain: the seven acts, or each with its detail. */
  writingLevel: 'main' | 'detail';
  setWritingLevel: (level: 'main' | 'detail') => void;
  reset: () => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channel: 'emotion',
  setChannel: (channel) => set({ channel }),
  writingLevel: 'main',
  setWritingLevel: (writingLevel) => set({ writingLevel }),
  reset: () => set({ channel: 'emotion' }),
}));
