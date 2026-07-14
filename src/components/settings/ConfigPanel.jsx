
import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Save, Plus, Cpu, FileText, Database, Image, Loader2, Upload, Users, ClipboardList, X, FileDown, FileUp, Layers, Activity, User, Shield, Zap, Monitor, RefreshCw, Copy, Mic, Camera, ScanFace } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, apiDelete, apiFetch, apiPost, apiPut } from '../../services/apiClient';
import { listCohorts, listCaseAssignments, assignCaseCourse } from '../../services/cohortsService';
import ActivityTable from '../analytics/ActivityTable';
import SystemLogTable from '../analytics/SystemLogTable';
import ChatLogTable from '../analytics/ChatLogTable';
import SessionsTable from '../analytics/SessionsTable';
import MomentsTable from '../analytics/MomentsTable';
import TurnsTable from '../analytics/TurnsTable';
import CaseInsightsPanel from '../analytics/CaseInsightsPanel';
import ScenarioRepository from './ScenarioRepository';
import { DEFAULT_TURNAROUND_MINUTES } from '../../constants/turnaround';
import BodyMapDebug from '../examination/BodyMapDebug';
import LabInvestigationEditor from './LabInvestigationEditor';
import RadiologyEditor from './RadiologyEditor';
import ClinicalRecordsEditor from './ClinicalRecordsEditor';
import PhysicalExamEditor from './PhysicalExamEditor';
import LabTestManager from './LabTestManager';
import UsersWorkspace from './users/UsersWorkspace';
import RegistrationPolicySettings from './RegistrationPolicySettings';
import MedicationManager from './MedicationManager';
import AgentTemplateManager from './AgentTemplateManager';
import CaseTreatmentConfig from './CaseTreatmentConfig';
import VoiceSettingsTab from './VoiceSettingsTab';
import AffectRoutingTab from './AffectRoutingTab';
import AvatarsSettingsTab from './AvatarsSettingsTab';
import NotificationsSettingsTab from './NotificationsSettingsTab';
import OyonSettingsTab from './OyonSettingsTab';
import OyonDataLogs from '../analytics/OyonDataLogs';
import CohortsManagementTab from './CohortsManagementTab';
import TnaDashboardV2 from '../analytics/tna/TnaDashboardV2';
import { Bell as BellIcon, BookOpen } from 'lucide-react';

// Lazy-loaded so the TipTap/react-query editor bundle only loads when a teacher
// opens the Lessons tab — keeps it out of the main app chunk.
const LessonAuthoring = lazy(() => import('../lessons/LessonAuthoring'));
import CaseAvatarVoicePicker from './CaseAvatarVoicePicker';
import { LANGUAGES } from '../../i18n/languages';
import { LLM_PROVIDERS, defaultModelFor } from '../../services/llmCatalogue';
import ModelSelect from './ModelSelect';
import { friendlyLlmError } from '../../utils/llmErrorMessage';
import { SCENARIO_TEMPLATES, scaleScenarioTimeline } from '../../data/scenarioTemplates';

// Bug 1 (16.5.2026): the old "Open Body Map Editor" button linked out to
// /?debug=bodymap, an auth-bypassing branch deliberately gated to
// import.meta.env.DEV (App.jsx) — so in any production build it just
// reloaded the app and the editor never opened. This inline editor runs
// the same BodyMapDebug surface INSIDE the already-admin-gated settings
// tab, so it works in production without re-exposing the unauthenticated
// URL flag. Self-contained so its hooks don't perturb ConfigPanel's
// top-level hook order.
export function InlineBodyMapEditor() {
    const { t } = useTranslation('authoring_config');
    const [open, setOpen] = useState(false);
    const [gender, setGender] = useState('male');
    const [view, setView] = useState('anterior');

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white rounded transition-colors"
            >
                <Image className="w-4 h-4" />
                {t('bodymap_open_editor')}
            </button>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="bg-neutral-900 text-white p-2 rounded border border-neutral-700"
                >
                    <option value="male">{t('gender_male')}</option>
                    <option value="female">{t('gender_female')}</option>
                </select>
                <select
                    value={view}
                    onChange={(e) => setView(e.target.value)}
                    className="bg-neutral-900 text-white p-2 rounded border border-neutral-700"
                >
                    <option value="anterior">{t('bodymap_view_anterior')}</option>
                    <option value="posterior">{t('bodymap_view_posterior')}</option>
                </select>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded transition-colors"
                >
                    <X className="w-4 h-4" />
                    {t('bodymap_close_editor')}
                </button>
            </div>
            <div className="bg-slate-900 rounded-lg overflow-hidden">
                <BodyMapDebug gender={gender} view={view} />
            </div>
        </div>
    );
}

// --- Sidebar nav model (flat, grouped by theme) ---------------------------
// This is pure nav-chrome: tab ids, per-tab role gating, and the content-area
// panel switch are all unchanged. The ~16 setting tabs are grouped under
// static theme labels. The groups used to be a collapsible accordion with
// localStorage-persisted open state; that was retired (operator feedback
// 2026-07-03: collapsing whole sections behind headers was impractical) —
// every item is now always visible.

// One sidebar tab button.
function NavItem({ item, active, onSelect }) {
    const Icon = item.icon;
    return (
        <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`rohy-settings-nav-item ${active ? 'rohy-settings-nav-item--active' : ''}`}
        >
            <Icon className={item.iconClass ? `w-4 h-4 ${item.iconClass}` : 'w-4 h-4'} /> {item.label}
        </button>
    );
}

// Static group header: uppercase theme label (not interactive).
function NavGroupLabel({ group }) {
    return <div className="rohy-settings-nav-group">{group}</div>;
}

const SETTINGS_CARD_COPY = {
    cases: {
        description: 'Build, review, import, and launch simulation cases.',
        accent: 'from-sky-500 to-cyan-500',
        metric: 'Case library',
    },
    scenarios: {
        description: 'Reusable clinical timelines for case progression.',
        accent: 'from-amber-500 to-orange-500',
        metric: 'Timeline design',
    },
    agents: {
        description: 'Configure clinical team personas and agent templates.',
        accent: 'from-violet-500 to-fuchsia-500',
        metric: 'Persona layer',
    },
    avatars: {
        description: 'Manage visual identities for patients and team roles.',
        accent: 'from-rose-500 to-pink-500',
        metric: 'Visual identity',
    },
    voice: {
        description: 'Tune speech, provider, and voice behavior.',
        accent: 'from-indigo-500 to-blue-500',
        metric: 'Voice runtime',
    },
    users: {
        description: 'Create users, import rosters, and run bulk actions.',
        accent: 'from-emerald-500 to-teal-500',
        metric: 'Identity ops',
    },
    cohorts: {
        description: 'Manage courses, enrollment, reports, and registration codes.',
        accent: 'from-teal-500 to-cyan-500',
        metric: 'Course ops',
    },
    analytics: {
        description: 'Review activity, logs, course signals, and learning traces.',
        accent: 'from-purple-500 to-indigo-500',
        metric: 'Evidence layer',
    },
    oyon: {
        description: 'Configure gaze/emotion capture and student consent surfaces.',
        accent: 'from-lime-500 to-emerald-500',
        metric: 'Capture stack',
    },
    bodymap: {
        description: 'Edit physical exam body regions and body map assets.',
        accent: 'from-orange-500 to-red-500',
        metric: 'Exam mapping',
    },
    labdb: {
        description: 'Curate lab references, templates, and turnaround behavior.',
        accent: 'from-blue-500 to-sky-500',
        metric: 'Lab catalogue',
    },
    medications: {
        description: 'Maintain medication catalogues and treatment metadata.',
        accent: 'from-green-500 to-emerald-500',
        metric: 'Medication library',
    },
    platform: {
        description: 'Control global runtime, defaults, AI, and monitor settings.',
        accent: 'from-slate-600 to-slate-900',
        metric: 'System control',
    },
    notifications: {
        description: 'Manage notification preferences and operational alerts.',
        accent: 'from-yellow-500 to-amber-500',
        metric: 'Alerting',
    },
    logs: {
        description: 'Inspect system, activity, chat, session, and audit logs.',
        accent: 'from-zinc-500 to-stone-700',
        metric: 'Audit trail',
    },
};

