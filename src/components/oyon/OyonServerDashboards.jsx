import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { loadOyonElement } from './loadOyonElement';
import { recordsToWindows } from './serverWindows';
import { OYON_ASSET_BASE } from './captureBridge';

// Sentinel for "the element itself would not load" — the only error message
// Rohy authors here (any other one is upstream text passed through verbatim).
const LOAD_FAILED = Symbol('oyon-dashboards-load-failed');

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
export default function OyonServerDashboards({ records, loading, sessionId = null }) {
   const { t } = useTranslation('oyon');
   const hostRef = useRef(null);
   const elRef = useRef(null);
   // Latest records, readable from the mount effect — so the element gets its
   // FIRST feed even when the 5 MB module finishes loading after the fetch.
   const recordsRef = useRef(records);
   // Same reason as recordsRef: the pin must be on the element from the very
   // first render, or the viewer resolves "no active session" and renders zero
   // before we ever get to update the attribute.
   const sessionIdRef = useRef(sessionId);
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
            // REQUIRED, not optional. An embedded chrome="none" viewer forces
            // the current-session scope as a privacy boundary: with no pinned
            // session it reports "No active session" and renders ZERO rows no
            // matter what setWindows() fed it (Oyon's own contract test:
            // "a missing session must yield no rows" / "a viewer pin must
            // win"). Without this the dashboard silently showed the empty
            // state on any load where no capture session happened to be live.
            if (sessionIdRef.current) el.setAttribute('session-id', String(sessionIdRef.current));
            el.style.display = 'block';
            el.style.height = '100%';
            host.appendChild(el);
            elRef.current = el;
            el.setWindows?.(recordsToWindows(recordsRef.current));
            setReady(true);
         })
         .catch((e) => {
            // A sentinel, not prose: this effect must not depend on `t`, or a
            // language switch would remount the 5 MB element. Resolved to the
            // catalogue string at render, exactly as OyonCaptureWidget does.
            if (!cancelled) setLoadError(e?.message || LOAD_FAILED);
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

   // Re-pin when the educator picks another session. `session-id` is an
   // observed attribute, so this re-scopes the live viewer without remounting
   // the 5 MB element.
   useEffect(() => {
      sessionIdRef.current = sessionId;
      const el = elRef.current;
      if (!el) return;
      if (sessionId) el.setAttribute('session-id', String(sessionId));
      else el.removeAttribute('session-id');
   }, [sessionId]);

   if (loadError) {
      return (
         <div className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-3 text-sm text-red-200 space-y-1">
            <div className="flex items-center gap-2 font-semibold">
               <AlertTriangle className="w-4 h-4 shrink-0" /> {t('dashboards_failed_title')}
            </div>
            <p className="text-red-200/80">
               {loadError === LOAD_FAILED ? t('dashboards_failed_default') : loadError}
            </p>
            <p className="text-xs text-red-200/60">{t('dashboards_failed_hint')}</p>
         </div>
      );
   }

   return (
      <div className="flex flex-col h-full min-h-0 gap-2">
         <p className="shrink-0 text-xs text-gray-500">
            {loading ? t('dashboards_caption_refreshing') : t('dashboards_caption')}
         </p>
         {/* Light card: the element ships a light theme; don't sink it into
             the host's dark chrome. The host div stays mounted while loading —
             the mount effect needs its ref — with a veil on top until the
             element is live.

             Height FILLS the flex parent rather than computing a viewport
             fraction. The old `h-[calc(100vh-15rem)]` dated from when this
             embed lived inside ConfigPanel's scrolling column; in the
             full-screen dashboard room it under-fills by exactly the room
             header plus the caption above, leaving a dead dark strip below
             the panel. `min-h-0` is required — a flex child defaults to
             min-height:auto and would refuse to shrink, pushing the strip
             back. */}
         <div className="relative flex-1 min-h-0">
            <div ref={hostRef} className="h-full overflow-hidden rounded-lg border border-gray-300 bg-white" />
            {!ready && (
               <div className="absolute inset-0 grid place-items-center rounded-lg border border-gray-300 bg-white">
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                     <Loader2 className="w-4 h-4 animate-spin" /> {t('dashboards_loading')}
                  </div>
               </div>
            )}
         </div>
      </div>
   );
}
