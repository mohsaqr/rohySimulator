import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, Copy, Save, X, Users, ChevronDown, ChevronUp, Bot, Zap, Brain, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { AgentService } from '../../services/AgentService';
import { useVoice } from '../../contexts/VoiceContext';
import { apiUrl } from '../../config/api';
import { AuthService } from '../../services/authService';
import AvatarFramingSliders from './AvatarFraming.jsx';
import { mergeCameraPatch, resolveCamera } from '../../utils/avatarFraming.js';

// Lazy — pulls in three.js / r3f only when admin opens the agent editor.
const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

const TTS_PROVIDERS = [
  { value: '', label: 'Inherit (use global)' },
  { value: 'piper', label: 'Piper (fast, robotic)' },
  { value: 'kokoro', label: 'Kokoro-82M (slower, expressive)' }
];

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

// Tailwind classes for the per-type avatar circle. Centralised so the list
// view, the editor preview, and the per-case agent list all match.
const AGENT_TYPE_BADGE = {
  patient: 'bg-rose-900/50 text-rose-300',
  discussant: 'bg-indigo-900/50 text-indigo-400',
  nurse: 'bg-blue-900/50 text-blue-400',
  consultant: 'bg-green-900/50 text-green-400',
  relative: 'bg-amber-900/50 text-amber-400',
  pharmacist: 'bg-fuchsia-900/50 text-fuchsia-300',
  technician: 'bg-teal-900/50 text-teal-300',
  other: 'bg-neutral-800 text-neutral-400',
};

const UNLOCK_TRIGGERS = [
  { value: 'after_case_ended', label: 'After case ends (debrief)' },
  { value: 'always', label: 'Always available' },
];

const CONTEXT_FILTERS = [
  { value: 'full', label: 'Full Context', description: 'Access to all patient data and team communications' },
  { value: 'history', label: 'History Only', description: 'Limited to patient history and related communications' },
  { value: 'vitals', label: 'Vitals Only', description: 'Current vital signs and recent changes only' },
  { value: 'minimal', label: 'Minimal', description: 'Basic patient demographics only' }
];

const COMMUNICATION_STYLES = [
  { value: 'professional', label: 'Professional', description: 'Formal medical communication' },
  { value: 'educational', label: 'Educational', description: 'Teaching-focused, explains reasoning' },
  { value: 'emotional', label: 'Emotional', description: 'Empathetic, non-medical language' },
  { value: 'concise', label: 'Concise', description: 'Brief, to-the-point responses' }
];

