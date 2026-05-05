// Full-page editor for agent persona templates.
//
// Renders edge-to-edge (no parent chrome) so every concern — identity,
// avatar, voice, prompt, dos/donts, behaviour, LLM, memory access, and
// the discussant carve-out — has room to breathe. Mirrors the
// `showFullPageSettings` / `showTnaAnalytics` pattern in App.jsx.
//
// Two-way contract:
//   props.templateId → 'new' | <number> | null  (null is invalid; caller must set one)
//   props.onClose()  → return to wherever the caller came from (typically the
//                       Agent Personas tab inside ConfigPanel)
//
// On Save, the template is persisted via AgentService and the editor closes.
// Reset-to-defaults is offered for is_default rows; it round-trips through
// the dedicated server endpoint so the JS DEFAULT_AGENTS array stays the
// single source of truth.

import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
   ArrowLeft, Save, RotateCcw, Trash2, Copy, X, Plus, GripVertical,
   User, Image as ImageIcon, Mic, Sparkles, Settings as SettingsIcon,
   Zap, Brain, GraduationCap, CheckCircle, AlertCircle, Loader2,
   Eye, EyeOff, PlayCircle, StopCircle, Volume2
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useVoice } from '../../contexts/VoiceContext';
import { AgentService } from '../../services/AgentService';
import { VoiceService } from '../../services/voiceService';
import { AuthService } from '../../services/authService';
import { apiUrl, baseUrl } from '../../config/api';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';
import { resolveVoice } from '../../utils/voiceResolver.js';

// Heavy three.js head viewer — lazy so admins who never open the editor
// don't pay the bundle cost.
const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

// Domain enums kept in sync with AgentTemplateManager's copies. Duplicated
// rather than imported to keep the two surfaces independent — neither
// component is a "library" for the other.
const AGENT_TYPES = [
   { value: 'patient', label: 'Patient', description: 'The simulated patient persona' },
   { value: 'discussant', label: 'Discussant', description: 'Case debrief tutor (post-case discussion)' },
   { value: 'nurse', label: 'Nurse', description: 'Bedside nursing staff' },
   { value: 'consultant', label: 'Consultant', description: 'Specialist physicians' },
   { value: 'relative', label: 'Family member', description: 'Patient family members' },
   { value: 'pharmacist', label: 'Pharmacist', description: 'Pharmacy consultation' },
   { value: 'technician', label: 'Technician', description: 'Lab/Radiology technicians' },
   { value: 'other', label: 'Other', description: 'Custom agent type' }
];

const CONTEXT_FILTERS = [
   { value: 'full', label: 'Full Context', description: 'All patient data + team communications' },
   { value: 'history', label: 'History Only', description: 'Patient history and related comms' },
   { value: 'vitals', label: 'Vitals Only', description: 'Current vitals and recent changes' },
   { value: 'minimal', label: 'Minimal', description: 'Basic demographics only' }
];

const COMMUNICATION_STYLES = [
   { value: 'professional', label: 'Professional' },
   { value: 'educational', label: 'Educational' },
   { value: 'emotional', label: 'Emotional' },
   { value: 'concise', label: 'Concise' }
];

const LLM_PROVIDERS = [
   { value: '', label: 'Use Platform Default' },
   { value: 'openai', label: 'OpenAI' },
   { value: 'anthropic', label: 'Anthropic' },
   { value: 'openrouter', label: 'OpenRouter' },
   { value: 'custom', label: 'Custom Endpoint' }
];

// Keep these aligned with VoiceSettingsTab.jsx — same providers the platform
// settings tab exposes (piper / kokoro / google / openai). The voice list
// fetch (/api/tts/voices?provider=…) handles all four.
const TTS_PROVIDERS = [
   { value: '', label: 'Inherit (use global)' },
   { value: 'piper', label: 'Piper — local, fast, robotic' },
   { value: 'kokoro', label: 'Kokoro-82M — local, expressive' },
   { value: 'google', label: 'Google Cloud TTS — Neural2 / Chirp HD' },
   { value: 'openai', label: 'OpenAI TTS — alloy / echo / nova / onyx / shimmer' }
];

const UNLOCK_TRIGGERS = [
   { value: 'after_case_ended', label: 'After case ends (debrief)' },
   { value: 'always', label: 'Always available' },
];

const MEMORY_CATEGORIES = [
   { key: 'OBTAINED', label: 'History (OBTAINED)', description: 'Patient history, symptoms, HPI, PMH' },
   { key: 'EXAMINED', label: 'Physical Exam (EXAMINED)', description: 'Physical examination findings' },
   { key: 'ELICITED', label: 'Tests Elicited (ELICITED)', description: 'Reflexes, sensory tests' },
   { key: 'NOTED', label: 'Observations (NOTED)', description: 'General observations' },
   { key: 'ORDERED', label: 'Orders (ORDERED)', description: 'Labs, imaging, medications' },
   { key: 'ADMINISTERED', label: 'Administered', description: 'Treatments given' },
   { key: 'CHANGED', label: 'Changes (CHANGED)', description: 'Vital changes, positioning' },
   { key: 'EXPRESSED', label: 'Communication (EXPRESSED)', description: 'Explanations to patient' }
];

const DEFAULT_MEMORY_ACCESS = MEMORY_CATEGORIES.reduce((acc, c) => {
   acc[c.key] = true;
   return acc;
}, {});

