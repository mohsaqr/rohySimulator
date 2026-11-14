import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { PatternsNextPanel } from '@/components/patterns/PatternsNextPanel';

/*
 * Analyze · Patterns (next) — the revamp on current ladyna, served beside
 * /analyze/patterns until it replaces it. See PatternsNextPanel.
 */
export function PatternsNextView() {
  const { filtered, isLoading } = useFilteredWindows();
  return <PatternsNextPanel windows={filtered} isLoading={isLoading} />;
}
