// Server-built situation blocks for the two knowledge scopes the browser is
// not trusted to assemble: `none` and `handover`.
//
// WHY THE SERVER BUILDS THESE. For every other scope the browser assembles
// the case context and posts it as the situation. That is tolerable when the
// agent is meant to know the case anyway. It is not tolerable here: the whole
// point of `none` is that the agent knows only what the LEARNER TELLS IT, and
// a block assembled by the learner's own browser is precisely the thing that
// cannot be trusted to withhold anything. So the route drops the client text
// and calls into this module instead — the same move, for the same reason, as
// the specialist path (services/specialistBrief.js, proxy-routes.js).
//
// WHAT THE HANDOVER MAY CONTAIN. Three things, and no more: who the patient
// is, one line on why they presented, and the last recorded observations.
// Extraction is an explicit ALLOW list of fields, so a field added to a case
// document later is private by default — the same discipline as
// extractFindings. Notably absent: the history, the exam, any result, and
// anything from `### Authoring Expectations`. A nurse coming on shift is
// handed a patient, not a workup.
//
// WHAT IS NOT HERE. "What has been done this session" is deliberately NOT
// rendered here even though it belongs in a handover: it is already rendered,
// server-side and from rows the server read itself, by
// services/encounterRecord.js, and it arrives as its own block in the
// assembled prompt. Duplicating it would put two accounts of the same events
// in one prompt. `config.knowledge.record` is what decides whether that block
// is present; for the nurse it ships on.
//
// Pure builders take already-loaded values and never throw on malformed
// input: case documents are authored by hand, and a bad shape must cost the
// brief a line, not the learner a reply.

import dbAdapter from '../dbAdapter.js';
import { resolveSessionCaseConfig } from '../routes/_helpers.js';

export const UNBRIEFED_HEADER = '## WHAT YOU KNOW (server)';
export const HANDOVER_HEADER = '## HANDOVER (server)';

// The anti-back-fill block. A model handed a thin context will cheerfully
// invent a rich one — it will decide the patient is 60, has chest pain, and
// has already had an ECG, because that is what a case like this usually looks
// like. The wording below is deliberately repetitive and closes each escape
// route by name; it follows BRIEF_NO_PATIENT in specialistBrief.js, which was
// written against the same failure and holds.
export const BRIEF_UNBRIEFED = [
    'You have not seen this patient and nobody has briefed you on them. You do not know their name, '
        + 'their age, their sex, their symptoms, their history, why they presented, what has been '
        + 'ordered, or what any result showed.',
    'Everything you know about this patient is what the person you are speaking to tells you in this '
        + 'conversation. Nothing else.',
    'If you were not told something, you do not know it. Ask for it. Never fill a gap with what a case '
        + 'like this usually looks like, and never repeat back a detail as though you already had it.',
    'If you are asked about something you have not been told, say plainly that you have not been told '
        + 'it, and ask them for it.',
].join('\n');

export const HANDOVER_LEAD = 'You have just come on shift and been handed this patient at the bedside. '
    + 'You did not care for them before now.';

// Closes the handover the same way BRIEF_UNBRIEFED closes the empty one: the
// list above is exhaustive, and silence is absence rather than an invitation.
export const HANDOVER_LIMITS = 'That is the whole handover you were given. You do not know their past '
    + 'history, what was sent, or what any result showed unless it appears above or you are told it in '
    + 'this conversation. If you were not told something, say so and ask rather than assuming it.';

export const HANDOVER_NO_DETAILS = 'You were handed no details about this patient at all beyond their '
    + 'presence in the bed.';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Text from a column that may legitimately hold a NUMBER. `cases.patient_age`
// is INTEGER and `demographics.age` is authored free-text, so a string-only
// clean silently dropped every numeric age.
const cleanText = (value) => {
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

// A finite number, or null.
//
// The explicit null/undefined/'' guard is load-bearing, NOT belt-and-braces:
// `Number(null)` is 0 and `Number('')` is 0, both of which are finite. Without
// it an unrecorded EtCO2 was handed to the agent as "EtCO2 0 mmHg" — a vital
// sign incompatible with life, invented out of a NULL column. Same family as
// the `configuredMinSec || 60` incident in docs/design/agent-behaviour-model.md
// §9: a falsy-or-empty value coerced into a meaningful one.
const num = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * Identity, reason for presentation and case config, for one session.
 *
 * Prefers the session's frozen `case_snapshot` for the config, so an educator
 * editing the case mid-session does not change what the agent was handed.
 * The identity COLUMNS are read from the live case row because the snapshot
 * does not carry them (it holds case_id, name, system_prompt, config,
 * scenario only — sessions-routes.js), so the config is the authority where
 * it has an answer and the columns are the fallback.
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number} args.tenant
 * @returns {Promise<{config: object, patient: object, reason: string}|null>}
 */
