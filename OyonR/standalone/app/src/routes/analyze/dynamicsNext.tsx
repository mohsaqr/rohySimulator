import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { DynamicsSections } from '@/components/dynamics/DynamicsSections';
import { SessionSequences } from '@/components/patterns/SessionSequences';

/*
 * Analyze · Dynamics — the Dynamics tab on current ladyna, served at
 * /analyze/sequence (the previous page is at /analyze/dynamics-old). Sequences and channel
 * picker: SessionSequences (shared with Patterns (next)); sections:
 * DynamicsSections → lib/dynamicsViews.js.
 */
export function DynamicsNextView() {
  const { filtered, isLoading } = useFilteredWindows();
  return (
    <SessionSequences windows={filtered} isLoading={isLoading}>
      {(sequences, { channel, unit, lead }) => <DynamicsSections sequences={sequences} filePrefix={`dynamics-${channel}`} unit={unit} lead={lead} />}
    </SessionSequences>
  );
}
