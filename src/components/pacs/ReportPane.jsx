import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { composeReport, reportToText, validateReport } from './report.js';

// How long typing must pause before the draft is logged.
const DRAFT_SETTLE_MS = 2000;

/**
 * Where the reader writes their report, and files it.
 *
 * The two delivery routes are both the host's, and both optional:
 *
 *   onSubmitReport(report)   the host stores it — rohy writes it against the
 *                            ordered study, matched on `report.study.studyId`
 *   reportLinkFor(report)    the host returns a URL — rohy's own report form,
 *                            opened with the study context already attached
 *
 * They are not alternatives. A host may want both: file it here, or step out to
 * the form that already exists. With neither, the report can still be composed
 * and copied, which is the fallback that always works.
 */
export function ReportPane({
    entry,
    series = [],
    viewports = {},
    paneInfo = {},
    measurements = [],
    keyImages = [],
    reportedBy = null,
    referenceNormal = null,
    onSubmitReport,
    reportLinkFor,
    onDraft,
    draft = null,
    // A createRadoyonLogger() instance. Drafting is logged as SHAPE (word
    // counts, evidence) once typing pauses; filing is logged when the host
    // has actually taken the report. Never the prose.
    logger = null,
    t = (key, fallback) => fallback ?? key,
}) {
    const [findings, setFindings] = useState(draft?.findings ?? '');
    const [impression, setImpression] = useState(draft?.impression ?? '');
    const [state, setState] = useState({ status: 'idle', message: null });
    const [showNormal, setShowNormal] = useState(false);

    const report = useMemo(() => composeReport({
        findings, impression, entry, series, viewports, paneInfo, measurements, keyImages, reportedBy,
    }), [findings, impression, entry, series, viewports, paneInfo, measurements, keyImages, reportedBy]);

    const check = validateReport(report);
    const evidence = report.evidence;

    // Set by `edit`, so a restored draft is not logged as freshly drafted on
    // mount, and cleared by the settle timer.
    const dirtyRef = useRef(false);
    const edit = useCallback((next) => {
        if (next.findings !== undefined) setFindings(next.findings);
        if (next.impression !== undefined) setImpression(next.impression);
        setState({ status: 'idle', message: null });
        dirtyRef.current = true;
        onDraft?.({ findings: next.findings ?? findings, impression: next.impression ?? impression });
    }, [findings, impression, onDraft]);

    // A run of keystrokes is one act of drafting, not a hundred.
    useEffect(() => {
        if (!dirtyRef.current || !logger) return undefined;
        const timer = setTimeout(() => {
            dirtyRef.current = false;
            logger.reportDrafted(report);
        }, DRAFT_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [report, logger]);

    const submit = useCallback(async () => {
        if (!check.ok) return;
        setState({ status: 'sending', message: null });
        try {
            await onSubmitReport(report);
            // Logged AFTER the host took it: a filing the host refused is an
            // error row in the host's own log, not a SUBMITTED_REPORT.
            logger?.reportSubmitted(report);
            setState({ status: 'sent', message: t('radoyon_report_filed', 'Report filed.') });
        } catch (error) {
            // Surfaced, never swallowed: a learner who believes their report was
            // filed and finds later that it was not has lost the work AND the
            // chance to notice.
            setState({ status: 'error', message: error?.message ?? String(error) });
        }
    }, [check.ok, onSubmitReport, report, logger, t]);

    const link = reportLinkFor && check.ok ? safeLink(reportLinkFor, report) : null;

    if (!entry) {
        return <p className="p-3 text-xs text-slate-500">{t('radoyon_report_no_study', 'Open a study to report it.')}</p>;
    }

    return (
        <div className="p-3 space-y-3 text-xs">
            <Field
                label={t('radoyon_report_findings', 'Findings')}
                hint={t('radoyon_report_findings_hint', 'What you see')}
                value={findings}
                rows={6}
                onChange={(v) => edit({ findings: v })}
            />
            <Field
                label={t('radoyon_report_impression', 'Impression')}
                hint={t('radoyon_report_impression_hint', 'What it means')}
                value={impression}
                rows={3}
                onChange={(v) => edit({ impression: v })}
            />

            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 border-t border-slate-800 pt-2">
                <dt>{t('radoyon_report_series_seen', 'Series opened')}</dt>
                <dd className="text-right font-mono text-slate-400">{evidence.seriesOpened}/{evidence.seriesInStudy}</dd>
                <dt>{t('radoyon_report_coverage', 'Images reviewed')}</dt>
                <dd className="text-right font-mono text-slate-400">
                    {evidence.coverage === null ? '—' : `${Math.round(evidence.coverage * 100)}%`}
                </dd>
                <dt>{t('radoyon_report_measurements', 'Measurements')}</dt>
                <dd className="text-right font-mono text-slate-400">{evidence.measurements.length}</dd>
            </dl>
            <p className="text-[10px] text-slate-600 leading-snug">
                {t('radoyon_report_evidence_hint', 'Attached automatically — what the room observed, not what the report claims.')}
            </p>

            {referenceNormal && (referenceNormal.findings || referenceNormal.impression) && (
                <div className="border-t border-slate-800 pt-2">
                    <button
                        type="button"
                        onClick={() => setShowNormal((v) => !v)}
                        aria-expanded={showNormal}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300"
                    >
                        {showNormal
                            ? t('radoyon_report_hide_normal', 'Hide what normal reads like')
                            : t('radoyon_report_show_normal', 'What does normal read like?')}
                    </button>
                    {showNormal && (
                        <div className="mt-1.5 space-y-1 text-[11px] text-slate-400">
                            {/* Labelled as the study TYPE's normal, never as this
                                study's result — this is reference text from the
                                ordering catalogue, and nobody has reported these
                                images. */}
                            <p className="text-[10px] uppercase tracking-wider text-slate-600">
                                {t('radoyon_report_normal_label', 'Reference — a normal study of this type')}
                            </p>
                            {referenceNormal.findings && <p>{referenceNormal.findings}</p>}
                            {referenceNormal.impression && <p className="text-slate-500">{referenceNormal.impression}</p>}
                        </div>
                    )}
                </div>
            )}

            {!check.ok && (findings || impression) && (
                <p className="text-[11px] text-amber-400">{check.problems[0]}</p>
            )}

            <div className="flex gap-1.5">
                {onSubmitReport && (
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!check.ok || state.status === 'sending'}
                        className="flex-1 rounded-md bg-cyan-600 px-2 py-1.5 text-white disabled:bg-slate-800 disabled:text-slate-600"
                    >
                        {state.status === 'sending'
                            ? t('radoyon_report_filing', 'Filing…')
                            : t('radoyon_report_file', 'File report')}
                    </button>
                )}
                {link && (
                    <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-md border border-slate-700 px-2 py-1.5 text-center text-slate-300 hover:border-slate-500"
                    >
                        {t('radoyon_report_open_form', 'Open in case')}
                    </a>
                )}
                <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(reportToText(report))}
                    title={t('radoyon_report_copy', 'Copy as text')}
                    className="rounded-md border border-slate-700 px-2 py-1.5 text-slate-400 hover:border-slate-500"
                >
                    {t('radoyon_report_copy_short', 'Copy')}
                </button>
            </div>

            {state.message && (
                <p className={state.status === 'error' ? 'text-[11px] text-red-400' : 'text-[11px] text-emerald-400'}>
                    {state.message}
                </p>
            )}
        </div>
    );
}

/**
 * A host's link builder is host code, and a throw from it must not take the
 * report pane down with it — the reader would lose what they had written.
 */
function safeLink(build, report) {
    try {
        const url = build(report);
        return typeof url === 'string' && url ? url : null;
    } catch {
        return null;
    }
}

function Field({ label, hint, value, rows, onChange }) {
    return (
        <label className="block space-y-1">
            <span className="flex items-baseline justify-between">
                <span className="text-slate-300">{label}</span>
                <span className="text-[10px] text-slate-600">{hint}</span>
            </span>
            <textarea
                value={value}
                rows={rows}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200 leading-snug resize-y"
            />
        </label>
    );
}

export default ReportPane;
