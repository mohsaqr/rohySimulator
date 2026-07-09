import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Users, Plus, Trash2, Pencil, ArrowLeft, KeyRound, Copy,
    Check, Loader2, UserPlus, X, ChevronDown, ChevronRight,
    GraduationCap, BookOpen, Save,
    ListChecks, LayoutGrid, BarChart3, Download, Activity,
    Target, Percent, SlidersHorizontal, Info,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/apiClient';
import { roleLabel } from '../../constants/roleLabels';
import {
    listCohorts, getCohort, createCohort, deleteCohort,
    addCohortMember, removeCohortMember, rotateJoinCode, disableJoinCode,
    updateCohort, assignCohortCases, unassignCohortCase,
    addCohortTeacher, removeCohortTeacher,
} from '../../services/cohortsService';
import CohortReports from './CohortReports';
import { CasePicker, PeoplePicker } from './CohortPickers';

const errMsg = (e, fallback) =>
    e instanceof ApiError ? (e.message || fallback) : fallback;

const INPUT =
    'w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500';

// One-click report shortcuts surfaced directly on each class card, so a
// teacher reaches any report in a single click instead of the old
// click-class → Reports tab → sub-tab drill (the "5 levels" complaint).
// `id` matches CohortReports' own sub-tab ids (it takes `initialView`).
const REPORT_SHORTCUTS = [
    { id: 'analytics', labelKey: 'report_analytics', icon: BarChart3 },
    { id: 'roster', labelKey: 'report_roster', icon: ListChecks },
    { id: 'grid', labelKey: 'report_grid', icon: LayoutGrid },
    { id: 'feed', labelKey: 'report_feed', icon: Activity },
    { id: 'export', labelKey: 'report_export', icon: Download },
];

// Bounded-concurrency runner — used by bulk student add so we never fire N
// unbatched requests (the "27 typed adds → 27 toasts" problem). Returns a
// per-item {identifier, ok, status, alreadyMember, error} so the caller can
// build ONE summary toast.
async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await worker(items[i], i);
        }
    });
    await Promise.all(runners);
    return results;
}

