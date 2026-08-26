/**
 * The report — what the reader actually produces.
 *
 * WHY THIS REPLACED A "SUBMIT DIAGNOSIS" BOX: a one-line answer field tests
 * recall. A report tests reporting, which is the skill being trained. A
 * pathologist does not emit a diagnosis string; they write a document that has
 * to stand on its own — say what was examined, describe it, state a conclusion
 * — and can be read months later by someone who never saw the slide.
 *
 * A report is a DOCUMENT, not a form submission, so it has two states rather
 * than one: it can be saved and come back to, or submitted and closed. That
 * distinction is the whole reason both actions exist; a save that behaved like
 * a submit would make a half-written draft indistinguishable from a finished
 * opinion.
 *
 * Nothing here persists anything. Reports leave through the host's callback in
 * exactly the way annotations do — see VIEWER.md.
 */

import {
    annotationLabel,
    formatArea,
    formatLength,
    isAreal,
    measureAnnotation,
} from './annotationModel.js';

export const REPORT_STATUS = {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
};

/**
 * Build a validated report record.
 *
 * `now` is INJECTED rather than read from the clock inside, so a report can be
 * compared against a fixture — the same reason annotations take it.
 *
 * @param {object} p
 * @param {string} p.id
 * @param {string} [p.title]
 * @param {string} [p.body]
 * @param {Array<object>} [p.findings]  a snapshot from snapshotFindings()
 * @param {string} [p.status]           REPORT_STATUS value
 * @param {number} [p.now]
 * @returns {object} report record
 */
export function createReport({
    id,
    title = '',
    body = '',
    findings = [],
    status = REPORT_STATUS.DRAFT,
    now = 0,
}) {
    if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError(`createReport(): id must be a non-empty string, received ${JSON.stringify(id)}`);
    }
    if (typeof title !== 'string' || typeof body !== 'string') {
        throw new TypeError('createReport(): title and body must both be strings');
    }
    if (!Object.values(REPORT_STATUS).includes(status)) {
        throw new RangeError(
            `createReport(): status must be one of ${Object.values(REPORT_STATUS).join(', ')}, received ${JSON.stringify(status)}`,
        );
    }
    if (!Array.isArray(findings)) {
        throw new TypeError(`createReport(): findings must be an array, received ${typeof findings}`);
    }
    return {
        id,
        title,
        body,
        findings,
        status,
        createdAtMs: now,
        updatedAtMs: now,
        submittedAtMs: status === REPORT_STATUS.SUBMITTED ? now : null,
    };
}

/**
 * Why a report cannot be submitted yet, or null when it can.
 *
 * Returns a REASON rather than a boolean so the button can say what is
 * missing instead of sitting greyed out with no explanation — a disabled
 * control that will not tell you why is a dead end.
 *
 * @param {object} report
 * @returns {string|null}
 */
export function submitBlockedBecause(report) {
    if (!report) return 'There is no report to submit.';
    if (report.status === REPORT_STATUS.SUBMITTED) return 'This report has already been submitted.';
    if (report.title.trim().length === 0) return 'Give the report a title before submitting it.';
    if (report.body.trim().length === 0) return 'The report has no findings written in it yet.';
    return null;
}

/**
 * Mark a report submitted.
 *
 * Raises rather than returning the report unchanged: a submit that silently
 * did nothing would leave the reader believing they had signed out a case.
 *
 * @param {object} report
 * @param {number} [now]
 * @returns {object} a NEW submitted report
 * @throws {Error} when submitBlockedBecause() has a reason
 */
export function submitReport(report, now = 0) {
    const blocked = submitBlockedBecause(report);
    if (blocked) {
        throw new Error(`submitReport(): ${blocked}`);
    }
    return {
        ...report,
        status: REPORT_STATUS.SUBMITTED,
        updatedAtMs: now,
        submittedAtMs: now,
    };
}

/**
 * A submitted report is a record, not a working document.
 *
 * @param {object} report
 * @returns {boolean}
 */
export function isLocked(report) {
    return report?.status === REPORT_STATUS.SUBMITTED;
}

/**
 * Freeze the current annotations into report-ready lines.
 *
 * A SNAPSHOT, deliberately, not a live reference. A report that recalculated
 * its measurements from whatever the slide holds today would quietly rewrite
 * itself every time someone moved an annotation — the finished document must
 * say what was measured when it was written.
 *
 * @param {Array<object>} annotations
 * @param {object} slide  needs nativeMpp for physical units
 * @returns {Array<{id:string, label:string, kind:string, detail:string, classification:string|null}>}
 */
export function snapshotFindings(annotations, slide) {
    if (!Array.isArray(annotations)) {
        throw new TypeError(`snapshotFindings(): expected an array, received ${typeof annotations}`);
    }
    if (!slide?.nativeMpp) {
        throw new TypeError('snapshotFindings(): slide.nativeMpp is required to state measurements');
    }
    return annotations.map((a) => {
        const m = measureAnnotation(a, slide);
        return {
            id: a.id,
            label: annotationLabel(a),
            kind: a.kind,
            slideLabel: slide.label ?? null,
            classification: a.classification?.name ?? null,
            detail: describeMeasurement(a, m),
        };
    });
}

function describeMeasurement(annotation, m) {
    if (annotation.tally !== null && m.perMm2 !== null) {
        // The WHO figure first: it is the number that goes in the report.
        return `${annotation.tally} in ${formatArea(m.areaUm2)} — ${m.perMm2.toFixed(1)}/mm²`;
    }
    if (m.lengthUm !== null) return formatLength(m.lengthUm);
    if (isAreal(annotation.kind) && m.areaUm2 !== null) {
        return `${formatArea(m.areaUm2)} (${formatLength(m.widthUm)} × ${formatLength(m.heightUm)})`;
    }
    return '';
}

/**
 * The findings snapshot as plain text, for pasting into the body.
 *
 * Offered rather than inserted automatically: the findings belong in the
 * report because the reader put them there, and silently prepending a
 * generated block to someone's prose is how a report ends up saying something
 * its author did not write.
 *
 * @param {Array<object>} findings  a snapshotFindings() result
 * @returns {string}
 */
export function findingsAsText(findings) {
    if (!Array.isArray(findings) || findings.length === 0) return '';
    return findings
        .map((f) => {
            const parts = [f.label];
            if (f.classification && f.classification !== f.label) parts.push(f.classification);
            if (f.detail) parts.push(f.detail);
            return `- ${parts.join(' — ')}`;
        })
        .join('\n');
}

/**
 * A one-line summary for the report list.
 *
 * @param {object} report
 * @returns {string}
 */
export function reportSummary(report) {
    const words = report.body.trim().split(/\s+/).filter(Boolean).length;
    const findings = report.findings.length;
    return [
        `${words} word${words === 1 ? '' : 's'}`,
        findings > 0 ? `${findings} finding${findings === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
}