const DEFAULT_PREVIEW_TEXT = (template) => {
   const name = (template?.name || '').trim();
   const role = (template?.role_title || '').trim();
   if (name && role) return `Hello, I'm ${name}, ${role}. How can I help today?`;
   if (name) return `Hello, I'm ${name}. How can I help today?`;
   return 'Hello, this is a voice preview from the Rohy simulator.';
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AgentPersonaEditor({ templateId, onClose }) {
   const toast = useToast();
   const { headManifest: ctxHeadManifest, voiceSettings: ctxVoiceSettings, platformAvatars: ctxPlatformAvatars, setSpeaking } = useVoice();

   const [template, setTemplate] = useState(null);
   const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
   const [resetConfirm, setResetConfirm] = useState(false);
   const [deleteConfirm, setDeleteConfirm] = useState(false);
   const [showApiKey, setShowApiKey] = useState(false);
   const [testingLLM, setTestingLLM] = useState(false);
   const [testResult, setTestResult] = useState(null);
   const [ttsVoices, setTtsVoices] = useState([]);

   // VoiceContext entries are populated lazily by ChatInterface; if the
   // admin opens the editor before chatting, fetch them ourselves. Falling
   // back to the context values means we share a cache when possible.
   const [voiceSettings, setVoiceSettings] = useState(ctxVoiceSettings);
   const [platformAvatars, setPlatformAvatars] = useState(ctxPlatformAvatars);
   const [headManifest, setHeadManifest] = useState(ctxHeadManifest);
   const [previewState, setPreviewState] = useState({ playing: false, text: '' });
   const previewTextRef = useRef('');

   // Initial load: template + ancillary platform settings.
   useEffect(() => {
      let cancelled = false;
      const token = AuthService.getToken();

      (async () => {
         setLoading(true);
         try {
            const tplPromise = templateId === 'new'
               ? Promise.resolve(blankTemplate())
               : AgentService.getTemplate(templateId).then(tpl => normalizeFromServer(tpl));

            const ancillary = Promise.allSettled([
               headManifest ? Promise.resolve(null) : fetch(baseUrl('/avatars/heads/manifest.json')).then(r => r.ok ? r.json() : null).catch(() => null),
               voiceSettings ? Promise.resolve(null) : fetch(apiUrl('/platform-settings/voice'), { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).catch(() => null),
               platformAvatars ? Promise.resolve(null) : fetch(apiUrl('/platform-settings/avatars'), { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).catch(() => null)
            ]);

            const [tpl, ancRes] = await Promise.all([tplPromise, ancillary]);
            if (cancelled) return;
            if (!tpl) {
               toast.error('Failed to load agent template');
               onClose?.();
               return;
            }
            setTemplate(tpl);

            const [hmRes, vsRes, paRes] = ancRes;
            if (!headManifest && hmRes.status === 'fulfilled' && hmRes.value) setHeadManifest(hmRes.value);
            if (!voiceSettings && vsRes.status === 'fulfilled' && vsRes.value) setVoiceSettings(vsRes.value);
            if (!platformAvatars && paRes.status === 'fulfilled' && paRes.value) setPlatformAvatars(paRes.value);
         } catch (err) {
            if (!cancelled) {
               console.error('[AgentPersonaEditor] load failed:', err);
               toast.error(err.message || 'Failed to load editor');
               onClose?.();
            }
         } finally {
            if (!cancelled) setLoading(false);
         }
      })();
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [templateId]);

   // Load voices for the current TTS provider — Piper and Kokoro have
   // disjoint catalogues, so the dropdown swaps when the engine changes.
   useEffect(() => {
      const provider = template?.config?.voice?.tts_provider || 'piper';
      let cancelled = false;
      fetch(apiUrl(`/tts/voices?provider=${provider}`), { headers: AuthService.authHeaders() })
         .then(r => r.ok ? r.json() : { voices: [] })
         .then(d => { if (!cancelled) setTtsVoices(d.voices || []); })
         .catch(() => { if (!cancelled) setTtsVoices([]); });
      return () => { cancelled = true; };
   }, [template?.config?.voice?.tts_provider]);

   // Stop any in-flight preview when the editor unmounts. Otherwise the
   // user could leave with a Kokoro buffer still draining into headphones.
   useEffect(() => {
      return () => {
         try { VoiceService.cancelSpeech(); } catch { /* noop */ }
      };
   }, []);

   // ─── derived state ─────────────────────────────────────────────────────
   const isStandard = template?.is_default === 1 || template?.is_default === true;
   const isCreate = templateId === 'new' || !template?.id;
   const cfg = template?.config || {};
   const dos = Array.isArray(cfg.dos) ? cfg.dos : [];
   const donts = Array.isArray(cfg.donts) ? cfg.donts : [];

   const effectiveCamera = useMemo(() => {
      if (!template?.avatar_url) return null;
      return resolveCamera(headManifest, template.avatar_url, cfg.avatar_camera);
   }, [headManifest, template?.avatar_url, cfg.avatar_camera]);

   // Voice resolution comes from the shared util — same chain the chat and
   // discussant runtime use. Passing `ttsVoices` enables the editor-only
   // 'catalog-first' tier so the preview button can play a voice on a fresh
   // Piper install with empty platform slots; runtime callsites omit
   // ttsVoices and correctly 503 in that case.
   const resolvedVoice = useMemo(() => {
      if (!template) return null;
      return resolveVoice({
         voice: template.config?.voice,
         voiceSettings,
         platformAvatars,
         gender: template.config?.gender || template.config?.voice?.gender || '',
         age: template.config?.age,
         ttsVoices
      });
   }, [template, voiceSettings, platformAvatars, ttsVoices]);

   const resolvedVoiceFile = resolvedVoice?.file || null;
   const resolvedProvider = resolvedVoice?.provider || 'piper';
   const resolvedRate = resolvedVoice?.rate ?? 1.0;

   // ─── mutators ──────────────────────────────────────────────────────────
   const set = (updater) => setTemplate(prev => updater({ ...prev }));
   const setField = (field, value) => set(t => ({ ...t, [field]: value }));
   const setConfigField = (field, value) => set(t => ({
      ...t, config: { ...(t.config || {}), [field]: value }
   }));
   const updateVoiceField = (field, value) => set(t => {
      const next = { ...(t.config?.voice || {}) };
      if (value === '' || value === null || value === undefined) delete next[field];
      else next[field] = value;
      const cfgNext = { ...(t.config || {}) };
      if (Object.keys(next).length === 0) delete cfgNext.voice;
      else cfgNext.voice = next;
      return { ...t, config: cfgNext };
   });
   const updateTtsProvider = (value) => set(t => {
      // Switching engines invalidates the per-agent voice file (Piper
      // filenames and Kokoro slugs aren't interchangeable).
      const next = { ...(t.config?.voice || {}) };
      delete next.case_voice;
      if (value === '') delete next.tts_provider;
      else next.tts_provider = value;
      const cfgNext = { ...(t.config || {}) };
      if (Object.keys(next).length === 0) delete cfgNext.voice;
      else cfgNext.voice = next;
      return { ...t, config: cfgNext };
   });
   const updateAvatarCamera = (patch) => set(t => {
      const base = t.config?.avatar_camera || resolveCamera(headManifest, t.avatar_url, null);
      const next = mergeCameraPatch(base, patch);
      return { ...t, config: { ...(t.config || {}), avatar_camera: next } };
   });
   const resetAvatarCamera = () => set(t => {
      const next = { ...(t.config || {}) };
      delete next.avatar_camera;
      return { ...t, config: next };
   });
   const toggleMemoryAccess = (key) => set(t => ({
      ...t,
      memory_access: { ...(t.memory_access || {}), [key]: !t.memory_access?.[key] }
   }));
   const updateDosList = (next) => setConfigField('dos', next.filter(s => typeof s === 'string'));
   const updateDontsList = (next) => setConfigField('donts', next.filter(s => typeof s === 'string'));

   // ─── actions ───────────────────────────────────────────────────────────
   const handleSave = async () => {
      if (!template) return;
      if (!template.name?.trim()) {
         toast.warning('Name is required');
         return;
      }
      if (!template.system_prompt?.trim()) {
         toast.warning('System prompt is required');
         return;
      }

      setSaving(true);
      try {
         if (isCreate) {
            await AgentService.createTemplate(template);
            toast.success('Template created');
         } else {
            await AgentService.updateTemplate(template.id, template);
            toast.success(isStandard ? 'Standard template updated' : 'Template updated');
         }
         onClose?.();
      } catch (err) {
         toast.error(err.message || 'Failed to save template');
      } finally {
         setSaving(false);
      }
   };

   const handleResetToDefault = async () => {
      if (!template?.id) return;
      try {
         const result = await AgentService.resetTemplateToDefault(template.id);
         toast.success(result.message || 'Reset to shipped defaults');
         if (result.template) {
            setTemplate(normalizeFromServer(result.template));
         }
         setResetConfirm(false);
      } catch (err) {
         toast.error(err.message || 'Failed to reset to defaults');
      }
   };

   const handleDelete = async () => {
      if (!template?.id) return;
      try {
         await AgentService.deleteTemplate(template.id);
         toast.success('Template deleted');
         onClose?.();
      } catch (err) {
         toast.error(err.message || 'Failed to delete template');
         setDeleteConfirm(false);
      }
   };

   const handleDuplicate = async () => {
      if (!template?.id) return;
      try {
         await AgentService.duplicateTemplate(template.id, `${template.name} (Copy)`);
         toast.success('Template duplicated. Returning to list…');
         onClose?.();
      } catch (err) {
         toast.error(err.message || 'Failed to duplicate');
      }
   };

   const handleTestLLM = async () => {
      if (!template?.id) {
         toast.warning('Save the template first before testing LLM');
         return;
      }
      setTestingLLM(true);
      setTestResult(null);
      try {
         const result = await AgentService.testLLM(template.id);
         setTestResult({
            success: true,
            provider: result.provider,
            model: result.model,
            latency: result.latency_ms,
            response: result.response
         });
         toast.success(`LLM test OK (${result.latency_ms}ms)`);
      } catch (err) {
         setTestResult({ success: false, error: err.message || 'Test failed' });
         toast.error(err.message || 'LLM test failed');
      } finally {
         setTestingLLM(false);
      }
   };

   const handlePreviewVoice = async () => {
      if (previewState.playing) {
         try { VoiceService.cancelSpeech(); } catch { /* noop */ }
         setPreviewState({ playing: false, text: '' });
         setSpeaking?.(false);
         return;
      }
      if (!resolvedVoiceFile) {
         toast.warning('No voice could be resolved — pick a voice or set a platform default first.');
         return;
      }
      const text = (previewTextRef.current || DEFAULT_PREVIEW_TEXT(template)).trim();
      setPreviewState({ playing: true, text });
      setSpeaking?.(true);
      try {
         await VoiceService.speak({
            text,
            voice: resolvedVoiceFile,
            rate: resolvedRate,
            provider: resolvedProvider,
            onEnd: () => {
               setPreviewState({ playing: false, text: '' });
               setSpeaking?.(false);
            },
            onError: (err) => {
               toast.error(`Voice preview failed: ${err.message || err}`);
               setPreviewState({ playing: false, text: '' });
               setSpeaking?.(false);
            }
         });
      } catch (err) {
         toast.error(`Voice preview failed: ${err.message || err}`);
         setPreviewState({ playing: false, text: '' });
         setSpeaking?.(false);
      }
   };

   // ─── render ────────────────────────────────────────────────────────────
   if (loading || !template) {
      return (
         <div className="h-screen w-screen bg-neutral-950 text-white flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-neutral-400">
               <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
               <span className="text-sm">Loading persona editor…</span>
            </div>
         </div>
      );
   }

   const typeLabel = AGENT_TYPES.find(a => a.value === template.agent_type)?.label || template.agent_type;

   return (
      <div className="h-screen w-screen bg-neutral-950 text-white flex flex-col overflow-hidden">

         {/* ── Header ─────────────────────────────────────────────────── */}
         <header className="border-b border-neutral-800 bg-neutral-900/95 px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
               <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors shrink-0"
                  title="Back to Agent Personas"
               >
                  <ArrowLeft className="w-5 h-5" />
               </button>
               <div className="min-w-0">
                  <h1 className="text-lg font-bold truncate">
                     {isCreate ? 'New Agent Persona' : `Edit: ${template.name || 'Untitled'}`}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                     <span className="capitalize">{typeLabel}</span>
                     {isStandard && (
                        <span className="px-2 py-0.5 rounded bg-purple-700/40 border border-purple-700/60 text-purple-200">
                           Standard (shipped)
                        </span>
                     )}
                     {isCreate && (
                        <span className="px-2 py-0.5 rounded bg-emerald-700/40 border border-emerald-700/60 text-emerald-200">
                           Unsaved
                        </span>
                     )}
                  </div>
               </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
               {!isCreate && (
                  <button
                     onClick={handleDuplicate}
                     className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm flex items-center gap-1.5"
                     title="Create an editable copy of this persona"
                  >
                     <Copy className="w-4 h-4" /> Duplicate
                  </button>
               )}
               {isStandard && !isCreate && (
                  <button
                     onClick={() => setResetConfirm(true)}
                     className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm flex items-center gap-1.5"
                     title="Re-apply the shipped baseline values"
                  >
                     <RotateCcw className="w-4 h-4" /> Reset to defaults
                  </button>
               )}
               {!isCreate && !isStandard && (
                  <button
                     onClick={() => setDeleteConfirm(true)}
                     className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded text-sm flex items-center gap-1.5"
                  >
                     <Trash2 className="w-4 h-4" /> Delete
                  </button>
               )}
               <button
                  onClick={onClose}
                  className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm flex items-center gap-1.5"
               >
                  <X className="w-4 h-4" /> Cancel
               </button>
               <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-semibold flex items-center gap-1.5"
               >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isCreate ? 'Create persona' : 'Save changes'}
               </button>
            </div>
         </header>

         {/* ── Body ───────────────────────────────────────────────────── */}
         <div className="flex-1 overflow-y-auto bg-neutral-950">
            <div className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">

               {/* ── Left rail: Identity / Avatar / Voice ──────────── */}
               <div className="space-y-6">
                  <Section icon={<User className="w-4 h-4 text-blue-400" />} title="Identity">
                     <Field label="Agent type">
                        <select
                           value={template.agent_type}
                           onChange={(e) => setField('agent_type', e.target.value)}
                           className={inputClass}
                        >
                           {AGENT_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
                           ))}
                        </select>
                     </Field>
                     <Field label="Display name *" hint="Shown to learners and to the LLM as the speaker.">
                        <input
                           type="text"
                           value={template.name || ''}
                           onChange={(e) => setField('name', e.target.value)}
                           placeholder="e.g., Sarah Mitchell"
                           className={inputClass}
                        />
                     </Field>
                     <Field label="Role title">
                        <input
                           type="text"
                           value={template.role_title || ''}
                           onChange={(e) => setField('role_title', e.target.value)}
                           placeholder="e.g., Bedside Nurse"
                           className={inputClass}
                        />
                     </Field>
                     <Field label="Communication style">
                        <select
                           value={template.communication_style || ''}
                           onChange={(e) => setField('communication_style', e.target.value)}
                           className={inputClass}
                        >
                           <option value="">— None specified —</option>
                           {COMMUNICATION_STYLES.map(s => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                           ))}
                        </select>
                     </Field>
                     <Field label="Gender slot" hint="Drives default avatar/voice selection when no explicit override is set.">
                        <select
                           value={template.config?.gender || ''}
                           onChange={(e) => setConfigField('gender', e.target.value || undefined)}
                           className={inputClass}
                        >
                           <option value="">Auto-detect from name</option>
                           <option value="male">Male</option>
                           <option value="female">Female</option>
                        </select>
                     </Field>
                  </Section>

                  <Section icon={<ImageIcon className="w-4 h-4 text-pink-400" />} title="Avatar">
                     <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4">
                        <div className="aspect-square w-full bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
                           {template.avatar_url && headManifest ? (
                              <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-500" /></div>}>
                                 <PatientAvatar
                                    patient={{ id: `tpl-${template.id || 'new'}`, name: template.name, gender: template.config?.gender }}
                                    headManifest={headManifest}
                                    avatarId={template.avatar_url}
                                    cameraOverride={effectiveCamera}
                                 />
                              </Suspense>
                           ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs text-center px-3">
                                 Pick an avatar to preview live
                              </div>
                           )}
                        </div>
                        <div className="space-y-3">
                           <Field label="3D avatar">
                              <select
                                 value={template.avatar_url || ''}
                                 onChange={(e) => setField('avatar_url', e.target.value || null)}
                                 className={inputClass}
                              >
                                 <option value="">Auto (by gender)</option>
                                 {(headManifest?.all || []).map(a => (
                                    <option key={a.id} value={a.id}>{a.label}</option>
                                 ))}
                              </select>
                           </Field>
                           {template.avatar_url && effectiveCamera && (
                              <div className="border-t border-neutral-800 pt-3">
                                 <AvatarFramingSliders
                                    camera={effectiveCamera}
                                    onChange={updateAvatarCamera}
                                    onReset={resetAvatarCamera}
                                    hasOverride={!!cfg.avatar_camera}
                                 />
                              </div>
                           )}
                        </div>
                     </div>
                  </Section>

                  <Section icon={<Mic className="w-4 h-4 text-amber-400" />} title="Voice">
                     <Field label="TTS engine">
                        <select
                           value={cfg.voice?.tts_provider || ''}
                           onChange={(e) => updateTtsProvider(e.target.value)}
                           className={inputClass}
                        >
                           {TTS_PROVIDERS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                           ))}
                        </select>
                     </Field>
                     <Field label="Voice file">
                        <select
                           value={cfg.voice?.case_voice || ''}
                           onChange={(e) => updateVoiceField('case_voice', e.target.value)}
                           className={inputClass}
                        >
                           <option value="">Inherit (global by gender)</option>
                           {ttsVoices.map(v => (
                              <option key={v.filename} value={v.filename}>
                                 {(v.displayName || v.filename) + (v.gender ? ` — ${v.gender}` : '')}
                              </option>
                           ))}
                        </select>
                     </Field>
                     <div className="grid grid-cols-2 gap-3">
                        <Field label="Speech rate">
                           <input
                              type="number"
                              step="0.05" min="0.5" max="1.5"
                              value={cfg.voice?.tts_rate ?? ''}
                              placeholder={`Inherit (${resolvedRate.toFixed(2)})`}
                              onChange={(e) => {
                                 const v = e.target.value;
                                 updateVoiceField('tts_rate', v === '' ? '' : Number(v));
                              }}
                              className={inputClass}
                           />
                        </Field>
                        <Field label="Pitch">
                           <input
                              type="number"
                              step="0.05" min="0.5" max="1.5"
                              value={cfg.voice?.tts_pitch ?? ''}
                              placeholder="Inherit"
                              onChange={(e) => {
                                 const v = e.target.value;
                                 updateVoiceField('tts_pitch', v === '' ? '' : Number(v));
                              }}
                              className={inputClass}
                           />
                        </Field>
                     </div>
                     <div className="border-t border-neutral-800 pt-3 space-y-2">
                        <label className="block text-xs text-neutral-500">Preview text</label>
                        <input
                           type="text"
                           defaultValue={DEFAULT_PREVIEW_TEXT(template)}
                           onChange={(e) => { previewTextRef.current = e.target.value; }}
                           placeholder="What should the voice say?"
                           className={inputClass}
                        />
                        <button
                           type="button"
                           onClick={handlePreviewVoice}
                           disabled={!resolvedVoiceFile && !previewState.playing}
                           className={`w-full px-3 py-2 rounded text-sm flex items-center justify-center gap-2 transition-colors ${
                              previewState.playing
                                 ? 'bg-rose-700 hover:bg-rose-600 text-white'
                                 : resolvedVoiceFile
                                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                                    : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                           }`}
                           title={resolvedVoiceFile ? `Will use: ${resolvedVoiceFile}` : 'No voice resolved'}
                        >
                           {previewState.playing ? (
                              <>
                                 <StopCircle className="w-4 h-4" /> Stop preview
                              </>
                           ) : resolvedVoiceFile ? (
                              <>
                                 <PlayCircle className="w-4 h-4" /> Preview voice
                              </>
                           ) : (
                              <>
                                 <Volume2 className="w-4 h-4" /> No voice resolved
                              </>
                           )}
                        </button>
                        {resolvedVoiceFile && (
                           <p className="text-[10px] text-neutral-500 truncate" title={resolvedVoiceFile}>
                              {resolvedVoice?.tier === 'override' && <>Using your pick: </>}
                              {resolvedVoice?.tier === 'platform-default' && <>From platform default: </>}
                              {resolvedVoice?.tier === 'voice-slot' && <>From platform voice slot: </>}
                              {resolvedVoice?.tier === 'hardcoded' && <>Hardcoded fallback: </>}
                              {resolvedVoice?.tier === 'catalog-first' && <>First available (no slot configured — runtime would 503): </>}
                              <span className="text-neutral-400 font-mono">{resolvedVoiceFile}</span>
                           </p>
                        )}
                        {!resolvedVoiceFile && (cfg.voice?.tts_provider || voiceSettings?.tts_provider) === 'piper' && ttsVoices.length === 0 && (
                           <p className="text-[10px] text-amber-400">
                              No Piper voices installed. Run <code className="text-amber-200">bash server/scripts/install-piper.sh</code>.
                           </p>
                        )}
                     </div>
                  </Section>
               </div>

               {/* ── Right column: Persona / Behavior / LLM / Memory ── */}
               <div className="space-y-6">

                  <Section icon={<Sparkles className="w-4 h-4 text-purple-400" />} title="Persona prompt" subtitle="The agent's system prompt. Patient context and vitals are appended at runtime.">
                     <textarea
                        value={template.system_prompt || ''}
                        onChange={(e) => setField('system_prompt', e.target.value)}
                        placeholder="Define the agent's personality, role, knowledge, and how they should respond…"
                        className="w-full min-h-[320px] px-3 py-3 bg-neutral-950 border border-neutral-800 rounded text-sm focus:outline-none focus:border-purple-500 font-mono leading-relaxed resize-y"
                     />
                  </Section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <BulletList
                        title="Dos"
                        accent="emerald"
                        items={dos}
                        onChange={updateDosList}
                        placeholder="e.g., Stay in character throughout"
                     />
                     <BulletList
                        title="Don'ts"
                        accent="rose"
                        items={donts}
                        onChange={updateDontsList}
                        placeholder="e.g., Volunteer differential diagnoses"
                     />
                  </div>

                  <Section icon={<SettingsIcon className="w-4 h-4 text-cyan-400" />} title="Behavior">
                     <div className="grid grid-cols-2 gap-4">
                        <Field label="Context filter" hint="What slice of the case the agent can see at runtime.">
                           <select
                              value={template.context_filter || 'full'}
                              onChange={(e) => setField('context_filter', e.target.value)}
                              className={inputClass}
                           >
                              {CONTEXT_FILTERS.map(c => (
                                 <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                           </select>
                        </Field>
                        <Field label="Default availability">
                           <select
                              value={cfg.typical_availability || 'present'}
                              onChange={(e) => setConfigField('typical_availability', e.target.value)}
                              className={inputClass}
                           >
                              <option value="present">Present (immediately available)</option>
                              <option value="on-call">On-call (must be paged)</option>
                              <option value="absent">Absent (not available)</option>
                           </select>
                        </Field>
                     </div>
                     <label className="flex items-center gap-3 mt-3 text-sm text-neutral-300 cursor-pointer">
                        <input
                           type="checkbox"
                           checked={!!cfg.can_be_paged}
                           onChange={(e) => setConfigField('can_be_paged', e.target.checked)}
                           className="w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-purple-500"
                        />
                        Can be paged
                     </label>
                     {cfg.can_be_paged && (
                        <div className="grid grid-cols-2 gap-3 mt-3">
                           <Field label="Response time min (min)">
                              <input
                                 type="number" min="0"
                                 value={cfg.response_time?.min ?? 0}
                                 onChange={(e) => setConfigField('response_time', {
                                    ...(cfg.response_time || {}),
                                    min: parseInt(e.target.value, 10) || 0
                                 })}
                                 className={inputClass}
                              />
                           </Field>
                           <Field label="Response time max (min)">
                              <input
                                 type="number" min="0"
                                 value={cfg.response_time?.max ?? 0}
                                 onChange={(e) => setConfigField('response_time', {
                                    ...(cfg.response_time || {}),
                                    max: parseInt(e.target.value, 10) || 0
                                 })}
                                 className={inputClass}
                              />
                           </Field>
                        </div>
                     )}
                  </Section>

                  <Section icon={<Zap className="w-4 h-4 text-amber-400" />} title="LLM override" subtitle="Empty values inherit from the platform defaults.">
                     <Field label="Provider">
                        <select
                           value={template.llm_provider || ''}
                           onChange={(e) => setField('llm_provider', e.target.value)}
                           className={inputClass}
                        >
                           {LLM_PROVIDERS.map(p => (
                              <option key={p.value} value={p.value}>{p.label}</option>
                           ))}
                        </select>
                     </Field>
                     {template.llm_provider && (
                        <div className="space-y-3 mt-3">
                           <Field label="Model">
                              <input
                                 type="text"
                                 value={template.llm_model || ''}
                                 onChange={(e) => setField('llm_model', e.target.value)}
                                 placeholder={
                                    template.llm_provider === 'openai' ? 'gpt-4o-mini' :
                                    template.llm_provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                                    template.llm_provider === 'openrouter' ? 'openai/gpt-4o-mini' :
                                    'model-name'
                                 }
                                 className={inputClass}
                              />
                           </Field>
                           <Field label="API key">
                              <div className="relative">
                                 <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={template.llm_api_key || ''}
                                    onChange={(e) => setField('llm_api_key', e.target.value)}
                                    placeholder="sk-… (leave empty for platform key)"
                                    className={`${inputClass} pr-10`}
                                 />
                                 <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                 >
                                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                 </button>
                              </div>
                           </Field>
                           {template.llm_provider === 'custom' && (
                              <Field label="Custom endpoint">
                                 <input
                                    type="text"
                                    value={template.llm_endpoint || ''}
                                    onChange={(e) => setField('llm_endpoint', e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className={inputClass}
                                 />
                              </Field>
                           )}
                           {/*
                              Stage-4 audit: temperature + max_tokens at the
                              agent layer. Pre-fix the resolver ignored agent
                              values entirely, so admins setting these in any
                              prior UI surface were quietly overridden by
                              session/platform defaults.
                           */}
                           <div className="grid grid-cols-2 gap-3">
                              <Field label="Temperature">
                                 <input
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={template.llm_temperature ?? ''}
                                    onChange={(e) => setField('llm_temperature', e.target.value)}
                                    placeholder="(platform default)"
                                    className={inputClass}
                                 />
                              </Field>
                              <Field label="Max tokens">
                                 <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={template.llm_max_tokens ?? ''}
                                    onChange={(e) => setField('llm_max_tokens', e.target.value)}
                                    placeholder="(platform default)"
                                    className={inputClass}
                                 />
                              </Field>
                           </div>
                           <p className="text-xs text-neutral-500 -mt-2">
                              Leave blank to inherit platform/session defaults. Resolver precedence: agent → session → platform.
                           </p>
                           <button
                              onClick={handleTestLLM}
                              disabled={testingLLM || isCreate}
                              className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-700 disabled:opacity-60 rounded text-sm flex items-center justify-center gap-2"
                              title={isCreate ? 'Save first to enable LLM testing' : ''}
                           >
                              {testingLLM ? (
                                 <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</>
                              ) : (
                                 <><Zap className="w-4 h-4" /> Test LLM connection</>
                              )}
                           </button>
                           {testResult && (
                              <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-900/30 border border-green-800' : 'bg-red-900/30 border border-red-800'}`}>
                                 {testResult.success ? (
                                    <div className="space-y-1">
                                       <div className="flex items-center gap-2 text-green-400">
                                          <CheckCircle className="w-4 h-4" /> Test successful
                                       </div>
                                       <div className="text-xs text-neutral-400">{testResult.provider}/{testResult.model} — {testResult.latency}ms</div>
                                       <div className="text-xs text-neutral-300 mt-2 p-2 bg-neutral-950 rounded">{testResult.response}</div>
                                    </div>
                                 ) : (
                                    <div className="flex items-center gap-2 text-red-400">
                                       <AlertCircle className="w-4 h-4" /> {testResult.error}
                                    </div>
                                 )}
                              </div>
                           )}
                        </div>
                     )}
                  </Section>

                  <Section icon={<Brain className="w-4 h-4 text-cyan-400" />} title="Patient record access" subtitle="Which slices of the patient record this agent can see at runtime.">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {MEMORY_CATEGORIES.map(cat => (
                           <label key={cat.key} className="flex items-start gap-3 px-3 py-2 rounded border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900 cursor-pointer">
                              <input
                                 type="checkbox"
                                 checked={template.memory_access?.[cat.key] !== false}
                                 onChange={() => toggleMemoryAccess(cat.key)}
                                 className="mt-1 w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-cyan-500"
                              />
                              <div className="text-sm">
                                 <div className="text-neutral-200">{cat.label}</div>
                                 <div className="text-xs text-neutral-500">{cat.description}</div>
                              </div>
                           </label>
                        ))}
                     </div>
                  </Section>

                  {template.agent_type === 'discussant' && (
                     <Section icon={<GraduationCap className="w-4 h-4 text-indigo-400" />} title="Discussant settings" subtitle="Only applies when this persona is the post-case debrief tutor.">
                        <Field label="Unlock trigger">
                           <select
                              value={cfg.unlock_trigger || 'after_case_ended'}
                              onChange={(e) => setConfigField('unlock_trigger', e.target.value)}
                              className={inputClass}
                           >
                              {UNLOCK_TRIGGERS.map(u => (
                                 <option key={u.value} value={u.value}>{u.label}</option>
                              ))}
                           </select>
                        </Field>
                        <p className="text-xs text-neutral-500 mt-2">
                           Controls when the learner can open the debrief screen during a session.
                        </p>
                     </Section>
                  )}
               </div>
            </div>
         </div>

         {/* ── Confirmation modals ──────────────────────────────────── */}
         {resetConfirm && (
            <ConfirmModal
               title="Reset to shipped defaults?"
               body="This will overwrite the current name, role, system prompt, dos/don'ts, avatar, voice slot, and clear any LLM or memory overrides — restoring the values that originally shipped with Rohy. Custom edits to this standard persona will be lost."
               confirmLabel="Reset to defaults"
               confirmTone="amber"
               onConfirm={handleResetToDefault}
               onCancel={() => setResetConfirm(false)}
            />
         )}
         {deleteConfirm && (
            <ConfirmModal
               title="Delete this persona?"
               body={`Permanently delete "${template.name}". This cannot be undone.`}
               confirmLabel="Delete"
               confirmTone="red"
               onConfirm={handleDelete}
               onCancel={() => setDeleteConfirm(false)}
            />
         )}
      </div>
   );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

const inputClass = 'w-full px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-sm focus:outline-none focus:border-purple-500 transition-colors';

function Section({ icon, title, subtitle, children }) {
   return (
      <section className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-5 space-y-3">
         <header>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
               {icon}{title}
            </h2>
            {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}
         </header>
         {children}
      </section>
   );
}

function Field({ label, hint, children }) {
   return (
      <div>
         <label className="block text-xs font-medium text-neutral-400 mb-1">{label}</label>
         {children}
         {hint && <p className="text-[11px] text-neutral-500 mt-1">{hint}</p>}
      </div>
   );
}

// Editable bullet list with add / remove / reorder. Used for Dos and Don'ts.
// Reorder is keyboard-only (move up/down arrows) — drag-and-drop would pull
// in another dep for what is at most 5–8 bullets per persona.
function BulletList({ title, accent, items, onChange, placeholder }) {
   const accentMap = {
      emerald: { headerText: 'text-emerald-400', border: 'border-emerald-900/50', bg: 'bg-emerald-950/20', addBg: 'bg-emerald-700 hover:bg-emerald-600' },
      rose:    { headerText: 'text-rose-400',    border: 'border-rose-900/50',    bg: 'bg-rose-950/20',    addBg: 'bg-rose-700 hover:bg-rose-600' },
   };
   const palette = accentMap[accent] || accentMap.emerald;

   const updateAt = (index, value) => {
      const next = [...items];
      next[index] = value;
      onChange(next);
   };
   const removeAt = (index) => {
      const next = [...items];
      next.splice(index, 1);
      onChange(next);
   };
   const move = (index, delta) => {
      const target = index + delta;
      if (target < 0 || target >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      onChange(next);
   };
   const add = () => onChange([...items, '']);

   return (
      <section className={`bg-neutral-900/50 border ${palette.border} rounded-lg p-5 space-y-3`}>
         <header className="flex items-center justify-between">
            <h2 className={`text-sm font-bold flex items-center gap-2 ${palette.headerText}`}>
               {title}
               <span className="text-xs font-normal text-neutral-500">({items.length})</span>
            </h2>
            <button
               type="button"
               onClick={add}
               className={`px-2.5 py-1 rounded text-xs font-semibold text-white flex items-center gap-1 ${palette.addBg}`}
            >
               <Plus className="w-3.5 h-3.5" /> Add
            </button>
         </header>
         {items.length === 0 ? (
            <div className={`rounded border border-dashed border-neutral-800 ${palette.bg} p-4 text-center text-xs text-neutral-500`}>
               No bullets yet. Click <span className={palette.headerText}>Add</span> to start.
            </div>
         ) : (
            <ul className="space-y-2">
               {items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 group">
                     <div className="flex flex-col items-center mt-1 text-neutral-600">
                        <button
                           type="button"
                           onClick={() => move(i, -1)}
                           disabled={i === 0}
                           className="text-[10px] disabled:opacity-30 hover:text-neutral-300 leading-none"
                           title="Move up"
                        >▲</button>
                        <GripVertical className="w-3 h-3 my-0.5" />
                        <button
                           type="button"
                           onClick={() => move(i, 1)}
                           disabled={i === items.length - 1}
                           className="text-[10px] disabled:opacity-30 hover:text-neutral-300 leading-none"
                           title="Move down"
                        >▼</button>
                     </div>
                     <textarea
                        value={item}
                        onChange={(e) => updateAt(i, e.target.value)}
                        placeholder={placeholder}
                        rows={1}
                        className="flex-1 px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-sm focus:outline-none focus:border-purple-500 resize-y leading-snug"
                     />
                     <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="p-1.5 rounded text-neutral-500 hover:text-rose-300 hover:bg-rose-900/30 mt-0.5"
                        title="Remove bullet"
                     >
                        <Trash2 className="w-4 h-4" />
                     </button>
                  </li>
               ))}
            </ul>
         )}
      </section>
   );
}

function ConfirmModal({ title, body, confirmLabel, confirmTone, onConfirm, onCancel }) {
   const toneClass = confirmTone === 'red'
      ? 'bg-red-700 hover:bg-red-600'
      : confirmTone === 'amber'
         ? 'bg-amber-600 hover:bg-amber-500'
         : 'bg-purple-600 hover:bg-purple-500';
   return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
         <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-neutral-800">
               <h2 className="text-base font-semibold text-white">{title}</h2>
            </div>
            <div className="px-6 py-5 text-sm text-neutral-300">{body}</div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800">
               <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:text-white"
               >
                  Cancel
               </button>
               <button
                  onClick={onConfirm}
                  className={`px-4 py-2 text-sm rounded text-white font-semibold ${toneClass}`}
               >
                  {confirmLabel}
               </button>
            </div>
         </div>
      </div>
   );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function blankTemplate() {
   return {
      agent_type: 'nurse',
      name: '',
      role_title: '',
      system_prompt: '',
      avatar_url: '',
      context_filter: 'full',
      communication_style: 'professional',
      config: {
         typical_availability: 'present',
         can_be_paged: false,
         response_time: { min: 0, max: 0 },
         dos: [],
         donts: []
      },
      llm_provider: '',
      llm_model: '',
      llm_api_key: '',
      llm_endpoint: '',
      llm_temperature: '',
      llm_max_tokens: '',
      memory_access: { ...DEFAULT_MEMORY_ACCESS },
      is_default: 0
   };
}

// Server returns config / memory_access as JSON strings; the rest of the
// editor reads them as objects. Normalise once on entry and on reset so
// downstream code can stay JSON-naive.
function normalizeFromServer(raw) {
   if (!raw) return null;
   const tpl = { ...raw };
   if (typeof tpl.config === 'string') {
      try { tpl.config = JSON.parse(tpl.config); } catch { tpl.config = {}; }
   }
   tpl.config = tpl.config || {};
   if (typeof tpl.memory_access === 'string') {
      try { tpl.memory_access = JSON.parse(tpl.memory_access); } catch { tpl.memory_access = null; }
   }
   if (!tpl.memory_access) tpl.memory_access = { ...DEFAULT_MEMORY_ACCESS };
   if (typeof tpl.llm_config === 'string') {
      try { tpl.llm_config = JSON.parse(tpl.llm_config); } catch { tpl.llm_config = null; }
   }
   if (!Array.isArray(tpl.config.dos)) tpl.config.dos = [];
   if (!Array.isArray(tpl.config.donts)) tpl.config.donts = [];
   return tpl;
}
