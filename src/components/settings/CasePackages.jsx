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
//
// An import of a big package runs for minutes on the server after the upload
// (FI-0010: 71,200 files). The dialog therefore shows files and bytes done
// within each phase, can really cancel the job (the server undoes what it
// placed), and says plainly that Close leaves the import running. A running
// import is found again when the case list is reopened, so nobody imports
// the same package twice because the first one looked stuck.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, Circle, Loader2, PackageOpen, PackagePlus, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch, apiPost, apiPut, ApiError } from '../../services/apiClient';
import { apiUrl } from '../../config/api';
import useModalFocus from '../../hooks/useModalFocus.js';
import { CASE_PACKAGES_CHANGED } from './useCasePackages.js';
import { CaseFileError, readFileChunk } from './caseImportFile.js';
import { formatBytes, formatElapsed } from './casePackageFormat.js';

const POLL_MS = 1000;
const BACKGROUND_POLL_MS = 5000;
const CHUNK_RETRIES = 3;
// Import jobs this browser closed the dialog on while they ran: their result
// is offered again once they finish.
const DETACHED_KEY = 'rohy.casePackages.detachedJobs';

const FINISHED = new Set(['done', 'failed', 'cancelled']);
const isFinished = (job) => FINISHED.has(job?.state);

const errorText = (err) => (err instanceof ApiError ? err.message : String(err?.message || err));

/** The import's failure in words — never a browser's raw DOMException text (FI0010.AUTHOR.03). */
const importErrorText = (t, err) => (
    err instanceof CaseFileError && err.code === 'case_file_unreadable' ? t('import_file_unreadable') : errorText(err)
);

const readDetached = () => {
    try {
        const ids = JSON.parse(window.localStorage.getItem(DETACHED_KEY) || '[]');
        return new Set(Array.isArray(ids) ? ids : []);
    } catch {
        return new Set();
    }
};
const writeDetached = (ids) => window.localStorage.setItem(DETACHED_KEY, JSON.stringify([...ids].slice(-20)));
const markDetached = (id) => writeDetached(new Set([...readDetached(), id]));
const forgetDetached = (id) => { const ids = readDetached(); ids.delete(id); writeDetached(ids); };

