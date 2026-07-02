import { useRef } from 'react';
import { useAoiPublisher } from './useAoiPublisher';

/**
 * A div that IS a gaze attention target. Drop-in replacement for a plain
 * layout <div> — same className, same children — whose mount/unmount drives
 * the AOI lifecycle, so conditionally-rendered regions (e.g. the chat panel,
 * which only exists on the chat surface) publish and retract correctly
 * without the caller wiring `enabled` to its render condition.
 *
 * (Its own file, not useAoiPublisher.js, so Fast Refresh sees a
 * components-only module.)
 */
export default function AoiRegion({ id, insetBox = null, className, children }) {
   const ref = useRef(null);
   useAoiPublisher(ref, id, { insetBox });
   return <div ref={ref} className={className}>{children}</div>;
}
