import React, { useEffect, useState } from 'react';
import { Camera, ExternalLink, BarChart3, ShieldCheck, Loader2, Save, LineChart, Cpu } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { VALENCE_GRAPH_PREF_KEY, CONSENT_PREF_KEY } from '../oyon/OyonCaptureWidget';
import { modelProfileList, DEFAULT_MODEL_PROFILE } from '../oyon/modelProfiles';

// Relative URLs only. Vite's dev proxy forwards /oyon/* to Express on :3000,
// so this path works the same in dev and prod. Earlier the dev branch hard-
// coded http://127.0.0.1:3000 — that's a *different origin* from the SPA's
// http://localhost:5173, so the auth cookie never followed the user across
// the click and every API call from the standalone returned 401, which
// looked like "Oyon is unreachable" + "the standalone is using a different
// model" because it'd silently fall back to its localStorage default.
const OYON_URL = '/oyon/standalone/';
const OYON_LOGS_URL = '/oyon/standalone/logs.html';

export default function OyonSettingsTab() {
   const { user, isAdmin } = useAuth();
   const admin = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);

   const [config, setConfig] = useState(null);
   const [settings, setSettings] = useState(null);
   const [savingSettings, setSavingSettings] = useState(false);
   const [savedFlash, setSavedFlash] = useState(false);
   const [error, setError] = useState(null);
   const [defaultConsent, setDefaultConsent] = useState(() => {
      try { return localStorage.getItem(CONSENT_PREF_KEY) === '1'; } catch { return false; }
   });
   const [showValenceGraph, setShowValenceGraph] = useState(() => {
      try { return localStorage.getItem(VALENCE_GRAPH_PREF_KEY) === '1'; } catch { return false; }
   });

   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/config')
         .then(c => { if (!cancelled) setConfig(c); })
         .catch(e => { if (!cancelled) setError(e?.message || 'Could not load Oyon config'); });
      if (admin) {
         apiFetch('/addons/oyon/settings')
            .then(r => { if (!cancelled) setSettings(r?.settings || null); })
            .catch(() => { /* admin endpoint may 403 in some tenants — ignore */ });
      }
      return () => { cancelled = true; };
   }, [admin]);

   const toggleDefaultConsent = (next) => {
      setDefaultConsent(next);
      try { localStorage.setItem(CONSENT_PREF_KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
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

   return (
      <div className="space-y-6 p-6 max-w-4xl">
         <div className="flex items-center gap-2 mb-2">
            <Camera className="w-6 h-6 text-purple-500" />
            <h2 className="text-xl font-bold">Oyon — Emotion Capture</h2>
         </div>
         <p className="text-sm text-neutral-400 -mt-3">
            Local browser-side emotion recognition for simulation sessions. Faces never leave the device —
            only aggregate emotion windows are saved into Rohy. The full capture, settings, and analytics
            views live in the Oyon application.
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
            <div className="flex flex-wrap gap-2 pt-2">
               <a
                  href={OYON_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-700 hover:bg-purple-600 text-white text-sm font-semibold"
               >
                  <ExternalLink className="w-4 h-4" /> Open Oyon
               </a>
               <a
                  href={OYON_LOGS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 hover:bg-neutral-800 text-neutral-200 text-sm font-semibold"
               >
                  <BarChart3 className="w-4 h-4" /> Open Analytics
               </a>
            </div>
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
                     I agree to local emotion capture in my simulation sessions
                  </span>
                  <span className="block text-xs text-neutral-400 mt-0.5">
                     Stored on this device. Each new session you start will use this preference; you can
                     still revoke per-session in the Oyon app.
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
