import React, { useCallback, useEffect, useState } from 'react';
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
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'roster', label: 'Roster', icon: ListChecks },
    { id: 'grid', label: 'Completion grid', icon: LayoutGrid },
    { id: 'feed', label: 'Live feed', icon: Activity },
    { id: 'export', label: 'Export', icon: Download },
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

    const loadCohorts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listCohorts();
            setCohorts(data.cohorts || []);
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load classes'));
        } finally {
            setLoading(false);
        }
    }, [toast]);

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
            toast.error('Start date must be on or before the end date');
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
                studentSummary = ` ${summarise(r)}`;
            }
            resetCreateForm();
            // No trailing punctuation in the base case (keeps the legacy
            // name-only toast string stable); the student summary, when
            // present, brings its own leading space + sentence.
            toast.success(
                studentSummary
                    ? `Class "${name}" created.${studentSummary}`
                    : `Class "${name}" created`,
            );
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to create class'));
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (cohort) => {
        const ok = await toast.confirm(
            `Delete "${cohort.name}"? This removes the class grouping and its members' access to it. Members' accounts and their own data are not affected.`,
            { title: 'Delete class', confirmText: 'Delete', type: 'danger' },
        );
        if (!ok) return;
        try {
            await deleteCohort(cohort.id);
            toast.success('Class deleted');
            if (open?.id === cohort.id) setOpen(null);
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to delete class'));
        }
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
                <h3 className="text-lg font-bold">Classes</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-6">
                Group students into classes. Students join with a join code
                under My Profile → Join a class.
            </p>

            <form onSubmit={handleCreate} className="mb-8 space-y-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="New class name"
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
                        Create
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
                    Add details, cases, co-teachers &amp; students
                </button>

                {showAdvanced && (
                    <div className="space-y-5 p-4 bg-neutral-800/40 border border-neutral-700 rounded-lg">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Description
                            </label>
                            <textarea
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                rows={2}
                                placeholder="What is this class for? (optional)"
                                className={`${INPUT} resize-y`}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                    Start date
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
                                    End date
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
                            Generate a join code now (students self-enrol with it)
                        </label>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 mb-2">
                                <BookOpen className="w-3.5 h-3.5" /> Assign cases from the library
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
                                <GraduationCap className="w-3.5 h-3.5" /> Co-teachers
                            </div>
                            <PeoplePicker mode="teachers" onChange={setCoteacherIds} />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 mb-2">
                                <UserPlus className="w-3.5 h-3.5" /> Initial students
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
                <p className="text-sm text-neutral-500">No classes yet. Create one above.</p>
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
                                title="Manage this class"
                            >
                                <div className="font-bold text-white truncate">{c.name}</div>
                                <div className="text-xs text-neutral-400 mt-0.5">
                                    {c.member_count ?? 0} member{(c.member_count ?? 0) === 1 ? '' : 's'}
                                    {' · '}
                                    {c.join_code ? 'join code active' : 'no join code'}
                                </div>
                            </button>

                            {/* One-click report shortcuts — the whole point:
                                no more class → Reports → sub-tab drilling. */}
                            <div className="flex items-center gap-0.5 shrink-0">
                                {REPORT_SHORTCUTS.map((s) => {
                                    const Icon = s.icon;
                                    return (
                                        <button
                                            key={s.id}
                                            onClick={() => openCohort(c.id, 'reports', s.id)}
                                            title={s.label}
                                            aria-label={`${s.label} — ${c.name}`}
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
                                    title="Class settings"
                                    aria-label={`Class settings — ${c.name}`}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(c)}
                                    title="Delete"
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

function summarise(results) {
    const added = results.filter((r) => r.ok && !r.alreadyMember).length;
    const skipped = results.filter((r) => r.ok && r.alreadyMember).length;
    const failed = results.filter((r) => !r.ok).length;
    const parts = [`Added ${added}`];
    if (skipped) parts.push(`${skipped} already a member`);
    if (failed) parts.push(`${failed} failed`);
    return parts.join(', ') + '.';
}

// Roster + join-code + Phase-8 Settings management for a single cohort.
function CohortRoster({ cohortId, onBack, initialSection = 'manage', initialReportView = 'roster' }) {
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
            setCohort(data.cohort || null);
            setMembers(data.members || []);
            setStudents(data.students || data.members || []);
            setTeachers(data.teachers || []);
            setCases(data.cases || []);
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load class'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async (e) => {
        e.preventDefault();
        const id = identifier.trim();
        if (!id) return;
        setAdding(true);
        try {
            await addCohortMember(cohortId, id);
            setIdentifier('');
            toast.success('Member added');
            await load();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to add member'));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (m) => {
        const ok = await toast.confirm(
            `Remove ${m.username || m.name} from this class?`,
            { title: 'Remove member', confirmText: 'Remove', type: 'danger' },
        );
        if (!ok) return;
        try {
            await removeCohortMember(cohortId, m.id);
            toast.success('Member removed');
            await load();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to remove member'));
        }
    };

    const handleRotate = async () => {
        setBusyCode(true);
        try {
            const data = await rotateJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: data.join_code } : c));
            toast.success('Join code generated');
        } catch (err) {
            toast.error(errMsg(err, 'Failed to generate join code'));
        } finally {
            setBusyCode(false);
        }
    };

    const handleDisableCode = async () => {
        setBusyCode(true);
        try {
            await disableJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: null } : c));
            toast.success('Join code disabled');
        } catch (err) {
            toast.error(errMsg(err, 'Failed to disable join code'));
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
            toast.error('Could not copy to clipboard');
        }
    };

    return (
        <div className="max-w-6xl">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-4 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to classes
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : !cohort ? (
                <p className="text-sm text-neutral-500">Class not found.</p>
            ) : (
                <>
                    <h3 className="text-lg font-bold mb-4">{cohort.name}</h3>

                    {/* Manage (Phase-3b) | Reports (Phase-5) | Settings
                        (Phase-9). The Manage body is unchanged; it just no
                        longer renders while another section is active. */}
                    <div className="flex gap-1 mb-6">
                        {[
                            { id: 'manage', label: 'Manage' },
                            { id: 'reports', label: 'Reports' },
                            { id: 'settings', label: 'Settings' },
                        ].map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSection(s.id)}
                                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    section === s.id
                                        ? 'bg-neutral-700 text-white'
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
                            <span className="text-sm font-bold text-neutral-200">Join code</span>
                        </div>
                        {cohort.join_code ? (
                            <div className="flex items-center gap-2">
                                <code className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-purple-300 font-mono text-sm tracking-wider">
                                    {cohort.join_code}
                                </code>
                                <button
                                    onClick={handleCopy}
                                    title="Copy join code"
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
                                    Rotate
                                </button>
                                <button
                                    onClick={handleDisableCode}
                                    disabled={busyCode}
                                    className="px-3 py-2 bg-neutral-700 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                                >
                                    Disable
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
                                Generate join code
                            </button>
                        )}
                        <p className="text-xs text-neutral-500 mt-2">
                            Students enter this under My Profile → Join a class.
                            Anyone with this code can join — rotate or disable it
                            if it leaks.
                        </p>
                    </div>

                    {/* Single-add (unchanged) + bulk-add */}
                    <form onSubmit={handleAdd} className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder="Add member by username or email"
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
                            Add
                        </button>
                    </form>

                    <BulkStudentAdd
                        cohortId={cohortId}
                        excludeIds={members.map((m) => m.id)}
                        onDone={load}
                    />

                    {/* Roster */}
                    <h4 className="text-sm font-bold text-neutral-300 mt-8 mb-2">
                        Students ({students.length})
                    </h4>
                    {students.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                            <span>No members yet.</span>{' '}
                            Add them above by username/email, in bulk, or
                            share the join code.
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
                                        title="Remove member"
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
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [ids, setIds] = useState([]);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (ids.length === 0) {
            toast.error('Select or enter at least one student');
            return;
        }
        setBusy(true);
        try {
            const results = await bulkAddStudents(cohortId, ids);
            const failed = results.filter((r) => !r.ok).length;
            const msg = summarise(results);
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
                Add students in bulk
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
                        Add {ids.length || ''} student{ids.length === 1 ? '' : 's'}
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
            toast.error('Name is required');
            return;
        }
        if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
            toast.error('Start date must be on or before the end date');
            return;
        }
        let passNum;
        if (passingScore !== '') {
            passNum = Number(passingScore);
            if (!Number.isFinite(passNum) || passNum < 0 || passNum > 100) {
                toast.error('Passing score must be between 0 and 100');
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
            toast.success('Class details saved');
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to save'));
        } finally {
            setSaving(false);
        }
    };

    const addCases = async () => {
        if (caseSel.size === 0) return;
        setBusyCase(true);
        try {
            await assignCohortCases(cohort.id, [...caseSel]);
            toast.success(`Assigned ${caseSel.size} case${caseSel.size === 1 ? '' : 's'}`);
            setCaseSel(new Set());
            setAddCaseOpen(false);
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to assign cases'));
        } finally {
            setBusyCase(false);
        }
    };

    const removeCase = async (c) => {
        const ok = await toast.confirm(
            `Unassign "${c.name}" from this class?`,
            { title: 'Unassign case', confirmText: 'Unassign', type: 'danger' },
        );
        if (!ok) return;
        try {
            await unassignCohortCase(cohort.id, c.id);
            toast.success('Case unassigned');
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to unassign case'));
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
            toast.success(`Added ${added} co-teacher${added === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
            setCoteacherIds([]);
            setAddTeacherOpen(false);
            await onChanged();
        } finally {
            setBusyTeacher(false);
        }
    };

    const removeTeacher = async (t) => {
        if (t.id === cohort.owner_user_id) return; // owner is non-removable
        const ok = await toast.confirm(
            `Remove ${t.username || t.name} as a co-teacher?`,
            { title: 'Remove co-teacher', confirmText: 'Remove', type: 'danger' },
        );
        if (!ok) return;
        try {
            await removeCohortTeacher(cohort.id, t.id);
            toast.success('Co-teacher removed');
            await onChanged();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to remove co-teacher'));
        }
    };

    return (
        <div className="space-y-8">
            <form onSubmit={saveDetails} className="space-y-6">
                {/* Identity */}
                <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-4">
                    <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                        <GraduationCap className="w-4 h-4 text-purple-400" />
                        Class identity
                    </h4>
                    <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                            Class name
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
                            Description
                        </label>
                        <textarea
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            rows={3}
                            placeholder="What is this class for?"
                            className={`${INPUT} resize-y`}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Course code
                            </label>
                            <input
                                type="text"
                                value={courseCode}
                                onChange={(e) => setCourseCode(e.target.value)}
                                placeholder="e.g. MED-301"
                                className={INPUT}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Term
                            </label>
                            <input
                                type="text"
                                value={term}
                                onChange={(e) => setTerm(e.target.value)}
                                placeholder="e.g. Spring 2026"
                                className={INPUT}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                                Start date
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
                                End date
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
                        Learning objectives
                    </h4>
                    <textarea
                        value={objectives}
                        onChange={(e) => setObjectives(e.target.value)}
                        rows={4}
                        placeholder="What should students be able to do by the end of this class? One objective per line."
                        className={`${INPUT} resize-y`}
                    />
                </section>

                {/* Classroom policy */}
                <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-4">
                    <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-4 h-4 text-purple-400" />
                        Classroom policy
                    </h4>
                    <div className="max-w-xs">
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5 flex items-center gap-1.5">
                            <Percent className="w-3.5 h-3.5" /> Passing score
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={passingScore}
                            onChange={(e) => setPassingScore(e.target.value)}
                            placeholder="e.g. 70"
                            className={INPUT}
                        />
                        <p className="text-xs text-neutral-500 mt-1">
                            Score (%) a student needs to count a case as passed
                            in reports. Leave blank for no threshold.
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
                            Allow case retakes
                            <span className="block text-xs text-neutral-500">
                                Students may re-attempt an assigned case after a
                                completed run.
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
                            Require debrief
                            <span className="block text-xs text-neutral-500">
                                A case counts as complete only after the student
                                finishes the post-case discussion.
                            </span>
                        </span>
                    </label>
                    <p className="text-xs text-neutral-500 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        Policy is recorded on the class and used by cohort
                        reporting; it does not retroactively change already
                        completed sessions.
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
                    Save class settings
                </button>
            </form>

            {/* Assigned cases */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-neutral-300 flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4" /> Assigned cases ({cases.length})
                    </h4>
                    <button
                        type="button"
                        onClick={() => setAddCaseOpen((v) => !v)}
                        className="text-xs text-purple-300 hover:text-purple-200"
                    >
                        {addCaseOpen ? 'Close' : 'Add cases'}
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
                            Assign {caseSel.size || ''}
                        </button>
                    </div>
                )}
                {cases.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                        No cases assigned — pick from the library with “Add cases”.
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
                                    title="Unassign case"
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
                        <GraduationCap className="w-4 h-4" /> Co-teachers ({teachers.length})
                    </h4>
                    <button
                        type="button"
                        onClick={() => setAddTeacherOpen((v) => !v)}
                        className="text-xs text-purple-300 hover:text-purple-200"
                    >
                        {addTeacherOpen ? 'Close' : 'Add co-teachers'}
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
                            Add co-teachers
                        </button>
                    </div>
                )}
                <div className="space-y-2">
                    {/* Owner is always a teacher of their cohort and is not a
                        cohort_members row — show it, non-removable. */}
                    <div className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-white truncate">Owner</div>
                            <div className="text-xs text-neutral-400">
                                The class owner is always a teacher and can’t be removed here.
                            </div>
                        </div>
                    </div>
                    {teachers.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                            No co-teachers — add colleagues to share this class.
                        </p>
                    ) : (
                        teachers.map((t) => (
                            <div
                                key={t.id}
                                className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-white truncate">
                                        {t.name || t.username}
                                    </div>
                                    <div className="text-xs text-neutral-400 truncate">
                                        {t.username}
                                        {t.role ? ` · ${roleLabel(t.role)}` : ''}
                                    </div>
                                </div>
                                {t.id === cohort.owner_user_id ? (
                                    <span className="text-xs text-neutral-500 px-2">Owner</span>
                                ) : (
                                    <button
                                        onClick={() => removeTeacher(t)}
                                        title="Remove co-teacher"
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
