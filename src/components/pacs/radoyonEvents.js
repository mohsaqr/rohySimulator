/**
 * The analytics vocabulary — Radoyon's half of the RPS-1 `vocabulary` slot,
 * and the logger that emits it.
 *
 * Shaped exactly as the standard consumes it (a facet row keyed by verb) so the
 * package never restates its own vocabulary in a second format for the host's
 * benefit. `vocabulary.version: 2` (RPS-1 1.6, R33): every verb declares the
 * full row — severity, category, clinical state, action, label — so a host
 * labels these rows in every analytics lens without guessing.
 *
 * The verbs are chosen to answer questions a radiology educator actually asks,
 * not to log everything that moves. "Did they scroll the whole stack before
 * reporting?" and "did they ever open a bone window?" are assessable; "mouse
 * moved" is not. Every verb here is something a tutor could put in a rubric.
 *
 * THE CALL SHAPE. Radoyon 0.3 called `eventLogger.log({verb, objectType,
 * component, detail})` — one object — where rohy's logger takes three
 * positionals, `log(verb, objectType, options)`. The host accepted the object,
 * read `[object Object]` as the verb and rejected every PACS row it was ever
 * sent. `createRadoyonLogger()` is the fix: one choke point that speaks the
 * host's signature, passes severity and category explicitly, and names the
 * object (`objectId`, `objectName`) so a row is about a study, not a click.
 */

export const RADOYON_ROOM = 'pacs';

/** RPS-1 vocabulary contract version this package declares (R33). */
export const RADOYON_VOCABULARY_VERSION = 2;

/** Every component name starts with this (RPS-1 R34). */
export const RADOYON_COMPONENT_PREFIX = 'Radoyon';

// Keys carry the namespace as well as the values (RPS-1 1.6): a host that
// spreads several packages' object-type maps together must not see two
// `STUDY` keys with different meanings.
export const RADOYON_OBJECT_TYPES = Object.freeze({
    IMAGING_STUDY: 'imaging_study',
    IMAGING_SERIES: 'imaging_series',
    IMAGING_IMAGE: 'imaging_image',
    IMAGING_MEASUREMENT: 'imaging_measurement',
    IMAGING_REPORT: 'imaging_report',
});

export const RADOYON_COMPONENTS = Object.freeze({
    WORKLIST: 'RadoyonWorklist',
    VIEWPORT: 'RadoyonViewport',
    REPORT: 'RadoyonReport',
});

// Reading images is 'assessing' — what the host maps its own radiology reads
// to — and is the 'Reading results' action. Committing words to a report is
// 'documenting'. The distinction carries the teaching weight: a learner who
// goes straight from opening a study to filing a report never assessed
// anything, and that pattern is exactly what these states let analytics see.
const READING = Object.freeze({ clinicalState: 'assessing', action: 'Reading results' });
const REPORTING = Object.freeze({ clinicalState: 'documenting', action: 'Documenting' });

export const RADOYON_VERB_METADATA = Object.freeze({
    OPENED_STUDY: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Opened study' },
    CLOSED_STUDY: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Closed study' },
    SELECTED_SERIES: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Selected series' },

    // Scrolling is the act of reading a volume. Logged as a completed sweep
    // rather than per slice: a per-slice event on a 300-slice CT would put
    // thousands of rows in learning_events for one study and drown every other
    // signal in the case. REVIEWED_SERIES is the sweep that covered the whole
    // stack — the fact a rubric asks about.
    SCROLLED_SERIES: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Scrolled series' },
    REVIEWED_SERIES: { severity: 'ACTION', category: 'CLINICAL', ...READING, label: 'Reviewed whole series' },

    // Windowing is diagnostic behaviour. Reading a chest CT without ever
    // opening a lung window is a finding about the learner. A drag on the
    // window tool is logged once it settles, not per pixel of drag.
    CHANGED_WINDOW: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Changed window' },
    APPLIED_PRESET: { severity: 'INFO', category: 'CLINICAL', ...READING, label: 'Applied window preset' },

    MEASURED_DISTANCE: { severity: 'ACTION', category: 'CLINICAL', ...READING, label: 'Measured distance' },
    MEASURED_REGION: { severity: 'ACTION', category: 'CLINICAL', ...READING, label: 'Measured region' },

    DRAFTED_REPORT: { severity: 'INFO', category: 'CLINICAL', ...REPORTING, label: 'Drafted report' },
    SUBMITTED_REPORT: { severity: 'IMPORTANT', category: 'CLINICAL', ...REPORTING, label: 'Filed report' },

    // A study that would not load is recorded, never silently swallowed: from
    // the learner's side an unloadable study is indistinguishable from a normal
    // one, and grading them for missing a finding they were never shown would
    // be unjust. IMPORTANT/ERROR rather than a lower severity because this is
    // the row a tutor needs when a learner disputes a mark.
    //
    // The values are constrained by the host, not chosen freely: severity and
    // category are CHECK constraints on the learning_events table, so a verb
    // declaring anything outside those lists is accepted by JavaScript and then
    // dropped at INSERT — the worst possible failure for an analytics event.
    // See tests/conformance.test.js, which pins every list.
    FAILED_TO_LOAD: { severity: 'IMPORTANT', category: 'ERROR', ...READING, label: 'Study failed to load' },
});

