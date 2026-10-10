// Case packages — the client half of server/routes/case-packages-routes.js.
//
// A package is one .rohycase file holding a whole case: its agents, labs,
// rubric AND its media (uploaded images, library slides). Off by default; an
// admin turns it on in Platform → General, and only then do the Export/Import
// package buttons appear beside the case list's existing JSON ones, which
// stay exactly as they were.
//
// Packages can be gigabytes, so the browser never holds one: the download is
// a plain navigation the browser streams to disk, and the upload goes in
// server-sized chunks, each its own short request.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Loader2, PackageOpen, PackagePlus, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch, apiPost, apiPut, ApiError } from '../../services/apiClient';
import { apiUrl } from '../../config/api';
import { CASE_PACKAGES_CHANGED } from './useCasePackages.js';

const POLL_MS = 1000;
const CHUNK_RETRIES = 3;

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const errorText = (err) => (err instanceof ApiError ? err.message : String(err?.message || err));

/** Poll a package job until it finishes. Resolves with the final job; stops when `alive()` turns false. */
async function waitForJob(jobId, onUpdate, alive) {
    for (;;) {
        const job = await apiFetch(`/case-packages/jobs/${jobId}`);
        if (!alive()) return job;
        onUpdate(job);
        if (job.state === 'done' || job.state === 'failed') return job;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

function phaseText(t, dialog) {
    if (dialog.phase === 'uploading') return t('package_phase_uploading', { percent: dialog.percent ?? 0 });
    const keys = {
        starting: 'package_phase_queued',
        queued: 'package_phase_queued',
        collecting: 'package_phase_collecting',
        writing: 'package_phase_writing',
        reading: 'package_phase_reading',
        checking: 'package_phase_checking',
        placing: 'package_phase_placing',
        saving: 'package_phase_saving',
    };
    return t(keys[dialog.phase] ?? 'package_phase_queued');
}

function PackageDialog({ title, dialog, onClose, children }) {
    const { t } = useTranslation('authoring_config');
    const busy = dialog.state === 'working';
    const notes = dialog.result?.warnings ?? [];
    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-package-title"
                className="w-full max-w-xl max-h-[80vh] overflow-hidden rounded-xl bg-white text-gray-900 shadow-2xl flex flex-col"
            >
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                    <h2 id="case-package-title" className="flex items-center gap-2 text-lg font-bold">
                        <Archive className="h-5 w-5" aria-hidden="true" />
                        {title}
                    </h2>
                    <button type="button" onClick={onClose} aria-label={t('package_close')} className="rounded p-1 hover:bg-gray-100">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-3 text-sm">
                    {children}
                    {busy && (
                        <p className="flex items-center gap-2 text-gray-700" role="status">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            {phaseText(t, dialog)}
                        </p>
                    )}
                    {dialog.state === 'failed' && (
                        <p className="rounded border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
                            {t('package_failed', { error: dialog.error })}
                        </p>
                    )}
                    {dialog.state === 'done' && dialog.summary && (
                        <p className="rounded border border-green-200 bg-green-50 p-3 text-green-900" role="status">{dialog.summary}</p>
                    )}
                    {dialog.state === 'done' && notes.length > 0 && (
                        <div>
                            <h3 className="font-semibold">{t('package_notes_title', { count: notes.length })}</h3>
                            <ul className="mt-2 space-y-1.5 text-gray-700">
                                {notes.map((note, index) => (
                                    <li key={index} className="border-l-2 border-amber-400 pl-2">
                                        {note.received ? <code className="break-all text-xs">{String(note.received)}</code> : null}
                                        {note.received ? ' — ' : ''}
                                        {note.hint || note.field}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                <div className="flex justify-end border-t border-gray-200 px-5 py-3">
                    <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50">
                        {busy ? t('package_cancel') : t('package_close')}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Per-case "Export package" button. */
export function CasePackageExportButton({ caseItem }) {
    const { t } = useTranslation('authoring_config');
    const [dialog, setDialog] = useState(null);
    const alive = useRef(false);

    const close = useCallback(() => { alive.current = false; setDialog(null); }, []);
    useEffect(() => () => { alive.current = false; }, []);

    const download = (jobId) => {
        const anchor = document.createElement('a');
        anchor.href = apiUrl(`/case-packages/jobs/${jobId}/download`);
        anchor.download = '';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    };

    const start = async () => {
        alive.current = true;
        setDialog({ state: 'working', phase: 'starting' });
        try {
            const job = await apiPost(`/cases/${caseItem.id}/package`, {});
            const done = await waitForJob(job.id, (j) => setDialog({ state: 'working', phase: j.phase ?? j.state }), () => alive.current);
            if (!alive.current) return;
            if (done.state === 'failed') {
                setDialog({ state: 'failed', error: done.error?.error });
                return;
            }
            download(done.id);
            setDialog({
                state: 'done',
                jobId: done.id,
                result: done.result,
                summary: `${t('package_export_done', { size: formatBytes(done.result.bytes) })} ${t('package_export_counts', done.result.counts)}`,
            });
        } catch (err) {
            if (alive.current) setDialog({ state: 'failed', error: errorText(err) });
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={start}
                className="p-2 bg-indigo-700 hover:bg-indigo-600 rounded text-xs text-white"
                title={t('package_export_button_title')}
                aria-label={t('package_export_button_title')}
            >
                <PackageOpen className="w-4 h-4" aria-hidden="true" />
            </button>
            {dialog && (
                <PackageDialog title={t('package_export_title', { name: caseItem.name })} dialog={dialog} onClose={close}>
                    {dialog.state === 'done' && (
                        <button type="button" onClick={() => download(dialog.jobId)} className="text-indigo-700 underline">
                            {t('package_download_again')}
                        </button>
                    )}
                </PackageDialog>
            )}
        </>
    );
}

/** "Import package" button for the case list header. */
export function CasePackageImportButton({ onImported }) {
    const { t } = useTranslation('authoring_config');
    const [dialog, setDialog] = useState(null);
    const alive = useRef(false);
    const uploadId = useRef(null);

    const close = useCallback(() => {
        alive.current = false;
        if (uploadId.current) {
            apiFetch(`/case-packages/uploads/${uploadId.current}`, { method: 'DELETE' }).catch(() => {});
            uploadId.current = null;
        }
        setDialog(null);
    }, []);
    useEffect(() => () => { alive.current = false; }, []);

    const putChunk = async (id, index, blob) => {
        for (let attempt = 1; ; attempt++) {
            try {
                return await apiFetch(`/case-packages/uploads/${id}/chunks/${index}`, {
                    method: 'PUT',
                    body: blob,
                    headers: { 'Content-Type': 'application/octet-stream' },
                });
            } catch (err) {
                const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
                if (!retryable || attempt >= CHUNK_RETRIES) throw err;
            }
        }
    };

    const upload = async (file) => {
        alive.current = true;
        setDialog({ state: 'working', phase: 'uploading', percent: 0 });
        try {
            const created = await apiPost('/case-packages/uploads', { bytes: file.size });
            uploadId.current = created.id;
            const chunk = created.chunk_bytes;
            for (let offset = 0, index = 0; offset < file.size; offset += chunk, index++) {
                if (!alive.current) return;
                await putChunk(created.id, index, file.slice(offset, offset + chunk));
                setDialog({ state: 'working', phase: 'uploading', percent: Math.round((Math.min(offset + chunk, file.size) / file.size) * 100) });
            }
            const job = await apiPost(`/case-packages/uploads/${created.id}/complete`, {});
            uploadId.current = null;
            const done = await waitForJob(job.id, (j) => setDialog({ state: 'working', phase: j.phase ?? j.state }), () => alive.current);
            if (!alive.current) return;
            if (done.state === 'failed') {
                setDialog({ state: 'failed', error: done.error?.error });
                return;
            }
            const { case: imported, imported: counts } = done.result;
            setDialog({
                state: 'done',
                result: done.result,
                summary: `${t('package_import_done', { name: imported.name, code: imported.case_code })} ${t('package_import_counts', counts)}`,
            });
            onImported?.();
        } catch (err) {
            if (alive.current) setDialog({ state: 'failed', error: errorText(err) });
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setDialog({ state: 'idle' })}
                className="rohy-btn rohy-btn-secondary"
                title={t('package_import_title')}
            >
                <PackagePlus className="w-4 h-4" aria-hidden="true" /> {t('package_import_button')}
            </button>
            {dialog && (
                <PackageDialog title={t('package_import_title')} dialog={dialog} onClose={close}>
                    <p className="text-gray-700">{t('package_import_help')}</p>
                    {dialog.state === 'idle' && (
                        <label className="block">
                            <span className="sr-only">{t('package_import_choose')}</span>
                            <input
                                type="file"
                                accept=".rohycase"
                                aria-label={t('package_import_choose')}
                                onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }}
                                className="block w-full text-sm"
                            />
                        </label>
                    )}
                </PackageDialog>
            )}
        </>
    );
}

/** Platform → General: the on/off switch. */
export default function CasePackageSettings() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [settings, setSettings] = useState(null);
    const [loadError, setLoadError] = useState(null);

    // Load once. Not keyed on `toast`: the toast context is rebuilt whenever a
    // notification changes, so a failed load that toasted would re-run this
    // effect, fail again, toast again — a request loop with nobody clicking.
    useEffect(() => {
        let cancelled = false;
        apiFetch('/platform-settings/case-packages')
            .then((data) => { if (!cancelled) setSettings(data); })
            .catch((err) => { if (!cancelled) setLoadError(errorText(err)); });
        return () => { cancelled = true; };
    }, []);

    const toggle = async (enabled) => {
        try {
            const saved = await apiPut('/platform-settings/case-packages', { enabled });
            setSettings(saved);
            window.dispatchEvent(new CustomEvent(CASE_PACKAGES_CHANGED, { detail: saved }));
            toast.success(t('package_settings_saved'));
        } catch (err) {
            toast.error(errorText(err));
        }
    };

    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-6">
            <h4 className="text-md font-bold text-indigo-300 mb-4 flex items-center gap-2">
                <Archive className="w-5 h-5" aria-hidden="true" />
                {t('package_settings_title')}
            </h4>
            <p className="text-sm text-neutral-400 mb-4">{t('package_settings_help')}</p>
            <label className="flex items-center gap-3 text-sm">
                <input
                    type="checkbox"
                    checked={Boolean(settings?.enabled)}
                    disabled={settings === null}
                    onChange={(e) => toggle(e.target.checked)}
                    className="h-4 w-4"
                />
                {t('package_settings_toggle')}
            </label>
            {loadError && <p className="text-xs text-red-400 mt-2" role="alert">{t('package_failed', { error: loadError })}</p>}
            {settings?.max_bytes ? (
                <p className="text-xs text-neutral-500 mt-2">{t('package_settings_limit', { size: formatBytes(settings.max_bytes) })}</p>
            ) : null}
        </div>
    );
}
