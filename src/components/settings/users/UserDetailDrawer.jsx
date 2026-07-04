import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Layers, Pencil, Trash2, Plus } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import * as userService from '../../../services/userService';
import { roleLabel } from '../../../constants/roleLabels';
import { statusBadgeClass, formatDate, relativeTime } from './usersUi';

const ROLE_RANK = { student: 1, reviewer: 2, educator: 3, admin: 4 };
const ROLE_OPTIONS = [
    { value: 'student', label: 'Student' },
    { value: 'reviewer', label: 'Reviewer' },
    { value: 'educator', label: 'Teacher' },
    { value: 'admin', label: 'Admin' },
];
const STATUSES = ['active', 'inactive', 'suspended'];

export default function UserDetailDrawer({ user, cohorts, canAct, myRank, onChanged, onEdit, onDelete }) {
    const toast = useToast();
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [enrollId, setEnrollId] = useState('');

    const refetch = useCallback(() => {
        return userService.getUserDetail(user.id).then(setDetail).catch(() => {});
    }, [user.id]);

    useEffect(() => {
        setLoading(true);
        refetch().finally(() => setLoading(false));
    }, [refetch]);

    const guard = async (fn, okMsg) => {
        try { await fn(); if (okMsg) toast.success(okMsg); await refetch(); onChanged?.(); }
        catch (err) { toast.error(err instanceof ApiError ? err.message : 'Update failed'); }
    };

    const changeRole = (role) => guard(
        () => userService.updateUser(user.id, { username: detail.user.username, name: detail.user.name, email: detail.user.email, role }),
        'Role updated'
    );
    const changeStatus = (status) => guard(() => userService.setUserStatus(user.id, status), 'Status updated');
    const enroll = () => enrollId && guard(async () => {
        await userService.enrollUsersBulk(Number(enrollId), [detail.user.username]);
        setEnrollId('');
    }, 'Enrolled');
    const unenroll = (cohortId) => guard(() => userService.removeMembership(cohortId, user.id), 'Removed from class');

    if (loading || !detail) {
        return <div className="rohy-detail-panel px-5 py-6 text-sm text-neutral-500">Loading details…</div>;
    }

    const u = detail.user;
    const memberships = detail.memberships || [];
    const inherited = detail.inherited_cases || [];
    const memberIds = new Set(memberships.map(m => String(m.cohort_id)));
    const roleOptions = ROLE_OPTIONS.filter(o => ROLE_RANK[o.value] <= myRank);
    const availableCohorts = cohorts.filter(c => !memberIds.has(String(c.id)));

    return (
        <div className="rohy-detail-panel px-5 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                {/* Profile */}
                <section className="lg:col-span-1">
                    <SectionTitle>Profile</SectionTitle>
                    <dl className="space-y-1.5 text-sm">
                        <Row k="Name" v={u.name || '—'} />
                        <Row k="Username" v={`@${u.username}`} />
                        <Row k="Email" v={u.email} />
                        <Row k="Department" v={u.department || '—'} />
                        <Row k="Institution" v={u.institution || '—'} />
                        <Row k="Joined" v={formatDate(u.created_at)} />
                        <Row k="Last active" v={relativeTime(u.last_login)} />
                        <Row k="Sessions" v={detail.session_count} />
                    </dl>
                </section>

                {/* Role & status */}
                <section className="lg:col-span-1">
                    <SectionTitle>Role &amp; status</SectionTitle>
                    <div className="space-y-3">
                        <div>
                            <span className="block text-xs text-neutral-600 mb-1">Role</span>
                            <select
                                className="rohy-field w-full px-2 py-1.5 rounded text-sm"
                                value={u.role}
                                disabled={!canAct}
                                onChange={e => changeRole(e.target.value)}
                            >
                                {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                {!roleOptions.some(o => o.value === u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
                            </select>
                        </div>
                        <div>
                            <span className="block text-xs text-neutral-600 mb-1">Status</span>
                            <div className="flex gap-1">
                                {STATUSES.map(s => (
                                    <button
                                        key={s}
                                        disabled={!canAct}
                                        onClick={() => changeStatus(s)}
                                        className={`text-xs px-2 py-1 rounded border capitalize ${(u.status || 'active') === s ? statusBadgeClass(s) : 'rohy-subtle-button'}`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Classes */}
                <section className="lg:col-span-1">
                    <SectionTitle><GraduationCap className="w-3.5 h-3.5" /> Classes</SectionTitle>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {memberships.length === 0 && <span className="text-xs text-neutral-400">Not in any class</span>}
                        {memberships.map(m => (
                            <span key={m.cohort_id} className="rohy-meta-chip">
                                {m.member_role === 'teacher' && <span className="rohy-meta-chip__k">teacher</span>}
                                {m.name}
                                {canAct && (
                                    <button className="text-neutral-400 hover:text-red-600 ml-0.5" title="Remove" onClick={() => unenroll(m.cohort_id)}>×</button>
                                )}
                            </span>
                        ))}
                    </div>
                    {canAct && availableCohorts.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            <select className="rohy-field px-2 py-1 rounded text-xs flex-1" value={enrollId} onChange={e => setEnrollId(e.target.value)}>
                                <option value="">Enroll in class…</option>
                                {availableCohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button className="rohy-btn rohy-btn-secondary !py-1 !px-2 !text-xs" onClick={enroll} disabled={!enrollId}><Plus className="w-3 h-3" /></button>
                        </div>
                    )}
                </section>

                {/* Inherited cases + danger */}
                <section className="lg:col-span-1">
                    <SectionTitle><Layers className="w-3.5 h-3.5" /> Assigned cases</SectionTitle>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                        {inherited.length === 0 && <span className="text-xs text-neutral-400">None (via classes)</span>}
                        {inherited.map(c => <span key={c.id} className="rohy-count-pill">{c.name}</span>)}
                    </div>
                    <div className="flex items-center gap-2 pt-1 border-t border-neutral-200">
                        <button className="rohy-btn rohy-btn-secondary !py-1 !text-xs mt-3" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                        {canAct && (
                            <button className="rohy-btn rohy-btn-danger !py-1 !text-xs mt-3" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

function SectionTitle({ children }) {
    return <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2.5">{children}</div>;
}
function Row({ k, v }) {
    return (
        <div className="flex justify-between gap-2">
            <dt className="text-neutral-500 shrink-0">{k}</dt>
            <dd className="text-right truncate">{v}</dd>
        </div>
    );
}
