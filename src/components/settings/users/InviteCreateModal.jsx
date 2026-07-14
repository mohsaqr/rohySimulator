import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Link2, Copy, Check, KeyRound } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import { createInvite, inviteLink, formatInviteCode } from '../../../services/registrationService';

const ROLE_RANK = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };

// Expiry offered as intervals, not a date picker: "30 days" is how an admin
// actually thinks about a cohort invite, and a date picker invites off-by-one.
const EXPIRY_CHOICES = [
    { id: '7', days: 7 },
    { id: '30', days: 30 },
    { id: '90', days: 90 },
    { id: 'never', days: null },
];

export default function InviteCreateModal({ cohorts, onClose, onCreated }) {
    const { t } = useTranslation('teacher_users');
    const toast = useToast();
    const { user: me } = useAuth();
    const myRank = ROLE_RANK[me?.role] ?? 0;

    const [role, setRole] = useState('student');
    const [cohortId, setCohortId] = useState('');
    const [maxUses, setMaxUses] = useState('1');
    const [expiry, setExpiry] = useState('30');
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState(null);
    const [copied, setCopied] = useState(null);

    // You can never mint an invite that outranks you — the server enforces this
    // too, but offering the option and then refusing it is a bad way to say no.
    const roles = ['student', 'reviewer', 'educator', 'admin'].filter((r) => ROLE_RANK[r] <= myRank);

    const copy = async (kind, text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(kind);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            toast.error(t('invite_copy_failed'));
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const choice = EXPIRY_CHOICES.find((c) => c.id === expiry);
            const expiresAt = choice?.days
                ? new Date(Date.now() + choice.days * 86400_000).toISOString()
                : null;

            const { invite } = await createInvite({
                role,
                cohort_id: cohortId || null,
                max_uses: maxUses === '' ? null : Number(maxUses),
                expires_at: expiresAt,
            });
            setCreated(invite);
            onCreated?.();
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : String(error.message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
                    <h3 className="font-bold flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-teal-700" />
                        {created ? t('invite_created_title') : t('invite_new')}
                    </h3>
                    <button className="rohy-subtle-button p-1.5 rounded" onClick={onClose} aria-label={t('invite_close')}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Do NOT just close on success. Copy-paste IS the delivery
                    mechanism — there is no email — so the one thing the admin
                    came here to get must be put in front of them, ready to copy.
                    Closing the modal and making them hunt for the row in a table
                    is the surest way to make this feature feel broken. */}
                {created ? (
                    <div className="p-5 space-y-4">
                        <p className="text-sm text-neutral-600">{t('invite_created_help')}</p>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <code className="font-mono tracking-wider text-sm">{formatInviteCode(created.token)}</code>
                                <button
                                    className="rohy-btn rohy-btn-secondary !py-1 !text-xs"
                                    onClick={() => copy('code', created.token)}
                                >
                                    {copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    {t('invite_copy_code')}
                                </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs text-neutral-500">{inviteLink(created.token)}</span>
                                <button
                                    className="rohy-btn rohy-btn-primary !py-1 !text-xs shrink-0"
                                    onClick={() => copy('link', inviteLink(created.token))}
                                >
                                    {copied === 'link' ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                                    {t('invite_copy_link')}
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button className="rohy-btn rohy-btn-secondary" onClick={onClose}>{t('invite_done')}</button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={submit} className="p-5 space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-neutral-600 mb-1">{t('invite_field_role')}</label>
                            <select className="rohy-field w-full px-3 py-2 rounded" value={role} onChange={(e) => setRole(e.target.value)}>
                                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-neutral-600 mb-1">{t('invite_field_course')}</label>
                            <select className="rohy-field w-full px-3 py-2 rounded" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                                <option value="">{t('invite_field_course_none')}</option>
                                {(cohorts || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <p className="mt-1 text-xs text-neutral-500">{t('invite_field_course_hint')}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 mb-1">{t('invite_field_max_uses')}</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="rohy-field w-full px-3 py-2 rounded"
                                    value={maxUses}
                                    onChange={(e) => setMaxUses(e.target.value)}
                                    placeholder={t('invite_field_max_uses_unlimited')}
                                />
                                <p className="mt-1 text-xs text-neutral-500">{t('invite_field_max_uses_hint')}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 mb-1">{t('invite_field_expires')}</label>
                                <select className="rohy-field w-full px-3 py-2 rounded" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                                    {EXPIRY_CHOICES.map((c) => (
                                        <option key={c.id} value={c.id}>{t(`invite_expiry_${c.id}`)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button type="button" className="rohy-btn rohy-btn-secondary" onClick={onClose}>{t('invite_cancel')}</button>
                            <button type="submit" className="rohy-btn rohy-btn-primary" disabled={saving}>
                                {saving ? t('invite_creating') : t('invite_create')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
