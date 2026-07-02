import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3 } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { oyonClientLog } from './clientLogger';
import { liveAnxiousIndex, ANXIOUS_FLAG_THRESHOLD } from './anxiousIndex';
import { loadOyonElement } from './loadOyonElement';
import { elementSettings, persistBody, OYON_ASSET_BASE } from './captureBridge';
import { getAois, onAois } from './screenAois';

export const VALENCE_GRAPH_PREF_KEY = 'oyon.showValenceGraph';
export const CONSENT_PREF_KEY = 'oyon.defaultConsent';

const VALENCE_BUFFER = 30;

/*
 * Oyon v2 embed. The <oyon-app chrome="capture"> element OWNS the camera,
 * the models, the capture pill UI and its start/stop controls — Rohy no
 * longer constructs an EmotionRuntime of its own (the v1 widget did; that
 * pulled the whole oyon library into the SPA bundle graph and re-implemented
 * camera lifecycle that upstream now ships). Rohy keeps everything that is
 * genuinely Rohy's:
 *   - the tenant gate + runtime config (GET /addons/oyon/config), forwarded
 *     into the element via its `settings` attribute;
 *   - the consent contract (POST /addons/oyon/consent when capture actually
 *     starts, per session, opt-out via CONSENT_PREF_KEY);
 *   - persistence (windows from the element's `oyon:window` event POSTed to
 *     /addons/oyon/emotion-records — the element also keeps a local copy,
 *     local-first by design);
 *   - the clinical extras the element doesn't know about: the derived
 *     anxious flag (Bug 18) and the live valence sparkline, both fed from
 *     the element's unconditional `oyon:sample` stream.
 * Gaze is pinned to the training-free mediapipe engine (Rohy consumes zone
 * aggregates, not calibrated points) and assets load same-origin via
 * asset-base so air-gapped deploys never touch a CDN.
 */
