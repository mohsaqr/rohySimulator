import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ExternalLink, Loader2, Pause, Play, Square, AlertTriangle } from 'lucide-react';
import { EmotionRuntime } from 'oyon';
import { apiFetch } from '../../services/apiClient';
import { resolveModelConfig, DEFAULT_MODEL_PROFILE } from './modelProfiles';
import { oyonClientLog } from './clientLogger';

export const VALENCE_GRAPH_PREF_KEY = 'oyon.showValenceGraph';
export const CONSENT_PREF_KEY = 'oyon.defaultConsent';

const MEDIAPIPE_OPTS = {
   wasmBaseUrl: '/standalone/vendor/mediapipe/wasm',
   modelAssetPath: '/standalone/models/mediapipe/face_landmarker.task',
   delegate: 'GPU',
};
const ONNX_OPTS = {
   wasmPaths: '/standalone/vendor/onnxruntime-web/',
   executionProviders: ['webgpu', 'wasm'],
};
const VALENCE_BUFFER = 30;

// Lazy-init the EmotionRuntime as soon as the widget mounts — but note this
// is NOT off-main-thread. Inference and ONNX preprocessing run on the React
// main thread (a worker variant was attempted and abandoned, see
// HANDOFF.md). "Pre-warm" here just means we defer the heavy model load
// (~3.6MB face landmarker + ONNX session + WebGPU pipeline compile) by one
// slot tick after mount, so it's done by the time the user clicks Camera and
// pressing Start feels instant. The runtime holds the loaded models; we only
// call camera.start() on user gesture.
class CaptureSession {
   constructor({ sessionId, caseId, runtimeConfig }) {
      this.sessionId = sessionId;
      this.caseId = caseId;
      this.runtimeConfig = runtimeConfig || {};
      this.runtime = null;
      this.ready = false;
      this.error = null;
      this.listeners = new Set();
   }

   async preloadModels() {
      if (this.runtime || this.error) return;
      try {
         const profileId = this.runtimeConfig.model_profile || DEFAULT_MODEL_PROFILE;
         const modelConfig = resolveModelConfig(profileId);
         oyonClientLog('debug', 'miniature preloading models', {
            session_id: this.sessionId,
            model_profile: profileId,
         });
         // Forward the full tenant runtime config to EmotionRuntime so the
         // emitted windows reflect the admin's saved aggregation parameters
         // (window length, min valid frames, smoothing, hold, switch
         // confidence). Earlier we only wired model + sample interval,
         // which let captured windows diverge silently from settings_snapshot
         // and from what admins saw in the Settings tab. Field names map to
         // OyonSettings.js: window_ms → aggregate_window_ms,
         // min_switch_confidence → switch_confidence; the rest pass through.
         const tenantSettings = {
            model_profile: profileId,
            sample_interval_ms: this.runtimeConfig.sample_interval_ms,
            aggregate_window_ms: this.runtimeConfig.window_ms,
            min_valid_frames: this.runtimeConfig.min_valid_frames,
            smoothing_alpha: this.runtimeConfig.smoothing_alpha,
            min_hold_ms: this.runtimeConfig.min_hold_ms,
            switch_confidence: this.runtimeConfig.min_switch_confidence,
         };
         this.runtime = new EmotionRuntime({
            transport: { send: async () => {} }, // no-op until consent + persistence enabled
            mediaPipe: MEDIAPIPE_OPTS,
            onnx: { ...ONNX_OPTS, ...modelConfig },
            sampleIntervalMs: this.runtimeConfig.sample_interval_ms,
            settings: tenantSettings,
            contextProvider: () => ({
               session_id: this.sessionId,
               case_id: this.caseId,
               model_profile: profileId,
            }),
         });
         this.runtime.on('status', s => this.emit({ type: 'status', state: s.state }));
         // Hot-path: every sample event also carries durationMs (how long the
         // last inference took). Surface it via the same pipe so the pill can
         // show "is this slow because the interval is high, or because each
         // inference is taking 4 seconds?" without DevTools spelunking.
         this.runtime.on('sample', s => this.emit({ type: 'sample', sample: s, durationMs: s.durationMs }));
         this.runtime.on('window', events => this.emit({ type: 'window', events }));
         this.runtime.on('error', e => this.emit({ type: 'error', message: e?.message || String(e) }));
         await this.runtime.init();
         this.ready = true;
         oyonClientLog('info', 'miniature models ready', {
            session_id: this.sessionId,
            model_profile: profileId,
         });
         this.emit({ type: 'ready' });
      } catch (err) {
         this.error = err?.message || String(err);
         oyonClientLog('error', 'miniature preload failed', {
            session_id: this.sessionId,
            error: this.error,
         });
         this.emit({ type: 'error', message: this.error });
      }
   }

