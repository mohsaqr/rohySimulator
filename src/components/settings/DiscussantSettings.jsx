import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Save, Loader2, ExternalLink, Star } from 'lucide-react';
import { AgentService } from '../../services/AgentService';
import { useToast } from '../../contexts/ToastContext';

const CONTEXT_FILTERS = [
    { value: 'full', label: 'Full case context (default)', description: 'Demographics, history, vitals, expected diagnosis & plan' },
    { value: 'history', label: 'History only', description: 'Demographics + history. No vitals/diagnosis hints.' },
    { value: 'vitals', label: 'Vitals only', description: 'Initial vitals only. Pure physiology debrief.' },
    { value: 'minimal', label: 'Minimal (Socratic)', description: 'No case data — pure Socratic dialogue.' },
];

const UNLOCK_TRIGGERS = [
    { value: 'after_case_ended', label: 'After case ends (debrief)', description: 'Default. Discussant unlocks once the learner clicks End.' },
    { value: 'always', label: 'Always available', description: 'Discussant accessible during the live case (in-the-moment hints).' },
];

// Settings sub-tab focused on the discussant: shows every discussant-typed
// agent_template, marks the platform default, and exposes the two settings
// that don't have a home in the broader Agent Personas editor — context
// filter and unlock trigger. Deeper edits (system prompt, voice, LLM model)
// still live in Agent Personas; this tab links across.
export default function DiscussantSettings({ onJumpToAgents }) {
    const toast = useToast();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [drafts, setDrafts] = useState({});

    const discussants = useMemo(
        () => templates.filter(t => t.agent_type === 'discussant'),
        [templates]
    );

    const reload = async () => {
        setLoading(true);
        try {
            const data = await AgentService.getTemplates();
            setTemplates(data || []);
            const next = {};
            (data || []).filter(t => t.agent_type === 'discussant').forEach(t => {
                const cfg = parseConfig(t.config);
                next[t.id] = {
                    context_filter: t.context_filter || 'full',
                    unlock_trigger: cfg.unlock_trigger || 'after_case_ended',
                    system_prompt: t.system_prompt || '',
                    config: cfg,
                };
            });
            setDrafts(next);
        } catch {
            toast.error('Failed to load discussant templates');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, []);

    const updateDraft = (id, patch) => {
        setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    };

    const save = async (template) => {
        const draft = drafts[template.id];
        if (!draft) return;
        setSaving(prev => ({ ...prev, [template.id]: true }));
        try {
            await AgentService.updateTemplate(template.id, {
                context_filter: draft.context_filter,
                system_prompt: draft.system_prompt,
                config: { ...draft.config, unlock_trigger: draft.unlock_trigger },
            });
            toast.success(`Saved ${template.name}`);
            await reload();
        } catch (err) {
            toast.error(err.message || 'Failed to save');
        } finally {
            setSaving(prev => ({ ...prev, [template.id]: false }));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading discussants…
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-bold text-purple-400 flex items-center gap-2">
                        <GraduationCap className="w-5 h-5" /> Discussant
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
                        Configure the AI tutor that runs the case debrief after a learner ends a session.
                        Per-case overrides live on each case (Cases tab → edit a case → AI Agents).
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onJumpToAgents}
                    className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 flex items-center gap-1.5 border border-neutral-700"
                    title="Edit name, voice, avatar, LLM model, memory access, etc."
                >
                    <ExternalLink className="w-4 h-4" /> Open full editor (Agent Personas)
                </button>
            </div>

            {discussants.length === 0 ? (
                <div className="rounded border border-neutral-800 bg-neutral-900/50 p-8 text-center">
                    <p className="text-sm text-neutral-400 mb-3">No discussant templates yet.</p>
                    <button
                        type="button"
                        onClick={onJumpToAgents}
                        className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm"
                    >
                        Create one in Agent Personas
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {discussants.map(t => {
                        const draft = drafts[t.id] || {};
                        const dirty = isDirty(t, draft);
                        return (
                            <div
                                key={t.id}
                                className={`rounded-lg border p-5 space-y-4 ${
                                    t.is_default
                                        ? 'border-purple-700 bg-purple-950/20'
                                        : 'border-neutral-800 bg-neutral-900/50'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-indigo-900/50 text-indigo-400 flex items-center justify-center shrink-0">
                                            <GraduationCap className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-neutral-100">{t.name}</span>
                                                {t.is_default ? (
                                                    <span className="px-1.5 py-0.5 bg-purple-600/40 text-purple-200 rounded text-xs flex items-center gap-1">
                                                        <Star className="w-3 h-3" /> Default
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="text-xs text-neutral-500 mt-0.5">
                                                {t.role_title || 'Discussant'}
                                                {t.llm_model ? ` · ${t.llm_provider || 'platform default'}: ${t.llm_model}` : ' · uses platform LLM'}
                                                {t.avatar_url ? ` · avatar ${t.avatar_url}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => save(t)}
                                        disabled={!dirty || saving[t.id]}
                                        className="px-3 py-1.5 rounded text-sm bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-1.5 shrink-0"
                                    >
                                        {saving[t.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        Save
                                    </button>
                                </div>

                                <div className="grid md:grid-cols-2 gap-4">
                                    <Field label="Context filter (case awareness)" hint={CONTEXT_FILTERS.find(f => f.value === draft.context_filter)?.description}>
                                        <select
                                            value={draft.context_filter || 'full'}
                                            onChange={(e) => updateDraft(t.id, { context_filter: e.target.value })}
                                            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                                        >
                                            {CONTEXT_FILTERS.map(f => (
                                                <option key={f.value} value={f.value}>{f.label}</option>
                                            ))}
                                        </select>
                                    </Field>

                                    <Field label="Unlock trigger" hint={UNLOCK_TRIGGERS.find(u => u.value === draft.unlock_trigger)?.description}>
                                        <select
                                            value={draft.unlock_trigger || 'after_case_ended'}
                                            onChange={(e) => updateDraft(t.id, { unlock_trigger: e.target.value })}
                                            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:outline-none focus:border-purple-500"
                                        >
                                            {UNLOCK_TRIGGERS.map(u => (
                                                <option key={u.value} value={u.value}>{u.label}</option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>

                                <Field label="System prompt" hint="The Socratic instructions the discussant follows. Keep it concise and outcome-oriented.">
                                    <textarea
                                        value={draft.system_prompt || ''}
                                        onChange={(e) => updateDraft(t.id, { system_prompt: e.target.value })}
                                        rows={8}
                                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm font-mono resize-y focus:outline-none focus:border-purple-500"
                                    />
                                </Field>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Field({ label, hint, children }) {
    return (
        <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">{label}</label>
            {children}
            {hint && <p className="text-xs text-neutral-500 mt-1">{hint}</p>}
        </div>
    );
}

function parseConfig(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
}

function isDirty(template, draft) {
    if (!draft) return false;
    const cfg = parseConfig(template.config);
    if ((draft.context_filter || 'full') !== (template.context_filter || 'full')) return true;
    if ((draft.unlock_trigger || 'after_case_ended') !== (cfg.unlock_trigger || 'after_case_ended')) return true;
    if ((draft.system_prompt || '') !== (template.system_prompt || '')) return true;
    return false;
}
