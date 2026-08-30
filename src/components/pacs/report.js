/**
 * The reader's report: what a learner writes, and the evidence that they wrote
 * it having actually looked.
 *
 * This is the OTHER report. `caseDocument.js` carries the author's reference
 * report — the answer, which a case may withhold. This one is the learner's,
 * and the two must never be confused: a marking scheme that compared a learner
 * to a report they had been shown would measure nothing.
 *
 * Two things shape the design.
 *
 * EVIDENCE IS COLLECTED, NOT CLAIMED. Coverage, the series opened and the
 * measurements taken are already tracked by the viewport for their own reasons.
 * Attaching them costs nothing and turns "I reviewed the study" from an
 * assertion into a record — which is the difference between a teaching tool and
 * a text box.
 *
 * DELIVERY IS THE HOST'S. Radoyon does not know what rohy is, or that it is
 * rohy. It composes a report and hands it over: `onSubmitReport` for a host
 * that stores it, `reportLinkFor` for a host that would rather open its own
 * form with the context attached. Both are optional, and both may be present —
 * they are not alternatives so much as two things a host may legitimately want.
 */

/**
 * Compose a report from what the reader wrote and what the room observed.
 *
 * @param {object} input
 * @param {string} input.findings free text — what is seen
 * @param {string} input.impression free text — what it means
 * @param {object} [input.entry] the worklist entry being reported
 * @param {Array} [input.series] the series of the study, as buildSeries returns
 * @param {object} [input.viewports] pane -> viewport state, for coverage
 * @param {object} [input.paneInfo] pane -> { stackId, description, count }
 * @param {Array} [input.measurements] measurements taken, any pane
 * @param {Array} [input.keyImages] [{ stackId, slice, note }]
 * @param {string} [input.reportedBy]
 * @param {string} [input.at] ISO timestamp; pass it in so a fixture can pin it
 * @returns {{findings, impression, study, evidence, reportedBy, at}}
 */
export function composeReport({
    findings = '',
    impression = '',
    entry = null,
    series = [],
    viewports = {},
    paneInfo = {},
    measurements = [],
    keyImages = [],
    reportedBy = null,
    at = new Date().toISOString(),
} = {}) {
    return {
        findings: String(findings).trim(),
        impression: String(impression).trim(),
        study: {
            // studyId is the catalogue's identity — the thing a host can join
            // on. Without it a report is a note about a picture; with it, it is
            // a report of an ordered study.
            studyId: entry?.studyId ?? null,
            entryId: entry?.id ?? null,
            accession: entry?.accession ?? null,
            description: entry?.description ?? null,
            modality: entry?.modality ?? null,
        },
        evidence: gatherEvidence({ series, viewports, paneInfo, measurements, keyImages }),
        reportedBy,
        at,
    };
}

/** What the room can attest to, as opposed to what the reader typed. */
function gatherEvidence({ series, viewports, paneInfo, measurements, keyImages }) {
    // One entry per series the reader actually had on screen, keyed by stack so
    // two panes showing the same series count once.
    const bystack = new Map();
    Object.entries(paneInfo).forEach(([pane, info]) => {
        if (!info?.stackId) return;
        const viewport = viewports[pane];
        const seen = viewport?.seen instanceof Set ? viewport.seen.size : 0;
        const count = info.count ?? 0;
        const previous = bystack.get(info.stackId);
        // A series opened in two panes: keep the better coverage, not the sum,
        // which could otherwise exceed the number of slices that exist.
        if (previous && previous.slicesViewed >= seen) return;
        bystack.set(info.stackId, {
            stackId: info.stackId,
            description: info.description ?? null,
            slices: count,
            slicesViewed: Math.min(seen, count || seen),
            coverage: count > 0 ? Math.min(1, seen / count) : null,
        });
    });

    const reviewed = [...bystack.values()];
    const totalSlices = reviewed.reduce((n, s) => n + (s.slices || 0), 0);
    const totalViewed = reviewed.reduce((n, s) => n + (s.slicesViewed || 0), 0);

    return {
        seriesInStudy: series.length,
        seriesOpened: reviewed.length,
        reviewed,
        // The single number a rubric usually wants, over the whole study.
        coverage: totalSlices > 0 ? Math.min(1, totalViewed / totalSlices) : null,
        measurements: measurements.map((m) => ({
            kind: m.kind ?? null,
            stackId: m.stackId ?? null,
            slice: m.slice ?? null,
            result: m.result ?? null,
        })),
        keyImages: keyImages.map((k) => ({
            stackId: k.stackId ?? null,
            slice: k.slice ?? null,
            note: k.note ?? null,
        })),
    };
}

/**
 * Whether a report can be submitted, and why not.
 *
 * Deliberately permissive about content and strict about identity: nobody
 * should be told their impression is too short, but a report that cannot say
 * WHICH study it is about cannot be filed against one either.
 *
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateReport(report) {
    const problems = [];
    if (!report?.findings && !report?.impression) {
        problems.push('a report needs findings, an impression, or both');
    }
    if (!report?.study?.studyId && !report?.study?.entryId) {
        problems.push('the report does not identify a study');
    }
    return { ok: problems.length === 0, problems };
}

/**
 * The report as plain text, for a host with nowhere structured to put it — and
 * for the clipboard, which is the fallback that always works.
 */
export function reportToText(report) {
    if (!report) return '';
    const lines = [];
    const study = report.study ?? {};
    if (study.description) lines.push(study.description);
    if (study.accession) lines.push(`Accession: ${study.accession}`);
    if (report.reportedBy) lines.push(`Reported by: ${report.reportedBy}`);
    if (report.at) lines.push(`Date: ${report.at.slice(0, 10)}`);
    if (lines.length) lines.push('');

    lines.push('FINDINGS');
    lines.push(report.findings || '—');
    lines.push('');
    lines.push('IMPRESSION');
    lines.push(report.impression || '—');

    const measurements = report.evidence?.measurements ?? [];
    if (measurements.length) {
        lines.push('');
        lines.push('MEASUREMENTS');
        measurements.forEach((m) => lines.push(`- ${[m.kind, measurementText(m.result)].filter(Boolean).join(': ') || 'measurement'}`));
    }
    return lines.join('\n');
}

/**
 * One measurement in words, from the shapes series.js actually returns:
 * `{mm, px, unit}` for a distance and `{mean, min, max, sd, units}` for a
 * region. A distance taken with no PixelSpacing reports pixels and says so,
 * rather than presenting a pixel count as a millimetre figure.
 */
function measurementText(result) {
    if (!result) return null;
    if (Number.isFinite(result.mm)) return `${result.mm.toFixed(1)} mm`;
    if (Number.isFinite(result.px)) return `${result.px.toFixed(1)} px (no pixel spacing)`;
    if (Number.isFinite(result.mean)) {
        const units = result.units && result.units !== 'US' ? ` ${result.units}` : '';
        return `mean ${result.mean.toFixed(1)}${units}`;
    }
    return null;
}
