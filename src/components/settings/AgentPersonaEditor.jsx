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
import { useTranslation } from 'react-i18next';
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
import { apiFetch } from '../../services/apiClient';
import { baseUrl } from '../../config/api';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';
import { resolveVoice } from '../../utils/voiceResolver.js';
import { voiceGenderLabel } from '../../utils/voiceCatalogue.js';

// Heavy three.js head viewer — lazy so admins who never open the editor
// don't pay the bundle cost.
const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

// Domain enums kept in sync with AgentTemplateManager's copies. Duplicated
// rather than imported to keep the two surfaces independent — neither
// component is a "library" for the other.
// Enum value lists. User-visible labels/descriptions are resolved through
// i18n at render time (keys `type_<value>_label` etc.) rather than stored
// here, so the same value token drives both the server contract and the
// translated display.
const AGENT_TYPES = ['patient', 'discussant', 'nurse', 'consultant', 'relative', 'pharmacist', 'technician', 'other'];

const CONTEXT_FILTERS = ['full', 'history', 'vitals', 'minimal'];

const COMMUNICATION_STYLES = ['professional', 'educational', 'emotional', 'concise'];

// OpenAI/Anthropic/OpenRouter are brand names and stay verbatim; only the
// two descriptive rows carry a translation key.
const LLM_PROVIDERS = [
   { value: '', labelKey: 'provider_platform_default' },
   { value: 'openai', label: 'OpenAI' },
   { value: 'anthropic', label: 'Anthropic' },
   { value: 'openrouter', label: 'OpenRouter' },
   { value: 'custom', labelKey: 'provider_custom_endpoint' }
];

const UNLOCK_TRIGGERS = ['after_case_ended', 'always'];

// The parenthetical enum tokens (OBTAINED, EXAMINED, …) are server-side
// category keys and must stay identical across locales.
const MEMORY_CATEGORIES = ['OBTAINED', 'EXAMINED', 'ELICITED', 'NOTED', 'ORDERED', 'ADMINISTERED', 'CHANGED', 'EXPRESSED'];

const DEFAULT_MEMORY_ACCESS = MEMORY_CATEGORIES.reduce((acc, key) => {
   acc[key] = true;
   return acc;
}, {});

