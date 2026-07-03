
import React, { useState, useEffect } from 'react';
import { Settings, Save, Plus, Cpu, FileText, Database, Image, Loader2, Upload, Users, ClipboardList, Download, X, FileDown, FileUp, Layers, Activity, User, Shield, Zap, Monitor, RefreshCw, Copy, Mic, Camera, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, apiDelete, apiFetch, apiPost, apiPut } from '../../services/apiClient';
import ActivityTable from '../analytics/ActivityTable';
import SystemLogTable from '../analytics/SystemLogTable';
import ChatLogTable from '../analytics/ChatLogTable';
import SessionsTable from '../analytics/SessionsTable';
import MomentsTable from '../analytics/MomentsTable';
import TurnsTable from '../analytics/TurnsTable';
import CaseInsightsPanel from '../analytics/CaseInsightsPanel';
import ScenarioRepository from './ScenarioRepository';
import { DEFAULT_TURNAROUND_MINUTES } from '../../constants/turnaround';
import { roleLabel } from '../../constants/roleLabels';
import BodyMapDebug from '../examination/BodyMapDebug';
import LabInvestigationEditor from './LabInvestigationEditor';
import RadiologyEditor from './RadiologyEditor';
import ClinicalRecordsEditor from './ClinicalRecordsEditor';
import PhysicalExamEditor from './PhysicalExamEditor';
import LabTestManager from './LabTestManager';
import MedicationManager from './MedicationManager';
import AgentTemplateManager from './AgentTemplateManager';
import CaseTreatmentConfig from './CaseTreatmentConfig';
import VoiceSettingsTab from './VoiceSettingsTab';
import AvatarsSettingsTab from './AvatarsSettingsTab';
import NotificationsSettingsTab from './NotificationsSettingsTab';
import OyonSettingsTab from './OyonSettingsTab';
import OyonDataLogs from '../analytics/OyonDataLogs';
import CohortsManagementTab from './CohortsManagementTab';
import TnaDashboardV2 from '../analytics/tna/TnaDashboardV2';
import { Bell as BellIcon } from 'lucide-react';
import CaseAvatarVoicePicker from './CaseAvatarVoicePicker';
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
                Open Body Map Editor
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
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                </select>
                <select
                    value={view}
                    onChange={(e) => setView(e.target.value)}
                    className="bg-neutral-900 text-white p-2 rounded border border-neutral-700"
                >
                    <option value="anterior">Front (Anterior)</option>
                    <option value="posterior">Back (Posterior)</option>
                </select>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded transition-colors"
                >
                    <X className="w-4 h-4" />
                    Close editor
                </button>
            </div>
            <div className="bg-slate-900 rounded-lg overflow-hidden">
                <BodyMapDebug gender={gender} view={view} />
            </div>
        </div>
    );
}

// --- Sidebar nav model (collapsible accordion, grouped by theme) ---------
// This is pure nav-chrome: tab ids, per-tab role gating, and the content-area
// panel switch are all unchanged. The ~16 setting tabs are grouped into
// themed, collapsible sections. Group open/closed state is persisted in
// localStorage; the group that owns the active tab is force-expanded so
// `initialTab` deep-links always land on a visible item.
const OPEN_GROUPS_KEY = 'rohy.configPanel.openGroups';
const NAV_GROUP_ORDER = ['Content', 'Agents & Voice', 'People', 'Analytics', 'Capture', 'System'];
// Static tab -> group map so the force-expand effect has no render-scope
// dependencies (keeps react-hooks/exhaustive-deps happy).
const TAB_GROUP = {
    cases: 'Content', scenarios: 'Content', bodymap: 'Content', labdb: 'Content', medications: 'Content',
    agents: 'Agents & Voice', avatars: 'Agents & Voice', voice: 'Agents & Voice',
    users: 'People', cohorts: 'People',
    analytics: 'Analytics',
    oyon: 'Capture',
    platform: 'System', notifications: 'System', logs: 'System',
};

// One sidebar tab button.
function NavItem({ item, active, onSelect }) {
    const Icon = item.icon;
    return (
        <button
            onClick={() => onSelect(item.id)}
            className={`w-full px-4 py-2.5 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${active ? 'border-teal-700 bg-teal-50 text-teal-950' : 'border-transparent text-gray-700 hover:text-gray-950 hover:bg-teal-50/70'}`}
        >
            <Icon className={item.iconClass ? `w-4 h-4 ${item.iconClass}` : 'w-4 h-4'} /> {item.label}
        </button>
    );
}

// Collapsible group header: chevron + uppercase theme label.
function NavGroupHeader({ group, open, onToggle }) {
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(group)}
            className="w-full px-4 pt-3 pb-1 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 hover:text-gray-900 flex items-center gap-1.5 transition-colors"
        >
            <Chevron className="w-3 h-3" /> {group}
        </button>
    );
}

