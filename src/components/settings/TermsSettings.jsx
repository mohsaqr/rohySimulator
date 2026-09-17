// Admin editor for the terms of use (Settings → Platform → Users).
//
// The agreement a person must accept once, per version, before using Rohy
// (TermsGate). Off until an administrator turns "Require acceptance" on. The
// version is the contract: change it whenever the meaning changes, and everyone
// is asked to accept again; a changed text under an unchanged version reads as
// already accepted by everyone who signed the old one.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, FileText, Pencil, RotateCcw, Save } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch, ApiError } from '../../services/apiClient';
import TermsDocument from '../terms/TermsDocument';

export default function TermsSettings() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [preview, setPreview] = useState(false);
    const [saving, setSaving] = useState(false);

    const apply = useCallback((payload) => {
        setData(payload);
        setForm({
            required: Boolean(payload.draft.required),
            title: payload.draft.title || '',
            body: payload.draft.body || '',
            version: payload.draft.version || payload.terms.version,
        });
    }, []);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/platform-settings/terms')
            .then((payload) => { if (!cancelled) apply(payload); })
            .catch((err) => toast.error(err instanceof ApiError ? err.message : String(err?.message)));
        return () => { cancelled = true; };
    }, [apply, toast]);

    if (!data || !form) {
        return <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6 animate-pulse h-40" />;
    }

    const defaults = data.defaults || {};
    const shownBody = form.body.trim() ? form.body : defaults.body;
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = await apiFetch('/platform-settings/terms', {
                method: 'PUT',
                json: { required: form.required, title: form.title, body: form.body, version: form.version },
            });
            apply({ ...payload, defaults });
            toast.success(t('terms_saved'));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('terms_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6 space-y-5">
            <div>
                <h4 className="text-md font-bold text-teal-400 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    {t('terms_settings_title')}
                </h4>
                <p className="mt-1 text-sm text-neutral-400">{t('terms_settings_help')}</p>
                <p className="mt-2 text-xs text-neutral-500">
                    {t('terms_adoption', { accepted: data.adoption.accepted, eligible: data.adoption.eligible, version: data.terms.version })}
                </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.required} onChange={set('required')} className="mt-1 h-4 w-4" />
                <span>
                    <span className="text-sm font-medium text-neutral-200">{t('terms_required_label')}</span>
                    <span className="block text-xs text-neutral-500">{t('terms_required_hint')}</span>
                </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <label className="block text-sm">
                    <span className="text-neutral-300">{t('terms_title_label')}</span>
                    <input value={form.title} onChange={set('title')} placeholder={defaults.title}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100" />
                </label>
                <label className="block text-sm">
                    <span className="text-neutral-300">{t('terms_version_label')}</span>
                    <input value={form.version} onChange={set('version')}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100" />
                </label>
            </div>
            <p className="-mt-2 text-xs text-neutral-500">{t('terms_version_hint')}</p>

            <div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-neutral-300">{t('terms_body_label')}</span>
                    <div className="flex items-center gap-2">
                        {form.body.trim() ? (
                            <button type="button" onClick={() => setForm((f) => ({ ...f, body: '' }))}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700">
                                <RotateCcw className="w-3.5 h-3.5" />{t('terms_reset_default')}
                            </button>
                        ) : (
                            <button type="button" onClick={() => { setPreview(false); setForm((f) => ({ ...f, body: defaults.body, title: f.title || defaults.title })); }}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700">
                                <Pencil className="w-3.5 h-3.5" />{t('terms_copy_default')}
                            </button>
                        )}
                        <button type="button" onClick={() => setPreview((p) => !p)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700">
                            <Eye className="w-3.5 h-3.5" />{preview ? t('terms_edit') : t('terms_preview')}
                        </button>
                    </div>
                </div>
                {preview ? (
                    <div className="mt-1 max-h-96 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 px-4 py-3">
                        <TermsDocument body={shownBody} />
                    </div>
                ) : (
                    <textarea value={form.body} onChange={set('body')} rows={14} placeholder={defaults.body}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100" />
                )}
                <p className="mt-1 text-xs text-neutral-500">
                    {form.body.trim() ? t('terms_body_hint') : t('terms_using_default')}
                </p>
            </div>

            <div className="flex justify-end">
                <button type="button" onClick={save} disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
                    <Save className="w-4 h-4" />{t('terms_save')}
                </button>
            </div>
        </div>
    );
}
