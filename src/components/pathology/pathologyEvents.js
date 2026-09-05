/**
 * Pathology event vocabulary — the structured-log contract.
 *
 * WHY this file exists as ADDITIVE constants rather than an edit to Rohy's
 * eventLogger.js: the pathology module must be removable. A host folds this
 * vocabulary in through its plugin manifest (RPS-1 §3.1); delete the folder
 * and the host's own vocabulary is untouched — no diff to revert.
 *
 * Every verb below is NEW. None collides with Rohy's existing vocabulary;
 * `tests/vocabulary.test.js` asserts that against Rohy's registry when the
 * sibling checkout is present, so a future Rohy release that adds
 * `VIEWED_SLIDE` fails the test instead of silently shadowing this one.
 *
 * `vocabulary.version: 2` (RPS-1 1.6, R33): every verb declares its full
 * facet row — severity, category, clinical state, action, label — so a host
 * labels pathology rows in every analytics lens without guessing. The state
 * map in pathologyStates.js derives from it.
 *
 * The rows land in the SAME learning_events table as every other Rohy event.
 * That is the whole point: a pathology read and a lab order sit in one
 * sequence, so TNA can show the transition between them.
 *
 * WHAT NEVER GOES IN A ROW: learner prose and the answer key. A report body,
 * an annotation's free text, the expected diagnosis — none of it. The event
 * stream is a record of working behaviour; the host already holds the
 * documents, and a copy in an analytics table is a second, unmanaged store of
 * exactly the material a learner must never receive.
 */

/** RPS-1 vocabulary contract version this package declares (1.6, R33). */
export const PATHOLOGY_VOCABULARY_VERSION = 2;

/** Every component name starts with this (RPS-1 R34). */
export const PATHOLOGY_COMPONENT_PREFIX = 'Pathology';

export const PATHOLOGY_VERBS = {
    // --- Slide lifecycle -------------------------------------------------
    OPENED_SLIDE: 'OPENED_SLIDE',
    CLOSED_SLIDE: 'CLOSED_SLIDE',
    // --- Reading behaviour (the process signal) --------------------------
    // PANNED/ZOOMED are DEBUG-severity and heavily throttled; they exist for
    // the read-path reconstruction, not for the activity feed.
    PANNED_SLIDE: 'PANNED_SLIDE',
    ZOOMED_SLIDE: 'ZOOMED_SLIDE',
    CHANGED_OBJECTIVE: 'CHANGED_OBJECTIVE',
    DWELLED_REGION: 'DWELLED_REGION',
    REACHED_ROI: 'REACHED_ROI',
    MISSED_ROI: 'MISSED_ROI',
    // --- Deliberate acts on the slide ------------------------------------
    ANNOTATED_SLIDE: 'ANNOTATED_SLIDE',
    MEASURED_SLIDE: 'MEASURED_SLIDE',
    COUNTED_FEATURE: 'COUNTED_FEATURE',
    // Handing the annotation set to another tool (QuPath, a script, a
    // marking rubric) is a deliberate act with a learner-visible artefact,
    // so it earns a row rather than hiding inside an ANNOTATED_SLIDE result.
    EXPORTED_ANNOTATIONS: 'EXPORTED_ANNOTATIONS',
    // --- Gross / macroscopic ---------------------------------------------
    VIEWED_SPECIMEN: 'VIEWED_SPECIMEN',
    OPENED_PLATE: 'OPENED_PLATE',
    // --- Reporting --------------------------------------------------------
    // A draft save is its own act, distinct from signing out. A reader who
    // saves four times over an hour and signs once has a visible working
    // pattern; collapsing both into SIGNED_REPORT would erase it, and would
    // also make an unfinished draft indistinguishable from a final opinion.
    SAVED_REPORT: 'SAVED_REPORT',
    SUBMITTED_DIAGNOSIS: 'SUBMITTED_DIAGNOSIS',
    REVISED_DIAGNOSIS: 'REVISED_DIAGNOSIS',
    SIGNED_REPORT: 'SIGNED_REPORT',
    REQUESTED_SECOND_OPINION: 'REQUESTED_SECOND_OPINION',
    // --- Guided teaching --------------------------------------------------
    STARTED_SLIDE_TASK: 'STARTED_SLIDE_TASK',
    COMPLETED_SLIDE_TASK: 'COMPLETED_SLIDE_TASK',
    REQUESTED_HINT: 'REQUESTED_HINT',
    RECEIVED_FEEDBACK: 'RECEIVED_FEEDBACK',
};

