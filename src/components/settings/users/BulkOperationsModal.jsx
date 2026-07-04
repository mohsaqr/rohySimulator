import { useState, useMemo, useCallback } from 'react';
import {
    X, Search, Download, CheckCircle2, AlertTriangle, Play, RefreshCw,
    UserPlus, UserMinus, ShieldCheck, Ban, RotateCcw, Layers, Users as UsersIcon,
    GraduationCap, Info,
} from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import { roleLabel } from '../../../constants/roleLabels';
import * as userService from '../../../services/userService';
import { initials, avatarClass, roleBadgeClass } from './usersUi';

const ROLE_RANK = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };
const rank = (r) => ROLE_RANK[r] ?? 0;

// The five operations, split by which API they drive: `enroll` kind → bulkEnroll
// against a set of classes; `user` kind → bulkUserAction (rank-gated server-side).
const ACTIONS = [
    { key: 'enroll', label: 'Enroll in classes', icon: UserPlus, kind: 'enroll' },
    { key: 'unenroll', label: 'Remove from classes', icon: UserMinus, kind: 'enroll' },
    { key: 'role', label: 'Change role', icon: ShieldCheck, kind: 'user' },
    { key: 'suspend', label: 'Suspend', icon: Ban, kind: 'user' },
    { key: 'reactivate', label: 'Reactivate', icon: RotateCcw, kind: 'user' },
];

const OUTCOME_BADGE = {
    enrolled: 'rohy-badge-green',
    revived: 'rohy-badge-teal',
    already: 'rohy-badge-neutral',
    unenrolled: 'rohy-badge-green',
    not_member: 'rohy-badge-neutral',
    user_not_found: 'rohy-badge-red',
    cohort_denied: 'rohy-badge-red',
    success: 'rohy-badge-green',
    failed: 'rohy-badge-red',
};
const OUTCOME_LABEL = {
    enrolled: 'enrolled', revived: 'revived', already: 'already in',
    unenrolled: 'removed', not_member: 'not a member', user_not_found: 'not found',
    cohort_denied: 'class denied', success: 'updated', failed: 'failed',
};