// Teacher / admin cohort ("class") management. Teachers manage their own
// cohorts; admins see all (server enforces — this UI just renders whatever
// GET /cohorts returns for the caller).
export default function CohortsManagementTab() {
    const { t } = useTranslation('teacher_cohorts');
    const toast = useToast();
    const [cohorts, setCohorts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    // Drill-down target. `null` = list view. Otherwise
    // { id, section: 'manage'|'reports'|'settings', reportView } — a card
    // mini-icon can open a class straight on a specific report.
    const [open, setOpen] = useState(null);
    const openCohort = useCallback(
        (id, section = 'manage', reportView = 'roster') =>
            setOpen({ id, section, reportView }),
        [],
    );
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Rich-create extra fields (kept collapsed by default so the bare
    // name-only create — and its existing test — is unchanged).
    const [desc, setDesc] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [withJoinCode, setWithJoinCode] = useState(false);
    const [caseSel, setCaseSel] = useState(() => new Set());
    const [coteacherIds, setCoteacherIds] = useState([]);
    const [studentIds, setStudentIds] = useState([]);
    const [busyCodeId, setBusyCodeId] = useState(null);
    const [copiedCodeId, setCopiedCodeId] = useState(null);

    const loadCohorts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listCohorts();
            setCohorts(data.cohorts || []);
        } catch (e) {
            toast.error(errMsg(e, t('toast_load_classes_failed')));
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    useEffect(() => { loadCohorts(); }, [loadCohorts]);

    const resetCreateForm = () => {
        setNewName('');
        setDesc('');
        setStartsAt('');
        setEndsAt('');
        setWithJoinCode(false);
        setCaseSel(new Set());
        setCoteacherIds([]);
        setStudentIds([]);
        setShowAdvanced(false);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
            toast.error(t('error_start_before_end'));
            return;
        }
        setCreating(true);
        try {
            // Build ONE payload. When the advanced panel is untouched this
            // collapses to {name} — identical to the legacy name-only POST.
            const payload = { name };
            if (showAdvanced) {
                if (desc.trim()) payload.description = desc.trim();
                if (startsAt) payload.starts_at = new Date(startsAt).toISOString();
                if (endsAt) payload.ends_at = new Date(endsAt).toISOString();
                if (withJoinCode) payload.join_code = true;
                if (caseSel.size) payload.case_ids = [...caseSel];
                if (coteacherIds.length) payload.coteacher_identifiers = coteacherIds;
            }
            const created = await createCohort(
                Object.keys(payload).length === 1 ? name : payload,
            );
            const newId = created?.cohort?.id;

            // Initial bulk student add (advanced only). Done after create so
            // a partial student failure never blocks the cohort itself.
            let studentSummary = '';
            if (showAdvanced && newId && studentIds.length) {
                const r = await bulkAddStudents(newId, studentIds);
                studentSummary = summarise(r, t);
            }
            resetCreateForm();
            toast.success(
                studentSummary
                    ? t('toast_class_created_with_summary', { name, summary: studentSummary })
                    : t('toast_class_created', { name }),
            );
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, t('toast_create_class_failed')));
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (cohort) => {
        const ok = await toast.confirm(
            t('confirm_delete_msg', { name: cohort.name }),
            { title: t('confirm_delete_title'), confirmText: t('btn_delete'), type: 'danger' },
        );
        if (!ok) return;
        try {
            await deleteCohort(cohort.id);
            toast.success(t('toast_class_deleted'));
            if (open?.id === cohort.id) setOpen(null);
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, t('toast_delete_class_failed')));
        }
    };

    const handleListCode = async (cohort) => {
        setBusyCodeId(cohort.id);
        try {
            const data = await rotateJoinCode(cohort.id);
            setCohorts((rows) => rows.map((c) => c.id === cohort.id ? { ...c, join_code: data.join_code } : c));
            toast.success(t('toast_reg_code_generated'));
        } catch (err) {
            toast.error(errMsg(err, t('toast_reg_code_failed')));
        } finally {
            setBusyCodeId(null);
        }
    };

    const copyListCode = async (cohort) => {
        if (!cohort.join_code) return;
        try {
            await navigator.clipboard.writeText(cohort.join_code);
            setCopiedCodeId(cohort.id);
            setTimeout(() => setCopiedCodeId(null), 1500);
        } catch {
            toast.error(t('toast_copy_reg_code_failed'));
        }
    };

    const summary = {
        courses: cohorts.length,
        members: cohorts.reduce((n, c) => n + Number(c.student_count ?? c.students_count ?? c.member_count ?? 0), 0),
        codes: cohorts.filter(c => c.join_code).length,
    };

    if (open != null) {
        return (
            <CohortRoster
                cohortId={open.id}
                initialSection={open.section}
                initialReportView={open.reportView}
                onBack={() => { setOpen(null); loadCohorts(); }}
            />
        );
    }

    return (
        <div className="max-w-5xl">
            <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-bold">{t('heading_courses')}</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-6">
                {t('subtitle_courses')}
            </p>

            <div className="grid grid-cols-3 gap-2 mb-6">
                <Stat label={t('stat_courses')} value={summary.courses} />
                <Stat label={t('stat_enrolled_students')} value={summary.members} />
                <Stat label={t('stat_active_codes')} value={summary.codes} />
            </div>

            <form onSubmit={handleCreate} className="mb-8 space-y-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('placeholder_new_course')}
                        className={`flex-1 ${INPUT}`}
                    />
                    <button
                        type="submit"
                        disabled={creating || !newName.trim()}
                        className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                        {creating
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Plus className="w-4 h-4" />}
                        {t('btn_create_course')}
                    </button>
                </div>

                <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
                >
                    {showAdvanced
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />}
                    {t('btn_add_details')}
                </button>

                {showAdvanced && (
                    <div className="space-y-5 p-4 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                {t('label_description')}
                            </label>
                            <textarea
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                rows={2}
                                placeholder={t('placeholder_desc_optional')}
                                className={`${INPUT} resize-y`}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                    {t('label_start_date')}
                                </label>
                                <input
                                    type="date"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                    className={INPUT}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                    {t('label_end_date')}
                                </label>
                                <input
                                    type="date"
                                    value={endsAt}
                                    onChange={(e) => setEndsAt(e.target.value)}
                                    className={INPUT}
                                />
                            </div>
                        </div>
                                <label className="flex items-center gap-2.5 text-sm text-neutral-200 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={withJoinCode}
                                onChange={(e) => setWithJoinCode(e.target.checked)}
                                className="w-4 h-4 accent-purple-600"
                            />
                                    {t('label_generate_join_now')}
                                </label>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 mb-2">
                                <BookOpen className="w-3.5 h-3.5" /> {t('label_assign_cases_library')}
                            </div>
                            <CasePicker
                                selected={caseSel}
                                onToggle={(id) =>
                                    setCaseSel((prev) => {
                                        const n = new Set(prev);
                                        if (n.has(id)) n.delete(id); else n.add(id);
                                        return n;
                                    })}
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 mb-2">
                                <GraduationCap className="w-3.5 h-3.5" /> {t('label_coteachers')}
                            </div>
                            <PeoplePicker mode="teachers" onChange={setCoteacherIds} />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 mb-2">
                                <UserPlus className="w-3.5 h-3.5" /> {t('label_initial_students')}
                            </div>
                            <PeoplePicker mode="students" onChange={setStudentIds} />
                        </div>
                    </div>
                )}
            </form>

            {loading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : cohorts.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('empty_no_courses')}</p>
            ) : (
                <div className="space-y-2">
                    {cohorts.map((c) => (
                        <div
                            key={c.id}
                            className="group flex flex-col gap-3 p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg transition-colors hover:border-neutral-600 sm:flex-row sm:items-center"
                        >
                            <button
                                onClick={() => openCohort(c.id)}
                                className="flex-1 min-w-0 text-left"
                                title={t('title_manage_course')}
                            >
                                <div className="font-bold text-white truncate">{c.name}</div>
                                <div className="text-xs text-neutral-400 mt-0.5">
                                    {t('card_enrolled_students', { count: c.student_count ?? c.students_count ?? c.member_count ?? 0 })}
                                    {' · '}
                                    {c.join_code ? t('card_code_active') : t('card_no_code')}
                                </div>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                                {c.join_code ? (
                                    <button
                                        type="button"
                                        onClick={() => copyListCode(c)}
                                        title={t('title_copy_reg_code')}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-purple-300 hover:border-purple-500"
                                    >
                                        {copiedCodeId === c.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        {c.join_code}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleListCode(c)}
                                        disabled={busyCodeId === c.id}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-xs text-white"
                                    >
                                        {busyCodeId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                                        {t('btn_generate_code')}
                                    </button>
                                )}
                            </div>

                            {/* One-click report shortcuts — the whole point:
                                no more class → Reports → sub-tab drilling. */}
                            <div className="flex items-center gap-0.5 shrink-0">
                                {REPORT_SHORTCUTS.map((s) => {
                                    const Icon = s.icon;
                                    const label = t(s.labelKey);
                                    return (
                                        <button
                                            key={s.id}
                                            onClick={() => openCohort(c.id, 'reports', s.id)}
                                            title={label}
                                            aria-label={t('aria_report', { label, name: c.name })}
                                            className="p-2 text-neutral-400 hover:text-purple-300 hover:bg-neutral-700 rounded-lg transition-colors"
                                        >
                                            <Icon className="w-4 h-4" />
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="hidden sm:block w-px h-6 bg-neutral-700 shrink-0" />

                            <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                    onClick={() => openCohort(c.id, 'settings')}
                                    title={t('title_class_settings')}
                                    aria-label={t('aria_class_settings', { name: c.name })}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(c)}
                                    title={t('title_delete')}
                                    className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// Throttled bulk student add: bounded concurrency, single classified result
// set. 200 with already_teacher / membership-already-live are NOT errors —
// we count them as skipped so the summary toast is honest.
async function bulkAddStudents(cohortId, identifiers) {
    const unique = [...new Set(identifiers.map((s) => String(s).trim()).filter(Boolean))];
    return runWithConcurrency(unique, 4, async (identifier) => {
        try {
            const r = await addCohortMember(cohortId, identifier);
            return {
                identifier,
                ok: true,
                alreadyMember: r?.already_teacher === true || r?.membership?.created === false,
            };
        } catch (e) {
            return {
                identifier,
                ok: false,
                error: errMsg(e, 'add failed'),
            };
        }
    });
}

function summarise(results, t) {
    const added = results.filter((r) => r.ok && !r.alreadyMember).length;
    const skipped = results.filter((r) => r.ok && r.alreadyMember).length;
    const failed = results.filter((r) => !r.ok).length;
    const parts = [t('summary_added', { count: added })];
    if (skipped) parts.push(t('summary_already_member', { count: skipped }));
    if (failed) parts.push(t('summary_failed', { count: failed }));
    return parts.join(', ') + '.';
}

function Stat({ label, value }) {
    return (
        <div className="p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg">
            <div className="text-xl font-bold text-white">{value}</div>
            <div className="text-xs text-neutral-400 uppercase tracking-wide font-semibold">{label}</div>
        </div>
    );
}

// Roster + join-code + Phase-8 Settings management for a single cohort.
function CohortRoster({ cohortId, onBack, initialSection = 'manage', initialReportView = 'roster' }) {
    const { t } = useTranslation('teacher_cohorts');
    const toast = useToast();
    const [cohort, setCohort] = useState(null);
    const [members, setMembers] = useState([]);
    const [students, setStudents] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [identifier, setIdentifier] = useState('');
    const [adding, setAdding] = useState(false);
    const [copied, setCopied] = useState(false);
    const [busyCode, setBusyCode] = useState(false);
    const [section, setSection] = useState(initialSection); // 'manage' | 'reports' | 'settings'

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getCohort(cohortId);
            const studentRows = (data.students || data.members || []).filter((m) => !m.role || m.role === 'student');
            setCohort(data.cohort || null);
            setMembers(data.members || []);
            setStudents(studentRows);
            setTeachers(data.teachers || []);
            setCases(data.cases || []);
        } catch (e) {
            toast.error(errMsg(e, t('toast_load_course_failed')));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast, t]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async (e) => {
        e.preventDefault();
        const id = identifier.trim();
        if (!id) return;
        setAdding(true);
        try {
            await addCohortMember(cohortId, id);
            setIdentifier('');
            toast.success(t('toast_member_added'));
            await load();
        } catch (err) {
            toast.error(errMsg(err, t('toast_add_member_failed')));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (m) => {
        const ok = await toast.confirm(
            t('confirm_remove_member_msg', { name: m.username || m.name }),
            { title: t('confirm_remove_member_title'), confirmText: t('btn_remove'), type: 'danger' },
        );
        if (!ok) return;
        try {
            await removeCohortMember(cohortId, m.id);
            toast.success(t('toast_member_removed'));
            await load();
        } catch (err) {
            toast.error(errMsg(err, t('toast_remove_member_failed')));
        }
    };

    const handleRotate = async () => {
        setBusyCode(true);
        try {
            const data = await rotateJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: data.join_code } : c));
            toast.success(t('toast_join_code_generated'));
        } catch (err) {
            toast.error(errMsg(err, t('toast_join_code_failed')));
        } finally {
            setBusyCode(false);
        }
    };

    const handleDisableCode = async () => {
        setBusyCode(true);
        try {
            await disableJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: null } : c));
            toast.success(t('toast_join_code_disabled'));
        } catch (err) {
            toast.error(errMsg(err, t('toast_disable_join_code_failed')));
        } finally {
            setBusyCode(false);
        }
    };

    const handleCopy = async () => {
        if (!cohort?.join_code) return;
        try {
            await navigator.clipboard.writeText(cohort.join_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error(t('toast_copy_failed'));
        }
    };

    return (
        <div className="max-w-6xl">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-5 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> {t('btn_back_courses')}
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : !cohort ? (
                <p className="text-sm text-neutral-500">{t('empty_course_not_found')}</p>
            ) : (
                <>
                    <div className="mb-5 rounded-2xl border border-neutral-700 bg-neutral-900/60 p-5 shadow-xl shadow-black/20">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                    {t('label_course_workspace')}
                                </div>
                                <h3 className="mt-1 text-2xl font-bold text-white">{cohort.name}</h3>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
                                    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-1">
                                        {t('card_enrolled_students', { count: students.length })}
                                    </span>
                                    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-1">
                                        {t('badge_instructors', { count: teachers.length })}
                                    </span>
                                    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-1">
                                        {t('badge_assigned_cases', { count: cases.length })}
                                    </span>
                                    <span className={`rounded-full border px-2.5 py-1 ${cohort.join_code ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-neutral-700 bg-neutral-800 text-neutral-400'}`}>
                                        {cohort.join_code ? t('badge_code_active') : t('badge_no_code')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Manage (Phase-3b) | Reports (Phase-5) | Settings
                        (Phase-9). The Manage body is unchanged; it just no
                        longer renders while another section is active. */}
                    <div className="mb-6 inline-flex rounded-xl border border-neutral-700 bg-neutral-900 p-1">
                        {[
                            { id: 'manage', label: t('tab_manage') },
                            { id: 'reports', label: t('tab_reports') },
                            { id: 'settings', label: t('tab_settings') },
                        ].map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSection(s.id)}
                                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                                    section === s.id
                                        ? 'bg-white text-neutral-950 shadow-sm'
                                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                                }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {section === 'reports' && (
                        <CohortReports
                            cohortId={cohortId}
                            initialView={initialReportView}
                        />
                    )}

                    {section === 'settings' && (
                        <CohortSettings
                            cohort={cohort}
                            cases={cases}
                            teachers={teachers}
                            onChanged={load}
                        />
                    )}

                    {section === 'manage' && (
                    <>
                    {/* Join code — semi-sensitive: only shown to the owner/admin
                        the API returned it to. Sharing it lets students self-join. */}
                    <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg mb-8">
                        <div className="flex items-center gap-2 mb-2">
                            <KeyRound className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-bold text-neutral-200">{t('label_reg_code')}</span>
                        </div>
                        {cohort.join_code ? (
                            <div className="flex items-center gap-2">
                                <code className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-purple-300 font-mono text-sm tracking-wider">
                                    {cohort.join_code}
                                </code>
                                <button
                                    onClick={handleCopy}
                                    title={t('title_copy_reg_code')}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    {copied
                                        ? <Check className="w-4 h-4 text-green-400" />
                                        : <Copy className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={handleRotate}
                                    disabled={busyCode}
                                    className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                                >
                                    {t('btn_rotate')}
                                </button>
                                <button
                                    onClick={handleDisableCode}
                                    disabled={busyCode}
                                    className="px-3 py-2 bg-neutral-700 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                                >
                                    {t('btn_disable')}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleRotate}
                                disabled={busyCode}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                            >
                                {busyCode
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <KeyRound className="w-4 h-4" />}
                                {t('btn_generate_reg_code')}
                            </button>
                        )}
                        <p className="text-xs text-neutral-500 mt-2">
                            {t('help_reg_code')}
                        </p>
                    </div>

                    {/* Single-add (unchanged) + bulk-add */}
                    <form onSubmit={handleAdd} className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder={t('placeholder_add_student')}
                            className={`flex-1 ${INPUT}`}
                        />
                        <button
                            type="submit"
                            disabled={adding || !identifier.trim()}
                            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                        >
                            {adding
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <UserPlus className="w-4 h-4" />}
                            {t('btn_add_student')}
                        </button>
                    </form>

                    <BulkStudentAdd
                        cohortId={cohortId}
                        excludeIds={members.map((m) => m.id)}
                        onDone={load}
                    />

                    {/* Roster */}
                    <h4 className="text-sm font-bold text-neutral-300 mt-8 mb-2">
                        {t('heading_students', { count: students.length })}
                    </h4>
                    {students.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                            <span>{t('empty_no_students_lead')}</span>{' '}
                            {t('empty_no_students_hint')}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {students.map((m) => (
                                <div
                                    key={m.id}
                                    className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-white truncate">
                                            {m.name || m.username}
                                        </div>
                                        <div className="text-xs text-neutral-400 truncate">
                                            {m.username}
                                            {m.role ? ` · ${roleLabel(m.role)}` : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemove(m)}
                                        title={t('title_remove_student')}
                                        className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    </>
                    )}
                </>
            )}
        </div>
    );
}

// Bulk student add — collapsible. Opens the searchable people picker (or
// the identifier textarea fallback for non-admin teachers), then performs
// ONE throttled batch with ONE summary toast.
function BulkStudentAdd({ cohortId, excludeIds, onDone }) {
    const { t } = useTranslation('teacher_cohorts');
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [ids, setIds] = useState([]);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (ids.length === 0) {
            toast.error(t('toast_select_one_student'));
            return;
        }
        setBusy(true);
        try {
            const results = await bulkAddStudents(cohortId, ids);
            const failed = results.filter((r) => !r.ok).length;
            const msg = summarise(results, t);
            if (failed && failed === results.length) toast.error(msg);
            else toast.success(msg);
            setOpen(false);
            setIds([]);
            await onDone();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
            >
                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {t('btn_add_bulk')}
            </button>
            {open && (
                <div className="mt-3 p-4 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                    <PeoplePicker
                        mode="students"
                        excludeIds={excludeIds}
                        onChange={setIds}
                    />
                    <button
                        type="button"
                        onClick={submit}
                        disabled={busy || ids.length === 0}
                        className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                    >
                        {busy
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <UserPlus className="w-4 h-4" />}
                        {t('btn_add_n_students', { count: ids.length })}
                    </button>
                </div>
            )}
        </div>
    );
}

// The full class module. Edit identity (name/description/dates), the
// classroom profile + policy (course code, term, objectives, passing
// score, retakes, debrief — stored in the cohort.settings JSON blob),
// assigned cases, and co-teachers. PATCH sends the full settings object
// verbatim (server REPLACES it) so we merge over whatever was already
// there and never silently drop an unknown key.
function CohortSettings({ cohort, cases, teachers, onChanged }) {
    const { t } = useTranslation('teacher_cohorts');
    const toast = useToast();
    const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

    // cohort.settings may arrive as a JSON string (raw DB row) or an
    // object — normalise once so every field seeds from one source.
    const baseSettings = (() => {
        if (cohort.settings == null) return {};
        const s = typeof cohort.settings === 'string'
            ? safeParse(cohort.settings)
            : cohort.settings;
        return isPlainObject(s) ? s : {};
    })();

    const [name, setName] = useState(cohort.name || '');
    const [desc, setDesc] = useState(cohort.description || '');
    const [startsAt, setStartsAt] = useState(toDateInput(cohort.starts_at));
    const [endsAt, setEndsAt] = useState(toDateInput(cohort.ends_at));

    // Educational classroom profile + policy (persisted in settings JSON).
    const [courseCode, setCourseCode] = useState(baseSettings.course_code || '');
    const [term, setTerm] = useState(baseSettings.term || '');
    const [objectives, setObjectives] = useState(baseSettings.objectives || '');
    const [passingScore, setPassingScore] = useState(
        baseSettings.passing_score == null ? '' : String(baseSettings.passing_score),
    );
    const [allowRetakes, setAllowRetakes] = useState(
        baseSettings.allow_retakes !== false, // default on
    );
    const [requireDebrief, setRequireDebrief] = useState(
        baseSettings.require_debrief === true, // default off
    );
    const [saving, setSaving] = useState(false);

    const [addCaseOpen, setAddCaseOpen] = useState(false);
    const [caseSel, setCaseSel] = useState(() => new Set());
    const [busyCase, setBusyCase] = useState(false);

    const [coteacherIds, setCoteacherIds] = useState([]);
    const [addTeacherOpen, setAddTeacherOpen] = useState(false);
    const [busyTeacher, setBusyTeacher] = useState(false);

    const assignedCaseIds = cases.map((c) => Number(c.id));

    const saveDetails = async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            toast.error(t('error_name_required'));
            return;
        }
        if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
            toast.error(t('error_start_before_end'));
            return;
        }
        let passNum;
        if (passingScore !== '') {
            passNum = Number(passingScore);
            if (!Number.isFinite(passNum) || passNum < 0 || passNum > 100) {
                toast.error(t('error_passing_score_range'));
                return;
            }
        }
        setSaving(true);
        try {
            // settings is a wholesale REPLACE server-side — merge the
            // classroom fields over whatever the row already held so an
            // unrelated future key is never silently dropped. Empty
            // optional values are deleted, not stored as "".
            const settings = { ...baseSettings };
            const setOrDrop = (key, val) => {
                if (val === undefined || val === '' || val === null) delete settings[key];
                else settings[key] = val;
            };
            setOrDrop('course_code', courseCode.trim());
            setOrDrop('term', term.trim());
            setOrDrop('objectives', objectives.trim());
            setOrDrop('passing_score', passNum);
            settings.allow_retakes = allowRetakes;
            settings.require_debrief = requireDebrief;

            await updateCohort(cohort.id, {
                name: trimmed,
                description: desc.trim() || null,
                starts_at: startsAt ? new Date(startsAt).toISOString() : null,
                ends_at: endsAt ? new Date(endsAt).toISOString() : null,
                settings,
            });
            toast.success(t('toast_details_saved'));
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, t('toast_save_failed')));
        } finally {
            setSaving(false);
        }
    };

    const addCases = async () => {
        if (caseSel.size === 0) return;
        setBusyCase(true);
        try {
            await assignCohortCases(cohort.id, [...caseSel]);
            toast.success(t('toast_cases_assigned', { count: caseSel.size }));
            setCaseSel(new Set());
            setAddCaseOpen(false);
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, t('toast_assign_cases_failed')));
        } finally {
            setBusyCase(false);
        }
    };

    const removeCase = async (c) => {
        const ok = await toast.confirm(
            t('confirm_unassign_msg', { name: c.name }),
            { title: t('confirm_unassign_title'), confirmText: t('btn_unassign'), type: 'danger' },
        );
        if (!ok) return;
        try {
            await unassignCohortCase(cohort.id, c.id);
            toast.success(t('toast_case_unassigned'));
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, t('toast_unassign_case_failed')));
        }
    };

    const addTeachers = async () => {
        if (coteacherIds.length === 0) return;
        setBusyTeacher(true);
        try {
            const results = await runWithConcurrency(
                [...new Set(coteacherIds)], 4,
                async (idf) => {
                    try { await addCohortTeacher(cohort.id, idf); return { ok: true }; }
                    catch (e) { return { ok: false, error: errMsg(e, 'failed') }; }
                },
            );
            const added = results.filter((r) => r.ok).length;
            const failed = results.length - added;
            toast.success(
                failed
                    ? t('toast_coteachers_added_with_failed', { count: added, failed })
                    : t('toast_coteachers_added', { count: added }),
            );
            setCoteacherIds([]);
            setAddTeacherOpen(false);
            await onChanged();
        } finally {
            setBusyTeacher(false);
        }
    };

    const removeTeacher = async (teacher) => {
        if (teacher.id === cohort.owner_user_id) return; // owner is non-removable
        const ok = await toast.confirm(
            t('confirm_remove_coteacher_msg', { name: teacher.username || teacher.name }),
            { title: t('confirm_remove_coteacher_title'), confirmText: t('btn_remove'), type: 'danger' },
        );
        if (!ok) return;
        try {
            await removeCohortTeacher(cohort.id, teacher.id);
            toast.success(t('toast_coteacher_removed'));
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, t('toast_remove_coteacher_failed')));
        }
    };

    return (
        <div className="space-y-8">
            <form onSubmit={saveDetails} className="space-y-6">
                {/* Identity */}
                <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-4">
                    <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                        <GraduationCap className="w-4 h-4 text-purple-400" />
                        {t('heading_class_identity')}
                    </h4>
                    <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                            {t('label_class_name')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={INPUT}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                            {t('label_description')}
                        </label>
                        <textarea
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            rows={3}
                            placeholder={t('placeholder_desc')}
                            className={`${INPUT} resize-y`}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                {t('label_course_code')}
                            </label>
                            <input
                                type="text"
                                value={courseCode}
                                onChange={(e) => setCourseCode(e.target.value)}
                                placeholder={t('placeholder_course_code')}
                                className={INPUT}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                {t('label_term')}
                            </label>
                            <input
                                type="text"
                                value={term}
                                onChange={(e) => setTerm(e.target.value)}
                                placeholder={t('placeholder_term')}
                                className={INPUT}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                {t('label_start_date')}
                            </label>
                            <input
                                type="date"
                                value={startsAt}
                                onChange={(e) => setStartsAt(e.target.value)}
                                className={INPUT}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                {t('label_end_date')}
                            </label>
                            <input
                                type="date"
                                value={endsAt}
                                onChange={(e) => setEndsAt(e.target.value)}
                                className={INPUT}
                            />
                        </div>
                    </div>
                </section>

                {/* Learning objectives */}
                <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-3">
                    <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                        <Target className="w-4 h-4 text-purple-400" />
                        {t('heading_objectives')}
                    </h4>
                    <textarea
                        value={objectives}
                        onChange={(e) => setObjectives(e.target.value)}
                        rows={4}
                        placeholder={t('placeholder_objectives')}
                        className={`${INPUT} resize-y`}
                    />
                </section>

                {/* Classroom policy */}
                <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-4">
                    <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-4 h-4 text-purple-400" />
                        {t('heading_policy')}
                    </h4>
                    <div className="max-w-xs">
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5 flex items-center gap-1.5">
                            <Percent className="w-3.5 h-3.5" /> {t('label_passing_score')}
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={passingScore}
                            onChange={(e) => setPassingScore(e.target.value)}
                            placeholder={t('placeholder_passing_score')}
                            className={INPUT}
                        />
                        <p className="text-xs text-neutral-500 mt-1">
                            {t('help_passing_score')}
                        </p>
                    </div>
                    <label className="flex items-start gap-2.5 text-sm text-neutral-200 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={allowRetakes}
                            onChange={(e) => setAllowRetakes(e.target.checked)}
                            className="w-4 h-4 mt-0.5 accent-purple-600"
                        />
                        <span>
                            {t('label_allow_retakes')}
                            <span className="block text-xs text-neutral-500">
                                {t('help_allow_retakes')}
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-2.5 text-sm text-neutral-200 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={requireDebrief}
                            onChange={(e) => setRequireDebrief(e.target.checked)}
                            className="w-4 h-4 mt-0.5 accent-purple-600"
                        />
                        <span>
                            {t('label_require_debrief')}
                            <span className="block text-xs text-neutral-500">
                                {t('help_require_debrief')}
                            </span>
                        </span>
                    </label>
                    <p className="text-xs text-neutral-500 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {t('help_policy_info')}
                    </p>
                </section>

                <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                >
                    {saving
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Save className="w-4 h-4" />}
                    {t('btn_save_settings')}
                </button>
            </form>

            {/* Assigned cases */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-neutral-300 flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4" /> {t('heading_assigned_cases', { count: cases.length })}
                    </h4>
                    <button
                        type="button"
                        onClick={() => setAddCaseOpen((v) => !v)}
                        className="text-xs text-purple-300 hover:text-purple-200"
                    >
                        {addCaseOpen ? t('btn_close') : t('btn_add_cases')}
                    </button>
                </div>
                {addCaseOpen && (
                    <div className="mb-3 p-4 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                        <CasePicker
                            selected={caseSel}
                            excludeIds={assignedCaseIds}
                            onToggle={(id) =>
                                setCaseSel((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(id)) n.delete(id); else n.add(id);
                                    return n;
                                })}
                        />
                        <button
                            type="button"
                            onClick={addCases}
                            disabled={busyCase || caseSel.size === 0}
                            className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            {busyCase
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Plus className="w-4 h-4" />}
                            {t('btn_assign_n', { count: caseSel.size })}
                        </button>
                    </div>
                )}
                {cases.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                        {t('empty_no_cases_assigned')}
                    </p>
                ) : (
                    <div className="space-y-2">
                        {cases.map((c) => (
                            <div
                                key={c.id}
                                className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                            >
                                <span className="flex-1 text-sm text-white truncate">
                                    {c.name}
                                </span>
                                <button
                                    onClick={() => removeCase(c)}
                                    title={t('title_unassign_case')}
                                    className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Co-teachers */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-neutral-300 flex items-center gap-1.5">
                        <GraduationCap className="w-4 h-4" /> {t('heading_coteachers', { count: teachers.length })}
                    </h4>
                    <button
                        type="button"
                        onClick={() => setAddTeacherOpen((v) => !v)}
                        className="text-xs text-purple-300 hover:text-purple-200"
                    >
                        {addTeacherOpen ? t('btn_close') : t('btn_add_coteachers')}
                    </button>
                </div>
                {addTeacherOpen && (
                    <div className="mb-3 p-4 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                        <PeoplePicker mode="teachers" onChange={setCoteacherIds} />
                        <button
                            type="button"
                            onClick={addTeachers}
                            disabled={busyTeacher || coteacherIds.length === 0}
                            className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            {busyTeacher
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Plus className="w-4 h-4" />}
                            {t('btn_add_coteachers')}
                        </button>
                    </div>
                )}
                <div className="space-y-2">
                    {/* Owner is always a teacher of their cohort and is not a
                        cohort_members row — show it, non-removable. */}
                    <div className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-white truncate">{t('label_owner')}</div>
                            <div className="text-xs text-neutral-400">
                                {t('help_owner')}
                            </div>
                        </div>
                    </div>
                    {teachers.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                            {t('empty_no_coteachers')}
                        </p>
                    ) : (
                        teachers.map((teacher) => (
                            <div
                                key={teacher.id}
                                className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-white truncate">
                                        {teacher.name || teacher.username}
                                    </div>
                                    <div className="text-xs text-neutral-400 truncate">
                                        {teacher.username}
                                        {teacher.role ? ` · ${roleLabel(teacher.role)}` : ''}
                                    </div>
                                </div>
                                {teacher.id === cohort.owner_user_id ? (
                                    <span className="text-xs text-neutral-500 px-2">{t('label_owner')}</span>
                                ) : (
                                    <button
                                        onClick={() => removeTeacher(teacher)}
                                        title={t('title_remove_coteacher')}
                                        className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return undefined; }
}

function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}