const LLM_PROVIDERS = [
  { value: '', label: 'Use Platform Default', description: 'Use the global LLM settings' },
  { value: 'openai', label: 'OpenAI', description: 'GPT-4, GPT-4o, etc.' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude models' },
  { value: 'openrouter', label: 'OpenRouter', description: 'Multiple models via OpenRouter' },
  { value: 'custom', label: 'Custom Endpoint', description: 'OpenAI-compatible endpoint' }
];

// PatientRecord memory categories based on the 8 verbs
const MEMORY_CATEGORIES = [
  { key: 'OBTAINED', label: 'History (OBTAINED)', description: 'Patient history, symptoms, HPI, PMH, etc.' },
  { key: 'EXAMINED', label: 'Physical Exam (EXAMINED)', description: 'Physical examination findings' },
  { key: 'ELICITED', label: 'Tests Elicited (ELICITED)', description: 'Physical tests like reflexes, sensory tests' },
  { key: 'NOTED', label: 'Observations (NOTED)', description: 'General observations about patient' },
  { key: 'ORDERED', label: 'Orders (ORDERED)', description: 'Lab tests, imaging, medications ordered' },
  { key: 'ADMINISTERED', label: 'Administered (ADMINISTERED)', description: 'Medications/treatments given' },
  { key: 'CHANGED', label: 'Changes (CHANGED)', description: 'Parameter changes like vitals, positioning' },
  { key: 'EXPRESSED', label: 'Communication (EXPRESSED)', description: 'Explanations given to patient' }
];

export default function AgentTemplateManager() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const { headManifest } = useVoice();
  const [ttsVoices, setTtsVoices] = useState([]);

  // Load the voice list whenever the agent's TTS engine changes — Piper and
  // Kokoro have non-overlapping voice catalogues. Empty provider = ask for
  // whatever the global default is.
  useEffect(() => {
    const provider = editingTemplate?.config?.voice?.tts_provider || 'piper';
    let cancelled = false;
    fetch(apiUrl(`/tts/voices?provider=${provider}`), { headers: AuthService.authHeaders() })
      .then(r => r.ok ? r.json() : { voices: [] })
      .then(d => { if (!cancelled) setTtsVoices(d.voices || []); })
      .catch(() => { if (!cancelled) setTtsVoices([]); });
    return () => { cancelled = true; };
  }, [editingTemplate?.config?.voice?.tts_provider]);
  const [expandedId, setExpandedId] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingLLM, setTestingLLM] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Load templates on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await AgentService.getTemplates();
      setTemplates(data);
    } catch (err) {
      toast.error('Failed to load agent templates');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingTemplate({
      agent_type: 'nurse',
      name: '',
      role_title: '',
      system_prompt: '',
      context_filter: 'full',
      communication_style: 'professional',
      config: {
        typical_availability: 'present',
        can_be_paged: false,
        response_time: { min: 0, max: 0 }
      },
      // LLM override settings (empty = use platform default)
      llm_provider: '',
      llm_model: '',
      llm_api_key: '',
      llm_endpoint: '',
      // Memory access - which PatientRecord categories this agent can see
      memory_access: {
        OBTAINED: true,
        EXAMINED: true,
        ELICITED: true,
        NOTED: true,
        ORDERED: true,
        ADMINISTERED: true,
        CHANGED: true,
        EXPRESSED: true
      }
    });
    setTestResult(null);
    setShowApiKey(false);
  };

  const handleEdit = (template) => {
    // Parse memory_access if it's a string
    let memoryAccess = template.memory_access;
    if (typeof memoryAccess === 'string') {
      try {
        memoryAccess = JSON.parse(memoryAccess);
      } catch {
        memoryAccess = null;
      }
    }
    // Default to all access if not set
    if (!memoryAccess) {
      memoryAccess = {
        OBTAINED: true, EXAMINED: true, ELICITED: true, NOTED: true,
        ORDERED: true, ADMINISTERED: true, CHANGED: true, EXPRESSED: true
      };
    }
    // Config arrives as a JSON string from the DB but is read all over the
    // form as an object — normalise once on edit-open.
    let config = template.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = {}; }
    }
    setEditingTemplate({ ...template, config: config || {}, memory_access: memoryAccess });
    setTestResult(null);
    setShowApiKey(false);
  };

  const handleDuplicate = async (template) => {
    try {
      const result = await AgentService.duplicateTemplate(template.id, `${template.name} (Copy)`);
      toast.success('Template duplicated');
      loadTemplates();
    } catch (err) {
      toast.error(err.message || 'Failed to duplicate template');
    }
  };

  const handleDelete = async (template) => {
    if (template.is_default) {
      toast.warning('Cannot delete default templates');
      return;
    }
    if (!confirm(`Delete agent template "${template.name}"?`)) return;

    try {
      await AgentService.deleteTemplate(template.id);
      toast.success('Template deleted');
      loadTemplates();
    } catch (err) {
      toast.error(err.message || 'Failed to delete template');
    }
  };

  const handleSave = async () => {
    if (!editingTemplate.name || !editingTemplate.system_prompt) {
      toast.warning('Name and system prompt are required');
      return;
    }

    try {
      if (editingTemplate.id) {
        await AgentService.updateTemplate(editingTemplate.id, editingTemplate);
        toast.success('Template updated');
      } else {
        await AgentService.createTemplate(editingTemplate);
        toast.success('Template created');
      }
      setEditingTemplate(null);
      loadTemplates();
    } catch (err) {
      toast.error(err.message || 'Failed to save template');
    }
  };

  const updateEditingField = (field, value) => {
    setEditingTemplate(prev => ({ ...prev, [field]: value }));
  };

  const updateConfigField = (field, value) => {
    setEditingTemplate(prev => ({
      ...prev,
      config: { ...prev.config, [field]: value }
    }));
  };

  // Voice override lives at config.voice — same shape as a case's voice
  // override (tts_provider, case_voice, tts_rate). Empty values are stripped
  // so the field "inherits" from the global voice settings.
  const updateVoiceField = (field, value) => {
    setEditingTemplate(prev => {
      const nextVoice = { ...(prev.config?.voice || {}) };
      if (value === '' || value === null || value === undefined) delete nextVoice[field];
      else nextVoice[field] = value;
      const nextConfig = { ...(prev.config || {}) };
      if (Object.keys(nextVoice).length === 0) delete nextConfig.voice;
      else nextConfig.voice = nextVoice;
      return { ...prev, config: nextConfig };
    });
  };

  // Switching TTS engine clears the per-agent voice — Piper filenames and
  // Kokoro slugs aren't interchangeable.
  const updateTtsProvider = (value) => {
    setEditingTemplate(prev => {
      const nextVoice = { ...(prev.config?.voice || {}) };
      delete nextVoice.case_voice;
      if (value === '') delete nextVoice.tts_provider;
      else nextVoice.tts_provider = value;
      const nextConfig = { ...(prev.config || {}) };
      if (Object.keys(nextVoice).length === 0) delete nextConfig.voice;
      else nextConfig.voice = nextVoice;
      return { ...prev, config: nextConfig };
    });
  };

  const updateAvatarCamera = (patch) => {
    setEditingTemplate(prev => {
      const base = prev.config?.avatar_camera || resolveCamera(headManifest, prev.avatar_url, null);
      const next = mergeCameraPatch(base, patch);
      return { ...prev, config: { ...(prev.config || {}), avatar_camera: next } };
    });
  };

  const resetAvatarCamera = () => {
    setEditingTemplate(prev => {
      const next = { ...(prev.config || {}) };
      delete next.avatar_camera;
      return { ...prev, config: next };
    });
  };

  const toggleMemoryAccess = (key) => {
    setEditingTemplate(prev => ({
      ...prev,
      memory_access: {
        ...prev.memory_access,
        [key]: !prev.memory_access?.[key]
      }
    }));
  };

  const handleTestLLM = async () => {
    if (!editingTemplate?.id) {
      toast.warning('Please save the template first before testing');
      return;
    }

    setTestingLLM(true);
    setTestResult(null);

    try {
      const result = await AgentService.testLLM(editingTemplate.id);
      setTestResult({
        success: true,
        provider: result.provider,
        model: result.model,
        latency: result.latency_ms,
        response: result.response
      });
      toast.success(`LLM test successful (${result.latency_ms}ms)`);
    } catch (err) {
      setTestResult({
        success: false,
        error: err.message || 'Test failed'
      });
      toast.error(err.message || 'LLM test failed');
    } finally {
      setTestingLLM(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Editing form
  if (editingTemplate) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" />
            {editingTemplate.id ? 'Edit Agent Template' : 'New Agent Template'}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setEditingTemplate(null)}
              className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm flex items-center gap-1"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Agent Type</label>
              <select
                value={editingTemplate.agent_type}
                onChange={(e) => updateEditingField('agent_type', e.target.value)}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
              >
                {AGENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label} - {t.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Name *</label>
              <input
                type="text"
                value={editingTemplate.name}
                onChange={(e) => updateEditingField('name', e.target.value)}
                placeholder="e.g., Sarah Mitchell"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Role Title</label>
              <input
                type="text"
                value={editingTemplate.role_title || ''}
                onChange={(e) => updateEditingField('role_title', e.target.value)}
                placeholder="e.g., Bedside Nurse"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Context Filter</label>
              <select
                value={editingTemplate.context_filter}
                onChange={(e) => updateEditingField('context_filter', e.target.value)}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
              >
                {CONTEXT_FILTERS.map(c => (
                  <option key={c.value} value={c.value}>{c.label} - {c.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Communication Style</label>
              <select
                value={editingTemplate.communication_style || ''}
                onChange={(e) => updateEditingField('communication_style', e.target.value)}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">None specified</option>
                {COMMUNICATION_STYLES.map(s => (
                  <option key={s.value} value={s.value}>{s.label} - {s.description}</option>
                ))}
              </select>
            </div>

            {/* Avatar + Voice */}
            <div className="border-t border-neutral-800 pt-4 mt-4">
              <h4 className="text-sm font-medium text-neutral-300 mb-3">Avatar &amp; Voice</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Gender</label>
                    <select
                      value={editingTemplate.config?.gender || ''}
                      onChange={(e) => updateConfigField('gender', e.target.value || undefined)}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                    >
                      <option value="">Auto-detect from name</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">3D Avatar</label>
                    <select
                      value={editingTemplate.avatar_url || ''}
                      onChange={(e) => updateEditingField('avatar_url', e.target.value || null)}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                    >
                      <option value="">Auto (by gender)</option>
                      {(headManifest?.all || []).map(a => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  </div>

                  {editingTemplate.avatar_url && (
                    <div className="border-t border-neutral-800 pt-3">
                      <AvatarFramingSliders
                        camera={resolveCamera(
                          headManifest,
                          editingTemplate.avatar_url,
                          editingTemplate.config?.avatar_camera
                        )}
                        onChange={updateAvatarCamera}
                        onReset={resetAvatarCamera}
                        hasOverride={!!editingTemplate.config?.avatar_camera}
                      />
                    </div>
                  )}

                  <div className="border-t border-neutral-800 pt-3 space-y-2">
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">TTS Engine</label>
                      <select
                        value={editingTemplate.config?.voice?.tts_provider || ''}
                        onChange={(e) => updateTtsProvider(e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                      >
                        {TTS_PROVIDERS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Voice</label>
                      <select
                        value={editingTemplate.config?.voice?.case_voice || ''}
                        onChange={(e) => updateVoiceField('case_voice', e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                      >
                        <option value="">Inherit (global by gender)</option>
                        {ttsVoices.map(v => {
                          const tag = v.gender ? ` — ${v.gender}` : '';
                          return (
                            <option key={v.filename} value={v.filename}>
                              {(v.displayName || v.filename) + tag}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Speech rate</label>
                      <input
                        type="number"
                        step="0.05" min="0.5" max="1.5"
                        value={editingTemplate.config?.voice?.tts_rate ?? ''}
                        placeholder="Inherit"
                        onChange={(e) => {
                          const v = e.target.value;
                          updateVoiceField('tts_rate', v === '' ? '' : Number(v));
                        }}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-start justify-center">
                  {editingTemplate.avatar_url && headManifest ? (
                    <div className="aspect-square w-full max-w-[200px]">
                      <Suspense fallback={
                        <div className="w-full h-full rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
                        </div>
                      }>
                        <PatientAvatar
                          patient={{ gender: editingTemplate.config?.gender }}
                          avatarType="3d"
                          headManifest={headManifest}
                          avatarId={editingTemplate.avatar_url}
                          cameraOverride={resolveCamera(
                            headManifest,
                            editingTemplate.avatar_url,
                            editingTemplate.config?.avatar_camera
                          )}
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500 text-center px-4 pt-8">
                      Pick an avatar to preview.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Availability Config */}
            <div className="border-t border-neutral-800 pt-4 mt-4">
              <h4 className="text-sm font-medium text-neutral-300 mb-3">Default Availability</h4>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Typical Availability</label>
                  <select
                    value={editingTemplate.config?.typical_availability || 'present'}
                    onChange={(e) => updateConfigField('typical_availability', e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="present">Present (Available immediately)</option>
                    <option value="on-call">On-Call (Must be paged)</option>
                    <option value="absent">Absent (Not available)</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="can_be_paged"
                    checked={editingTemplate.config?.can_be_paged || false}
                    onChange={(e) => updateConfigField('can_be_paged', e.target.checked)}
                    className="w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-purple-500 focus:ring-purple-500"
                  />
                  <label htmlFor="can_be_paged" className="text-sm text-neutral-300">Can be paged</label>
                </div>

                {editingTemplate.config?.can_be_paged && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Response Time Min (minutes)</label>
                      <input
                        type="number"
                        min="0"
                        value={editingTemplate.config?.response_time?.min || 0}
                        onChange={(e) => updateConfigField('response_time', {
                          ...editingTemplate.config?.response_time,
                          min: parseInt(e.target.value) || 0
                        })}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Response Time Max (minutes)</label>
                      <input
                        type="number"
                        min="0"
                        value={editingTemplate.config?.response_time?.max || 0}
                        onChange={(e) => updateConfigField('response_time', {
                          ...editingTemplate.config?.response_time,
                          max: parseInt(e.target.value) || 0
                        })}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* LLM Configuration */}
            <div className="border-t border-neutral-800 pt-4 mt-4">
              <h4 className="text-sm font-medium text-neutral-300 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                LLM Override Settings
              </h4>
              <p className="text-xs text-neutral-500 mb-3">
                Leave empty to use platform default settings.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Provider</label>
                  <select
                    value={editingTemplate.llm_provider || ''}
                    onChange={(e) => updateEditingField('llm_provider', e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                  >
                    {LLM_PROVIDERS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {editingTemplate.llm_provider && (
                  <>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Model</label>
                      <input
                        type="text"
                        value={editingTemplate.llm_model || ''}
                        onChange={(e) => updateEditingField('llm_model', e.target.value)}
                        placeholder={
                          editingTemplate.llm_provider === 'openai' ? 'gpt-4o-mini' :
                          editingTemplate.llm_provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                          editingTemplate.llm_provider === 'openrouter' ? 'openai/gpt-4o-mini' :
                          'model-name'
                        }
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">API Key</label>
                      <div className="relative">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={editingTemplate.llm_api_key || ''}
                          onChange={(e) => updateEditingField('llm_api_key', e.target.value)}
                          placeholder="sk-... (leave empty to use platform key)"
                          className="w-full px-3 py-2 pr-10 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {editingTemplate.llm_provider === 'custom' && (
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">Custom Endpoint</label>
                        <input
                          type="text"
                          value={editingTemplate.llm_endpoint || ''}
                          onChange={(e) => updateEditingField('llm_endpoint', e.target.value)}
                          placeholder="https://api.example.com/v1"
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    )}

                    <button
                      onClick={handleTestLLM}
                      disabled={testingLLM}
                      className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-700 rounded text-sm flex items-center justify-center gap-2"
                    >
                      {testingLLM ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Test LLM Connection
                        </>
                      )}
                    </button>

                    {testResult && (
                      <div className={`p-3 rounded text-sm ${
                        testResult.success
                          ? 'bg-green-900/30 border border-green-800'
                          : 'bg-red-900/30 border border-red-800'
                      }`}>
                        {testResult.success ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-green-400">
                              <CheckCircle className="w-4 h-4" />
                              <span>Test Successful</span>
                            </div>
                            <div className="text-xs text-neutral-400">
                              {testResult.provider}/{testResult.model} - {testResult.latency}ms
                            </div>
                            <div className="text-xs text-neutral-300 mt-2 p-2 bg-neutral-900 rounded">
                              {testResult.response}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-red-400">
                            <AlertCircle className="w-4 h-4" />
                            <span>{testResult.error}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Memory Access Configuration */}
            <div className="border-t border-neutral-800 pt-4 mt-4">
              <h4 className="text-sm font-medium text-neutral-300 mb-3 flex items-center gap-2">
                <Brain className="w-4 h-4 text-cyan-400" />
                Patient Record Access
              </h4>
              <p className="text-xs text-neutral-500 mb-3">
                Select which parts of the Patient Record this agent can see.
              </p>

              <div className="space-y-2">
                {MEMORY_CATEGORIES.map(cat => (
                  <div key={cat.key} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`memory_${cat.key}`}
                      checked={editingTemplate.memory_access?.[cat.key] !== false}
                      onChange={() => toggleMemoryAccess(cat.key)}
                      className="mt-1 w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-cyan-500 focus:ring-cyan-500"
                    />
                    <label htmlFor={`memory_${cat.key}`} className="text-sm">
                      <span className="text-neutral-300">{cat.label}</span>
                      <span className="block text-xs text-neutral-500">{cat.description}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - System Prompt + Dos/Donts + discussant fields */}
          <div className="space-y-4">
            <div className="flex flex-col">
              <label className="block text-sm font-medium text-neutral-400 mb-1">System Prompt *</label>
              <textarea
                value={editingTemplate.system_prompt}
                onChange={(e) => updateEditingField('system_prompt', e.target.value)}
                placeholder="Define the agent's personality, role, and behavior..."
                className="min-h-[260px] px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500 font-mono resize-y"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Patient context and vitals are appended automatically when this agent runs.
              </p>
            </div>

            {/* Dos / Don'ts — per-line bullets stored in config.dos / config.donts */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-emerald-400 mb-1">Dos (one per line)</label>
                <textarea
                  value={configListToText(editingTemplate.config?.dos)}
                  onChange={(e) => updateConfigField('dos', textToConfigList(e.target.value))}
                  placeholder={'Stay in character\nUse lay terms\nAnswer questions truthfully'}
                  rows={6}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-emerald-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-rose-400 mb-1">Don'ts (one per line)</label>
                <textarea
                  value={configListToText(editingTemplate.config?.donts)}
                  onChange={(e) => updateConfigField('donts', textToConfigList(e.target.value))}
                  placeholder={'Volunteer differential diagnoses\nUse medical jargon\nBreak character'}
                  rows={6}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-rose-500 resize-y"
                />
              </div>
            </div>
            <p className="text-xs text-neutral-500 -mt-2">
              Each bullet is sent to the LLM under "You should:" / "You must not:" alongside the system prompt.
            </p>

            {/* Discussant-only fields */}
            {editingTemplate.agent_type === 'discussant' && (
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/50 space-y-3">
                <h5 className="text-sm font-bold text-indigo-300">Discussant settings</h5>
                <div>
                  <label className="block text-sm text-neutral-400 mb-1">Unlock trigger</label>
                  <select
                    value={editingTemplate.config?.unlock_trigger || 'after_case_ended'}
                    onChange={(e) => updateConfigField('unlock_trigger', e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-indigo-500"
                  >
                    {UNLOCK_TRIGGERS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-neutral-500 mt-1">
                    Controls when the learner can open the debrief screen during a session.
                  </p>
                </div>
                <p className="text-xs text-neutral-500">
                  Context filter is set in the Left column — defaults to "Full" so the discussant sees the case context.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Template list view — split into Standard (read-only, shipped) and Custom
  // (admin-created, fully editable). Both available system-wide.
  const standardTemplates = [...templates]
    .filter(t => t.is_default === 1 || t.is_default === true)
    .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));
  const customTemplates = [...templates]
    .filter(t => !(t.is_default === 1 || t.is_default === true))
    .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));

  const renderTemplateCard = (template, { readOnly }) => {
    const cfg = parseConfigField(template.config);
    const voiceGender = cfg.voice?.gender || cfg.voice?.tts_provider || null;
    const llmLabel = template.llm_provider
      ? `${template.llm_provider}${template.llm_model ? '/' + template.llm_model : ''}`
      : null;
    return (
    <div
      key={template.id}
      className={`border rounded-lg transition-colors ${
        readOnly ? 'border-purple-800 bg-purple-950/20' : 'border-neutral-800 bg-neutral-900/50'
      }`}
    >
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer gap-3"
        onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${AGENT_TYPE_BADGE[template.agent_type] || AGENT_TYPE_BADGE.other}`}>
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{template.name}</span>
              <span className="px-1.5 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300 capitalize">{template.agent_type}</span>
              {readOnly && (
                <span className="px-1.5 py-0.5 bg-purple-600/50 text-purple-300 rounded text-xs">Standard</span>
              )}
            </div>
            <div className="text-sm text-neutral-500 truncate">
              {template.role_title || template.agent_type} · {template.communication_style || 'standard'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
          {template.avatar_url && (
            <span className="px-2 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300" title={`Avatar: ${template.avatar_url}`}>
              🎭 avatar
            </span>
          )}
          {voiceGender && (
            <span className="px-2 py-0.5 rounded text-xs bg-neutral-800 text-neutral-300" title={`Voice slot: ${voiceGender}`}>
              🔊 {voiceGender}
            </span>
          )}
          {(Array.isArray(cfg.dos) && cfg.dos.length > 0) && (
            <span className="px-2 py-0.5 rounded text-xs bg-emerald-900/40 text-emerald-300" title={`${cfg.dos.length} dos`}>
              ✓ {cfg.dos.length}
            </span>
          )}
          {(Array.isArray(cfg.donts) && cfg.donts.length > 0) && (
            <span className="px-2 py-0.5 rounded text-xs bg-rose-900/40 text-rose-300" title={`${cfg.donts.length} don'ts`}>
              ✗ {cfg.donts.length}
            </span>
          )}
          {llmLabel && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-900/40 text-amber-300" title="Custom LLM">
              ⚡ {llmLabel}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded text-xs ${
            template.context_filter === 'full' ? 'bg-green-900/50 text-green-400' :
            template.context_filter === 'history' ? 'bg-amber-900/50 text-amber-400' :
            'bg-neutral-800 text-neutral-400'
          }`}>
            {template.context_filter}
          </span>
          {expandedId === template.id ? <ChevronUp className="w-5 h-5 text-neutral-500" /> : <ChevronDown className="w-5 h-5 text-neutral-500" />}
        </div>
      </div>

      {expandedId === template.id && (
        <div className="px-4 py-3 border-t border-neutral-800">
          {/* Avatar preview + system prompt side-by-side */}
          <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 mb-3">
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 rounded-lg overflow-hidden bg-neutral-950 border border-neutral-800">
                <Suspense fallback={<div className="w-full h-full bg-neutral-900" />}>
                  <PatientAvatar
                    patient={{ id: `tpl-${template.id}`, name: template.name, gender: cfg.voice?.gender }}
                    avatarType="head"
                    avatarId={template.avatar_url}
                    headManifest={headManifest}
                  />
                </Suspense>
              </div>
              <div className="text-[11px] text-neutral-500 text-center mt-1 truncate w-full" title={template.avatar_url || 'auto'}>
                {template.avatar_url || 'auto by gender'}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-neutral-500 mb-1">System Prompt</h4>
              <pre className="text-sm text-neutral-300 whitespace-pre-wrap max-h-40 overflow-y-auto bg-neutral-950 p-2 rounded">
                {template.system_prompt}
              </pre>
            </div>
          </div>

          {(() => {
            const cfg = parseConfigField(template.config);
            const dos = Array.isArray(cfg.dos) ? cfg.dos : [];
            const donts = Array.isArray(cfg.donts) ? cfg.donts : [];
            if (dos.length === 0 && donts.length === 0) return null;
            return (
              <div className="grid md:grid-cols-2 gap-3 mb-3">
                {dos.length > 0 && (
                  <div className="p-2 bg-emerald-950/30 border border-emerald-900/50 rounded">
                    <div className="text-xs font-medium text-emerald-400 mb-1">DO</div>
                    <ul className="text-sm text-neutral-300 list-disc pl-4 space-y-0.5">
                      {dos.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
                {donts.length > 0 && (
                  <div className="p-2 bg-rose-950/30 border border-rose-900/50 rounded">
                    <div className="text-xs font-medium text-rose-400 mb-1">DON'T</div>
                    <ul className="text-sm text-neutral-300 list-disc pl-4 space-y-0.5">
                      {donts.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="grid grid-cols-3 gap-4 text-sm mb-3">
            <div>
              <span className="text-neutral-500">Availability:</span>{' '}
              <span className="text-neutral-300">{template.config?.typical_availability || 'present'}</span>
            </div>
            <div>
              <span className="text-neutral-500">Can be paged:</span>{' '}
              <span className="text-neutral-300">{template.config?.can_be_paged ? 'Yes' : 'No'}</span>
            </div>
            {template.config?.can_be_paged && (
              <div>
                <span className="text-neutral-500">Response time:</span>{' '}
                <span className="text-neutral-300">
                  {template.config?.response_time?.min || 0}-{template.config?.response_time?.max || 0} min
                </span>
              </div>
            )}
          </div>

          {template.llm_provider && (
            <div className="mb-3 p-2 bg-amber-950/30 border border-amber-900/50 rounded">
              <div className="flex items-center gap-2 text-sm">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400">Custom LLM:</span>
                <span className="text-neutral-300">{template.llm_provider}</span>
                {template.llm_model && (
                  <span className="text-neutral-500">/ {template.llm_model}</span>
                )}
              </div>
            </div>
          )}

          {template.memory_access && (() => {
            let memAccess = template.memory_access;
            if (typeof memAccess === 'string') {
              try { memAccess = JSON.parse(memAccess); } catch { memAccess = null; }
            }
            if (!memAccess) return null;
            const restrictedKeys = Object.entries(memAccess).filter(([_, v]) => v === false).map(([k]) => k);
            if (restrictedKeys.length === 0) return null;
            return (
              <div className="mb-3 p-2 bg-cyan-950/30 border border-cyan-900/50 rounded">
                <div className="flex items-center gap-2 text-sm">
                  <Brain className="w-4 h-4 text-cyan-400" />
                  <span className="text-cyan-400">Restricted access:</span>
                  <span className="text-neutral-300">{restrictedKeys.join(', ')}</span>
                </div>
              </div>
            );
          })()}

          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleDuplicate(template); }}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1 ${readOnly ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
              title={readOnly ? 'Standard templates are read-only — duplicate to customize' : 'Duplicate this template'}
            >
              <Copy className="w-4 h-4" /> Duplicate{readOnly ? ' to customize' : ''}
            </button>
            {!readOnly && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(template); }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1"
                >
                  <Edit2 className="w-4 h-4" /> Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(template); }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm flex items-center gap-1"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" />
            Agent Personas
          </h3>
          <p className="text-sm text-neutral-500 mt-1">
            Standard personas ship with the app and are read-only — duplicate to customize. Custom personas are admin-authored and available across all cases.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> New Custom
        </button>
      </div>

      {/* Standard section */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-purple-300 uppercase tracking-wider">Standard templates</h4>
          <span className="text-xs text-neutral-500">{standardTemplates.length} shipped</span>
        </div>
        {standardTemplates.length === 0 ? (
          <div className="text-sm text-neutral-500 italic px-2 py-4">No standard templates seeded.</div>
        ) : (
          <div className="space-y-3">{standardTemplates.map(t => renderTemplateCard(t, { readOnly: true }))}</div>
        )}
      </section>

      {/* Custom section */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-neutral-300 uppercase tracking-wider">Custom templates</h4>
          <span className="text-xs text-neutral-500">{customTemplates.length} authored · system-wide</span>
        </div>
        {customTemplates.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
            No custom templates yet. Click <span className="text-purple-300">+ New Custom</span> or duplicate a standard template above to get started.
          </div>
        ) : (
          <div className="space-y-3">{customTemplates.map(t => renderTemplateCard(t, { readOnly: false }))}</div>
        )}
      </section>
    </div>
  );
}

// Defensive parse — DB returns config as a JSON string; in-flight edits use
// objects. Centralised to avoid sprinkling try/catches in render code.
function parseConfigField(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

// Editor stores dos/donts as arrays in config.* — render them as one-bullet-
// per-line text in a textarea, parse back to array on change.
function configListToText(value) {
  if (!Array.isArray(value)) return '';
  return value.filter(s => typeof s === 'string').join('\n');
}
function textToConfigList(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
