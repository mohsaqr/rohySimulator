import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, GraduationCap, Plus, Layers } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import * as userService from '../../../services/userService';
import { roleLabel } from '../../../constants/roleLabels';
import { initials, avatarClass, roleBadgeClass, statusBadgeClass } from './usersUi';

const ROLE_RANK = { student: 1, reviewer: 2, educator: 3, admin: 4 };
const ROLE_OPTIONS = [
    { value: 'student', label: 'Student' },
    { value: 'reviewer', label: 'Reviewer' },
    { value: 'educator', label: 'Teacher' },
    { value: 'admin', label: 'Admin' },
];
const STATUSES = ['active', 'inactive', 'suspended'];

const emptyForm = {
    username: '', name: '', email: '', password: '', role: 'student', status: 'active',
    department: '', institution: '', phone: '', education: '', grade: '',
};

export default function UserFormModal({ user, cohorts = [], myRank, onClose, onSaved }) {
    const isEdit = !!user;
    const { t } = useTranslation('teacher_users');
    const roleOptLabel = (v) => t('opt_role_' + (v === 'educator' ? 'teacher' : v));
    const statusLabel = (s) => t('opt_status_' + s);
    const toast = useToast();
    const [form, setForm] = useState(() => (isEdit ? { ...emptyForm, ...pickFields(user) } : emptyForm));
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(isEdit);
    const [saving, setSaving] = useState(false);
    const [enrollId, setEnrollId] = useState('');
    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

    const refetchDetail = useCallback(() => {
        if (!isEdit) return Promise.resolve();
        return userService.getUserDetail(user.id).then(d => {
            setDetail(d);
            setForm(f => ({ ...f, ...pickFields(d.user) }));
        }).catch(() => {});
    }, [isEdit, user]);

    useEffect(() => { refetchDetail().finally(() => setLoading(false)); }, [refetchDetail]);

    const roleOptions = ROLE_OPTIONS.filter(o => ROLE_RANK[o.value] <= myRank);
    const memberIds = new Set((detail?.memberships || []).map(m => String(m.cohort_id)));
    const availableCohorts = cohorts.filter(c => !memberIds.has(String(c.id)));

    const guard = async (fn, ok) => {
        try { await fn(); if (ok) toast.success(ok); await refetchDetail(); onSaved?.({ soft: true }); }
        catch (err) { toast.error(err instanceof ApiError ? err.message : t('err_update')); }
    };
    const enroll = () => enrollId && guard(async () => {
        await userService.enrollUsersBulk(Number(enrollId), [detail.user.username]);
        setEnrollId('');
    }, t('toast_enrolled'));
    const unenroll = (cohortId) => guard(() => userService.removeMembership(cohortId, user.id), t('toast_removed'));

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                username: form.username, name: form.name, email: form.email, role: form.role,
                status: form.status, department: form.department, institution: form.institution,
                phone: form.phone, education: form.education, grade: form.grade,
            };
            if (form.password) payload.password = form.password;
            if (isEdit) { await userService.updateUser(user.id, payload); toast.success(t('toast_user_updated')); }
            else { await userService.createUser({ ...payload }); toast.success(t('toast_user_created')); }
            onSaved();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_save'));
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
            <div className="rohy-card rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                {/* Identity header */}
                <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-neutral-200">
                    {isEdit ? (
                        <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarClass(form.username)}`}>
                                {initials(form.name, form.username)}
                            </span>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold truncate">{form.name || form.username}</span>
                                    <span className={roleBadgeClass(form.role)}>{roleLabel(form.role)}</span>
                                    <span className={statusBadgeClass(form.status)}>{form.status}</span>
                                </div>
                                <div className="text-xs text-neutral-500 truncate">@{form.username}{detail ? ` · ${detail.session_count} sessions` : ''}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2.5">
                            <span className="w-10 h-10 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0"><UserPlus className="w-5 h-5" /></span>
                            <div>
                                <div className="font-bold">{t('form_create_title')}</div>
                                <div className="text-xs text-neutral-500">{t('form_create_subtitle')}</div>
                            </div>
                        </div>
                    )}
                    <button className="rohy-subtle-button p-1.5 rounded shrink-0" onClick={onClose} aria-label={t('btn_close')}><X className="w-4 h-4" /></button>
                </div>

                <form onSubmit={submit} className="overflow-y-auto flex-1">
                    {loading ? (
                        <div className="px-6 py-10 text-sm text-neutral-500">{t('loading')}</div>
                    ) : (
                        <div className="px-6 py-5 space-y-6">
                            {/* Account */}
                            <Section title={t('section_account')}>
                                <Grid>
                                    <Field label={t('label_username')} required><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.username} onChange={set('username')} required /></Field>
                                    <Field label={t('label_email')} required><input type="email" className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.email} onChange={set('email')} required /></Field>
                                </Grid>
                                <Field label={isEdit ? t('label_new_password') : t('label_password')} required={!isEdit}>
                                    <input type="password" className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.password} onChange={set('password')} required={!isEdit} autoComplete="new-password" />
                                </Field>
                            </Section>

                            {/* Access */}
                            <Section title={t('section_access')}>
                                <Grid>
                                    <Field label={t('label_role')}>
                                        <select className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.role} onChange={set('role')}>
                                            {roleOptions.map(o => <option key={o.value} value={o.value}>{roleOptLabel(o.value)}</option>)}
                                            {!roleOptions.some(o => o.value === form.role) && <option value={form.role}>{roleLabel(form.role)}</option>}
                                        </select>
                                    </Field>
                                    <Field label={t('label_status')}>
                                        <div className="flex gap-1">
                                            {STATUSES.map(s => (
                                                <button type="button" key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                                                    className={`text-xs px-2.5 py-1.5 rounded border flex-1 ${form.status === s ? statusBadgeClass(s) : 'rohy-subtle-button'}`}>
                                                    {statusLabel(s)}
                                                </button>
                                            ))}
                                        </div>
                                    </Field>
                                </Grid>
                            </Section>

                            {/* Profile */}
                            <Section title={t('section_profile')}>
                                <Field label={t('label_full_name')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.name} onChange={set('name')} /></Field>
                                <Grid>
                                    <Field label={t('label_department')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.department} onChange={set('department')} /></Field>
                                    <Field label={t('label_institution')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.institution} onChange={set('institution')} /></Field>
                                    <Field label={t('label_phone')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.phone} onChange={set('phone')} /></Field>
                                    <Field label={t('label_grade')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.grade} onChange={set('grade')} /></Field>
                                </Grid>
                                <Field label={t('label_education')}><input className="rohy-field w-full px-3 py-2 rounded-lg text-sm" value={form.education} onChange={set('education')} /></Field>
                            </Section>

                            {/* Classes (edit only — live actions) */}
                            {isEdit && detail && (
                                <Section title={t('section_classes_cases')}>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {(detail.memberships || []).length === 0 && <span className="text-xs text-neutral-400">{t('label_not_enrolled')}</span>}
                                        {(detail.memberships || []).map(m => (
                                            <span key={m.cohort_id} className="rohy-meta-chip">
                                                <GraduationCap className="w-3.5 h-3.5 text-neutral-500" />
                                                {m.name}
                                                <button type="button" className="text-neutral-400 hover:text-red-600 ml-0.5" title={t('btn_remove')} onClick={() => unenroll(m.cohort_id)}>×</button>
                                            </span>
                                        ))}
                                    </div>
                                    {availableCohorts.length > 0 && (
                                        <div className="flex items-center gap-1.5 mb-3">
                                            <select className="rohy-field px-2 py-1.5 rounded text-sm flex-1" value={enrollId} onChange={e => setEnrollId(e.target.value)}>
                                                <option value="">{t('opt_enroll_in_class')}</option>
                                                {availableCohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                            <button type="button" className="rohy-btn rohy-btn-secondary !py-1.5 !px-2.5 !text-xs" onClick={enroll} disabled={!enrollId}><Plus className="w-3.5 h-3.5" /> {t('btn_add')}</button>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-xs text-neutral-500 inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {t('label_cases')}</span>
                                        {(detail.inherited_cases || []).length === 0 && <span className="text-xs text-neutral-400">{t('label_none')}</span>}
                                        {(detail.inherited_cases || []).map(c => <span key={c.id} className="rohy-count-pill">{c.name}</span>)}
                                    </div>
                                </Section>
                            )}
                        </div>
                    )}
                </form>

                <div className="flex justify-end gap-2 px-6 py-4 border-t border-neutral-200">
                    <button type="button" className="rohy-btn rohy-btn-ghost" onClick={onClose}>{t('btn_cancel')}</button>
                    <button type="button" className="rohy-btn rohy-btn-primary" disabled={saving || loading} onClick={submit}>
                        {saving ? t('btn_saving') : isEdit ? t('btn_update_user') : t('btn_create_user')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function pickFields(u) {
    return {
        username: u.username || '', name: u.name || '', email: u.email || '',
        role: u.role || 'student', status: u.status || 'active',
        department: u.department || '', institution: u.institution || '',
        phone: u.phone || '', education: u.education || '', grade: u.grade || '',
    };
}
function Section({ title, children }) {
    return (
        <section>
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2.5">{title}</div>
            <div className="space-y-3">{children}</div>
        </section>
    );
}
function Grid({ children }) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, required, children }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-neutral-700 mb-1">{label}{required && <span className="text-red-600"> *</span>}</span>
            {children}
        </label>
    );
}
