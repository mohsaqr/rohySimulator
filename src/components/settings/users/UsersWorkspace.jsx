import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Users, UserPlus, UserMinus, Upload, Search, ShieldCheck, ChevronDown, ChevronRight,
    Pencil, Trash2, X, ArrowUpDown, Layers, Ban, RotateCcw, GraduationCap,
    KeyRound, Copy, Check, UserCheck,
} from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { ApiError } from '../../../services/apiClient';
import { roleLabel } from '../../../constants/roleLabels';
import { listCohorts } from '../../../services/cohortsService';
import * as userService from '../../../services/userService';
import { initials, avatarClass, roleBadgeClass, statusBadgeClass, relativeTime, formatDate } from './usersUi';
import UserFormModal from './UserFormModal';
import UserDetailDrawer from './UserDetailDrawer';
import UserImportWizard from './UserImportWizard';
import BulkOperationsModal from './BulkOperationsModal';

const ROLE_RANK = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };
const rank = (r) => ROLE_RANK[r] ?? 0;

export default function UsersWorkspace() {
    const { t } = useTranslation('teacher_users');
    const toast = useToast();
    const { user: me } = useAuth();
    const myRank = rank(me?.role);

    const [users, setUsers] = useState([]);
    const [cohorts, setCohorts] = useState([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });

    const [selected, setSelected] = useState(() => new Set());
    const [expandedId, setExpandedId] = useState(null);
    const [formUser, setFormUser] = useState(undefined); // undefined=closed, null=create, obj=edit
    const [importOpen, setImportOpen] = useState(false);
    const [bulkOpsOpen, setBulkOpsOpen] = useState(false);
    const [bulkRole, setBulkRole] = useState('student');
    const [barCohort, setBarCohort] = useState('');
    const [assignmentCohort, setAssignmentCohort] = useState('');
    const [copiedCode, setCopiedCode] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [u, c] = await Promise.all([
                userService.listUsers({ includeMemberships: true }),
                listCohorts().catch(() => ({ cohorts: [] })),
            ]);
            setUsers((u.users || []).filter(x => !x.deleted_at));
            setCohorts(c.cohorts || []);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_load_users'));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    const canActOn = useCallback((u) => u.id !== me?.id && rank(u.role) < myRank, [me, myRank]);

    const stats = useMemo(() => {
        const s = { total: users.length, admins: 0, teachers: 0, reviewers: 0, students: 0, active: 0, suspended: 0, never: 0 };
        for (const u of users) {
            if (u.role === 'admin') s.admins++;
            else if (u.role === 'educator') s.teachers++;
            else if (u.role === 'reviewer') s.reviewers++;
            else s.students++;
            if (u.status === 'active') s.active++;
            else if (u.status === 'suspended') s.suspended++;
            if (!u.last_login) s.never++;
        }
        return s;
    }, [users]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let rows = users.filter(u => {
            if (roleFilter !== 'all' && u.role !== roleFilter) return false;
            if (statusFilter !== 'all' && (u.status || 'active') !== statusFilter) return false;
            if (classFilter !== 'all') {
                const memberships = u.memberships || [];
                if (classFilter === 'none') {
                    if (memberships.length > 0) return false;
                } else {
                    const inClass = memberships.some(m => String(m.cohort_id) === String(classFilter));
                    if (!inClass) return false;
                }
            }
            if (q) {
                const hay = `${u.username} ${u.name || ''} ${u.email}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        const { key, dir } = sort;
        const mul = dir === 'asc' ? 1 : -1;
        rows = [...rows].sort((a, b) => {
            let av = a[key], bv = b[key];
            if (key === 'name') { av = a.name || a.username; bv = b.name || b.username; }
            av = av == null ? '' : String(av).toLowerCase();
            bv = bv == null ? '' : String(bv).toLowerCase();
            return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
        });
        return rows;
    }, [users, search, roleFilter, statusFilter, classFilter, sort]);

    const selectableIds = useMemo(() => filtered.filter(canActOn).map(u => u.id), [filtered, canActOn]);
    const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
    const activeAssignmentCohort = useMemo(
        () => cohorts.find(c => String(c.id) === String(assignmentCohort)) || null,
        [cohorts, assignmentCohort],
    );
    const unassignedIds = useMemo(
        () => users.filter(u => canActOn(u) && (u.role === 'student' || u.role === 'user') && !(u.memberships || []).length).map(u => u.id),
        [users, canActOn],
    );
    const assignmentMemberIds = useMemo(
        () => assignmentCohort
            ? users.filter(u => canActOn(u) && (u.memberships || []).some(m => String(m.cohort_id) === String(assignmentCohort))).map(u => u.id)
            : [],
        [users, canActOn, assignmentCohort],
    );
    const selectedForAssignment = useMemo(
        () => [...selected].filter(id => users.some(u => u.id === id && canActOn(u))),
        [selected, users, canActOn],
    );

    const toggleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
    const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
    const clearSelection = () => setSelected(new Set());

    const runBulk = async (action, value) => {
        const ids = [...selected];
        if (ids.length === 0) return;
        try {
            const { results } = await userService.bulkUserAction(action, ids, value);
            const ok = results.success.length, bad = results.failed.length;
            toast.success(bad ? t('toast_bulk_updated_skipped', { count: ok, skipped: bad }) : t('toast_bulk_updated', { count: ok }));
            clearSelection();
            load();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_bulk_action'));
        }
    };

    const runQuickEnroll = async (action) => {
        const ids = [...selected];
        if (ids.length === 0 || !barCohort) return;
        try {
            const { summary } = await userService.bulkEnroll({
                userIds: ids,
                cohortIds: [Number(barCohort)],
                action,
            });
            const cls = cohorts.find(c => String(c.id) === String(barCohort))?.name || t('fallback_class');
            const done = action === 'enroll' ? (summary.enrolled + summary.revived) : summary.unenrolled;
            const noop = action === 'enroll' ? summary.already : summary.not_member;
            toast.success(
                action === 'enroll'
                    ? (noop ? t('toast_enroll_done_noop', { done, cls, noop }) : t('toast_enroll_done', { done, cls }))
                    : (noop ? t('toast_unenroll_done_noop', { done, cls, noop }) : t('toast_unenroll_done', { done, cls })),
            );
            setBarCohort('');
            clearSelection();
            load();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_bulk_enroll'));
        }
    };

    const runAssignmentEnroll = async (action) => {
        if (!assignmentCohort || selectedForAssignment.length === 0) return;
        try {
            const { summary } = await userService.bulkEnroll({
                userIds: selectedForAssignment,
                cohortIds: [Number(assignmentCohort)],
                action,
            });
            const cls = activeAssignmentCohort?.name || t('fallback_course');
            const done = action === 'enroll' ? (summary.enrolled + summary.revived) : summary.unenrolled;
            const noop = action === 'enroll' ? summary.already : summary.not_member;
            toast.success(
                action === 'enroll'
                    ? (noop ? t('toast_assign_done_noop', { done, cls, noop }) : t('toast_assign_done', { done, cls }))
                    : (noop ? t('toast_assign_removed_noop', { done, cls, noop }) : t('toast_assign_removed', { done, cls })),
            );
            clearSelection();
            load();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_assign'));
        }
    };

    const selectIds = (ids) => setSelected(new Set(ids));

    const copyAssignmentCode = async () => {
        if (!activeAssignmentCohort?.join_code) return;
        try {
            await navigator.clipboard.writeText(activeAssignmentCohort.join_code);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 1500);
        } catch {
            toast.error(t('err_copy_code'));
        }
    };

    const onDelete = async (u) => {
        const ok = await toast.confirm(t('confirm_delete_msg', { username: u.username }), { title: t('confirm_delete_title'), type: 'danger', confirmText: t('confirm_delete_btn') });
        if (!ok) return;
        try {
            await userService.deleteUser(u.id);
            toast.success(t('toast_user_deleted'));
            setExpandedId(null);
            load();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_delete'));
        }
    };

    const SortHead = ({ label, k, right }) => (
        <button
            type="button"
            onClick={() => toggleSort(k)}
            className={`rohy-table-muted inline-flex items-center gap-1 hover:text-neutral-900 ${right ? 'justify-end w-full' : ''}`}
        >
            {label}
            <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? 'text-teal-700' : 'opacity-40'}`} />
        </button>
    );

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Users className="w-5 h-5 text-teal-700" />
                        {t('header_title')}
                    </h3>
                    <p className="text-sm text-neutral-600 mt-0.5">
                        {t('header_subtitle', { count: stats.total })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="rohy-btn rohy-btn-secondary" onClick={() => setBulkOpsOpen(true)}>
                        <Layers className="w-4 h-4" /> {t('btn_bulk_ops')}
                    </button>
                    <button className="rohy-btn rohy-btn-secondary" onClick={() => setImportOpen(true)}>
                        <Upload className="w-4 h-4" /> {t('btn_import_csv')}
                    </button>
                    <button className="rohy-btn rohy-btn-primary" onClick={() => setFormUser(null)}>
                        <UserPlus className="w-4 h-4" /> {t('btn_new_user')}
                    </button>
                </div>
            </div>

            {/* KPI stat row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                <Stat label={t('stat_total')} value={stats.total} accent />
                <Stat label={t('stat_admins_teachers')} value={`${stats.admins} / ${stats.teachers}`} />
                <Stat label={t('stat_students')} value={stats.students} />
                <Stat label={t('stat_active')} value={stats.active} />
                <Stat label={t('stat_suspended')} value={stats.suspended} tone={stats.suspended ? 'warn' : undefined} />
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                        className="rohy-field w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                        placeholder={t('search_placeholder')}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <select className="rohy-field px-3 py-2 rounded-lg text-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                    <option value="all">{t('opt_all_roles')}</option>
                    <option value="admin">{t('opt_role_admin')}</option>
                    <option value="educator">{t('opt_role_teacher')}</option>
                    <option value="reviewer">{t('opt_role_reviewer')}</option>
                    <option value="student">{t('opt_role_student')}</option>
                </select>
                <select className="rohy-field px-3 py-2 rounded-lg text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="all">{t('opt_all_statuses')}</option>
                    <option value="active">{t('opt_status_active')}</option>
                    <option value="inactive">{t('opt_status_inactive')}</option>
                    <option value="suspended">{t('opt_status_suspended')}</option>
                </select>
                <select className="rohy-field px-3 py-2 rounded-lg text-sm max-w-[180px]" value={classFilter} onChange={e => setClassFilter(e.target.value)}>
                    <option value="all">{t('opt_all_classes')}</option>
                    <option value="none">{t('opt_unassigned')}</option>
                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            {/* Assignment workspace */}
            <div className="rohy-card rounded-lg px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <GraduationCap className="w-5 h-5 text-teal-700 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-sm font-bold">{t('assign_title')}</div>
                            <div className="text-xs text-neutral-600 truncate">
                                {t('assign_subtitle')}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button className="rohy-btn rohy-btn-secondary" onClick={() => selectIds(unassignedIds)} disabled={unassignedIds.length === 0}>
                            <UserCheck className="w-4 h-4" /> {t('btn_select_unassigned', { count: unassignedIds.length })}
                        </button>
                        <button className="rohy-btn rohy-btn-secondary" onClick={() => selectIds(assignmentMemberIds)} disabled={!assignmentCohort || assignmentMemberIds.length === 0}>
                            <Users className="w-4 h-4" /> {t('btn_select_course_users')}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <select className="rohy-field px-3 py-2 rounded-lg text-sm min-w-[220px]" value={assignmentCohort} onChange={e => setAssignmentCohort(e.target.value)}>
                        <option value="">{t('opt_choose_course')}</option>
                        {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button className="rohy-btn rohy-btn-primary" disabled={!assignmentCohort || selectedForAssignment.length === 0} onClick={() => runAssignmentEnroll('enroll')}>
                        <UserPlus className="w-4 h-4" /> {t('btn_assign', { count: selectedForAssignment.length || '' })}
                    </button>
                    <button className="rohy-btn rohy-btn-secondary" disabled={!assignmentCohort || selectedForAssignment.length === 0} onClick={() => runAssignmentEnroll('unenroll')}>
                        <UserMinus className="w-4 h-4" /> {t('btn_remove')}
                    </button>
                    {activeAssignmentCohort?.join_code && (
                        <button className="rohy-btn rohy-btn-ghost" onClick={copyAssignmentCode}>
                            {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {t('btn_code', { code: activeAssignmentCohort.join_code })}
                        </button>
                    )}
                    {assignmentCohort && !activeAssignmentCohort?.join_code && (
                        <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                            <KeyRound className="w-3.5 h-3.5" /> {t('label_no_reg_code')}
                        </span>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="rohy-table-shell rounded-lg overflow-hidden">
                {selected.size > 0 && (
                    <div className="flex items-center gap-x-5 gap-y-3 px-4 py-3 bg-teal-50 border-b-2 border-teal-300 flex-wrap">
                        {/* Selection count — bold pill so the whole bar reads as an action mode */}
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="inline-flex items-center justify-center min-w-[2.25rem] h-8 px-2 rounded-full bg-teal-600 text-white text-sm font-bold tabular-nums">{selected.size}</span>
                            <span className="text-sm font-semibold text-teal-900">{t('label_selected')}</span>
                        </div>

                        {/* Role */}
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wider font-bold text-teal-700/80">{t('label_role')}</span>
                            <select className="rohy-field px-2.5 py-1.5 rounded-lg text-sm" value={bulkRole} onChange={e => setBulkRole(e.target.value)}>
                                <option value="student">{t('opt_role_student')}</option>
                                <option value="reviewer">{t('opt_role_reviewer')}</option>
                                <option value="educator">{t('opt_role_teacher')}</option>
                                {myRank >= 4 && <option value="admin">{t('opt_role_admin')}</option>}
                            </select>
                            <button className="rohy-btn rohy-btn-secondary" onClick={() => runBulk('role', bulkRole)}>
                                <ShieldCheck className="w-4 h-4" /> {t('btn_set_role')}
                            </button>
                        </div>

                        <span className="w-px h-8 bg-teal-200 shrink-0" aria-hidden="true" />

                        {/* Status */}
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wider font-bold text-teal-700/80">{t('label_status')}</span>
                            <button className="rohy-btn rohy-btn-danger" onClick={() => runBulk('suspend')}>
                                <Ban className="w-4 h-4" /> {t('btn_suspend')}
                            </button>
                            <button className="rohy-btn rohy-btn-secondary" onClick={() => runBulk('reactivate')}>
                                <RotateCcw className="w-4 h-4" /> {t('btn_reactivate')}
                            </button>
                        </div>

                        <span className="w-px h-8 bg-teal-200 shrink-0" aria-hidden="true" />

                        {/* Class enrollment */}
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wider font-bold text-teal-700/80 flex items-center gap-1">
                                <GraduationCap className="w-3.5 h-3.5" /> {t('label_class')}
                            </span>
                            <select className="rohy-field px-2.5 py-1.5 rounded-lg text-sm max-w-[170px]" value={barCohort} onChange={e => setBarCohort(e.target.value)}>
                                <option value="">{t('opt_choose_class')}</option>
                                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button className="rohy-btn rohy-btn-secondary" disabled={!barCohort} onClick={() => runQuickEnroll('enroll')}>
                                <UserPlus className="w-4 h-4" /> {t('btn_add')}
                            </button>
                            <button className="rohy-btn rohy-btn-secondary" disabled={!barCohort} onClick={() => runQuickEnroll('unenroll')}>
                                <UserMinus className="w-4 h-4" /> {t('btn_remove')}
                            </button>
                        </div>

                        {/* Advanced + clear, pushed to the right */}
                        <div className="flex items-center gap-2 ml-auto shrink-0">
                            <button className="rohy-btn rohy-btn-primary" onClick={() => setBulkOpsOpen(true)}>
                                <Layers className="w-4 h-4" /> {t('btn_more_actions')}
                            </button>
                            <button className="rohy-btn rohy-btn-ghost" onClick={clearSelection}>
                                <X className="w-4 h-4" /> {t('btn_clear')}
                            </button>
                        </div>
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="rohy-table-head">
                            <tr>
                                <th className="w-10 px-3 py-2.5 text-left">
                                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label={t('aria_select_all')} />
                                </th>
                                <th className="px-3 py-2.5 text-left"><SortHead label={t('col_user')} k="name" /></th>
                                <th className="px-3 py-2.5 text-left"><SortHead label={t('col_email')} k="email" /></th>
                                <th className="px-3 py-2.5 text-left"><SortHead label={t('col_role')} k="role" /></th>
                                <th className="px-3 py-2.5 text-left">{t('col_status')}</th>
                                <th className="px-3 py-2.5 text-left">{t('col_classes')}</th>
                                <th className="px-3 py-2.5 text-left"><SortHead label={t('col_last_active')} k="last_login" /></th>
                                <th className="px-3 py-2.5 text-left"><SortHead label={t('col_joined')} k="created_at" /></th>
                                <th className="w-20 px-3 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={9} className="px-4 py-10 text-center text-neutral-500">{t('loading_users')}</td></tr>
                            )}
                            {!loading && filtered.length === 0 && (
                                <tr><td colSpan={9} className="px-4 py-10 text-center text-neutral-500">{t('empty_no_match')}</td></tr>
                            )}
                            {!loading && filtered.map(u => {
                                const expanded = expandedId === u.id;
                                const actionable = canActOn(u);
                                return (
                                    <Fragment key={u.id}>
                                        <tr className={`rohy-table-row ${expanded ? 'bg-neutral-50' : ''}`}>
                                            <td className="px-3 py-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(u.id)}
                                                    disabled={!actionable}
                                                    onChange={() => toggleSelect(u.id)}
                                                    aria-label={t('aria_select_user', { username: u.username })}
                                                />
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <button className="flex items-center gap-2.5 text-left min-w-0" onClick={() => setExpandedId(expanded ? null : u.id)}>
                                                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarClass(u.username)}`}>
                                                        {initials(u.name, u.username)}
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block font-semibold truncate">{u.name || u.username}</span>
                                                        <span className="block text-xs text-neutral-500 truncate">@{u.username}</span>
                                                    </span>
                                                </button>
                                            </td>
                                            <td className="px-3 py-2.5 rohy-table-muted truncate max-w-[220px]">{u.email}</td>
                                            <td className="px-3 py-2.5"><span className={roleBadgeClass(u.role)}>{roleLabel(u.role)}</span></td>
                                            <td className="px-3 py-2.5"><span className={statusBadgeClass(u.status || 'active')}>{u.status || 'active'}</span></td>
                                            <td className="px-3 py-2.5">
                                                <ClassCells memberships={u.memberships} />
                                            </td>
                                            <td className="px-3 py-2.5 rohy-table-muted whitespace-nowrap">{relativeTime(u.last_login)}</td>
                                            <td className="px-3 py-2.5 rohy-table-muted whitespace-nowrap">{formatDate(u.created_at)}</td>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button className="rohy-subtle-button p-1.5 rounded" title={t('title_edit')} onClick={() => setFormUser(u)}><Pencil className="w-3.5 h-3.5" /></button>
                                                    {actionable && (
                                                        <button className="rohy-danger-icon-button p-1.5 rounded" title={t('title_delete')} onClick={() => onDelete(u)}><Trash2 className="w-3.5 h-3.5" /></button>
                                                    )}
                                                    <button className="rohy-subtle-button p-1.5 rounded" title={t('title_details')} onClick={() => setExpandedId(expanded ? null : u.id)}>
                                                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expanded && (
                                            <tr>
                                                <td colSpan={9} className="p-0">
                                                    <UserDetailDrawer
                                                        user={u}
                                                        cohorts={cohorts}
                                                        canAct={actionable}
                                                        myRank={myRank}
                                                        onChanged={load}
                                                        onEdit={() => setFormUser(u)}
                                                        onDelete={() => onDelete(u)}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {formUser !== undefined && (
                <UserFormModal
                    user={formUser}
                    cohorts={cohorts}
                    myRank={myRank}
                    onClose={() => setFormUser(undefined)}
                    onSaved={(opts) => { if (!opts?.soft) setFormUser(undefined); load(); }}
                />
            )}
            {importOpen && (
                <UserImportWizard
                    cohorts={cohorts}
                    existingUsers={users}
                    myRank={myRank}
                    onClose={() => setImportOpen(false)}
                    onDone={() => { setImportOpen(false); load(); }}
                />
            )}
            {bulkOpsOpen && (
                <BulkOperationsModal
                    users={users}
                    cohorts={cohorts}
                    myRank={myRank}
                    meId={me?.id}
                    preselectedIds={[...selected]}
                    onClose={() => setBulkOpsOpen(false)}
                    onChanged={() => { clearSelection(); load(); }}
                />
            )}
        </div>
    );
}

function Stat({ label, value, accent, tone }) {
    return (
        <div className={`rohy-stat-card rounded-lg p-3 ${accent ? 'rohy-stat-card-accent' : ''}`}>
            <div className={`text-2xl font-bold ${tone === 'warn' ? 'text-amber-700' : accent ? 'text-teal-800' : ''}`}>{value}</div>
            <div className="text-xs text-neutral-600 mt-0.5 uppercase tracking-wide font-semibold">{label}</div>
        </div>
    );
}

function ClassCells({ memberships }) {
    const list = memberships || [];
    if (list.length === 0) return <span className="text-neutral-400 text-xs">—</span>;
    const shown = list.slice(0, 2);
    return (
        <div className="flex items-center gap-1 flex-wrap">
            {shown.map(m => <span key={m.cohort_id} className="rohy-count-pill">{m.name}</span>)}
            {list.length > 2 && <span className="rohy-count-pill">+{list.length - 2}</span>}
        </div>
    );
}
