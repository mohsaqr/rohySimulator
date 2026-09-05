/**
 * Learning-event FACETS — the enums every analytics consumer reads a verb
 * through, and the two functions that complete and validate a facet row.
 *
 * Why this file exists. Until v3.0.0-beta.10 a verb's meaning was spread over
 * five hand-written maps that had never heard of each other: the server's TNA
 * merge map, the client's clinical-state fallbacks, the seven activity lenses,
 * the cohort "pulse" substring matcher and the room-label table. Each grew its
 * own verb list, each fell behind the others, and a plugin verb that reached
 * one of them missed the other four — so an entire ECG session rendered as
 * one flat "Other" node in the clinical-action lens while resolving correctly
 * in the clinical-state lens next to it.
 *
 * The fix is structural, not a patch: a verb declares its facets ONCE, in the
 * registry (server/shared/learningVerbs.js for rohy's own verbs, a plugin's
 * manifest for its own), and every consumer derives its map from that row.
 * The enums below are the closed vocabularies those facets draw from; the
 * completeness test (tests/server/event-facets.test.js) asserts that no
 * registered verb falls through to a default bucket in ANY consumer.
 *
 * Data only. No imports from src/, no React, no DB — this module is imported
 * by both the client and the server, like server/shared/time.js.
 */

// --- Column enums (mirror the CHECK constraints on learning_events, 0001) ---

export const SEVERITIES = ['DEBUG', 'INFO', 'ACTION', 'IMPORTANT', 'CRITICAL'];
export const CATEGORIES = [
    'SESSION', 'NAVIGATION', 'CLINICAL', 'COMMUNICATION',
    'MONITORING', 'CONFIGURATION', 'ASSESSMENT', 'ERROR',
];

// --- Analytics enums ---------------------------------------------------------

/**
 * Clinical states — the simulator-domain analogue of LAILA's learning states,
 * shaped by "what part of the clinical reasoning loop is the trainee in".
 *
 *   assessing     — taking in patient information (record review, history,
 *                   lab results once they're back)
 *   examining     — physical exam findings, body-region interactions
 *   investigating — ordering labs / imaging / studies
 *   treating      — ordering / administering meds, fluids, oxygen, nursing
 *   communicating — chat with the patient, family, consultant agents
 *   documenting   — writing clinical notes / progress notes / debrief notes
 *   monitoring    — watching vitals, adjusting monitor, acknowledging alarms
 *   regulating    — session control (start/end/resume), case loading,
 *                   scenario stepping, settings
 *   reflecting    — emotional pulse, debrief, post-case discussion
 *   navigating    — opening drawers / tabs / panels (intent-neutral UI moves)
 *   studying      — consuming didactic material outside the encounter:
 *                   lectures, videos, surveys, help articles. Added with the
 *                   facet registry because the lessons room had no bucket and
 *                   every row it wrote landed in `navigating`.
 */
export const CLINICAL_STATES = [
    'assessing', 'examining', 'investigating', 'treating', 'communicating',
    'documenting', 'monitoring', 'regulating', 'reflecting', 'navigating',
    'studying',
];

/** The clinical-action lens: concrete activities, finer than a state. */
export const CLINICAL_ACTIONS = [
    'History', 'Examining', 'Ordering', 'Reading results', 'Treating',
    'Monitoring', 'Communicating', 'Consulting', 'Debriefing', 'Documenting',
    'Studying', 'Session', 'Navigating',
];

/** The medical-domain lens: a strict coarsening of clinical-action. */
export const MEDICAL_DOMAINS = [
    'Assessment', 'Diagnostics', 'Therapeutics', 'Monitoring',
    'Communication', 'Reflection', 'Documentation', 'Education', 'Administration',
];

/**
 * TNA merge targets — what a verb collapses to when the server builds
 * transition sequences. `null` (allowed on a facet row, not listed here) means
 * "drop the event from sequences": session control, config, heartbeats.
 */
export const TNA_BUCKETS = [
    'NAVIGATION', 'ORDERED_LAB', 'VIEWED_RESULT', 'TREATMENT', 'EXAMINATION',
    'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'CONSULTED_AGENT', 'MONITORING',
    'ALARM_RESPONSE', 'REVIEWED_RECORDS', 'DOCUMENTED', 'MEDIA',
];

/** Course-pulse buckets (the educator dashboard's activity mix). */
export const PULSE_BUCKETS = [
    'Debrief', 'Communication', 'Investigations', 'Assessment',
    'Orders & treatment', 'Lessons', 'Navigation',
];

/** Who produces a verb. Drives the emitter-coverage test; `planned` verbs
 *  must say why in `emitterNote` so the list cannot quietly grow. */
export const EMITTERS = ['client', 'server', 'plugin', 'system', 'planned'];

// --- Derivation tables -------------------------------------------------------

/** Domain is always a coarsening of action, so the two lenses cannot disagree. */
export const ACTION_TO_DOMAIN = Object.freeze({
    History: 'Assessment',
    Examining: 'Assessment',
    'Reading results': 'Assessment',
    Ordering: 'Diagnostics',
    Treating: 'Therapeutics',
    Monitoring: 'Monitoring',
    Communicating: 'Communication',
    Consulting: 'Communication',
    Debriefing: 'Reflection',
    Documenting: 'Documentation',
    Studying: 'Education',
    Session: 'Administration',
    Navigating: 'Administration',
});

