/**
 * The analytics vocabulary — Radoyon's half of the RPS-1 `vocabulary` slot.
 *
 * Shaped exactly as the standard consumes it (`{ severity, category }` keyed by
 * verb) so the package never restates its own vocabulary in a second format for
 * the host's benefit.
 *
 * The verbs are chosen to answer questions a radiology educator actually asks,
 * not to log everything that moves. "Did they scroll the whole stack before
 * reporting?" and "did they ever open a bone window?" are assessable; "mouse
 * moved" is not. Every verb here is something a tutor could put in a rubric.
 */

export const RADOYON_ROOM = 'pacs';

export const RADOYON_OBJECT_TYPES = Object.freeze({
    STUDY: 'imaging_study',
    SERIES: 'imaging_series',
    IMAGE: 'imaging_image',
    MEASUREMENT: 'imaging_measurement',
    REPORT: 'imaging_report',
});

export const RADOYON_COMPONENTS = Object.freeze({
    WORKLIST: 'RadoyonWorklist',
    VIEWPORT: 'RadoyonViewport',
    REPORT: 'RadoyonReport',
});

export const RADOYON_VERB_METADATA = Object.freeze({
    OPENED_STUDY: { severity: 'INFO', category: 'CLINICAL' },
    CLOSED_STUDY: { severity: 'INFO', category: 'CLINICAL' },
    SELECTED_SERIES: { severity: 'INFO', category: 'CLINICAL' },

    // Scrolling is the act of reading a volume. Logged as a completed sweep
    // rather than per slice: a per-slice event on a 300-slice CT would put
    // thousands of rows in learning_events for one study and drown every other
    // signal in the case.
    SCROLLED_SERIES: { severity: 'INFO', category: 'CLINICAL' },
    REVIEWED_SERIES: { severity: 'INFO', category: 'CLINICAL' },

    // Windowing is diagnostic behaviour. Reading a chest CT without ever
    // opening a lung window is a finding about the learner.
    CHANGED_WINDOW: { severity: 'INFO', category: 'CLINICAL' },
    APPLIED_PRESET: { severity: 'INFO', category: 'CLINICAL' },

    MEASURED_DISTANCE: { severity: 'INFO', category: 'CLINICAL' },
    MEASURED_REGION: { severity: 'INFO', category: 'CLINICAL' },

    DRAFTED_REPORT: { severity: 'INFO', category: 'CLINICAL' },
    SUBMITTED_REPORT: { severity: 'INFO', category: 'CLINICAL' },

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
    // See tests/conformance.test.js, which pins both lists.
    FAILED_TO_LOAD: { severity: 'IMPORTANT', category: 'ERROR' },
});

export const RADOYON_VERBS = Object.freeze(
    Object.fromEntries(Object.keys(RADOYON_VERB_METADATA).map((verb) => [verb, verb])),
);