export const PATHOLOGY_OBJECT_TYPES = {
    SLIDE: 'slide',
    SLIDE_REGION: 'slide_region',
    SLIDE_ROI: 'slide_roi',
    SLIDE_ANNOTATION: 'slide_annotation',
    SLIDE_MEASUREMENT: 'slide_measurement',
    SPECIMEN: 'specimen',
    SPECIMEN_PLATE: 'specimen_plate',
    PATHOLOGY_REPORT: 'pathology_report',
    SLIDE_TASK: 'slide_task',
};

// Prefixed (R34) so a row says which package's canvas it came from: a host
// with an imaging viewer and a slide viewer must not see two `Canvas`es.
export const PATHOLOGY_COMPONENTS = {
    PATHOLOGY_ROOM: 'PathologyRoom',
    SLIDE_CANVAS: 'PathologySlideCanvas',
    REPORT_PANEL: 'PathologyReportPanel',
    SPECIMEN_TRAY: 'PathologySpecimenTray',
    SLIDE_EMBED: 'PathologySlideEmbed',
};

// Rohy's room keys are lowercase ('chat', 'examination', 'lab', 'radiology',
// 'consultant', 'lessons') and are compared with === in App.jsx's ROOM_KEYS
// and persisted into learning_events.room. 'Pathology' would not match.
export const PATHOLOGY_ROOM = 'pathology';

/**
 * The clinical state of "looking at tissue". In pathology the low-power screen
 * followed by high-power confirmation IS the examination — the direct analogue
 * of palpating a body region — so it is 'examining', not 'navigating'. Isolated
 * so a future 'screening' state is a one-token change (see pathologyStates.js).
 */
export const PATHOLOGY_SCREENING_STATE = 'examining';

const INTAKE = Object.freeze({ clinicalState: 'assessing', action: 'Reading results' });
const SCREEN = Object.freeze({ clinicalState: PATHOLOGY_SCREENING_STATE, action: 'Examining' });
const DOCUMENT = Object.freeze({ clinicalState: 'documenting', action: 'Documenting' });
const REFLECT = Object.freeze({ clinicalState: 'reflecting', action: 'Debriefing' });
const CONSULT = Object.freeze({ clinicalState: 'communicating', action: 'Consulting' });
const TASK = Object.freeze({ clinicalState: 'regulating', action: 'Session' });

/**
 * The facet row per verb (RPS-1 1.6, R33), in Rohy's own enums.
 *
 * Rationale for the DEBUG rows: a slide read emits a viewport sample roughly
 * every 400 ms. At INFO those would drown the activity feed and the audit
 * trail. DEBUG keeps them out of the feed while still persisting them for the
 * read-path reconstruction, which is the same treatment Rohy gives SCROLLED.
 * They are also THROTTLED at the source (viewportEvents.js): one row per
 * settled pan or zoom, never per animation frame.
 *
 * Three verbs have no surface and say so with `emitter: 'planned'` rather
 * than pretending: the diagnosis box was replaced by the report (a reader
 * writes a report and signs it; SIGNED_REPORT is the committed opinion), and
 * there is no second-opinion channel yet. A host's emission gate (R36)
 * exempts a planned verb and prints its note.
 */