function SettingsOverviewCard({ item, group, onSelect, featured = false }) {
    const { t } = useTranslation('authoring_config');
    const Icon = item.icon;
    const copy = SETTINGS_CARD_COPY[item.id] || {};
    return (
        <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`group relative flex min-h-[104px] flex-col rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg ${
                featured ? 'md:col-span-2 xl:col-span-1' : ''
            }`}
        >
            <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${copy.accent || 'from-slate-500 to-slate-800'}`} />
            <div className="flex items-start justify-between gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-800 ring-1 ring-slate-200 transition-colors group-hover:bg-slate-950 group-hover:text-white">
                    <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="max-w-[46%] truncate rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">
                    {group}
                </span>
            </div>
            <div className="mt-2 min-w-0 flex-1">
                <h4 className="text-sm font-black tracking-tight text-slate-950">{item.label}</h4>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    {t([`card_${item.id}_desc`, 'card_default_desc'])}
                </p>
            </div>
            <span className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-teal-700 opacity-0 transition-opacity group-hover:opacity-100">
                {t('card_open', { metric: t([`card_${item.id}_metric`, 'card_default_metric']) })}
            </span>
        </button>
    );
}

function SettingsOverview({ sections, onSelect }) {
    const { t } = useTranslation('authoring_config');
    const visibleSections = sections
        .map(({ group, items }) => ({ group, items: items.filter((item) => item.visible) }))
        .filter(({ items }) => items.length > 0);

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <h3 className="text-2xl font-black tracking-tight text-slate-950">{t('overview_control_center')}</h3>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-black text-slate-950">{t('overview_settings_areas')}</h3>
                        <p className="text-sm text-slate-500">{t('overview_settings_subtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => onSelect('cases')}
                        className="rounded-xl border border-slate-200 bg-slate-950 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
                    >
                        {t('overview_go_to_cases')}
                    </button>
                </div>

                <div className="grid gap-3">
                    {visibleSections.map(({ group, items }) => (
                        <fieldset key={group} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3 pt-2">
                            <legend className="ml-2 px-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                                {group}
                            </legend>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                                {items.map((item) => (
                                    <SettingsOverviewCard key={item.id} item={item} group={group} onSelect={onSelect} />
                                ))}
                            </div>
                        </fieldset>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function ConfigPanel({ onClose, onLoadCase, fullPage = false, initialTab = 'overview', initialWizardStep = 1, onOpenPersonaEditor, onCaseSaved }) {
    const { t } = useTranslation('authoring_config');
    const { isAdmin, user } = useAuth();
    // Educator+ gate for the Analytics tab (formerly split into an admin-only
    // "Case Analytics" and an educator+ "Emotion & Attention" Oyon tab — the
    // Oyon analysis views now live inside the Analytics dashboard, so
    // educators keep their access through this gate). Server still enforces
    // the real rules per endpoint; this only hides the sidebar item.
    const canSeeAnalytics = user?.role === 'educator' || user?.role === 'admin';
    // Same educator+/admin gate as Oyon analytics. Server enforces the real
    // rule on /cohorts; this only hides the sidebar item. Teachers see/manage
    // their own cohorts, admins see all (the API decides which rows return).
    const canManageCohorts = user?.role === 'educator' || user?.role === 'admin';
    const toast = useToast();
    // Default to 'cases' tab for all users; the parent can pass `initialTab`
    // to land directly on a specific tab — used when the persona editor
    // closes back into ConfigPanel and we want to land on 'agents' or back
    // on a specific case wizard step.
    const [activeTab, setActiveTab] = useState(initialTab); // cases, users, history, logs, platform, scenarios
    const [wizardInitialStep, setWizardInitialStep] = useState(initialWizardStep);

    // Cases State
    const [cases, setCases] = useState([]);
    const [, setSelectedCaseId] = useState(null);
    // Course → cases browsing: GET /cases carries each case's course
    // (course_name via the one-case⇄one-course join). Courses render
    // alphabetically; cases without a course collect in a trailing
    // "Unassigned" group (educator-only in enforced installs — students
    // never see unassigned cases there).
    const caseGroups = useMemo(() => {
        const byCourse = new Map();
        for (const c of cases) {
            const key = c.course_name || '';
            if (!byCourse.has(key)) byCourse.set(key, []);
            byCourse.get(key).push(c);
        }
        const named = [...byCourse.keys()]
            .filter(k => k !== '')
            .sort((a, b) => a.localeCompare(b))
            .map(name => ({ key: name, name, cases: byCourse.get(name) }));
        return byCourse.has('')
            ? [...named, { key: '__unassigned', name: null, cases: byCourse.get('') }]
            : named;
    }, [cases]);
    // Stash shape: { _stashedAt: ISO string, _caseId: number|'new', ...rest of editingCase }.
    // The _stashedAt + _caseId let the wizard show a "Resumed draft from X"
    // banner so admins know this isn't a fresh open from the server.
    const [editingCase, setEditingCase] = useState(() => {
        const savedCase = localStorage.getItem('rohy_editing_case');
        if (savedCase) {
            try {
                const parsed = JSON.parse(savedCase);
                console.log('Restored case from auto-save:', parsed.name);
                return parsed;
            } catch (e) {
                console.warn('Failed to restore auto-saved case:', e);
            }
        }
        return null;
    });
    const [resumedFromStash, setResumedFromStash] = useState(() => {
        // Mark the initial editingCase value as "resumed" so the wizard can
        // surface that to the admin. Cleared as soon as admin makes any edit.
        return !!localStorage.getItem('rohy_editing_case');
    });
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);

    // Auto-save editing case to localStorage. Stash carries _stashedAt and
    // _caseId so a later mount can prove provenance.
    useEffect(() => {
        if (editingCase) {
            const stash = {
                ...editingCase,
                _stashedAt: new Date().toISOString(),
                _caseId: editingCase.id || 'new'
            };
            localStorage.setItem('rohy_editing_case', JSON.stringify(stash));
            setHasUnsavedChanges(true);
            setLastSavedAt(new Date());
        }
    }, [editingCase]);

    const discardDraft = () => {
        localStorage.removeItem('rohy_editing_case');
        setEditingCase(null);
        setResumedFromStash(false);
        setHasUnsavedChanges(false);
    };

    // Warn before leaving with unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (editingCase && hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = t('unsaved_leave');
                return e.returnValue;
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [editingCase, hasUnsavedChanges]);

    // Clear auto-save after successful save
    const clearAutoSave = () => {
        localStorage.removeItem('rohy_editing_case');
        setHasUnsavedChanges(false);
    };

    // Case↔course assignment (educator+ only). caseCourseMap: caseId →
    // {cohortId, cohortName}; courseOptions: the educator's manageable
    // courses. Both load quietly — the Course menu simply stays hidden/empty
    // when either call fails.
    const [caseCourseMap, setCaseCourseMap] = useState({});
    const [courseOptions, setCourseOptions] = useState([]);

    const loadCaseAssignments = () => {
        listCaseAssignments()
            .then(res => {
                const rows = Array.isArray(res) ? res : res?.data || [];
                setCaseCourseMap(Object.fromEntries(rows.map(r =>
                    [r.caseId, { cohortId: r.cohortId, cohortName: r.cohortName }])));
            })
            .catch(err => console.error('Failed to load case assignments', err));
    };

    useEffect(() => {
        if (!canManageCohorts) return;
        listCohorts()
            .then(res => setCourseOptions(Array.isArray(res) ? res : res?.cohorts || []))
            .catch(err => console.error('Failed to load courses', err));
        loadCaseAssignments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canManageCohorts]);

    const handleAssignCaseCourse = async (caseId, value) => {
        const cohortId = value === '' ? null : Number(value);
        try {
            await assignCaseCourse(caseId, cohortId);
        } catch (err) {
            console.error('Failed to assign course:', err);
            toast.error(t('toast_course_assign_failed', { defaultValue: 'Could not update the course assignment.' }));
        }
        loadCaseAssignments();
        // Re-fetch the catalog too: the list is grouped by course_name, so the
        // reassigned case has to move into its new group.
        try {
            const data = await apiFetch('/cases');
            setCases(data.cases || []);
        } catch (err) {
            console.error('Failed to refresh cases after course change', err);
        }
    };

    // Load Cases on Mount
    useEffect(() => {
        apiFetch('/cases')
            .then(data => {
                setCases(data.cases || []);
                if (data.cases?.length > 0) setSelectedCaseId(data.cases[0].id);
            })
            .catch(err => console.error("Failed to load cases", err));
    }, []);

    // Returns true on a successful save and false on validation/network failure
    // so callers can gate post-save UX (like the cancel-dialog close) on whether
    // the persistence actually completed.
    const handleSaveCase = async () => {
        if (!editingCase) return false;

        // Validate required fields
        if (!editingCase.name || editingCase.name.trim() === '') {
            toast.warning(t('toast_enter_case_name'));
            return false;
        }

        const isUpdate = !!editingCase.id;
        const path = isUpdate ? `/cases/${editingCase.id}` : '/cases';

        // Auto-generate system prompt if empty
        const sysPrompt = editingCase.system_prompt || `You are ${editingCase.name}. ${editingCase.description}`;

        // Ensure config exists
        const config = editingCase.config || {};

        const payload = {
            ...editingCase,
            system_prompt: sysPrompt,
            config: config,
            description: editingCase.description || '',
            scenario: editingCase.scenario || null  // Explicitly include scenario
        };

        console.log('[ConfigPanel] Saving case with scenario:', editingCase.scenario ? 'present' : 'null');

        console.log('Saving case:', { isUpdate, path, payload: { ...payload, config: 'omitted for brevity' } });

        try {
            const saved = isUpdate ? await apiPut(path, payload) : await apiPost(path, payload);
            console.log('Case saved successfully:', saved);

            // Stage-2 audit: bulk-replace labs in one atomic call. Pre-fix
            // this looped POST per lab with a "first delete" comment that was
            // never implemented, so the DB accumulated a duplicate row for
            // every saved-but-removed lab. PUT /cases/:id/labs deletes orphaned
            // investigation_orders, drops the old lab rows, and reinserts the
            // current array under one transaction.
            const caseId = saved.id;
            const labs = editingCase.config?.investigations?.labs || [];
            try {
                await apiPut(`/cases/${caseId}/labs`, { labs });
            } catch (labErr) {
                console.error('Failed to replace labs:', labErr);
            }

            // Update List
            if (isUpdate) {
                setCases(prev => prev.map(c => c.id === saved.id ? saved : c));
            } else {
                setCases(prev => [saved, ...prev]);
                // For new cases, update editingCase with the new ID so subsequent saves are updates
                setEditingCase(prev => ({ ...prev, id: saved.id }));
            }

            setSelectedCaseId(saved.id);

            // Notify the parent (App.jsx) so the in-memory `activeCase`
            // can be refreshed if the admin just saved the case currently
            // loaded in the chat tab. Without this, edits to per-case
            // settings (most importantly `config.voice.case_voice`) stay
            // invisible to the running session until the admin manually
            // re-opens the case from the case list.
            onCaseSaved?.(saved);

            // Clear auto-save after successful database save
            clearAutoSave();

            toast.success(t('toast_case_saved'));
            return true;

        } catch (err) {
            console.error(err);
            toast.error(err.message || t('toast_save_failed'));
            return false;
        }
    };

    const handleDeleteCase = async (caseId) => {
        const confirmed = await toast.confirm(t('confirm_delete_case'), { title: t('confirm_delete_case_title'), type: 'danger', confirmText: t('confirm_delete_text') });
        if (!confirmed) return;

        try {
            await apiDelete(`/cases/${caseId}`);

            setCases(prev => prev.filter(c => c.id !== caseId));
            toast.success(t('toast_case_deleted'));
        } catch (err) {
            console.error(err);
            toast.error(t('toast_delete_failed'));
        }
    };

    const uploadBodyImage = (file, type) => {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('type', type);
        return apiFetch('/upload-body-image', {
            method: 'POST',
            body: formData,
        });
    };

    // Sidebar tab model. Each item carries the EXACT per-tab role gate that
    // existed as an inline `isAdmin()` / `canManageCohorts` / `canSeeOyonAnalytics`
    // guard before this refactor — see `visible`. A group whose items are all
    // hidden is not rendered (see the sidebar map below). Tab ids are unchanged.
    const admin = isAdmin();
    // Ordered by how often each tab is actually reached for: the everyday
    // surfaces (cases, agents, people, analytics, capture) lead; the
    // set-up-once reference catalogues (Body Map editor, Lab Database,
    // Medications) sit in Libraries near the bottom, above System.
    const SECTIONS = [
        {
            group: t('group_content'),
            items: [
                { id: 'cases', label: admin ? t('tab_cases') : t('tab_select_case'), icon: FileText, visible: true },
                { id: 'scenarios', label: t('tab_scenarios'), icon: Layers, visible: admin },
            ],
        },
        {
            group: t('group_agents_voice'),
            items: [
                { id: 'agents', label: t('tab_agents'), icon: Users, visible: admin },
                { id: 'avatars', label: t('tab_avatars'), icon: Image, visible: admin },
                { id: 'voice', label: t('tab_voice'), icon: Mic, visible: admin },
                { id: 'affect', label: t('tab_affect'), icon: ScanFace, visible: admin },
            ],
        },
        {
            group: t('group_people'),
            items: [
                { id: 'users', label: t('tab_users'), icon: Users, visible: admin },
                { id: 'cohorts', label: t('tab_courses'), icon: Users, visible: canManageCohorts },
                { id: 'lessons', label: t('tab_lessons', { defaultValue: 'Lessons' }), icon: BookOpen, visible: canManageCohorts },
            ],
        },
        {
            group: t('group_analytics'),
            items: [
                { id: 'analytics', label: t('tab_analytics'), icon: Activity, visible: canSeeAnalytics },
                { id: 'oyon', label: t('tab_oyon'), icon: Camera, visible: true },
                { id: 'logs', label: t('tab_logs'), icon: ClipboardList, visible: admin },
            ],
        },
        {
            group: t('group_libraries'),
            items: [
                { id: 'bodymap', label: t('tab_bodymap'), icon: Image, visible: admin },
                { id: 'labdb', label: t('tab_labdb'), icon: Database, visible: admin },
                { id: 'medications', label: t('tab_medications'), icon: Database, visible: admin },
            ],
        },
        {
            group: t('group_system'),
            items: [
                { id: 'platform', label: t('tab_platform'), icon: Settings, visible: admin },
                { id: 'notifications', label: t('tab_notifications'), icon: BellIcon, visible: true },
            ],
        },
    ];

    return (
        <div className={`rohy-admin-light flex flex-col h-full ${fullPage ? '' : 'rounded-xl'} overflow-hidden`}>

            {/* Header */}
            <div className="rohy-admin-header flex items-center justify-between px-6 py-4 border-b border-neutral-800 relative">
                <div className="flex items-center gap-3">
                    {/* The gear doubles as a "home" button — clicking it returns
                        to the simulation (same as ✕ / the Simulation nav item).
                        It was previously an inert <span>. */}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('nav_simulation')}
                        title={t('nav_simulation')}
                        className="rohy-admin-brand-mark cursor-pointer transition-transform hover:scale-105 active:scale-95"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                    <div className="flex flex-col leading-tight">
                        <h2 className="text-[0.9375rem] font-bold tracking-tight text-gray-900">
                            {fullPage ? t('header_title_fullpage') : t('header_title_compact')}
                        </h2>
                        <span className="text-xs text-gray-500 font-medium">
                            {fullPage ? t('header_subtitle_fullpage') : t('header_subtitle_compact')}
                        </span>
                    </div>
                </div>
                {fullPage && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="rohy-subtle-button px-3.5 py-2 rounded-lg flex items-center gap-2"
                    >
                        <X className="w-4 h-4" />
                        {t('header_back_to_sim')}
                    </button>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">

                {/* Sidebar — flat list grouped under static theme labels.
                    Simulation stays pinned on top (it's not a tab, it exits
                    back to the running sim); the grouped tabs follow. Per-tab
                    role gating lives on each SECTIONS item's `visible`; a
                    group with no visible items renders neither its label nor
                    body. */}
                <div className="rohy-admin-sidebar w-48 min-h-0 overflow-y-auto border-r border-neutral-800 flex flex-col py-3">
                    {/* Simulation — not a tab: returns to the running simulation. */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="rohy-settings-nav-item"
                    >
                        <Monitor className="w-4 h-4" /> {t('nav_simulation')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('overview')}
                        className={`rohy-settings-nav-item ${activeTab === 'overview' ? 'rohy-settings-nav-item--active' : ''}`}
                    >
                        <Settings className="w-4 h-4" /> {t('nav_overview')}
                    </button>
                    {SECTIONS.map(({ group, items }) => {
                        const visibleItems = items.filter((item) => item.visible);
                        if (visibleItems.length === 0) return null;
                        return (
                            <div key={group}>
                                <NavGroupLabel group={group} />
                                {visibleItems.map((item) => (
                                    <NavItem
                                        key={item.id}
                                        item={item}
                                        active={activeTab === item.id}
                                        onSelect={setActiveTab}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>

                {/* Content Area */}
                <div className="rohy-admin-page flex-1 p-8 overflow-y-auto">

                    {/* --- TEMP SETTINGS OVERVIEW --- Card-page prototype; all existing tabs remain unchanged. */}
                    {activeTab === 'overview' && (
                        <SettingsOverview
                            sections={SECTIONS}
                            onSelect={setActiveTab}
                        />
                    )}

                    {/* --- ANALYTICS TAB (educator+) --- TNA dashboard embedded inside settings */}
                    {activeTab === 'analytics' && canSeeAnalytics && (
                        <TnaDashboardV2 embedded={true} />
                    )}

                    {/* --- CASES TAB --- */}
                    {activeTab === 'cases' && (
                        <div className="space-y-6">

                            {!editingCase ? (
                                <>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-lg font-bold">{isAdmin() ? t('cases_manage') : t('cases_available')}</h3>
                                        <div className="flex gap-2">
                                            {isAdmin() && (
                                                <>
                                                    <button
                                                        onClick={() => setEditingCase({ name: '', description: '', config: { pages: [] } })}
                                                        className="rohy-btn rohy-btn-primary"
                                                    >
                                                        <Plus className="w-4 h-4" /> {t('btn_new_case')}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const input = document.createElement('input');
                                                            input.type = 'file';
                                                            input.accept = '.json';
                                                            input.onchange = async (e) => {
                                                                const file = e.target.files[0];
                                                                if (!file) return;

                                                                try {
                                                                    const text = await file.text();
                                                                    const caseData = JSON.parse(text);

                                                                    // Validate
                                                                    if (!caseData.name || !caseData.description) {
                                                                        throw new Error(t('err_invalid_case_file'));
                                                                    }

                                                                    await apiPost('/cases', caseData);
                                                                    toast.success(t('toast_case_imported'));
                                                                    const data = await apiFetch('/cases');
                                                                    setCases(data.cases || []);
                                                                } catch (err) {
                                                                    toast.error(t('toast_import_failed', { error: err.message }));
                                                                }
                                                            };
                                                            input.click();
                                                        }}
                                                        className="rohy-btn rohy-btn-secondary"
                                                        title={t('import_title')}
                                                    >
                                                        <FileUp className="w-4 h-4" /> {t('btn_import')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Case Stats */}
                                    {isAdmin() && (
                                        <div className="grid grid-cols-3 gap-3 mb-4">
                                            <div className="rohy-stat-card rounded-lg p-3 text-center">
                                                <div className="text-xl font-bold text-gray-900">{cases.length}</div>
                                                <div className="text-xs text-gray-600">{t('stat_total_cases')}</div>
                                            </div>
                                            <div className="rohy-stat-card rohy-stat-card-accent rounded-lg p-3 text-center">
                                                <div className="text-xl font-bold text-blue-700">{cases.filter(c => c.is_available).length}</div>
                                                <div className="text-xs text-gray-700">{t('stat_available')}</div>
                                            </div>
                                            <div className="rohy-stat-card rounded-lg p-3 text-center">
                                                <div className="text-xl font-bold text-gray-700">{cases.filter(c => !c.is_available).length}</div>
                                                <div className="text-xs text-gray-600">{t('stat_hidden')}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-5">
                                        {caseGroups.map(group => (
                                        <div key={group.key}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-sm font-bold text-gray-800">
                                                {group.name ?? t('course_group_unassigned')}
                                            </span>
                                            <span className="text-xs text-gray-500">({group.cases.length})</span>
                                        </div>
                                        <div className="grid gap-3">
                                        {group.cases.map(c => (
                                            <div key={c.id} className={`rohy-card p-4 rounded-lg flex justify-between items-center ${c.is_default ? 'rohy-card-active' : ''}`}>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        {/* Prominent language chip — flag + native language name,
                                                            placed at the FRONT so students can scan the list by
                                                            language. The case's own immutable language, independent
                                                            of the UI language. Flag stays in its own text node so it
                                                            reads as a single emoji. */}
                                                        {LANGUAGES[c.config?.case_language] && (
                                                            <span
                                                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-300 bg-gray-50 text-sm font-semibold text-gray-800"
                                                                title={LANGUAGES[c.config.case_language].name}
                                                            >
                                                                <span className="text-lg leading-none" aria-hidden="true">{LANGUAGES[c.config.case_language].flag}</span>
                                                                <span>{LANGUAGES[c.config.case_language].native}</span>
                                                            </span>
                                                        )}
                                                        <span className="font-bold text-gray-900">{c.name}</span>
                                                        {c.case_code && (
                                                            <span
                                                                className="px-2 py-0.5 font-mono text-xs rounded border bg-gray-100 text-gray-700 border-gray-300"
                                                                title={t('case_code_title')}
                                                            >
                                                                {c.case_code}
                                                            </span>
                                                        )}
                                                        {c.is_default && (
                                                            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded border border-green-300">{t('badge_default')}</span>
                                                        )}
                                                        {isAdmin() && (
                                                            <span className={`px-2 py-0.5 text-xs rounded border ${c.is_available ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                                                                {c.is_available ? t('badge_available') : t('badge_hidden')}
                                                            </span>
                                                        )}
                                                        {/* Active-use indicator. Edits to this case will be live to
                                                            anyone running it — admins ought to know before they
                                                            start changing prompts/vitals mid-simulation. */}
                                                        {isAdmin() && c.active_session_count > 0 && (
                                                            <span
                                                                className="px-2 py-0.5 text-xs rounded border bg-orange-100 text-orange-800 border-orange-300"
                                                                title={t('badge_live_title', { count: c.active_session_count })}
                                                            >
                                                                ⚡ {t('badge_live', { count: c.active_session_count })}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-gray-600">{c.description}</div>
                                                </div>
                                                <div className="flex gap-2 items-center">
                                                    {/* Educator+: Course assignment */}
                                                    {canManageCohorts && (
                                                        <label className="flex items-center gap-1.5 text-xs text-gray-600" title={t('title_case_course', { defaultValue: 'Course this case is assigned to' })}>
                                                            <span>{t('label_case_course', { defaultValue: 'Course' })}</span>
                                                            <select
                                                                value={caseCourseMap[c.id]?.cohortId ?? ''}
                                                                onChange={(e) => handleAssignCaseCourse(c.id, e.target.value)}
                                                                className="rohy-input px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-800 max-w-[10rem]"
                                                            >
                                                                <option value="">{t('option_course_none', { defaultValue: '— none —' })}</option>
                                                                {courseOptions.map(co => (
                                                                    <option key={co.id} value={co.id}>{co.name}</option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                    )}
                                                    {/* Admin: Availability Toggle */}
                                                    {isAdmin() && (
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    await apiPut(`/cases/${c.id}/availability`, { is_available: !c.is_available });
                                                                    const data = await apiFetch('/cases');
                                                                    setCases(data.cases || []);
                                                                } catch (err) {
                                                                    console.error('Failed to toggle availability:', err);
                                                                }
                                                            }}
                                                            className={`px-2 py-1 text-xs rounded border ${c.is_available ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' : 'rohy-subtle-button'}`}
                                                            title={c.is_available ? t('title_hide_students') : t('title_show_students')}
                                                        >
                                                            {c.is_available ? t('btn_hide') : t('btn_show')}
                                                        </button>
                                                    )}
                                                    {/* Admin: Set as Default */}
                                                    {isAdmin() && !c.is_default && (
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    await apiPut(`/cases/${c.id}/default`, { is_default: true });
                                                                    const data = await apiFetch('/cases');
                                                                    setCases(data.cases || []);
                                                                } catch (err) {
                                                                    console.error('Failed to set default:', err);
                                                                }
                                                            }}
                                                            className="px-2 py-1 text-xs rounded border bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                                                            title={t('title_set_default')}
                                                        >
                                                            {t('btn_set_default')}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            if (onLoadCase) onLoadCase(c);
                                                            if (onClose) onClose();
                                                        }}
                                                        className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-bold text-white shadow-lg shadow-green-900/20"
                                                    >
                                                        {t('btn_load')}
                                                    </button>
                                                    {/* Export - Admin only */}
                                                    {isAdmin() && (
                                                        <button
                                                            onClick={() => {
                                                                // Export case to JSON
                                                                const caseJSON = {
                                                                    version: '1.0',
                                                                    exportedAt: new Date().toISOString(),
                                                                    ...c
                                                                };
                                                                // Remove database ID + stamped code for portability
                                                                // (an import is a new case and gets its own code).
                                                                delete caseJSON.id;
                                                                delete caseJSON.case_code;

                                                                const json = JSON.stringify(caseJSON, null, 2);
                                                                const blob = new Blob([json], { type: 'application/json' });
                                                                const url = window.URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                a.href = url;
                                                                a.download = `case-${c.name.replace(/\s+/g, '-').toLowerCase()}.json`;
                                                                document.body.appendChild(a);
                                                                a.click();
                                                                document.body.removeChild(a);
                                                                window.URL.revokeObjectURL(url);
                                                            }}
                                                            className="p-2 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white"
                                                            title={t('title_export_json')}
                                                        >
                                                            <FileDown className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {isAdmin() && (
                                                        <>
                                                            <button onClick={() => {
                                                                // Clear auto-save to ensure fresh load from database
                                                                localStorage.removeItem('rohy_editing_case');
                                                                console.log('[ConfigPanel] Editing case:', c.name, 'scenario:', c.scenario ? 'present' : 'null');
                                                                setEditingCase(c);
                                                            }} className="rohy-subtle-button p-2 rounded text-xs">{t('btn_edit')}</button>
                                                            <button
                                                                onClick={() => {
                                                                    // Duplicate case - create a copy without ID
                                                                    const duplicatedCase = {
                                                                        ...c,
                                                                        name: `${c.name} (Copy)`,
                                                                        id: undefined // Remove ID so it creates a new case
                                                                    };
                                                                    delete duplicatedCase.id;
                                                                    // The copy gets its own server-stamped code.
                                                                    delete duplicatedCase.case_code;
                                                                    localStorage.removeItem('rohy_editing_case');
                                                                    console.log('[ConfigPanel] Duplicating case:', c.name);
                                                                    setEditingCase(duplicatedCase);
                                                                    toast.success(t('toast_duplicated', { name: c.name }));
                                                                }}
                                                                className="p-2 bg-teal-100 text-teal-700 border border-teal-200 rounded text-xs hover:bg-teal-200"
                                                                title={t('title_duplicate')}
                                                            >
                                                                <Copy className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleDeleteCase(c.id)} className="p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs hover:bg-red-100">{t('btn_delete')}</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        </div>
                                        </div>
                                        ))}
                                        {cases.length === 0 && (
                                            <div className="text-neutral-500 text-center py-8">
                                                {isAdmin() ? t('empty_no_cases_admin') : t('empty_no_cases_student')}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : isAdmin() ? (
                                /* CASE WIZARD - Admin only */
                                <CaseWizard
                                    caseData={editingCase}
                                    setCaseData={setEditingCase}
                                    setActiveTab={setActiveTab}
                                    initialStep={wizardInitialStep}
                                    onStepLoaded={() => setWizardInitialStep(1)}
                                    onOpenPersonaEditor={onOpenPersonaEditor}
                                    resumedFromStash={resumedFromStash}
                                    onDiscardDraft={discardDraft}
                                    onSave={handleSaveCase}
                                    onCancel={async () => {
                                        if (hasUnsavedChanges) {
                                            const action = await toast.confirm(
                                                t('confirm_unsaved_save'),
                                                { title: t('confirm_unsaved_title'), confirmText: t('confirm_save_exit'), cancelText: t('confirm_discard'), type: 'warning' }
                                            );
                                            if (action) {
                                                // Await the save so we don't close the dialog
                                                // while the request is still in flight; on
                                                // failure handleSaveCase surfaces a toast and
                                                // we keep the editor open with the draft intact.
                                                const ok = await handleSaveCase();
                                                if (ok) {
                                                    clearAutoSave();
                                                    setEditingCase(null);
                                                }
                                            } else {
                                                clearAutoSave();
                                                setEditingCase(null);
                                            }
                                        } else {
                                            clearAutoSave();
                                            setEditingCase(null);
                                        }
                                    }}
                                    hasUnsavedChanges={hasUnsavedChanges}
                                    lastSavedAt={lastSavedAt}
                                />
                            ) : null}

                        </div>
                    )}

                    {/* --- SCENARIOS TAB --- */}
                    {activeTab === 'scenarios' && (
                        <div className="space-y-4">
                            {!editingCase && (
                                <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-amber-300 font-medium">{t('scenario_no_case_selected')}</p>
                                        <p className="text-xs text-neutral-400">{t('scenario_no_case_help')}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditingCase({ name: '', description: '', config: { pages: [] } });
                                            setActiveTab('cases');
                                        }}
                                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold"
                                    >
                                        {t('btn_new_case_plus')}
                                    </button>
                                </div>
                            )}
                            {editingCase && (
                                <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
                                    <p className="text-sm text-green-300">
                                        {t('scenario_editing_prefix')} <strong>{editingCase.name || t('new_case_fallback')}</strong> {t('scenario_editing_suffix')}
                                    </p>
                                </div>
                            )}
                            <ScenarioRepository
                                onSelectScenario={(scenario) => {
                                    if (editingCase) {
                                        // Stage-5 audit: confirm before clobbering an existing case scenario.
                                        // Stage 2 added the same guard for the in-wizard scenario picker;
                                        // the repository import path was an outlier — drag-drop / double-click
                                        // / keyboard-pick all bypassed it. A typo or misclick here destroyed
                                        // the timeline silently.
                                        const existing = editingCase.scenario;
                                        const hasTimeline = existing && Array.isArray(existing.timeline) && existing.timeline.length > 0;
                                        if (hasTimeline) {
                                            const proceed = window.confirm(
                                                t('confirm_replace_timeline', { count: existing.timeline.length, name: scenario.name })
                                            );
                                            if (!proceed) return;
                                        }

                                        const scaledScenario = {
                                            enabled: true,
                                            autoStart: false,
                                            timeline: scenario.timeline
                                        };

                                        setEditingCase(prev => ({
                                            ...prev,
                                            scenario: scaledScenario,
                                            scenario_duration: scenario.duration_minutes,
                                            scenario_template: null,
                                            scenario_from_repository: {
                                                id: scenario.id,
                                                name: scenario.name
                                            }
                                        }));

                                        setWizardInitialStep(3);
                                        setActiveTab('cases');
                                        toast.success(t('toast_scenario_applied', { name: scenario.name }));
                                    } else {
                                        // Create new case with this scenario
                                        const scaledScenario = {
                                            enabled: true,
                                            autoStart: false,
                                            timeline: scenario.timeline
                                        };
                                        setEditingCase({
                                            name: '',
                                            description: '',
                                            config: { pages: [] },
                                            scenario: scaledScenario,
                                            scenario_duration: scenario.duration_minutes,
                                            scenario_from_repository: {
                                                id: scenario.id,
                                                name: scenario.name
                                            }
                                        });
                                        setActiveTab('cases');
                                        toast.success(t('toast_scenario_applied_new', { name: scenario.name }));
                                    }
                                }}
                            />
                        </div>
                    )}

                    {/* --- USER MANAGEMENT TAB (Admin Only) --- */}
                    {activeTab === 'users' && isAdmin() && (
                        <UsersWorkspace />
                    )}

                    {/* --- SYSTEM LOGS TAB (Admin Only) --- */}
                    {activeTab === 'logs' && isAdmin() && (
                        <SystemLogs />
                    )}

                    {/* --- PLATFORM SETTINGS TAB (Admin Only) --- */}
                    {activeTab === 'platform' && isAdmin() && (
                        <PlatformSettings cases={cases} setCases={setCases} />
                    )}

                    {/* --- LAB DATABASE TAB (Admin Only) --- */}
                    {activeTab === 'labdb' && isAdmin() && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                                <h3 className="text-lg font-bold">{t('labdb_title')}</h3>
                                <span className="text-xs text-neutral-500">{t('labdb_subtitle')}</span>
                            </div>
                            <LabTestManager />
                        </div>
                    )}

                    {/* --- MEDICATIONS TAB (Admin Only) --- */}
                    {activeTab === 'medications' && isAdmin() && (
                        <div className="space-y-6">
                            <MedicationManager />
                        </div>
                    )}

                    {/* --- BODY MAP EDITOR TAB (Admin Only) --- */}
                    {activeTab === 'bodymap' && isAdmin() && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                                <h3 className="text-lg font-bold">{t('bodymap_title')}</h3>
                                <span className="text-xs text-neutral-500">{t('bodymap_subtitle')}</span>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-neutral-800 rounded-lg p-4">
                                    <h4 className="font-medium mb-2">{t('bodymap_visual_editor')}</h4>
                                    <p className="text-sm text-neutral-400 mb-4">
                                        {t('bodymap_visual_help')}
                                    </p>
                                    <InlineBodyMapEditor />
                                </div>

                                <div className="bg-neutral-800 rounded-lg p-4">
                                    <h4 className="font-medium mb-2">{t('bodymap_images')}</h4>
                                    <p className="text-sm text-neutral-400 mb-4">
                                        {t('bodymap_images_help')}
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">{t('bodymap_male_front')}</label>
                                            <div className="flex gap-2">
                                                <img src="./man-front.png" alt="Male front" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'man-front')
                                                                .then(() => toast.success(t('toast_image_uploaded')))
                                                                .catch(err => toast.error(t('toast_upload_failed', { error: err.error || err.message })));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">{t('bodymap_male_back')}</label>
                                            <div className="flex gap-2">
                                                <img src="./man-back.png" alt="Male back" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'man-back')
                                                                .then(() => toast.success(t('toast_image_uploaded')))
                                                                .catch(err => toast.error(t('toast_upload_failed', { error: err.error || err.message })));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">{t('bodymap_female_front')}</label>
                                            <div className="flex gap-2">
                                                <img src="./woman-front.png" alt="Female front" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'woman-front')
                                                                .then(() => toast.success(t('toast_image_uploaded')))
                                                                .catch(err => toast.error(t('toast_upload_failed', { error: err.error || err.message })));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">{t('bodymap_female_back')}</label>
                                            <div className="flex gap-2">
                                                <img src="./woman-back.png" alt="Female back" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'woman-back')
                                                                .then(() => toast.success(t('toast_image_uploaded')))
                                                                .catch(err => toast.error(t('toast_upload_failed', { error: err.error || err.message })));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- AGENT PERSONAS TAB (Admin Only) --- */}
                    {activeTab === 'agents' && isAdmin() && (
                        <AgentTemplateManager onOpenEditor={onOpenPersonaEditor} />
                    )}

                    {/* --- AVATARS TAB (Admin Only) --- */}
                    {activeTab === 'avatars' && isAdmin() && (
                        <AvatarsSettingsTab />
                    )}

                    {/* --- VOICE TAB (Admin Only) --- */}
                    {activeTab === 'voice' && isAdmin() && (
                        <VoiceSettingsTab />
                    )}

                    {/* --- AFFECT ROUTING TAB (Admin Only) --- */}
                    {activeTab === 'affect' && isAdmin() && (
                        <AffectRoutingTab />
                    )}

                    {/* --- NOTIFICATIONS TAB (all users) --- */}
                    {activeTab === 'notifications' && (
                        <NotificationsSettingsTab />
                    )}

                    {/* --- OYON TAB (all users; admin section gated inside) --- */}
                    {activeTab === 'oyon' && (
                        <OyonSettingsTab onOpenAnalytics={canSeeAnalytics ? () => setActiveTab('analytics') : undefined} />
                    )}

                    {/* --- CLASSES (educator+ only; server enforces ownership/tenant) --- */}
                    {activeTab === 'cohorts' && canManageCohorts && (
                        <CohortsManagementTab />
                    )}

                    {activeTab === 'lessons' && canManageCohorts && (
                        <Suspense fallback={<div className="p-6 text-sm text-neutral-500">Loading…</div>}>
                            <LessonAuthoring />
                        </Suspense>
                    )}

                </div>
            </div>
        </div>
    );
}

