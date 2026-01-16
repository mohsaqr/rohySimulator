import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Copy, Save, X, Users, ChevronDown, ChevronUp, Bot, Zap, Brain, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { AgentService } from '../../services/AgentService';

const AGENT_TYPES = [
  { value: 'nurse', label: 'Nurse', description: 'Bedside nursing staff' },
  { value: 'consultant', label: 'Consultant', description: 'Specialist physicians' },
  { value: 'relative', label: 'Relative', description: 'Patient family members' },
  { value: 'pharmacist', label: 'Pharmacist', description: 'Pharmacy consultation' },
  { value: 'technician', label: 'Technician', description: 'Lab/Radiology technicians' },
  { value: 'other', label: 'Other', description: 'Custom agent type' }
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
    setEditingTemplate({ ...template, memory_access: memoryAccess });
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

          {/* Right Column - System Prompt */}
          <div className="space-y-4">
            <div className="h-full flex flex-col">
              <label className="block text-sm font-medium text-neutral-400 mb-1">System Prompt *</label>
              <textarea
                value={editingTemplate.system_prompt}
                onChange={(e) => updateEditingField('system_prompt', e.target.value)}
                placeholder="Define the agent's personality, role, and behavior..."
                className="flex-1 min-h-[400px] px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500 font-mono resize-none"
              />
              <p className="text-xs text-neutral-500 mt-1">
                This defines the agent's personality. Patient context and vitals will be appended automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Template list view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" />
            Agent Templates
          </h3>
          <p className="text-sm text-neutral-500 mt-1">
            Create and manage AI agent personas for simulations
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">
          <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No agent templates found.</p>
          <p className="text-sm">Create your first template to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(template => (
            <div
              key={template.id}
              className={`border rounded-lg transition-colors ${
                template.is_default
                  ? 'border-purple-800 bg-purple-950/20'
                  : 'border-neutral-800 bg-neutral-900/50'
              }`}
            >
              {/* Header */}
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    template.agent_type === 'nurse' ? 'bg-blue-900/50 text-blue-400' :
                    template.agent_type === 'consultant' ? 'bg-green-900/50 text-green-400' :
                    template.agent_type === 'relative' ? 'bg-amber-900/50 text-amber-400' :
                    'bg-neutral-800 text-neutral-400'
                  }`}>
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      {template.is_default && (
                        <span className="px-1.5 py-0.5 bg-purple-600/50 text-purple-300 rounded text-xs">Default</span>
                      )}
                    </div>
                    <div className="text-sm text-neutral-500">
                      {template.role_title || template.agent_type} • {template.communication_style || 'standard'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    template.context_filter === 'full' ? 'bg-green-900/50 text-green-400' :
                    template.context_filter === 'history' ? 'bg-amber-900/50 text-amber-400' :
                    'bg-neutral-800 text-neutral-400'
                  }`}>
                    {template.context_filter}
                  </span>
                  {expandedId === template.id ? (
                    <ChevronUp className="w-5 h-5 text-neutral-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-neutral-500" />
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {expandedId === template.id && (
                <div className="px-4 py-3 border-t border-neutral-800">
                  <div className="mb-3">
                    <h4 className="text-xs font-medium text-neutral-500 mb-1">System Prompt</h4>
                    <pre className="text-sm text-neutral-300 whitespace-pre-wrap max-h-40 overflow-y-auto bg-neutral-950 p-2 rounded">
                      {template.system_prompt}
                    </pre>
                  </div>

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

                  {/* LLM Configuration Summary */}
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

                  {/* Memory Access Summary */}
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
                      className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm flex items-center gap-1"
                    >
                      <Copy className="w-4 h-4" /> Duplicate
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEdit(template); }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1"
                    >
                      <Edit2 className="w-4 h-4" /> Edit
                    </button>
                    {!template.is_default && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(template); }}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm flex items-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