export const PATHOLOGY_VERB_METADATA = {
    OPENED_SLIDE: { severity: 'IMPORTANT', category: 'CLINICAL', ...INTAKE, label: 'Opened slide' },
    CLOSED_SLIDE: { severity: 'INFO', category: 'CLINICAL', ...INTAKE, label: 'Closed slide' },
    PANNED_SLIDE: { severity: 'DEBUG', category: 'CLINICAL', ...SCREEN, label: 'Panned slide' },
    ZOOMED_SLIDE: { severity: 'DEBUG', category: 'CLINICAL', ...SCREEN, label: 'Zoomed slide' },
    CHANGED_OBJECTIVE: { severity: 'INFO', category: 'CLINICAL', ...SCREEN, label: 'Changed objective' },
    DWELLED_REGION: { severity: 'DEBUG', category: 'CLINICAL', ...SCREEN, label: 'Dwelled on region' },
    REACHED_ROI: { severity: 'IMPORTANT', category: 'ASSESSMENT', ...SCREEN, label: 'Reached key region' },
    MISSED_ROI: { severity: 'IMPORTANT', category: 'ASSESSMENT', ...SCREEN, label: 'Missed key region' },
    ANNOTATED_SLIDE: { severity: 'ACTION', category: 'CLINICAL', ...DOCUMENT, label: 'Annotated slide' },
    MEASURED_SLIDE: { severity: 'ACTION', category: 'CLINICAL', ...SCREEN, label: 'Measured on slide' },
    COUNTED_FEATURE: { severity: 'ACTION', category: 'CLINICAL', ...SCREEN, label: 'Counted features' },
    EXPORTED_ANNOTATIONS: { severity: 'ACTION', category: 'CLINICAL', ...DOCUMENT, label: 'Exported annotations' },
    VIEWED_SPECIMEN: { severity: 'INFO', category: 'CLINICAL', ...SCREEN, label: 'Viewed specimen' },
    OPENED_PLATE: { severity: 'INFO', category: 'CLINICAL', ...SCREEN, label: 'Opened gross plate' },
    SAVED_REPORT: { severity: 'ACTION', category: 'ASSESSMENT', ...DOCUMENT, label: 'Saved report draft' },
    SUBMITTED_DIAGNOSIS: {
        severity: 'CRITICAL', category: 'ASSESSMENT', ...DOCUMENT, label: 'Submitted diagnosis',
        emitter: 'planned',
        emitterNote: 'The diagnosis box was replaced by the signed report (SIGNED_REPORT); a host with a structured diagnosis field would emit this.',
    },
    REVISED_DIAGNOSIS: {
        severity: 'IMPORTANT', category: 'ASSESSMENT', ...DOCUMENT, label: 'Revised diagnosis',
        emitter: 'planned',
        emitterNote: 'Pairs with SUBMITTED_DIAGNOSIS; no structured diagnosis field exists in the room today.',
    },
    SIGNED_REPORT: { severity: 'CRITICAL', category: 'ASSESSMENT', ...DOCUMENT, label: 'Signed report' },
    REQUESTED_SECOND_OPINION: {
        severity: 'IMPORTANT', category: 'COMMUNICATION', ...CONSULT, label: 'Requested second opinion',
        emitter: 'planned',
        emitterNote: 'No consultation channel exists in the room; a host that pages a consultant from the slide would emit this.',
    },
    STARTED_SLIDE_TASK: { severity: 'IMPORTANT', category: 'ASSESSMENT', ...TASK, label: 'Started slide task' },
    COMPLETED_SLIDE_TASK: { severity: 'IMPORTANT', category: 'ASSESSMENT', ...TASK, label: 'Completed slide task' },
    REQUESTED_HINT: { severity: 'ACTION', category: 'ASSESSMENT', ...REFLECT, label: 'Requested hint' },
    RECEIVED_FEEDBACK: { severity: 'INFO', category: 'ASSESSMENT', ...REFLECT, label: 'Received read feedback' },
};

/**
 * Which verb an annotation kind is reported under.
 *
 * Anything absent falls through to ANNOTATED_SLIDE, so adding a new drawing
 * tool cannot produce an unlogged act — the worst case is that it is reported
 * as a generic annotation until it earns its own row here.
 */
const ANNOTATION_VERB_BY_KIND = {
    line: 'MEASURED_SLIDE',
    arrow: 'MEASURED_SLIDE',
    // A curvilinear length is a MEASUREMENT, not an outline. Reporting it as a
    // generic annotation would hide depth-of-invasion and margin-distance
    // measurements from anything counting how often a reader measures.
    polyline: 'MEASURED_SLIDE',
    counting_frame: 'COUNTED_FEATURE',
};

const ANNOTATION_OBJECT_TYPE_BY_KIND = {
    line: 'slide_measurement',
    arrow: 'slide_measurement',
    polyline: 'slide_measurement',
};