   async startCamera({ persistFn } = {}) {
      if (this.error) throw new Error(this.error);
      if (!this.runtime) await this.preloadModels();
      if (this.error) throw new Error(this.error);
      this.persistFn = persistFn;
      this.runtime.transport = { send: async (events) => this.persistFn?.(events) };
      await this.runtime.start();
   }

   pause() { this.runtime?.pause?.(); }
   resume() { this.runtime?.resume?.(); }
   // stop() is invoked from both the user-facing Stop button AND the widget's
   // unmount cleanup. In both cases we want full disposal — ONNX session,
   // MediaPipe FaceLandmarker, references — released. Otherwise repeated
   // session re-mounts (route changes, model swaps) would leak WebGPU
   // pipelines and eventually break capture.
   async stop() {
      try { await this.runtime?.dispose?.(); }
      catch { /* ignore */ }
      this.runtime = null;
      this.ready = false;
   }

   on(handler) { this.listeners.add(handler); return () => this.listeners.delete(handler); }
   emit(event) { for (const fn of this.listeners) try { fn(event); } catch { /* ignore */ } }
}

export default function OyonCaptureWidget({ sessionId, caseId } = {}) {
   const [tenantEnabled, setTenantEnabled] = useState(false);
   const [runtimeConfig, setRuntimeConfig] = useState(null);
   const [running, setRunning] = useState(false);
   const [paused, setPaused] = useState(false);
   const [status, setStatus] = useState('idle');
   const [emotion, setEmotion] = useState(null);
   const [valenceTrack, setValenceTrack] = useState([]);
   const [showGraph, setShowGraph] = useState(() => readGraphPref());
   const [errorMsg, setErrorMsg] = useState(null);
   const [persistOk, setPersistOk] = useState(true);
   const [modelsReady, setModelsReady] = useState(false);
   // eslint-disable-next-line unused-imports/no-unused-vars -- value
   // currently consumed only by EventLogger via the setter; reserved
   // for an upcoming "inference latency" badge in the widget.
   const [_inferenceMs, setInferenceMs] = useState(null);

   const sessionRef = useRef(null);

   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/config')
         .then(c => {
            if (cancelled) return;
            setTenantEnabled(Boolean(c?.enabled));
            // /config.runtime is the tenant-level source of truth (model + window
            // params). If it's missing we fall back inside CaptureSession.
            setRuntimeConfig(c?.runtime || null);
            oyonClientLog('debug', 'miniature config loaded', {
               enabled: Boolean(c?.enabled),
               model_profile: c?.runtime?.model_profile,
            });
         })
         .catch((e) => {
            if (cancelled) return;
            setTenantEnabled(false);
            oyonClientLog('warn', 'miniature config fetch failed', { error: e?.message || String(e) });
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

   // Pre-warm: as soon as the tenant is known to be enabled, kick off the
   // model load. The load runs on the main thread (no app-level worker for
   // now); we just defer one slot tick so initial render finishes first and
   // by the time the user clicks camera-start, models are ready and the
   // click feels instant.
   useEffect(() => {
      if (!tenantEnabled) return undefined;
      // Wait until /config has resolved so we don't kick off the heavy load
      // with stale defaults and then have to tear it down when the admin's
      // chosen model arrives a tick later.
      if (runtimeConfig == null) return undefined;
      const session = new CaptureSession({ sessionId, caseId, runtimeConfig });
      sessionRef.current = session;
      const off = session.on(handleEvent);
      // Defer slightly so initial render completes before the heavy load.
      const id = setTimeout(() => session.preloadModels(), 50);
      return () => {
         clearTimeout(id);
         off();
         session.stop();
         sessionRef.current = null;
      };

   }, [tenantEnabled, runtimeConfig, sessionId, caseId]);

   function handleEvent(event) {
      if (event.type === 'status') setStatus(event.state);
      else if (event.type === 'ready') { setModelsReady(true); setStatus('ready'); }
      else if (event.type === 'sample') {
         // Sample events fire every sample_interval_ms (1s by default) and
         // carry the live per-frame prediction. Drive ALL of the live UI from
         // here — pill text, confidence, valence chart — so users see emotions
         // update at sample cadence, not at the 10s window-aggregation cadence.
         if (Number.isFinite(event.durationMs)) setInferenceMs(Math.round(event.durationMs));
         const p = event.sample?.prediction;
         if (!p) return;
         // The runtime's prediction object exposes `probabilities` (per-label
         // map) but NOT a precomputed `dominant` string — that's only added by
         // the EmotionAggregator when it builds a window. Earlier code read
         // p.dominant directly, which was always undefined, so the pill word
         // was effectively driven by 10s window events while everything else
         // (valence/confidence) updated per-sample. Derive top label here.
         const dominant = topLabel(p.probabilities);
         oyonClientLog('debug', 'miniature sample', {
            dominant,
            confidence: p.confidence,
            inference_ms: Math.round(event.durationMs ?? -1),
         });
         const anxious = liveAnxiousIndex(p.probabilities, p.valence, p.arousal);
         setEmotion(prev => ({
            ...(prev || {}),
            dominant_emotion: dominant ?? prev?.dominant_emotion,
            confidence: p.confidence ?? prev?.confidence,
            valence: Number.isFinite(p.valence) ? p.valence : prev?.valence,
            arousal: Number.isFinite(p.arousal) ? p.arousal : prev?.arousal,
            anxious_index: anxious ?? prev?.anxious_index,
         }));
         if (Number.isFinite(p.valence)) {
            setValenceTrack(prev => [...prev, p.valence].slice(-VALENCE_BUFFER));
         }
      } else if (event.type === 'window') {
         // Window events are the persistence-shape rollups. We don't need them
         // for live display anymore (samples cover that) — but keep merging in
         // anything sample events don't already provide (e.g. entropy,
         // missing_face_ratio, model name) so tooltips stay informative.
         const last = event.events?.[event.events.length - 1];
         if (!last) return;
         setEmotion(prev => ({ ...(prev || {}), ...last }));
      } else if (event.type === 'error') {
         setErrorMsg(event.message);
      }
   }

   async function start() {
      if (running) return;
      setErrorMsg(null);

      // Consent is opt-in. The user must have ticked "I agree to local emotion
      // capture" in Settings → Oyon (or in this widget's future inline prompt)
      // before we POST consent. Without consent we still start the camera so
      // the user gets the live preview/feedback, but we never write rows to
      // the backend — that's the privacy contract.
      const userConsent = readConsentPref();
      let consentOk = false;
      if (userConsent && sessionId) {
         try {
            await apiFetch('/addons/oyon/consent', {
               method: 'POST',
               json: { session_id: sessionId, consent_granted: true, source_page: window.location.pathname },
            });
            consentOk = true;
            setPersistOk(true);
            oyonClientLog('info', 'miniature consent recorded', { session_id: sessionId });
         } catch (e) {
            setPersistOk(false);
            oyonClientLog('warn', 'miniature consent POST failed; capture will not persist', {
               session_id: sessionId,
               error: e?.message || String(e),
            });
         }
      } else {
         oyonClientLog('info', 'miniature starting without consent — local-only capture', {
            session_id: sessionId,
            user_consent: userConsent,
         });
      }

      try {
         const persistFn = consentOk ? (events) => persistEvents(events, sessionId, caseId, setPersistOk) : null;
         await sessionRef.current?.startCamera({ persistFn });
         setRunning(true);
         setPaused(false);
         oyonClientLog('info', 'miniature capture started', {
            session_id: sessionId,
            persisting: Boolean(persistFn),
         });
      } catch (e) {
         setErrorMsg(e?.message || 'Could not start capture');
         setStatus('error');
         oyonClientLog('error', 'miniature capture start failed', {
            session_id: sessionId,
            error: e?.message || String(e),
         });
      }
   }

   async function stop() {
      await sessionRef.current?.stop();
      setRunning(false);
      setPaused(false);
      setStatus('stopped');
      setEmotion(null);
      setValenceTrack([]);
   }

   function togglePause() {
      if (!running) return;
      if (paused) { sessionRef.current?.resume(); setPaused(false); }
      else { sessionRef.current?.pause(); setPaused(true); }
   }

   if (!tenantEnabled) return null;

   const launchUrl = buildLaunchUrl({ sessionId, caseId });
   const dom = emotion?.dominant_emotion;
   const conf = Number.isFinite(emotion?.confidence) ? Math.round(emotion.confidence * 100) : null;
   const tone = emotionTone(dom, running && !paused);
   const loadingModels = !modelsReady && !errorMsg;
   const loadingCamera = status === 'starting-camera';
   const loading = loadingCamera; // only "loading" in the button sense when starting camera

   const captureControls = !running ? (
      <IconBtn small={showGraph} onClick={start} disabled={loading || !modelsReady} title={modelsReady ? 'Start capture' : 'Loading models…'}>
         {loading || loadingModels ? <Loader2 className={`${iconCls(showGraph)} animate-spin`} /> : <Camera className={iconCls(showGraph)} />}
      </IconBtn>
   ) : (
      <>
         <IconBtn small={showGraph} onClick={togglePause} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play className={iconCls(showGraph)} /> : <Pause className={iconCls(showGraph)} />}
         </IconBtn>
         <IconBtn small={showGraph} onClick={stop} title="Stop" danger>
            <Square className={iconCls(showGraph)} />
         </IconBtn>
      </>
   );

   // Bug 18: surface the derived anxiety state the model can't name as a
   // class. When elevated, it leads the pill (clinically the salient
   // signal) with the model's own top label kept alongside for context.
   const anxiousFlag = Number.isFinite(emotion?.anxious_index)
      && emotion.anxious_index >= ANXIOUS_FLAG_THRESHOLD;
   const liveWord = anxiousFlag ? (dom ? `anxious · ${dom}` : 'anxious') : (dom || '…');

   const headlineText = errorMsg
      ? 'Error'
      : running ? liveWord
      : loadingModels ? 'loading…'
      : loadingCamera ? 'camera…'
      : modelsReady ? 'Ready'
      : 'Off';

   const errorBanner = errorMsg ? (
      <div className="text-[11px] text-red-200 bg-red-950/60 border border-red-500/40 rounded px-2 py-1 leading-tight max-w-[480px] break-words"
           title={errorMsg}>
         {errorMsg}
      </div>
   ) : null;

   if (showGraph) {
      return (
         <div className="flex flex-col gap-1">
            <div className="flex items-stretch gap-1.5 h-11">
               <div
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 text-sm h-full ${errorMsg ? 'border-red-500/50' : ''}`}
                  style={errorMsg ? { background: 'rgba(127,29,29,0.35)' } : { borderColor: tone.border, background: tone.bg, color: tone.fg }}
               >
                  <span
                     className={`h-2 w-2 rounded-full shrink-0 ${running && !paused ? 'animate-pulse' : ''}`}
                     style={{ background: errorMsg ? '#f87171' : tone.dot }}
                  />
                  <span title={errorMsg || ''} className="font-semibold capitalize tracking-wide leading-none truncate max-w-[90px]">
                     {headlineText}
                  </span>
                  {running && conf != null && (
                     <span className="text-[11px] tabular-nums leading-none shrink-0 opacity-75">{conf}%</span>
                  )}
                  {!persistOk && running && (
                     <AlertTriangle className="h-3.5 w-3.5 text-amber-300" title="Backend rejected writes" />
                  )}
                  <span className="flex items-center gap-1 ml-1">{captureControls}</span>
               </div>
               <ValenceTrack values={valenceTrack} active={running && !paused} compact />
               <a
                  href={launchUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open full Oyon analytics for this session"
                  className="grid place-items-center h-11 w-9 rounded-xl border border-white/10 bg-black/40 text-cyan-100/80 hover:bg-white/10 shrink-0"
               >
                  <ExternalLink className="h-4 w-4" />
               </a>
            </div>
            {errorBanner}
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-1 w-fit">
         <div className={`inline-flex items-center gap-2 rounded-full border pl-3 pr-1.5 py-2 text-cyan-50 text-sm w-fit ${errorMsg ? 'border-red-500/50 bg-red-950/40' : 'border-white/10 bg-black/40'}`}>
            <span
               className={`h-2 w-2 rounded-full shrink-0 ${running && !paused ? 'animate-pulse' : ''}`}
               style={{ background: errorMsg ? '#f87171' : tone.dot }}
            />
            <span title={errorMsg || ''} className="font-semibold capitalize tracking-wide leading-none truncate max-w-[110px]">
               {headlineText}
            </span>
            {running && conf != null && (
               <span className="text-xs text-cyan-100/70 tabular-nums leading-none shrink-0">{conf}%</span>
            )}
            {!persistOk && running && (
               <AlertTriangle className="h-3.5 w-3.5 text-amber-300" title="Local capture only — backend rejected writes" />
            )}
            {captureControls}
            <a
               href={launchUrl}
               target="_blank"
               rel="noreferrer"
               title="Open full Oyon analytics for this session"
               className="grid place-items-center h-7 w-7 rounded-full text-cyan-100/80 hover:bg-white/10 shrink-0"
            >
               <ExternalLink className="h-4 w-4" />
            </a>
         </div>
         {errorBanner}
      </div>
   );
}

async function persistEvents(events, sessionId, caseId, setPersistOk) {
   if (!Array.isArray(events) || events.length === 0) return;
   try {
      await apiFetch('/addons/oyon/emotion-records', {
         method: 'POST',
         json: {
            session_id: sessionId,
            // We do NOT pass consent_version here. The server is the source
            // of truth: it stamps each record with the consent row's
            // consent_version (server/routes/oyon-routes.js insertEmotionRecord).
            // Sending one from the widget would be at best decorative
            // and at worst create the divergence Codex flagged
            // (widget defaulting to 'fer-consent-v1' while the actual
            // accepted version was 'oyon-consent-v1'). The presence of
            // `consent_version` on each event is still required by the
            // payload validator so we send a placeholder; the server
            // overwrites it.
            events: events.map(ev => ({
               ...ev,
               session_id: sessionId,
               case_id: caseId || null,
               capture_mode: ev.capture_mode || 'local-browser',
               consent_version: ev.consent_version || 'placeholder',
            })),
         },
      });
      setPersistOk(true);
      oyonClientLog('debug', 'miniature batch persisted', {
         session_id: sessionId,
         count: events.length,
      });
   } catch (e) {
      setPersistOk(false);
      oyonClientLog('warn', 'miniature batch persist failed', {
         session_id: sessionId,
         count: events.length,
         error: e?.message || String(e),
      });
   }
}

function readConsentPref() {
   // Tenant-level emotion_capture_enabled is the admin's opt-in. Per-user
   // consent defaults to ON when the tenant has opted in, opting OUT only
   // when the user explicitly toggled the switch off in Settings → Oyon
   // (which writes '0'). Previously this defaulted to false, which meant
   // every fresh login captured locally for the live preview but never
   // persisted — analytics stayed empty until the user found and flipped
   // the toggle. Default-on matches what the deployment's admin already
   // decided when they enabled Oyon at the tenant level.
   try {
      const v = localStorage.getItem(CONSENT_PREF_KEY);
      return v !== '0';
   } catch { return true; }
}

// Pick the label with the highest probability from the classifier's
// per-label map. Returns null on empty/non-object input. Used to drive the
// pill word at sample cadence — the per-frame `prediction` doesn't carry a
// pre-picked dominant string (that's added later by the aggregator).
function topLabel(probabilities) {
   if (!probabilities || typeof probabilities !== 'object') return null;
   let best = null;
   let bestVal = -Infinity;
   for (const [label, value] of Object.entries(probabilities)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (n > bestVal) { bestVal = n; best = label; }
   }
   return best;
}

// Derived anxiety indicator (Bug 18). AffectNet 8-class models have no
// "anxious" label, so we derive one from the circumplex axes they DO
// emit: high arousal + negative valence, reinforced by fear. Mirrors
// `anxiousIndex` in OyonR/src/aggregation/EmotionAggregator.js — kept in
// sync deliberately rather than cross-importing the vendored tree (which
// is not in the SPA build graph). Returns 0..1, or null if unknown.
function liveAnxiousIndex(probabilities, valence, arousal) {
   const fear = probabilities && Number.isFinite(Number(probabilities.fear)) ? Number(probabilities.fear) : 0;
   if (!Number.isFinite(valence) && !Number.isFinite(arousal) && !probabilities) return null;
   const clamp01 = (x) => (!Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x);
   const v = Number.isFinite(valence) ? valence : 0;
   const a = Number.isFinite(arousal) ? arousal : 0;
   const quadrant = clamp01((a + 1) / 2) * clamp01((1 - v) / 2);
   return clamp01(0.6 * quadrant + 0.4 * fear);
}

// At/above this the learner is flagged as anxious in the live pill. 0.5
// is the midpoint of the derived [0,1] scale (clearly negative-valence
// AND elevated arousal, or strong fear).
const ANXIOUS_FLAG_THRESHOLD = 0.5;

function iconCls(small) { return small ? 'h-3 w-3' : 'h-4 w-4'; }

function IconBtn({ children, onClick, disabled, title, danger, small }) {
   const size = small ? 'h-5 w-5' : 'h-7 w-7';
   return (
      <button
         type="button"
         onClick={onClick}
         disabled={disabled}
         title={title}
         className={`grid place-items-center ${size} rounded-full disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
            danger ? 'text-red-200 hover:bg-red-500/20' : 'hover:bg-white/15'
         }`}
      >
         {children}
      </button>
   );
}

function buildLaunchUrl({ sessionId, caseId }) {
   // Open the full standalone analytics dashboard (TNA networks, distribution
   // plots, dynamics) in Rohy mode so it reads from the Rohy backend, scoped
   // to the launching session by default. The dashboard's own session
   // selector lets admins pivot to "All sessions" or pick a different one.
   const params = new URLSearchParams();
   params.set('source', 'rohy');
   if (sessionId) params.set('session_id', String(sessionId));
   if (caseId) params.set('case_id', String(caseId));
   return `/oyon/standalone/logs.html?${params.toString()}`;
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
   }, [values]);

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
   }, [values, last]);

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

function emotionTone(emotion, live) {
   const fallback = {
      bg: 'rgba(0,0,0,0.45)',
      border: 'rgba(255,255,255,0.10)',
      fg: 'rgb(207, 250, 254)',
      dot: '#525252',
   };
   if (!live) return fallback;
   const e = String(emotion || '').toLowerCase();
   const map = {
      happy:    { dot: '#34d399', bg: 'rgba(16,185,129,0.22)',  border: 'rgba(16,185,129,0.45)',  fg: '#bbf7d0' },
      joy:      { dot: '#34d399', bg: 'rgba(16,185,129,0.22)',  border: 'rgba(16,185,129,0.45)',  fg: '#bbf7d0' },
      happiness:{ dot: '#34d399', bg: 'rgba(16,185,129,0.22)',  border: 'rgba(16,185,129,0.45)',  fg: '#bbf7d0' },
      sad:      { dot: '#60a5fa', bg: 'rgba(59,130,246,0.22)',  border: 'rgba(59,130,246,0.45)',  fg: '#bfdbfe' },
      sadness:  { dot: '#60a5fa', bg: 'rgba(59,130,246,0.22)',  border: 'rgba(59,130,246,0.45)',  fg: '#bfdbfe' },
      angry:    { dot: '#f87171', bg: 'rgba(220,38,38,0.25)',   border: 'rgba(220,38,38,0.50)',   fg: '#fecaca' },
      anger:    { dot: '#f87171', bg: 'rgba(220,38,38,0.25)',   border: 'rgba(220,38,38,0.50)',   fg: '#fecaca' },
      fear:     { dot: '#fbbf24', bg: 'rgba(217,119,6,0.22)',   border: 'rgba(217,119,6,0.45)',   fg: '#fde68a' },
      surprise: { dot: '#e879f9', bg: 'rgba(217,70,239,0.22)',  border: 'rgba(217,70,239,0.45)',  fg: '#f5d0fe' },
      contempt: { dot: '#fda4af', bg: 'rgba(244,114,182,0.20)', border: 'rgba(244,114,182,0.40)', fg: '#fbcfe8' },
      disgust:  { dot: '#a3e635', bg: 'rgba(132,204,22,0.22)',  border: 'rgba(132,204,22,0.45)',  fg: '#d9f99d' },
      neutral:  { dot: '#22d3ee', bg: 'rgba(34,211,238,0.16)',  border: 'rgba(34,211,238,0.40)',  fg: '#cffafe' },
   };
   return map[e] || map.neutral;
}