const DEFAULT_PREVIEW_TEXT = (template, t) => {
   const name = (template?.name || '').trim();
   const role = (template?.role_title || '').trim();
   if (name && role) return t('preview_greeting_name_role', { name, role });
   if (name) return t('preview_greeting_name', { name });
   return t('preview_greeting_generic');
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AgentPersonaEditor({ templateId, onClose, onSaved }) {
   const { t } = useTranslation('authoring_persona');
   const toast = useToast();
   const { headManifest: ctxHeadManifest, voiceSettings: ctxVoiceSettings, setSpeaking } = useVoice();

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
   const [headManifest, setHeadManifest] = useState(ctxHeadManifest);
   const [previewState, setPreviewState] = useState({ playing: false, text: '' });
   const previewTextRef = useRef('');

   // Initial load: template + ancillary platform settings.
   useEffect(() => {
      let cancelled = false;

      (async () => {
         setLoading(true);
         try {
            const tplPromise = templateId === 'new'
               ? Promise.resolve(blankTemplate())
               : AgentService.getTemplate(templateId).then(tpl => normalizeFromServer(tpl));

            const ancillary = Promise.allSettled([
               headManifest ? Promise.resolve(null) : fetch(baseUrl('/avatars/heads/manifest.json')).then(r => r.ok ? r.json() : null).catch(() => null),
               voiceSettings ? Promise.resolve(null) : apiFetch('/platform-settings/voice').catch(() => null)
            ]);

            const [tpl, ancRes] = await Promise.all([tplPromise, ancillary]);
            if (cancelled) return;
            if (!tpl) {
               toast.error(t('toast_load_template_failed'));
               onClose?.();
               return;
            }
            setTemplate(tpl);

            const [hmRes, vsRes] = ancRes;
            if (!headManifest && hmRes.status === 'fulfilled' && hmRes.value) setHeadManifest(hmRes.value);
            if (!voiceSettings && vsRes.status === 'fulfilled' && vsRes.value) setVoiceSettings(vsRes.value);
         } catch (err) {
            if (!cancelled) {
               console.error('[AgentPersonaEditor] load failed:', err);
               toast.error(err.message || t('toast_load_editor_failed'));
               onClose?.();
            }
         } finally {
            if (!cancelled) setLoading(false);
         }
      })();
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [templateId]);

   // Load voices for the platform's TTS provider. Per-persona tts_provider
   // pickers were removed 2026-05-12 — the provider is a platform-wide
   // decision read from Voice Settings, so a stale persona authored under a
   // different engine can't leak its provider into the runtime. If the
   // platform setting is missing we don't fetch a catalogue at all; the
   // admin has to set a provider in Voice Settings first.
   useEffect(() => {
      const provider = voiceSettings?.tts_provider;
      if (!provider) { setTtsVoices([]); return; }
      let cancelled = false;
      apiFetch(`/tts/voices?provider=${provider}`)
         .then(d => { if (!cancelled) setTtsVoices(d.voices || []); })
         .catch(() => { if (!cancelled) setTtsVoices([]); });
      return () => { cancelled = true; };
   }, [voiceSettings?.tts_provider]);

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

   // Voice resolution goes through the shared util. The resolver is now
   // single-tier (case_voice or null) and returns the platform provider —
   // there's no editor-only catalogue fallback, so the preview button stays
   // disabled until the admin picks a voice.
   const resolvedVoice = useMemo(() => {
      if (!template) return null;
      return resolveVoice({
         voice: template.config?.voice,
         voiceSettings
      });
   }, [template, voiceSettings]);

   const resolvedVoiceFile = resolvedVoice?.file || null;
   const resolvedProvider = resolvedVoice?.provider || voiceSettings?.tts_provider || null;
   const resolvedRate = resolvedVoice?.rate ?? 1.0;
   const resolvedPitch = resolvedVoice?.pitch;
   // Show every voice in the platform provider's catalogue — no slot filter.
   const voiceOptions = ttsVoices;

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
         toast.warning(t('toast_name_required'));
         return;
      }
      if (!template.system_prompt?.trim()) {
         toast.warning(t('toast_prompt_required'));
         return;
      }

      setSaving(true);
      try {
         if (isCreate) {
            await AgentService.createTemplate(template);
            toast.success(t('toast_template_created'));
         } else {
            await AgentService.updateTemplate(template.id, template);
            toast.success(isStandard ? t('toast_standard_updated') : t('toast_template_updated'));
         }
         // Notify the parent (App.jsx) so the running chat tab can refetch
         // the patient template + agents list. Without this, the chat's
         // in-memory copy stays stale and admin's voice change doesn't
         // play until session restart.
         onSaved?.();
         onClose?.();
      } catch (err) {
         toast.error(err.message || t('toast_save_failed'));
      } finally {
         setSaving(false);
      }
   };

   const handleResetToDefault = async () => {
      if (!template?.id) return;
      try {
         const result = await AgentService.resetTemplateToDefault(template.id);
         toast.success(result.message || t('toast_reset_done'));
         if (result.template) {
            setTemplate(normalizeFromServer(result.template));
         }
         setResetConfirm(false);
      } catch (err) {
         toast.error(err.message || t('toast_reset_failed'));
      }
   };

   const handleDelete = async () => {
      if (!template?.id) return;
      try {
         await AgentService.deleteTemplate(template.id);
         toast.success(t('toast_template_deleted'));
         onClose?.();
      } catch (err) {
         toast.error(err.message || t('toast_delete_failed'));
         setDeleteConfirm(false);
      }
   };

   const handleDuplicate = async () => {
      if (!template?.id) return;
      try {
         await AgentService.duplicateTemplate(template.id, t('copy_suffix', { name: template.name }));
         toast.success(t('toast_duplicated_returning'));
         onClose?.();
      } catch (err) {
         toast.error(err.message || t('toast_duplicate_failed'));
      }
   };

   const handleTestLLM = async () => {
      if (!template?.id) {
         toast.warning(t('toast_save_before_test'));
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
         toast.success(t('toast_llm_test_ok', { ms: result.latency_ms }));
      } catch (err) {
         setTestResult({ success: false, error: err.message || t('test_failed') });
         toast.error(err.message || t('toast_llm_test_failed'));
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
         toast.warning(t('toast_no_voice_resolved'));
         return;
      }
      const text = (previewTextRef.current || DEFAULT_PREVIEW_TEXT(template, t)).trim();
      setPreviewState({ playing: true, text });
      setSpeaking?.(true);
      try {
         await VoiceService.speak({
            text,
            voice: resolvedVoiceFile,
            rate: resolvedRate,
            pitch: resolvedPitch,
            provider: resolvedProvider,
            onEnd: () => {
               setPreviewState({ playing: false, text: '' });
               setSpeaking?.(false);
            },
            onError: (err) => {
               toast.error(t('toast_voice_preview_failed', { error: err.message || err }));
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
         <div className="rohy-admin-light h-screen w-screen flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-neutral-400">
               <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
               <span className="text-sm">{t('loading_editor')}</span>
            </div>
         </div>
      );
   }

   const typeLabel = AGENT_TYPES.includes(template.agent_type)
      ? t(`type_${template.agent_type}_label`)
      : template.agent_type;

   return (
      <div className="rohy-admin-light h-screen w-screen flex flex-col overflow-hidden">

         {/* ── Header ─────────────────────────────────────────────────── */}
         <header className="border-b border-neutral-800 bg-neutral-900/95 px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
               <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors shrink-0"
                  title={t('back_to_personas')}
               >
                  <ArrowLeft className="w-5 h-5" />
               </button>
               <div className="min-w-0">
                  <h1 className="text-lg font-bold truncate">
                     {isCreate ? t('header_new') : t('header_edit', { name: template.name || t('untitled') })}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                     <span className="capitalize">{typeLabel}</span>
                     {isStandard && (
                        <span className="px-2 py-0.5 rounded bg-purple-700/40 border border-purple-700/60 text-purple-200">
                           {t('badge_standard_shipped')}
                        </span>
                     )}
                     {isCreate && (
                        <span className="px-2 py-0.5 rounded bg-emerald-700/40 border border-emerald-700/60 text-emerald-200">
                           {t('badge_unsaved')}
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
                     title={t('duplicate_tooltip')}
                  >
                     <Copy className="w-4 h-4" /> {t('duplicate')}
                  </button>
               )}
               {isStandard && !isCreate && (
                  <button
                     onClick={() => setResetConfirm(true)}
                     className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm flex items-center gap-1.5"
                     title={t('reset_tooltip')}
                  >
                     <RotateCcw className="w-4 h-4" /> {t('reset_to_defaults')}
                  </button>
               )}
               {!isCreate && !isStandard && (
                  <button
                     onClick={() => setDeleteConfirm(true)}
                     className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded text-sm flex items-center gap-1.5"
                  >
                     <Trash2 className="w-4 h-4" /> {t('delete')}
                  </button>
               )}
               <button
                  onClick={onClose}
                  className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm flex items-center gap-1.5"
               >
                  <X className="w-4 h-4" /> {t('cancel')}
               </button>
               <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-semibold flex items-center gap-1.5"
               >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isCreate ? t('create_persona') : t('save_changes')}
               </button>
            </div>
         </header>

         {/* ── Body ───────────────────────────────────────────────────── */}
         <div className="flex-1 overflow-y-auto bg-neutral-950">
            <div className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">

               {/* ── Left rail: Identity / Avatar / Voice ──────────── */}
               <div className="space-y-6">
                  <Section icon={<User className="w-4 h-4 text-blue-400" />} title={t('section_identity')}>
                     <Field label={t('field_agent_type')}>
                        <select
                           value={template.agent_type}
                           onChange={(e) => setField('agent_type', e.target.value)}
                           className={inputClass}
                        >
                           {AGENT_TYPES.map(v => (
                              <option key={v} value={v}>{t(`type_${v}_label`)} — {t(`type_${v}_desc`)}</option>
                           ))}
                        </select>
                     </Field>
                     <Field label={t('field_display_name')} hint={t('hint_display_name')}>
                        <input
                           type="text"
                           value={template.name || ''}
                           onChange={(e) => setField('name', e.target.value)}
                           placeholder={t('ph_display_name')}
                           className={inputClass}
                        />
                     </Field>
                     <Field label={t('field_role_title')}>
                        <input
                           type="text"
                           value={template.role_title || ''}
                           onChange={(e) => setField('role_title', e.target.value)}
                           placeholder={t('ph_role_title')}
                           className={inputClass}
                        />
                     </Field>
                     <Field label={t('field_comm_style')}>
                        <select
                           value={template.communication_style || ''}
                           onChange={(e) => setField('communication_style', e.target.value)}
                           className={inputClass}
                        >
                           <option value="">{t('opt_none_specified')}</option>
                           {COMMUNICATION_STYLES.map(s => (
                              <option key={s} value={s}>{t(`style_${s}`)}</option>
                           ))}
                        </select>
                     </Field>
                     <Field label={t('field_gender_slot')} hint={t('hint_gender_slot')}>
                        <select
                           value={template.config?.gender || ''}
                           onChange={(e) => setConfigField('gender', e.target.value || undefined)}
                           className={inputClass}
                        >
                           <option value="">{t('opt_gender_auto')}</option>
                           <option value="male">{t('opt_gender_male')}</option>
                           <option value="female">{t('opt_gender_female')}</option>
                        </select>
                     </Field>
                  </Section>

                  <Section icon={<ImageIcon className="w-4 h-4 text-pink-400" />} title={t('section_avatar')}>
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
                                 {t('avatar_preview_empty')}
                              </div>
                           )}
                        </div>
                        <div className="space-y-3">
                           <Field label={t('field_3d_avatar')}>
                              <select
                                 value={template.avatar_url || ''}
                                 onChange={(e) => setField('avatar_url', e.target.value || null)}
                                 className={inputClass}
                              >
                                 <option value="">{t('opt_avatar_auto')}</option>
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

                  <Section icon={<Mic className="w-4 h-4 text-amber-400" />} title={t('section_voice')}>
                     <p className="text-[11px] text-neutral-500 -mt-2">
                        {t('voice_engine_help')}
                     </p>
                     <Field label={t('field_voice', { provider: voiceSettings?.tts_provider || t('no_provider_set') })}>
                        <select
                           value={cfg.voice?.case_voice || ''}
                           onChange={(e) => updateVoiceField('case_voice', e.target.value)}
                           className={inputClass}
                           disabled={!voiceSettings?.tts_provider}
                        >
                           <option value="">{t('opt_pick_voice')}</option>
                           {voiceOptions.map(v => {
                              const genderLabel = voiceGenderLabel(v);
                              return (
                              <option key={v.filename} value={v.filename}>
                                 {(v.displayName || v.filename) + (genderLabel ? ` — ${genderLabel}` : '')}
                              </option>
                              );
                           })}
                        </select>
                     </Field>
                     <div className="grid grid-cols-2 gap-3">
                        <Field label={t('field_speech_rate')}>
                           <input
                              type="number"
                              step="0.05" min="0.5" max="1.5"
                              value={cfg.voice?.tts_rate ?? ''}
                              placeholder={t('ph_inherit_rate', { rate: resolvedRate.toFixed(2) })}
                              onChange={(e) => {
                                 const v = e.target.value;
                                 updateVoiceField('tts_rate', v === '' ? '' : Number(v));
                              }}
                              className={inputClass}
                           />
                        </Field>
                        <Field label={t('field_pitch')}>
                           <input
                              type="number"
                              step="0.25" min="-10" max="10"
                              value={cfg.voice?.tts_pitch ?? ''}
                              placeholder={t('ph_inherit')}
                              onChange={(e) => {
                                 const v = e.target.value;
                                 updateVoiceField('tts_pitch', v === '' ? '' : Number(v));
                              }}
                              className={inputClass}
                           />
                        </Field>
                     </div>
                     <div className="border-t border-neutral-800 pt-3 space-y-2">
                        <label className="block text-xs text-neutral-500">{t('label_preview_text')}</label>
                        <input
                           type="text"
                           defaultValue={DEFAULT_PREVIEW_TEXT(template, t)}
                           onChange={(e) => { previewTextRef.current = e.target.value; }}
                           placeholder={t('ph_preview_text')}
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
                           title={resolvedVoiceFile ? t('preview_will_use', { file: resolvedVoiceFile }) : t('no_voice_resolved')}
                        >
                           {previewState.playing ? (
                              <>
                                 <StopCircle className="w-4 h-4" /> {t('stop_preview')}
                              </>
                           ) : resolvedVoiceFile ? (
                              <>
                                 <PlayCircle className="w-4 h-4" /> {t('preview_voice')}
                              </>
                           ) : (
                              <>
                                 <Volume2 className="w-4 h-4" /> {t('no_voice_resolved')}
                              </>
                           )}
                        </button>
                        {resolvedVoiceFile && (
                           <p className="text-[10px] text-neutral-500 truncate" title={resolvedVoiceFile}>
                              {t('will_play')} <span className="text-neutral-400 font-mono">{resolvedVoiceFile}</span>
                              {resolvedProvider && <> {t('via')} <span className="text-neutral-400 font-mono">{resolvedProvider}</span></>}
                           </p>
                        )}
                        {!resolvedVoiceFile && !voiceSettings?.tts_provider && (
                           <p className="text-[10px] text-amber-400">
                              {t('no_tts_provider_configured')}
                           </p>
                        )}
                        {!resolvedVoiceFile && voiceSettings?.tts_provider === 'piper' && ttsVoices.length === 0 && (
                           <p className="text-[10px] text-amber-400">
                              {t('no_piper_voices_prefix')} <code className="text-amber-200">bash server/scripts/install-piper.sh</code>.
                           </p>
                        )}
                     </div>
                  </Section>
               </div>

               {/* ── Right column: Persona / Behavior / LLM / Memory ── */}
               <div className="space-y-6">

                  <Section icon={<Sparkles className="w-4 h-4 text-purple-400" />} title={t('section_persona_prompt')} subtitle={t('subtitle_persona_prompt')}>
                     <textarea
                        value={template.system_prompt || ''}
                        onChange={(e) => setField('system_prompt', e.target.value)}
                        placeholder={t('ph_system_prompt')}
                        className="w-full min-h-[320px] px-3 py-3 bg-neutral-950 border border-neutral-800 rounded text-sm focus:outline-none focus:border-purple-500 font-mono leading-relaxed resize-y"
                     />
                  </Section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <BulletList
                        title={t('bullet_dos')}
                        accent="emerald"
                        items={dos}
                        onChange={updateDosList}
                        placeholder={t('ph_dos')}
                     />
                     <BulletList
                        title={t('bullet_donts')}
                        accent="rose"
                        items={donts}
                        onChange={updateDontsList}
                        placeholder={t('ph_donts')}
                     />
                  </div>

                  <Section icon={<SettingsIcon className="w-4 h-4 text-cyan-400" />} title={t('section_behavior')}>
                     <div className="grid grid-cols-2 gap-4">
                        <Field label={t('field_context_filter')} hint={t('hint_context_filter')}>
                           <select
                              value={template.context_filter || 'full'}
                              onChange={(e) => setField('context_filter', e.target.value)}
                              className={inputClass}
                           >
                              {CONTEXT_FILTERS.map(c => (
                                 <option key={c} value={c}>{t(`ctx_${c}_label`)}</option>
                              ))}
                           </select>
                        </Field>
                        <Field label={t('field_default_availability')}>
                           <select
                              value={cfg.typical_availability || 'present'}
                              onChange={(e) => setConfigField('typical_availability', e.target.value)}
                              className={inputClass}
                           >
                              <option value="present">{t('opt_avail_present')}</option>
                              <option value="on-call">{t('opt_avail_oncall')}</option>
                              <option value="absent">{t('opt_avail_absent')}</option>
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
                        {t('can_be_paged')}
                     </label>
                     {cfg.can_be_paged && (
                        <div className="grid grid-cols-2 gap-3 mt-3">
                           <Field label={t('field_response_time_min')}>
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
                           <Field label={t('field_response_time_max')}>
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

                  <Section icon={<Zap className="w-4 h-4 text-amber-400" />} title={t('section_llm_override')} subtitle={t('subtitle_llm_override')}>
                     <Field label={t('field_provider')}>
                        <select
                           value={template.llm_provider || ''}
                           onChange={(e) => setField('llm_provider', e.target.value)}
                           className={inputClass}
                        >
                           {LLM_PROVIDERS.map(p => (
                              <option key={p.value} value={p.value}>{p.labelKey ? t(p.labelKey) : p.label}</option>
                           ))}
                        </select>
                     </Field>
                     {template.llm_provider && (
                        <div className="space-y-3 mt-3">
                           <Field label={t('field_model')}>
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
                           <Field label={t('field_api_key')}>
                              <div className="relative">
                                 <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={template.llm_api_key || ''}
                                    onChange={(e) => setField('llm_api_key', e.target.value)}
                                    placeholder={t('ph_api_key')}
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
                              <Field label={t('field_custom_endpoint')}>
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
                              <Field label={t('field_temperature')}>
                                 <input
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={template.llm_temperature ?? ''}
                                    onChange={(e) => setField('llm_temperature', e.target.value)}
                                    placeholder={t('ph_platform_default')}
                                    className={inputClass}
                                 />
                              </Field>
                              <Field label={t('field_max_tokens')}>
                                 <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={template.llm_max_tokens ?? ''}
                                    onChange={(e) => setField('llm_max_tokens', e.target.value)}
                                    placeholder={t('ph_platform_default')}
                                    className={inputClass}
                                 />
                              </Field>
                           </div>
                           <p className="text-xs text-neutral-500 -mt-2">
                              {t('llm_precedence_note')}
                           </p>
                           <button
                              onClick={handleTestLLM}
                              disabled={testingLLM || isCreate}
                              className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-700 disabled:opacity-60 rounded text-sm flex items-center justify-center gap-2"
                              title={isCreate ? t('save_first_to_test') : ''}
                           >
                              {testingLLM ? (
                                 <><Loader2 className="w-4 h-4 animate-spin" /> {t('testing')}</>
                              ) : (
                                 <><Zap className="w-4 h-4" /> {t('test_llm_connection')}</>
                              )}
                           </button>
                           {testResult && (
                              <div className={`p-3 rounded text-sm ${testResult.success ? 'bg-green-900/30 border border-green-800' : 'bg-red-900/30 border border-red-800'}`}>
                                 {testResult.success ? (
                                    <div className="space-y-1">
                                       <div className="flex items-center gap-2 text-green-400">
                                          <CheckCircle className="w-4 h-4" /> {t('test_successful')}
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

                  <Section icon={<Brain className="w-4 h-4 text-cyan-400" />} title={t('section_record_access')} subtitle={t('subtitle_record_access')}>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {MEMORY_CATEGORIES.map(key => (
                           <label key={key} className="flex items-start gap-3 px-3 py-2 rounded border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900 cursor-pointer">
                              <input
                                 type="checkbox"
                                 checked={template.memory_access?.[key] !== false}
                                 onChange={() => toggleMemoryAccess(key)}
                                 className="mt-1 w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-cyan-500"
                              />
                              <div className="text-sm">
                                 <div className="text-neutral-200">{t(`mem_${key}_label`)}</div>
                                 <div className="text-xs text-neutral-500">{t(`mem_${key}_desc`)}</div>
                              </div>
                           </label>
                        ))}
                     </div>
                  </Section>

                  {template.agent_type === 'discussant' && (
                     <Section icon={<GraduationCap className="w-4 h-4 text-indigo-400" />} title={t('section_discussant')} subtitle={t('subtitle_discussant')}>
                        <Field label={t('field_unlock_trigger')}>
                           <select
                              value={cfg.unlock_trigger || 'after_case_ended'}
                              onChange={(e) => setConfigField('unlock_trigger', e.target.value)}
                              className={inputClass}
                           >
                              {UNLOCK_TRIGGERS.map(u => (
                                 <option key={u} value={u}>{t(`unlock_${u}`)}</option>
                              ))}
                           </select>
                        </Field>
                        <p className="text-xs text-neutral-500 mt-2">
                           {t('discussant_note')}
                        </p>
                     </Section>
                  )}
               </div>
            </div>
         </div>

         {/* ── Confirmation modals ──────────────────────────────────── */}
         {resetConfirm && (
            <ConfirmModal
               title={t('reset_modal_title')}
               body={t('reset_modal_body')}
               confirmLabel={t('reset_to_defaults')}
               confirmTone="amber"
               onConfirm={handleResetToDefault}
               onCancel={() => setResetConfirm(false)}
            />
         )}
         {deleteConfirm && (
            <ConfirmModal
               title={t('delete_modal_title')}
               body={t('delete_modal_body', { name: template.name })}
               confirmLabel={t('delete')}
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
   const { t } = useTranslation('authoring_persona');
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
               <Plus className="w-3.5 h-3.5" /> {t('add')}
            </button>
         </header>
         {items.length === 0 ? (
            <div className={`rounded border border-dashed border-neutral-800 ${palette.bg} p-4 text-center text-xs text-neutral-500`}>
               {t('no_bullets_prefix')} <span className={palette.headerText}>{t('add')}</span> {t('no_bullets_suffix')}
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
                           title={t('move_up')}
                        >▲</button>
                        <GripVertical className="w-3 h-3 my-0.5" />
                        <button
                           type="button"
                           onClick={() => move(i, 1)}
                           disabled={i === items.length - 1}
                           className="text-[10px] disabled:opacity-30 hover:text-neutral-300 leading-none"
                           title={t('move_down')}
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
                        title={t('remove_bullet')}
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
   const { t } = useTranslation('authoring_persona');
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
                  {t('cancel')}
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