export async function loadHandoverCaseData({ sessionId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT s.case_snapshot, c.config, c.patient_name, c.patient_age, c.patient_gender,
                c.chief_complaint
           FROM sessions s
           JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    if (!row) return null;
    const config = resolveSessionCaseConfig(row);
    const cfg = isObject(config) ? config : {};
    const demo = isObject(cfg.demographics) ? cfg.demographics : {};
    const structured = isObject(cfg.structuredHistory) ? cfg.structuredHistory : {};
    return {
        config: cfg,
        patient: {
            name: cleanText(cfg.patient_name) || cleanText(row.patient_name),
            age: cleanText(demo.age) || cleanText(row.patient_age),
            gender: cleanText(demo.gender) || cleanText(row.patient_gender),
        },
        reason: cleanText(structured.chiefComplaint) || cleanText(row.chief_complaint),
    };
}

/**
 * The most recently recorded observations for a session.
 *
 * `session_vitals` is written by the monitor on a deadband crossing
 * (PatientMonitor.jsx), not as a raw feed, so the newest row is a real recent
 * snapshot rather than a sample of noise. Reading it here is what lets a
 * handover carry LIVE vitals without trusting the browser's situation text.
 *
 * @returns {Promise<object|null>} the row, or null when nothing was recorded
 */
export async function latestVitals({ sessionId, tenant }) {
    return dbAdapter.get(
        `SELECT hr, rhythm, spo2, bp_sys, bp_dia, rr, temp, etco2
           FROM session_vitals
          WHERE session_id = ? AND tenant_id = ?
          ORDER BY id DESC LIMIT 1`,
        [sessionId, tenant]
    );
}

/**
 * One line of observations, or '' when nothing is recorded.
 *
 * Units are spelled out because the agent speaks them aloud; a bare "91" is
 * read by a model as a number to reason about rather than a saturation.
 *
 * @param {object|null} row  a session_vitals row
 * @returns {string}
 */
export function formatVitals(row) {
    if (!isObject(row)) return '';
    const sys = num(row.bp_sys);
    const dia = num(row.bp_dia);
    const parts = [
        num(row.hr) !== null ? `HR ${num(row.hr)}/min` : '',
        cleanText(row.rhythm) ? `rhythm ${cleanText(row.rhythm)}` : '',
        sys !== null && dia !== null ? `BP ${sys}/${dia} mmHg` : '',
        num(row.spo2) !== null ? `SpO2 ${num(row.spo2)}%` : '',
        num(row.rr) !== null ? `RR ${num(row.rr)}/min` : '',
        num(row.temp) !== null ? `temp ${num(row.temp)} C` : '',
        num(row.etco2) !== null ? `EtCO2 ${num(row.etco2)} mmHg` : '',
    ].filter(Boolean);
    return parts.join(', ');
}

/**
 * The block for `scope: 'none'` — the agent knows nothing.
 *
 * Goes in the same prompt slot as a specialist's CASE BRIEF, so it lands
 * after the educator's persona and its dos/donts and before any client text.
 * An educator cannot write a "do" that argues with it and have it read last.
 *
 * @returns {string}
 */
export function buildUnbriefedBlock() {
    return [UNBRIEFED_HEADER, BRIEF_UNBRIEFED].join('\n');
}

/**
 * The block for `scope: 'handover'`.
 *
 * Shape:
 *   ## HANDOVER (server)
 *   You have just come on shift ...
 *   Patient: <name>, <age>, <gender>.
 *   Reason for admission: <chief complaint>.
 *   Last recorded observations: HR .., BP ../.., SpO2 ..%.
 *   That is the whole handover you were given. ...
 *
 * Every detail line is optional; a case with none of them still produces a
 * coherent block, because the limits line is what does the pedagogical work.
 *
 * @param {object} args
 * @param {object} [args.patient]  {name, age, gender}
 * @param {string} [args.reason]   the reason for presentation
 * @param {string} [args.vitals]   formatVitals() output
 * @returns {string}
 */
export function buildHandoverBrief({ patient, reason, vitals } = {}) {
    const who = isObject(patient) ? patient : {};
    const identity = [
        cleanText(who.name),
        cleanText(who.age) ? `${cleanText(who.age)} years old` : '',
        cleanText(who.gender),
    ].filter(Boolean).join(', ');

    const details = [
        identity ? `Patient: ${identity}.` : '',
        cleanText(reason) ? `Reason for admission: ${cleanText(reason)}.` : '',
        cleanText(vitals) ? `Last recorded observations: ${cleanText(vitals)}.` : '',
    ].filter(Boolean);

    return [
        HANDOVER_HEADER,
        HANDOVER_LEAD,
        ...(details.length ? details : [HANDOVER_NO_DETAILS]),
        HANDOVER_LIMITS,
    ].join('\n');
}
