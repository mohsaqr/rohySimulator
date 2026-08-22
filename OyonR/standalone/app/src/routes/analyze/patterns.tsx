import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { PatternsPanel } from '@/components/patterns/PatternsPanel';

/*
 * Analyze · Patterns — sequence-structure views over emotion-state OR
 * signal-event sequences: sub-patterns (LAILA-style), the most-frequency
 * tree, and the disentangled simplicial (dismantled small multiples).
 * Compute from ladyna + tnaj; the simplicial blobs use the shipping
 * carm-tna renderer.
 *
 * PatternsPanel owns the channel picker (Affect / Typing / Discourse /
 * Interaction / AI assist / All channels) and its own loading/empty states,
 * since the picker must stay visible and switchable even when the emotion
 * channel (this route's `windows`) is empty but another channel has data.
 */
export function PatternsView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  return <PatternsPanel windows={enriched} isLoading={isLoading} />;
}