export default function ConfigPanel({ onClose, onLoadCase, fullPage = false, initialTab = 'cases', initialWizardStep = 1, onOpenPersonaEditor, onCaseSaved }) {
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

    // Accordion open/closed state for the grouped sidebar. Defaults to every
    // group expanded on first run; explicit user toggles are persisted to
    // localStorage under OPEN_GROUPS_KEY. Multiple groups may be open at once.
    const [openGroups, setOpenGroups] = useState(() => {
        let stored = {};
        try {
            stored = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY)) || {};
        } catch {
            stored = {};
        }
        return NAV_GROUP_ORDER.reduce((acc, group) => {
            acc[group] = stored[group] !== undefined ? stored[group] : true;
            return acc;
        }, {});
    });
    const toggleGroup = (group) => {
        setOpenGroups((prev) => {
            const next = { ...prev, [group]: !prev[group] };
            try {
                localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
            } catch {
                /* localStorage unavailable — accordion still works in-memory */
            }
            return next;
        });
    };
    // Force-expand the group that owns the active tab so `initialTab` deep
    // links (and any programmatic setActiveTab) always land on a visible item.
    // Derived during render (no effect) so it holds on mount AND on every
    // activeTab change, and can never be collapsed out from under the tab
    // you're currently viewing.
    const activeGroup = TAB_GROUP[activeTab];
    const isGroupOpen = (group) => Boolean(openGroups[group]) || group === activeGroup;

    // Cases State
    const [cases, setCases] = useState([]);
    const [, setSelectedCaseId] = useState(null);
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
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
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
            toast.warning('Please enter a case name before saving.');
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

            toast.success('Case saved successfully!');
            return true;

        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to save case');
            return false;
        }
    };

    const handleDeleteCase = async (caseId) => {
        const confirmed = await toast.confirm('Are you sure you want to delete this case?', { title: 'Delete Case', type: 'danger', confirmText: 'Delete' });
        if (!confirmed) return;

        try {
            await apiDelete(`/cases/${caseId}`);

            setCases(prev => prev.filter(c => c.id !== caseId));
            toast.success('Case deleted successfully!');
        } catch (err) {
            console.error(err);
            toast.error('Failed to delete case');
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
    const SECTIONS = [
        {
            group: 'Content',
            items: [
                { id: 'cases', label: admin ? 'Cases' : 'Select Case', icon: FileText, visible: true },
                { id: 'scenarios', label: 'Scenarios', icon: Layers, visible: admin },
                { id: 'bodymap', label: 'Body Map', icon: Image, visible: admin },
                { id: 'labdb', label: 'Lab Database', icon: Database, visible: admin },
                { id: 'medications', label: 'Medications', icon: Database, visible: admin },
            ],
        },
        {
            group: 'Agents & Voice',
            items: [
                { id: 'agents', label: 'Agents', icon: Users, visible: admin },
                { id: 'avatars', label: 'Avatars', icon: Image, visible: admin },
                { id: 'voice', label: 'Voice', icon: Mic, visible: admin },
            ],
        },
        {
            group: 'People',
            items: [
                { id: 'users', label: 'Users', icon: Users, visible: admin },
                { id: 'cohorts', label: 'Cohorts', icon: Users, visible: canManageCohorts },
            ],
        },
        {
            group: 'Analytics',
            items: [
                { id: 'analytics', label: 'Analytics', icon: Activity, iconClass: 'text-teal-700', visible: canSeeAnalytics },
            ],
        },
        {
            group: 'Capture',
            items: [
                { id: 'oyon', label: 'Oyon', icon: Camera, visible: true },
            ],
        },
        {
            group: 'System',
            items: [
                { id: 'platform', label: 'Platform', icon: Settings, visible: admin },
                { id: 'notifications', label: 'Notifications', icon: BellIcon, visible: true },
                { id: 'logs', label: 'Logs', icon: ClipboardList, visible: admin },
            ],
        },
    ];

    return (
        <div className={`rohy-admin-light flex flex-col h-full ${fullPage ? '' : 'rounded-xl'} overflow-hidden`}>

            {/* Header */}
            <div className="rohy-admin-header flex items-center justify-between p-6 border-b border-neutral-800 relative">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Settings className="w-6 h-6 text-teal-700" />
                    {fullPage ? 'Rohy - Settings & Administration' : 'Platform Configuration'}
                </h2>
                {fullPage && (
                    <button
                        onClick={onClose}
                        className="rohy-subtle-button px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <X className="w-4 h-4" />
                        Back to Simulation
                    </button>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">

                {/* Sidebar — collapsible accordion grouped by theme. Simulation
                    stays pinned on top (it's not a tab, it exits back to the
                    running sim); the grouped tabs follow. Per-tab role gating
                    lives on each SECTIONS item's `visible`; a group with no
                    visible items renders neither its header nor body. */}
                <div className="rohy-admin-sidebar w-48 min-h-0 overflow-y-auto border-r border-neutral-800 flex flex-col py-3">
                    {/* Simulation — not a tab: returns to the running simulation. */}
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2.5 text-left text-sm font-bold flex items-center gap-2 border-l-2 border-transparent text-gray-700 hover:text-gray-950 hover:bg-teal-50/70 transition-colors"
                    >
                        <Monitor className="w-4 h-4" /> Simulation
                    </button>
                    {SECTIONS.map(({ group, items }) => {
                        const visibleItems = items.filter((item) => item.visible);
                        if (visibleItems.length === 0) return null;
                        const open = isGroupOpen(group);
                        return (
                            <div key={group}>
                                <NavGroupHeader group={group} open={open} onToggle={toggleGroup} />
                                {open && visibleItems.map((item) => (
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
                                        <h3 className="text-lg font-bold">{isAdmin() ? 'Manage Cases' : 'Available Cases'}</h3>
                                        <div className="flex gap-2">
                                            {isAdmin() && (
                                                <>
                                                    <button
                                                        onClick={() => setEditingCase({ name: '', description: '', config: { pages: [] } })}
                                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold"
                                                    >
                                                        <Plus className="w-4 h-4" /> New Case
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
                                                                        throw new Error('Invalid case file format');
                                                                    }

                                                                    await apiPost('/cases', caseData);
                                                                    toast.success('Case imported successfully!');
                                                                    const data = await apiFetch('/cases');
                                                                    setCases(data.cases || []);
                                                                } catch (err) {
                                                                    toast.error('Failed to import case: ' + err.message);
                                                                }
                                                            };
                                                            input.click();
                                                        }}
                                                        className="flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white rounded text-sm font-bold"
                                                        title="Import Case from JSON"
                                                    >
                                                        <FileUp className="w-4 h-4" /> Import
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
                                                <div className="text-xs text-gray-600">Total Cases</div>
                                            </div>
                                            <div className="rohy-stat-card rohy-stat-card-accent rounded-lg p-3 text-center">
                                                <div className="text-xl font-bold text-blue-700">{cases.filter(c => c.is_available).length}</div>
                                                <div className="text-xs text-gray-700">Available</div>
                                            </div>
                                            <div className="rohy-stat-card rounded-lg p-3 text-center">
                                                <div className="text-xl font-bold text-gray-700">{cases.filter(c => !c.is_available).length}</div>
                                                <div className="text-xs text-gray-600">Hidden</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid gap-3">
                                        {cases.map(c => (
                                            <div key={c.id} className={`rohy-card p-4 rounded-lg flex justify-between items-center ${c.is_default ? 'rohy-card-active' : ''}`}>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-gray-900">{c.name}</span>
                                                        {c.is_default && (
                                                            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded border border-green-300">Default</span>
                                                        )}
                                                        {isAdmin() && (
                                                            <span className={`px-2 py-0.5 text-xs rounded border ${c.is_available ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                                                                {c.is_available ? 'Available' : 'Hidden'}
                                                            </span>
                                                        )}
                                                        {/* Active-use indicator. Edits to this case will be live to
                                                            anyone running it — admins ought to know before they
                                                            start changing prompts/vitals mid-simulation. */}
                                                        {isAdmin() && c.active_session_count > 0 && (
                                                            <span
                                                                className="px-2 py-0.5 text-xs rounded border bg-orange-100 text-orange-800 border-orange-300"
                                                                title={`${c.active_session_count} active simulation session(s) — edits will be visible to learners on their next request.`}
                                                            >
                                                                ⚡ {c.active_session_count} live
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-gray-600">{c.description}</div>
                                                </div>
                                                <div className="flex gap-2 items-center">
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
                                                            title={c.is_available ? 'Hide from students' : 'Make available to students'}
                                                        >
                                                            {c.is_available ? 'Hide' : 'Show'}
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
                                                            title="Set as default case for students"
                                                        >
                                                            Set Default
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            if (onLoadCase) onLoadCase(c);
                                                            if (onClose) onClose();
                                                        }}
                                                        className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-bold text-white shadow-lg shadow-green-900/20"
                                                    >
                                                        Load
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
                                                                // Remove database ID for portability
                                                                delete caseJSON.id;

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
                                                            title="Export to JSON"
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
                                                            }} className="rohy-subtle-button p-2 rounded text-xs">Edit</button>
                                                            <button
                                                                onClick={() => {
                                                                    // Duplicate case - create a copy without ID
                                                                    const duplicatedCase = {
                                                                        ...c,
                                                                        name: `${c.name} (Copy)`,
                                                                        id: undefined // Remove ID so it creates a new case
                                                                    };
                                                                    delete duplicatedCase.id;
                                                                    localStorage.removeItem('rohy_editing_case');
                                                                    console.log('[ConfigPanel] Duplicating case:', c.name);
                                                                    setEditingCase(duplicatedCase);
                                                                    toast.success(`Duplicated "${c.name}" - Edit and save as new case`);
                                                                }}
                                                                className="p-2 bg-teal-100 text-teal-700 border border-teal-200 rounded text-xs hover:bg-teal-200"
                                                                title="Duplicate case"
                                                            >
                                                                <Copy className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleDeleteCase(c.id)} className="p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs hover:bg-red-100">Delete</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {cases.length === 0 && (
                                            <div className="text-neutral-500 text-center py-8">
                                                {isAdmin() ? 'No cases found in database.' : 'No cases available. Please contact an administrator.'}
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
                                                'You have unsaved changes. Save before exiting?',
                                                { title: 'Unsaved Changes', confirmText: 'Save & Exit', cancelText: 'Discard', type: 'warning' }
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
                                        <p className="text-sm text-amber-300 font-medium">No case selected</p>
                                        <p className="text-xs text-neutral-400">Create or edit a case to apply scenarios</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditingCase({ name: '', description: '', config: { pages: [] } });
                                            setActiveTab('cases');
                                        }}
                                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold"
                                    >
                                        + New Case
                                    </button>
                                </div>
                            )}
                            {editingCase && (
                                <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
                                    <p className="text-sm text-green-300">
                                        Editing: <strong>{editingCase.name || 'New Case'}</strong> — Select a scenario below to apply it
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
                                                `This case already has a scenario timeline (${existing.timeline.length} frame${existing.timeline.length === 1 ? '' : 's'}). Replace it with "${scenario.name}"? The current timeline will be lost.`
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
                                        toast.success(`Scenario "${scenario.name}" applied to case!`);
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
                                        toast.success(`Scenario "${scenario.name}" applied. Complete your new case details.`);
                                    }
                                }}
                            />
                        </div>
                    )}

                    {/* --- USER MANAGEMENT TAB (Admin Only) --- */}
                    {activeTab === 'users' && isAdmin() && (
                        <UserManagement />
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
                                <h3 className="text-lg font-bold">Lab Test Database</h3>
                                <span className="text-xs text-neutral-500">Manage laboratory test reference values</span>
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
                                <h3 className="text-lg font-bold">Body Map Editor</h3>
                                <span className="text-xs text-neutral-500">Edit body region mappings for physical examination</span>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-neutral-800 rounded-lg p-4">
                                    <h4 className="font-medium mb-2">Visual Region Editor</h4>
                                    <p className="text-sm text-neutral-400 mb-4">
                                        Open the interactive editor to drag and adjust body region polygons.
                                        Click regions to select them, then drag vertices to reshape.
                                    </p>
                                    <InlineBodyMapEditor />
                                </div>

                                <div className="bg-neutral-800 rounded-lg p-4">
                                    <h4 className="font-medium mb-2">Body Images</h4>
                                    <p className="text-sm text-neutral-400 mb-4">
                                        Upload custom SVG or PNG images for the body silhouettes.
                                        Images should be transparent backgrounds with body outlines.
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Male Front</label>
                                            <div className="flex gap-2">
                                                <img src="./man-front.png" alt="Male front" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'man-front')
                                                                .then(() => toast.success('Image uploaded!'))
                                                                .catch(err => toast.error('Upload failed: ' + (err.error || err.message)));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Male Back</label>
                                            <div className="flex gap-2">
                                                <img src="./man-back.png" alt="Male back" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'man-back')
                                                                .then(() => toast.success('Image uploaded!'))
                                                                .catch(err => toast.error('Upload failed: ' + (err.error || err.message)));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Female Front</label>
                                            <div className="flex gap-2">
                                                <img src="./woman-front.png" alt="Female front" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'woman-front')
                                                                .then(() => toast.success('Image uploaded!'))
                                                                .catch(err => toast.error('Upload failed: ' + (err.error || err.message)));
                                                        }
                                                    }} />
                                                    <Upload className="w-5 h-5 text-neutral-500" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Female Back</label>
                                            <div className="flex gap-2">
                                                <img src="./woman-back.png" alt="Female back" className="w-16 h-24 object-contain bg-neutral-700 rounded" />
                                                <label className="flex-1 flex items-center justify-center border-2 border-dashed border-neutral-600 rounded cursor-pointer hover:border-teal-500 transition-colors">
                                                    <input type="file" accept=".svg,.png" className="hidden" onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            uploadBodyImage(file, 'woman-back')
                                                                .then(() => toast.success('Image uploaded!'))
                                                                .catch(err => toast.error('Upload failed: ' + (err.error || err.message)));
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

                </div>
            </div>
        </div>
    );
}

// Platform Settings Component (Admin Only)
function PlatformSettings({ cases, setCases }) {
    const [activeSection, setActiveSection] = useState('general');
    const [defaultCaseId, setDefaultCaseId] = useState(null);
    const [loading, setLoading] = useState(false);

    const sections = [
        { id: 'general', label: 'General', icon: Settings },
        { id: 'ai', label: 'AI / LLM', icon: Cpu },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'monitor', label: 'Monitor', icon: Monitor }
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
                            Default Case for Students
                        </h4>
                        <p className="text-sm text-neutral-400 mb-4">
                            When students log in, they will see this case pre-selected.
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
                            <option value="">No default case</option>
                            {availableCases.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {defaultCaseId && (
                            <p className="text-xs text-green-400 mt-2">
                                Students will automatically see "{cases.find(c => c.id === defaultCaseId)?.name}" when they log in.
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
    const toast = useToast();
    const [fieldConfig, setFieldConfig] = useState({
        name: { label: 'Full Name', required: true, enabled: true },
        institution: { label: 'Institution', required: false, enabled: true },
        address: { label: 'Address', required: false, enabled: true },
        phone: { label: 'Phone Number', required: false, enabled: true },
        alternative_email: { label: 'Alternative Email', required: false, enabled: true },
        education: { label: 'Education', required: false, enabled: true },
        grade: { label: 'Grade/Year', required: false, enabled: true }
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
            toast.success('User field configuration saved');
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Failed to save configuration: ' + error.message);
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
                User Profile Field Configuration
            </h4>
            <p className="text-sm text-neutral-400 mb-6">
                Configure which fields are visible and required on user profiles. Disabled fields will not appear to users.
            </p>

            <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-bold text-neutral-400 border-b border-neutral-700">
                    <div className="col-span-4">Field</div>
                    <div className="col-span-3">Label</div>
                    <div className="col-span-2 text-center">Enabled</div>
                    <div className="col-span-3 text-center">Required</div>
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
                                    <span className="text-xs text-amber-400 ml-2">(always required)</span>
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
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save Configuration
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

// Provider catalog for the LLM settings tab. `keyPrefix` is the expected
// start of API keys for that provider — used as a sanity check (warns if
// mismatched), not a blocker. Defaults updated 2026-05 to current model
// generations.
const LLM_PROVIDERS = {
    lmstudio: { name: 'LM Studio (Local)', defaultBase: 'http://localhost:1234/v1', defaultModel: '', needsKey: false, modelRequired: false, keyPrefix: '', description: 'Local LLM server — no API key needed' },
    ollama: { name: 'Ollama (Local)', defaultBase: 'http://localhost:11434/v1', defaultModel: 'llama3.2', needsKey: false, modelRequired: true, keyPrefix: '', description: 'Local Ollama server' },
    openai: { name: 'OpenAI', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', needsKey: true, modelRequired: true, keyPrefix: 'sk-', description: 'GPT-4o, GPT-4o-mini, o1, o3' },
    anthropic: { name: 'Anthropic (Claude)', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6', needsKey: true, modelRequired: true, keyPrefix: 'sk-ant-', description: 'Claude Opus 4.7, Sonnet 4.6, Haiku 4.5' },
    openrouter: { name: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4-6', needsKey: true, modelRequired: true, keyPrefix: 'sk-or-', description: 'Access multiple AI providers via one key' },
    groq: { name: 'Groq', defaultBase: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', needsKey: true, modelRequired: true, keyPrefix: 'gsk_', description: 'Ultra-fast inference' },
    together: { name: 'Together AI', defaultBase: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', needsKey: true, modelRequired: true, keyPrefix: '', description: 'Open source models' },
    azure: { name: 'Azure OpenAI', defaultBase: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT', defaultModel: '', needsKey: true, modelRequired: false, keyPrefix: '', description: 'Azure-hosted OpenAI' },
    custom: { name: 'Custom OpenAI-Compatible', defaultBase: 'http://localhost:8000/v1', defaultModel: '', needsKey: false, modelRequired: false, keyPrefix: '', description: 'Any OpenAI-compatible API' }
};

function validateLlmConfig(cfg) {
    const errs = [];
    const provider = LLM_PROVIDERS[cfg.provider] || LLM_PROVIDERS.lmstudio;

    if (!cfg.baseUrl || !/^https?:\/\//i.test(cfg.baseUrl.trim())) {
        errs.push({ field: 'baseUrl', message: 'Base URL must start with http:// or https://' });
    }
    if (cfg.baseUrl && /^sk-/i.test(cfg.baseUrl.trim())) {
        errs.push({ field: 'baseUrl', message: 'This looks like an API key — paste it in the API Key field instead.' });
    }
    if (provider.needsKey) {
        if (!cfg.apiKey || !cfg.apiKey.trim()) {
            errs.push({ field: 'apiKey', message: `${provider.name} requires an API key.` });
        } else {
            if (/^https?:\/\//i.test(cfg.apiKey.trim())) {
                errs.push({ field: 'apiKey', message: 'This looks like a URL — paste the API key here, not the endpoint.' });
            }
            if (provider.keyPrefix && !cfg.apiKey.trim().startsWith(provider.keyPrefix)) {
                errs.push({ field: 'apiKey', message: `Expected a key starting with "${provider.keyPrefix}" for ${provider.name}. Double-check this is the right provider's key.`, soft: true });
            }
        }
    }
    if (provider.modelRequired && (!cfg.model || !cfg.model.trim())) {
        errs.push({ field: 'model', message: `${provider.name} requires a model name.` });
    }
    if (cfg.maxOutputTokens && cfg.maxOutputTokens.trim()) {
        const n = parseInt(cfg.maxOutputTokens, 10);
        if (!Number.isFinite(n) || n < 1 || n > 200000) {
            errs.push({ field: 'maxOutputTokens', message: 'Max output tokens must be a positive integer ≤ 200000.' });
        }
    }
    if (cfg.temperature && cfg.temperature.trim()) {
        const t = parseFloat(cfg.temperature);
        if (!Number.isFinite(t) || t < 0 || t > 2) {
            errs.push({ field: 'temperature', message: 'Temperature must be a number between 0 and 2.' });
        }
    }
    return { ok: errs.filter(e => !e.soft).length === 0, errors: errs };
}

// LLM Configuration Component (Admin Only)
function LLMConfiguration() {
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
    const [showApiKey, setShowApiKey] = useState(false);

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
        setLlmConfig(prev => ({
            ...prev,
            provider,
            baseUrl: providerConfig.defaultBase,
            model: providerConfig.defaultModel,
            apiKey: providerConfig.needsKey ? prev.apiKey : ''
        }));
    };

    const handleSaveLLM = async () => {
        const v = validateLlmConfig(llmConfig);
        setValidationErrors(v.errors);
        if (!v.ok) {
            const blocking = v.errors.filter(e => !e.soft);
            toast.error(`Fix ${blocking.length} validation error${blocking.length === 1 ? '' : 's'} before saving.`);
            return;
        }
        setSaving(true);
        try {
            await apiPut('/platform-settings/llm', llmConfig);
            toast.success('LLM settings saved.');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to save LLM settings');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveRateLimits = async () => {
        setSaving(true);
        try {
            await apiPut('/platform-settings/rate-limits', rateLimits);
            toast.success('Rate limits saved successfully!');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to save rate limits');
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setTesting(true);
        try {
            // First save the current settings
            await apiPut('/platform-settings/llm', llmConfig);

            // Then test
            const data = await apiPost('/platform-settings/llm/test', {});
            if (data.success) {
                toast.success(`Connection successful! Response: "${data.response}"`);
            } else {
                toast.error(`Connection failed: ${data.error}`);
            }
        } catch (err) {
            toast.error('Connection test failed: ' + err.message);
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
                    LLM Configuration
                </h4>
                <p className="text-sm text-neutral-400 mb-6">
                    Configure the AI model used for patient simulations. These settings apply to all users.
                </p>

                <div className="space-y-4">
                    {/* Enable/Disable */}
                    <div className="flex items-center justify-between p-3 bg-neutral-700/30 rounded-lg">
                        <div>
                            <span className="text-white font-medium">LLM Service</span>
                            <p className="text-xs text-neutral-400">Enable or disable AI functionality for all users</p>
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
                        <label className="block text-sm font-medium text-neutral-300 mb-2">Provider</label>
                        <select
                            value={llmConfig.provider}
                            onChange={(e) => handleProviderChange(e.target.value)}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                        >
                            <optgroup label="Local (No API Key)">
                                <option value="lmstudio">LM Studio (Local)</option>
                                <option value="ollama">Ollama (Local)</option>
                            </optgroup>
                            <optgroup label="Cloud Providers (API Key Required)">
                                <option value="openai">OpenAI (GPT-4o, GPT-4o-mini)</option>
                                <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
                                <option value="openrouter">OpenRouter (Multi-provider)</option>
                                <option value="groq">Groq (Ultra-fast)</option>
                                <option value="together">Together AI (Open Source)</option>
                                <option value="azure">Azure OpenAI</option>
                            </optgroup>
                            <optgroup label="Other">
                                <option value="custom">Custom OpenAI-Compatible API</option>
                            </optgroup>
                        </select>
                        <p className="text-xs text-neutral-500 mt-1">{currentProvider.description}</p>
                    </div>

                    {/* Base URL */}
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">Base URL</label>
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

                    {/* Model */}
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Model
                            {!currentProvider.modelRequired && (
                                <span className="text-neutral-500 text-xs ml-2">(optional - uses loaded model)</span>
                            )}
                        </label>
                        <input
                            type="text"
                            value={llmConfig.model}
                            onChange={(e) => setLlmConfig(prev => ({ ...prev, model: e.target.value }))}
                            className={`w-full bg-neutral-800 border rounded-lg p-3 text-white focus:border-cyan-500 outline-none ${fieldError('model') ? 'border-red-500' : 'border-neutral-600'}`}
                            placeholder={currentProvider.modelRequired ? currentProvider.defaultModel || 'gpt-4o-mini' : 'Leave empty to use loaded model'}
                        />
                        {fieldError('model') && (
                            <p className="text-xs text-red-400 mt-1">{fieldError('model').message}</p>
                        )}
                    </div>

                    {/* API Key */}
                    {currentProvider.needsKey && (
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                API Key
                                {currentProvider.keyPrefix && (
                                    <span className="text-neutral-500 text-xs ml-2">
                                        starts with <code className="text-neutral-400">{currentProvider.keyPrefix}</code>
                                    </span>
                                )}
                            </label>
                            <div className="relative">
                                <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={llmConfig.apiKey}
                                    onChange={(e) => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                    className={`w-full bg-neutral-800 border rounded-lg p-3 text-white focus:border-cyan-500 outline-none pr-20 ${fieldError('apiKey') ? 'border-red-500' : 'border-neutral-600'}`}
                                    placeholder={currentProvider.keyPrefix ? `${currentProvider.keyPrefix}...` : 'API key'}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-neutral-400 hover:text-white"
                                >
                                    {showApiKey ? 'Hide' : 'Show'}
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
                        <h5 className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2">Currently wired up</h5>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <dt className="text-neutral-500">Provider</dt>
                            <dd className="text-neutral-200 font-mono">{llmConfig.provider}</dd>
                            <dt className="text-neutral-500">Model</dt>
                            <dd className="text-neutral-200 font-mono">{llmConfig.model || <span className="text-neutral-500">(provider default)</span>}</dd>
                            <dt className="text-neutral-500">Base URL</dt>
                            <dd className="text-neutral-200 font-mono break-all">{llmConfig.baseUrl || <span className="text-neutral-500">(unset)</span>}</dd>
                            {currentProvider.needsKey && (
                                <>
                                    <dt className="text-neutral-500">Key</dt>
                                    <dd className="text-neutral-200 font-mono">
                                        {llmConfig.apiKey
                                            ? `${llmConfig.apiKey.slice(0, Math.min(7, llmConfig.apiKey.length))}…${llmConfig.apiKey.slice(-3)} (${llmConfig.apiKey.length} chars)`
                                            : <span className="text-red-400">missing</span>}
                                    </dd>
                                </>
                            )}
                        </dl>
                    </div>

                    {/* Model Parameters */}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-700 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">Max Output Tokens</label>
                            <input
                                type="text"
                                value={llmConfig.maxOutputTokens}
                                onChange={(e) => setLlmConfig(prev => ({ ...prev, maxOutputTokens: e.target.value }))}
                                placeholder="Provider default"
                                className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                            />
                            <p className="text-xs text-neutral-500 mt-1">Empty = provider default</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">Temperature</label>
                            <input
                                type="text"
                                value={llmConfig.temperature}
                                onChange={(e) => setLlmConfig(prev => ({ ...prev, temperature: e.target.value }))}
                                placeholder="Provider default"
                                className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                            />
                            <p className="text-xs text-neutral-500 mt-1">Empty = provider default (0-2)</p>
                        </div>
                    </div>

                    {/* System Prompt Template */}
                    <div className="pt-2">
                        <label className="block text-sm font-medium text-neutral-300 mb-2">System Prompt Template</label>
                        <textarea
                            value={llmConfig.systemPromptTemplate}
                            onChange={(e) => setLlmConfig(prev => ({ ...prev, systemPromptTemplate: e.target.value }))}
                            rows={8}
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none font-mono text-xs"
                            placeholder="Instructions sent with every conversation (e.g., 'You are a simulated patient...')"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Optional. Appended <em>after</em> the case-specific persona/instructions as a trailing reminder. Leave empty to use only the per-case content. (Previously prepended, which shadowed each case persona.)</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4">
                        <button
                            onClick={handleSaveLLM}
                            disabled={saving}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Settings
                        </button>
                        <button
                            onClick={handleTestConnection}
                            disabled={testing}
                            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 text-white rounded-lg font-medium flex items-center gap-2"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            Test Connection
                        </button>
                    </div>
                </div>
            </div>

            {/* Rate Limits Configuration */}
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                <h4 className="text-md font-bold text-orange-400 mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Rate Limits & Quotas
                </h4>
                <p className="text-sm text-neutral-400 mb-6">
                    Set daily limits for token usage and costs to control API spending. Set to 0 for unlimited (disabled).
                </p>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Tokens per User (Daily)
                            {rateLimits.tokensPerUserDaily === 0 && <span className="text-green-400 ml-2 text-xs">Unlimited</span>}
                        </label>
                        <input
                            type="number"
                            value={rateLimits.tokensPerUserDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, tokensPerUserDaily: parseInt(e.target.value) || 0 }))}
                            placeholder="0 = Unlimited"
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Max tokens each user can use per day (0 = unlimited)</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Cost per User (Daily) $
                            {rateLimits.costPerUserDaily === 0 && <span className="text-green-400 ml-2 text-xs">Unlimited</span>}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={rateLimits.costPerUserDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, costPerUserDaily: parseFloat(e.target.value) || 0 }))}
                            placeholder="0 = Unlimited"
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Max cost each user can incur per day (0 = unlimited)</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Platform Tokens (Daily)
                            {rateLimits.tokensPlatformDaily === 0 && <span className="text-green-400 ml-2 text-xs">Unlimited</span>}
                        </label>
                        <input
                            type="number"
                            value={rateLimits.tokensPlatformDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, tokensPlatformDaily: parseInt(e.target.value) || 0 }))}
                            placeholder="0 = Unlimited"
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Max tokens for entire platform per day (0 = unlimited)</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Platform Cost (Daily) $
                            {rateLimits.costPlatformDaily === 0 && <span className="text-green-400 ml-2 text-xs">Unlimited</span>}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={rateLimits.costPlatformDaily}
                            onChange={(e) => setRateLimits(prev => ({ ...prev, costPlatformDaily: parseFloat(e.target.value) || 0 }))}
                            placeholder="0 = Unlimited"
                            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Max cost for entire platform per day (0 = unlimited)</p>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-neutral-700">
                    <button
                        onClick={handleSaveRateLimits}
                        disabled={saving}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-600 text-white rounded-lg font-medium flex items-center gap-2"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Rate Limits
                    </button>
                </div>
            </div>

            {/* Platform Usage Stats */}
            {platformUsage && (
                <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                    <h4 className="text-md font-bold text-green-400 mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        Today's Usage
                    </h4>

                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.tokensUsed?.toLocaleString() || 0}</div>
                            <div className="text-xs text-neutral-400">Tokens Used</div>
                            <div className="mt-2 h-1 bg-neutral-600 rounded">
                                <div
                                    className="h-full bg-green-500 rounded"
                                    style={{ width: `${Math.min((platformUsage.tokensUsed / platformUsage.tokensLimit) * 100, 100)}%` }}
                                />
                            </div>
                            <div className="text-xs text-neutral-500 mt-1">{platformUsage.tokensRemaining?.toLocaleString() || 0} remaining</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">${platformUsage.costUsed?.toFixed(2) || '0.00'}</div>
                            <div className="text-xs text-neutral-400">Cost Today</div>
                            <div className="mt-2 h-1 bg-neutral-600 rounded">
                                <div
                                    className="h-full bg-orange-500 rounded"
                                    style={{ width: `${Math.min((platformUsage.costUsed / platformUsage.costLimit) * 100, 100)}%` }}
                                />
                            </div>
                            <div className="text-xs text-neutral-500 mt-1">${platformUsage.costRemaining?.toFixed(2) || '0.00'} remaining</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.totalRequests || 0}</div>
                            <div className="text-xs text-neutral-400">Total Requests</div>
                        </div>

                        <div className="bg-neutral-700/30 rounded-lg p-4 text-center">
                            <div className="text-2xl font-bold text-white">{platformUsage.activeUsers || 0}</div>
                            <div className="text-xs text-neutral-400">Active Users</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Chat/Doctor Configuration Component (Admin Only)
function ChatConfiguration() {
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
            toast.success('Chat settings saved successfully!');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to save chat settings');
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 500000) {
                toast.warning('Image too large. Please use an image under 500KB.');
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
                Chat Interface Settings
            </h4>
            <p className="text-sm text-neutral-400 mb-6">
                Configure how the doctor appears in patient conversations.
            </p>

            <div className="space-y-4">
                {/* Doctor Name */}
                <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Doctor Name</label>
                    <input
                        type="text"
                        value={chatSettings.doctorName}
                        onChange={(e) => setChatSettings(prev => ({ ...prev, doctorName: e.target.value }))}
                        placeholder="Dr. Carmen"
                        className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-white focus:border-cyan-500 outline-none"
                    />
                    <p className="text-xs text-neutral-500 mt-1">This name appears next to user messages in the chat</p>
                </div>

                {/* Doctor Avatar */}
                <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">Doctor Avatar (Optional)</label>
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
                                Upload Image
                            </label>
                            {previewAvatar && (
                                <button
                                    onClick={() => {
                                        setChatSettings(prev => ({ ...prev, doctorAvatar: '' }));
                                        setPreviewAvatar('');
                                    }}
                                    className="ml-2 px-3 py-2 text-red-400 hover:text-red-300 text-sm"
                                >
                                    Remove
                                </button>
                            )}
                            <p className="text-xs text-neutral-500 mt-2">Square image recommended, max 500KB</p>
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
                        Save Chat Settings
                    </button>
                </div>
            </div>
        </div>
    );
}

// Monitor Display Configuration Component (Admin Only)
function MonitorConfiguration() {
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
            toast.success('Monitor settings saved');
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Failed to save monitor settings');
        } finally {
            setSaving(false);
        }
    };

    const settingsConfig = [
        { key: 'showTimer', label: 'Session Timer', description: 'Show elapsed time since session started' },
        { key: 'showECG', label: 'ECG Waveform', description: 'Show ECG trace and heart rate' },
        { key: 'showPleth', label: 'Plethysmograph', description: 'Show SpO2 waveform' },
        { key: 'showSpO2', label: 'SpO2 Value', description: 'Show oxygen saturation numeric' },
        { key: 'showBP', label: 'Blood Pressure', description: 'Show systolic/diastolic BP' },
        { key: 'showRR', label: 'Respiratory Rate', description: 'Show breathing rate' },
        { key: 'showTemp', label: 'Temperature', description: 'Show body temperature' },
        { key: 'showCO2', label: 'EtCO2', description: 'Show end-tidal CO2' },
        { key: 'showNumerics', label: 'Numeric Panel', description: 'Show all vital signs panel' }
    ];

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-6 mt-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-cyan-600/20 rounded-lg">
                    <Monitor className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Monitor Display Settings</h3>
                    <p className="text-sm text-neutral-400">Configure which components are visible on the ICU monitor</p>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-8 text-neutral-400">Loading settings...</div>
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
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Monitor Settings
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
    const [activeLogTab, setActiveLogTab] = useState('activity'); // activity, sessions, system, chat, moments, turns, insights, oyondata

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">System Logs</h3>
                <span className="text-xs text-neutral-500">
                    Date filters live inside each tab now.
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
                    Activity
                </button>
                <button
                    onClick={() => setActiveLogTab('sessions')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'sessions' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Sessions
                </button>
                <button
                    onClick={() => setActiveLogTab('system')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'system' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    System Log
                </button>
                <button
                    onClick={() => setActiveLogTab('chat')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'chat' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Chat Log
                </button>
                <button
                    onClick={() => setActiveLogTab('moments')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'moments' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Moments
                </button>
                <button
                    onClick={() => setActiveLogTab('turns')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'turns' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    By Turn
                </button>
                <button
                    onClick={() => setActiveLogTab('insights')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'insights' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Case Insights
                </button>
                <button
                    onClick={() => setActiveLogTab('oyondata')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'oyondata' ? 'border-teal-700 text-teal-950' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Oyon data
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

// User Management Component (Admin Only)
function UserManagement() {
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [showBatchUpload, setShowBatchUpload] = useState(false);
    const [formData, setFormData] = useState({ username: '', name: '', email: '', password: '', role: 'user' });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/users');
            setUsers(data.users || []);
        } catch (err) {
            console.error('Failed to load users', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        try {
            await apiPost('/users/create', formData);
            toast.success('User created successfully!');
            loadUsers();
            setShowCreateForm(false);
            setFormData({ username: '', name: '', email: '', password: '', role: 'user' });
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Error creating user');
        }
    };

    const handleEditUser = async (e) => {
        e.preventDefault();

        try {
            await apiPut(`/users/${editingUser.id}`, formData);
            toast.success('User updated successfully!');
            loadUsers();
            setShowEditForm(false);
            setEditingUser(null);
            setFormData({ username: '', name: '', email: '', password: '', role: 'user' });
        } catch (err) {
            console.error('Error updating user:', err);
            toast.error(err instanceof ApiError ? err.message : 'Error updating user: ' + err.message);
        }
    };

    const handleBatchUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const csv = event.target.result;
                const lines = csv.split('\n');
                const users = [];

                // Skip header row
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const [username, name, email, password, role] = line.split(',').map(s => s.trim());
                    if (username && email && password) {
                        users.push({ username, name: name || '', email, password, role: role || 'user' });
                    }
                }

                if (users.length === 0) {
                    toast.warning('No valid users found in CSV');
                    return;
                }

                const data = await apiPost('/users/batch', { users });
                toast.success(data.message);
                if (data.results.failed.length > 0) {
                    console.log('Failed users:', data.results.failed);
                }
                loadUsers();
                setShowBatchUpload(false);
            } catch {
                toast.error('Error processing CSV file');
            }
        };
        reader.readAsText(file);
    };

    const downloadCSVTemplate = () => {
        const csv = `username,name,email,password,role
john_doe,John Doe,john@example.com,password123,user
jane_admin,Jane Smith,jane@example.com,admin456,admin
student1,Student One,student1@school.edu,stud123,user`;

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'user_upload_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    const handleDeleteUser = async (userId) => {
        const confirmed = await toast.confirm('Are you sure you want to delete this user?', { title: 'Delete User', type: 'danger', confirmText: 'Delete' });
        if (!confirmed) return;

        try {
            await apiDelete(`/users/${userId}`);
            setUsers(prev => prev.filter(u => u.id !== userId));
            toast.success('User deleted successfully');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to delete user');
        }
    };

    const handleToggleRole = async (userId, currentRole) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';

        try {
            const user = users.find(u => u.id === userId);
            await apiPut(`/users/${userId}`, { username: user.username, name: user.name, email: user.email, role: newRole });
            setUsers(prev => prev.map(u =>
                u.id === userId ? { ...u, role: newRole } : u
            ));
            toast.success('User role updated');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to update role');
        }
    };

    const openEditForm = (user) => {
        setEditingUser(user);
        setFormData({ username: user.username, name: user.name || '', email: user.email, password: '', role: user.role });
        setShowEditForm(true);
    };

    if (loading) {
        return <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
    }

    // Create User Form
    if (showCreateForm) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Create New User</h3>
                    <button onClick={() => setShowCreateForm(false)} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-bold mb-2">Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Full Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Email *</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Password * (min 6 characters)</label>
                        <input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            minLength={6}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Role</label>
                        <select
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                        >
                            <option value="user">{roleLabel('user')}</option>
                            <option value="educator">{roleLabel('educator')}</option>
                            <option value="admin">{roleLabel('admin')}</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold">
                        Create User
                    </button>
                </form>
            </div>
        );
    }

    // Edit User Form
    if (showEditForm && editingUser) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Edit User: {editingUser.username}</h3>
                    <button onClick={() => { setShowEditForm(false); setEditingUser(null); }} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <form onSubmit={handleEditUser} className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-bold mb-2">Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Full Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Email *</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">New Password (leave blank to keep current)</label>
                        <input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            minLength={6}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Role</label>
                        <select
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                        >
                            <option value="user">{roleLabel('user')}</option>
                            <option value="educator">{roleLabel('educator')}</option>
                            <option value="admin">{roleLabel('admin')}</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold">
                        Update User
                    </button>
                </form>
            </div>
        );
    }

    // Batch Upload View
    if (showBatchUpload) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Batch Upload Users (CSV)</h3>
                    <button onClick={() => setShowBatchUpload(false)} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6 space-y-4">
                    <div>
                        <h4 className="font-bold mb-2">CSV Format</h4>
                        <p className="text-sm text-neutral-400 mb-4">
                            Upload a CSV file with the following columns: username, name, email, password, role
                        </p>
                        <button
                            onClick={downloadCSVTemplate}
                            className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded font-bold"
                        >
                            <Download className="w-4 h-4" />
                            Download CSV Template
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Upload CSV File</label>
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleBatchUpload}
                            className="w-full bg-neutral-700 border border-neutral-600 rounded px-3 py-2 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-teal-600 file:text-white hover:file:bg-teal-500"
                        />
                    </div>

                    <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 text-sm">
                        <p className="font-bold mb-2">CSV Example:</p>
                        <pre className="text-xs text-neutral-300">
                            {`username,name,email,password,role
john_doe,John Doe,john@example.com,password123,user
jane_admin,Jane Smith,jane@example.com,admin456,admin`}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    // Main User List View
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">User Management</h3>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowBatchUpload(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-bold"
                    >
                        <Upload className="w-4 h-4" />
                        Batch Upload
                    </button>
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold"
                    >
                        <Plus className="w-4 h-4" />
                        Create User
                    </button>
                </div>
            </div>

            <div className="text-sm text-neutral-400">{users.length} total users</div>

            <div className="space-y-2">
                {users.map(user => (
                    <div key={user.id} className="p-4 bg-neutral-800 border border-neutral-700 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="font-bold flex items-center gap-2">
                                    {user.username}
                                    {user.name && <span className="text-neutral-500 font-normal text-sm">({user.name})</span>}
                                    {user.role === 'admin' && (
                                        <span className="px-2 py-0.5 bg-teal-600 text-white text-xs rounded">{roleLabel('admin')}</span>
                                    )}
                                    {user.role === 'educator' && (
                                        <span className="px-2 py-0.5 bg-teal-600 text-white text-xs rounded">{roleLabel('educator')}</span>
                                    )}
                                </div>
                                <div className="text-xs text-neutral-400 mt-1">
                                    {user.email} • Joined {new Date(user.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => openEditForm(user)}
                                    className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleToggleRole(user.id, user.role)}
                                    className="text-xs bg-neutral-700 px-3 py-1.5 rounded hover:bg-neutral-600"
                                >
                                    {user.role === 'admin' ? 'Demote' : 'Make Admin'}
                                </button>
                                <button
                                    onClick={() => handleDeleteUser(user.id)}
                                    className="text-xs bg-red-900/30 text-red-400 px-3 py-1.5 rounded hover:bg-red-900/50"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Lab Investigation Selector Component
function LabInvestigationSelector({ _caseData, onAddLab, patientGender, showAddByGroup = false }) {
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
            toast.warning('Please select a specific group to add');
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

            toast.success(`Added ${Object.keys(grouped).length} tests from ${selectedGroup}`);
        } catch (error) {
            console.error('Failed to add group:', error);
            toast.error('Failed to add tests by group');
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
                        placeholder="Search lab tests (e.g., glucose, hemoglobin, sodium)..."
                        className="input-dark w-full"
                    />
                </div>
                <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="input-dark"
                >
                    <option value="all">All Groups</option>
                    {groups.map(group => (
                        <option key={group} value={group}>{group}</option>
                    ))}
                </select>
                {showAddByGroup && (
                    <button
                        onClick={handleAddByGroup}
                        disabled={selectedGroup === 'all' || addingGroup}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded font-bold text-sm whitespace-nowrap flex items-center gap-2"
                        title="Add all tests from selected group"
                    >
                        {addingGroup ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4" />
                                Add Group
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
                                                {test.group} • {testGroup.length} variation(s)
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
                    No tests found matching "{searchQuery}"
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
                    <h5 className="text-sm font-bold text-neutral-200">Hidden Context Pages</h5>
                    <p className="text-[11px] text-neutral-500">
                        Title + content pairs the AI patient knows about but reveals only when asked.
                        Useful for backstory, social context, lab results the patient already heard, etc.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={add}
                    className="px-2.5 py-1 rounded text-xs font-semibold text-white flex items-center gap-1 bg-teal-700 hover:bg-teal-600"
                >
                    <Plus className="w-3.5 h-3.5" /> Add page
                </button>
            </div>
            {pages.length === 0 ? (
                <div className="rounded border border-dashed border-neutral-700 bg-neutral-900/40 p-4 text-center text-xs text-neutral-500">
                    No hidden pages yet.
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
                                    placeholder="Page title (e.g., Lab Result Summary)"
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
                                placeholder="Body text — anything the AI should know but reveal only on demand."
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
            toast.warning('Please save the case first before adding agents');
            return;
        }
        try {
            const data = await apiPost(`/cases/${caseId}/agents/add-defaults`, {});
            toast.success(data.message);
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to add default agents');
        }
    };

    const handleAddAgent = async (templateId) => {
        if (!caseId) {
            toast.warning('Please save the case first before adding agents');
            return;
        }
        try {
            await apiPost(`/cases/${caseId}/agents`, { agent_template_id: templateId });
            toast.success('Agent added');
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to add agent');
        }
    };

    const handleRemoveAgent = async (agentId) => {
        try {
            await apiDelete(`/cases/${caseId}/agents/${agentId}`);
            toast.success('Agent removed');
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to remove agent');
        }
    };

    const handleToggleEnabled = async (agent) => {
        try {
            await apiPut(`/cases/${caseId}/agents/${agent.id}`, { enabled: !agent.enabled });
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to update agent');
        }
    };

    const handleUpdateAgent = async (updates) => {
        if (!editingAgent) return;
        try {
            await apiPut(`/cases/${caseId}/agents/${editingAgent.id}`, updates);
            toast.success('Agent updated');
            setEditingAgent(null);
            loadData();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to update agent');
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
                    <h4 className="text-lg font-bold text-teal-400">Edit Agent: {editingAgent.name}</h4>
                    <button
                        onClick={() => setEditingAgent(null)}
                        className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm"
                    >
                        Cancel
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">Name Override</label>
                            <input
                                type="text"
                                value={editingAgent.name_override || ''}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, name_override: e.target.value }))}
                                placeholder={editingAgent.template_name || editingAgent.name}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">Availability Type</label>
                            <select
                                value={editingAgent.availability_type || 'present'}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, availability_type: e.target.value }))}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            >
                                <option value="present">Present (Available immediately)</option>
                                <option value="on-call">On-Call (Must be paged)</option>
                                <option value="absent">Absent (Not available)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">Available from minute</label>
                            <input
                                type="number"
                                min="0"
                                value={editingAgent.available_from_minute || 0}
                                onChange={(e) => setEditingAgent(prev => ({ ...prev, available_from_minute: parseInt(e.target.value) || 0 }))}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-neutral-400 mb-1">Depart at minute (0 = never)</label>
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
                                <label className="block text-sm text-neutral-400 mb-1">Response time min (min)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={editingAgent.response_time_min || 0}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, response_time_min: parseInt(e.target.value) || 0 }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">Response time max (min)</label>
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
                        <label className="block text-sm text-neutral-400 mb-1">System Prompt Override</label>
                        <textarea
                            value={editingAgent.system_prompt_override || ''}
                            onChange={(e) => setEditingAgent(prev => ({ ...prev, system_prompt_override: e.target.value }))}
                            placeholder="Leave empty to use template default..."
                            className="w-full h-64 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm font-mono resize-none"
                        />
                        <p className="text-xs text-neutral-500 mt-1">Override the default system prompt for this case</p>
                    </div>
                </div>

                {editingAgent.agent_type === 'discussant' && (
                    <div className="space-y-4 p-4 rounded-lg bg-indigo-950/30 border border-indigo-900/50">
                        <h5 className="text-sm font-bold text-indigo-300">Discussant — case overrides</h5>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">Context filter</label>
                                <select
                                    value={editingAgent._cfg_context_filter ?? editingAgent.context_filter ?? 'full'}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, _cfg_context_filter: e.target.value }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                >
                                    <option value="full">Full case context</option>
                                    <option value="history">History only</option>
                                    <option value="vitals">Vitals only</option>
                                    <option value="minimal">Minimal (Socratic)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-neutral-400 mb-1">Unlock trigger</label>
                                <select
                                    value={editingAgent._cfg_unlock_trigger ?? editingAgent.unlock_trigger ?? 'after_case_ended'}
                                    onChange={(e) => setEditingAgent(prev => ({ ...prev, _cfg_unlock_trigger: e.target.value }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm"
                                >
                                    <option value="after_case_ended">After case ends (debrief)</option>
                                    <option value="always">Always available</option>
                                </select>
                            </div>
                        </div>
                        <p className="text-xs text-neutral-500">These override the global discussant template values for this case only. Stored in <code className="text-neutral-400">case_agents.config_override</code>.</p>
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
                        Save Changes
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-lg font-bold text-teal-400">8. AI Agents</h4>
                    <p className="text-xs text-neutral-500">Configure which AI agents are available in this case</p>
                </div>
                {!caseId ? (
                    <span className="px-3 py-1.5 bg-amber-900/30 text-amber-400 rounded text-sm">
                        Save case first to add agents
                    </span>
                ) : (
                    <button
                        onClick={handleAddDefaultAgents}
                        disabled={caseAgents.length > 0}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add Default Agents
                    </button>
                )}
            </div>

            {/* Configured Agents */}
            {caseAgents.length > 0 ? (
                <div className="space-y-3">
                    <h5 className="text-sm font-medium text-neutral-400">Configured Agents</h5>
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
                                                <span className="px-1 py-0.5 bg-blue-900/50 text-blue-400 rounded text-xs">Override</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-neutral-500">
                                            {agent.role_title || agent.agent_type} • {agent.availability_type}
                                            {agent.available_from_minute > 0 && ` • From min ${agent.available_from_minute}`}
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
                                        {agent.enabled ? 'Enabled' : 'Disabled'}
                                    </button>
                                    <button
                                        onClick={() => setEditingAgent(agent)}
                                        className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs"
                                        title="Edit per-case overrides (name, availability, response time)"
                                    >
                                        Case overrides
                                    </button>
                                    {onOpenPersonaEditor && agent.agent_template_id && (
                                        <button
                                            // wizardStep=11 keeps the case wizard's Agents step in sync
                                            // with the seeder/case-data; if step numbering ever changes,
                                            // search this comment to find the magic number.
                                            onClick={() => onOpenPersonaEditor(agent.agent_template_id, { tab: 'cases', wizardStep: 11 })}
                                            className="px-2 py-1 bg-teal-700/40 hover:bg-teal-700 text-teal-200 hover:text-white rounded text-xs"
                                            title="Open the underlying persona template in the full editor (system-wide; affects every case using it). You'll return here when done."
                                        >
                                            Edit persona ↗
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRemoveAgent(agent.id)}
                                        className="px-2 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-xs"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No agents configured for this case.</p>
                    <p className="text-sm">Click "Add Default Agents" to get started.</p>
                </div>
            )}

            {/* Available Templates to Add */}
            {caseId && availableTemplates.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-neutral-800">
                    <h5 className="text-sm font-medium text-neutral-400">Available Templates</h5>
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
        if (diff < 5) return 'Just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
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
        { num: 1,  title: 'Demographics', icon: '👤' },
        { num: 2,  title: 'Avatar',       icon: '🎭' },
        { num: 3,  title: 'Story',        icon: '📖' },
        { num: 4,  title: 'Scenario',     icon: '📈' },
        { num: 5,  title: 'Vitals',       icon: '💓' },
        { num: 6,  title: 'Labs',         icon: '🧪' },
        { num: 7,  title: 'Radiology',    icon: '📷' },
        { num: 8,  title: 'Exam',         icon: '🩺' },
        { num: 9,  title: 'Records',      icon: '📄' },
        { num: 10, title: 'Treatments',   icon: '💊' },
        { num: 11, title: 'Agents',       icon: '🤖' }
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
                            Resumed unsaved draft of <strong>{caseData.name || '(new case)'}</strong>
                            {' from '}
                            <span className="font-mono">{new Date(caseData._stashedAt).toLocaleString()}</span>
                            . Save to persist, or discard to revert to the last saved version.
                        </div>
                        <button
                            type="button"
                            onClick={onDiscardDraft}
                            className="shrink-0 px-2 py-1 rounded border border-amber-700 text-amber-200 hover:bg-amber-800/40 hover:text-white text-xs"
                        >
                            Discard draft
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between mb-4">
                    <div className="flex-1 mr-4">
                        <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-lg font-bold text-white whitespace-nowrap">Case Title:</h3>
                            <input
                                type="text"
                                value={caseData.name}
                                onChange={e => setCaseData({ ...caseData, name: e.target.value })}
                                className="input-dark flex-1 text-lg font-semibold"
                                placeholder="e.g., Chest Pain - STEMI"
                            />
                        </div>
                        {lastSavedAt && (
                            <span className="text-[10px] text-green-500 flex items-center gap-1 ml-[105px]">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                Auto-saved {formatLastSaved()}
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
                                Save
                            </button>
                            <button
                                onClick={onCancel}
                                className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                            >
                                <X className="w-4 h-4" />
                                Exit
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
                        <h4 className="text-lg font-bold text-teal-400">1. Patient Demographics</h4>
                        <p className="text-xs text-neutral-500 -mt-4">EHR-style patient information. Most fields are optional.</p>

                        {/* Top Section: Basic Info (Patient Photo replaced by avatar system) */}
                        <div>
                            <div className="space-y-3">
                                <div>
                                    <label className="label-xs">Patient Name <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={caseData.config?.patient_name || ''}
                                        onChange={e => updateConfig('patient_name', e.target.value)}
                                        className="input-dark"
                                        placeholder="e.g., John Smith"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">MRN</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.mrn || ''}
                                        onChange={e => updateDemographics('mrn', e.target.value)}
                                        className="input-dark"
                                        placeholder="e.g., 12345678"
                                    />
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="label-xs">Date of Birth</label>
                                        <input
                                            type="date"
                                            value={caseData.config?.demographics?.dob || ''}
                                            onChange={e => updateDemographics('dob', e.target.value)}
                                            className="input-dark"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">Age</label>
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
                                            placeholder="Years"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">Gender</label>
                                        <select
                                            value={caseData.config?.demographics?.gender || ''}
                                            onChange={e => updateDemographics('gender', e.target.value)}
                                            className="input-dark"
                                        >
                                            <option value="">Select</option>
                                            <option>Male</option>
                                            <option>Female</option>
                                            <option>Other</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Physical Measurements */}
                        <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">Physical Measurements</h5>
                            <div className="grid grid-cols-4 gap-3">
                                <div>
                                    <label className="label-xs">Height (cm)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.demographics?.height || ''}
                                        onChange={e => updateDemographics('height', e.target.value)}
                                        className="input-dark"
                                        placeholder="170"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Weight (kg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.demographics?.weight || ''}
                                        onChange={e => updateDemographics('weight', e.target.value)}
                                        className="input-dark"
                                        placeholder="70"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">BMI</label>
                                    <input
                                        type="text"
                                        value={
                                            caseData.config?.demographics?.height && caseData.config?.demographics?.weight
                                                ? (caseData.config.demographics.weight / Math.pow(caseData.config.demographics.height / 100, 2)).toFixed(1)
                                                : ''
                                        }
                                        className="input-dark bg-neutral-900"
                                        readOnly
                                        placeholder="Auto"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Blood Type</label>
                                    <select
                                        value={caseData.config?.demographics?.bloodType || ''}
                                        onChange={e => updateDemographics('bloodType', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option value="">Unknown</option>
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
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">Additional Information</h5>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="label-xs">Primary Language</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.language || ''}
                                        onChange={e => updateDemographics('language', e.target.value)}
                                        className="input-dark"
                                        placeholder="e.g., English"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Ethnicity</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.ethnicity || ''}
                                        onChange={e => updateDemographics('ethnicity', e.target.value)}
                                        className="input-dark"
                                        placeholder="e.g., Caucasian"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Occupation</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.occupation || ''}
                                        onChange={e => updateDemographics('occupation', e.target.value)}
                                        className="input-dark"
                                        placeholder="e.g., Teacher"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Marital Status</label>
                                    <select
                                        value={caseData.config?.demographics?.maritalStatus || ''}
                                        onChange={e => updateDemographics('maritalStatus', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option value="">Select</option>
                                        <option>Single</option>
                                        <option>Married</option>
                                        <option>Divorced</option>
                                        <option>Widowed</option>
                                        <option>Separated</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Emergency Contact */}
                        <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                            <h5 className="text-sm font-bold text-neutral-300 mb-3">Emergency Contact</h5>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="label-xs">Contact Name</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.name || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, name: e.target.value })}
                                        className="input-dark"
                                        placeholder="e.g., Jane Smith"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Relationship</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.relationship || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, relationship: e.target.value })}
                                        className="input-dark"
                                        placeholder="e.g., Spouse"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Phone</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.demographics?.emergencyContact?.phone || ''}
                                        onChange={e => updateDemographics('emergencyContact', { ...caseData.config?.demographics?.emergencyContact, phone: e.target.value })}
                                        className="input-dark"
                                        placeholder="e.g., 555-1234"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Known Allergies */}
                        <div>
                            <label className="label-xs">Known Allergies</label>
                            <input
                                type="text"
                                value={caseData.config?.demographics?.allergies || ''}
                                onChange={e => updateDemographics('allergies', e.target.value)}
                                className="input-dark"
                                placeholder="e.g., Penicillin (rash), Sulfa, NKDA"
                            />
                            <p className="text-[10px] text-neutral-500 mt-1">Separate multiple allergies with commas</p>
                        </div>
                    </div>
                )}

                {/* STEP 2: AVATAR & VOICE — camera framing, voice file, speed, pitch.
                    Inherits from the platform's per-gender persona defaults when fields
                    are left blank (configured under admin → Avatars). */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div>
                            <h4 className="text-lg font-bold text-teal-400">2. Avatar &amp; Voice</h4>
                            <p className="text-xs text-neutral-500">
                                Pick the 3D head, framing, and voice for this case. Empty fields inherit the
                                platform's persona default for the patient's gender.
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
                                <h4 className="text-lg font-bold text-teal-400">3. Patient Story & Behavior</h4>
                                <p className="text-xs text-neutral-500">Define how the simulated patient behaves and communicates.</p>
                            </div>
                            <button onClick={applyPersonaDefaults} className="text-xs bg-neutral-800 hover:bg-neutral-700 px-3 py-1 rounded text-teal-300">
                                Load Defaults
                            </button>
                        </div>

                        {/* Personality Section */}
                        <div className="bg-gradient-to-r from-teal-900/20 to-blue-900/20 rounded-lg p-4 border border-teal-700/30">
                            <h5 className="text-sm font-bold text-teal-300 mb-3">Personality & Communication</h5>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">Persona Type</label>
                                    <select
                                        value={caseData.config?.persona_type || 'Standard Simulated Patient'}
                                        onChange={e => updateConfig('persona_type', e.target.value)}
                                        className="input-dark"
                                    >
                                        <option>Standard Simulated Patient</option>
                                        <option>Difficult/Angry Patient</option>
                                        <option>Anxious Patient</option>
                                        <option>Depressed Patient</option>
                                        <option>Elderly/Confused Patient</option>
                                        <option>Pediatric Proxy (Parent)</option>
                                        <option>Non-compliant Patient</option>
                                        <option>Drug-seeking Patient</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">Communication Style</label>
                                    <select
                                        value={caseData.config?.personality?.communicationStyle || 'normal'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, communicationStyle: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="normal">Normal</option>
                                        <option value="verbose">Verbose (detailed answers)</option>
                                        <option value="brief">Brief (short answers)</option>
                                        <option value="tangential">Tangential (goes off-topic)</option>
                                        <option value="guarded">Guarded (hesitant to share)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">Emotional State</label>
                                    <select
                                        value={caseData.config?.personality?.emotionalState || 'neutral'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, emotionalState: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="neutral">Neutral</option>
                                        <option value="calm">Calm</option>
                                        <option value="anxious">Anxious</option>
                                        <option value="fearful">Fearful</option>
                                        <option value="angry">Angry/Frustrated</option>
                                        <option value="sad">Sad/Tearful</option>
                                        <option value="stoic">Stoic</option>
                                        <option value="distressed">Distressed</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">Pain Tolerance</label>
                                    <select
                                        value={caseData.config?.personality?.painTolerance || 'normal'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, painTolerance: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="high">High (minimizes pain)</option>
                                        <option value="normal">Normal</option>
                                        <option value="low">Low (expresses pain readily)</option>
                                        <option value="dramatic">Dramatic (exaggerates)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">Cooperativeness</label>
                                    <select
                                        value={caseData.config?.personality?.cooperativeness || 'cooperative'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, cooperativeness: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="very_cooperative">Very Cooperative</option>
                                        <option value="cooperative">Cooperative</option>
                                        <option value="neutral">Neutral</option>
                                        <option value="reluctant">Reluctant</option>
                                        <option value="uncooperative">Uncooperative</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label-xs">Health Literacy</label>
                                    <select
                                        value={caseData.config?.personality?.healthLiteracy || 'average'}
                                        onChange={e => updateConfig('personality', { ...caseData.config?.personality, healthLiteracy: e.target.value })}
                                        className="input-dark"
                                    >
                                        <option value="high">High (medical background)</option>
                                        <option value="average">Average</option>
                                        <option value="low">Low (needs explanations)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Initial Greeting & Constraints */}
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="label-xs">Initial Greeting</label>
                                <input
                                    type="text"
                                    value={caseData.config?.greeting || ''}
                                    onChange={e => updateConfig('greeting', e.target.value)}
                                    className="input-dark"
                                    placeholder="e.g., Doctor, I've had this terrible chest pain since this morning..."
                                />
                                <p className="text-[10px] text-neutral-500 mt-1">What the patient says when the conversation starts</p>
                            </div>
                            <div>
                                <label className="label-xs">Behavioral Constraints & Guides</label>
                                <textarea
                                    value={caseData.config?.constraints || ''}
                                    onChange={e => updateConfig('constraints', e.target.value)}
                                    className="input-dark h-20"
                                    placeholder="e.g., Only speaks English. Will not reveal drug use unless asked directly. Gets defensive when asked about alcohol."
                                />
                                <p className="text-[10px] text-neutral-500 mt-1">Rules the AI must follow during the conversation</p>
                            </div>
                        </div>

                        {/* Story Mode Toggle */}
                        <div className="border-t border-neutral-700 pt-4">
                            <div className="flex items-center justify-between mb-4">
                                <h5 className="text-sm font-bold text-neutral-300">Patient Story</h5>
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
                                                    'Switching to Freeform will clear the structured history fields. Continue?',
                                                    { title: 'Switch to Freeform', confirmText: 'Switch', type: 'warning' }
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
                                        Freeform
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const current = caseData.config?.storyMode || 'freeform';
                                            if (current === 'structured') return;
                                            const hasFreeform = !!(caseData.system_prompt && caseData.system_prompt.trim());
                                            if (hasFreeform) {
                                                const ok = await toast.confirm(
                                                    'Switching to Structured will clear the freeform system prompt. Continue?',
                                                    { title: 'Switch to Structured', confirmText: 'Switch', type: 'warning' }
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
                                        Structured
                                    </button>
                                </div>
                            </div>

                            {/* Freeform Mode */}
                            {(caseData.config?.storyMode || 'freeform') === 'freeform' && (
                                <div>
                                    <label className="label-xs">Complete Patient Story / System Prompt</label>
                                    <textarea
                                        value={caseData.system_prompt || ''}
                                        onChange={e => setCaseData({ ...caseData, system_prompt: e.target.value })}
                                        className="input-dark h-64 font-mono text-xs"
                                        placeholder="Write the complete patient story here. Include all relevant medical history, current symptoms, medications, social history, and any other details the AI needs to accurately portray this patient..."
                                    />
                                    <p className="text-[10px] text-neutral-500 mt-1">Full narrative description of the patient case. This is the master instruction for the AI.</p>
                                </div>
                            )}

                            {/* Structured Mode */}
                            {caseData.config?.storyMode === 'structured' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="label-xs">Chief Complaint</label>
                                        <input
                                            type="text"
                                            value={caseData.config?.structuredHistory?.chiefComplaint || ''}
                                            onChange={e => updateStructuredHistoryField('chiefComplaint', e.target.value)}
                                            className="input-dark"
                                            placeholder="e.g., Chest pain for 2 hours"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">History of Present Illness (HPI)</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.hpi || ''}
                                            onChange={e => updateStructuredHistoryField('hpi', e.target.value)}
                                            className="input-dark h-24"
                                            placeholder="Describe the onset, location, duration, character, aggravating/alleviating factors, radiation, timing, and severity (OLDCARTS)..."
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">Past Medical History</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.pmh || ''}
                                                onChange={e => updateStructuredHistoryField('pmh', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Hypertension, Type 2 DM, Hyperlipidemia"
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">Past Surgical History</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.psh || ''}
                                                onChange={e => updateStructuredHistoryField('psh', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Appendectomy (2010), Cholecystectomy (2015)"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">Current Medications</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.medications || ''}
                                                onChange={e => updateStructuredHistoryField('medications', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Metformin 500mg BID, Lisinopril 10mg daily"
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">Allergies</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.allergies || ''}
                                                onChange={e => updateStructuredHistoryField('allergies', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Penicillin (rash), Sulfa (hives), NKDA"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label-xs">Social History</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.socialHistory || ''}
                                                onChange={e => updateStructuredHistoryField('socialHistory', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Smoker 1 PPD x 20 years, occasional alcohol, retired teacher, lives with spouse"
                                            />
                                        </div>
                                        <div>
                                            <label className="label-xs">Family History</label>
                                            <textarea
                                                value={caseData.config?.structuredHistory?.familyHistory || ''}
                                                onChange={e => updateStructuredHistoryField('familyHistory', e.target.value)}
                                                className="input-dark h-20"
                                                placeholder="e.g., Father - MI at 55, Mother - DM, Sister - breast cancer"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label-xs">Review of Systems (Positive Findings)</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.ros || ''}
                                            onChange={e => updateStructuredHistoryField('ros', e.target.value)}
                                            className="input-dark h-20"
                                            placeholder="e.g., Constitutional: fatigue, weight loss. Cardiac: chest pain, palpitations. Respiratory: SOB on exertion"
                                        />
                                    </div>
                                    <div>
                                        <label className="label-xs">Additional Notes for AI</label>
                                        <textarea
                                            value={caseData.config?.structuredHistory?.additionalNotes || ''}
                                            onChange={e => updateStructuredHistoryField('additionalNotes', e.target.value)}
                                            className="input-dark h-16"
                                            placeholder="Any additional context or instructions for the AI..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Case Description */}
                        <div className="border-t border-neutral-700 pt-4">
                            <label className="label-xs">Case Summary (for case selection screen)</label>
                            <textarea
                                value={caseData.description || ''}
                                onChange={e => setCaseData({ ...caseData, description: e.target.value })}
                                className="input-dark h-16"
                                placeholder="Brief summary shown when selecting cases..."
                            />
                        </div>
                    </div>
                )}

                {/* STEP 4: VITALS & ALARMS */}
                {step === 5 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">4. Initial Vitals & Alarms</h4>

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
                                                <span className="text-orange-400 font-bold text-sm">Override Mode</span>
                                                <span className="text-xs text-orange-300">- Custom vitals will replace scenario's first frame</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-blue-400 font-bold text-sm">Reading from Scenario</span>
                                                <span className="text-xs text-blue-300">- Values below show scenario's starting vitals</span>
                                            </>
                                        )
                                    ) : (
                                        caseData.config?.initialVitals ? (
                                            <>
                                                <span className="text-green-400 font-bold text-sm">Custom Vitals Set</span>
                                                <span className="text-xs text-green-300">- These vitals will be applied when case loads</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-neutral-400 font-bold text-sm">Default Vitals</span>
                                                <span className="text-xs text-neutral-500">- Using system defaults (HR: 72, SpO2: 98%, etc.)</span>
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
                                            Reset to Scenario
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
                                            Reset to Defaults
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Alarm Thresholds - TOP */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">Alarm Thresholds</h5>
                            <p className="text-xs text-neutral-500 mb-4">Set alarm limits for this case. Leave empty to use system defaults.</p>

                            <div className="space-y-3">
                                {[
                                    { key: 'hr', label: 'Heart Rate', unit: 'bpm', defaultLow: 50, defaultHigh: 120 },
                                    { key: 'spo2', label: 'SpO2', unit: '%', defaultLow: 90, defaultHigh: null },
                                    { key: 'rr', label: 'Resp Rate', unit: '/min', defaultLow: 8, defaultHigh: 30 },
                                    { key: 'bpSys', label: 'BP Systolic', unit: 'mmHg', defaultLow: 90, defaultHigh: 180 },
                                    { key: 'bpDia', label: 'BP Diastolic', unit: 'mmHg', defaultLow: 50, defaultHigh: 110 },
                                    { key: 'temp', label: 'Temperature', unit: '°C', defaultLow: 36, defaultHigh: 38.5 },
                                    { key: 'etco2', label: 'EtCO2', unit: 'mmHg', defaultLow: 30, defaultHigh: 50 }
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
                                                placeholder={`Low (${vital.defaultLow || '-'})`}
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
                                                placeholder={`High (${vital.defaultHigh || '-'})`}
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
                                <h5 className="text-sm font-bold text-white">Vital Signs</h5>
                                {hasScenario && !vitalsOverridden && (
                                    <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded">From Scenario</span>
                                )}
                                {vitalsOverridden && (
                                    <span className="text-xs text-orange-400 bg-orange-900/30 px-2 py-1 rounded">Override</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">Heart Rate (bpm)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.hr ?? scenarioVitals?.hr ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), hr: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="250"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">SpO2 (%)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.spo2 ?? scenarioVitals?.spo2 ?? 98}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), spo2: parseInt(e.target.value) || 98 })}
                                        className="input-dark"
                                        min="50" max="100"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Respiratory Rate (/min)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.rr ?? scenarioVitals?.rr ?? 16}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), rr: parseInt(e.target.value) || 16 })}
                                        className="input-dark"
                                        min="4" max="60"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Temperature (C)</label>
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
                                    <label className="label-xs">BP Systolic (mmHg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpSys ?? scenarioVitals?.bpSys ?? 120}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpSys: parseInt(e.target.value) || 120 })}
                                        className="input-dark"
                                        min="40" max="300"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">BP Diastolic (mmHg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpDia ?? scenarioVitals?.bpDia ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpDia: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="200"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="label-xs">EtCO2 (mmHg)</label>
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
                            <h5 className="text-sm font-bold text-white mb-3">ECG Rhythm</h5>
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
                            <h5 className="text-sm font-bold text-white mb-3">ECG Conditions</h5>
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
                                    <span className="text-sm text-neutral-300">PVCs (Premature Ventricular)</span>
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
                                    <span className="text-sm text-neutral-300">Wide QRS</span>
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
                                    <span className="text-sm text-neutral-300">T-Wave Inversion</span>
                                </label>
                                <div>
                                    <label className="label-xs">ST Elevation (0-5)</label>
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
                        <h4 className="text-lg font-bold text-teal-400">3. Progression Scenario (Optional)</h4>
                        <p className="text-xs text-neutral-500">Add automatic deterioration or improvement over time. Choose from quick templates or browse the full repository.</p>

                        {/* Scenario Selector */}
                        <div className="space-y-4">
                            {/* Repository Browser */}
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <h5 className="text-sm font-bold text-blue-300">Scenario Repository</h5>
                                        <p className="text-xs text-neutral-400">Browse reusable scenarios from database</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Switch to scenarios tab
                                            setActiveTab('scenarios');
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold flex items-center gap-2"
                                    >
                                        <Database className="w-4 h-4" />
                                        Browse Repository
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
                                    const source = isRepo ? 'Repository' : 'Built-in Template';
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
                                                Remove
                                            </button>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* OR divider */}
                            <div className="flex items-center gap-4 text-neutral-500 text-xs">
                                <div className="flex-1 border-t border-neutral-700"></div>
                                <span>OR USE QUICK TEMPLATE</span>
                                <div className="flex-1 border-t border-neutral-700"></div>
                            </div>

                            <div>
                                <label className="label-xs">Quick Templates</label>
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
                                                'This will replace the current scenario timeline. Continue?',
                                                { title: 'Replace scenario?', confirmText: 'Replace', type: 'warning' }
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
                                    <option value="none">No Scenario (Static Patient)</option>
                                    {caseData.scenario_from_repository && (
                                        <option value="_repository">
                                            {caseData.scenario_from_repository.name} (Repository)
                                        </option>
                                    )}
                                    {publicScenarios.length > 0 && (
                                        <optgroup label="Public Scenarios">
                                            {publicScenarios.map(s => (
                                                <option key={s.id} value={`_db_${s.id}`}>
                                                    {s.name}{s.category ? ` — ${s.category}` : ''}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                    <optgroup label="Built-in Templates">
                                        {Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => (
                                            <option key={key} value={key}>
                                                {template.name} - {template.description}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                                <p className="text-xs text-neutral-500 mt-1">
                                    {caseData.scenario_from_repository
                                        ? 'Currently using a scenario from the repository'
                                        : 'Choose a public scenario or a built-in template'}
                                </p>
                            </div>

                            {/* Duration Selector — only for built-in templates, not repository scenarios */}
                            {caseData.scenario_template && caseData.scenario_template !== 'none' && (
                                <div>
                                    <label className="label-xs">Progression Duration</label>
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
                                        <option value="5">Very Fast (5 minutes)</option>
                                        <option value="10">Fast (10 minutes)</option>
                                        <option value="15">15 minutes</option>
                                        <option value="20">20 minutes</option>
                                        <option value="30">Standard (30 minutes)</option>
                                        <option value="45">45 minutes</option>
                                        <option value="60">1 hour</option>
                                        <option value="90">1.5 hours</option>
                                        <option value="120">2 hours</option>
                                    </select>
                                    <p className="text-xs text-neutral-500 mt-1">
                                        Patient will progress from initial state to late stage over {caseData.scenario_duration} minutes.
                                    </p>
                                </div>
                            )}

                            {/* Preview */}
                            {caseData.scenario?.timeline && (
                                <div className="mt-4 bg-neutral-800 border border-neutral-700 rounded p-4">
                                    <h5 className="text-sm font-bold mb-2 text-teal-300">Timeline Preview</h5>
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
                                        Auto-start scenario when case loads (otherwise instructor must trigger manually)
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* STEP 5: LABORATORY INVESTIGATIONS */}
                {step === 6 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-teal-400">5. Laboratory Investigations</h4>
                        <p className="text-xs text-neutral-500">
                            Configure lab tests with smart search, clinical panel templates, and visual value editors.
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
                        <h4 className="text-lg font-bold text-teal-400">9. Treatment Configuration</h4>
                        <p className="text-xs text-neutral-500">
                            Configure which treatments are expected, contraindicated, or hidden for this case.
                            Assign points for correct treatment decisions and provide feedback for learning.
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
                <button onClick={onCancel} className="text-neutral-500 hover:text-white px-4">Cancel</button>
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
                            Back
                        </button>
                    )}

                    {/* Save Progress button on all steps except last */}
                    {step < 9 && (
                        <button
                            onClick={onSave}
                            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Save className="w-4 h-4" /> Save Progress
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
                            Next
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
                            <Save className="w-4 h-4" /> Save & Finish
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