export const RADOYON_VERBS = Object.freeze(
    Object.fromEntries(Object.keys(RADOYON_VERB_METADATA).map((verb) => [verb, verb])),
);

/** A series covered to this fraction of its images counts as reviewed. */
export const REVIEWED_COVERAGE = 0.95;

const words = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * What a report IS, never what it says.
 *
 * An event trail that copies the learner's prose becomes a second, unmanaged
 * store of it — the host already holds the report where it filed it. Length,
 * evidence and completeness are what analytics needs.
 *
 * @param {object} report  the composed report (see report.js)
 * @returns {{findingsWords:number, impressionWords:number, measurements:number, seriesOpened:number|null, seriesInStudy:number|null, coverage:number|null}}
 */
export function reportShape(report) {
    if (!report || typeof report !== 'object') {
        throw new TypeError('reportShape(report): report must be an object');
    }
    const evidence = report.evidence ?? {};
    return {
        findingsWords: words(report.findings),
        impressionWords: words(report.impression),
        measurements: Array.isArray(evidence.measurements) ? evidence.measurements.length : 0,
        seriesOpened: evidence.seriesOpened ?? null,
        seriesInStudy: evidence.seriesInStudy ?? null,
        coverage: evidence.coverage ?? null,
    };
}

/**
 * Bind the vocabulary to an injected host logger.
 *
 * The logger is INJECTED, never imported — which is what lets this package be
 * tested with a recording fake and what keeps it free of any host's module
 * graph. It needs exactly one thing: `log(verb, objectType, options)`, three
 * positionals, camelCase options. rohy's `ctx.log` is that; so is the
 * standalone app's sink.
 *
 * `room` is deliberately absent from every call: the host stamps it (rohy
 * stamps `room = pluginId` on every plugin row), and a second source of truth
 * would only ever disagree with the first.
 *
 * @param {{log: Function}|null|undefined} logger  the host's logger; absent → a no-op
 * @returns {object} `emit` plus one helper per meaningful act
 */