export default function OyonCaptureWidget({ sessionId, caseId, room, onOpenAnalytics } = {}) {
   const [tenantEnabled, setTenantEnabled] = useState(false);
   const [runtimeConfig, setRuntimeConfig] = useState(null);
   const [status, setStatus] = useState('idle');
   const [emotion, setEmotion] = useState(null);
   const [valenceTrack, setValenceTrack] = useState([]);
   const [showGraph, setShowGraph] = useState(() => readGraphPref());
   const [errorMsg, setErrorMsg] = useState(null);
   const [persistOk, setPersistOk] = useState(true);

   const hostRef = useRef(null);
   const elRef = useRef(null);
   // The element's event listeners are attached ONCE (at element creation)
   // and read live values through refs, so prop changes never require
   // re-wiring — and a late window can never persist against a stale closure.
   const sessionRef = useRef(sessionId);
   const caseRef = useRef(caseId);
   const roomRef = useRef(room);
   const runningRef = useRef(false);
   // Persistence gate: true only once consent for the CURRENT session has
   // been recorded server-side. Windows arriving while the gate is closed
   // stay local-only (the element's own store) — the privacy contract.
   const persistGateRef = useRef(false);
   const consentSessionRef = useRef(null);

   useEffect(() => {
      sessionRef.current = sessionId;
      caseRef.current = caseId;
      roomRef.current = room;
   }, [sessionId, caseId, room]);

   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/config')
         .then(c => {
            if (cancelled) return;
            setTenantEnabled(Boolean(c?.enabled));
            // /config.runtime is the tenant-level source of truth (model +
            // window params). Forwarded to the element as its `settings`
            // attribute; missing fields keep the element's defaults.
            setRuntimeConfig(c?.runtime || {});
            oyonClientLog('debug', 'capture config loaded', {
               enabled: Boolean(c?.enabled),
               model_profile: c?.runtime?.model_profile,
            });
         })
         .catch((e) => {
            if (cancelled) return;
            setTenantEnabled(false);
            oyonClientLog('warn', 'capture config fetch failed', { error: e?.message || String(e) });
         });
      return () => { cancelled = true; };
   }, []);

   useEffect(() => {
      const onChange = (e) => {
         if (e?.detail?.key === VALENCE_GRAPH_PREF_KEY) setShowGraph(Boolean(e.detail.value));
      };
      const onStorage = (e) => {
         if (e.key === VALENCE_GRAPH_PREF_KEY) setShowGraph(e.newValue === '1');
      };
      window.addEventListener('oyon:setting-changed', onChange);
      window.addEventListener('storage', onStorage);
      return () => {
         window.removeEventListener('oyon:setting-changed', onChange);
         window.removeEventListener('storage', onStorage);
      };
   }, []);

   // Mount exactly one <oyon-app chrome="capture"> once the tenant is known
   // to be enabled and the runtime config has resolved. Listeners are
   // attached BEFORE the node is appended so no early event is missed.
   useEffect(() => {
      if (!tenantEnabled || runtimeConfig == null) return undefined;
      let cancelled = false;

      async function ensureConsent() {
         const sid = sessionRef.current;
         if (!sid || !readConsentPref()) {
            persistGateRef.current = false;
            oyonClientLog('info', 'capture running without consent — local-only', {
               session_id: sid, user_consent: readConsentPref(),
            });
            return;
         }
         if (consentSessionRef.current === sid) {
            persistGateRef.current = true;
            return;
         }
         try {
            await apiFetch('/addons/oyon/consent', {
               method: 'POST',
               json: { session_id: sid, consent_granted: true, source_page: window.location.pathname },
            });
            consentSessionRef.current = sid;
            persistGateRef.current = true;
            setPersistOk(true);
            oyonClientLog('info', 'consent recorded', { session_id: sid });
         } catch (e) {
            persistGateRef.current = false;
            setPersistOk(false);
            oyonClientLog('warn', 'consent POST failed; capture will not persist', {
               session_id: sid, error: e?.message || String(e),
            });
         }
      }

      const onStatus = (e) => {
         const state = e?.detail?.state;
         if (!state) return;
         setStatus(state);
         if (state === 'running') {
            runningRef.current = true;
            setErrorMsg(null);
            // Consent is recorded when capture ACTUALLY starts (the user
            // pressed the element pill's start control). The first window is
            // one aggregation interval away (~10 s), so the POST settles long
            // before anything could need persisting.
            void ensureConsent();
         } else if (state === 'stopped' || state === 'idle' || state === 'error') {
            runningRef.current = false;
            if (state === 'stopped') {
               setEmotion(null);
               setValenceTrack([]);
            }
         }
      };

      const onSample = (e) => {
         const d = e?.detail;
         if (!d) return;
         const anxious = liveAnxiousIndex(d.probabilities, d.valence, d.arousal);
         setEmotion(prev => ({
            ...(prev || {}),
            dominant_emotion: d.dominant ?? prev?.dominant_emotion,
            confidence: Number.isFinite(d.confidence) ? d.confidence : prev?.confidence,
            valence: Number.isFinite(d.valence) ? d.valence : prev?.valence,
            arousal: Number.isFinite(d.arousal) ? d.arousal : prev?.arousal,
            anxious_index: anxious ?? prev?.anxious_index,
         }));
         if (Number.isFinite(d.valence)) {
            setValenceTrack(prev => [...prev, d.valence].slice(-VALENCE_BUFFER));
         }
      };

      const onWindow = (e) => {
         const windows = e?.detail?.windows;
         if (!Array.isArray(windows) || windows.length === 0) return;
         if (!persistGateRef.current) return; // local-only capture
         void persistWindows(windows, {
            sessionId: sessionRef.current,
            caseId: caseRef.current,
            room: roomRef.current,
         }, setPersistOk);
      };

      loadOyonElement()
         .then(() => {
            if (cancelled) return;
            const host = hostRef.current;
            if (!host || host.querySelector('oyon-app')) return;
            const el = document.createElement('oyon-app');
            el.setAttribute('chrome', 'capture');
            // Training-free geometric gaze — Rohy only consumes zone/AOI
            // aggregates, so the click-calibrated WebGazer default (which
            // emits NOTHING until trained) would read as "gaze is broken".
            el.setAttribute('gaze-engine', 'mediapipe');
            // Same-origin models + WASM (air-gap contract) — see captureBridge.
            el.setAttribute('asset-base', OYON_ASSET_BASE);
            el.setAttribute('settings', JSON.stringify(elementSettings(runtimeConfig)));
            if (sessionRef.current) el.setAttribute('session-id', String(sessionRef.current));
            el.addEventListener('oyon:status', onStatus);
            el.addEventListener('oyon:sample', onSample);
            el.addEventListener('oyon:window', onWindow);
            host.appendChild(el);
            elRef.current = el;
            // "What is the trainee looking at": seed the full AOI registry
            // (patient face, ECG trace, vitals column, chat panel — whatever
            // is currently on screen) so a capture started before a publisher
            // re-measures still begins with the last known rects; live
            // updates flow through the subscription below.
            el.setGazeAois?.(getAois());
         })
         .catch((e) => {
            if (cancelled) return;
            setErrorMsg(e?.message || 'Could not load the Oyon capture element');
            oyonClientLog('error', 'oyon element load failed', { error: e?.message || String(e) });
         });

      // Every published screen region is a live gaze AOI: the full set is
      // hot-swapped on the running runtime whenever ANY publisher re-measures
      // (resize, scroll, room change, element unmount → dropped from the set).
      const offAoi = onAois((aois) => {
         elRef.current?.setGazeAois?.(aois);
      });

      return () => {
         cancelled = true;
         offAoi();
         // Removing the node IS the teardown contract: the element's
         // disconnectedCallback stops capture, flushes the final window and
         // releases the camera claim.
         elRef.current?.remove();
         elRef.current = null;
         runningRef.current = false;
         persistGateRef.current = false;
      };
   }, [tenantEnabled, runtimeConfig]);

   // Identity applies LIVE: on a session switch mid-capture the element
   // re-keys subsequent windows immediately, and consent (a per-session
   // record) is re-established before anything persists under the new id.
   useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (sessionId) el.setAttribute('session-id', String(sessionId));
      persistGateRef.current = consentSessionRef.current === sessionId && persistGateRef.current;
   }, [sessionId]);

   if (!tenantEnabled) return null;

   const running = status === 'running' || status === 'paused';
   const anxiousFlag = running
      && Number.isFinite(emotion?.anxious_index)
      && emotion.anxious_index >= ANXIOUS_FLAG_THRESHOLD;

   const errorBanner = errorMsg ? (
      <div className="text-[11px] text-red-200 bg-red-950/60 border border-red-500/40 rounded px-2 py-1 leading-tight max-w-[480px] break-words"
           title={errorMsg}>
         {errorMsg}
      </div>
   ) : null;

   return (
      <div className="flex flex-col gap-1 w-fit">
         <div className="flex items-stretch gap-1.5">
            {/* The element renders Oyon's own capture pill (camera preview,
                live emotion word, start/stop) inside this host. */}
            <div ref={hostRef} className="shrink-0" />
            {anxiousFlag && (
               <span
                  className="inline-flex items-center gap-1 self-center rounded-full border border-amber-400/50 bg-amber-950/50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200"
                  title={`Derived anxiety indicator ${emotion.anxious_index.toFixed(2)} (high arousal + negative valence + fear)`}
               >
                  anxious
               </span>
            )}
            {!persistOk && running && (
               <AlertTriangle
                  className="h-4 w-4 self-center text-amber-300"
                  title="Local capture only — backend rejected writes"
               />
            )}
            {showGraph && <ValenceTrack values={valenceTrack} active={running && status !== 'paused'} compact />}
            {/* In-app navigation to Settings → Oyon — Learning Analytics.
                Only rendered when the host wires it (App gates on the same
                educator/admin rule that shows the analytics tab itself). */}
            {typeof onOpenAnalytics === 'function' && (
               <button
                  type="button"
                  onClick={onOpenAnalytics}
                  title="Open Learning Analytics (Settings → Oyon — Learning Analytics)"
                  className="grid place-items-center self-center h-8 w-8 rounded-full border border-white/10 bg-black/40 text-cyan-100/80 hover:bg-white/10 shrink-0"
               >
                  <BarChart3 className="h-4 w-4" />
               </button>
            )}
         </div>
         {errorBanner}
      </div>
   );
}