/** A task's name for a row: its id-ish title, never the prompt's prose. */
function taskName(task) {
    return task?.title ?? task?.label ?? (task?.id ? `task ${task.id}` : 'task');
}

/** The numbers of a read score, without the per-region labels. */
function readShape(score = {}) {
    return {
        readScore: score.readScore ?? null,
        roiCoverage: score.roiCoverage ?? null,
        slideCoverage: score.slideCoverage ?? null,
        roiReached: score.roiReached ?? null,
        roiTotal: score.roiTotal ?? null,
        maxObjective: score.maxObjective ?? null,
        totalTimeMs: score.totalTimeMs ?? null,
    };
}

/**
 * Where the viewport was, as numbers a tutor's dashboard can plot: the
 * visible rectangle in SLIDE (level-0) pixels — see slideGeometry.js
 * viewportSample() — the objective, and the read clock.
 */
function regionShape(sample = {}) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
    return {
        x: num(sample.x), y: num(sample.y), w: num(sample.w), h: num(sample.h),
        objective: sample.objective ?? null,
        t: num(sample.t),
    };
}

/** Bounding box of level-0 points, in microns, or null when uncalibrated. */
function bboxUm(points, slide) {
    const mpp = slide?.nativeMpp;
    if (!Array.isArray(points) || points.length === 0 || !(mpp > 0)) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const round = (v) => Math.round(v * mpp);
    return { x: round(minX), y: round(minY), w: round(maxX - minX), h: round(maxY - minY) };
}

/**
 * Bind the vocabulary to Rohy's eventLogger singleton.
 *
 * The logger is INJECTED, never imported. That is what lets this package be
 * unit-tested inside Path/ with a recording fake, and what keeps it free of a
 * hard dependency on Rohy's module graph.
 *
 * @param {{log: Function}} logger  Rohy's eventLogger (or any {log(payload)}).
 * @returns {object} emit helpers, one per meaningful pathology act.
 */
