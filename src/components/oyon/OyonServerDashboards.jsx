import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { loadOyonElement } from './loadOyonElement';
import { recordsToWindows } from './serverWindows';
import { OYON_ASSET_BASE } from './captureBridge';

/*
 * The Oyon v2 Analyze dashboards (emotion trends, gaze tiles, engagement
 * KPIs, TNA networks, session explorer) over SERVER data.
 *
 * Hosts <oyon-app chrome="none"> — a pure viewer: it owns no camera and
 * reads whatever the host feeds through el.setWindows(...). We feed it the
 * emotion-records the Learning Analytics tab already fetched (admin/educator
 * scoped + filtered server-side), so authorization stays entirely on Rohy's
 * backend — the element never talks to the API.
 *
 * Viewer instances are unlimited by the element's camera guard, so this
 * coexists with the capture pill in the Patient Monitor.
 */
export default function OyonServerDashboards({ records, loading }) {
   const hostRef = useRef(null);
   const elRef = useRef(null);
   // Latest records, readable from the mount effect — so the element gets its
   // FIRST feed even when the 5 MB module finishes loading after the fetch.
   const recordsRef = useRef(records);
   const [loadError, setLoadError] = useState(null);
   // false until the <oyon-app> element is defined, mounted and fed its
   // first batch — drives the loading veil so a 5 MB module on a slow link
   // never reads as a blank white panel.
   const [ready, setReady] = useState(false);

   useEffect(() => {
      let cancelled = false;
      loadOyonElement()
         .then(() => {
            if (cancelled) return;
            const host = hostRef.current;
            if (!host || host.querySelector('oyon-app')) return;
            const el = document.createElement('oyon-app');
            el.setAttribute('chrome', 'none');
            el.setAttribute('page', '/analyze');
            el.setAttribute('asset-base', OYON_ASSET_BASE);
            el.style.display = 'block';
            el.style.height = '100%';
            host.appendChild(el);
            elRef.current = el;
            el.setWindows?.(recordsToWindows(recordsRef.current));
            setReady(true);
         })
         .catch((e) => {
            if (!cancelled) setLoadError(e?.message || 'Could not load the Oyon dashboards');
         });
      return () => {
         cancelled = true;
         elRef.current?.remove();
         elRef.current = null;
      };
   }, []);

   // Re-feed on every records change (filter apply, pagination, refresh).
   useEffect(() => {
      recordsRef.current = records;
      elRef.current?.setWindows?.(recordsToWindows(records));
   }, [records]);

   if (loadError) {
      return (
         <div className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-3 text-sm text-red-200 space-y-1">
            <div className="flex items-center gap-2 font-semibold">
               <AlertTriangle className="w-4 h-4 shrink-0" /> The Oyon analytics viewer failed to load
            </div>
            <p className="text-red-200/80">{loadError}</p>
            <p className="text-xs text-red-200/60">
               Check that the Oyon add-on assets are reachable (they are served from
               <code className="mx-1">/oyon/standalone</code> by the Rohy backend), then use
               Refresh above or reload the page to retry.
            </p>
         </div>
      );
   }

   return (
      <div className="space-y-2">
         <p className="text-xs text-gray-500">
            Oyon dashboards over the records matching the current filters
            {loading ? ' — refreshing…' : ''}. Estimates from visible facial
            signals only, aggregated in ~10&nbsp;s windows.
         </p>
         {/* Light card: the element ships a light theme; don't sink it into
             the settings page's dark chrome. Height tracks the viewport so
             the embed fills the settings panel instead of a fixed strip
             (ConfigPanel's content column is the only scroller). The host
             div stays mounted while loading — the mount effect needs its
             ref — with a veil on top until the element is live. */}
         <div className="relative h-[calc(100vh-15rem)] min-h-[560px]">
            <div ref={hostRef} className="h-full overflow-hidden rounded-lg border border-gray-300 bg-white" />
            {!ready && (
               <div className="absolute inset-0 grid place-items-center rounded-lg border border-gray-300 bg-white">
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                     <Loader2 className="w-4 h-4 animate-spin" /> Loading the Oyon dashboards…
                  </div>
               </div>
            )}
         </div>
      </div>
   );
}
