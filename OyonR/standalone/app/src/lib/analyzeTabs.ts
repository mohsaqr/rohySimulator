/*
 * The Analyze domain tabs — shared by the standalone AnalyzeLayout subtab row
 * (routes/analyze.tsx) and the embedded unified header (EmbedHeader.tsx). Kept
 * in its own dependency-free module so EmbedHeader can render the tabs without
 * importing the route tree (which would create an import cycle through the root
 * route → AppShell → EmbedHeader).
 *
 * The route id of the first tab stays '/analyze/sequence' (stable deep-link);
 * its user-facing label is "Emotion dynamics" and it leads the domains.
 */
export const analyzeSubTabs: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/analyze/sequence', label: 'Emotion dynamics' },
  { to: '/analyze/affect', label: 'Affect' },
  { to: '/analyze/engagement', label: 'Engagement' },
  { to: '/analyze/gaze', label: 'Gaze' },
  { to: '/analyze/comparison', label: 'Comparison' },
];
