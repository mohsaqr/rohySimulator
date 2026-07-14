import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen, ClipboardCheck, KeyRound, Lock, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/apiClient';
import { getRegistrationSettings, saveRegistrationSettings } from '../../services/registrationService';

// The four modes, each with the ONE line that says what it actually does to a
// stranger who finds the URL. That consequence text is the reason this is a set
// of radio cards and not a <select>: a dropdown hides exactly the information an
// admin needs to choose correctly.
const MODES = [
    { id: 'open', icon: DoorOpen },
    { id: 'approval', icon: ClipboardCheck },
    { id: 'invite', icon: KeyRound },
    { id: 'closed', icon: Lock },
];

// Modes whose machinery ships in a later phase. Shown but not selectable, so an
// admin can never pick a mode that would quietly behave like a different one.
const NOT_YET_AVAILABLE = new Set(['approval']);

export default function RegistrationPolicySettings() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();

    const [mode, setMode] = useState('open');
    const [domains, setDomains] = useState([]);
    const [message, setMessage] = useState('');
    const [domainDraft, setDomainDraft] = useState('');
    const [saved, setSaved] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const data = await getRegistrationSettings();
            setMode(data.mode || 'open');
            setDomains(data.email_domains || []);
            setMessage(data.message || '');
            setSaved({ mode: data.mode || 'open', domains: data.email_domains || [], message: data.message || '' });
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : String(error.message));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    const dirty = saved && (
        mode !== saved.mode ||
        message !== saved.message ||
        domains.join(',') !== saved.domains.join(',')
    );

    const addDomain = () => {
        const clean = domainDraft.trim().toLowerCase().replace(/^@/, '');
        if (!clean) return;
        if (!domains.includes(clean)) setDomains((prev) => [...prev, clean]);
        setDomainDraft('');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const result = await saveRegistrationSettings({ mode, email_domains: domains, message });
            setSaved({ mode: result.mode, domains: result.email_domains || [], message: result.message || '' });
            setDomains(result.email_domains || []);
            toast.success(t('registration_toast_saved'));
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : String(error.message));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 bg-neutral-700 rounded w-1/3"></div>
                    <div className="h-4 bg-neutral-700 rounded w-2/3"></div>
                    <div className="grid grid-cols-2 gap-3">
                        {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-neutral-700 rounded"></div>)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
            <h4 className="text-md font-bold text-teal-400 mb-4 flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                {t('registration_title')}
            </h4>
            <p className="text-sm text-neutral-400 mb-6">{t('registration_help')}</p>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
                {MODES.map(({ id, icon: Icon }) => {
                    const selected = mode === id;
                    const disabled = NOT_YET_AVAILABLE.has(id);
                    return (
                        <button
                            key={id}
                            type="button"
                            disabled={disabled}
                            aria-pressed={selected}
                            onClick={() => setMode(id)}
                            className={`text-left rounded-lg border p-4 transition-colors ${
                                selected
                                    ? 'border-teal-500 bg-teal-500/10'
                                    : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-600'
                            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                            <span className="flex items-center gap-2 font-semibold text-white">
                                <Icon className="w-4 h-4" />
                                {t(`registration_mode_${id}`)}
                            </span>
                            <span className="mt-1 block text-xs text-neutral-400">
                                {t(`registration_mode_${id}_hint`)}
                            </span>
                            {disabled && (
                                <span className="mt-1.5 block text-[11px] uppercase tracking-wide text-neutral-500">
                                    {t('registration_mode_coming_soon')}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* The bootstrap is the single most confusing thing about this screen:
                an admin who picks "Closed" reasonably fears they have locked out a
                fresh deployment. Say it here, where the fear appears. */}
            <p className="text-xs text-neutral-500 mb-6 border-l-2 border-neutral-700 pl-3">
                {t('registration_bootstrap_note')}
            </p>

            <div className="mb-6">
                <label className="block text-sm font-medium text-neutral-300 mb-2">
                    {t('registration_domains_label')}
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                    {domains.map((d) => (
                        <span key={d} className="inline-flex items-center gap-1 bg-neutral-900 border border-neutral-700 rounded-full px-3 py-1 text-xs text-neutral-200">
                            @{d}
                            <button
                                type="button"
                                aria-label={t('registration_domain_remove', { domain: d })}
                                onClick={() => setDomains((prev) => prev.filter((x) => x !== d))}
                                className="text-neutral-500 hover:text-red-400"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={domainDraft}
                        onChange={(e) => setDomainDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                        placeholder={t('registration_domains_placeholder')}
                        className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
                    />
                    <button type="button" onClick={addDomain} className="rohy-btn rohy-btn-secondary !py-2 !text-sm">
                        {t('registration_domain_add')}
                    </button>
                </div>
                <p className="mt-1.5 text-xs text-neutral-500">{t('registration_domains_hint')}</p>
            </div>

            <div className="mb-6">
                <label className="block text-sm font-medium text-neutral-300 mb-2">
                    {t('registration_message_label')}
                </label>
                <textarea
                    rows={2}
                    maxLength={500}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('registration_message_placeholder')}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
                />
                <p className="mt-1.5 text-xs text-neutral-500">{t('registration_message_hint')}</p>
            </div>

            {/* Explicit save, NOT live-save. Mode and domains are one coupled
                decision (you set the domains AND switch mode), and a live-saving
                radio would close the whole platform on a mis-click. */}
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="rohy-btn rohy-btn-primary !text-sm disabled:opacity-50"
                >
                    {saving ? t('registration_saving') : t('registration_save')}
                </button>
                {dirty && <span className="text-xs text-amber-400">{t('registration_unsaved')}</span>}
            </div>
        </div>
    );
}
