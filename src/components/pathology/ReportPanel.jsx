import { useState } from 'react';
import {
    ChevronLeft, FileText, Lightbulb, ListPlus, Lock, Plus, Save, Send,
} from 'lucide-react';
import {
    findingsAsText,
    isLocked,
    reportSummary,
    submitBlockedBecause,
} from './report.js';

/**
 * Writing the report.
 *
 * WHY THIS IS NOT A DIAGNOSIS BOX: a single answer field tests recall. A
 * report tests reporting — saying what was examined, describing it, and
 * committing to a conclusion someone else can act on months later. That is the
 * skill, and it is what a pathologist actually produces.
 *
 * SAVE AND SUBMIT ARE GENUINELY DIFFERENT ACTS and the UI never blurs them. A
 * saved draft stays open and editable. A submitted report is locked, stamped,
 * and shown as a record rather than a form. Signing out a case is not
 * something to do by accident.
 *
 * The findings block is OFFERED, never inserted. Silently prepending a
 * generated list to someone's prose is how a report ends up asserting
 * something its author did not write.
 */
export function ReportPanel({
    reports,
    activeId,
    onSelect,
    onAdd,
    onChange,
    onSave,
    onSubmit,
    findings,
    task,
    logger,
    readResult,
    examMode = false,
}) {
    const active = reports.find((r) => r.id === activeId) ?? null;

    if (!active) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <TaskBrief task={task} logger={logger} examMode={examMode} />
                <ReportList reports={reports} activeId={activeId} onSelect={onSelect} onAdd={onAdd} />
            </div>
        );
    }

    return (
        <ReportEditor
            report={active}
            reportCount={reports.length}
            onBack={() => onSelect(null)}
            onChange={onChange}
            onSave={onSave}
            onSubmit={onSubmit}
            findings={findings}
            readResult={readResult}
        />
    );
}

