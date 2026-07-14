import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Copy, Check, Ban, Plus, KeyRound } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import {
    listInvites,
    revokeInvite,
    inviteLink,
    formatInviteCode,
} from '../../../services/registrationService';
import InviteCreateModal from './InviteCreateModal';
import { relativeTime } from './usersUi';

/**
 * The invite roster.
 *
 * The platform cannot send email, so COPYING IS THE DELIVERY MECHANISM. That is
 * why every row carries both affordances, side by side: a link (to paste into a
 * chat or an LMS page) and a bare code (to read out, or put on a slide). An
 * invite you cannot copy is an invite you cannot give to anyone.
 */
export default function InvitesPanel({ cohorts, policyMode, onGoToPolicy }) {
    const { t } = useTranslation('teacher_users');
    const toast = useToast();

    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [copied, setCopied] = useState(null);   // `${id}:${kind}`

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listInvites();
            setInvites(data.invites || []);
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : String(error.message));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    // navigator.clipboard throws on an insecure origin (a LAN deployment over
    // plain http is a real rohy install), so this must never be assumed to work.
    const copy = async (id, kind, text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(`${id}:${kind}`);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            toast.error(t('invite_copy_failed'));
        }
    };

    const onRevoke = async (invite) => {
        const ok = await toast.confirm(t('invite_revoke_message'), {
            title: t('invite_revoke_title'),
            type: 'danger',
            confirmText: t('invite_revoke_confirm'),
        });
        if (!ok) return;
        try {
            await revokeInvite(invite.id);
            toast.success(t('invite_revoked'));
            load();
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : String(error.message));
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-teal-700" />
                        {t('invites_title')}
                    </h3>
                    <p className="text-sm text-neutral-600 mt-0.5">{t('invites_subtitle')}</p>
                </div>
                <button className="rohy-btn rohy-btn-primary" onClick={() => setCreateOpen(true)}>
                    <Plus className="w-4 h-4" /> {t('invite_new')}
                </button>
            </div>

            {/* Without this, an admin mints invites on an OPEN platform, wonders why
                nobody needs them, and concludes the feature is broken. */}
            {policyMode && policyMode !== 'invite' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {t('invites_mode_note', { mode: t(`invites_mode_name_${policyMode}`) })}{' '}
                    {onGoToPolicy && (
                        <button className="underline font-medium" onClick={onGoToPolicy}>
                            {t('invites_mode_change')}
                        </button>
                    )}
                </div>
            )}

            <div className="rohy-table-shell">
                <table className="w-full text-sm">
                    <thead className="rohy-table-head">
                        <tr>
                            <th className="px-3 py-2 text-left">{t('invite_col_code')}</th>
                            <th className="px-3 py-2 text-left">{t('invite_col_role')}</th>
                            <th className="px-3 py-2 text-left">{t('invite_col_course')}</th>
                            <th className="px-3 py-2 text-left">{t('invite_col_uses')}</th>
                            <th className="px-3 py-2 text-left">{t('invite_col_expires')}</th>
                            <th className="px-3 py-2 text-left">{t('invite_col_status')}</th>
                            <th className="px-3 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">{t('invites_loading')}</td></tr>
                        )}
                        {!loading && invites.length === 0 && (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">{t('invites_empty')}</td></tr>
                        )}
                        {!loading && invites.map((inv) => (
                            <tr key={inv.id} className="rohy-table-row">
                                <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <code className="font-mono tracking-wider text-xs bg-neutral-100 border border-neutral-200 rounded px-2 py-1">
                                            {formatInviteCode(inv.token)}
                                        </code>
                                        <button
                                            className="rohy-subtle-button p-1.5 rounded"
                                            title={t('invite_copy_link')}
                                            aria-label={t('invite_copy_link')}
                                            onClick={() => copy(inv.id, 'link', inviteLink(inv.token))}
                                        >
                                            {copied === `${inv.id}:link`
                                                ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                                                : <Link2 className="w-3.5 h-3.5" />}
                                        </button>
                                        <button
                                            className="rohy-subtle-button p-1.5 rounded"
                                            title={t('invite_copy_code')}
                                            aria-label={t('invite_copy_code')}
                                            onClick={() => copy(inv.id, 'code', inv.token)}
                                        >
                                            {copied === `${inv.id}:code`
                                                ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                                                : <Copy className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5">{inv.role}</td>
                                <td className="px-3 py-2.5 rohy-table-muted">{inv.cohort_name || '—'}</td>
                                <td className="px-3 py-2.5 rohy-table-muted whitespace-nowrap">
                                    {inv.max_uses == null ? `${inv.uses} / ∞` : `${inv.uses} / ${inv.max_uses}`}
                                </td>
                                <td className="px-3 py-2.5 rohy-table-muted whitespace-nowrap">
                                    {inv.expires_at ? relativeTime(inv.expires_at) : t('invite_never_expires')}
                                </td>
                                <td className="px-3 py-2.5">
                                    <span className={inv.status === 'active' ? 'rohy-badge-green' : 'rohy-badge-neutral'}>
                                        {t(`invite_status_${inv.status}`)}
                                    </span>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    {inv.status === 'active' && (
                                        <button
                                            className="rohy-danger-icon-button p-1.5 rounded"
                                            title={t('invite_revoke')}
                                            aria-label={t('invite_revoke')}
                                            onClick={() => onRevoke(inv)}
                                        >
                                            <Ban className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {createOpen && (
                <InviteCreateModal
                    cohorts={cohorts}
                    onClose={() => setCreateOpen(false)}
                    onCreated={load}
                />
            )}
        </div>
    );
}
