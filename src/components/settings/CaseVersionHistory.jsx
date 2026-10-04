import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { useToast } from '../../contexts/ToastContext';

/**
 * A case's saved versions, and a way back to one of them.
 *
 * The server has kept a version on every save for a long time
 * (GET /cases/:id/versions, POST /cases/:id/restore/:versionId, admin-only)
 * but nothing in the UI reached it, so "take the case back to how it was" was
 * impossible for an educator (QA 2026-10-04, PRV-27). Restoring asks for an
 * explicit second click — it overwrites the live case for everyone who starts
 * it next — and then hands control back so the caller can reload the list.
 *
 * @param {object} props
 * @param {number|string} props.caseId
 * @param {string} props.caseName
 * @param {() => void} props.onClose
 * @param {() => void} [props.onRestored] called after a successful restore
 */
export default function CaseVersionHistory({ caseId, caseName, onClose, onRestored }) {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [versions, setVersions] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [confirmingId, setConfirmingId] = useState(null);
    const [restoringId, setRestoringId] = useState(null);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const data = await apiFetch(`/cases/${caseId}/versions`);
            setVersions(Array.isArray(data?.versions) ? data.versions : []);
        } catch (err) {
            setLoadError(err instanceof ApiError ? (err.body?.error || err.message) : err.message);
            setVersions([]);
        }
    }, [caseId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const restore = async (version) => {
        setRestoringId(version.id);
        try {
            await apiFetch(`/cases/${caseId}/restore/${version.id}`, { method: 'POST' });
            toast.success(t('version_restored', { number: version.version_number }));
            setConfirmingId(null);
            if (onRestored) onRestored();
            await load();
        } catch (err) {
            toast.error(err instanceof ApiError ? (err.body?.error || t('version_restore_failed')) : t('version_restore_failed'));
        } finally {
            setRestoringId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-version-history-title"
                className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl bg-white text-gray-900 shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                    <h2 id="case-version-history-title" className="flex items-center gap-2 text-lg font-bold">
                        <History className="h-5 w-5" aria-hidden="true" />
                        {t('version_history_title', { name: caseName })}
                    </h2>
                    <button type="button" onClick={onClose} aria-label={t('version_history_close')} className="rounded p-1 hover:bg-gray-100">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-4">
                    {versions === null && (
                        <p className="flex items-center gap-2 text-sm text-gray-600">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('version_history_loading')}
                        </p>
                    )}
                    {loadError && <p role="alert" className="text-sm text-red-700">{t('version_history_load_failed', { error: loadError })}</p>}
                    {versions && versions.length === 0 && !loadError && (
                        <p className="text-sm text-gray-600">{t('version_history_empty')}</p>
                    )}
                    {versions && versions.length > 0 && (
                        <ol className="space-y-2">
                            {versions.map((v, index) => (
                                <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold">
                                            {t('version_label', { number: v.version_number })}
                                            {index === 0 && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{t('version_latest')}</span>}
                                        </div>
                                        <div className="truncate text-xs text-gray-600">
                                            {[v.change_timestamp, v.changed_by_username, v.changes_description || v.change_type].filter(Boolean).join(' · ')}
                                        </div>
                                    </div>
                                    {confirmingId === v.id ? (
                                        <div className="flex shrink-0 items-center gap-2">
                                            <span className="text-xs text-gray-700">{t('version_restore_confirm')}</span>
                                            <button type="button" onClick={() => setConfirmingId(null)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                                                {t('version_restore_cancel')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => restore(v)}
                                                disabled={restoringId === v.id}
                                                className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                                            >
                                                {restoringId === v.id ? t('version_restoring') : t('version_restore_yes')}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingId(v.id)}
                                            className="flex shrink-0 items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('version_restore')}
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>
        </div>
    );
}
