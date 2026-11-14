import type { EmotionWindow } from 'oyon';
import { PatternSections } from './PatternSections';
import { SessionSequences } from './SessionSequences';

/*
 * Analyze · Patterns (next) — the revamped Patterns tab on current ladyna,
 * beside the old one (PatternsPanel) until it replaces it. The sequences and
 * channel picker are SessionSequences (shared with Dynamics (next)); the
 * sections are the shared pattern library the group Patterns page also uses
 * (PatternSections → lib/patternViews.js).
 */
export function PatternsNextPanel({ windows, isLoading = false }: { windows: EmotionWindow[]; isLoading?: boolean }) {
  return (
    <SessionSequences windows={windows} isLoading={isLoading}>
      {(sequences, { channel, unit, lead }) => <PatternSections sequences={sequences} filePrefix={`patterns-${channel}`} unit={unit} lead={lead} />}
    </SessionSequences>
  );
}