/** Poll a package job until it finishes. Resolves with the final job; stops when `alive()` turns false. */
async function waitForJob(jobId, onUpdate, alive) {
    for (;;) {
        const job = await apiFetch(`/case-packages/jobs/${jobId}`);
        if (!alive()) return job;
        onUpdate(job);
        if (isFinished(job)) return job;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

const PHASE_KEYS = {
    starting: 'package_phase_queued',
    queued: 'package_phase_queued',
    running: 'package_phase_queued',
    collecting: 'package_phase_collecting',
    writing: 'package_phase_writing',
    reading: 'package_phase_reading',
    checking: 'package_phase_checking',
    placing: 'package_phase_placing',
    saving: 'package_phase_saving',
};

function phaseText(t, phase, percent) {
    if (phase === 'uploading') return t('package_phase_uploading', { percent: percent ?? 0 });
    switch (PHASE_KEYS[phase] ?? 'package_phase_queued') {
    case 'package_phase_collecting': return t('package_phase_collecting');
    case 'package_phase_writing': return t('package_phase_writing');
    case 'package_phase_reading': return t('package_phase_reading');
    case 'package_phase_checking': return t('package_phase_checking');
    case 'package_phase_placing': return t('package_phase_placing');
    case 'package_phase_saving': return t('package_phase_saving');
    default: return t('package_phase_queued');
    }
}

/** What a running job or upload has done so far: phase, files, bytes, time. */
function WorkProgress({ dialog }) {
    const { t, i18n } = useTranslation('authoring_config');
    const locale = i18n.resolvedLanguage || i18n.language;
    const job = dialog.job;
    const phase = dialog.phase ?? job?.phase ?? job?.state ?? 'starting';
    const progress = dialog.phase === 'uploading'
        ? { bytes_done: dialog.sent, bytes_total: dialog.total }
        : job?.progress ?? null;
    const details = [
        progress?.total ? t('package_progress_files', { done: progress.done, total: progress.total }) : null,
        progress?.bytes_total ? t('package_progress_bytes', {
            done: formatBytes(progress.bytes_done ?? 0, locale), total: formatBytes(progress.bytes_total, locale),
        }) : null,
        job?.elapsed_ms ? t('package_progress_elapsed', { time: formatElapsed(job.elapsed_ms) }) : null,
    ].filter(Boolean);
    const max = progress?.total ?? progress?.bytes_total ?? null;
    const value = progress?.total ? progress.done : progress?.bytes_done;
    return (
        <div className="space-y-1.5" role="status">
            <p className="flex items-center gap-2 text-gray-700">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {dialog.cancelling ? t('package_cancelling') : phaseText(t, phase, dialog.percent)}
            </p>
            {max ? (
                <progress className="h-2 w-full" max={max} value={Math.min(value ?? 0, max)} aria-label={t('package_progress_label')} />
            ) : null}
            {details.length > 0 && <p className="text-xs text-gray-600 tabular-nums">{details.join(' · ')}</p>}
        </div>
    );
}

/**
 * The dialog frame. `actions` are the footer buttons; `onDismiss` is what
 * the × and Escape do — the same as the footer's dismissing button, so no
 * key does something the visible buttons do not say.
 */
function PackageDialog({ title, dialog, onDismiss, dismissLabel, actions, footerNote, children }) {
    const { t } = useTranslation('authoring_config');
    const ref = useModalFocus({ onEscape: onDismiss });
    const notes = dialog.result?.warnings ?? [];

    // The element that had focus can disappear when the dialog's content
    // changes (the file input once a file is chosen): keep focus inside.
    useEffect(() => {
        const node = ref.current;
        if (node && !node.contains(document.activeElement)) node.focus();
    }, [dialog.state, ref]);

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-package-title"
                tabIndex={-1}
                className="w-full max-w-xl max-h-[80vh] overflow-hidden rounded-xl bg-white text-gray-900 shadow-2xl flex flex-col outline-none"
            >
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                    <h2 id="case-package-title" className="flex items-center gap-2 text-lg font-bold">
                        <Archive className="h-5 w-5" aria-hidden="true" />
                        {title}
                    </h2>
                    <button type="button" onClick={onDismiss} aria-label={dismissLabel} title={dismissLabel} className="rounded p-1 hover:bg-gray-100">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-3 text-sm">
                    {children}
                    {dialog.state === 'working' && <WorkProgress dialog={dialog} />}
                    {dialog.cancelRefused && (
                        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">{t('package_cancel_refused')}</p>
                    )}
                    {dialog.state === 'failed' && (
                        <p className="rounded border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
                            {t('package_failed', { error: dialog.error })}
                        </p>
                    )}
                    {dialog.state === 'cancelled' && (
                        <p className="rounded border border-gray-200 bg-gray-50 p-3 text-gray-800" role="status">{t('package_cancelled')}</p>
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
                <div className="border-t border-gray-200 px-5 py-3 space-y-2">
                    {footerNote && <p className="text-xs text-gray-600">{footerNote}</p>}
                    <div className="flex flex-wrap justify-end gap-2">
                        {actions}
                        <button type="button" onClick={onDismiss} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50">
                            {dismissLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Per-case "Export package" button. */
export function CasePackageExportButton({ caseItem }) {
    const { t, i18n } = useTranslation('authoring_config');
    const [dialog, setDialog] = useState(null);
    const alive = useRef(false);
    const jobId = useRef(null);

    const close = useCallback(() => {
        // Closing a running export cancels it: nothing else would ever fetch
        // the file. Fire and forget, deliberately: the dialog is gone, and an
        // export the cancel misses (it finished first, 409) only leaves a
        // file the server deletes within the hour.
        if (alive.current && jobId.current) {
            apiPost(`/case-packages/jobs/${jobId.current}/cancel`, {}).catch((err) => {
                if (!(err instanceof ApiError && err.code === 'job_finished')) {
                    // Nowhere left to show it; the console is the record.
                    console.warn('case package export could not be cancelled', err);
                }
            });
        }
        alive.current = false;
        jobId.current = null;
        setDialog(null);
    }, []);
    useEffect(() => () => { alive.current = false; }, []);

    const download = (id) => {
        const anchor = document.createElement('a');
        anchor.href = apiUrl(`/case-packages/jobs/${id}/download`);
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
            jobId.current = job.id;
            const done = await waitForJob(job.id, (j) => setDialog({ state: 'working', job: j }), () => alive.current);
            if (!alive.current) return;
            alive.current = false;
            if (done.state !== 'done') {
                setDialog({ state: 'failed', error: done.error?.error });
                return;
            }
            download(done.id);
            setDialog({
                state: 'done',
                jobId: done.id,
                result: done.result,
                summary: [
                    t('package_export_done', { size: formatBytes(done.result.bytes, i18n.resolvedLanguage || i18n.language) }),
                    t('package_export_counts', done.result.counts),
                    done.result.counts.lessons ? t('package_export_course', { lessons: done.result.counts.lessons }) : null,
                ].filter(Boolean).join(' '),
            });
        } catch (err) {
            if (alive.current) setDialog({ state: 'failed', error: errorText(err) });
            alive.current = false;
        }
    };

    const busy = dialog?.state === 'working';
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
                <PackageDialog
                    title={t('package_export_title', { name: caseItem.name })}
                    dialog={dialog}
                    onDismiss={close}
                    dismissLabel={busy ? t('package_cancel') : t('package_close')}
                >
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

/** One line of the after-import checklist: done (tick) or still to do (circle). */
function Step({ done, children }) {
    return (
        <li className="flex items-start gap-2">
            {done
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
            <div className="space-y-1">{children}</div>
        </li>
    );
}

/**
 * What to do after an import, as a checklist: the case starts hidden, the
 * course starts empty, and lessons may wait behind the case (FI-0010 F22).
 */
function ImportNextSteps({ result, onCaseShown, onOpenCourses, onOpenLessons }) {
    const { t } = useTranslation('authoring_config');
    const [shown, setShown] = useState(Boolean(result.case.is_available));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const { course, media } = result;
    const code = result.case.case_code;

    const show = async () => {
        setBusy(true);
        setError(null);
        try {
            await apiPut(`/cases/${result.case.id}/availability`, { is_available: true });
            setShown(true);
            onCaseShown?.();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const action = 'rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-800 hover:bg-indigo-50 disabled:opacity-50';

    return (
        <section aria-labelledby="case-package-next-title" className="space-y-2">
            <h3 id="case-package-next-title" className="font-semibold">{t('package_next_title')}</h3>
            <ul className="space-y-2 text-gray-800">
                <Step done={shown}>
                    <p>{shown ? t('package_next_case_shown', { code }) : t('package_next_case_hidden', { code })}</p>
                    {!shown && (
                        <button type="button" onClick={show} disabled={busy} className={action}>{t('package_next_case_show')}</button>
                    )}
                    {error && <p className="text-xs text-red-700" role="alert">{t('package_next_case_show_failed', { error })}</p>}
                </Step>
                {course && (
                    <Step done={course.members > 0}>
                        <p>{t('package_next_course_members', { name: course.name, members: course.members ?? 0 })}</p>
                        {course.source_name && course.source_name !== course.name && (
                            <p className="text-xs text-gray-600">{t('package_next_course_renamed', { name: course.name, source: course.source_name })}</p>
                        )}
                        {onOpenCourses && <button type="button" onClick={onOpenCourses} className={action}>{t('package_next_course_open')}</button>}
                    </Step>
                )}
                {course && course.lessons > 0 && (
                    <Step done>
                        <p>{t('package_next_lessons', { lessons: course.lessons, locked: course.locked ?? 0 })}</p>
                        {onOpenLessons && <button type="button" onClick={onOpenLessons} className={action}>{t('package_next_lessons_open')}</button>}
                    </Step>
                )}
            </ul>
            {media && (
                <p className="text-xs text-gray-600">
                    {t('package_media_reuse', {
                        slidesReused: media.slides_reused, uploadsReused: media.uploads_reused,
                        slidesCopied: media.slides_copied, uploadsCopied: media.uploads_copied,
                    })}
                </p>
            )}
        </section>
    );
}

/** "Import package" button for the case list header. */
export function CasePackageImportButton({ onImported, onOpenCourses, onOpenLessons }) {
    const { t } = useTranslation('authoring_config');
    const [dialog, setDialog] = useState(null);
    // An import of this admin's still running — or finished after its dialog
    // was closed — found on the server.
    const [background, setBackground] = useState(null);
    const [backgroundError, setBackgroundError] = useState(null);
    const uploading = useRef(false);
    const uploadId = useRef(null);
    // The job the open dialog follows; null when it follows none.
    const following = useRef(null);

    const refreshBackground = useCallback(async () => {
        try {
            const { jobs = [] } = await apiFetch('/case-packages/jobs?kind=import');
            const detached = readDetached();
            const running = jobs.find((job) => !isFinished(job));
            const finishedUnseen = jobs.find((job) => isFinished(job) && detached.has(job.id));
            setBackground(running ?? finishedUnseen ?? null);
            setBackgroundError(null);
        } catch (err) {
            setBackgroundError(errorText(err));
        }
    }, []);

    useEffect(() => { refreshBackground(); }, [refreshBackground]);
    // While an import runs unattended, look again now and then, so the
    // button turns into "finished — show the result" without a reload.
    useEffect(() => {
        if (dialog || !background || isFinished(background)) return undefined;
        const timer = setInterval(refreshBackground, BACKGROUND_POLL_MS);
        return () => clearInterval(timer);
    }, [dialog, background, refreshBackground]);
    useEffect(() => () => { uploading.current = false; following.current = null; }, []);

    const finish = useCallback((job) => {
        if (job.state === 'cancelled') {
            setDialog({ state: 'cancelled', job });
            return;
        }
        if (job.state === 'failed') {
            setDialog({ state: 'failed', job, error: job.error?.error });
            return;
        }
        const { case: imported, imported: counts } = job.result;
        setDialog({
            state: 'done',
            job,
            result: job.result,
            summary: [
                t('package_import_done', { name: imported.name, code: imported.case_code }),
                t('package_import_counts', counts),
            ].join(' '),
        });
        onImported?.();
    }, [onImported, t]);

    /** Follow job `id` in the dialog until it finishes or the dialog lets go of it. */
    const follow = useCallback(async (id) => {
        following.current = id;
        try {
            const final = await waitForJob(id, (job) => {
                setDialog((d) => (d && following.current === id ? { ...d, state: 'working', phase: null, job } : d));
            }, () => following.current === id);
            if (following.current !== id) return;
            following.current = null;
            forgetDetached(id);
            setBackground(null);
            finish(final);
        } catch (err) {
            if (following.current === id) {
                following.current = null;
                setDialog({ state: 'failed', error: errorText(err) });
            }
        }
    }, [finish]);

    const open = () => setDialog({ state: 'idle' });

    const showBackground = () => {
        const job = background;
        if (isFinished(job)) {
            forgetDetached(job.id);
            setBackground(null);
            setDialog({ state: 'working', job });
            finish(job);
            return;
        }
        setDialog({ state: 'working', job });
        follow(job.id);
    };

    /** × / Escape / the footer's dismiss button. Never cancels a running import job. */
    const dismiss = useCallback(() => {
        if (uploading.current) {
            // Before the upload completes there is no job: closing stops the upload.
            uploading.current = false;
            if (uploadId.current) {
                apiFetch(`/case-packages/uploads/${uploadId.current}`, { method: 'DELETE' }).catch(() => {});
                uploadId.current = null;
            }
        }
        const followed = following.current;
        following.current = null;
        if (followed) {
            // The import goes on without the dialog; it is offered again.
            markDetached(followed);
            refreshBackground();
        }
        setDialog(null);
    }, [refreshBackground]);

    const cancelJob = async () => {
        const id = dialog?.job?.id;
        if (!id) return;
        setDialog((d) => ({ ...d, cancelling: true }));
        try {
            await apiPost(`/case-packages/jobs/${id}/cancel`, {});
        } catch (err) {
            const refused = err instanceof ApiError && (err.code === 'case_package_committed' || err.code === 'job_finished');
            setDialog((d) => ({ ...d, cancelling: false, cancelRefused: refused, ...(refused ? {} : { cancelError: errorText(err) }) }));
        }
    };

    const putChunk = async (id, index, bytes) => {
        for (let attempt = 1; ; attempt++) {
            try {
                return await apiFetch(`/case-packages/uploads/${id}/chunks/${index}`, {
                    method: 'PUT',
                    body: bytes,
                    headers: { 'Content-Type': 'application/octet-stream' },
                });
            } catch (err) {
                const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
                if (!retryable || attempt >= CHUNK_RETRIES) throw err;
            }
        }
    };

    const upload = async (file) => {
        uploading.current = true;
        setDialog({ state: 'working', phase: 'uploading', percent: 0, sent: 0, total: file.size });
        try {
            const created = await apiPost('/case-packages/uploads', { bytes: file.size });
            uploadId.current = created.id;
            const chunk = created.chunk_bytes;
            for (let offset = 0, index = 0; offset < file.size; offset += chunk, index++) {
                if (!uploading.current) return;
                // Read first, then send: a chunk the browser cannot read is
                // the file's fault, not the network's — no retry, and the
                // dialog says so (see readFileChunk).
                const bytes = await readFileChunk(file, offset, offset + chunk);
                await putChunk(created.id, index, bytes);
                const sent = Math.min(offset + chunk, file.size);
                setDialog({ state: 'working', phase: 'uploading', percent: Math.round((sent / file.size) * 100), sent, total: file.size });
            }
            if (!uploading.current) return;
            const job = await apiPost(`/case-packages/uploads/${created.id}/complete`, {});
            uploadId.current = null;
            if (!uploading.current) {
                // Closed while the last request was on its way: the import
                // runs anyway, so it is offered again like any closed import.
                markDetached(job.id);
                refreshBackground();
                return;
            }
            uploading.current = false;
            setDialog({ state: 'working', job });
            await follow(job.id);
        } catch (err) {
            if (uploading.current) setDialog({ state: 'failed', error: importErrorText(t, err) });
            uploading.current = false;
        }
    };

    const jobRunning = dialog?.state === 'working' && dialog.job && !isFinished(dialog.job);
    const isUploading = dialog?.state === 'working' && dialog.phase === 'uploading';
    let dismissLabel = t('package_close');
    if (isUploading) dismissLabel = t('package_cancel_upload');
    else if (jobRunning) dismissLabel = t('package_close_continue');
    const backgroundRunning = background && !isFinished(background);

    return (
        <>
            <button
                type="button"
                onClick={open}
                className="rohy-btn rohy-btn-secondary"
                title={t('package_import_title')}
            >
                <PackagePlus className="w-4 h-4" aria-hidden="true" /> {t('package_import_button')}
            </button>
            {background && !dialog && (
                <button type="button" onClick={showBackground} className="rohy-btn rohy-btn-secondary">
                    {backgroundRunning
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                    {backgroundRunning ? t('package_running_show') : t('package_finished_show')}
                </button>
            )}
            {dialog && (
                <PackageDialog
                    title={t('package_import_title')}
                    dialog={dialog}
                    onDismiss={dismiss}
                    dismissLabel={dismissLabel}
                    footerNote={jobRunning ? t('package_close_note') : null}
                    actions={jobRunning && dialog.job.cancellable && !dialog.cancelRefused ? (
                        <button
                            type="button"
                            onClick={cancelJob}
                            disabled={dialog.cancelling || dialog.job.cancel_requested}
                            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50"
                        >
                            {t('package_cancel_import')}
                        </button>
                    ) : null}
                >
                    <p className="text-gray-700">{t('package_import_help')}</p>
                    {dialog.cancelError && (
                        <p className="text-xs text-red-700" role="alert">{t('package_failed', { error: dialog.cancelError })}</p>
                    )}
                    {dialog.state === 'idle' && backgroundRunning && (
                        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">
                            {t('package_running_notice')}{' '}
                            <button type="button" onClick={showBackground} className="underline">{t('package_show_job')}</button>
                        </p>
                    )}
                    {dialog.state === 'idle' && backgroundError && (
                        <p className="text-xs text-gray-600">{t('package_jobs_unavailable', { error: backgroundError })}</p>
                    )}
                    {dialog.state === 'idle' && (
                        <label className="block">
                            <span className="sr-only">{t('package_import_choose')}</span>
                            <input
                                type="file"
                                accept=".rohycase"
                                aria-label={t('package_import_choose')}
                                data-autofocus
                                onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }}
                                className="block w-full text-sm"
                            />
                        </label>
                    )}
                    {dialog.state === 'done' && (
                        <ImportNextSteps
                            result={dialog.result}
                            onCaseShown={onImported}
                            onOpenCourses={onOpenCourses ? () => { dismiss(); onOpenCourses(); } : undefined}
                            onOpenLessons={onOpenLessons ? () => { dismiss(); onOpenLessons(); } : undefined}
                        />
                    )}
                </PackageDialog>
            )}
        </>
    );
}

/** Platform → General: the on/off switch. */
export default function CasePackageSettings() {
    const { t, i18n } = useTranslation('authoring_config');
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
                <p className="text-xs text-neutral-500 mt-2">
                    {t('package_settings_limit', { size: formatBytes(settings.max_bytes, i18n.resolvedLanguage || i18n.language) })}
                </p>
            ) : null}
        </div>
    );
}
