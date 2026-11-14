/*
 * The Analyze domain tabs — shared by the standalone AnalyzeLayout subtab row
 * (routes/analyze.tsx) and the embedded unified header (EmbedHeader.tsx). Kept
 * in its own dependency-free module so EmbedHeader can render the tabs without
 * importing the route tree (which would create an import cycle through the root
 * route → AppShell → EmbedHeader).
 *
 * Order follows how a finding is actually read: Affect first (WHAT the state
 * was), then Dynamics (HOW it moved between states) — the dynamics view only
 * means something once you know the states it transitions between — then
 * Patterns (which recurring structures those movements form) and Typing (the
 * writing-process dashboard over typing episodes).
 *
 * Route ids are frozen regardless of label or position, so existing deep links
 * keep working: the dynamics tab is still '/analyze/sequence' (labelled
 * "Dynamics" now that it is multi-channel, not affect-specific) and the
 * position tab is still '/analyze/sensing'.
 *
 * Likewise '/analyze/sensing' keeps its route id but is labelled "Position"
 * (facial signals + body posture). Heart rate was split out to its own tab —
 * a physiological rate and a head/body orientation share no axis, no unit and
 * no reading, so one screen could not serve both.
 */
/** What a page reads: interval windows, typing episodes, voice turns, or any state sequence. */
/** What a tab reads; `any` — any record at all (the Logs page lists every kind). */
export type AnalyzeTabNeed = 'windows' | 'typing' | 'voice' | 'sequence' | 'writing' | 'any';
export interface AnalyzeTab { to: string; label: string; needs: AnalyzeTabNeed }

export const analyzeSubTabs: ReadonlyArray<AnalyzeTab> = [
  { to: '/analyze/affect', label: 'Affect', needs: 'windows' },
  { to: '/analyze/sequence', label: 'Dynamics', needs: 'sequence' },
  { to: '/analyze/patterns', label: 'Patterns', needs: 'sequence' },
  { to: '/analyze/patterns-next', label: 'Patterns (next)', needs: 'sequence' },
  { to: '/analyze/engagement', label: 'Attention & engagement', needs: 'windows' },
  { to: '/analyze/gaze', label: 'Gaze', needs: 'windows' },
  { to: '/analyze/sensing', label: 'Position', needs: 'windows' },
  { to: '/analyze/heart-rate', label: 'Heart & breathing', needs: 'windows' },
  { to: '/analyze/typing', label: 'Typing', needs: 'typing' },
  { to: '/analyze/writing', label: 'Writing', needs: 'writing' },
  { to: '/analyze/voice', label: 'Voice', needs: 'voice' },
  { to: '/analyze/logs', label: 'Logs', needs: 'any' },
  { to: '/analyze/comparison', label: 'Comparison', needs: 'windows' },
  // The previous Dynamics page, last until it is retired.
  { to: '/analyze/dynamics-old', label: 'Dynamics (old)', needs: 'sequence' },
];

/** The kinds a fed record set holds (`recordKindsOf`, oyon/records). */
export interface FedKinds { windows: boolean; typing: boolean; voice: boolean; events: boolean; logEvents?: boolean; modalities?: string[]; eventModalities: string[] }

/*
 * The tabs a HOST FEED can fill. A host with no camera feeds typing episodes
 * and events only; the pages that read interval windows or voice turns would
 * be empty states, so they are not offered. `kinds` null (no feed: the
 * standalone instrument, or a capture embed reading its own store) keeps every
 * tab, as before. An EMPTY feed keeps every tab too: nothing is known about
 * what the host records, and the pages say what is missing.
 */
export function analyzeTabsFor(kinds: FedKinds | null): ReadonlyArray<AnalyzeTab> {
  // Empty means EMPTY: a feed that holds only records no Analyze page reads still gets no empty tabs.
  const empty = !!kinds && !(kinds.windows || kinds.typing || kinds.voice || kinds.events || kinds.logEvents || (kinds.modalities?.length ?? 0) > 0);
  if (!kinds || empty) return analyzeSubTabs;
  const has: Record<AnalyzeTabNeed, boolean> = {
    windows: kinds.windows, typing: kinds.typing, voice: kinds.voice, sequence: kinds.windows || kinds.events,
    writing: kinds.eventModalities.includes('document_edit'),
    any: true,
  };
  return analyzeSubTabs.filter((tab) => has[tab.needs]);
}

/** Where "Analyze" lands: the leading tab the feed can fill (Affect when there are windows, as ever). */
export function analyzeLandingFor(kinds: FedKinds | null): string {
  const tabs = analyzeTabsFor(kinds);
  if (!kinds || kinds.windows) return tabs[0].to;
  // A feed with nothing any Analyze page reads (log events only, or empty): the Overview says what is there.
  if (!(kinds.typing || kinds.voice || kinds.events)) return '/overview';
  // The document's view leads for a host that reports document edits; then the keystroke view.
  const own = tabs.find((tab) => tab.needs === 'writing') ?? tabs.find((tab) => tab.needs === 'typing')
    ?? tabs.find((tab) => tab.needs === 'voice');
  return (own ?? tabs[0]).to;
}

/**
 * The Dynamics / Patterns channel a feed opens on: Affect when there are
 * windows; otherwise the first channel the feed has events for, typing first.
 * Null when the current choice should stand.
 */
export function channelForFeed(kinds: FedKinds | null, current: string): string | null {
  if (!kinds) return null;
  const writing = kinds.eventModalities.includes('document_edit');
  const filled = current === 'emotion' ? kinds.windows
    : current === 'all' ? kinds.events
      : current === 'writing' ? writing : kinds.eventModalities.includes(current);
  if (filled) return null;
  if (kinds.windows) return 'emotion';
  // A host that reports document edits opens on their reading as writing acts.
  if (writing) return 'writing';
  if (kinds.eventModalities.includes('typing')) return 'typing';
  return kinds.eventModalities[0] ?? null;
}