// Platform Settings Component (Admin Only)
function PlatformSettings({ cases, setCases }) {
    const { t } = useTranslation('authoring_config');
    const [activeSection, setActiveSection] = useState('general');
    const [defaultCaseId, setDefaultCaseId] = useState(null);
    const [loading, setLoading] = useState(false);

    const sections = [
        { id: 'general', label: t('platform_section_general'), icon: Settings },
        { id: 'ai', label: t('platform_section_ai'), icon: Cpu },
        { id: 'users', label: t('platform_section_users'), icon: Users },
        { id: 'monitor', label: t('platform_section_monitor'), icon: Monitor }
    ];

    // Find the current default case
    useEffect(() => {
        const defaultCase = cases.find(c => c.is_default);
        if (defaultCase) {
            setDefaultCaseId(defaultCase.id);
        }
    }, [cases]);

    const handleSetDefault = async (caseId) => {
        setLoading(true);
        try {
            await apiPut(`/cases/${caseId}/default`, { is_default: true });
            const data = await apiFetch('/cases');
            setCases(data.cases || []);
            setDefaultCaseId(caseId);
        } catch (err) {
            console.error('Failed to set default case:', err);
        }
        setLoading(false);
    };

    const handleClearDefault = async () => {
        if (!defaultCaseId) return;
        setLoading(true);
        try {
            await apiPut(`/cases/${defaultCaseId}/default`, { is_default: false });
            const data = await apiFetch('/cases');
            setCases(data.cases || []);
            setDefaultCaseId(null);
        } catch (err) {
            console.error('Failed to clear default case:', err);
        }
        setLoading(false);
    };

    const availableCases = cases.filter(c => c.is_available);

    return (
        <div className="space-y-6">
            {/* Section Tabs */}
            <div className="flex gap-2 border-b border-neutral-700 pb-3">
                {sections.map(section => {
                    const Icon = section.icon;
                    return (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeSection === section.id
                                ? 'bg-neutral-800 text-cyan-400 border border-neutral-700 border-b-neutral-800 -mb-[13px]'
                                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            {section.label}
                        </button>
                    );
                })}
            </div>

            {/* General Section */}
            {activeSection === 'general' && (
                <div className="space-y-6">
                    {/* Default Case Selection */}
                    <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                        <h4 className="text-md font-bold text-green-400 mb-4 flex items-center gap-2">
                            <Activity className="w-5 h-5" />
                            {t('platform_default_case_title')}
                        </h4>
                        <p className="text-sm text-neutral-400 mb-4">
                            {t('platform_default_case_help')}
                        </p>
                        <select
                            value={defaultCaseId || ''}
                            onChange={(e) => {
                                const id = e.target.value;
                                if (id) handleSetDefault(parseInt(id));
                                else handleClearDefault();
                            }}
                            disabled={loading}
                            className="w-full max-w-md bg-neutral-800 border border-neutral-600 rounded p-3 text-sm focus:border-green-500 outline-none"
                        >
                            <option value="">{t('platform_no_default_case')}</option>
                            {availableCases.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {defaultCaseId && (
                            <p className="text-xs text-green-400 mt-2">
                                {t('platform_default_case_note', { name: cases.find(c => c.id === defaultCaseId)?.name })}
                            </p>
                        )}
                    </div>

                    {/* Chat Interface Configuration */}
                    <ChatConfiguration />
                </div>
            )}

            {/* AI/LLM Section */}
            {activeSection === 'ai' && (
                <div className="space-y-6">
                    <LLMConfiguration />
                </div>
            )}

            {/* Users Section */}
            {activeSection === 'users' && (
                <div className="space-y-6">
                    <RegistrationPolicySettings />
                    <UserFieldConfiguration />
                </div>
            )}

            {/* Monitor Section */}
            {activeSection === 'monitor' && (
                <div className="space-y-6">
                    <MonitorConfiguration />
                </div>
            )}
        </div>
    );
}

// User Profile Field Configuration Component
function UserFieldConfiguration() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [fieldConfig, setFieldConfig] = useState({
        name: { label: t('userfield_default_name'), required: true, enabled: true },
        institution: { label: t('userfield_default_institution'), required: false, enabled: true },
        address: { label: t('userfield_default_address'), required: false, enabled: true },
        phone: { label: t('userfield_default_phone'), required: false, enabled: true },
        alternative_email: { label: t('userfield_default_alternative_email'), required: false, enabled: true },
        education: { label: t('userfield_default_education'), required: false, enabled: true },
        grade: { label: t('userfield_default_grade'), required: false, enabled: true }
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadFieldConfig();
    }, []);

    const loadFieldConfig = async () => {
        try {
            const data = await apiFetch('/platform-settings/user-fields');
            if (data.config) {
                setFieldConfig(data.config);
            }
        } catch (error) {
            console.error('Failed to load field config:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFieldChange = (field, property, value) => {
        setFieldConfig(prev => ({
            ...prev,
            [field]: {
                ...prev[field],
                [property]: value
            }
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiPut('/platform-settings/user-fields', { config: fieldConfig });
            toast.success(t('toast_userfields_saved'));
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : t('toast_save_config_failed', { error: error.message }));
        } finally {
            setSaving(false);
        }
    };

    const fieldOrder = ['name', 'institution', 'address', 'phone', 'alternative_email', 'education', 'grade'];

    if (loading) {
        return (
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 bg-neutral-700 rounded w-1/3"></div>
                    <div className="h-4 bg-neutral-700 rounded w-2/3"></div>
                    <div className="space-y-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-12 bg-neutral-700 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
            <h4 className="text-md font-bold text-teal-400 mb-4 flex items-center gap-2">
                <User className="w-5 h-5" />
                {t('userfield_title')}
            </h4>
            <p className="text-sm text-neutral-400 mb-6">
                {t('userfield_help')}
            </p>

            <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-bold text-neutral-400 border-b border-neutral-700">
                    <div className="col-span-4">{t('userfield_col_field')}</div>
                    <div className="col-span-3">{t('userfield_col_label')}</div>
                    <div className="col-span-2 text-center">{t('userfield_col_enabled')}</div>
                    <div className="col-span-3 text-center">{t('userfield_col_required')}</div>
                </div>

                {/* Fields */}
                {fieldOrder.map(fieldKey => {
                    const config = fieldConfig[fieldKey];
                    if (!config) return null;

                    return (
                        <div
                            key={fieldKey}
                            className={`grid grid-cols-12 gap-4 items-center px-4 py-3 rounded-lg ${config.enabled ? 'bg-neutral-700/30' : 'bg-neutral-800/50 opacity-60'
                                }`}
                        >
                            <div className="col-span-4">
                                <span className="text-sm text-white font-medium capitalize">
                                    {fieldKey.replace(/_/g, ' ')}
                                </span>
                                {fieldKey === 'name' && (
                                    <span className="text-xs text-amber-400 ml-2">{t('userfield_always_required')}</span>
                                )}
                            </div>
                            <div className="col-span-3">
                                <input
                                    type="text"
                                    value={config.label}
                                    onChange={(e) => handleFieldChange(fieldKey, 'label', e.target.value)}
                                    className="w-full px-2 py-1.5 bg-neutral-800 border border-neutral-600 rounded text-sm text-white focus:border-teal-500 outline-none"
                                />
                            </div>
                            <div className="col-span-2 text-center">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.enabled}
                                        onChange={(e) => handleFieldChange(fieldKey, 'enabled', e.target.checked)}
                                        disabled={fieldKey === 'name'}
                                        className="sr-only peer"
                                    />
                                    <div className={`w-9 h-5 rounded-full peer-focus:ring-2 peer-focus:ring-teal-500 ${config.enabled ? 'bg-teal-600' : 'bg-neutral-600'
                                        } ${fieldKey === 'name' ? 'opacity-50 cursor-not-allowed' : ''} after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4`}></div>
                                </label>
                            </div>
                            <div className="col-span-3 text-center">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.required}
                                        onChange={(e) => handleFieldChange(fieldKey, 'required', e.target.checked)}
                                        disabled={fieldKey === 'name' || !config.enabled}
                                        className="sr-only peer"
                                    />
                                    <div className={`w-9 h-5 rounded-full peer-focus:ring-2 peer-focus:ring-red-500 ${config.required ? 'bg-red-600' : 'bg-neutral-600'
                                        } ${(fieldKey === 'name' || !config.enabled) ? 'opacity-50 cursor-not-allowed' : ''} after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4`}></div>
                                </label>
                                {config.required && config.enabled && (
                                    <span className="text-xs text-red-400 ml-2">*</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Save Button */}
            <div className="mt-6 pt-4 border-t border-neutral-700 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                >
                    {saving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('btn_saving')}
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            {t('btn_save_config')}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

// Provider catalog + model catalogue now live in the shared source of truth
// (src/services/llmCatalogue.js → server/shared/llmCatalogue.js). `keyPrefix`
// there is the expected start of API keys for that provider — a soft sanity
// check (warns if mismatched), not a blocker.

function validateLlmConfig(cfg, t) {
    const errs = [];
    const provider = LLM_PROVIDERS[cfg.provider] || LLM_PROVIDERS.lmstudio;

    if (!cfg.baseUrl || !/^https?:\/\//i.test(cfg.baseUrl.trim())) {
        errs.push({ field: 'baseUrl', message: t('err_base_url_scheme') });
    }
    if (cfg.baseUrl && /^sk-/i.test(cfg.baseUrl.trim())) {
        errs.push({ field: 'baseUrl', message: t('err_base_url_is_key') });
    }
    if (provider.needsKey) {
        if (!cfg.apiKey || !cfg.apiKey.trim()) {
            errs.push({ field: 'apiKey', message: t('err_provider_needs_key', { provider: provider.name }) });
        } else {
            if (/^https?:\/\//i.test(cfg.apiKey.trim())) {
                errs.push({ field: 'apiKey', message: t('err_key_is_url') });
            }
            if (provider.keyPrefix && !cfg.apiKey.trim().startsWith(provider.keyPrefix)) {
                errs.push({ field: 'apiKey', message: t('err_key_prefix', { prefix: provider.keyPrefix, provider: provider.name }), soft: true });
            }
        }
    }
    if (provider.modelRequired && (!cfg.model || !cfg.model.trim())) {
        errs.push({ field: 'model', message: t('err_provider_needs_model', { provider: provider.name }) });
    }
    if (cfg.maxOutputTokens && cfg.maxOutputTokens.trim()) {
        const n = parseInt(cfg.maxOutputTokens, 10);
        if (!Number.isFinite(n) || n < 1 || n > 200000) {
            errs.push({ field: 'maxOutputTokens', message: t('err_max_tokens') });
        }
    }
    if (cfg.temperature && cfg.temperature.trim()) {
        const t = parseFloat(cfg.temperature);
        if (!Number.isFinite(t) || t < 0 || t > 2) {
            errs.push({ field: 'temperature', message: t('err_temperature') });
        }
    }
    return { ok: errs.filter(e => !e.soft).length === 0, errors: errs };
}

// LLM Configuration Component (Admin Only)
function LLMConfiguration() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [llmConfig, setLlmConfig] = useState({
        provider: 'lmstudio',
        model: 'local-model',
        baseUrl: 'http://localhost:1234/v1',
        apiKey: '',
        enabled: true,
        maxOutputTokens: '',
        temperature: '',
        systemPromptTemplate: ''
    });
    const [rateLimits, setRateLimits] = useState({
        tokensPerUserDaily: 0,
        costPerUserDaily: 0,
        tokensPlatformDaily: 0,
        costPlatformDaily: 0
    });
    const [platformUsage, setPlatformUsage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { ok: boolean } | null
    const [showApiKey, setShowApiKey] = useState(false);
    const [detectedModels, setDetectedModels] = useState([]); // live ids from the server's /models
    const [detecting, setDetecting] = useState(false);

    const [validationErrors, setValidationErrors] = useState([]);
    const fieldError = (field) => validationErrors.find(e => e.field === field);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const [llmData, limitsData, usageData] = await Promise.all([
                apiFetch('/platform-settings/llm'),
                apiFetch('/platform-settings/rate-limits'),
                apiFetch('/llm/usage/platform')
            ]);

            setLlmConfig(llmData);
            setRateLimits(limitsData);
            setPlatformUsage(usageData);
        } catch (err) {
            console.error('Failed to load LLM config:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleProviderChange = (provider) => {
        const providerConfig = LLM_PROVIDERS[provider];
        // Detected ids belong to the OLD server — drop them so a stale
        // suggestion can't linger after switching providers. The auto-detect
        // effect below repopulates for keyless (local) providers.
        setDetectedModels([]);
        setLlmConfig(prev => ({
            ...prev,
            provider,
            baseUrl: providerConfig.defaultBase,
            model: defaultModelFor(provider),
            apiKey: providerConfig.needsKey ? prev.apiKey : ''
        }));
    };

    const handleSaveLLM = async () => {
        const v = validateLlmConfig(llmConfig, t);
        setValidationErrors(v.errors);
        if (!v.ok) {
            const blocking = v.errors.filter(e => !e.soft);
            toast.error(t('toast_fix_validation', { count: blocking.length }));
            return;
        }
        setSaving(true);
        try {
            await apiPut('/platform-settings/llm', llmConfig);
            toast.success(t('toast_llm_saved'));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_llm_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const handleSaveRateLimits = async () => {
        setSaving(true);
        try {
            await apiPut('/platform-settings/rate-limits', rateLimits);
            toast.success(t('toast_rate_limits_saved'));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_rate_limits_failed'));
        } finally {
            setSaving(false);
        }
    };

    // Ask the running server which models it actually has loaded, so the admin
    // can pick the exact id LM Studio / Ollama / any OpenAI-compatible endpoint
    // wants. This is the direct answer to the "Multiple models are loaded,
    // specify a model" 400 — with several models loaded the server won't guess.
    //
    // `silent` is the auto-detect path (see the effect below): it repopulates
    // the picker without toasts, because a local server that's simply switched
    // off should stay quiet, not nag on every settings visit. The manual button
    // passes silent=false so an explicit click always gives feedback.
    const handleDetectModels = useCallback(async ({ silent = false } = {}) => {
        setDetecting(true);
        try {
            const data = await apiPost('/platform-settings/llm/models/detect', {
                provider: llmConfig.provider,
                baseUrl: llmConfig.baseUrl,
                apiKey: llmConfig.apiKey,
            });
            const models = Array.isArray(data.models) ? data.models : [];
            setDetectedModels(models);
            if (models.length === 0) {
                if (!silent) toast.info(t('toast_no_models_detected'));
            } else {
                // If nothing is chosen yet, prefill the first loaded model so a
                // one-model server is immediately valid and a multi-model server
                // has a sane starting point the admin can adjust.
                setLlmConfig(prev => prev.model ? prev : { ...prev, model: models[0] });
                if (!silent) toast.success(t('toast_models_detected', { count: models.length }));
            }
        } catch (err) {
            if (!silent) toast.error(t('toast_detect_models_failed', { error: err.message }));
        } finally {
            setDetecting(false);
        }
    }, [llmConfig.provider, llmConfig.baseUrl, llmConfig.apiKey, t, toast]);

    // Auto-detect for keyless (local) providers — LM Studio / Ollama / a custom
    // localhost server. There's no reason to make the admin click for those: no
    // API key is at stake and the list is exactly what's running right now. We
    // debounce so typing a base URL doesn't fire a request per keystroke, and we
    // stay silent (see above). Cloud providers keep the manual button, since
    // probing them needs a valid key and shouldn't run unprompted.
    const providerNeedsKey = (LLM_PROVIDERS[llmConfig.provider] || {}).needsKey;
    const validBaseUrl = /^https?:\/\/.+/i.test((llmConfig.baseUrl || '').trim());
    useEffect(() => {
        if (loading || providerNeedsKey || !validBaseUrl) return undefined;
        const id = setTimeout(() => { handleDetectModels({ silent: true }); }, 600);
        return () => clearTimeout(id);
    }, [loading, providerNeedsKey, validBaseUrl, llmConfig.provider, llmConfig.baseUrl, handleDetectModels]);

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            // First save the current settings
            await apiPut('/platform-settings/llm', llmConfig);

            // Then test
            const data = await apiPost('/platform-settings/llm/test', {});
            if (data.success) {
                setTestResult({ ok: true });
                toast.success(t('toast_connection_success', { response: data.response }));
            } else {
                setTestResult({ ok: false });
                toast.error(friendlyLlmError(data.error, t));
            }
        } catch (err) {
            setTestResult({ ok: false });
            toast.error(friendlyLlmError(err.message, t));
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    }

    const currentProvider = LLM_PROVIDERS[llmConfig.provider] || LLM_PROVIDERS.lmstudio;

    return (
        <div className="space-y-6">
            {/* LLM Provider Configuration */}
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                <h4 className="text-md font-bold text-cyan-400 mb-4 flex items-center gap-2">
                    <Cpu className="w-5 h-5" />
                    {t('llm_config_title')}
                </h4>
                <p className="text-sm text-neutral-400 mb-6">
                    {t('llm_config_help')}
                </p>

                <div className="space-y-4">
                    {/* Enable/Disable */}
                    <div className="flex items-center justify-between p-3 bg-neutral-700/30 rounded-lg">
                        <div>
                            <span className="text-white font-medium">{t('llm_service')}</span>
                            <p className="text-xs text-neutral-400">{t('llm_service_help')}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={llmConfig.enabled}
                                onChange={(e) => setLlmConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                                className="sr-only peer"
                            />
                            <div className={`w-11 h-6 rounded-full peer-focus:ring-2 peer-focus:ring-cyan-500 ${llmConfig.enabled ? 'bg-cyan-600' : 'bg-neutral-600'
                                } after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5`}></div>
                        </label>
                    </div>

                    {/* Provider Selection */}
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">{t('llm_provider_label')}</label>
                        <select
                            value={llmConfig.provider}
                            onChange={(e) => handleProviderChange(e.target.value)}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                        >
                            <optgroup label={t('llm_optgroup_local')}>
                                <option value="lmstudio">{t('llm_opt_lmstudio')}</option>
                                <option value="ollama">{t('llm_opt_ollama')}</option>
                            </optgroup>
                            <optgroup label={t('llm_optgroup_cloud')}>
                                <option value="openai">{t('llm_opt_openai')}</option>
                                <option value="anthropic">{t('llm_opt_anthropic')}</option>
                                <option value="openrouter">{t('llm_opt_openrouter')}</option>
                                <option value="groq">{t('llm_opt_groq')}</option>
                                <option value="together">{t('llm_opt_together')}</option>
                                <option value="azure">{t('llm_opt_azure')}</option>
                            </optgroup>
                            <optgroup label={t('llm_optgroup_other')}>
                                <option value="custom">{t('llm_opt_custom')}</option>
                            </optgroup>
                        </select>
                        <p className="text-xs text-neutral-500 mt-1">{t(`llm_provider_desc_${llmConfig.provider}`)}</p>
                    </div>

                    {/* Base URL */}
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">{t('llm_base_url')}</label>
                        <input
                            type="text"
                            value={llmConfig.baseUrl}
                            onChange={(e) => setLlmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                            className={`w-full bg-neutral-800 border rounded-lg p-3 text-white focus:border-cyan-500 outline-none ${fieldError('baseUrl') ? 'border-red-500' : 'border-neutral-600'}`}
                            placeholder="https://api.openai.com/v1"
                        />
                        {fieldError('baseUrl') && (
                            <p className="text-xs text-red-400 mt-1">{fieldError('baseUrl').message}</p>
                        )}
                    </div>

                    {/* Model — curated catalogue dropdown (tiered) with a
                        "Custom…" free-text escape, all from the shared catalogue. */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label htmlFor="llm-model" className="block text-sm font-medium text-neutral-300">
                                {t('llm_model')}
                                {!currentProvider.modelRequired && (
                                    <span className="text-neutral-500 text-xs ml-2">{t('llm_model_optional')}</span>
                                )}
                            </label>
                            <button
                                type="button"
                                onClick={() => handleDetectModels()}
                                disabled={detecting}
                                className="text-xs font-medium text-cyan-400 hover:text-cyan-300 disabled:text-neutral-500 flex items-center gap-1.5"
                            >
                                {detecting
                                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('llm_detecting_models')}</>
                                    : t('llm_detect_models')}
                            </button>
                        </div>
                        <ModelSelect
                            id="llm-model"
                            provider={llmConfig.provider}
                            value={llmConfig.model}
                            onChange={(model) => setLlmConfig(prev => ({ ...prev, model }))}
                            accent="cyan"
                            invalid={Boolean(fieldError('model'))}
                            detectedModels={detectedModels}
                        />
                        {fieldError('model') && (
                            <p className="text-xs text-red-400 mt-1">{fieldError('model').message}</p>
                        )}
                    </div>

                    {/* API Key */}
                    {currentProvider.needsKey && (
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                {t('llm_api_key')}
                                {currentProvider.keyPrefix && (
                                    <span className="text-neutral-500 text-xs ml-2">
                                        {t('llm_api_key_prefix')} <code className="text-neutral-400">{currentProvider.keyPrefix}</code>
                                    </span>
                                )}
                            </label>
                            <div className="relative">
                                <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={llmConfig.apiKey}
                                    onChange={(e) => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                    className={`w-full bg-neutral-800 border rounded-lg p-3 text-white focus:border-cyan-500 outline-none pr-20 ${fieldError('apiKey') ? 'border-red-500' : 'border-neutral-600'}`}
                                    placeholder={currentProvider.keyPrefix ? `${currentProvider.keyPrefix}...` : t('llm_api_key_placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-neutral-400 hover:text-white"
                                >
                                    {showApiKey ? t('btn_hide_key') : t('btn_show_key')}
                                </button>
                            </div>
                            {fieldError('apiKey') && (
                                <p className={`text-xs mt-1 ${fieldError('apiKey').soft ? 'text-amber-400' : 'text-red-400'}`}>
                                    {fieldError('apiKey').message}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Effective settings preview — show what's actually wired up */}
                    <div className="pt-2 border-t border-neutral-700">
                        <h5 className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2">{t('llm_wired_up')}</h5>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <dt className="text-neutral-500">{t('llm_provider_label')}</dt>
                            <dd className="text-neutral-200 font-mono">{llmConfig.provider}</dd>
                            <dt className="text-neutral-500">{t('llm_model')}</dt>
                            <dd className="text-neutral-200 font-mono">{llmConfig.model || <span className="text-neutral-500">{t('llm_provider_default')}</span>}</dd>
                            <dt className="text-neutral-500">{t('llm_base_url')}</dt>
                            <dd className="text-neutral-200 font-mono break-all">{llmConfig.baseUrl || <span className="text-neutral-500">{t('llm_unset')}</span>}</dd>
                            {currentProvider.needsKey && (
                                <>
                                    <dt className="text-neutral-500">{t('llm_key')}</dt>
                                    <dd className="text-neutral-200 font-mono">
                                        {llmConfig.apiKey
                                            ? `${llmConfig.apiKey.slice(0, Math.min(7, llmConfig.apiKey.length))}…${llmConfig.apiKey.slice(-3)} (${llmConfig.apiKey.length} ${t('llm_key_chars')})`
                                            : <span className="text-red-400">{t('llm_key_missing')}</span>}
                                    </dd>
                                </>
                            )}
                        </dl>
                    </div>

                    {/* Model Parameters */}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-700 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">{t('llm_max_tokens')}</label>
                            <input
                                type="text"
                                value={llmConfig.maxOutputTokens}
                                onChange={(e) => setLlmConfig(prev => ({ ...prev, maxOutputTokens: e.target.value }))}
                                placeholder={t('llm_provider_default_placeholder')}
                                className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                            />
                            <p className="text-xs text-neutral-500 mt-1">{t('llm_empty_provider_default')}</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">{t('llm_temperature')}</label>
                            <input
                                type="text"
                                value={llmConfig.temperature}
                                onChange={(e) => setLlmConfig(prev => ({ ...prev, temperature: e.target.value }))}
                                placeholder={t('llm_provider_default_placeholder')}
                                className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                            />
                            <p className="text-xs text-neutral-500 mt-1">{t('llm_empty_provider_default_range')}</p>
                        </div>
                    </div>

                    {/* System Prompt Template */}
                    <div className="pt-2">
                        <label className="block text-sm font-medium text-neutral-300 mb-2">{t('llm_system_prompt_template')}</label>
                        <textarea
                            value={llmConfig.systemPromptTemplate}
                            onChange={(e) => setLlmConfig(prev => ({ ...prev, systemPromptTemplate: e.target.value }))}
                            rows={8}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none font-mono text-xs"
                            placeholder={t('llm_system_prompt_placeholder')}
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('llm_system_prompt_help')}</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3 pt-4">
                        <button
                            onClick={handleSaveLLM}
                            disabled={saving}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {t('btn_save_settings')}
                        </button>
                        <button
                            onClick={handleTestConnection}
                            disabled={testing}
                            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 text-white rounded-lg font-medium flex items-center gap-2"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            {t('btn_test_connection')}
                        </button>
                        {/* Connection-status pill — plain English (admin surface). */}
                        {testResult && !testing && (
                            <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${testResult.ok
                                    ? 'bg-green-500/10 border-green-500/40 text-green-300'
                                    : 'bg-red-500/10 border-red-500/40 text-red-300'}`}
                            >
                                <span className={`w-2 h-2 rounded-full ${testResult.ok ? 'bg-green-400' : 'bg-red-400'}`} aria-hidden="true"></span>
                                {testResult.ok ? 'Connected' : 'Not connected'}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Rate Limits Configuration */}
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                <h4 className="text-md font-bold text-orange-400 mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    {t('llm_rate_limits_title')}
                </h4>
                <p className="text-sm text-neutral-400 mb-6">
                    {t('llm_rate_limits_help')}
                </p>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            {t('llm_tokens_per_user')}
                            {rateLimits.tokensPerUserDaily === 0 && <span className="text-green-400 ml-2 text-xs">{t('llm_unlimited')}</span>}
                        </label>
                        <input
                            type="number"
                            value={rateLimits.tokensPerUserDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, tokensPerUserDaily: parseInt(e.target.value) || 0 }))}
                            placeholder={t('llm_unlimited_placeholder')}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('llm_tokens_per_user_help')}</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            {t('llm_cost_per_user')}
                            {rateLimits.costPerUserDaily === 0 && <span className="text-green-400 ml-2 text-xs">{t('llm_unlimited')}</span>}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={rateLimits.costPerUserDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, costPerUserDaily: parseFloat(e.target.value) || 0 }))}
                            placeholder={t('llm_unlimited_placeholder')}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('llm_cost_per_user_help')}</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            {t('llm_platform_tokens')}
                            {rateLimits.tokensPlatformDaily === 0 && <span className="text-green-400 ml-2 text-xs">{t('llm_unlimited')}</span>}
                        </label>
                        <input
                            type="number"
                            value={rateLimits.tokensPlatformDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, tokensPlatformDaily: parseInt(e.target.value) || 0 }))}
                            placeholder={t('llm_unlimited_placeholder')}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('llm_platform_tokens_help')}</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            {t('llm_platform_cost')}
                            {rateLimits.costPlatformDaily === 0 && <span className="text-green-400 ml-2 text-xs">{t('llm_unlimited')}</span>}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={rateLimits.costPlatformDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, costPlatformDaily: parseFloat(e.target.value) || 0 }))}
                            placeholder={t('llm_unlimited_placeholder')}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('llm_platform_cost_help')}</p>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-neutral-700">
                    <button
                        onClick={handleSaveRateLimits}
                        disabled={saving}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t('btn_save_rate_limits')}
                    </button>
                </div>
            </div>

            {/* Platform Usage Stats */}
            {platformUsage && (
                <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                    <h4 className="text-md font-bold text-green-400 mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        {t('llm_todays_usage')}
                    </h4>

                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.tokensUsed?.toLocaleString() || 0}</div>
                            <div className="text-xs text-neutral-400">{t('llm_tokens_used')}</div>
                            <div className="mt-2 h-1 bg-neutral-600 rounded">
                                <div
                                    className="h-full bg-green-500 rounded"
                                    style={{ width: `${Math.min((platformUsage.tokensUsed / platformUsage.tokensLimit) * 100, 100)}%` }}
                                />
                            </div>
                            <div className="text-xs text-neutral-500 mt-1">{t('llm_remaining', { value: platformUsage.tokensRemaining?.toLocaleString() || 0 })}</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">${platformUsage.costUsed?.toFixed(2) || '0.00'}</div>
                            <div className="text-xs text-neutral-400">{t('llm_cost_today')}</div>
                            <div className="mt-2 h-1 bg-neutral-600 rounded">
                                <div
                                    className="h-full bg-orange-500 rounded"
                                    style={{ width: `${Math.min((platformUsage.costUsed / platformUsage.costLimit) * 100, 100)}%` }}
                                />
                            </div>
                            <div className="text-xs text-neutral-500 mt-1">{t('llm_remaining', { value: '$' + (platformUsage.costRemaining?.toFixed(2) || '0.00') })}</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.totalRequests || 0}</div>
                            <div className="text-xs text-neutral-400">{t('llm_total_requests')}</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.activeUsers || 0}</div>
                            <div className="text-xs text-neutral-400">{t('llm_active_users')}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Chat/Doctor Configuration Component (Admin Only)
function ChatConfiguration() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [chatSettings, setChatSettings] = useState({
        doctorName: 'Dr. Carmen',
        doctorAvatar: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [previewAvatar, setPreviewAvatar] = useState('');

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const data = await apiFetch('/platform-settings/chat');
            setChatSettings(data);
            setPreviewAvatar(data.doctorAvatar || '');
        } catch (err) {
            console.error('Failed to load chat settings:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiPut('/platform-settings/chat', chatSettings);
            toast.success(t('toast_chat_saved'));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_chat_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 500000) {
                toast.warning(t('toast_image_too_large'));
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result;
                setChatSettings(prev => ({ ...prev, doctorAvatar: base64 }));
                setPreviewAvatar(base64);
            };
            reader.readAsDataURL(file);
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    }

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
            <h4 className="text-md font-bold text-cyan-400 mb-4 flex items-center gap-2">
                <User className="w-5 h-5" />
                {t('chat_title')}
            </h4>
            <p className="text-sm text-neutral-400 mb-6">
                {t('chat_help')}
            </p>

            <div className="space-y-4">
                {/* Doctor Name */}
                <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">{t('chat_doctor_name')}</label>
                    <input
                        type="text"
                        value={chatSettings.doctorName}
                        onChange={(e) => setChatSettings(prev => ({ ...prev, doctorName: e.target.value }))}
                        placeholder="Dr. Carmen"
                        className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                    />
                    <p className="text-xs text-neutral-500 mt-1">{t('chat_doctor_name_help')}</p>
                </div>

                {/* Doctor Avatar */}
                <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">{t('chat_doctor_avatar')}</label>
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center overflow-hidden">
                            {previewAvatar ? (
                                <img src={previewAvatar} alt="Doctor" className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-8 h-8 text-neutral-500" />
                            )}
                        </div>
                        <div className="flex-1">
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                                className="hidden"
                                id="doctor-avatar-upload"
                            />
                            <label
                                htmlFor="doctor-avatar-upload"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg cursor-pointer transition-colors text-sm"
                            >
                                <Upload className="w-4 h-4" />
                                {t('btn_upload_image')}
                            </label>
                            {previewAvatar && (
                                <button
                                    onClick={() => {
                                        setChatSettings(prev => ({ ...prev, doctorAvatar: '' }));
                                        setPreviewAvatar('');
                                    }}
                                    className="ml-2 px-3 py-2 text-red-400 hover:text-red-300 text-sm"
                                >
                                    {t('btn_remove')}
                                </button>
                            )}
                            <p className="text-xs text-neutral-500 mt-2">{t('chat_avatar_help')}</p>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="pt-4">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t('btn_save_chat')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Monitor Display Configuration Component (Admin Only)
function MonitorConfiguration() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [monitorSettings, setMonitorSettings] = useState({
        showTimer: true,
        showECG: true,
        showSpO2: true,
        showBP: true,
        showRR: true,
        showTemp: true,
        showCO2: true,
        showPleth: true,
        showNumerics: true
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadMonitorSettings();
    }, []);

    const loadMonitorSettings = async () => {
        try {
            const data = await apiFetch('/platform-settings/monitor');
            setMonitorSettings(prev => ({ ...prev, ...data }));
        } catch (error) {
            console.error('Failed to load monitor settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = (key) => {
        setMonitorSettings(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const saveMonitorSettings = async () => {
        setSaving(true);
        try {
            await apiPut('/platform-settings/monitor', monitorSettings);
            toast.success(t('toast_monitor_saved'));
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : t('toast_monitor_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const settingsConfig = [
        { key: 'showTimer', label: t('monitor_setting_timer_label'), description: t('monitor_setting_timer_desc') },
        { key: 'showECG', label: t('monitor_setting_ecg_label'), description: t('monitor_setting_ecg_desc') },
        { key: 'showPleth', label: t('monitor_setting_pleth_label'), description: t('monitor_setting_pleth_desc') },
        { key: 'showSpO2', label: t('monitor_setting_spo2_label'), description: t('monitor_setting_spo2_desc') },
        { key: 'showBP', label: t('monitor_setting_bp_label'), description: t('monitor_setting_bp_desc') },
        { key: 'showRR', label: t('monitor_setting_rr_label'), description: t('monitor_setting_rr_desc') },
        { key: 'showTemp', label: t('monitor_setting_temp_label'), description: t('monitor_setting_temp_desc') },
        { key: 'showCO2', label: t('monitor_setting_co2_label'), description: t('monitor_setting_co2_desc') },
        { key: 'showNumerics', label: t('monitor_setting_numerics_label'), description: t('monitor_setting_numerics_desc') }
    ];

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6 mt-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-cyan-600/20 rounded-lg">
                    <Monitor className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">{t('monitor_title')}</h3>
                    <p className="text-sm text-neutral-400">{t('monitor_subtitle')}</p>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-8 text-neutral-400">{t('monitor_loading')}</div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        {settingsConfig.map(({ key, label, description }) => (
                            <div
                                key={key}
                                onClick={() => handleToggle(key)}
                                className={`p-4 rounded-lg border cursor-pointer transition-all ${monitorSettings[key]
                                    ? 'bg-cyan-900/30 border-cyan-600/50'
                                    : 'bg-neutral-900/50 border-neutral-700 hover:border-neutral-600'
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-white">{label}</span>
                                    <div className={`w-10 h-5 rounded-full transition-colors ${monitorSettings[key] ? 'bg-cyan-600' : 'bg-neutral-600'
                                        }`}>
                                        <div className={`w-4 h-4 rounded-full bg-white m-0.5 transition-transform ${monitorSettings[key] ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                    </div>
                                </div>
                                <p className="text-xs text-neutral-400">{description}</p>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={saveMonitorSettings}
                        disabled={saving}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                        {saving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                {t('btn_saving')}
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                {t('btn_save_monitor')}
                            </>
                        )}
                    </button>
                </>
            )}
        </div>
    );
}

// System Logs Component (Admin Only)
//
// All log surfaces (Activity, Sessions, System Log, Chat Log, Moments, Turns,
// Case Insights, Oyon data) now mount
// the same unified `LogGrid` data grid via thin wrapper components in
// `src/components/analytics/`. Each wrapper owns its own fetch + per-tab
// CSV export — there is no longer a global "Export Data (CSV)" grid here.
function SystemLogs() {
    const { t } = useTranslation('authoring_config');
    const [activeLogTab, setActiveLogTab] = useState('activity'); // activity, sessions, system, chat, moments, turns, insights, oyondata

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">{t('logs_title')}</h3>
                <span className="text-xs text-neutral-500">
                    {t('logs_date_filter_note')}
                </span>
            </div>

            {/* Log Viewer Tabs.
                Login + Settings tabs were retired — the same content shows
                up under System Log → component=auth/config (with per-source
                CSV streaming) and under Activity → category=AUTH/CONFIGURATION
                via the dual-write to learning_events. */}
            <div className="border-b border-neutral-700 flex gap-4 overflow-x-auto">
                <button
                    onClick={() => setActiveLogTab('activity')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeLogTab === 'activity' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    <Activity className="w-4 h-4" />
                    {t('logtab_activity')}
                </button>
                <button
                    onClick={() => setActiveLogTab('sessions')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'sessions' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_sessions')}
                </button>
                <button
                    onClick={() => setActiveLogTab('system')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'system' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_system')}
                </button>
                <button
                    onClick={() => setActiveLogTab('chat')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'chat' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_chat')}
                </button>
                <button
                    onClick={() => setActiveLogTab('moments')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'moments' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_moments')}
                </button>
                <button
                    onClick={() => setActiveLogTab('turns')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'turns' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_turns')}
                </button>
                <button
                    onClick={() => setActiveLogTab('insights')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'insights' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_insights')}
                </button>
                <button
                    onClick={() => setActiveLogTab('oyondata')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'oyondata' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    {t('logtab_oyondata')}
                </button>
            </div>

            {/* Log Content. Each LogGrid surface owns its own toolbar,
                fetch, filters, and CSV export — same UX across tabs. */}
            <div className="flex-1 overflow-auto">
                {activeLogTab === 'activity' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <ActivityTable />
                    </div>
                ) : activeLogTab === 'sessions' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <SessionsTable />
                    </div>
                ) : activeLogTab === 'system' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <SystemLogTable />
                    </div>
                ) : activeLogTab === 'chat' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <ChatLogTable />
                    </div>
                ) : activeLogTab === 'moments' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <MomentsTable />
                    </div>
                ) : activeLogTab === 'turns' ? (
                    <div className="rohy-table-shell rounded overflow-hidden" style={{ height: '650px' }}>
                        <TurnsTable />
                    </div>
                ) : activeLogTab === 'insights' ? (
                    <div className="rohy-table-shell rounded overflow-auto" style={{ height: '650px' }}>
                        <CaseInsightsPanel />
                    </div>
                ) : activeLogTab === 'oyondata' ? (
                    <div className="rohy-table-shell rounded overflow-auto" style={{ height: '650px' }}>
                        <OyonDataLogs />
                    </div>
                ) : null}
            </div>
        </div>
    );
}


// Lab Investigation Selector Component
function LabInvestigationSelector({ _caseData, onAddLab, patientGender, showAddByGroup = false }) {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [groups, setGroups] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);

    // Load groups on mount
    useEffect(() => {
        apiFetch('/labs/groups')
            .then(data => setGroups(data.groups || []))
            .catch(err => console.error('Failed to load groups:', err));
    }, []);

    // Search labs
    useEffect(() => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        apiFetch(`/labs/search?q=${encodeURIComponent(searchQuery)}&limit=20`)
            .then(data => {
                setSearchResults(data.results || []);
                setIsSearching(false);
            })
            .catch(err => {
                console.error('Search failed:', err);
                setIsSearching(false);
            });
    }, [searchQuery]);

    const handleAddLab = (testGroup) => {
        // testGroup is array of gender variations
        // Find gender-specific test or first available
        let selectedTest = testGroup.find(t => t.category === patientGender);
        if (!selectedTest) {
            selectedTest = testGroup.find(t => t.category === 'Both');
        }
        if (!selectedTest) {
            selectedTest = testGroup[0];
        }

        // Get random normal value as default
        const normalValue = selectedTest.normal_samples && selectedTest.normal_samples.length > 0
            ? selectedTest.normal_samples[Math.floor(Math.random() * selectedTest.normal_samples.length)]
            : (selectedTest.min_value + selectedTest.max_value) / 2;

        const labData = {
            test_name: selectedTest.test_name,
            test_group: selectedTest.group,
            gender_category: selectedTest.category,
            min_value: selectedTest.min_value,
            max_value: selectedTest.max_value,
            current_value: normalValue,
            unit: selectedTest.unit,
            normal_samples: selectedTest.normal_samples,
            is_abnormal: false,
            turnaround_minutes: DEFAULT_TURNAROUND_MINUTES
        };

        onAddLab(labData);
        setSearchQuery('');
        setSearchResults([]);
    };

    const handleAddByGroup = async () => {
        if (selectedGroup === 'all') {
            toast.warning(t('toast_select_group'));
            return;
        }

        setAddingGroup(true);
        try {
            const data = await apiFetch(`/labs/group/${encodeURIComponent(selectedGroup)}`);
            const tests = data.tests || [];

            // Group tests by name
            const grouped = {};
            tests.forEach(test => {
                if (!grouped[test.test_name]) {
                    grouped[test.test_name] = [];
                }
                grouped[test.test_name].push(test);
            });

            // Add each unique test
            Object.values(grouped).forEach(testGroup => {
                handleAddLab(testGroup);
            });

            toast.success(t('toast_added_tests', { count: Object.keys(grouped).length, group: selectedGroup }));
        } catch (error) {
            console.error('Failed to add group:', error);
            toast.error(t('toast_add_group_failed'));
        } finally {
            setAddingGroup(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="flex-1">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('lab_search_placeholder')}
                        className="input-dark w-full"
                    />
                </div>
                <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="input-dark"
                >
                    <option value="all">{t('lab_all_groups')}</option>
                    {groups.map(group => (
                        <option key={group} value={group}>{group}</option>
                    ))}
                </select>
                {showAddByGroup && (
                    <button
                        onClick={handleAddByGroup}
                        disabled={selectedGroup === 'all' || addingGroup}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded font-bold text-sm whitespace-nowrap flex items-center gap-2"
                        title={t('title_add_all_group')}
                    >
                        {addingGroup ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t('btn_adding')}
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4" />
                                {t('btn_add_group')}
                            </>
                        )}
                    </button>
                )}
            </div>

            {isSearching && (
                <div className="text-center py-4 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
            )}

            {searchResults.length > 0 && (
                <div className="bg-neutral-900 border border-neutral-700 rounded max-h-64 overflow-y-auto">
                    {searchResults
                        .filter(testGroup => selectedGroup === 'all' || testGroup[0].group === selectedGroup)
                        .map((testGroup, idx) => {
                            const test = testGroup[0];
                            return (
                                <div
                                    key={idx}
                                    className="p-3 border-b border-neutral-800 hover:bg-neutral-800 cursor-pointer transition-colors"
                                    onClick={() => handleAddLab(testGroup)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-sm">{test.test_name}</div>
                                            <div className="text-xs text-neutral-400">
                                                {test.group} • {t('lab_variations', { count: testGroup.length })}
                                            </div>
                                        </div>
                                        <Plus className="w-4 h-4 text-green-400" />
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}

            {searchQuery && !isSearching && searchResults.length === 0 && (
                <div className="text-center py-4 text-neutral-500 text-sm">
                    {t('lab_no_tests_found', { query: searchQuery })}
                </div>
            )}
        </div>
    );
}

// Case Agent Editor - Configure which agents are available per case
// Editor for `config.pages` — title/content pairs appended to the AI patient's
// system prompt as hidden context (only revealed when relevant to history
// taking). Lightweight inline editor with add/remove/reorder; no rich-text.
function PagesEditor({ pages, onChange }) {
    const { t } = useTranslation('authoring_config');
    const update = (i, patch) => {
        const next = pages.map((p, idx) => idx === i ? { ...p, ...patch } : p);
        onChange(next);
    };
    const add = () => onChange([...pages, { title: '', content: '' }]);
    const remove = (i) => onChange(pages.filter((_, idx) => idx !== i));
    const move = (i, delta) => {
        const target = i + delta;
        if (target < 0 || target >= pages.length) return;
        const next = [...pages];
        const [moved] = next.splice(i, 1);
        next.splice(target, 0, moved);
        onChange(next);
    };
    return (
        <div className="border-t border-neutral-700 pt-4 space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <h5 className="text-sm font-bold text-neutral-200">{t('pages_title')}</h5>
                    <p className="text-[11px] text-neutral-500">
                        {t('pages_help')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={add}
                    className="px-2.5 py-1 rounded text-xs font-semibold text-white flex items-center gap-1 bg-teal-700 hover:bg-teal-600"
                >
                    <Plus className="w-3.5 h-3.5" /> {t('btn_add_page')}
                </button>
            </div>
            {pages.length === 0 ? (
                <div className="rounded border border-dashed border-neutral-700 bg-neutral-900/40 p-4 text-center text-xs text-neutral-500">
                    {t('pages_empty')}
                </div>
            ) : (
                <ul className="space-y-2">
                    {pages.map((page, i) => (
                        <li key={i} className="bg-neutral-900/60 border border-neutral-800 rounded p-3 space-y-2">
                            <div className="flex items-start gap-2">
                                <div className="flex flex-col items-center mt-1 text-neutral-600 text-[10px]">
                                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30 hover:text-neutral-300 leading-none">▲</button>
                                    <span className="my-0.5 font-mono text-neutral-700">{i + 1}</span>
                                    <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} className="disabled:opacity-30 hover:text-neutral-300 leading-none">▼</button>
                                </div>
                                <input
                                    type="text"
                                    value={page.title || ''}
                                    onChange={(e) => update(i, { title: e.target.value })}
                                    placeholder={t('pages_title_placeholder')}
                                    className="flex-1 px-2 py-1.5 bg-neutral-950 border border-neutral-800 rounded text-sm focus:outline-none focus:border-teal-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => remove(i)}
                                    className="p-1.5 rounded text-neutral-500 hover:text-rose-300 hover:bg-rose-900/30 mt-0.5"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <textarea
                                value={page.content || ''}
                                onChange={(e) => update(i, { content: e.target.value })}
                                placeholder={t('pages_body_placeholder')}
                                rows={4}
                                className="w-full px-2.5 py-2 bg-neutral-950 border border-neutral-800 rounded text-sm focus:outline-none focus:border-teal-500 resize-y"
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function CaseAgentEditor({ caseId, _caseData, setCaseData: _setCaseData, onOpenPersonaEditor }) {
    const { t } = useTranslation('authoring_config');
    const [templates, setTemplates] = useState([]);
    const [caseAgents, setCaseAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingAgent, setEditingAgent] = useState(null);
    const toast = useToast();

    // Load templates and case agents on mount
    useEffect(() => {
        loadData();
    }, [caseId]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Load all templates
            const templatesData = await apiFetch('/agents/templates');
            setTemplates(templatesData.templates || []);

            // Load case agents if case has an ID
            if (caseId) {
                const agentsData = await apiFetch(`/cases/${caseId}/agents`);
                setCaseAgents(agentsData.agents || []);
            }
        } catch (err) {
            console.error('Failed to load agent data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddDefaultAgents = async () => {
        if (!caseId) {
            toast.warning(t('toast_save_case_first_agents'));
            return;
        }
        try {
            const data = await apiPost(`/cases/${caseId}/agents/add-defaults`, {});
            toast.success(data.message);
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_add_default_failed'));
        }
    };

    const handleAddAgent = async (templateId) => {
        if (!caseId) {
            toast.warning(t('toast_save_case_first_agents'));
            return;
        }
        try {
            await apiPost(`/cases/${caseId}/agents`, { agent_template_id: templateId });
            toast.success(t('toast_agent_added'));
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_add_agent_failed'));
        }
    };

    const handleRemoveAgent = async (agentId) => {
        try {
            await apiDelete(`/cases/${caseId}/agents/${agentId}`);
            toast.success(t('toast_agent_removed'));
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_remove_agent_failed'));
        }
    };

    const handleToggleEnabled = async (agent) => {
        try {
            await apiPut(`/cases/${caseId}/agents/${agent.id}`, { enabled: !agent.enabled });
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_update_agent_failed'));
        }
    };

    const handleUpdateAgent = async (updates) => {
        if (!editingAgent) return;
        try {
            await apiPut(`/cases/${caseId}/agents/${editingAgent.id}`, updates);
            toast.success(t('toast_agent_updated'));
            setEditingAgent(null);
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_update_agent_failed'));
        }
    };

    // Get available templates (not already added)
    const addedTemplateIds = new Set(caseAgents.map(a => a.agent_template_id));
    const availableTemplates = templates.filter(t => !addedTemplateIds.has(t.id));

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
            </div>
        );
    }

    // Editing modal
    if (editingAgent) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h4 className="text-lg font-bold text-teal-400">{t('agent_edit_title', { name: editingAgent.name })}</h4>
                    <button
                        onClick={() => setEditingAgent(null)}
                        className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm"
                    >
                        {t('btn_cancel')}
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">{t('agent_name_override')}</label>
                            <input
                                type="text"
                                value={editingAgent.name_override || ''}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, name_override: e.target.value }))}
                                placeholder={editingAgent.template_name || editingAgent.name}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">{t('agent_availability_type')}</label>
                            <select
                                value={editingAgent.availability_type || 'present'}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, availability_type: e.target.value }))}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            >
                                <option value="present">{t('agent_avail_present')}</option>
                                <option value="on-call">{t('agent_avail_oncall')}</option>
                                <option value="absent">{t('agent_avail_absent')}</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">{t('agent_available_from')}</label>
                            <input
                                type="number"
                                min="0"
                                value={editingAgent.available_from_minute || 0}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, available_from_minute: parseInt(e.target.value) || 0 }))}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">{t('agent_depart_at')}</label>
                            <input
                                type="number"
                                min="0"
                                value={editingAgent.depart_at_minute || 0}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, depart_at_minute: parseInt(e.target.value) || null }))}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">{t('agent_response_min')}</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={editingAgent.response_time_min || 0}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, response_time_min: parseInt(e.target.value) || 0 }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">{t('agent_response_max')}</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={editingAgent.response_time_max || 0}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, response_time_max: parseInt(e.target.value) || 0 }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-neutral-400 mb-1">{t('agent_system_prompt_override')}</label>
                        <textarea
                            value={editingAgent.system_prompt_override || ''}
                            onChange={(e) => setEditingAgent(prev => ({ ...prev, system_prompt_override: e.target.value }))}
                            placeholder={t('agent_system_prompt_placeholder')}
                            className="w-full h-64 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm font-mono resize-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('agent_system_prompt_help')}</p>
                    </div>
                </div>

                {editingAgent.agent_type === 'discussant' && (
                    <div className="space-y-4 p-4 rounded-lg bg-indigo-950/30 border border-indigo-900/50">
                        <h5 className="text-sm font-bold text-indigo-300">{t('agent_discussant_overrides')}</h5>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">{t('agent_context_filter')}</label>
                                <select
                                    value={editingAgent._cfg_context_filter ?? editingAgent.context_filter ?? 'full'}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, _cfg_context_filter: e.target.value }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                >
                                    <option value="full">{t('agent_ctx_full')}</option>
                                    <option value="history">{t('agent_ctx_history')}</option>
                                    <option value="vitals">{t('agent_ctx_vitals')}</option>
                                    <option value="minimal">{t('agent_ctx_minimal')}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">{t('agent_unlock_trigger')}</label>
                                <select
                                    value={editingAgent._cfg_unlock_trigger ?? editingAgent.unlock_trigger ?? 'after_case_ended'}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, _cfg_unlock_trigger: e.target.value }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                >
                                    <option value="after_case_ended">{t('agent_unlock_after')}</option>
                                    <option value="always">{t('agent_unlock_always')}</option>
                                </select>
                            </div>
                        </div>
                        <p className="text-xs text-neutral-500">{t('agent_discussant_help')} <code className="text-neutral-400">case_agents.config_override</code>.</p>
                    </div>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t border-neutral-800">
                    <button
                        onClick={() => {
                            const updates = {
                                name_override: editingAgent.name_override || null,
                                system_prompt_override: editingAgent.system_prompt_override || null,
                                availability_type: editingAgent.availability_type,
                                available_from_minute: editingAgent.available_from_minute,
                                depart_at_minute: editingAgent.depart_at_minute || null,
                                response_time_min: editingAgent.response_time_min,
                                response_time_max: editingAgent.response_time_max,
                            };
                            if (editingAgent.agent_type === 'discussant') {
                                const cfg = {};
                                const ctx = editingAgent._cfg_context_filter ?? editingAgent.context_filter;
                                const unlock = editingAgent._cfg_unlock_trigger ?? editingAgent.unlock_trigger;
                                if (ctx) cfg.context_filter = ctx;
                                if (unlock) cfg.unlock_trigger = unlock;
                                updates.config_override = Object.keys(cfg).length ? cfg : null;
                            }
                            handleUpdateAgent(updates);
                        }}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-bold"
                    >
                        {t('btn_save_changes')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-lg font-bold text-teal-400">{t('agent_step_title')}</h4>
                    <p className="text-xs text-neutral-500">{t('agent_step_help')}</p>
                </div>
                {!caseId ? (
                    <span className="px-3 py-1.5 bg-amber-900/30 text-amber-400 rounded text-sm">
                        {t('agent_save_first_badge')}
                    </span>
                ) : (
                    <button
                        onClick={handleAddDefaultAgents}
                        disabled={caseAgents.length > 0}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> {t('btn_add_default_agents')}
                    </button>
                )}
            </div>

            {/* Configured Agents */}
            {caseAgents.length > 0 ? (
                <div className="space-y-3">
                    <h5 className="text-sm font-medium text-neutral-400">{t('agent_configured')}</h5>
                    {caseAgents.map(agent => (
                        <div
                            key={agent.id}
                            className={`p-4 rounded-lg border ${agent.enabled
                                ? 'bg-neutral-800/50 border-neutral-700'
                                : 'bg-neutral-900/50 border-neutral-800 opacity-60'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                        agent.agent_type === 'patient' ? 'bg-rose-900/50 text-rose-300' :
                                        agent.agent_type === 'discussant' ? 'bg-indigo-900/50 text-indigo-400' :
                                        agent.agent_type === 'nurse' ? 'bg-blue-900/50 text-blue-400' :
                                        agent.agent_type === 'consultant' ? 'bg-green-900/50 text-green-400' :
                                        agent.agent_type === 'relative' ? 'bg-amber-900/50 text-amber-400' :
                                        agent.agent_type === 'pharmacist' ? 'bg-fuchsia-900/50 text-fuchsia-300' :
                                        agent.agent_type === 'technician' ? 'bg-teal-900/50 text-teal-300' :
                                        'bg-neutral-800 text-neutral-400'
                                        }`}>
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium flex items-center gap-2">
                                            {agent.name}
                                            {agent.has_name_override && (
                                                <span className="px-1 py-0.5 bg-blue-900/50 text-blue-400 rounded text-xs">{t('badge_override')}</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-neutral-500">
                                            {agent.role_title || agent.agent_type} • {agent.availability_type}
                                            {agent.available_from_minute > 0 && ' • ' + t('agent_from_min', { min: agent.available_from_minute })}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggleEnabled(agent)}
                                        className={`px-2 py-1 rounded text-xs ${agent.enabled
                                            ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                                            : 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600'
                                            }`}
                                    >
                                        {agent.enabled ? t('btn_enabled') : t('btn_disabled')}
                                    </button>
                                    <button
                                        onClick={() => setEditingAgent(agent)}
                                        className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs"
                                        title={t('title_case_overrides')}
                                    >
                                        {t('btn_case_overrides')}
                                    </button>
                                    {onOpenPersonaEditor && agent.agent_template_id && (
                                        <button
                                            // wizardStep=11 keeps the case wizard's Agents step in sync
                                            // with the seeder/case-data; if step numbering ever changes,
                                            // search this comment to find the magic number.
                                            onClick={() => onOpenPersonaEditor(agent.agent_template_id, { tab: 'cases', wizardStep: 11 })}
                                            className="px-2 py-1 bg-teal-700/40 hover:bg-teal-700 text-teal-200 hover:text-white rounded text-xs"
                                            title={t('title_edit_persona')}
                                        >
                                            {t('btn_edit_persona')}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRemoveAgent(agent.id)}
                                        className="px-2 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-xs"
                                    >
                                        {t('btn_remove')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('agent_none_configured')}</p>
                    <p className="text-sm">{t('agent_add_default_hint')}</p>
                </div>
            )}

            {/* Available Templates to Add */}
            {caseId && availableTemplates.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-neutral-800">
                    <h5 className="text-sm font-medium text-neutral-400">{t('agent_available_templates')}</h5>
                    <div className="grid grid-cols-3 gap-3">
                        {availableTemplates.map(template => (
                            <button
                                key={template.id}
                                onClick={() => handleAddAgent(template.id)}
                                className="p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg hover:bg-neutral-800 hover:border-teal-600 transition-all text-left"
                            >
                                <div className="font-medium text-sm">{template.name}</div>
                                <div className="text-xs text-neutral-500">{template.role_title || template.agent_type}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Sub-component for the Wizard to keep code clean
function CaseWizard({ caseData, setActiveTab, setCaseData, onSave, onCancel, _hasUnsavedChanges, lastSavedAt, initialStep, onStepLoaded, onOpenPersonaEditor, resumedFromStash, onDiscardDraft }) {
    const { t } = useTranslation('authoring_config');
    const [step, setStep] = useState(initialStep || 1);
    const [publicScenarios, setPublicScenarios] = useState([]);
    const toast = useToast();

    // Consume initialStep once on mount, then reset it in the parent so future
    // mounts (e.g. opening a different case) start at step 1 again.
    useEffect(() => { onStepLoaded?.(); }, []);

    // Fetch public (custom) scenarios for the Quick Templates dropdown
    useEffect(() => {
        apiFetch('/scenarios')
            .then(data => {
                const rows = Array.isArray(data) ? data : (data.scenarios || []);
                setPublicScenarios(
                    rows.filter(s => s.is_public && !s.is_builtin)
                        .map(s => ({
                            ...s,
                            timeline: typeof s.timeline === 'string' ? JSON.parse(s.timeline) : s.timeline
                        }))
                );
            })
            .catch(() => {});
    }, []);

    // Format last saved time
    const formatLastSaved = () => {
        if (!lastSavedAt) return null;
        const now = new Date();
        const diff = Math.floor((now - lastSavedAt) / 1000);
        if (diff < 5) return t('wizard_just_now');
        if (diff < 60) return t('wizard_seconds_ago', { n: diff });
        if (diff < 3600) return t('wizard_minutes_ago', { n: Math.floor(diff / 60) });
        return lastSavedAt.toLocaleTimeString();
    };

    // Helper to update deeply nested config
    const updateConfig = (key, value) => {
        setCaseData(prev => ({
            ...prev,
            config: { ...prev.config, [key]: value }
        }));
    };

    // Map from the wizard's structuredHistory field names to the canonical
    // clinicalRecords.history field names that the runtime actually reads
    // (ChatInterface.jsx). Pre-this-fix the structured-mode editor wrote ONLY
    // to structuredHistory and the runtime ignored it — admins lost their work.
    // Fields with no clinicalRecords equivalent (`ros`, `additionalNotes`,
    // `medications`) are kept in structuredHistory only; they're surfaced via
    // a different ClinicalRecords section.
    const STRUCTURED_HISTORY_TO_CLINICAL_HISTORY = {
        chiefComplaint: 'chiefComplaint',
        hpi: 'hpi',
        pmh: 'pastMedical',
        psh: 'pastSurgical',
        allergies: 'allergies',
        socialHistory: 'social',
        familyHistory: 'family',
    };

    // Update a single field of structuredHistory and mirror it into
    // clinicalRecords.history with the canonical key. Caller passes the
    // structuredHistory key (eg. 'pmh'); we resolve the mirror key.
    const updateStructuredHistoryField = (field, value) => {
        const mirroredKey = STRUCTURED_HISTORY_TO_CLINICAL_HISTORY[field];
        setCaseData(prev => {
            const cfg = prev.config || {};
            const sh = { ...(cfg.structuredHistory || {}), [field]: value };
            const next = { ...prev, config: { ...cfg, structuredHistory: sh } };
            if (mirroredKey) {
                const cr = cfg.clinicalRecords || {};
                next.config.clinicalRecords = {
                    ...cr,
                    history: { ...(cr.history || {}), [mirroredKey]: value }
                };
            }
            return next;
        });
    };

    const updateDemographics = (key, value) => {
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                demographics: { ...(prev.config?.demographics || {}), [key]: value }
            }
        }));
    };

    const applyPersonaDefaults = () => {
        setCaseData(prev => ({
            ...prev,
            name: 'Angina Pectoris - 62M',
            description: 'A 62-year-old male presenting with classic angina pectoris. Known history of hypertension and hyperlipidemia. Experiencing substernal chest pressure with radiation to the left arm, triggered by exertion and relieved by rest. Risk factors include smoking history (30 pack-years, quit 5 years ago) and family history of coronary artery disease.',
            system_prompt: `You are Richard Thompson, a 62-year-old male accountant presenting with chest pain. 

CURRENT SYMPTOMS:
- Substernal chest pressure (6/10 severity), feels like "squeezing" or "tightness"
- Started 2 hours ago after climbing stairs at work
- Radiates to left arm and jaw
- Associated with mild shortness of breath and sweating
- Partially relieved by rest

MEDICAL HISTORY:
- Hypertension (controlled on amlodipine 5mg daily)
- Hyperlipidemia (on atorvastatin 40mg daily)
- No diabetes
- Previous episodes of similar chest pain over past 3 months, but less severe
- Smoking: 30 pack-year history, quit 5 years ago
- Family history: Father had MI at age 58

CURRENT MEDICATIONS:
- Amlodipine 5mg once daily
- Atorvastatin 40mg once daily
- Aspirin 81mg daily

ALLERGIES: No known drug allergies

SOCIAL HISTORY:
- Occupation: Accountant (sedentary job)
- Lives with wife, two adult children
- Occasional alcohol (1-2 drinks per week)
- No current tobacco or recreational drug use

PERSONALITY: You are anxious but cooperative. You're worried this might be a heart attack because of your father's history. You answer questions directly but sometimes ramble when nervous. You appreciate clear explanations and want to understand what's happening.`,
            config: {
                ...prev.config,
                persona_type: 'Standard Simulated Patient',
                constraints: 'Stick to the provided history. If asked about tests or values, say you don\'t remember exact numbers unless specifically mentioned. Express appropriate concern about cardiac symptoms. Do not volunteer diagnosis - let the doctor make conclusions.',
                greeting: 'Doctor, I\'ve been having this pressure in my chest... it\'s really worrying me.',
                patient_name: 'Richard Thompson',
                demographics: {
                    age: 62,
                    gender: 'Male',
                    weight: '85 kg',
                    height: '175 cm',
                    bmi: '27.8'
                },
                // Initial vitals - stable angina
                hr: 88,
                spo2: 97,
                rr: 18,
                temp: 36.8,
                sbp: 145,
                dbp: 88,
                etco2: 38,
                // Clinical records for angina pectoris
                clinical_records: {
                    chief_complaint: 'Chest pain and pressure for 2 hours',
                    present_illness: `Patient is a 62-year-old male with history of hypertension and hyperlipidemia presenting with substernal chest pressure that began 2 hours ago after climbing 3 flights of stairs at work. Describes sensation as "squeezing" or "tight band around chest" rated 6/10 severity. Pain radiates to left arm and occasionally to jaw. Associated with diaphoresis and mild dyspnea. Reports similar but milder episodes over past 3 months, typically triggered by exertion and relieved by rest within 5-10 minutes. Today's episode more severe and lasted 20 minutes before partially improving with rest. Denies nausea, vomiting, palpitations, syncope, or loss of consciousness.`,
                    risk_factors: [
                        'Hypertension (on treatment)',
                        'Hyperlipidemia (on statin)',
                        'Former smoker (30 pack-years, quit 5 years ago)',
                        'Family history of premature CAD (father MI at 58)',
                        'Male gender',
                        'Age > 60',
                        'Sedentary lifestyle',
                        'Overweight (BMI 27.8)'
                    ],
                    physical_exam: {
                        general: 'Alert, oriented, appears anxious, diaphoretic',
                        cardiovascular: 'Regular rate and rhythm, no murmurs, rubs, or gallops. Normal S1/S2. No JVD. Peripheral pulses 2+ and equal bilaterally.',
                        respiratory: 'Clear to auscultation bilaterally, no wheezes or crackles',
                        abdomen: 'Soft, non-tender, no organomegaly',
                        extremities: 'No edema, no cyanosis'
                    },
                    differential_diagnosis: [
                        'Stable angina pectoris (most likely)',
                        'Unstable angina',
                        'NSTEMI',
                        'GERD',
                        'Musculoskeletal chest pain',
                        'Anxiety/panic attack'
                    ],
                    management_plan: [
                        'Obtain 12-lead ECG',
                        'Cardiac biomarkers (Troponin I/T, CK-MB)',
                        'Complete metabolic panel',
                        'Lipid panel',
                        'CBC',
                        'Chest X-ray',
                        'Consider stress test if biomarkers negative',
                        'Optimize anti-anginal medications',
                        'Cardiology consultation if indicated'
                    ]
                }
            }
        }));
    };

    const WIZARD_STEPS = [
        { num: 1,  title: t('wstep_demographics'), icon: '👤' },
        { num: 2,  title: t('wstep_avatar'),       icon: '🎭' },
        { num: 3,  title: t('wstep_story'),        icon: '📖' },
        { num: 4,  title: t('wstep_scenario'),     icon: '📈' },
        { num: 5,  title: t('wstep_vitals'),       icon: '💓' },
        { num: 6,  title: t('wstep_labs'),         icon: '🧪' },
        { num: 7,  title: t('wstep_radiology'),    icon: '📷' },
        { num: 8,  title: t('wstep_exam'),         icon: '🩺' },
        { num: 9,  title: t('wstep_records'),      icon: '📄' },
        { num: 10, title: t('wstep_treatments'),   icon: '💊' },
        { num: 11, title: t('wstep_agents'),       icon: '🤖' }
    ];

    // Helper to get vitals from scenario's first keyframe
    const getScenarioFirstFrameVitals = () => {
        const timeline = caseData.scenario?.timeline;
        if (timeline && timeline.length > 0) {
            const firstFrame = timeline.sort((a, b) => a.time - b.time)[0];
            return firstFrame.params || {};
        }
        return null;
    };

    // Check if vitals differ from scenario first frame
    const scenarioVitals = getScenarioFirstFrameVitals();
    const hasScenario = !!scenarioVitals;
    const vitalsOverridden = hasScenario && caseData.config?.initialVitals && (
        (caseData.config.initialVitals.hr && caseData.config.initialVitals.hr !== scenarioVitals.hr) ||
        (caseData.config.initialVitals.spo2 && caseData.config.initialVitals.spo2 !== scenarioVitals.spo2) ||
        (caseData.config.initialVitals.rr && caseData.config.initialVitals.rr !== scenarioVitals.rr)
    );

    return (
        <div className="flex flex-col h-full max-w-5xl animate-in fade-in slide-in-from-right-4">

            {/* Wizard Header with Step Navigation */}
            <div className="border-b border-neutral-800 pb-4 mb-6">
                {/* Resumed-from-stash banner. Auto-save persists the wizard
                    state across page reloads, but the previous behaviour
                    silently re-applied that draft on next mount with no
                    indicator — admins could mistake a stale draft for a
                    fresh load. The banner names the case the draft belongs
                    to and offers an explicit Discard button. */}
                {resumedFromStash && caseData?._stashedAt && (
                    <div className="mb-3 px-3 py-2 bg-amber-900/30 border border-amber-700/50 rounded flex items-center justify-between gap-3 text-xs">
                        <div className="text-amber-200">
                            {t('wizard_resumed_prefix')} <strong>{caseData.name || t('wizard_new_case_paren')}</strong>
                            {' '}{t('wizard_resumed_from')}{' '}
                            <span className="font-mono">{new Date(caseData._stashedAt).toLocaleString()}</span>
                            {t('wizard_resumed_suffix')}
                        </div>
                        <button
                            type="button"
                            onClick={onDiscardDraft}
                            className="shrink-0 px-2 py-1 rounded border border-amber-700 text-amber-200 hover:bg-amber-800/40 hover:text-white text-xs"
                        >
                            {t('btn_discard_draft')}
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between mb-4">
                    <div className="flex-1 mr-4">
                        <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-lg font-bold text-white whitespace-nowrap">{t('wizard_case_title')}</h3>
                            <input
                                type="text"
                                value={caseData.name}
                                onChange={e => setCaseData({ ...caseData, name: e.target.value })}
                                className="input-dark flex-1 text-lg font-semibold"
                                placeholder={t('wizard_case_title_placeholder')}
                            />
                        </div>
                        {lastSavedAt && (
                            <span className="text-[10px] text-green-500 flex items-center gap-1 ml-[105px]">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                {t('wizard_autosaved', { time: formatLastSaved() })}
                            </span>
                        )}
                    </div>
                    <div className="flex-0 mr-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onSave}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                            >
                                <Save className="w-4 h-4" />
                                {t('btn_save')}
                            </button>
                            <button
                                onClick={onCancel}
                                className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                            >
                                <X className="w-4 h-4" />
                                {t('btn_exit')}
                            </button>
                        </div>
                        {lastSavedAt && (
                            <span className="text-[10px] text-green-500 flex items-center gap-1 ml-[105px]">
                                &nbsp;
                            </span>
                        )}
                    </div>
                </div>

                {/* Clickable Step Navigation */}
                <div className="flex gap-1">
                    {WIZARD_STEPS.map((s, _idx) => (
                        <button
                            key={s.num}
                            onClick={async () => {
                                // Auto-save before switching
                                await onSave();
                                setStep(s.num);
                            }}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${step === s.num
                                ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/30'
                                : step > s.num
                                    ? 'bg-green-900/30 text-green-300 hover:bg-green-900/50 border border-green-700/50'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                                }`}
                        >
                            <span>{s.icon}</span>
                            <span className="hidden sm:inline">{s.title}</span>
                            <span className="sm:hidden">{s.num}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2">

                {/* STEP 1: DEMOGRAPHICS (EHR-style) */}
                {step === 1 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">{t('demo_step_title')}</h4>
                        <p className="text-xs text-neutral-500 -mt-4">{t('demo_step_help')}</p>

                        {/* Top Section: Basic Info (Patient Photo replaced by avatar system) */}
                        <div>
                            <div className="space-y-3">
                                <div>
                                    <label className="label-xs">{t('demo_patient_name')} <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={caseData.config?.patient_name || ''}
                                        onChange={e => updateConfig('patient_name', e.target.value)}
                                        className="input-dark"
                                        placeholder={t('demo_patient_name_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_mrn')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.mrn || ''}
                                        onChange={e => updateDemographics('mrn', e.target.value)}
                                        className="input-dark"
                                        placeholder={t('demo_mrn_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs flex items-center gap-2">
                                        {t('demo_case_language')}
                                        {caseData.case_code && (
                                            <span
                                                className="px-1.5 py-0.5 font-mono text-[10px] rounded border border-neutral-600 bg-neutral-800 text-neutral-300"
                                                title={t('case_code_title')}
                                            >
                                                {caseData.case_code}
                                            </span>
                                        )}
                                    </label>
                                    {/* Case language is IMMUTABLE: pick it at creation, locked
                                        afterwards (the server ignores changes anyway — the case's
                                        dialogue behavior and its case_code prefix never change). */}
                                    <select
                                        value={caseData.config?.case_language || 'en'}
                                        onChange={e => updateConfig('case_language', e.target.value)}
                                        disabled={Boolean(caseData.id)}
                                        className="input-dark disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {Object.entries(LANGUAGES).map(([code, lang]) => (
                                            <option key={code} value={code}>{lang.flag} {lang.native} ({code})</option>
                                        ))}
                                    </select>
                                    <p className="text-[11px] text-neutral-500 mt-1">
                                        {t('demo_case_language_help')}
                                    </p>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="label-xs">{t('demo_dob')}</label>
                                        <input
                                            type="date"
                                            value={caseData.config?.demographics?.dob || ''}
                                            onChange={e => updateDemographics('dob', e.target.value)}
                                            className="input-dark"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">{t('demo_age')}</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="120"
                                            value={caseData.config?.demographics?.age ?? ''}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                if (raw === '') {
                                                    updateDemographics('age', null);
                                                    return;
                                                }
                                                const n = parseInt(raw, 10);
                                                // Persist only finite integers in 0..120; otherwise
                                                // keep the previous value so a stray character can't
                                                // poison downstream voice/avatar slot derivation.
                                                if (Number.isFinite(n) && n >= 0 && n <= 120) {
                                                    updateDemographics('age', n);
                                                }
                                            }}
                                            className="input-dark"
                                            placeholder={t('demo_age_placeholder')}
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">{t('demo_gender')}</label>
                                        <select
                                            value={caseData.config?.demographics?.gender || ''}
                                            onChange={e => updateDemographics('gender', e.target.value)}
                                            className="input-dark"
                                        >
                                            <option value="">{t('demo_select')}</option>
                                            <option>{t('demo_gender_male')}</option>
                                            <option>{t('demo_gender_female')}</option>
                                            <option>{t('demo_gender_other')}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Physical Measurements */}
                        <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">{t('demo_physical_measurements')}</h5>
                            <div className="grid grid-cols-4 gap-3">
                                <div>
                                    <label className="label-xs">{t('demo_height')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.demographics?.height || ''}
                                        onChange={e => updateDemographics('height', e.target.value)}
                                        className="input-dark"
                                        placeholder="170"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_weight')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.demographics?.weight || ''}
                                        onChange={e => updateDemographics('weight', e.target.value)}
                                        className="input-dark"
                                        placeholder="70"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_bmi')}</label>
                                    <input
                                        type="text"
                                        value={
                                            caseData.config?.demographics?.height && caseData.config?.demographics?.weight
                                                ? (caseData.config.demographics.weight / Math.pow(caseData.config.demographics.height / 100, 2)).toFixed(1)
                                                : ''
                                        }
                                        className="input-dark bg-neutral-900"
                                        readOnly
                                        placeholder={t('demo_bmi_auto')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_blood_type')}</label>
                                    <select
                                        value={caseData.config?.demographics?.bloodType || ''}
                                        onChange={e => updateDemographics('bloodType', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option value="">{t('demo_blood_unknown')}</option>
                                        <option>A+</option>
                                        <option>A-</option>
                                        <option>B+</option>
                                        <option>B-</option>
                                        <option>AB+</option>
                                        <option>AB-</option>
                                        <option>O+</option>
                                        <option>O-</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Additional Demographics */}
                        <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">{t('demo_additional_info')}</h5>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="label-xs">{t('demo_language')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.language || ''}
                                        onChange={e => updateDemographics('language', e.target.value)}
                                        className="input-dark"
                                        placeholder={t('demo_language_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_ethnicity')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.ethnicity || ''}
                                        onChange={e => updateDemographics('ethnicity', e.target.value)}
                                        className="input-dark"
                                        placeholder={t('demo_ethnicity_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_occupation')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.occupation || ''}
                                        onChange={e => updateDemographics('occupation', e.target.value)}
                                        className="input-dark"
                                        placeholder={t('demo_occupation_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_marital')}</label>
                                    <select
                                        value={caseData.config?.demographics?.maritalStatus || ''}
                                        onChange={e => updateDemographics('maritalStatus', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option value="">{t('demo_select')}</option>
                                        <option>{t('demo_marital_single')}</option>
                                        <option>{t('demo_marital_married')}</option>
                                        <option>{t('demo_marital_divorced')}</option>
                                        <option>{t('demo_marital_widowed')}</option>
                                        <option>{t('demo_marital_separated')}</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Emergency Contact */}
                        <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">{t('demo_emergency_contact')}</h5>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="label-xs">{t('demo_contact_name')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.name || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, name: e.target.value })}
                                        className="input-dark"
                                        placeholder={t('demo_contact_name_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_relationship')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.relationship || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, relationship: e.target.value })}
                                        className="input-dark"
                                        placeholder={t('demo_relationship_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('demo_phone')}</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.phone || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, phone: e.target.value })}
                                        className="input-dark"
                                        placeholder={t('demo_phone_placeholder')}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Known Allergies */}
                        <div>
                            <label className="label-xs">{t('demo_allergies')}</label>
                            <input
                                type="text"
                                value={caseData.config?.demographics?.allergies || ''}
                                onChange={e => updateDemographics('allergies', e.target.value)}
                                className="input-dark"
                                placeholder={t('demo_allergies_placeholder')}
                            />
                            <p className="text-[10px] text-neutral-500 mt-1">{t('demo_allergies_help')}</p>
                        </div>
                    </div>
                )}

                {/* STEP 2: AVATAR & VOICE — camera framing, voice file, speed, pitch.
                    Inherits from the platform's per-gender persona defaults when fields
                    are left blank (configured under admin → Avatars). */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div>
                            <h4 className="text-lg font-bold text-teal-400">{t('avatar_step_title')}</h4>
                            <p className="text-xs text-neutral-500">
                                {t('avatar_step_help')}
                            </p>
                        </div>
                        <CaseAvatarVoicePicker caseData={caseData} setCaseData={setCaseData} />
                    </div>
                )}

                {/* STEP 3: STORY */}
                {step === 3 && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-end">
                            <div>
                                <h4 className="text-lg font-bold text-teal-400">{t('story_step_title')}</h4>
                                <p className="text-xs text-neutral-500">{t('story_step_help')}</p>
                            </div>
                            <button onClick={applyPersonaDefaults} className="text-xs bg-neutral-800 hover:bg-neutral-700 px-3 py-1 rounded text-teal-300">
                                {t('btn_load_defaults')}
                            </button>
                        </div>

                        {/* Personality Section */}
                        <div className="bg-gradient-to-r from-teal-900/20 to-blue-900/20 rounded-lg p-4 border border-teal-700/30">
                            <h5 className="text-sm font-bold text-teal-300 mb-3">{t('story_personality')}</h5>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">{t('story_persona_type')}</label>
                                    <select
                                        value={caseData.config?.persona_type || 'Standard Simulated Patient'}
                                        onChange={e => updateConfig('persona_type', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option>{t('persona_standard')}</option>
                                        <option>{t('persona_difficult')}</option>
                                        <option>{t('persona_anxious')}</option>
                                        <option>{t('persona_depressed')}</option>
                                        <option>{t('persona_elderly')}</option>
                                        <option>{t('persona_pediatric')}</option>
                                        <option>{t('persona_noncompliant')}</option>
                                        <option>{t('persona_drugseeking')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">{t('story_comm_style')}</label>
                                    <select
                                        value={caseData.config?.personality?.communicationStyle || 'normal'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, communicationStyle: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="normal">{t('comm_normal')}</option>
                                        <option value="verbose">{t('comm_verbose')}</option>
                                        <option value="brief">{t('comm_brief')}</option>
                                        <option value="tangential">{t('comm_tangential')}</option>
                                        <option value="guarded">{t('comm_guarded')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">{t('story_emotional_state')}</label>
                                    <select
                                        value={caseData.config?.personality?.emotionalState || 'neutral'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, emotionalState: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="neutral">{t('emo_neutral')}</option>
                                        <option value="calm">{t('emo_calm')}</option>
                                        <option value="anxious">{t('emo_anxious')}</option>
                                        <option value="fearful">{t('emo_fearful')}</option>
                                        <option value="angry">{t('emo_angry')}</option>
                                        <option value="sad">{t('emo_sad')}</option>
                                        <option value="stoic">{t('emo_stoic')}</option>
                                        <option value="distressed">{t('emo_distressed')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">{t('story_pain_tolerance')}</label>
                                    <select
                                        value={caseData.config?.personality?.painTolerance || 'normal'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, painTolerance: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="high">{t('pain_high')}</option>
                                        <option value="normal">{t('comm_normal')}</option>
                                        <option value="low">{t('pain_low')}</option>
                                        <option value="dramatic">{t('pain_dramatic')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">{t('story_cooperativeness')}</label>
                                    <select
                                        value={caseData.config?.personality?.cooperativeness || 'cooperative'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, cooperativeness: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="very_cooperative">{t('coop_very')}</option>
                                        <option value="cooperative">{t('coop_cooperative')}</option>
                                        <option value="neutral">{t('emo_neutral')}</option>
                                        <option value="reluctant">{t('coop_reluctant')}</option>
                                        <option value="uncooperative">{t('coop_uncooperative')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">{t('story_health_literacy')}</label>
                                    <select
                                        value={caseData.config?.personality?.healthLiteracy || 'average'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, healthLiteracy: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="high">{t('lit_high')}</option>
                                        <option value="average">{t('lit_average')}</option>
                                        <option value="low">{t('lit_low')}</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Initial Greeting & Constraints */}
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="label-xs">{t('story_greeting')}</label>
                                <input
                                    type="text"
                                    value={caseData.config?.greeting || ''}
                                    onChange={e => updateConfig('greeting', e.target.value)}
                                    className="input-dark"
                                    placeholder={t('story_greeting_placeholder')}
                                />
                                <p className="text-[10px] text-neutral-500 mt-1">{t('story_greeting_help')}</p>
                            </div>
                            <div>
                                <label className="label-xs">{t('story_constraints')}</label>
                                <textarea
                                    value={caseData.config?.constraints || ''}
                                    onChange={e => updateConfig('constraints', e.target.value)}
                                    className="input-dark h-20"
                                    placeholder={t('story_constraints_placeholder')}
                                />
                                <p className="text-[10px] text-neutral-500 mt-1">{t('story_constraints_help')}</p>
                            </div>
                        </div>

                        {/* Story Mode Toggle */}
                        <div className="border-t border-neutral-700 pt-4">
                            <div className="flex items-center justify-between mb-4">
                                <h5 className="text-sm font-bold text-neutral-300">{t('story_patient_story')}</h5>
                                <div className="flex bg-neutral-800 rounded-lg p-1">
                                    {/* Mode-switch handlers clear the unused mode's data after
                                        confirmation. Without this, the runtime would see both a
                                        freeform system_prompt AND structured history (mirrored to
                                        clinicalRecords.history) at once — doubling the AI context
                                        and producing inconsistent patient behaviour. */}
                                    <button
                                        onClick={async () => {
                                            const current = caseData.config?.storyMode || 'freeform';
                                            if (current === 'freeform') return;
                                            const sh = caseData.config?.structuredHistory || {};
                                            const hasStructured = Object.values(sh).some(v => v && String(v).trim());
                                            if (hasStructured) {
                                                const ok = await toast.confirm(
                                                    t('confirm_switch_freeform'),
                                                    { title: t('confirm_switch_freeform_title'), confirmText: t('btn_switch'), type: 'warning' }
                                                );
                                                if (!ok) return;
                                            }
                                            setCaseData(prev => {
                                                const cfg = { ...(prev.config || {}) };
                                                cfg.storyMode = 'freeform';
                                                delete cfg.structuredHistory;
                                                if (cfg.clinicalRecords?.history) {
                                                    cfg.clinicalRecords = { ...cfg.clinicalRecords, history: {} };
                                                }
                                                return { ...prev, config: cfg };
                                            });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition-colors ${(caseData.config?.storyMode || 'freeform') === 'freeform'
                                            ? 'bg-teal-600 text-white'
                                            : 'text-neutral-400 hover:text-white'
                                            }`}
                                    >
                                        {t('story_mode_freeform')}
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const current = caseData.config?.storyMode || 'freeform';
                                            if (current === 'structured') return;
                                            const hasFreeform = !!(caseData.system_prompt && caseData.system_prompt.trim());
                                            if (hasFreeform) {
                                                const ok = await toast.confirm(
                                                    t('confirm_switch_structured'),
                                                    { title: t('confirm_switch_structured_title'), confirmText: t('btn_switch'), type: 'warning' }
                                                );
                                                if (!ok) return;
                                            }
                                            setCaseData(prev => ({
                                                ...prev,
                                                system_prompt: '',
                                                config: { ...(prev.config || {}), storyMode: 'structured' }
                                            }));
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition-colors ${caseData.config?.storyMode === 'structured'
                                            ? 'bg-teal-600 text-white'
                                            : 'text-neutral-400 hover:text-white'
                                            }`}
                                    >
                                        {t('story_mode_structured')}
                                    </button>
                                </div>
                            </div>

                            {/* Freeform Mode */}
                            {(caseData.config?.storyMode || 'freeform') === 'freeform' && (
                                <div>
                                    <label className="label-xs">{t('story_complete_prompt')}</label>
                                    <textarea
                                        value={caseData.system_prompt || ''}
                                        onChange={e => setCaseData({ ...caseData, system_prompt: e.target.value })}
                                        className="input-dark h-64 font-mono text-xs"
                                        placeholder={t('story_complete_prompt_placeholder')}
                                    />
                                    <p className="text-[10px] text-neutral-500 mt-1">{t('story_complete_prompt_help')}</p>
                                </div>
                            )}

                            {/* Structured Mode */}
                            {caseData.config?.storyMode === 'structured' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="label-xs">{t('story_chief_complaint')}</label>
                                        <input
                                            type="text"
                                            value={caseData.config?.structuredHistory?.chiefComplaint || ''}
                                            onChange={e => updateStructuredHistoryField('chiefComplaint', e.target.value)}
                                            className="input-dark"
                                            placeholder={t('story_chief_complaint_placeholder')}
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">{t('story_hpi')}</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.hpi || ''}
                                            onChange={e => updateStructuredHistoryField('hpi', e.target.value)}
                                            className="input-dark h-24"
                                            placeholder={t('story_hpi_placeholder')}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">{t('story_pmh')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.pmh || ''}
                                                onChange={e => updateStructuredHistoryField('pmh', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_pmh_placeholder')}
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">{t('story_psh')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.psh || ''}
                                                onChange={e => updateStructuredHistoryField('psh', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_psh_placeholder')}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">{t('story_medications')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.medications || ''}
                                                onChange={e => updateStructuredHistoryField('medications', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_medications_placeholder')}
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">{t('story_allergies')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.allergies || ''}
                                                onChange={e => updateStructuredHistoryField('allergies', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_allergies_placeholder')}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">{t('story_social')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.socialHistory || ''}
                                                onChange={e => updateStructuredHistoryField('socialHistory', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_social_placeholder')}
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">{t('story_family')}</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.familyHistory || ''}
                                                onChange={e => updateStructuredHistoryField('familyHistory', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder={t('story_family_placeholder')}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label-xs">{t('story_ros')}</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.ros || ''}
                                            onChange={e => updateStructuredHistoryField('ros', e.target.value)}
                                            className="input-dark h-20"
                                            placeholder={t('story_ros_placeholder')}
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">{t('story_additional_notes')}</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.additionalNotes || ''}
                                            onChange={e => updateStructuredHistoryField('additionalNotes', e.target.value)}
                                            className="input-dark h-16"
                                            placeholder={t('story_additional_notes_placeholder')}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Case Description */}
                        <div className="border-t border-neutral-700 pt-4">
                            <label className="label-xs">{t('story_case_summary')}</label>
                            <textarea
                                value={caseData.description || ''}
                                onChange={e => setCaseData({ ...caseData, description: e.target.value })}
                                className="input-dark h-16"
                                placeholder={t('story_case_summary_placeholder')}
                            />
                        </div>
                    </div>
                )}

                {/* STEP 4: VITALS & ALARMS */}
                {step === 5 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">{t('vitals_step_title')}</h4>

                        {/* Scenario/Vitals status indicator */}
                        <div className={`p-3 rounded-lg border ${hasScenario
                            ? (vitalsOverridden ? 'bg-orange-900/20 border-orange-700/50' : 'bg-blue-900/20 border-blue-700/50')
                            : (caseData.config?.initialVitals ? 'bg-green-900/20 border-green-700/50' : 'bg-neutral-800 border-neutral-700')
                            }`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {hasScenario ? (
                                        vitalsOverridden ? (
                                            <>
                                                <span className="text-orange-400 font-bold text-sm">{t('vitals_override_mode')}</span>
                                                <span className="text-xs text-orange-300">{t('vitals_override_mode_note')}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-blue-400 font-bold text-sm">{t('vitals_reading_scenario')}</span>
                                                <span className="text-xs text-blue-300">{t('vitals_reading_scenario_note')}</span>
                                            </>
                                        )
                                    ) : (
                                        caseData.config?.initialVitals ? (
                                            <>
                                                <span className="text-green-400 font-bold text-sm">{t('vitals_custom_set')}</span>
                                                <span className="text-xs text-green-300">{t('vitals_custom_set_note')}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-neutral-400 font-bold text-sm">{t('vitals_default')}</span>
                                                <span className="text-xs text-neutral-500">{t('vitals_default_note')}</span>
                                            </>
                                        )
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {hasScenario && vitalsOverridden && (
                                        <button
                                            onClick={() => {
                                                // Clear initial vitals to reset to scenario
                                                setCaseData(prev => ({
                                                    ...prev,
                                                    config: {
                                                        ...prev.config,
                                                        initialVitals: null
                                                    }
                                                }));
                                            }}
                                            className="px-3 py-1 text-xs font-bold bg-orange-600 hover:bg-orange-500 text-white rounded"
                                        >
                                            {t('btn_reset_scenario')}
                                        </button>
                                    )}
                                    {!hasScenario && caseData.config?.initialVitals && (
                                        <button
                                            onClick={() => {
                                                // Clear initial vitals to use defaults
                                                setCaseData(prev => ({
                                                    ...prev,
                                                    config: {
                                                        ...prev.config,
                                                        initialVitals: null
                                                    }
                                                }));
                                            }}
                                            className="px-3 py-1 text-xs font-bold bg-neutral-600 hover:bg-neutral-500 text-white rounded"
                                        >
                                            {t('btn_reset_defaults')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Alarm Thresholds - TOP */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">{t('vitals_alarm_thresholds')}</h5>
                            <p className="text-xs text-neutral-500 mb-4">{t('vitals_alarm_help')}</p>

                            <div className="space-y-3">
                                {[
                                    { key: 'hr', label: t('vital_hr'), unit: 'bpm', defaultLow: 50, defaultHigh: 120 },
                                    { key: 'spo2', label: t('vital_spo2'), unit: '%', defaultLow: 90, defaultHigh: null },
                                    { key: 'rr', label: t('vital_rr'), unit: '/min', defaultLow: 8, defaultHigh: 30 },
                                    { key: 'bpSys', label: t('vital_bp_sys'), unit: 'mmHg', defaultLow: 90, defaultHigh: 180 },
                                    { key: 'bpDia', label: t('vital_bp_dia'), unit: 'mmHg', defaultLow: 50, defaultHigh: 110 },
                                    { key: 'temp', label: t('vital_temp'), unit: '°C', defaultLow: 36, defaultHigh: 38.5 },
                                    { key: 'etco2', label: t('vital_etco2'), unit: 'mmHg', defaultLow: 30, defaultHigh: 50 }
                                ].map(vital => (
                                    <div key={vital.key} className="grid grid-cols-4 gap-2 items-center">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={caseData.config?.alarms?.[vital.key]?.enabled ?? true}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), enabled: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                            />
                                            <span className="text-xs text-neutral-300">{vital.label}</span>
                                        </label>
                                        <div>
                                            <input
                                                type="number"
                                                placeholder={t('vitals_low', { value: vital.defaultLow || '-' })}
                                                value={caseData.config?.alarms?.[vital.key]?.low ?? ''}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), low: e.target.value ? parseFloat(e.target.value) : null }
                                                })}
                                                className="input-dark text-xs"
                                            />
                                        </div>
                                        <div>
                                            <input
                                                type="number"
                                                placeholder={t('vitals_high', { value: vital.defaultHigh || '-' })}
                                                value={caseData.config?.alarms?.[vital.key]?.high ?? ''}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), high: e.target.value ? parseFloat(e.target.value) : null }
                                                })}
                                                className="input-dark text-xs"
                                            />
                                        </div>
                                        <span className="text-xs text-neutral-500">{vital.unit}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Vital Signs - Read from scenario or manual override */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h5 className="text-sm font-bold text-white">{t('vitals_signs')}</h5>
                                {hasScenario && !vitalsOverridden && (
                                    <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded">{t('vitals_from_scenario')}</span>
                                )}
                                {vitalsOverridden && (
                                    <span className="text-xs text-orange-400 bg-orange-900/30 px-2 py-1 rounded">{t('vitals_override_badge')}</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">{t('vital_hr_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.hr ?? scenarioVitals?.hr ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), hr: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="250"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('vital_spo2_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.spo2 ?? scenarioVitals?.spo2 ?? 98}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), spo2: parseInt(e.target.value) || 98 })}
                                        className="input-dark"
                                        min="50" max="100"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('vital_rr_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.rr ?? scenarioVitals?.rr ?? 16}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), rr: parseInt(e.target.value) || 16 })}
                                        className="input-dark"
                                        min="4" max="60"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('vital_temp_full')}</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={caseData.config?.initialVitals?.temp ?? scenarioVitals?.temp ?? 37.0}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), temp: parseFloat(e.target.value) || 37.0 })}
                                        className="input-dark"
                                        min="32" max="42"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('vital_bp_sys_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpSys ?? scenarioVitals?.bpSys ?? 120}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpSys: parseInt(e.target.value) || 120 })}
                                        className="input-dark"
                                        min="40" max="300"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">{t('vital_bp_dia_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpDia ?? scenarioVitals?.bpDia ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpDia: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="200"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="label-xs">{t('vital_etco2_full')}</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.etco2 ?? scenarioVitals?.etco2 ?? 38}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), etco2: parseInt(e.target.value) || 38 })}
                                        className="input-dark"
                                        min="0" max="100"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* ECG Rhythm */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">{t('ecg_rhythm')}</h5>
                            <div className="grid grid-cols-3 gap-2">
                                {['NSR', 'Sinus Tachycardia', 'Sinus Bradycardia', 'Atrial Fibrillation', 'Atrial Flutter', 'SVT', 'Ventricular Tachycardia', 'Ventricular Fibrillation', 'Asystole'].map(r => (
                                    <button
                                        key={r}
                                        onClick={() => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), rhythm: r })}
                                        className={`px-3 py-2 rounded text-xs font-bold transition-all ${(caseData.config?.initialVitals?.rhythm || 'NSR') === r
                                            ? 'bg-teal-600 text-white'
                                            : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                                            }`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ECG Conditions */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">{t('ecg_conditions')}</h5>
                            <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.pvc || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), pvc: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">{t('ecg_pvc')}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.wideQRS || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), wideQRS: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">{t('ecg_wide_qrs')}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.tInv || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), tInv: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">{t('ecg_t_inv')}</span>
                                </label>
                                <div>
                                    <label className="label-xs">{t('ecg_st_elev')}</label>
                                    <input
                                        type="range"
                                        min="0" max="5" step="1"
                                        value={caseData.config?.initialVitals?.conditions?.stElev || 0}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), stElev: parseInt(e.target.value) }
                                        })}
                                        className="w-full"
                                    />
                                    <div className="text-xs text-neutral-400 text-center">{caseData.config?.initialVitals?.conditions?.stElev || 0}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 3: SCENARIO (OPTIONAL) */}
                {step === 4 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">{t('scen_step_title')}</h4>
                        <p className="text-xs text-neutral-500">{t('scen_step_help')}</p>

                        {/* Scenario Selector */}
                        <div className="space-y-4">
                            {/* Repository Browser */}
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <h5 className="text-sm font-bold text-blue-300">{t('scen_repository')}</h5>
                                        <p className="text-xs text-neutral-400">{t('scen_repository_help')}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Switch to scenarios tab
                                            setActiveTab('scenarios');
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold flex items-center gap-2"
                                    >
                                        <Database className="w-4 h-4" />
                                        {t('btn_browse_repository')}
                                    </button>
                                </div>
                                {(caseData.scenario_from_repository || caseData.scenario_template || caseData.scenario?.source) && (() => {
                                    // Scenario provenance can live in three places now:
                                    //   - scenario.source (canonical, server-persisted)
                                    //   - top-level scenario_from_repository (legacy + in-flight edits)
                                    //   - top-level scenario_template (legacy + in-flight edits)
                                    // Prefer the persisted scenario.source so a save+reload shows the
                                    // same indicator the admin saw before saving.
                                    const sourceMeta = caseData.scenario?.source;
                                    const isRepo = sourceMeta?.kind === 'repository' || !!caseData.scenario_from_repository;
                                    const name = isRepo
                                        ? (caseData.scenario_from_repository?.name || sourceMeta?.name)
                                        : (SCENARIO_TEMPLATES[caseData.scenario_template]?.name
                                           || SCENARIO_TEMPLATES[sourceMeta?.id]?.name);
                                    const source = isRepo ? t('scen_source_repository') : t('scen_source_builtin');
                                    return (
                                        <div className="mt-3 bg-green-900/20 border border-green-700/50 rounded p-3 flex items-center justify-between gap-3">
                                            <p className="text-xs text-green-300">
                                                ✓ <span className="text-green-400">[{source}]</span> <strong>{name}</strong>
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setCaseData(prev => ({
                                                    ...prev,
                                                    scenario: null,
                                                    scenario_duration: undefined,
                                                    scenario_template: null,
                                                    scenario_from_repository: null
                                                }))}
                                                className="shrink-0 text-xs px-2 py-1 rounded border border-red-700 text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
                                            >
                                                {t('btn_remove')}
                                            </button>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* OR divider */}
                            <div className="flex items-center gap-4 text-neutral-500 text-xs">
                                <div className="flex-1 border-t border-neutral-700"></div>
                                <span>{t('scen_or_quick')}</span>
                                <div className="flex-1 border-t border-neutral-700"></div>
                            </div>

                            <div>
                                <label className="label-xs">{t('scen_quick_templates')}</label>
                                <select
                                    value={caseData.scenario_from_repository ? '_repository' : (caseData.scenario_template || 'none')}
                                    onChange={async (e) => {
                                        const val = e.target.value;
                                        // If a scenario is already attached, picking a different
                                        // template silently clobbers the current timeline. Confirm
                                        // first so admins don't lose customised scenarios.
                                        const currentlyHasScenario = !!caseData.scenario;
                                        if (currentlyHasScenario && val !== '_repository') {
                                            const ok = await toast.confirm(
                                                t('confirm_replace_scenario'),
                                                { title: t('confirm_replace_scenario_title'), confirmText: t('btn_replace'), type: 'warning' }
                                            );
                                            if (!ok) {
                                                e.target.value = caseData.scenario_from_repository
                                                    ? '_repository'
                                                    : (caseData.scenario_template || 'none');
                                                return;
                                            }
                                        }
                                        if (val === 'none') {
                                            setCaseData(prev => ({ ...prev, scenario_template: null, scenario: null, scenario_duration: undefined, scenario_from_repository: null }));
                                        } else if (val === '_repository') {
                                            // no-op — already applied via repository panel
                                        } else if (val.startsWith('_db_')) {
                                            const id = parseInt(val.replace('_db_', ''), 10);
                                            const s = publicScenarios.find(x => x.id === id);
                                            if (s) {
                                                setCaseData(prev => ({
                                                    ...prev,
                                                    scenario: { enabled: true, autoStart: false, timeline: s.timeline },
                                                    scenario_duration: s.duration_minutes,
                                                    scenario_template: null,
                                                    scenario_from_repository: { id: s.id, name: s.name }
                                                }));
                                            }
                                        } else {
                                            const tmpl = SCENARIO_TEMPLATES[val];
                                            const dur = tmpl?.duration || 30;
                                            setCaseData(prev => ({
                                                ...prev,
                                                scenario_template: val,
                                                scenario_duration: dur,
                                                scenario: tmpl ? scaleScenarioTimeline(tmpl, dur) : null,
                                                scenario_from_repository: null
                                            }));
                                        }
                                    }}
                                    className="input-dark"
                                >
                                    <option value="none">{t('scen_no_scenario')}</option>
                                    {caseData.scenario_from_repository && (
                                        <option value="_repository">
                                            {t('scen_option_repository', { name: caseData.scenario_from_repository.name })}
                                        </option>
                                    )}
                                    {publicScenarios.length > 0 && (
                                        <optgroup label={t('scen_public_scenarios')}>
                                            {publicScenarios.map(s => (
                                                <option key={s.id} value={`_db_${s.id}`}>
                                                    {s.name}{s.category ? ` — ${s.category}` : ''}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                    <optgroup label={t('scen_builtin_templates')}>
                                        {Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => (
                                            <option key={key} value={key}>
                                                {template.name} - {template.description}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                                <p className="text-xs text-neutral-500 mt-1">
                                    {caseData.scenario_from_repository
                                        ? t('scen_using_repository')
                                        : t('scen_choose')}
                                </p>
                            </div>

                            {/* Duration Selector — only for built-in templates, not repository scenarios */}
                            {caseData.scenario_template && caseData.scenario_template !== 'none' && (
                                <div>
                                    <label className="label-xs">{t('scen_duration')}</label>
                                    <select
                                        value={caseData.scenario_duration || 30}
                                        onChange={(e) => {
                                            const duration = parseInt(e.target.value);
                                            const template = SCENARIO_TEMPLATES[caseData.scenario_template];
                                            if (template) {
                                                const scaledScenario = scaleScenarioTimeline(template, duration);
                                                setCaseData(prev => ({
                                                    ...prev,
                                                    scenario_duration: duration,
                                                    scenario: scaledScenario
                                                }));
                                            }
                                        }}
                                        className="input-dark"
                                    >
                                        <option value="5">{t('dur_very_fast')}</option>
                                        <option value="10">{t('dur_fast')}</option>
                                        <option value="15">{t('dur_15')}</option>
                                        <option value="20">{t('dur_20')}</option>
                                        <option value="30">{t('dur_standard')}</option>
                                        <option value="45">{t('dur_45')}</option>
                                        <option value="60">{t('dur_60')}</option>
                                        <option value="90">{t('dur_90')}</option>
                                        <option value="120">{t('dur_120')}</option>
                                    </select>
                                    <p className="text-xs text-neutral-500 mt-1">
                                        {t('scen_duration_note', { minutes: caseData.scenario_duration })}
                                    </p>
                                </div>
                            )}

                            {/* Preview */}
                            {caseData.scenario?.timeline && (
                                <div className="mt-4 bg-neutral-800 border border-neutral-700 rounded p-4">
                                    <h5 className="text-sm font-bold mb-2 text-teal-300">{t('scen_timeline_preview')}</h5>
                                    <div className="space-y-2 text-xs">
                                        {caseData.scenario.timeline.map((step, idx) => (
                                            <div key={idx} className="flex items-start gap-3 text-neutral-300">
                                                <span className="text-teal-400 font-mono min-w-[60px]">
                                                    {Math.floor(step.time / 60)}:{String(step.time % 60).padStart(2, '0')}
                                                </span>
                                                <span>{step.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Auto-start option */}
                            {caseData.scenario && (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="autostart-scenario"
                                        checked={caseData.scenario?.autoStart || false}
                                        onChange={(e) => {
                                            setCaseData(prev => ({
                                                ...prev,
                                                scenario: { ...prev.scenario, autoStart: e.target.checked }
                                            }));
                                        }}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="autostart-scenario" className="text-sm text-neutral-300">
                                        {t('scen_autostart')}
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* STEP 5: LABORATORY INVESTIGATIONS */}
                {step === 6 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">{t('labs_step_title')}</h4>
                        <p className="text-xs text-neutral-500">
                            {t('labs_step_help')}
                        </p>

                        <LabInvestigationEditor
                            caseData={caseData}
                            setCaseData={setCaseData}
                            patientGender={caseData.config?.demographics?.gender}
                        />
                    </div>
                )}

                {/* STEP 6: RADIOLOGY STUDIES */}
                {step === 7 && (
                    <RadiologyEditor
                        caseData={caseData}
                        setCaseData={setCaseData}
                    />
                )}

                {/* STEP 7: PHYSICAL EXAMINATION */}
                {step === 8 && (
                    <PhysicalExamEditor
                        caseData={caseData}
                        setCaseData={setCaseData}
                        patientGender={caseData.config?.demographics?.gender?.toLowerCase() || 'male'}
                    />
                )}

                {/* STEP 8: CLINICAL RECORDS */}
                {step === 9 && (
                    <div className="space-y-6">
                        <ClinicalRecordsEditor
                            caseData={caseData}
                            setCaseData={setCaseData}
                            updateConfig={updateConfig}
                        />

                        {/* Hidden context pages — appended to the AI patient's
                            system prompt as "PATIENT MEDICAL RECORD (Hidden
                            Context)". Pre-this-fix the runtime read these but
                            no editor surface existed, so admins couldn't
                            author them via the UI. */}
                        <PagesEditor
                            pages={Array.isArray(caseData.config?.pages) ? caseData.config.pages : []}
                            onChange={(next) => updateConfig('pages', next)}
                        />
                    </div>
                )}

                {/* STEP 9: TREATMENTS */}
                {step === 10 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">{t('treatments_step_title')}</h4>
                        <p className="text-xs text-neutral-500">
                            {t('treatments_step_help')}
                        </p>

                        <CaseTreatmentConfig
                            caseId={caseData.id}
                            caseTreatments={caseData.config?.treatments || []}
                            onUpdate={(treatments) => {
                                setCaseData(prev => ({
                                    ...prev,
                                    config: {
                                        ...prev.config,
                                        treatments
                                    }
                                }));
                            }}
                        />
                    </div>
                )}

                {/* STEP 10: AGENTS */}
                {step === 11 && (
                    <CaseAgentEditor
                        caseId={caseData.id}
                        caseData={caseData}
                        setCaseData={setCaseData}
                        onOpenPersonaEditor={onOpenPersonaEditor}
                    />
                )}

            </div>

            {/* Footer Actions */}
            <div className="pt-4 border-t border-neutral-800 flex justify-between mt-4">
                <button onClick={onCancel} className="text-neutral-500 hover:text-white px-4">{t('btn_cancel')}</button>
                <div className="flex gap-2">
                    {step > 1 && (
                        <button
                            onClick={async () => {
                                // Auto-save before going back
                                await onSave();
                                setStep(s => s - 1);
                            }}
                            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded font-bold text-sm"
                        >
                            {t('btn_back')}
                        </button>
                    )}

                    {/* Save Progress button on all steps except last */}
                    {step < 9 && (
                        <button
                            onClick={onSave}
                            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Save className="w-4 h-4" /> {t('btn_save_progress')}
                        </button>
                    )}

                    {step < 9 ? (
                        <button
                            onClick={async () => {
                                // Auto-save before moving forward
                                await onSave();
                                setStep(s => s + 1);
                            }}
                            className="px-6 py-2 bg-teal-600 hover:bg-teal-500 rounded font-bold text-sm"
                        >
                            {t('btn_next')}
                        </button>
                    ) : (
                        <button
                            onClick={async () => {
                                await onSave();
                                // Close wizard after final save
                                setTimeout(() => onCancel(), 500);
                            }}
                            className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded font-bold text-sm shadow-lg shadow-green-900/20 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" /> {t('btn_save_finish')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
