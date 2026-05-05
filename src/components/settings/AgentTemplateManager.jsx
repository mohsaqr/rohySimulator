import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, Copy, Users, ChevronDown, ChevronUp, Bot, Zap, Brain, RotateCcw } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { AgentService } from '../../services/AgentService';
import { useVoice } from '../../contexts/VoiceContext';
import { resolveCamera } from '../../utils/avatarFraming';

// Lazy — pulls in three.js / r3f only when admin opens an expanded card.
const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

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

// AgentTemplateManager is the list view. The actual editing now happens
// in AgentPersonaEditor (full-page); the parent forwards an onOpenEditor
// callback that swaps the screen. Standards and customs are both fully
// editable — see HANDOFF for why the previous read-only gating was wrong.
export default function AgentTemplateManager({ onOpenEditor }) {
   const toast = useToast();
   const { headManifest } = useVoice();
   const [templates, setTemplates] = useState([]);
   const [loading, setLoading] = useState(true);
   const [expandedId, setExpandedId] = useState(null);
   const [resetTarget, setResetTarget] = useState(null); // template pending "reset to defaults"

   useEffect(() => { loadTemplates(); }, []);

   const loadTemplates = async () => {
      setLoading(true);
      try {
         const data = await AgentService.getTemplates();
         setTemplates(data);
      } catch {
         toast.error('Failed to load agent templates');
      } finally {
         setLoading(false);
      }
   };

   const handleEdit = (template) => onOpenEditor?.(template.id);
   const handleCreate = () => onOpenEditor?.('new');

   const handleDuplicate = async (template) => {
      try {
         await AgentService.duplicateTemplate(template.id, `${template.name} (Copy)`);
         toast.success('Template duplicated');
         loadTemplates();
      } catch (err) {
         toast.error(err.message || 'Failed to duplicate template');
      }
   };

   const handleDelete = async (template) => {
      // Server protects standards with a 403; surface a clearer message
      // before the round-trip rather than letting the toast read like a
      // server error.
      if (template.is_default) {
         toast.warning('Standard templates cannot be deleted. Use "Reset to defaults" or duplicate them.');
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

   const handleResetConfirmed = async () => {
      if (!resetTarget) return;
      try {
         const result = await AgentService.resetTemplateToDefault(resetTarget.id);
         toast.success(result.message || 'Reset to shipped defaults');
         setResetTarget(null);
         loadTemplates();
      } catch (err) {
         toast.error(err.message || 'Failed to reset to defaults');
      }
   };

   if (loading) {
      return (
         <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
         </div>
      );
   }

   const standardTemplates = [...templates]
      .filter(t => t.is_default === 1 || t.is_default === true)
      .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));
   const customTemplates = [...templates]
      .filter(t => !(t.is_default === 1 || t.is_default === true))
      .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));

   const renderTemplateCard = (template, { isStandard }) => {
      const cfg = parseConfigField(template.config);
      const voiceGender = cfg.voice?.gender || cfg.voice?.tts_provider || null;
      const llmLabel = template.llm_provider
         ? `${template.llm_provider}${template.llm_model ? '/' + template.llm_model : ''}`
         : null;
      const dosCount = Array.isArray(cfg.dos) ? cfg.dos.length : 0;
      const dontsCount = Array.isArray(cfg.donts) ? cfg.donts.length : 0;
      return (
         <div
            key={template.id}
            className={`border rounded-lg transition-colors ${
               isStandard ? 'border-purple-800 bg-purple-950/20' : 'border-neutral-800 bg-neutral-900/50'
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
                        {isStandard && (
                           <span className="px-1.5 py-0.5 bg-purple-600/50 text-purple-200 rounded text-xs">Standard</span>
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
                  {dosCount > 0 && (
                     <span className="px-2 py-0.5 rounded text-xs bg-emerald-900/40 text-emerald-300" title={`${dosCount} dos`}>
                        ✓ {dosCount}
                     </span>
                  )}
                  {dontsCount > 0 && (
                     <span className="px-2 py-0.5 rounded text-xs bg-rose-900/40 text-rose-300" title={`${dontsCount} don'ts`}>
                        ✗ {dontsCount}
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
                  <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 mb-3">
                     <div className="flex flex-col items-center">
                        <div className="w-32 h-32 rounded-lg overflow-hidden bg-neutral-950 border border-neutral-800">
                           <Suspense fallback={<div className="w-full h-full bg-neutral-900" />}>
                              <PatientAvatar
                                 patient={{ id: `tpl-${template.id}`, name: template.name, gender: cfg.voice?.gender }}
                                 avatarId={template.avatar_url}
                                 headManifest={headManifest}
                                 // Apply the persona's framing override (or
                                 // the manifest default) so the list-view
                                 // thumbnail matches what admins see in the
                                 // editor and what learners see at runtime.
                                 cameraOverride={resolveCamera(headManifest, template.avatar_url, cfg.avatar_camera)}
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

                  {(dosCount > 0 || dontsCount > 0) && (
                     <div className="grid md:grid-cols-2 gap-3 mb-3">
                        {dosCount > 0 && (
                           <div className="p-2 bg-emerald-950/30 border border-emerald-900/50 rounded">
                              <div className="text-xs font-medium text-emerald-400 mb-1">DO</div>
                              <ul className="text-sm text-neutral-300 list-disc pl-4 space-y-0.5">
                                 {cfg.dos.map((d, i) => <li key={i}>{d}</li>)}
                              </ul>
                           </div>
                        )}
                        {dontsCount > 0 && (
                           <div className="p-2 bg-rose-950/30 border border-rose-900/50 rounded">
                              <div className="text-xs font-medium text-rose-400 mb-1">DON'T</div>
                              <ul className="text-sm text-neutral-300 list-disc pl-4 space-y-0.5">
                                 {cfg.donts.map((d, i) => <li key={i}>{d}</li>)}
                              </ul>
                           </div>
                        )}
                     </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                     <div>
                        <span className="text-neutral-500">Availability:</span>{' '}
                        <span className="text-neutral-300">{cfg.typical_availability || 'present'}</span>
                     </div>
                     <div>
                        <span className="text-neutral-500">Can be paged:</span>{' '}
                        <span className="text-neutral-300">{cfg.can_be_paged ? 'Yes' : 'No'}</span>
                     </div>
                     {cfg.can_be_paged && (
                        <div>
                           <span className="text-neutral-500">Response:</span>{' '}
                           <span className="text-neutral-300">
                              {cfg.response_time?.min || 0}-{cfg.response_time?.max || 0} min
                           </span>
                        </div>
                     )}
                  </div>

                  {template.llm_provider && (
                     <div className="mb-3 p-2 bg-amber-950/30 border border-amber-900/50 rounded text-sm flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-amber-400">Custom LLM:</span>
                        <span className="text-neutral-300">{template.llm_provider}</span>
                        {template.llm_model && <span className="text-neutral-500">/ {template.llm_model}</span>}
                     </div>
                  )}

                  {template.memory_access && (() => {
                     let memAccess = template.memory_access;
                     if (typeof memAccess === 'string') {
                        try { memAccess = JSON.parse(memAccess); } catch { memAccess = null; }
                     }
                     if (!memAccess) return null;
                     const restricted = Object.entries(memAccess).filter(([, v]) => v === false).map(([k]) => k);
                     if (restricted.length === 0) return null;
                     return (
                        <div className="mb-3 p-2 bg-cyan-950/30 border border-cyan-900/50 rounded text-sm flex items-center gap-2">
                           <Brain className="w-4 h-4 text-cyan-400" />
                           <span className="text-cyan-400">Restricted access:</span>
                           <span className="text-neutral-300">{restricted.join(', ')}</span>
                        </div>
                     );
                  })()}

                  <div className="flex justify-end gap-2 flex-wrap">
                     <button
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(template); }}
                        className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm flex items-center gap-1"
                     >
                        <Copy className="w-4 h-4" /> Duplicate
                     </button>
                     {isStandard && (
                        <button
                           onClick={(e) => { e.stopPropagation(); setResetTarget(template); }}
                           className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded text-sm flex items-center gap-1 text-white"
                           title="Re-apply the shipped baseline values"
                        >
                           <RotateCcw className="w-4 h-4" /> Reset to defaults
                        </button>
                     )}
                     <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(template); }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm flex items-center gap-1"
                     >
                        <Edit2 className="w-4 h-4" /> Edit in full editor
                     </button>
                     {!isStandard && (
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
                  Standard personas ship with Rohy. Admins can edit them in place; the &quot;Reset to defaults&quot; button restores the shipped baseline. Custom personas are admin-authored and available system-wide.
               </p>
            </div>
            <button
               onClick={handleCreate}
               className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm flex items-center gap-1"
            >
               <Plus className="w-4 h-4" /> New Custom
            </button>
         </div>

         <section>
            <div className="flex items-center justify-between mb-2">
               <h4 className="text-sm font-bold text-purple-300 uppercase tracking-wider">Standard templates</h4>
               <span className="text-xs text-neutral-500">{standardTemplates.length} shipped · admin-editable</span>
            </div>
            {standardTemplates.length === 0 ? (
               <div className="text-sm text-neutral-500 italic px-2 py-4">No standard templates seeded.</div>
            ) : (
               <div className="space-y-3">{standardTemplates.map(t => renderTemplateCard(t, { isStandard: true }))}</div>
            )}
         </section>

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
               <div className="space-y-3">{customTemplates.map(t => renderTemplateCard(t, { isStandard: false }))}</div>
            )}
         </section>

         {resetTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
               <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-md">
                  <div className="px-6 py-5 border-b border-neutral-800">
                     <h2 className="text-base font-semibold text-white">Reset &quot;{resetTarget.name}&quot; to shipped defaults?</h2>
                  </div>
                  <div className="px-6 py-5 text-sm text-neutral-300 space-y-2">
                     <p>This restores the original name, role, system prompt, dos/don&apos;ts, avatar, and voice slot, and clears any LLM or memory overrides.</p>
                     <p className="text-amber-400">Custom edits to this standard persona will be lost.</p>
                  </div>
                  <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800">
                     <button
                        onClick={() => setResetTarget(null)}
                        className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:text-white"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={handleResetConfirmed}
                        className="px-4 py-2 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                     >
                        Reset to defaults
                     </button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
}

function parseConfigField(value) {
   if (!value) return {};
   if (typeof value === 'object') return value;
   try { return JSON.parse(value); } catch { return {}; }
}
