import React, { useEffect, useState } from 'react';
import { Camera, BarChart3, ShieldCheck, Loader2, Save, LineChart, Cpu, AlertTriangle, Activity } from 'lucide-react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { VALENCE_GRAPH_PREF_KEY, CONSENT_PREF_KEY } from '../oyon/OyonCaptureWidget';
import { OYON_CONSENT_CAMERA_ONLY, OYON_CONSENT_VERSION_LS_KEY } from '../../utils/oyonConsent';
import { modelProfileList, DEFAULT_MODEL_PROFILE } from '../oyon/modelProfiles';

// Analytics is an in-app surface: ConfigPanel's "Oyon — Learning Analytics"
// tab embeds the viewer with a host-fed (server-scoped, filtered) data
// bridge. The old new-window launches were removed on purpose — the
// standalone logs page no longer ships, and opening the embedded viewer in
// its own tab gave it NO host data feed, so it rendered empty. Navigation
// happens through `onOpenAnalytics` (passed by ConfigPanel, educator/admin
// only) which just switches the active settings tab.

export default function OyonSettingsTab({ onOpenAnalytics } = {}) {
   const { user, isAdmin } = useAuth();
   const admin = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);

   const [config, setConfig] = useState(null);
   const [settings, setSettings] = useState(null);
   const [savingSettings, setSavingSettings] = useState(false);
   const [savedFlash, setSavedFlash] = useState(false);
   const [error, setError] = useState(null);
   // serverDisabled holds the structured 503 payload from the disabled-Oyon
   // stub mounted in server/routes.js — { code: 'OYON_DISABLED' | 'OYON_IMPORT_FAILED', message: '...' }.
   // When set, we render the friendly panel instead of trying to load config.
   const [serverDisabled, setServerDisabled] = useState(null);
   const [defaultConsent, setDefaultConsent] = useState(() => {
      // Match the opt-out semantics in OyonCaptureWidget.readConsentPref:
      // ON unless explicitly turned off ('0'). Tenant-level enablement is the
      // admin's opt-in; per-user consent only acts as the opt-out switch.
      try { return localStorage.getItem(CONSENT_PREF_KEY) !== '0'; } catch { return true; }
   });
   const [showValenceGraph, setShowValenceGraph] = useState(() => {
      try { return localStorage.getItem(VALENCE_GRAPH_PREF_KEY) === '1'; } catch { return false; }
   });

   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/config')
         .then(c => { if (!cancelled) setConfig(c); })
         .catch(e => {
            if (cancelled) return;
            // Server-side 503 stub: Oyon is gated off (OYON_ENABLED!=1) or
            // the route module failed to import. apiClient maps the JSON
            // body's `code` onto ApiError.code, so we can branch cleanly.
            if (e instanceof ApiError && (e.code === 'OYON_DISABLED' || e.code === 'OYON_IMPORT_FAILED')) {
               setServerDisabled({ code: e.code, message: e.message });
            } else {
               setError(e?.message || 'Could not load Oyon config');
            }
         });
      if (admin) {
         apiFetch('/addons/oyon/settings')
            .then(r => { if (!cancelled) setSettings(r?.settings || null); })
            .catch(() => { /* admin endpoint may 403 in some tenants — ignore */ });
      }
      return () => { cancelled = true; };
   }, [admin]);

   const toggleDefaultConsent = (next) => {
      setDefaultConsent(next);
      // ISSUE-0019: record WHICH contract was accepted, not just that one was.
      // A grant stored without any version reads as v1 everywhere downstream
      // AND told needsConsentUpgrade nobody had answered, so the state was
      // permanent: the signal gate stayed shut and the re-consent prompt, the
      // only repair path, stayed silent.
      //
      // The version recorded here is the CAMERA-ONLY contract, deliberately,
      // and never the tenant's current one. This checkbox says "capture
      // emotions during my simulation sessions ... with the camera pill" and
      // describes nothing else; typing rhythm, interaction and discourse are
      // named only by the re-consent prompt, which exists precisely so those
      // are asked about rather than assumed. Stamping the tenant's current
      // version here would record agreement to a scope this control never
      // showed. A learner who ticks this is then correctly seen as "consented
      // under v1", the prompt asks about the rest, and accepting it there
      // records v2 — which is the chain that makes typing capture start.
      const version = OYON_CONSENT_CAMERA_ONLY;
      try {
         localStorage.setItem(CONSENT_PREF_KEY, next ? '1' : '0');
         if (next) localStorage.setItem(OYON_CONSENT_VERSION_LS_KEY, version);
         else localStorage.removeItem(OYON_CONSENT_VERSION_LS_KEY);
      } catch { /* storage blocked */ }
      // Mirror server-side (merge PUT; onboarding keys are shallow-merged so
      // this can't erase first_run_done) — the choice must follow the user
      // across devices, not stay parked in one browser.
      apiFetch('/users/preferences', {
         method: 'PUT',
         json: {
            onboarding_settings: {
               oyon_consent: next,
               oyon_consent_version: next ? version : null,
            },
         },
      }).catch(() => { /* local flag still applies on this device */ });
   };

   const toggleValenceGraph = (next) => {
      setShowValenceGraph(next);
      try { localStorage.setItem(VALENCE_GRAPH_PREF_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('oyon:setting-changed', {
         detail: { key: VALENCE_GRAPH_PREF_KEY, value: next },
      }));
   };

   const updateSetting = (patch) => setSettings(prev => ({ ...(prev || {}), ...patch }));

   const saveSettings = async () => {
      if (!settings) return;
      setSavingSettings(true);
      setError(null);
      try {
         const res = await apiFetch('/addons/oyon/settings', {
            method: 'PUT',
            json: {
               emotion_capture_enabled: settings.emotion_capture_enabled,
               admin_emotion_view_enabled: settings.admin_emotion_view_enabled,
               educator_emotion_view_enabled: settings.educator_emotion_view_enabled,
               student_emotion_view_enabled: settings.student_emotion_view_enabled,
               retention_days: settings.retention_days,
               consent_version: settings.consent_version,
               model_profile: settings.model_profile,
               sample_interval_ms: settings.sample_interval_ms,
               window_ms: settings.window_ms,
               min_valid_frames: settings.min_valid_frames,
               smoothing_alpha: settings.smoothing_alpha,
               min_hold_ms: settings.min_hold_ms,
               min_switch_confidence: settings.min_switch_confidence,
               // Oyon 3 signal flags (migration 0040). Sent explicitly because
               // this body is a whitelist — an omitted key would leave the
               // toggle above unsaveable. The server merges by key presence, so
               // sending them here cannot disturb anything it doesn't name.
               facial_signals_enabled: settings.facial_signals_enabled,
               eye_tracking_enabled: settings.eye_tracking_enabled,
               gaze_tracking_enabled: settings.gaze_tracking_enabled,
               illumination_enabled: settings.illumination_enabled,
               heart_rate_enabled: settings.heart_rate_enabled,
               respiration_enabled: settings.respiration_enabled,
               enable_dynamics: settings.enable_dynamics,
               posture_tracking_enabled: settings.posture_tracking_enabled,
               signal_window_share: settings.signal_window_share,
               typing_enabled: settings.typing_enabled,
               interaction_enabled: settings.interaction_enabled,
               discourse_enabled: settings.discourse_enabled,
               ai_assist_enabled: settings.ai_assist_enabled,
               voice_enabled: settings.voice_enabled,
            },
         });
         setSettings(res?.settings || settings);
         setSavedFlash(true);
         setTimeout(() => setSavedFlash(false), 1500);
         apiFetch('/addons/oyon/config').then(setConfig).catch(() => {});
      } catch (e) {
         setError(e?.message || 'Could not save Oyon settings');
      } finally {
         setSavingSettings(false);
      }
   };

   const captureEnabled = Boolean(config?.enabled);

   if (serverDisabled) {
      const isImportFail = serverDisabled.code === 'OYON_IMPORT_FAILED';
      return (
         <div className="space-y-6 max-w-4xl">
            <div className="flex items-center gap-2 mb-2">
               <Camera className="w-6 h-6 text-neutral-500" />
               <h2 className="text-xl font-bold text-neutral-300">Oyon — Emotion Capture</h2>
               <span className="ml-auto px-2.5 py-1 rounded-full text-xs font-bold bg-neutral-800 text-neutral-400 border border-neutral-700">
                  {isImportFail ? 'Module failed to load' : 'Disabled on this server'}
               </span>
            </div>
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 space-y-3">
               <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2 text-sm">
                     <p className="font-semibold text-amber-200">
                        {isImportFail
                           ? 'The Oyon add-on is enabled but failed to load.'
                           : 'The Oyon add-on is not enabled on this server.'}
                     </p>
                     <p className="text-amber-100/80 whitespace-pre-line">{serverDisabled.message}</p>
                     <p className="text-xs text-amber-100/60 pt-1">
                        After fixing the issue and restarting rohy, refresh this page to load the Oyon
                        settings.
                     </p>
                  </div>
               </div>
            </div>
            <div className="text-xs text-neutral-500 px-1">
               Reason code: <code className="text-neutral-400">{serverDisabled.code}</code>
            </div>
         </div>
      );
   }

   return (
      <div className="space-y-6 max-w-4xl">
         <div className="flex items-center gap-2 mb-2">
            <Camera className="w-6 h-6 text-purple-500" />
            <h2 className="text-xl font-bold">Oyon — Emotion Capture</h2>
         </div>
         <p className="text-sm text-neutral-400 -mt-3">
            Local browser-side emotion recognition for simulation sessions. Faces never leave the device —
            only aggregate emotion windows are saved into Rohy. Capture runs from the pill in the simulator
            header; analytics live in the Oyon — Learning Analytics tab.
         </p>

         {error && (
            <div className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
               {error}
            </div>
         )}

         <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-300">Status</h3>
                  <p className="text-xs text-neutral-500">Tenant-level capture state</p>
               </div>
               <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${captureEnabled ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/40' : 'bg-neutral-800 text-neutral-400 border border-neutral-700'}`}>
                  {captureEnabled ? 'Enabled' : 'Disabled'}
               </span>
            </div>
            {typeof onOpenAnalytics === 'function' && (
               <div className="flex flex-wrap gap-2 pt-2">
                  <button
                     type="button"
                     onClick={onOpenAnalytics}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-700 hover:bg-purple-600 text-white text-sm font-semibold"
                  >
                     <BarChart3 className="w-4 h-4" /> Open Learning Analytics
                  </button>
               </div>
            )}
         </section>

         <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
               <LineChart className="w-4 h-4 text-purple-400" />
               <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-300">
                  Miniature display
               </h3>
            </div>
            <p className="text-xs text-neutral-500 -mt-2">
               Controls what the small Oyon pill in the simulator header shows.
            </p>
            <label className="flex items-start gap-3 p-3 rounded-md border border-neutral-800 hover:border-neutral-700 cursor-pointer">
               <input
                  type="checkbox"
                  className="mt-1"
                  checked={showValenceGraph}
                  onChange={e => toggleValenceGraph(e.target.checked)}
               />
               <span>
                  <span className="block text-sm font-semibold text-neutral-100">
                     Show valence graph under the miniature
                  </span>
                  <span className="block text-xs text-neutral-400 mt-0.5">
                     A small rolling chart of valence (−1 to +1, ~5s windows). Off by default — turn on
                     if you want a visual trend below the pill while capturing.
                  </span>
               </span>
            </label>
         </section>

         <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
               <ShieldCheck className="w-4 h-4 text-purple-400" />
               <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-300">
                  Recording terms & your consent
               </h3>
            </div>
            <div className="text-sm text-neutral-300 space-y-2">
               <p>When emotion capture runs in your simulation:</p>
               <ul className="list-disc list-inside space-y-1 text-neutral-400">
                  <li>Your camera feed is processed locally in your browser. Frames are not uploaded.</li>
                  <li>Only aggregate windows (dominant emotion, confidence, valence/arousal) are saved.</li>
                  <li>Records are scoped to your session and your tenant.</li>
                  <li>You can withdraw consent at any time by toggling the option below.</li>
               </ul>
               <p className="text-xs text-neutral-500 pt-1">
                  Consent version: <code className="text-neutral-300">{config?.consent_version || '—'}</code>
                  {user?.username && <> · signed in as <code className="text-neutral-300">{user.username}</code></>}
               </p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-md border border-neutral-800 hover:border-neutral-700 cursor-pointer">
               <input
                  type="checkbox"
                  className="mt-1"
                  checked={defaultConsent}
                  onChange={e => toggleDefaultConsent(e.target.checked)}
               />
               <span>
                  <span className="block text-sm font-semibold text-neutral-100">
                     Capture emotions during my simulation sessions
                  </span>
                  <span className="block text-xs text-neutral-400 mt-0.5">
                     Default: on. Records are stored server-side under your account when you start a session
                     with the camera pill. Untick to disable — the live preview still runs (it stays on this
                     device) but nothing is persisted. You can flip this any time.
                  </span>
               </span>
            </label>
         </section>

         {admin && (
            <section className="rounded-lg border border-purple-900/40 bg-purple-950/10 p-5 space-y-4">
               <div className="flex items-center justify-between">
                  <div>
                     <h3 className="text-sm font-bold uppercase tracking-wide text-purple-300">Tenant settings</h3>
                     <p className="text-xs text-neutral-500">Admin only — applies to every user in this tenant</p>
                  </div>
                  <button
                     onClick={saveSettings}
                     disabled={!settings || savingSettings}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold"
                  >
                     {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                     {savedFlash ? 'Saved' : 'Save'}
                  </button>
               </div>

               {!settings ? (
                  <div className="text-sm text-neutral-500 flex items-center gap-2">
                     <Loader2 className="w-4 h-4 animate-spin" /> loading tenant settings…
                  </div>
               ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                     <ToggleRow
                        label="Capture enabled"
                        hint="Master switch for the whole tenant"
                        checked={!!settings.emotion_capture_enabled}
                        onChange={v => updateSetting({ emotion_capture_enabled: v })}
                     />
                     <ToggleRow
                        label="Admins can view records"
                        checked={!!settings.admin_emotion_view_enabled}
                        onChange={v => updateSetting({ admin_emotion_view_enabled: v })}
                     />
                     <ToggleRow
                        label="Educators can view records"
                        checked={!!settings.educator_emotion_view_enabled}
                        onChange={v => updateSetting({ educator_emotion_view_enabled: v })}
                     />
                     <ToggleRow
                        label="Students can view their own records"
                        checked={!!settings.student_emotion_view_enabled}
                        onChange={v => updateSetting({ student_emotion_view_enabled: v })}
                     />
                     <div className="md:col-span-2 border-t border-neutral-800 pt-3">
                        <div className="flex items-center gap-2 mb-3">
                           <Cpu className="w-4 h-4 text-purple-400" />
                           <span className="text-xs font-bold uppercase tracking-wide text-purple-300">Capture engine</span>
                        </div>
                        <p className="text-xs text-neutral-500 mb-3">
                           Single source of truth for the model and aggregation parameters used by the Rohy
                           miniature, the standalone analytics dashboard (when launched from Rohy), and
                           every record written into Rohy's database.
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                           <div>
                              <label className="block text-xs font-semibold text-neutral-300 mb-1">Model</label>
                              <select
                                 value={settings.model_profile || DEFAULT_MODEL_PROFILE}
                                 onChange={e => updateSetting({ model_profile: e.target.value })}
                                 className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
                              >
                                 {modelProfileList().map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                 ))}
                              </select>
                              <p className="text-[11px] text-neutral-500 mt-1">
                                 {modelProfileList().find(p => p.id === (settings.model_profile || DEFAULT_MODEL_PROFILE))?.hint || ''}
                              </p>
                           </div>
                           <NumericRow
                              label="Sample interval (ms)"
                              hint="How often the camera is sampled. Lower = more CPU."
                              value={settings.sample_interval_ms}
                              min={100}
                              max={10000}
                              step={100}
                              onChange={v => updateSetting({ sample_interval_ms: v })}
                           />
                           <NumericRow
                              label="Aggregate window (ms)"
                              hint="Length of each saved window. 10000 = one record every 10s."
                              value={settings.window_ms}
                              min={1000}
                              max={120000}
                              step={500}
                              onChange={v => updateSetting({ window_ms: v })}
                           />
                           <NumericRow
                              label="Min valid frames"
                              hint="Minimum face-tracked frames per window for a record to be saved."
                              value={settings.min_valid_frames}
                              min={1}
                              max={600}
                              step={1}
                              onChange={v => updateSetting({ min_valid_frames: v })}
                           />
                           <NumericRow
                              label="Smoothing α"
                              hint="EMA factor (0–1). Lower = more smoothing, slower to react."
                              value={settings.smoothing_alpha}
                              min={0}
                              max={1}
                              step={0.01}
                              float
                              onChange={v => updateSetting({ smoothing_alpha: v })}
                           />
                           <NumericRow
                              label="Min hold (ms)"
                              hint="Minimum time before the displayed dominant emotion can switch."
                              value={settings.min_hold_ms}
                              min={0}
                              max={60000}
                              step={250}
                              onChange={v => updateSetting({ min_hold_ms: v })}
                           />
                           <NumericRow
                              label="Switch confidence"
                              hint="Confidence required to switch emotions (0–1)."
                              value={settings.min_switch_confidence}
                              min={0}
                              max={1}
                              step={0.01}
                              float
                              onChange={v => updateSetting({ min_switch_confidence: v })}
                           />
                        </div>
                     </div>
                     {/* Oyon 3 signals (migration 0040). Appended as its own
                         section — nothing above changes. These are AUTHORITY
                         over signals that already run: the capture element
                         enables them by its own defaults, so before these
                         existed a tenant could not switch any of them off. */}
                     <div className="md:col-span-2 border-t border-neutral-800 pt-3">
                        <div className="flex items-center gap-2 mb-3">
                           <Activity className="w-4 h-4 text-purple-400" />
                           <span className="text-xs font-bold uppercase tracking-wide text-purple-300">Signals</span>
                        </div>
                        <p className="text-xs text-neutral-500 mb-3">
                           Which signal families the capture element records alongside emotion. All are
                           aggregates only — no frames, images or landmarks ever leave the browser.
                           Heart rate and respiration are camera-derived research estimates about the
                           <span className="text-neutral-300"> learner</span>, never clinical measurements
                           and unrelated to the simulated patient&apos;s vitals.
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                           <ToggleRow
                              label="Facial signals"
                              hint="Head pose + action units. No extra model — derived from the face the emotion pipeline already detects."
                              checked={!!settings.facial_signals_enabled}
                              onChange={v => updateSetting({ facial_signals_enabled: v })}
                           />
                           <ToggleRow
                              label="Eye / engagement"
                              hint="Blink rate, eye openness, on-task aggregates."
                              checked={!!settings.eye_tracking_enabled}
                              onChange={v => updateSetting({ eye_tracking_enabled: v })}
                           />
                           <ToggleRow
                              label="Gaze"
                              hint="Screen-zone shares and AOI dwell. Training-free mediapipe engine; aggregates, never a raw point stream."
                              checked={!!settings.gaze_tracking_enabled}
                              onChange={v => updateSetting({ gaze_tracking_enabled: v })}
                           />
                           <ToggleRow
                              label="Illumination"
                              hint="Ambient light level — the quality covariate for every other signal."
                              checked={!!settings.illumination_enabled}
                              onChange={v => updateSetting({ illumination_enabled: v })}
                           />
                           <ToggleRow
                              label="Heart rate (learner, research-grade)"
                              hint="Camera-derived rPPG estimate of the LEARNER. Not clinical, not the patient's vitals."
                              checked={!!settings.heart_rate_enabled}
                              onChange={v => updateSetting({ heart_rate_enabled: v })}
                           />
                           <ToggleRow
                              label="Respiration (learner, research-grade)"
                              hint="Breathing rate from the same colour stream. Not diagnostic."
                              checked={!!settings.respiration_enabled}
                              onChange={v => updateSetting({ respiration_enabled: v })}
                           />
                           <ToggleRow
                              label="Dynamical features"
                              hint="Cross-window change metrics over whatever blocks a window carries."
                              checked={!!settings.enable_dynamics}
                              onChange={v => updateSetting({ enable_dynamics: v })}
                           />
                           <ToggleRow
                              label="Body posture — needs internet"
                              hint="OFF by default: the pose model is not bundled, so enabling this makes the browser download it from a Google CDN. Leave off on air-gapped installs."
                              checked={!!settings.posture_tracking_enabled}
                              onChange={v => updateSetting({ posture_tracking_enabled: v })}
                           />
                           <ToggleRow
                              label="Typing dynamics"
                              hint="Keystroke timing on the message composer — pause and burst structure, never the text itself. Needs learner consent v2."
                              checked={!!settings.typing_enabled}
                              onChange={v => updateSetting({ typing_enabled: v })}
                           />
                           <ToggleRow
                              label="Interaction telemetry"
                              hint="Pointer, click, scroll, selection and focus aggregates across the page. Needs learner consent v2."
                              checked={!!settings.interaction_enabled}
                              onChange={v => updateSetting({ interaction_enabled: v })}
                           />
                           <ToggleRow
                              label="Discourse analytics"
                              hint="Per-sentence speech acts and text metrics over messages the learner sends. Needs learner consent v2."
                              checked={!!settings.discourse_enabled}
                              onChange={v => updateSetting({ discourse_enabled: v })}
                           />
                           <ToggleRow
                              label="Voice"
                              hint="Pitch, loudness and pauses while a learner speaks to the patient in voice mode — measurements only, never the recording. Uses the microphone for the length of each spoken turn. Needs learner consent v3; turning it on asks every learner for v3 on their next visit."
                              checked={!!settings.voice_enabled}
                              onChange={v => updateSetting({ voice_enabled: v })}
                           />
                           <ToggleRow
                              label="AI-assistance cycles"
                              hint="Suggestion request / accept / reject timing. Rohy has no AI-suggestion cycle today, so this records nothing. Needs learner consent v3."
                              checked={!!settings.ai_assist_enabled}
                              onChange={v => updateSetting({ ai_assist_enabled: v })}
                           />
                           <ToggleRow
                              label="Keep signals on one window"
                              hint="On: signals ride the emotion window. Off: each arrives as its own window. Both are stored either way."
                              checked={!!settings.signal_window_share}
                              onChange={v => updateSetting({ signal_window_share: v })}
                           />
                        </div>
                     </div>
                     <div className="md:col-span-2 flex items-center gap-3 border-t border-neutral-800 pt-3">
                        <label className="text-sm font-semibold text-neutral-200 w-40">Retention (days)</label>
                        <input
                           type="number"
                           min={1}
                           value={settings.retention_days ?? ''}
                           placeholder="unlimited"
                           onChange={e => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              updateSetting({ retention_days: Number.isFinite(v) && v > 0 ? v : null });
                           }}
                           className="w-32 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
                        />
                        <span className="text-xs text-neutral-500">leave blank to keep records indefinitely</span>
                     </div>
                     <div className="md:col-span-2 flex items-center gap-3">
                        <label className="text-sm font-semibold text-neutral-200 w-40">Consent version</label>
                        <input
                           type="text"
                           value={settings.consent_version || ''}
                           onChange={e => updateSetting({ consent_version: e.target.value.slice(0, 100) })}
                           className="flex-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
                        />
                     </div>
                  </div>
               )}
            </section>
         )}

      </div>
   );
}

function ToggleRow({ label, hint, checked, onChange }) {
   return (
      <label className="flex items-start gap-3 p-3 rounded-md border border-neutral-800 hover:border-neutral-700 cursor-pointer">
         <input
            type="checkbox"
            className="mt-1"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
         />
         <span className="min-w-0">
            <span className="block text-sm font-semibold text-neutral-100">{label}</span>
            {hint && <span className="block text-xs text-neutral-500 mt-0.5">{hint}</span>}
         </span>
      </label>
   );
}

function NumericRow({ label, hint, value, min, max, step, float = false, onChange }) {
   const display = value ?? '';
   return (
      <div>
         <label className="block text-xs font-semibold text-neutral-300 mb-1">{label}</label>
         <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={display}
            onChange={e => {
               const raw = e.target.value;
               if (raw === '') return;
               const n = float ? Number(raw) : Math.round(Number(raw));
               if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
            }}
            className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
         />
         {hint && <p className="text-[11px] text-neutral-500 mt-1">{hint}</p>}
      </div>
   );
}