export function createRadoyonLogger(logger) {
    if (logger != null && typeof logger.log !== 'function') {
        throw new TypeError('createRadoyonLogger(logger): expected a logger with a .log(verb, objectType, options) method');
    }
    const sink = logger ?? { log: () => null };

    const emit = (verb, objectType, fields = {}) => {
        const meta = RADOYON_VERB_METADATA[verb];
        if (!meta) {
            throw new RangeError(`createRadoyonLogger: '${verb}' is not in RADOYON_VERB_METADATA — declare it (with its facets) before emitting it`);
        }
        return sink.log(verb, objectType, {
            objectId: fields.objectId == null ? null : String(fields.objectId),
            objectName: fields.objectName ?? null,
            component: fields.component ?? RADOYON_COMPONENTS.VIEWPORT,
            result: fields.result ?? null,
            durationMs: fields.durationMs ?? null,
            context: fields.context ?? null,
            // Explicit rather than left to the host's registry: a host that
            // has not merged this vocabulary would otherwise fall back to
            // INFO/NAVIGATION and mislabel every imaging row as navigation.
            severity: meta.severity,
            category: meta.category,
        });
    };

    const seriesFields = (series) => ({
        objectId: series?.seriesInstanceUid ?? series?.stackId ?? null,
        objectName: series?.description ?? null,
    });
    const pct = (coverage) => `${Math.round((coverage ?? 0) * 100)}%`;

    return {
        emit,

        studyOpened: (entry, { series = null } = {}) => emit(RADOYON_VERBS.OPENED_STUDY, RADOYON_OBJECT_TYPES.IMAGING_STUDY, {
            objectId: entry?.id, objectName: entry?.description,
            context: { studyId: entry?.studyId ?? null, accession: entry?.accession ?? null, modality: entry?.modality ?? null, series },
        }),
        studyClosed: (entry, durationMs) => emit(RADOYON_VERBS.CLOSED_STUDY, RADOYON_OBJECT_TYPES.IMAGING_STUDY, {
            objectId: entry?.id, objectName: entry?.description, durationMs,
            context: { studyId: entry?.studyId ?? null },
        }),
        seriesSelected: (series) => emit(RADOYON_VERBS.SELECTED_SERIES, RADOYON_OBJECT_TYPES.IMAGING_SERIES, {
            ...seriesFields(series),
            context: { images: series?.count ?? null, plane: series?.plane ?? null },
        }),
        // The sweep on leaving a series: how much of the stack was seen.
        seriesScrolled: (series, { imagesSeen, coverage }) => emit(RADOYON_VERBS.SCROLLED_SERIES, RADOYON_OBJECT_TYPES.IMAGING_SERIES, {
            ...seriesFields(series),
            result: pct(coverage),
            context: { imagesSeen, imagesTotal: series?.count ?? null, coverage },
        }),
        seriesReviewed: (series, { imagesSeen, coverage }) => emit(RADOYON_VERBS.REVIEWED_SERIES, RADOYON_OBJECT_TYPES.IMAGING_SERIES, {
            ...seriesFields(series),
            result: pct(coverage),
            context: { imagesSeen, imagesTotal: series?.count ?? null, coverage },
        }),
        windowChanged: (series, window) => emit(RADOYON_VERBS.CHANGED_WINDOW, RADOYON_OBJECT_TYPES.IMAGING_SERIES, {
            ...seriesFields(series),
            result: window ? `C${Math.round(window.center)}/W${Math.round(window.width)}` : null,
            context: window ? { center: window.center, width: window.width } : null,
        }),
        presetApplied: (preset, series = null) => emit(RADOYON_VERBS.APPLIED_PRESET, RADOYON_OBJECT_TYPES.IMAGING_SERIES, {
            objectId: preset?.id, objectName: preset?.label ?? preset?.id,
            result: preset?.id ?? null,
            context: { center: preset?.center ?? null, width: preset?.width ?? null, seriesUid: series?.seriesInstanceUid ?? null },
        }),
        distanceMeasured: (measurement) => emit(RADOYON_VERBS.MEASURED_DISTANCE, RADOYON_OBJECT_TYPES.IMAGING_MEASUREMENT, {
            objectId: measurement?.id, objectName: 'distance',
            result: measurement?.result?.mm == null ? null : `${Number(measurement.result.mm).toFixed(1)} ${measurement.result.unit ?? 'mm'}`,
            context: { mm: measurement?.result?.mm ?? null, unit: measurement?.result?.unit ?? null, slice: measurement?.slice ?? null },
        }),
        regionMeasured: (measurement) => emit(RADOYON_VERBS.MEASURED_REGION, RADOYON_OBJECT_TYPES.IMAGING_MEASUREMENT, {
            objectId: measurement?.id, objectName: 'region',
            result: measurement?.result?.mean == null ? null : `mean ${Number(measurement.result.mean).toFixed(0)}`,
            context: { mean: measurement?.result?.mean ?? null, sd: measurement?.result?.sd ?? null, slice: measurement?.slice ?? null },
        }),
        reportDrafted: (report) => emit(RADOYON_VERBS.DRAFTED_REPORT, RADOYON_OBJECT_TYPES.IMAGING_REPORT, {
            objectId: report?.study?.studyId ?? report?.study?.id ?? null, objectName: 'report',
            component: RADOYON_COMPONENTS.REPORT,
            context: reportShape(report ?? {}),
        }),
        reportSubmitted: (report) => emit(RADOYON_VERBS.SUBMITTED_REPORT, RADOYON_OBJECT_TYPES.IMAGING_REPORT, {
            objectId: report?.study?.studyId ?? report?.study?.id ?? null, objectName: 'report',
            component: RADOYON_COMPONENTS.REPORT,
            result: 'filed',
            context: reportShape(report ?? {}),
        }),
        loadFailed: (ref, error) => emit(RADOYON_VERBS.FAILED_TO_LOAD, RADOYON_OBJECT_TYPES.IMAGING_STUDY, {
            objectId: ref, objectName: null,
            result: 'failed',
            context: { reason: error?.message ?? String(error ?? 'unknown') },
        }),
    };
}
