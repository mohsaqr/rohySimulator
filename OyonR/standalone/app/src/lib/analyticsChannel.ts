import type { SelectOption } from '@/components/ui/Select';
import type { SignalEventModality } from 'oyon/signal-events';

/*
 * AnalyticsChannel — the one control that switches sequence.tsx and
 * PatternsPanel between the pooled emotion-window chains and the pooled
 * signal-event chains for one modality (or all of them interleaved).
 * `buildSessionSequences` / `buildEventSequences` (lib/tnaPooling.js) already
 * return the same `string[][]` shape for every channel, so nothing
 * downstream of the sequences needs to know which one is active — only the
 * data source and a couple of labels do.
 */
/*
 * 'voice' is declared explicitly: the runtime registers a voice state
 * vocabulary (src/version.js OYON_STATE_VOCABULARIES) but the hand-written
 * types/signal-events.d.ts SignalEventModality union predates the voice
 * pipeline. Fold it into the union there and drop the extra member here
 * once the .d.ts catches up.
 */
export type AnalyticsChannel = 'emotion' | SignalEventModality | 'voice' | 'writing' | 'all';

export const CHANNEL_OPTIONS: SelectOption<AnalyticsChannel>[] = [
  { value: 'emotion', label: 'Affect (emotion)' },
  { value: 'typing', label: 'Typing' },
  { value: 'voice', label: 'Voice' },
  { value: 'discourse', label: 'Discourse' },
  { value: 'interaction', label: 'Interaction' },
  { value: 'ai_assist', label: 'AI assist' },
  { value: 'writing', label: 'Writing acts', hint: 'Document edits read as seven acts: write, revise, paste, organise, AI, decide, pause.' },
  { value: 'document_edit', label: 'Document edits', hint: 'Edits a host reported for a document it owns, by the writer, an AI or the system.' },
  { value: 'code_run', label: 'Code runs', hint: 'Runs a host reported: started, succeeded, failed, interrupted.' },
  { value: 'all', label: 'All channels', hint: 'Every channel interleaved on one timeline, ordered by sequence_index.' },
];

/**
 * Unit noun for the selected channel's records: emotion sequences pool
 * EmotionWindow rows, every other channel pools signal_events rows — "window"
 * reads wrong once a non-emotion channel is selected.
 */
export function channelUnit(channel: AnalyticsChannel): { singular: string; plural: string } {
  return channel === 'emotion'
    ? { singular: 'window', plural: 'windows' }
    : { singular: 'event', plural: 'events' };
}

/** Display label for a channel, for empty-state copy ("no stored X yet"). */
export function channelLabel(channel: AnalyticsChannel): string {
  return CHANNEL_OPTIONS.find((o) => o.value === channel)?.label ?? channel;
}
