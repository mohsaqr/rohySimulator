import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, Users, Bot, RotateCcw } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { AgentService } from '../../services/AgentService';

const AGENT_TYPE_BADGE = {
   patient: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   discussant: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   nurse: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   consultant: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   relative: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   pharmacist: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   technician: 'bg-neutral-200 text-teal-700 border border-neutral-300',
   other: 'bg-neutral-200 text-teal-700 border border-neutral-300',
};

// AgentTemplateManager is the list view. The actual editing now happens
// in AgentPersonaEditor (full-page); the parent forwards an onOpenEditor
// callback that swaps the screen. Standards and customs are both fully
// editable — see HANDOFF for why the previous read-only gating was wrong.
export default function AgentTemplateManager({ onOpenEditor }) {
   const toast = useToast();
   const [templates, setTemplates] = useState([]);
   const [loading, setLoading] = useState(true);
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
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
         </div>
      );
   }

   const standardTemplates = [...templates]
      .filter(t => t.is_default === 1 || t.is_default === true)
      .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));
   const customTemplates = [...templates]
      .filter(t => !(t.is_default === 1 || t.is_default === true))
      .sort((a, b) => (a.agent_type || '').localeCompare(b.agent_type || '') || (a.name || '').localeCompare(b.name || ''));

   // Single-click on the row opens the full editor — no expand stage. The
   // inline label/value grid surfaces the values an admin actually wants
   // to scan (voice, avatar, dos/donts counts, LLM, context filter) so
   // they don't have to open each persona to see what's set.
   const renderTemplateCard = (template, { isStandard }) => {
      const cfg = parseConfigField(template.config);
      const voiceId = cfg.voice?.case_voice || null;
      const voiceGender = cfg.voice?.gender || null;
      const avatarFile = template.avatar_url || null;
      const llmLabel = template.llm_provider
         ? `${template.llm_provider}${template.llm_model ? '/' + template.llm_model : ''}`
         : null;
      const dosCount = Array.isArray(cfg.dos) ? cfg.dos.length : 0;
      const dontsCount = Array.isArray(cfg.donts) ? cfg.donts.length : 0;
      const ctxFilter = template.context_filter || 'full';
      const ctxColor =
         ctxFilter === 'full' ? 'text-teal-700' :
         ctxFilter === 'history' ? 'text-neutral-600' :
         'text-neutral-400';

      return (
         <div
            key={template.id}
            onClick={() => handleEdit(template)}
            className="rohy-card rounded-lg transition-colors px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer"
         >
            <div className="flex items-center gap-3 min-w-0 md:flex-1">
               <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${AGENT_TYPE_BADGE[template.agent_type] || AGENT_TYPE_BADGE.other}`}>
                  <Users className="w-5 h-5" />
               </div>
               <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                     <span className="font-medium">{template.name}</span>
                     <span className="rohy-badge-neutral capitalize">{template.agent_type}</span>
                     {isStandard && (
                        <span className="rohy-badge-teal">Standard</span>
                     )}
                  </div>
                  <div className="text-sm text-neutral-600 truncate">
                     {template.role_title || template.agent_type} · {template.communication_style || 'standard'}
                  </div>
               </div>
            </div>

            {/* Value grid. On md+ screens it sits to the right of the name
                column with right-aligned labels; on narrow screens (mobile,
                side panels) it stacks vertically under the name as a single
                column of "label: value" lines so the info doesn't disappear. */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs shrink-0 md:max-w-[280px] w-full md:w-auto">
               <span className="text-neutral-600 md:text-right">voice</span>
               <span className={voiceId ? 'text-neutral-900 font-mono truncate' : 'text-neutral-500 italic'} title={voiceId || 'no voice set'}>
                  {voiceId || 'unset'}{voiceGender ? <span className="text-neutral-600"> · {voiceGender}</span> : null}
               </span>
               <span className="text-neutral-600 md:text-right">avatar</span>
               <span className={avatarFile ? 'text-neutral-900 font-mono truncate' : 'text-neutral-500 italic'} title={avatarFile || 'no avatar set'}>
                  {avatarFile || 'unset'}
               </span>
               <span className="text-neutral-600 md:text-right">do / don&apos;t</span>
               <span className="text-neutral-700">
                  <span className={dosCount > 0 ? 'text-teal-700' : 'text-neutral-500'}>{dosCount}</span>
                  {' / '}
                  <span className={dontsCount > 0 ? 'text-red-700' : 'text-neutral-500'}>{dontsCount}</span>
               </span>
               <span className="text-neutral-600 md:text-right">context</span>
               <span className={ctxColor}>{ctxFilter}</span>
               {llmLabel && (
                  <>
                     <span className="text-neutral-600 md:text-right">LLM</span>
                     <span className="text-neutral-700 font-mono truncate" title={llmLabel}>{llmLabel}</span>
                  </>
               )}
            </div>

            {/* Action buttons. Stop propagation so clicks don't trigger the
                row's open-editor handler. Reset is intentionally text+icon
                because RotateCcw alone reads as "undo" and we don't want
                anyone touching a shipped standard by mistake. */}
            <div
               className="flex items-center gap-1 shrink-0 self-end md:self-auto"
               onClick={(e) => e.stopPropagation()}
            >
               <button
                  onClick={() => handleDuplicate(template)}
                  className="rohy-subtle-button p-2 rounded"
                  title="Duplicate"
                  aria-label="Duplicate"
               >
                  <Copy className="w-4 h-4" />
               </button>
               {isStandard ? (
                  <button
                     onClick={() => setResetTarget(template)}
                     className="rohy-subtle-button px-2 py-1.5 rounded flex items-center gap-1 text-xs"
                     title="Reset to shipped defaults"
                     aria-label="Reset to defaults"
                  >
                     <RotateCcw className="w-4 h-4" />
                     <span>Reset</span>
                  </button>
               ) : (
                  <button
                     onClick={() => handleDelete(template)}
                     className="rohy-danger-icon-button p-2 rounded"
                     title="Delete"
                     aria-label="Delete"
                  >
                     <Trash2 className="w-4 h-4" />
                  </button>
               )}
            </div>
         </div>
      );
   };

   return (
      <div className="space-y-6">
         <div className="flex items-center justify-between border-b border-neutral-300 pb-4">
            <div>
               <h3 className="text-lg font-bold flex items-center gap-2">
                  <Bot className="w-5 h-5 text-teal-700" />
                  Agent Personas
               </h3>
               <p className="text-sm text-neutral-600 mt-1">
                  Standard personas ship with Rohy. Admins can edit them in place; the &quot;Reset to defaults&quot; button restores the shipped baseline. Custom personas are admin-authored and available system-wide.
               </p>
            </div>
            <button
               onClick={handleCreate}
               className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded text-sm flex items-center gap-1 font-semibold"
            >
               <Plus className="w-4 h-4" /> New Custom
            </button>
         </div>

         <section>
            <div className="flex items-center justify-between mb-2">
               <h4 className="text-sm font-bold text-teal-700 uppercase tracking-wider">Standard templates</h4>
               <span className="text-xs text-neutral-600">{standardTemplates.length} shipped · admin-editable</span>
            </div>
            {standardTemplates.length === 0 ? (
               <div className="text-sm text-neutral-500 italic px-2 py-4">No standard templates seeded.</div>
            ) : (
               <div className="space-y-3">{standardTemplates.map(t => renderTemplateCard(t, { isStandard: true }))}</div>
            )}
         </section>

         <section>
            <div className="flex items-center justify-between mb-2">
               <h4 className="text-sm font-bold text-neutral-700 uppercase tracking-wider">Custom templates</h4>
               <span className="text-xs text-neutral-600">{customTemplates.length} authored · system-wide</span>
            </div>
            {customTemplates.length === 0 ? (
               <div className="rounded border border-dashed border-neutral-400 p-6 text-center text-sm text-neutral-600">
                  No custom templates yet. Click <span className="text-teal-700">+ New Custom</span> or duplicate a standard template above to get started.
               </div>
            ) : (
               <div className="space-y-3">{customTemplates.map(t => renderTemplateCard(t, { isStandard: false }))}</div>
            )}
         </section>

         {resetTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
               <div className="rohy-card rounded-lg shadow-2xl w-full max-w-md">
                  <div className="px-6 py-5 border-b border-neutral-300">
                     <h2 className="text-base font-semibold text-neutral-900">Reset &quot;{resetTarget.name}&quot; to shipped defaults?</h2>
                  </div>
                  <div className="px-6 py-5 text-sm text-neutral-700 space-y-2">
                     <p>This restores the original name, role, system prompt, dos/don&apos;ts, avatar, and voice slot, and clears any LLM or memory overrides.</p>
                     <p className="text-neutral-600">Custom edits to this standard persona will be lost.</p>
                  </div>
                  <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-300">
                     <button
                        onClick={() => setResetTarget(null)}
                        className="rohy-subtle-button px-4 py-2 text-sm rounded"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={handleResetConfirmed}
                        className="px-4 py-2 text-sm rounded bg-teal-700 hover:bg-teal-600 text-white font-semibold"
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
