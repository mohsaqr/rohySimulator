import { useEffect } from 'react';
import { elementAoi, reportAoi } from './screenAois';

/*
 * The live half of the multi-AOI gaze pipeline (the pure half is
 * screenAois.js): measure a DOM element and keep its physical-screen AOI
 * fresh in the registry. Extracted from PatientVisual's original publisher
 * effect so every attention target (patient face, ECG trace, vitals column,
 * chat panel) shares one tested lifecycle:
 *   - publish on mount, then rAF-throttled on element resize
 *     (ResizeObserver), window resize and any scroll (capture phase);
 *   - report null on unmount / disable, so "target not on screen" stays
 *     distinct from "not looking at the target".
 */

/**
 * Publish `ref`'s element as a live gaze AOI under `id`.
 *
 * @param {{current: Element|null}} ref  The element to measure. It must be
 *   rendered by the time this effect runs (attach the ref unconditionally, or
 *   flip `enabled` in sync with the conditional render — a ref that attaches
 *   later without a dep change is never seen; AoiRegion sidesteps this by
 *   owning its own div).
 * @param {string} id  Stable AOI id (the aoi_dwell_ms key).
 * @param {object} [opts]
 * @param {object|null} [opts.insetBox]  Fractional sub-region of the element
 *   (see elementAoi) — pass a module constant, not an inline literal, so the
 *   effect doesn't re-run every render.
 * @param {boolean} [opts.enabled]  False → report null and do nothing.
 */
export function useAoiPublisher(ref, id, { insetBox = null, enabled = true } = {}) {
   useEffect(() => {
      const node = ref.current;
      if (!enabled || !node) {
         reportAoi(id, null);
         return undefined;
      }
      let raf = 0;
      const publish = () => {
         raf = 0;
         const rect = node.getBoundingClientRect();
         reportAoi(id, elementAoi(
            id,
            { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            {
               innerWidth: window.innerWidth,
               innerHeight: window.innerHeight,
               screenX: window.screenX,
               screenY: window.screenY,
               outerWidth: window.outerWidth,
               outerHeight: window.outerHeight,
               screenWidth: window.screen?.width,
               screenHeight: window.screen?.height,
            },
            { insetBox },
         ));
      };
      const schedule = () => { if (!raf) raf = requestAnimationFrame(publish); };
      publish();
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
      observer?.observe(node);
      window.addEventListener('resize', schedule);
      window.addEventListener('scroll', schedule, true);
      return () => {
         observer?.disconnect();
         window.removeEventListener('resize', schedule);
         window.removeEventListener('scroll', schedule, true);
         if (raf) cancelAnimationFrame(raf);
         reportAoi(id, null);
      };
   }, [ref, id, enabled, insetBox]);
}