export default function BulkOperationsModal({
    users, cohorts, myRank, meId, preselectedIds, onClose, onChanged,
}) {
    const toast = useToast();

    // --- Target set (the "bulk search") ---------------------------------------
    const [query, setQuery] = useState('');
    const [roleF, setRoleF] = useState('all');
    const [statusF, setStatusF] = useState('all');
    const [classF, setClassF] = useState('all');
    const [selected, setSelected] = useState(() => new Set(preselectedIds || []));

    // --- Operation config -----------------------------------------------------
    const [actionKey, setActionKey] = useState('enroll');
    const [cohortSel, setCohortSel] = useState(() => new Set());
    const [roleValue, setRoleValue] = useState('student');

    // --- Execution / report ---------------------------------------------------
    const [running, setRunning] = useState(false);
    const [report, setReport] = useState(null); // { kind, action, summary, rows }

    const action = useMemo(() => ACTIONS.find(a => a.key === actionKey), [actionKey]);
    const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    // A "user" kind action is rank-gated server-side: you cannot touch yourself
    // or anyone at/above your rank. Flag those so the UI can skip + explain.
    const isBlocked = useCallback(
        (u) => u.id === meId || rank(u.role) >= myRank,
        [meId, myRank],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return users.filter(u => {
            if (roleF !== 'all' && u.role !== roleF) return false;
            if (statusF !== 'all' && (u.status || 'active') !== statusF) return false;
            if (classF !== 'all') {
                const memberships = u.memberships || [];
                if (classF === 'none') {
                    if (memberships.length > 0) return false;
                } else {
                    const inClass = memberships.some(m => String(m.cohort_id) === String(classF));
                    if (!inClass) return false;
                }
            }
            if (q) {
                const hay = `${u.username} ${u.name || ''} ${u.email || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [users, query, roleF, statusF, classF]);

    const filteredIds = useMemo(() => filtered.map(u => u.id), [filtered]);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
    const studentIds = useMemo(
        () => users.filter(u => u.role === 'student' || u.role === 'user').map(u => u.id),
        [users],
    );
    const unassignedIds = useMemo(
        () => users.filter(u => (u.role === 'student' || u.role === 'user') && !(u.memberships || []).length).map(u => u.id),
        [users],
    );

    const toggleUser = (id) => setSelected(prev => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
    });
    const toggleSelectAllFiltered = () => setSelected(prev => {
        const n = new Set(prev);
        if (allFilteredSelected) filteredIds.forEach(id => n.delete(id));
        else filteredIds.forEach(id => n.add(id));
        return n;
    });
    const clearSelection = () => setSelected(new Set());
    const replaceSelection = (ids) => setSelected(new Set(ids));

    const toggleCohort = (id) => setCohortSel(prev => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
    });

    // Roles the actor is allowed to grant (<= own rank).
    const roleOptions = useMemo(
        () => ['student', 'reviewer', 'educator', 'admin'].filter(r => rank(r) <= myRank),
        [myRank],
    );

    // Effective targets for the chosen action (user-kind drops blocked users).
    const selectedUsers = useMemo(
        () => [...selected].map(id => usersById.get(id)).filter(Boolean),
        [selected, usersById],
    );
    const effectiveUsers = useMemo(
        () => (action.kind === 'user' ? selectedUsers.filter(u => !isBlocked(u)) : selectedUsers),
        [action.kind, selectedUsers, isBlocked],
    );
    const skippedCount = selectedUsers.length - effectiveUsers.length;
    const cohortCount = cohortSel.size;

    const preview = useMemo(() => {
        const n = effectiveUsers.length;
        if (action.kind === 'enroll') {
            const verb = action.key === 'enroll' ? 'Enroll' : 'Remove';
            const prep = action.key === 'enroll' ? 'into' : 'from';
            return {
                text: `${verb} ${n} ${n === 1 ? 'user' : 'users'} ${prep} ${cohortCount} ${cohortCount === 1 ? 'class' : 'classes'}`,
                ops: n * cohortCount,
            };
        }
        if (action.key === 'role') {
            return { text: `Change role of ${n} ${n === 1 ? 'user' : 'users'} to ${roleLabel(roleValue)}`, ops: n };
        }
        const verb = action.key === 'suspend' ? 'Suspend' : 'Reactivate';
        return { text: `${verb} ${n} ${n === 1 ? 'user' : 'users'}`, ops: n };
    }, [action, effectiveUsers.length, cohortCount, roleValue]);

    const canExecute = !running && effectiveUsers.length > 0 &&
        (action.kind !== 'enroll' || cohortCount > 0);

    const execute = async () => {
        if (!canExecute) return;
        setRunning(true);
        try {
            const userIds = effectiveUsers.map(u => u.id);
            if (action.kind === 'enroll') {
                const { summary, results } = await userService.bulkEnroll({
                    userIds,
                    cohortIds: [...cohortSel],
                    action: action.key,
                });
                setReport({ kind: 'enroll', action: action.key, summary, rows: results });
                const done = action.key === 'enroll'
                    ? (summary.enrolled + summary.revived)
                    : summary.unenrolled;
                toast.success(`${action.key === 'enroll' ? 'Enrolled' : 'Removed'} ${done} membership${done === 1 ? '' : 's'}`);
            } else {
                const { results } = await userService.bulkUserAction(
                    action.key, userIds, action.key === 'role' ? roleValue : undefined,
                );
                const rows = [
                    ...results.success.map(s => ({ user_id: s.id, username: s.username, outcome: 'success', error: '' })),
                    ...results.failed.map(f => ({
                        user_id: f.id,
                        username: usersById.get(f.id)?.username || '—',
                        outcome: 'failed',
                        error: f.error || '',
                    })),
                ];
                setReport({
                    kind: 'user',
                    action: action.key,
                    summary: { success: results.success.length, failed: results.failed.length },
                    rows,
                });
                toast.success(`${results.success.length} updated${results.failed.length ? `, ${results.failed.length} skipped` : ''}`);
            }
            onChanged?.();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Bulk operation failed');
        } finally {
            setRunning(false);
        }
    };

    const runAnother = () => {
        setReport(null);
        // Keep the target set + action so an operator can chain ops on the same cohort.
    };

    const downloadReport = () => {
        if (!report) return;
        const stamp = new Date().toISOString().slice(0, 10);
        if (report.kind === 'enroll') {
            const lines = ['user_id,username,class,outcome'];
            report.rows.forEach(r => lines.push(
                [r.user_id ?? '', r.username ?? '', r.cohort_name ?? '', r.outcome].map(csvCell).join(','),
            ));
            downloadCsv(`bulk_${report.action}_report_${stamp}.csv`, lines.join('\n'));
        } else {
            const lines = ['user_id,username,outcome,error'];
            report.rows.forEach(r => lines.push(
                [r.user_id ?? '', r.username ?? '', r.outcome, r.error ?? ''].map(csvCell).join(','),
            ));
            downloadCsv(`bulk_${report.action}_report_${stamp}.csv`, lines.join('\n'));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
            <div className="rohy-card rounded-xl w-full max-w-5xl h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 shrink-0">
                    <div>
                        <h3 className="font-bold flex items-center gap-2">
                            <Layers className="w-4 h-4 text-teal-700" /> Bulk operations
                        </h3>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            Select users, choose one operation, preview, then run with a downloadable report.
                        </p>
                    </div>
                    <button className="rohy-subtle-button p-1.5 rounded" onClick={onClose} aria-label="Close">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {report ? (
                    <ReportView report={report} onDownload={downloadReport} onRunAnother={runAnother} onClose={onClose} />
                ) : (
                    <>
                        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1.25fr_1fr] divide-y md:divide-y-0 md:divide-x divide-neutral-200 overflow-hidden">
                            {/* ── Left: target users (bulk search) ── */}
                            <div className="flex flex-col min-h-0">
                                <div className="px-5 pt-4 pb-3 space-y-2.5 shrink-0">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-bold flex items-center gap-1.5">
                                            <UsersIcon className="w-4 h-4 text-teal-700" /> Target users
                                        </h4>
                                        <span className="rohy-count-pill">{selected.size} selected</span>
                                    </div>
                                    <div className="relative">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                                        <input
                                            className="rohy-field w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                                            placeholder="Search name, username, or email…"
                                            value={query}
                                            onChange={e => setQuery(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <select className="rohy-field px-2 py-1.5 rounded text-xs flex-1 min-w-[90px]" value={roleF} onChange={e => setRoleF(e.target.value)}>
                                            <option value="all">All roles</option>
                                            <option value="admin">Admin</option>
                                            <option value="educator">Teacher</option>
                                            <option value="reviewer">Reviewer</option>
                                            <option value="student">Student</option>
                                        </select>
                                        <select className="rohy-field px-2 py-1.5 rounded text-xs flex-1 min-w-[90px]" value={statusF} onChange={e => setStatusF(e.target.value)}>
                                            <option value="all">All statuses</option>
                                            <option value="active">Active</option>
                                            <option value="inactive">Inactive</option>
                                            <option value="suspended">Suspended</option>
                                        </select>
                                        <select className="rohy-field px-2 py-1.5 rounded text-xs flex-1 min-w-[90px]" value={classF} onChange={e => setClassF(e.target.value)}>
                                            <option value="all">All classes</option>
                                            <option value="none">Unassigned</option>
                                            {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button type="button" className="rohy-subtle-button px-2 py-1.5 rounded text-xs font-semibold" onClick={() => replaceSelection(filteredIds)} disabled={filteredIds.length === 0}>
                                            Shown ({filteredIds.length})
                                        </button>
                                        <button type="button" className="rohy-subtle-button px-2 py-1.5 rounded text-xs font-semibold" onClick={() => replaceSelection(studentIds)} disabled={studentIds.length === 0}>
                                            Students ({studentIds.length})
                                        </button>
                                        <button type="button" className="rohy-subtle-button px-2 py-1.5 rounded text-xs font-semibold" onClick={() => replaceSelection(unassignedIds)} disabled={unassignedIds.length === 0}>
                                            Unassigned ({unassignedIds.length})
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <label className="inline-flex items-center gap-2 font-semibold text-neutral-700 cursor-pointer">
                                            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} />
                                            Select all {filtered.length} shown
                                        </label>
                                        {selected.size > 0 && (
                                            <button className="rohy-subtle-button px-2 py-0.5 rounded font-semibold" onClick={clearSelection}>
                                                Clear selection
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                                    {filtered.length === 0 && (
                                        <div className="px-3 py-10 text-center text-sm text-neutral-500">No users match your filters.</div>
                                    )}
                                    <ul className="space-y-1">
                                        {filtered.map(u => {
                                            const checked = selected.has(u.id);
                                            const blocked = action.kind === 'user' && isBlocked(u);
                                            return (
                                                <li key={u.id}>
                                                    <label className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-teal-50' : 'hover:bg-neutral-50'}`}>
                                                        <input type="checkbox" checked={checked} onChange={() => toggleUser(u.id)} aria-label={`Select ${u.username}`} />
                                                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${avatarClass(u.username)}`}>
                                                            {initials(u.name, u.username)}
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block text-sm font-semibold truncate">{u.name || u.username}</span>
                                                            <span className="block text-xs text-neutral-500 truncate">@{u.username}</span>
                                                        </span>
                                                        <span className={roleBadgeClass(u.role)}>{roleLabel(u.role)}</span>
                                                        {blocked && checked && (
                                                            <span className="rohy-badge-amber" title="Skipped: self or equal/higher role">skip</span>
                                                        )}
                                                    </label>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </div>

                            {/* ── Right: action + target + preview ── */}
                            <div className="flex flex-col min-h-0 overflow-y-auto">
                                <div className="p-5 space-y-5">
                                    {/* Action picker */}
                                    <div>
                                        <h4 className="text-sm font-bold mb-2">Action</h4>
                                        <div className="grid grid-cols-1 gap-1.5">
                                            {ACTIONS.map(a => {
                                                const Icon = a.icon;
                                                const active = a.key === actionKey;
                                                const danger = a.key === 'suspend';
                                                return (
                                                    <button
                                                        key={a.key}
                                                        type="button"
                                                        onClick={() => setActionKey(a.key)}
                                                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm font-semibold text-left transition-colors ${active
                                                            ? danger ? 'border-red-300 bg-red-50 text-red-800' : 'border-teal-300 bg-teal-50 text-teal-800'
                                                            : 'border-neutral-200 hover:bg-neutral-50 text-neutral-700'}`}
                                                        aria-pressed={active}
                                                    >
                                                        <Icon className="w-4 h-4 shrink-0" />
                                                        {a.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Target picker */}
                                    {action.kind === 'enroll' && (
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-sm font-bold flex items-center gap-1.5">
                                                    <GraduationCap className="w-4 h-4 text-teal-700" /> Classes
                                                </h4>
                                                <span className="text-xs text-neutral-500">{cohortCount} selected</span>
                                            </div>
                                            {cohorts.length === 0 ? (
                                                <div className="rohy-detail-panel rounded-lg p-3 text-xs text-neutral-500">No classes available.</div>
                                            ) : (
                                                <ul className="rohy-detail-panel rounded-lg p-1.5 max-h-56 overflow-y-auto space-y-0.5">
                                                    {cohorts.map(c => {
                                                        const on = cohortSel.has(c.id);
                                                        return (
                                                            <li key={c.id}>
                                                                <label className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${on ? 'bg-teal-50' : 'hover:bg-neutral-50'}`}>
                                                                    <input type="checkbox" checked={on} onChange={() => toggleCohort(c.id)} />
                                                                    <span className="text-sm font-medium truncate">{c.name}</span>
                                                                </label>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </div>
                                    )}

                                    {action.key === 'role' && (
                                        <div>
                                            <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                                                <ShieldCheck className="w-4 h-4 text-teal-700" /> New role
                                            </h4>
                                            <select className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={roleValue} onChange={e => setRoleValue(e.target.value)}>
                                                {roleOptions.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                                            </select>
                                            <p className="text-xs text-neutral-500 mt-1.5">Only roles at or below your own are listed.</p>
                                        </div>
                                    )}

                                    {action.kind === 'user' && skippedCount > 0 && (
                                        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                            <Info className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span>
                                                {skippedCount} selected {skippedCount === 1 ? 'user' : 'users'} can&apos;t be modified by this action
                                                (yourself, or equal/higher role) and will be skipped.
                                            </span>
                                        </div>
                                    )}

                                    {/* Preview */}
                                    <div className="rohy-stat-card rohy-stat-card-accent rounded-lg p-3.5">
                                        <div className="text-xs uppercase tracking-wide font-semibold text-neutral-600 mb-1">Preview</div>
                                        <div className="text-sm font-bold text-teal-900">{preview.text}</div>
                                        {action.kind === 'enroll' && (
                                            <div className="text-xs text-neutral-600 mt-0.5">
                                                = {preview.ops} {preview.ops === 1 ? 'operation' : 'operations'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-200 shrink-0">
                            <button className="rohy-btn rohy-btn-ghost" onClick={onClose}>Cancel</button>
                            <button
                                className={`rohy-btn ${action.key === 'suspend' ? 'rohy-btn-danger' : 'rohy-btn-primary'}`}
                                disabled={!canExecute}
                                onClick={execute}
                            >
                                {running ? <><RefreshCw className="w-4 h-4 animate-spin" /> Running…</> : <><Play className="w-4 h-4" /> Execute</>}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function ReportView({ report, onDownload, onRunAnother, onClose }) {
    const chips = report.kind === 'enroll'
        ? Object.entries(report.summary).filter(([, v]) => v > 0)
        : [['success', report.summary.success], ['failed', report.summary.failed]];

    return (
        <>
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                <div className="flex items-center gap-2 text-teal-700">
                    <CheckCircle2 className="w-6 h-6" />
                    <span className="font-bold text-lg">Operation complete</span>
                </div>

                {/* Summary chips */}
                <div className="flex flex-wrap gap-2">
                    {chips.length === 0 && <span className="text-sm text-neutral-500">No changes were made.</span>}
                    {chips.map(([k, v]) => (
                        <span key={k} className={`${OUTCOME_BADGE[k] || 'rohy-badge-neutral'} !text-sm`}>
                            {v} {OUTCOME_LABEL[k] || k}
                        </span>
                    ))}
                </div>

                {/* Results table */}
                <div className="rohy-table-shell rounded-lg overflow-hidden">
                    <div className="max-h-[46vh] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="rohy-table-head sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left">User</th>
                                    {report.kind === 'enroll'
                                        ? <th className="px-3 py-2 text-left">Class</th>
                                        : <th className="px-3 py-2 text-left">Error</th>}
                                    <th className="px-3 py-2 text-left">Outcome</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.rows.length === 0 && (
                                    <tr><td colSpan={3} className="px-3 py-8 text-center text-neutral-500">No result rows.</td></tr>
                                )}
                                {report.rows.map((r, i) => (
                                    <tr key={i} className="rohy-table-row">
                                        <td className="px-3 py-1.5">
                                            {r.username && r.username !== '—'
                                                ? <span className="font-semibold">@{r.username}</span>
                                                : <span className="text-neutral-400">—</span>}
                                        </td>
                                        {report.kind === 'enroll'
                                            ? <td className="px-3 py-1.5 rohy-table-muted">{r.cohort_name || '—'}</td>
                                            : <td className="px-3 py-1.5 text-red-600">{r.error || '—'}</td>}
                                        <td className="px-3 py-1.5">
                                            <span className={OUTCOME_BADGE[r.outcome] || 'rohy-badge-neutral'}>
                                                {r.outcome === 'failed' && <AlertTriangle className="w-3 h-3 inline" />} {OUTCOME_LABEL[r.outcome] || r.outcome}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-200 shrink-0">
                <button className="rohy-btn rohy-btn-secondary" onClick={onDownload}>
                    <Download className="w-4 h-4" /> Download report (CSV)
                </button>
                <div className="flex items-center gap-2">
                    <button className="rohy-btn rohy-btn-ghost" onClick={onRunAnother}>
                        <RefreshCw className="w-4 h-4" /> Run another
                    </button>
                    <button className="rohy-btn rohy-btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </>
    );
}

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
