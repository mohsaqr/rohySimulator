/**
 * Pathology event vocabulary — the structured-log contract.
 *
 * WHY this file exists as ADDITIVE constants rather than an edit to Rohy's
 * eventLogger.js: the pathology module must be removable. Everything here is
 * merged into Rohy's existing VERBS / OBJECT_TYPES / COMPONENTS at wire-up
 * time (see INTEGRATION.md, step 2). Delete the folder and Rohy's own
 * vocabulary is untouched — no diff to revert.
 *
 * Every verb below is NEW. None collides with Rohy's existing vocabulary;
 * `tests/vocabulary.test.js` asserts that against a snapshot of Rohy's verbs,
 * so a future Rohy release that adds `VIEWED_SLIDE` fails the test instead of
 * silently shadowing this one.
 *
 * The rows land in the SAME learning_events table as every other Rohy event.
 * That is the whole point: a pathology read and a lab order sit in one
 * sequence, so TNA can show the transition between them.
 */

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

export const PATHOLOGY_COMPONENTS = {
    PATHOLOGY_ROOM: 'PathologyRoom',
    SLIDE_CANVAS: 'SlideCanvas',
    REPORT_PANEL: 'ReportPanel',
    SPECIMEN_TRAY: 'SpecimenTray',
    SLIDE_EMBED: 'SlideEmbed',
};

// Rohy's room keys are lowercase ('chat', 'examination', 'lab', 'radiology',
// 'consultant', 'lessons') and are compared with === in App.jsx's ROOM_KEYS
// and persisted into learning_events.room. 'Pathology' would not match.
export const PATHOLOGY_ROOM = 'pathology';

/**
 * Severity/category for each new verb, in Rohy's own two enums.
 *
 * Rationale for the DEBUG rows: a slide read emits a viewport sample roughly
 * every 400 ms. At INFO those would drown the activity feed and the audit
 * trail. DEBUG keeps them out of the feed while still persisting them for the
 * read-path reconstruction, which is the same treatment Rohy gives SCROLLED.
 */
export const PATHOLOGY_VERB_METADATA = {
    OPENED_SLIDE: { severity: 'IMPORTANT', category: 'CLINICAL' },
    CLOSED_SLIDE: { severity: 'INFO', category: 'CLINICAL' },
    PANNED_SLIDE: { severity: 'DEBUG', category: 'CLINICAL' },
    ZOOMED_SLIDE: { severity: 'DEBUG', category: 'CLINICAL' },
    CHANGED_OBJECTIVE: { severity: 'INFO', category: 'CLINICAL' },
    DWELLED_REGION: { severity: 'DEBUG', category: 'CLINICAL' },
    REACHED_ROI: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
    MISSED_ROI: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
    ANNOTATED_SLIDE: { severity: 'ACTION', category: 'CLINICAL' },
    MEASURED_SLIDE: { severity: 'ACTION', category: 'CLINICAL' },
    COUNTED_FEATURE: { severity: 'ACTION', category: 'CLINICAL' },
    EXPORTED_ANNOTATIONS: { severity: 'ACTION', category: 'CLINICAL' },
    VIEWED_SPECIMEN: { severity: 'INFO', category: 'CLINICAL' },
    OPENED_PLATE: { severity: 'INFO', category: 'CLINICAL' },
    SAVED_REPORT: { severity: 'ACTION', category: 'ASSESSMENT' },
    SUBMITTED_DIAGNOSIS: { severity: 'CRITICAL', category: 'ASSESSMENT' },
    REVISED_DIAGNOSIS: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
    SIGNED_REPORT: { severity: 'CRITICAL', category: 'ASSESSMENT' },
    REQUESTED_SECOND_OPINION: { severity: 'IMPORTANT', category: 'COMMUNICATION' },
    STARTED_SLIDE_TASK: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
    COMPLETED_SLIDE_TASK: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
    REQUESTED_HINT: { severity: 'ACTION', category: 'ASSESSMENT' },
    RECEIVED_FEEDBACK: { severity: 'INFO', category: 'ASSESSMENT' },
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
    // `room` is deliberately absent: the eventLogger singleton stamps it from
    // setContext({room}) on every log() call, so passing it per event would be
    // dead weight at best and a conflicting second source of truth at worst.
    // The room is set once, by the navigator, via EventLogger.roomChanged().
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
        roiReached: (roi, { dwellMs, objective, timeToReachMs }) => emit(
            PATHOLOGY_VERBS.REACHED_ROI, PATHOLOGY_OBJECT_TYPES.SLIDE_ROI,
            {
                objectId: roi.id,
                objectName: roi.label,
                durationMs: dwellMs,
                result: roi.critical ? 'critical_roi_reached' : 'roi_reached',
                context: { objective, minObjective: roi.minObjective, timeToReachMs, critical: !!roi.critical },
            },
        ),

        roiMissed: (roi, reason) => emit(
            PATHOLOGY_VERBS.MISSED_ROI, PATHOLOGY_OBJECT_TYPES.SLIDE_ROI,
            {
                objectId: roi.id,
                objectName: roi.label,
                result: reason,
                context: { minObjective: roi.minObjective, critical: !!roi.critical },
            },
        ),

        diagnosisSubmitted: (task, submission, score) => emit(
            PATHOLOGY_VERBS.SUBMITTED_DIAGNOSIS, PATHOLOGY_OBJECT_TYPES.PATHOLOGY_REPORT,
            {
                objectId: task.id,
                objectName: task.prompt,
                result: score.correct ? 'correct' : 'incorrect',
                durationMs: score.elapsedMs,
                component: PATHOLOGY_COMPONENTS.REPORT_PANEL,
                context: {
                    answer: submission.diagnosis,
                    expected: task.answerKey?.diagnosis,
                    readScore: score.readScore,
                    roiCoverage: score.roiCoverage,
                },
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
                objectName: report.title,
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
                objectName: report.title,
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
            { objectId: task.id, objectName: task.prompt, result: `hint_${hintIndex}`, component: PATHOLOGY_COMPONENTS.REPORT_PANEL },
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
        annotationDrawn: (annotation, measurement, slide) => emit(
            ANNOTATION_VERB_BY_KIND[annotation.kind] ?? PATHOLOGY_VERBS.ANNOTATED_SLIDE,
            ANNOTATION_OBJECT_TYPE_BY_KIND[annotation.kind] ?? PATHOLOGY_OBJECT_TYPES.SLIDE_ANNOTATION,
            {
                objectId: annotation.id,
                objectName: annotation.text || annotation.classification?.name || annotation.kind,
                result: annotation.classification?.name ?? 'unclassified',
                component: PATHOLOGY_COMPONENTS.SLIDE_CANVAS,
                context: {
                    slideId: slide?.id ?? annotation.slideId,
                    kind: annotation.kind,
                    classification: annotation.classification?.name ?? null,
                    vertices: annotation.points.length,
                    bounds: annotation.points,
                    lengthUm: measurement?.lengthUm ?? null,
                    areaMm2: measurement?.areaMm2 ?? null,
                },
            },
        ),

        // Emitted on every increment, not once at the end. The SEQUENCE is the
        // signal: a count that arrives in one burst at the end of the read was
        // not counted field by field.
        featureCounted: (frame, measurement, slide) => emit(
            PATHOLOGY_VERBS.COUNTED_FEATURE, PATHOLOGY_OBJECT_TYPES.SLIDE_ANNOTATION,
            {
                objectId: frame.id,
                objectName: frame.text || 'counting frame',
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
