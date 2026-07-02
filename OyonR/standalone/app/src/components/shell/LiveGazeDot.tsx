import { useEffect, useRef } from 'react';
import { useRuntime } from '@/lib/RuntimeProvider';

/*
 * LiveGazeDot — floating crosshair that follows the active gaze sample
 * across the full viewport. Sits at z-overlay (above the z-dock mini
 * camera) so a researcher can SEE that eye tracking is working in real time.
 *
 * Renders the latest sample as a small target. Below quality 0.3 the
 * target dims to indicate "below the adapter's quality gate".
 */

export function LiveGazeDot() {
  const sample = useRuntime().lastGaze;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!sample) {
      el.style.opacity = '0';
      return;
    }
    // Normalized x,y in [-0.5, 0.5] → pixel coords on the viewport.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const px = (0.5 + sample.x) * w;
    const py = (0.5 + sample.y) * h;
    el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    el.style.opacity = sample.quality >= 0.3 ? '1' : '0.4';
  }, [sample]);

  // Mount the element even when there's no sample so the transform can
  // animate the first appearance.
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-overlay opacity-0 transition-opacity duration-200"
      aria-hidden="true"
      style={{ transform: 'translate(-100px, -100px) translate(-50%, -50%)' }}
    >
      <div className="relative size-8">
        <div className="absolute inset-0 rounded-full bg-status-info/20 ring-2 ring-status-info" />
        <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-status-info" />
      </div>
    </div>
  );
}