/** Same argument for the cohort pulse: derived from action unless overridden. */
export const ACTION_TO_PULSE = Object.freeze({
    History: 'Assessment',
    Examining: 'Assessment',
    Ordering: 'Investigations',
    'Reading results': 'Investigations',
    Treating: 'Orders & treatment',
    Monitoring: 'Assessment',
    Communicating: 'Communication',
    Consulting: 'Communication',
    Debriefing: 'Debrief',
    Documenting: 'Debrief',
    Studying: 'Lessons',
    Session: 'Navigation',
    Navigating: 'Navigation',
});

/** Default TNA target per state. Overridden per verb where the historical
 *  merge map said otherwise (alarm acks → ALARM_RESPONSE, results →
 *  VIEWED_LAB_RESULT, judgement/heartbeat verbs → null). */
export const STATE_TO_TNA = Object.freeze({
    assessing: 'REVIEWED_RECORDS',
    examining: 'EXAMINATION',
    investigating: 'ORDERED_LAB',
    treating: 'TREATMENT',
    communicating: 'SENT_MESSAGE',
    documenting: 'DOCUMENTED',
    monitoring: 'MONITORING',
    regulating: null,
    reflecting: 'DOCUMENTED',
    navigating: 'NAVIGATION',
    studying: 'MEDIA',
});

/** Default action per state — what a v1 plugin manifest (severity, category
 *  and a verbFallback only) gets until it ships facets of its own. */
export const STATE_TO_ACTION = Object.freeze({
    assessing: 'Reading results',
    examining: 'Examining',
    investigating: 'Ordering',
    treating: 'Treating',
    communicating: 'Communicating',
    documenting: 'Documenting',
    monitoring: 'Monitoring',
    regulating: 'Session',
    reflecting: 'Debriefing',
    navigating: 'Navigating',
    studying: 'Studying',
});

/** The five facets every row must declare; the rest derive. */
export const REQUIRED_FACETS = ['severity', 'category', 'clinicalState', 'action', 'label', 'emitter'];

/** Title-case an UPPER_SNAKE verb as a readable fallback ("FOO_BAR" → "Foo bar"). */
export function humanizeVerb(verb) {
    if (!verb) return 'Unknown';
    const s = String(verb).toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Fill the derived facets of one row and freeze it.
 *
 * `tnaMerge` is the one derived field where an EXPLICIT null is meaningful
 * ("drop from sequences"), so the check is `'tnaMerge' in partial`, not
 * `partial.tnaMerge != null`.
 *
 * @param {string} verb
 * @param {object} partial  at least the REQUIRED_FACETS (action/label may be
 *                          omitted for a plugin row — they default from state)
 * @returns {Readonly<object>} the completed row
 */
export function completeFacets(verb, partial) {
    const p = partial || {};
    const clinicalState = p.clinicalState;
    const action = p.action ?? STATE_TO_ACTION[clinicalState];
    const row = {
        severity: p.severity,
        category: p.category,
        clinicalState,
        action,
        label: p.label ?? humanizeVerb(verb),
        emitter: p.emitter ?? 'plugin',
        domain: p.domain ?? ACTION_TO_DOMAIN[action],
        tnaMerge: Object.prototype.hasOwnProperty.call(p, 'tnaMerge') ? p.tnaMerge : STATE_TO_TNA[clinicalState],
        pulseBucket: p.pulseBucket ?? ACTION_TO_PULSE[action],
    };
    if (p.emitterNote !== undefined) row.emitterNote = p.emitterNote;
    if (p.severityByObjectType !== undefined) row.severityByObjectType = Object.freeze({ ...p.severityByObjectType });
    return Object.freeze(row);
}

/**
 * Validate a COMPLETED facet row. Throws with the offending verb and field so
 * a manifest author, or a rohy developer editing the registry, is told what
 * to fix rather than watching an analytics screen mislabel rows later.
 *
 * @param {string} verb
 * @param {object} facets  output of completeFacets
 * @param {string} [source='rohy']  who declared the verb (for the message)
 * @returns {object} the same row, for chaining
 */
export function validateFacets(verb, facets, source = 'rohy') {
    const where = `${source} verb ${verb}`;
    const check = (field, allowed, allowNull = false) => {
        const value = facets[field];
        if (value === null && allowNull) return;
        if (value === undefined || !allowed.includes(value)) {
            throw new Error(
                `${where} declares ${field} '${value}'; it must be one of ${allowed.join(', ')}`
                + (allowNull ? ' or null' : '')
            );
        }
    };
    check('severity', SEVERITIES);
    check('category', CATEGORIES);
    check('clinicalState', CLINICAL_STATES);
    check('action', CLINICAL_ACTIONS);
    check('domain', MEDICAL_DOMAINS);
    check('tnaMerge', TNA_BUCKETS, true);
    check('pulseBucket', PULSE_BUCKETS);
    check('emitter', EMITTERS);
    if (typeof facets.label !== 'string' || facets.label.trim() === '') {
        throw new Error(`${where} has no label — the fine-grained lens would show a humanized verb instead of a curated one`);
    }
    if (facets.emitter === 'planned' && !facets.emitterNote) {
        throw new Error(`${where} is 'planned' without an emitterNote saying what UI would emit it`);
    }
    if (facets.severityByObjectType) {
        Object.entries(facets.severityByObjectType).forEach(([objectType, severity]) => {
            if (!SEVERITIES.includes(severity)) {
                throw new Error(`${where} declares severityByObjectType.${objectType} = '${severity}'; it must be one of ${SEVERITIES.join(', ')}`);
            }
        });
    }
    return facets;
}
