// Admin editor for the terms of use (Settings → Platform → Users).
//
// The agreement a person must accept once, per version, before using Rohy
// (TermsGate). Off until an administrator turns "Require acceptance" on. The
// version is the contract: change it whenever the meaning changes, and everyone
// is asked to accept again; a changed text under an unchanged version reads as
// already accepted by everyone who signed the old one.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, FileText, Languages, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch, ApiError } from '../../services/apiClient';
import TermsDocument from '../terms/TermsDocument';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../../i18n/languages';

const TRANSLATION_LANGUAGES = Object.keys(LANGUAGES).filter((code) => code !== DEFAULT_LANGUAGE);

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

            <TermsTranslations data={data} onSaved={(payload) => apply({ ...payload, defaults })} />
        </div>
    );
}

/**
 * Per-language translations of the agreement. A translation records which
 * master version it renders; the server shows it only while that equals the
 * current version, so publishing a new master version sends every reader back
 * to the master until the translation is updated.
 */
function TermsTranslations({ data, onSaved }) {
    const { t } = useTranslation('authoring_config');
    const [lang, setLang] = useState(TRANSLATION_LANGUAGES[0]);
    const stored = data.draft.translations?.[lang] || null;
    const status = data.translation_status?.[lang] || { source: 'master', version: null };
    const statusText = {
        stored: t('terms_tr_status_stored', { version: status.version }),
        stale: t('terms_tr_status_stale', { version: status.version, current: data.terms.version }),
        shipped: t('terms_tr_status_shipped'),
        master: t('terms_tr_status_master'),
    }[status.source];
    return (
        <section className="space-y-3 border-t border-neutral-700 pt-5" aria-labelledby="terms-translations-heading">
            <h5 id="terms-translations-heading" className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
                <Languages className="w-4 h-4" aria-hidden="true" />{t('terms_translations_title')}
            </h5>
            <p className="text-xs text-neutral-500">{t('terms_translations_help')}</p>
            <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm">
                    <span className="sr-only">{t('terms_tr_language')}</span>
                    <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('terms_tr_language')}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-neutral-100">
                        {TRANSLATION_LANGUAGES.map((code) => (
                            <option key={code} value={code}>{LANGUAGES[code].native}</option>
                        ))}
                    </select>
                </label>
                <span className={`text-xs ${status.source === 'stale' ? 'text-amber-400' : 'text-neutral-400'}`} data-testid="terms-translation-status">
                    {statusText}
                </span>
            </div>
            {/* Keyed so a language switch or a save starts the form afresh. */}
            <TranslationForm
                key={`${lang}:${stored?.version ?? ''}:${stored?.title ?? ''}:${data.terms.version}`}
                lang={lang}
                stored={stored}
                shipped={data.defaults?.translations?.[lang] || null}
                currentVersion={data.terms.version}
                onSaved={onSaved}
            />
        </section>
    );
}

function TranslationForm({ lang, stored, shipped, currentVersion, onSaved }) {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [form, setForm] = useState(() => ({
        title: stored?.title || '',
        body: stored?.body || '',
        version: stored?.version || currentVersion,
    }));
    const [saving, setSaving] = useState(false);

    const put = async (patch, successKey) => {
        setSaving(true);
        try {
            const payload = await apiFetch('/platform-settings/terms', { method: 'PUT', json: { translations: { [lang]: patch } } });
            onSaved(payload);
            toast.success(t(successKey));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('terms_save_failed'));
        } finally {
            setSaving(false);
        }
    };
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    return (
        <>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <label className="block text-sm">
                    <span className="text-neutral-300">{t('terms_title_label')}</span>
                    <input value={form.title} onChange={set('title')} placeholder={shipped?.title || ''}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100" />
                </label>
                <label className="block text-sm">
                    <span className="text-neutral-300">{t('terms_version_label')}</span>
                    <input value={form.version} onChange={set('version')}
                        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100" />
                </label>
            </div>
            <label className="block text-sm">
                <span className="text-neutral-300">{t('terms_body_label')}</span>
                <textarea value={form.body} onChange={set('body')} rows={10} placeholder={shipped?.body || ''}
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
                {shipped && (
                    <button type="button" onClick={() => setForm({ title: shipped.title, body: shipped.body, version: currentVersion })}
                        className="inline-flex items-center gap-1 rounded px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-700">
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />{t('terms_tr_copy_shipped')}
                    </button>
                )}
                {stored && (
                    <button type="button" onClick={() => put(null, 'terms_tr_removed')} disabled={saving}
                        className="inline-flex items-center gap-1 rounded px-3 py-2 text-xs text-red-300 hover:bg-neutral-700 disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />{t('terms_tr_remove')}
                    </button>
                )}
                <button type="button" onClick={() => put(form, 'terms_tr_saved')} disabled={saving || !form.title.trim() || !form.body.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
                    <Save className="w-4 h-4" aria-hidden="true" />{t('terms_tr_save')}
                </button>
            </div>
        </>
    );
}
