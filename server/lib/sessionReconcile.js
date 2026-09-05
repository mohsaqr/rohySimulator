/**
 * Reconcile the two event stores for one session.
 *
 * `patient_record_events` is the narrative encounter record — eight verbs
 * (OBTAINED, EXAMINED, …) written by the client's PatientRecord service and
 * read by the discussant. `learning_events` is the analytics stream. They
 * are written by different code paths, so a clinical act can reach one and
 * not the other without anything noticing. This module answers, per record
 * verb, whether learning_events holds a counterpart, by COUNT: a per-event
 * join would need an id the record store does not carry (`event_id` is the
 * client's, `time_elapsed` is relative seconds), and "did N exam findings
 * produce N PERFORMED_PHYSICAL_EXAM rows" is the question that matters.
 *
 * Pure. Historical learning verbs are read through the alias map first.
 */
import { normalizeVerb } from '../shared/learningVerbs.js';

/** Record verb → the canonical learning verbs that should accompany it. */
export const RECORD_VERB_EXPECTATIONS = Object.freeze({
    OBTAINED: ['VIEWED_RECORD', 'RECORDED_HISTORY', 'SENT_MESSAGE'],
    EXAMINED: ['PERFORMED_PHYSICAL_EXAM'],
    ELICITED: ['SENT_MESSAGE', 'RECEIVED_MESSAGE', 'PERFORMED_PHYSICAL_EXAM'],
    NOTED: ['VIEWED_RESULT', 'RELEASED_RESULT'],
    ORDERED: ['ORDERED_LAB', 'ORDERED_IMAGING', 'ORDERED_TREATMENT'],
    ADMINISTERED: ['ADMINISTERED_TREATMENT'],
    CHANGED: ['ADJUSTED_VITAL', 'DISCONTINUED_TREATMENT', 'ACKNOWLEDGED_ALARM', 'SILENCED_ALARM'],
    EXPRESSED: ['EXPRESSED_EMOTION'],
});

/**
 * @param {Array<{verb:string}>} learningRows   rows from learning_events
 * @param {Array<{verb:string}>} recordRows     rows from patient_record_events
 * @returns {{complete: boolean,
 *            byVerb: Record<string, {record:number, learning:number, missing:number, expects:string[]}>,
 *            missingTotal: number,
 *            learningTotal: number,
 *            recordTotal: number}}
 */
export function reconcileSession(learningRows, recordRows) {
    const learningCounts = new Map();
    for (const row of learningRows || []) {
        const v = normalizeVerb(row?.verb);
        if (!v) continue;
        learningCounts.set(v, (learningCounts.get(v) || 0) + 1);
    }
    const recordCounts = new Map();
    for (const row of recordRows || []) {
        const v = row?.verb;
        if (!v) continue;
        recordCounts.set(v, (recordCounts.get(v) || 0) + 1);
    }

    const byVerb = {};
    let missingTotal = 0;
    for (const [recordVerb, expects] of Object.entries(RECORD_VERB_EXPECTATIONS)) {
        const record = recordCounts.get(recordVerb) || 0;
        if (record === 0) continue;
        const learning = expects.reduce((n, v) => n + (learningCounts.get(v) || 0), 0);
        const missing = Math.max(0, record - learning);
        missingTotal += missing;
        byVerb[recordVerb] = { record, learning, missing, expects };
    }
    // A record verb outside the eight is a schema violation upstream; surface
    // it rather than ignore it.
    for (const [recordVerb, record] of recordCounts) {
        if (!(recordVerb in RECORD_VERB_EXPECTATIONS)) {
            byVerb[recordVerb] = { record, learning: 0, missing: record, expects: [] };
            missingTotal += record;
        }
    }

    return {
        complete: missingTotal === 0,
        byVerb,
        missingTotal,
        learningTotal: (learningRows || []).length,
        recordTotal: (recordRows || []).length,
    };
}