export function createPathologyLogger(logger) {
    if (!logger || typeof logger.log !== 'function') {
        throw new TypeError(
            'createPathologyLogger(logger): expected Rohy eventLogger with a .log() method, received '
            + (logger === null ? 'null' : typeof logger),
        );
    }

    // Single choke point, matching Rohy's real signature:
    //   log(verb, objectType, options)   — three positional args, camelCase
    //                                      options, NOT a payload object.
    //
    // `room` is deliberately absent: the host stamps it (rohy stamps
    // `room = pluginId` on every plugin row through ctx.log), so passing it
    // per event would be dead weight at best and a conflicting second source
    // of truth at worst.
    //
    // severity/category are passed EXPLICITLY rather than relying on Rohy's
    // VERB_METADATA lookup. getVerbMetadata() falls back to INFO/NAVIGATION for
    // an unknown verb without complaining, so a forgotten metadata merge would
    // silently mislabel every pathology event as navigation. Passing them here
    // makes that merge an optional nicety instead of a silent failure mode.
    const emit = (verb, objectType, fields = {}) => {
        const meta = PATHOLOGY_VERB_METADATA[verb];
        if (!meta) {
            throw new RangeError(
                `emit(): '${verb}' is not in PATHOLOGY_VERB_METADATA. `
                + 'Add it there (with severity + category) before emitting it, '
                + 'or the analytics layer will bucket it as a literal.',
            );
        }
        return logger.log(verb, objectType, {
            objectId: fields.objectId ?? null,
            objectName: fields.objectName ?? null,
            component: fields.component ?? PATHOLOGY_COMPONENTS.PATHOLOGY_ROOM,
            parentComponent: PATHOLOGY_COMPONENTS.PATHOLOGY_ROOM,
            result: fields.result ?? null,
            durationMs: fields.durationMs ?? null,
            context: fields.context ?? null,
            severity: meta.severity,
            category: meta.category,
        });
    };

    return {
        emit,

        slideOpened: (slide) => emit(
            PATHOLOGY_VERBS.OPENED_SLIDE, PATHOLOGY_OBJECT_TYPES.SLIDE,
            {
                objectId: slide.id,
                objectName: slide.label,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: { stain: slide.stain, nativeObjective: slide.nativeObjective, mpp: slide.mpp },
            },
        ),

        slideClosed: (slide, durationMs) => emit(
            PATHOLOGY_VERBS.CLOSED_SLIDE, PATHOLOGY_OBJECT_TYPES.SLIDE,
            { objectId: slide.id, objectName: slide.label, durationMs, component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS },
        ),

        objectiveChanged: (slide, fromObjective, toObjective) => emit(
            PATHOLOGY_VERBS.CHANGED_OBJECTIVE, PATHOLOGY_OBJECT_TYPES.SLIDE,
            {
                objectId: slide.id,
                objectName: slide.label,
                result: `${toObjective.toFixed(1)}x`,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: { from: fromObjective, to: toObjective },
            },
        ),

        // Emitted once per ROI, the first time the learner actually resolves
        // it — not every time it crosses the viewport. `dwellMs` and
        // `objective` are what make this an assessment signal rather than a
        // navigation one.
        // An ROI's label names the FINDING ("invasive front"); that is the
        // answer key, and it never goes in a row the learner's browser sends.
        // The id is what a tutor's dashboard joins on.
        roiReached: (roi, { dwellMs, objective, timeToReachMs }) => emit(
            PATHOLOGY_VERBS.REACHED_ROI, PATHOLOGY_OBJECT_TYPES.SLIDE_ROI,
            {
                objectId: roi.id,
                objectName: roi.critical ? 'critical region' : 'key region',
                durationMs: dwellMs,
                result: roi.critical ? 'critical_roi_reached' : 'roi_reached',
                context: { objective, minObjective: roi.minObjective, timeToReachMs, critical: !!roi.critical },
            },
        ),

        roiMissed: (roi, reason) => emit(
            PATHOLOGY_VERBS.MISSED_ROI, PATHOLOGY_OBJECT_TYPES.SLIDE_ROI,
            {
                objectId: roi.id,
                objectName: roi.critical ? 'critical region' : 'key region',
                result: reason,
                context: { minObjective: roi.minObjective, critical: !!roi.critical },
            },
        ),

        // Planned (no structured diagnosis field today). Carries the VERDICT
        // and the read score — never the learner's answer, and never the
        // expected one: `context.answer` / `context.expected` used to put the
        // answer key into a row the learner's own browser had just sent.
        diagnosisSubmitted: (task, submission, score) => emit(
            PATHOLOGY_VERBS.SUBMITTED_DIAGNOSIS, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: task.id,
                objectName: taskName(task),
                result: score.correct ? 'correct' : 'incorrect',
                durationMs: score.elapsedMs,
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: {
                    correct: !!score.correct,
                    readScore: score.readScore ?? null,
                    roiCoverage: score.roiCoverage ?? null,
                    answerLength: String(submission?.diagnosis ?? '').trim().length,
                },
            },
        ),

        // Planned, like diagnosisSubmitted: the pair exists so a host with a
        // structured diagnosis field has the helpers ready.
        diagnosisRevised: (task, submission, score = {}) => emit(
            PATHOLOGY_VERBS.REVISED_DIAGNOSIS, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: task.id,
                objectName: taskName(task),
                result: score.correct == null ? null : (score.correct ? 'correct' : 'incorrect'),
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: { correct: score.correct ?? null, answerLength: String(submission?.diagnosis ?? '').trim().length },
            },
        ),
        // Planned: no consultation channel in the room yet.
        secondOpinionRequested: (task, { to = null } = {}) => emit(
            PATHOLOGY_VERBS.REQUESTED_SECOND_OPINION, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: task?.id ?? null,
                objectName: taskName(task),
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: { to },
            },
        ),

        // --- the task around the read -------------------------------------
        taskStarted: (task) => emit(
            PATHOLOGY_VERBS.STARTED_SLIDE_TASK, PATHOLOGY_OBJECT_TYPES.SLIDE_TASK,
            {
                objectId: task.id,
                objectName: taskName(task),
                context: { slides: task.slides ?? null, hints: Array.isArray(task.hints) ? task.hints.length : 0 },
            },
        ),
        taskCompleted: (task, score = {}) => emit(
            PATHOLOGY_VERBS.COMPLETED_SLIDE_TASK, PATHOLOGY_OBJECT_TYPES.SLIDE_TASK,
            {
                objectId: task.id,
                objectName: taskName(task),
                durationMs: score.totalTimeMs ?? null,
                result: score.readScore == null ? 'completed' : `read_${Math.round(score.readScore * 100)}`,
                context: readShape(score),
            },
        ),
        // The read feedback panel was shown. `context` is what it showed —
        // the numbers, not the missed-region labels, which name findings.
        feedbackReceived: (task, score = {}) => emit(
            PATHOLOGY_VERBS.RECEIVED_FEEDBACK, PATHOLOGY_OBJECT_TYPES.SLIDE_TASK,
            {
                objectId: task?.id ?? null,
                objectName: taskName(task),
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: readShape(score),
            },
        ),

        // A draft save. Deliberately carries the SHAPE of the report — how
        // long it is, how many findings it cites — and not its prose: the
        // event stream is a record of working behaviour, not a second copy of
        // the document, which the host already has.
        reportSaved: (report) => emit(
            PATHOLOGY_VERBS.SAVED_REPORT, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: report.id,
                objectName: 'report',
                result: report.status,
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: {
                    words: report.body.trim().split(/\s+/).filter(Boolean).length,
                    findings: report.findings.length,
                    hasTitle: report.title.trim().length > 0,
                },
            },
        ),

        // Signing out. `score` carries the READ assessment — how the slide was
        // examined — which is the whole reason this package exists and is
        // independent of anything written in the report.
        reportSubmitted: (report, score = {}) => emit(
            PATHOLOGY_VERBS.SIGNED_REPORT, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: report.id,
                objectName: 'report',
                result: 'submitted',
                durationMs: score.elapsedMs ?? null,
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: {
                    words: report.body.trim().split(/\s+/).filter(Boolean).length,
                    findings: report.findings.length,
                    readScore: score.readScore ?? null,
                    roiCoverage: score.roiCoverage ?? null,
                    slideCoverage: score.slideCoverage ?? null,
                },
            },
        ),

        hintRequested: (task, hintIndex) => emit(
            PATHOLOGY_VERBS.REQUESTED_HINT, PATHOLOGY_OBJECT_TYPES.SLIDE_TASK,
            { objectId: task.id, objectName: taskName(task), result: `hint_${hintIndex}`, component: PATHOLOGY_COMPONENTS.REPORT_PANEL },
        ),

        // --- reading behaviour (throttled at the source, see viewportEvents.js)
        slidePanned: (slide, sample) => emit(
            PATHOLOGY_VERBS.PANNED_SLIDE, PATHOLOGY_OBJECT_TYPES.SLIDE_REGION,
            {
                objectId: slide?.id ?? sample?.slideId ?? null,
                objectName: slide?.label ?? null,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: regionShape(sample),
            },
        ),
        slideZoomed: (slide, sample, { from, to }) => emit(
            PATHOLOGY_VERBS.ZOOMED_SLIDE, PATHOLOGY_OBJECT_TYPES.SLIDE_REGION,
            {
                objectId: slide?.id ?? sample?.slideId ?? null,
                objectName: slide?.label ?? null,
                result: `${Number(to).toFixed(1)}x`,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: { ...regionShape(sample), from, to },
            },
        ),
        regionDwelled: (slide, sample, durationMs) => emit(
            PATHOLOGY_VERBS.DWELLED_REGION, PATHOLOGY_OBJECT_TYPES.SLIDE_REGION,
            {
                objectId: slide?.id ?? sample?.slideId ?? null,
                objectName: slide?.label ?? null,
                durationMs,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: regionShape(sample),
            },
        ),

        // --- Deliberate acts on the slide --------------------------------
        //
        // The VERB is chosen by what was drawn, not by which button was
        // pressed: a ruler is a measurement, a counting frame is a count,
        // everything else is an annotation. That is what lets the analytics
        // layer separate "the reader measured something" from "the reader
        // outlined something" without parsing a context blob.
        //
        // The geometry is logged in SLIDE (level-0) coordinates and the
        // measurement in microns, so a row stays meaningful after the pyramid
        // is re-exported at a different level — a row carrying screen pixels
        // would be worthless the moment the archive changed.
        // The row names the annotation by its CLASS and kind, never by the
        // reader's free text; and it carries the bounding box in microns, not
        // every vertex — the geometry lives in the annotation store the host
        // persists, and a 400-vertex outline is not a learning event.
        annotationDrawn: (annotation, measurement, slide) => emit(
            ANNOTATION_VERB_BY_KIND[annotation.kind] ?? PATHOLOGY_VERBS.ANNOTATED_SLIDE,
            ANNOTATION_OBJECT_TYPE_BY_KIND[annotation.kind] ?? PATHOLOGY_OBJECT_TYPES.SLIDE_ANNOTATION,
            {
                objectId: annotation.id,
                objectName: annotation.classification?.name || annotation.kind,
                result: annotation.classification?.name ?? 'unclassified',
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: {
                    slideId: slide?.id ?? annotation.slideId,
                    kind: annotation.kind,
                    classification: annotation.classification?.name ?? null,
                    vertices: annotation.points.length,
                    bboxUm: bboxUm(annotation.points, slide),
                    hasText: Boolean(annotation.text),
                    lengthUm: measurement?.lengthUm ?? null,
                    areaMm2: measurement?.areaMm2 ?? null,
                },
            },
        ),

        // A GeoJSON import. The file name is the reader's own and can say
        // anything; the count is what matters.
        annotationsImported: (slide, count) => emit(
            PATHOLOGY_VERBS.ANNOTATED_SLIDE, PATHOLOGY_OBJECT_TYPES.SLIDE_ANNOTATION,
            {
                objectId: slide?.id ?? null,
                objectName: 'geojson import',
                result: `imported_${count}`,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: { slideId: slide?.id ?? null, source: 'geojson_import', count },
            },
        ),

        // Emitted on every increment, not once at the end. The SEQUENCE is the
        // signal: a count that arrives in one burst at the end of the read was
        // not counted field by field.
        featureCounted: (frame, measurement, slide) => emit(
            PATHOLOGY_VERBS.COUNTED_FEATURE, PATHOLOGY_OBJECT_TYPES.SLIDE_ANNOTATION,
            {
                objectId: frame.id,
                objectName: frame.classification?.name || 'counting frame',
                result: `${frame.tally}`,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: {
                    slideId: slide?.id ?? frame.slideId,
                    tally: frame.tally,
                    areaMm2: measurement?.areaMm2 ?? null,
                    // The WHO 5th-edition figure: per mm², not per 10 HPF.
                    perMm2: measurement?.perMm2 ?? null,
                    targetAreaMm2: frame.targetAreaMm2,
                },
            },
        ),

        annotationsExported: (slide, count) => emit(
            PATHOLOGY_VERBS.EXPORTED_ANNOTATIONS, PATHOLOGY_OBJECT_TYPES.SLIDE,
            {
                objectId: slide.id,
                objectName: slide.label,
                result: `${count}_annotations`,
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: { format: 'geojson', coordinateSpace: 'slide-level0-pixels', count },
            },
        ),

        // A specimen PART (the container: "Part A, left temporal lobe").
        specimenViewed: (specimen) => emit(
            PATHOLOGY_VERBS.VIEWED_SPECIMEN, PATHOLOGY_OBJECT_TYPES.SPECIMEN,
            {
                objectId: specimen.part,
                objectName: specimen.description,
                component: PATHOLOGY_COMPONENTS.SPECIMEN_TRAY,
                context: { dimensions: specimen.dimensions, weight: specimen.weight, plates: specimen.images?.length ?? 0 },
            },
        ),

        // One photographic PLATE within a part. scaleMm rides along because
        // without it no scale bar can be drawn and the measurement is unfounded.
        plateOpened: (plate, specimen) => emit(
            PATHOLOGY_VERBS.OPENED_PLATE, PATHOLOGY_OBJECT_TYPES.SPECIMEN_PLATE,
            {
                objectId: plate.id,
                objectName: plate.caption,
                component: PATHOLOGY_COMPONENTS.SPECIMEN_TRAY,
                context: { part: specimen?.part ?? null, scaleMm: plate.scaleMm ?? null },
            },
        ),
    };
}