function ReportList({ reports, activeId, onSelect, onAdd }) {
    return (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Reports">
            <header className="flex shrink-0 items-center justify-between px-3 py-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reports</h3>
                <button
                    type="button"
                    onClick={onAdd}
                    className="flex items-center gap-1 rounded-lg bg-fuchsia-500/15 px-2 py-1 text-[11px] font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition-colors hover:bg-fuchsia-500/25"
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add report
                </button>
            </header>

            {reports.length === 0 ? (
                <p className="px-3 pb-3 text-[11px] leading-relaxed text-slate-500">
                    No report yet. <strong className="text-slate-400">Add report</strong> opens a blank
                    one — give it a title, write your findings, then save it as a draft or submit it.
                </p>
            ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
                    {reports.map((r) => (
                        <li key={r.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(r.id)}
                                aria-current={r.id === activeId}
                                className="w-full rounded-lg p-2 text-left ring-1 ring-slate-800 transition-colors hover:bg-slate-800/50"
                            >
                                <span className="flex items-center gap-2">
                                    {isLocked(r)
                                        ? <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                                        : <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />}
                                    <span className="truncate text-[12px] font-medium text-slate-100">
                                        {r.title || 'Untitled report'}
                                    </span>
                                </span>
                                <span className="mt-0.5 block pl-[22px] text-[10px] tabular-nums text-slate-500">
                                    {/* Status carries an icon AND a word — never colour alone. */}
                                    {isLocked(r) ? 'Submitted' : 'Draft'} · {reportSummary(r)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function ReportEditor({ report, reportCount, onBack, onChange, onSave, onSubmit, findings, readResult }) {
    const [error, setError] = useState(null);
    const locked = isLocked(report);
    const blocked = submitBlockedBecause(report);

    const field = 'w-full rounded-md bg-slate-950/60 px-2 py-1.5 text-[12px] text-slate-100 ring-1 '
        + 'ring-slate-700 placeholder:text-slate-600 focus:outline-none focus:ring-fuchsia-500/50 '
        + 'disabled:text-slate-400 disabled:ring-slate-800';

    return (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Report">
            <header className="flex shrink-0 items-center gap-1 px-2 py-2">
                {reportCount > 1 || locked ? (
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        All reports
                    </button>
                ) : (
                    <span className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Report
                    </span>
                )}
                {locked && (
                    <span className="ml-auto flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Submitted
                    </span>
                )}
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
                <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Title
                    </span>
                    <input
                        type="text"
                        value={report.title}
                        disabled={locked}
                        placeholder="e.g. Core biopsy, left breast"
                        onChange={(e) => onChange(report.id, { title: e.target.value })}
                        className={field}
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Report
                    </span>
                    <textarea
                        value={report.body}
                        disabled={locked}
                        rows={14}
                        placeholder={'Describe what you examined and what you found, then state your conclusion.'}
                        onChange={(e) => onChange(report.id, { body: e.target.value })}
                        className={`${field} resize-y font-normal leading-relaxed`}
                    />
                </label>

                {!locked && findings.length > 0 && (
                    <button
                        type="button"
                        onClick={() => onChange(report.id, {
                            // Appended to what is already written, never replacing it.
                            body: `${report.body.trimEnd()}${report.body.trim() ? '\n\n' : ''}${findingsAsText(findings)}\n`,
                            findings,
                        })}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800/70 px-2 py-1.5 text-[11px] font-semibold text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-700/70"
                    >
                        <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Insert {findings.length} measurement{findings.length === 1 ? '' : 's'}
                    </button>
                )}

                {report.findings.length > 0 && (
                    <div className="rounded-lg bg-slate-950/50 p-2 ring-1 ring-slate-800">
                        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Findings attached to this report
                        </h4>
                        <ul className="space-y-0.5">
                            {report.findings.map((f) => (
                                <li key={f.id} className="flex gap-2 text-[11px] text-slate-300">
                                    <span className="truncate">{f.label}</span>
                                    <span className="ml-auto shrink-0 tabular-nums text-slate-400">{f.detail}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* The read assessment: how the slide was examined, which is
                    independent of anything written above. Shown only after
                    submission, so it cannot be used to fish for the answer. */}
                {locked && readResult && <ReadFeedback result={readResult} />}
            </div>

            {!locked && (
                <footer className="shrink-0 space-y-2 border-t border-slate-800/80 p-3">
                    {error && (
                        <p role="alert" className="rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-300 ring-1 ring-amber-500/30">
                            {error}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { onSave(report.id); setError(null); }}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-2 py-2 text-[11px] font-semibold text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-700"
                        >
                            <Save className="h-3.5 w-3.5" aria-hidden="true" />
                            Save draft
                        </button>
                        <button
                            type="button"
                            // Deliberately NOT disabled: a greyed button that
                            // will not say why is a dead end. It is pressable,
                            // and it explains what is missing.
                            onClick={() => {
                                if (blocked) { setError(blocked); return; }
                                setError(null);
                                onSubmit(report.id);
                            }}
                            aria-describedby={blocked ? 'submit-blocked' : undefined}
                            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold ring-1 transition-colors ${
                                blocked
                                    ? 'bg-slate-800/60 text-slate-400 ring-slate-700'
                                    : 'bg-fuchsia-500/20 text-fuchsia-100 ring-fuchsia-500/40 hover:bg-fuchsia-500/30'
                            }`}
                        >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Submit report
                        </button>
                    </div>
                    <p id="submit-blocked" className="text-[10px] leading-snug text-slate-500">
                        A submitted report is locked and time-stamped. Saving keeps it editable.
                    </p>
                </footer>
            )}
        </section>
    );
}

/**
 * How the slide was read — not what was written about it.
 *
 * Every number here comes from the viewport track: which key regions were
 * resolved, at what power, and how much of the tissue was actually screened.
 * It is the one thing an answer-only assessment cannot see.
 */
function ReadFeedback({ result }) {
    const rows = [
        ['Key findings reached', `${result.roiReached}/${result.roiTotal}`],
        ['Critical findings', `${result.criticalReached}/${result.criticalTotal}`],
        ['Slide screened', `${Math.round(result.slideCoverage * 100)}%`],
        ['Highest power used', `${result.maxObjective.toFixed(1)}x`],
        ['Time on the slide', `${(result.totalTimeMs / 1000).toFixed(0)}s`],
    ];
    return (
        <div className="rounded-lg bg-slate-950/50 p-2 ring-1 ring-slate-800">
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                How this slide was read
            </h4>
            <dl className="space-y-0.5">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex gap-2 text-[11px]">
                        <dt className="text-slate-400">{label}</dt>
                        <dd className="ml-auto tabular-nums text-slate-200">{value}</dd>
                    </div>
                ))}
            </dl>
            {result.perRoi?.filter((r) => !r.reached).map((r) => (
                <p key={r.id} className="mt-1 text-[10px] leading-snug text-amber-300">
                    Missed{r.critical ? ' (key)' : ''}: {r.label} — {r.missReason.replace(/_/g, ' ')}
                </p>
            ))}
        </div>
    );
}

/**
 * The task brief and its hints.
 *
 * Kept out of the report editor so the reader is never writing next to the
 * answer. In `examMode` the hints are absent entirely — the caller strips
 * them before they reach this component, so there is nothing here to reveal.
 */
function TaskBrief({ task, logger, examMode }) {
    const [shown, setShown] = useState(0);
    if (!task) return null;
    const hints = task.hints ?? [];

    return (
        <section className="shrink-0 border-b border-slate-800/80 px-3 py-2.5" aria-label="Task">
            <h3 className="text-[12px] font-semibold text-slate-100">{task.prompt}</h3>
            {task.instructions && (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{task.instructions}</p>
            )}

            {hints.slice(0, shown).map((hint) => (
                <p key={hint} className="mt-1.5 flex gap-1.5 text-[11px] leading-relaxed text-amber-200/90">
                    <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{hint}</span>
                </p>
            ))}

            {!examMode && shown < hints.length && (
                <button
                    type="button"
                    onClick={() => {
                        // Logged BEFORE the hint is revealed: asking is the act
                        // being recorded, and it is recorded whether or not the
                        // reader goes on to use what they are told.
                        logger?.hintRequested(task, shown + 1);
                        setShown((n) => n + 1);
                    }}
                    className="mt-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-800 transition-colors hover:bg-slate-800/60 hover:text-slate-200"
                >
                    <Lightbulb className="h-3 w-3" aria-hidden="true" />
                    Hint {shown + 1} of {hints.length}
                </button>
            )}
        </section>
    );
}