async function persistWindows(windows, { sessionId, caseId, room }, setPersistOk) {
   try {
      await apiFetch('/addons/oyon/emotion-records', {
         method: 'POST',
         json: persistBody(windows, { sessionId, caseId, room }),
      });
      setPersistOk(true);
      oyonClientLog('debug', 'window batch persisted', {
         session_id: sessionId,
         count: windows.length,
         room: room || null,
      });
   } catch (e) {
      setPersistOk(false);
      oyonClientLog('warn', 'window batch persist failed', {
         session_id: sessionId,
         count: windows.length,
         error: e?.message || String(e),
      });
   }
}

function readConsentPref() {
   // Tenant-level emotion_capture_enabled is the admin's opt-in. Per-user
   // consent defaults to ON when the tenant has opted in, opting OUT only
   // when the user explicitly toggled the switch off in Settings → Oyon
   // (which writes '0'). Default-on matches what the deployment's admin
   // already decided when they enabled Oyon at the tenant level.
   try {
      const v = localStorage.getItem(CONSENT_PREF_KEY);
      return v !== '0';
   } catch { return true; }
}

function readGraphPref() {
   try { return localStorage.getItem(VALENCE_GRAPH_PREF_KEY) === '1'; } catch { return false; }
}

function ValenceTrack({ values, active, compact = false }) {
   const W = compact ? 220 : 260;
   const H = compact ? 44 : 90;
   const PAD_X = compact ? 18 : 22;
   const PAD_Y = compact ? 6 : 12;

   const path = useMemo(() => {
      if (values.length < 2) return null;
      const innerW = W - PAD_X * 2;
      const innerH = H - PAD_Y * 2;
      const stepX = innerW / Math.max(1, VALENCE_BUFFER - 1);
      const offsetStart = innerW - stepX * (values.length - 1);
      const points = values.map((v, i) => {
         const x = PAD_X + offsetStart + i * stepX;
         const y = PAD_Y + (1 - (clamp(v, -1, 1) + 1) / 2) * innerH;
         return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return `M ${points.join(' L ')}`;
   }, [values, W, H, PAD_X, PAD_Y]);

   const last = values[values.length - 1];
   const lastPoint = useMemo(() => {
      if (last == null) return null;
      const innerW = W - PAD_X * 2;
      const innerH = H - PAD_Y * 2;
      const stepX = innerW / Math.max(1, VALENCE_BUFFER - 1);
      const offsetStart = innerW - stepX * (values.length - 1);
      const x = PAD_X + offsetStart + (values.length - 1) * stepX;
      const y = PAD_Y + (1 - (clamp(last, -1, 1) + 1) / 2) * innerH;
      return { x, y };
   }, [values, last, W, H, PAD_X, PAD_Y]);

   const tone = last == null ? '#6b7280' : last >= 0 ? '#34d399' : '#60a5fa';

   return (
      <div className={`rounded-lg border border-white/10 bg-black/40 ${compact ? 'px-1.5 py-1' : 'px-2 py-2'}`}>
         {!compact && (
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-cyan-100/70 px-0.5 pb-1">
               <span>Valence</span>
               <span className="tabular-nums text-base font-bold leading-none" style={{ color: tone }}>
                  {last == null ? '—' : (last >= 0 ? '+' : '') + last.toFixed(2)}
               </span>
            </div>
         )}
         <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }}>
            <text x={4} y={PAD_Y + 4} fontSize={compact ? 8 : 9} fill="rgba(255,255,255,0.45)">+1</text>
            <text x={4} y={H / 2 + 3} fontSize={compact ? 8 : 9} fill="rgba(255,255,255,0.45)">0</text>
            <text x={4} y={H - PAD_Y + (compact ? 6 : 8)} fontSize={compact ? 8 : 9} fill="rgba(255,255,255,0.45)">−1</text>
            {compact && (
               <text x={W - 4} y={PAD_Y + 4} fontSize="10" fontWeight="700" textAnchor="end" fill={tone}>
                  {last == null ? '—' : (last >= 0 ? '+' : '') + last.toFixed(2)}
               </text>
            )}
            <line x1={PAD_X} y1={PAD_Y} x2={W - PAD_X} y2={PAD_Y} stroke="rgba(255,255,255,0.06)" />
            <line x1={PAD_X} y1={H / 2} x2={W - PAD_X} y2={H / 2} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
            <line x1={PAD_X} y1={H - PAD_Y} x2={W - PAD_X} y2={H - PAD_Y} stroke="rgba(255,255,255,0.06)" />
            {path && (
               <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     opacity={active ? 1 : 0.5} />
            )}
            {lastPoint && (
               <circle cx={lastPoint.x} cy={lastPoint.y} r="3" fill={tone}>
                  {active && <animate attributeName="r" values="3;5;3" dur="1.6s" repeatCount="indefinite" />}
               </circle>
            )}
            {!lastPoint && (
               <text x={W / 2} y={H / 2 + 4} fontSize="11" fill="rgba(255,255,255,0.45)" textAnchor="middle">
                  {active ? 'collecting…' : 'press camera to start'}
               </text>
            )}
         </svg>
      </div>
   );
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
