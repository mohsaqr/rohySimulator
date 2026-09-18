// On-call specialists: the server-side case brief and the reply guard.
//
// A specialist (pathologist, cardiologist, radiologist, laboratorian;
// server/shared/specialties.js) is NOT a consultant. Each one has read ONE
// ROOM'S MATERIAL — the slides, the tracing, the images, the analyser run —
// and knows nothing else. What it is told, and when, is decided HERE, on the
// server, from the case document — never from a client-built prompt, which
// the learner's browser would hold (LEARNINGS 2026-09-17, "the proxy trusts
// client system_prompt").
//
// Three rules shape every function below:
//   1. FINDINGS are what the material shows; they may be discussed once the
//      disclosure gate opens. DIAGNOSES are the answer key (pathology
//      diagnosis.expected/accept, ECG accepted_diagnoses/rhythm/rationale,
//      radiology impression/interpretation, the case's own diagnosis); they
//      never enter the brief. Extraction is an explicit ALLOW list of fields,
//      so a field added to a document later is private by default.
//   2. SYMPTOMS, history and the patient's story never enter the brief
//      either. The specialist read the material, not the patient. This is why
//      there is no case summary here: an earlier version led the brief with
//      patient name, age, sex and CHIEF COMPLAINT, which is a symptom.
//      Findings alone are the whole brief.
//   3. The model can still name a diagnosis from the findings alone, so
//      non-streaming replies pass through guardSpecialistReply, which drops
//      any sentence naming a known answer term.
//
// Pure functions take already-parsed JSON and never throw on malformed input:
// case documents are authored by hand and by third-party packages, and a bad
// shape must cost the brief a finding, not the learner a reply.

import dbAdapter from '../dbAdapter.js';
import { resolveSessionCaseConfig } from '../routes/_helpers.js';

/** Sent when the guard removed every sentence of a reply. */
export const GUARD_FALLBACK_REPLY = "What do you make of it yourself? Tell me what you've seen and what supports it.";

export const BRIEF_HEADER = '## CASE BRIEF (server)';
export const BRIEF_FINDINGS_LEAD = 'Findings you may share or confirm when the student asks or describes them:';
// Follows the scope line, which already says the material has been reviewed —
// so this one does not repeat it.
export const BRIEF_WITHHELD = 'Do not describe specific findings yet. '
    + 'Ask what the student has looked at and what they saw, and teach them how to look.';
export const BRIEF_NO_FINDINGS = 'No findings were provided for this case; do not invent any.';
export const BRIEF_NO_DIAGNOSIS = 'Never name or hint at a diagnosis, even if asked directly; '
    + 'ask what they think and what supports it.';
export const BRIEF_ON_REQUEST = 'Share a finding only when the student asks about it.';
// The scope line. Says what the specialist has and, just as importantly, what
// it does not: no patient, no symptoms, no history. Without it a model briefed
// only on findings still happily invents a presentation to hang them on.
export const BRIEF_NO_PATIENT = 'You have not seen the patient and know nothing about them: '
    + 'not their symptoms, not their history, not why they presented, not what else has been done. '
    + 'If the student asks about any of that, say you only have the material in front of you, '
    + 'and ask what THEY found.';

// What each domain's specialist has in front of them, for the scope line.
// A domain without an entry here still gets a brief; it just reads generically.
const MATERIAL_LABELS = Object.freeze({
    pathology: 'the pathology material for this case',
    ecg: 'the ECG tracing(s) for this case',
    radiology: 'the imaging for this case',
    laboratory: 'the laboratory results for this case',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const arrayOf = (value) => (Array.isArray(value) ? value : []);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The case material a specialist is briefed from, for one session.
 *
 * Prefers the session's frozen `case_snapshot` over the live `cases.config`
 * (resolveSessionCaseConfig), so an educator editing the case mid-session does
 * not change what the specialist knows.
 *
 * Only the config is returned. The live case row's patient_name /
 * patient_age / patient_gender / chief_complaint columns were also read here
 * once, to build a patient summary for the brief; that summary is gone (see
 * rule 2 in the module header), so reading them would be reading the
 * patient's symptoms for no purpose.
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number} args.tenant
 * @returns {Promise<{config: object}|null>} null when the session is not in
 *   this tenant or its case is gone.
 */
export async function loadSpecialistCaseData({ sessionId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT s.case_snapshot, c.config
           FROM sessions s
           JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    if (!row) return null;
    const config = resolveSessionCaseConfig(row);
    return { config: isObject(config) ? config : {} };
}

/**
 * How many messages the learner has sent this agent in the session, across
 * chat and call channels. The client stores the learner's turn BEFORE calling
 * the proxy, so the count includes the message being answered.
 *
 * @returns {Promise<number>}
 */
export async function countStudentTurns({ sessionId, tenant, agentType }) {
    const row = await dbAdapter.get(
        `SELECT COUNT(*) AS n FROM agent_conversations
          WHERE session_id = ? AND tenant_id = ? AND agent_type = ? AND role = 'user'`,
        [sessionId, tenant, agentType]
    );
    return Number(row?.n) || 0;
}

/**
 * Has the learner done anything in the room(s) whose material this specialist
 * read? Answers `requireRoomActivity`.
 *
 * Reads `learning_events.room`, which every in-session event carries since
 * migration 0021 — not a specific verb. "Opened the ECG room and did nothing"
 * and "measured six intervals" both count as having gone and looked, which is
 * the effort the gate is asking about; judging how MUCH they did there is not
 * something a boolean can express.
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number} args.tenant
 * @param {string[]} args.roomKeys  specialties.roomKeysOf()
 * @returns {Promise<boolean>} false when roomKeys is empty — a specialty that
 *   owns no room can never satisfy the gate, so the gate must not be enabled
 *   for it (none exist today; every SPECIALTIES entry owns a room).
 */
export async function hasRoomActivity({ sessionId, tenant, roomKeys }) {
    const keys = arrayOf(roomKeys).filter((k) => typeof k === 'string' && k);
    if (keys.length === 0) return false;
    const placeholders = keys.map(() => '?').join(', ');
    const row = await dbAdapter.get(
        `SELECT 1 AS hit FROM learning_events
          WHERE session_id = ? AND tenant_id = ? AND room IN (${placeholders})
          LIMIT 1`,
        [sessionId, tenant, ...keys]
    );
    return Boolean(row);
}

// ---------------------------------------------------------------------------
// Extraction (pure)
// ---------------------------------------------------------------------------

// `findings: [{ id, text, roiId? }]` on each rubric activity. Only `text` is
// read; an entry without non-empty string text is skipped.
function activityFindings(document, sourcePrefix) {
    if (!isObject(document) || !isObject(document.rubric)) return [];
    return arrayOf(document.rubric.activities).flatMap((activity, index) => {
        if (!isObject(activity)) return [];
        const source = `${sourcePrefix} ${cleanText(activity.activityId) || cleanText(activity.activity_id) || index + 1}`;
        return arrayOf(activity.findings)
            .filter(isObject)
            .map((finding) => cleanText(finding.text))
            .filter(Boolean)
            .map((text) => ({ text, source }));
    });
}

function radiologyFindings(config) {
    const pacs = isObject(config.pacs)
        ? arrayOf(config.pacs.worklist).flatMap((entry) => {
            if (!isObject(entry) || !isObject(entry.report)) return [];
            const text = cleanText(entry.report.findings);
            return text ? [{ text, source: cleanText(entry.description) || 'PACS study' }] : [];
        })
        : [];
    const legacy = arrayOf(config.radiology).flatMap((study) => {
        if (!isObject(study)) return [];
        const text = cleanText(study.findings);
        return text ? [{ text, source: cleanText(study.studyName) || 'Radiology study' }] : [];
    });
    return [...pacs, ...legacy];
}

// `investigations.labs[]` — the analyser's own output. A lab finding IS the
// result line, so the value, its unit, the reference interval and the
// abnormal flag are rendered into `text`; a test with no value has not been
// resulted and is skipped rather than reported as blank.
//
// Nothing here is interpretive: `preset` ('high'/'normal' — the authoring
// shortcut), `normal_samples` (decoy values for other learners) and
// `turnaround_minutes` (a simulation timing, not a result) are not read.
function laboratoryFindings(config) {
    const labs = isObject(config.investigations) ? config.investigations.labs : null;
    return arrayOf(labs).flatMap((lab) => {
        if (!isObject(lab)) return [];
        const name = cleanText(lab.test_name);
        const value = lab.current_value;
        if (!name || value === null || value === undefined || value === '') return [];
        const unit = cleanText(lab.unit);
        const low = lab.min_value;
        const high = lab.max_value;
        const hasRange = Number.isFinite(Number(low)) && Number.isFinite(Number(high));
        const notes = [
            hasRange ? `reference ${low}-${high}${unit ? ` ${unit}` : ''}` : '',
            lab.is_abnormal === true ? 'abnormal' : '',
        ].filter(Boolean);
        const text = `${name} = ${value}${unit ? ` ${unit}` : ''}${notes.length ? ` (${notes.join(', ')})` : ''}`;
        return [{ text, source: cleanText(lab.test_group) || 'Laboratory' }];
    });
}

/**
 * The findings a specialist may discuss, for its domain.
 *
 * Reads ONLY: pathology/ECG `rubric.activities[].findings[].text`; PACS
 * `worklist[].report.findings`; legacy `radiology[].findings`; laboratory
 * `investigations.labs[]` result values with their reference intervals.
 * Impression, interpretation, diagnosis, rationale and rhythm are never read.
 *
 * @param {'pathology'|'ecg'|'radiology'|'laboratory'} domain
 * @param {object} config  parsed case config
 * @returns {{text: string, source: string}[]}
 */
export function extractFindings(domain, config) {
    if (!isObject(config)) return [];
    if (domain === 'pathology') return activityFindings(config.pathology, 'Activity');
    if (domain === 'ecg') return activityFindings(config.ecg, 'Activity');
    if (domain === 'radiology') return radiologyFindings(config);
    if (domain === 'laboratory') return laboratoryFindings(config);
    return [];
}

const humanise = (value) => cleanText(typeof value === 'string' ? value.replace(/_/g, ' ') : '');

/**
 * Terms that name the answer and must never appear in a specialist's reply.
 *
 * - pathology: every activity's diagnosis.expected + diagnosis.accept[]
 * - ecg: every activity's expected.accepted_diagnoses[], plus the humanised
 *   expected.rhythm label when it is more than one word ("atrial fibrillation"
 *   yes, "sinus" no — a one-word rhythm would censor ordinary teaching)
 * - radiology: none in v1. PACS report.impression and legacy interpretation
 *   are free prose; turning a whole impression into a phrase would never
 *   match, and splitting it into words would censor everything. Add terms
 *   here when a structured radiology diagnosis field exists.
 * - every domain: the case-level config.diagnosis / config.expected_diagnosis
 *   (the field buildDiscussionCaseContext reads as "Expected diagnosis").
 *
 * @returns {string[]} unique, trimmed, original casing
 */
export function extractAnswerTerms(domain, config) {
    if (!isObject(config)) return [];
    const terms = [];
    if (domain === 'pathology' && isObject(config.pathology) && isObject(config.pathology.rubric)) {
        arrayOf(config.pathology.rubric.activities).filter(isObject).forEach((activity) => {
            if (!isObject(activity.diagnosis)) return;
            terms.push(cleanText(activity.diagnosis.expected));
            arrayOf(activity.diagnosis.accept).forEach((accepted) => terms.push(cleanText(accepted)));
        });
    }
    if (domain === 'ecg' && isObject(config.ecg) && isObject(config.ecg.rubric)) {
        arrayOf(config.ecg.rubric.activities).filter(isObject).forEach((activity) => {
            if (!isObject(activity.expected)) return;
            arrayOf(activity.expected.accepted_diagnoses).forEach((accepted) => terms.push(cleanText(accepted)));
            const rhythm = humanise(activity.expected.rhythm);
            if (rhythm.split(' ').length > 1) terms.push(rhythm);
        });
    }
    terms.push(cleanText(config.diagnosis), cleanText(config.expected_diagnosis));
    const seen = new Set();
    return terms.filter((term) => {
        const key = normaliseForMatch(term);
        if (key.length < 2 || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Disclosure (pure)
// ---------------------------------------------------------------------------

/**
 * May the brief carry the findings on this turn?
 *
 *   'never'      -> no.
 *   'on_request' -> yes; the brief tells the specialist to share only when
 *                   asked, so the gate itself stays open.
 *   'after_effort' -> the learner must have sent at least `minStudentTurns`
 *                   messages to THIS specialist and, when
 *                   `requireRoomActivity` is set, must have been in the room
 *                   whose material the specialist read.
 *
 * Both effort conditions must hold, and `reason` names the first one that
 * failed so a log says which.
 *
 * @param {object} args
 * @param {object} args.disclosure   normalised disclosure (normalizeDisclosure().value)
 * @param {number} args.studentTurns countStudentTurns()
 * @param {boolean} [args.roomActive] hasRoomActivity(); only read when the
 *   config sets requireRoomActivity. Defaults to false, so a caller that
 *   forgets to pass it keeps the gate SHUT rather than opening it.
 * @returns {{findingsAllowed: boolean, reason: string}}
 */
export function disclosureState({ disclosure, studentTurns, roomActive = false }) {
    const d = isObject(disclosure) ? disclosure : {};
    const turns = Number.isFinite(studentTurns) ? studentTurns : 0;
    if (d.findings === 'on_request') {
        return { findingsAllowed: true, reason: 'on_request' };
    }
    if (d.findings === 'after_effort') {
        const min = Number.isInteger(d.minStudentTurns) && d.minStudentTurns >= 0 ? d.minStudentTurns : Infinity;
        if (turns < min) {
            return { findingsAllowed: false, reason: 'after_effort_turns_below_min' };
        }
        if (d.requireRoomActivity === true && roomActive !== true) {
            return { findingsAllowed: false, reason: 'after_effort_room_not_visited' };
        }
        return { findingsAllowed: true, reason: 'after_effort_met' };
    }
    // 'never', and anything unrecognised: closed.
    return { findingsAllowed: false, reason: d.findings === 'never' ? 'never' : 'unknown_mode' };
}

// ---------------------------------------------------------------------------
// Brief (pure)
// ---------------------------------------------------------------------------

/**
 * The CASE BRIEF block appended to a specialist's persona prompt.
 *
 * Shape:
 *   ## CASE BRIEF (server)
 *   You have reviewed <material>. ...know nothing about the patient...
 *   <findings, or the withheld instruction, or "none were provided">
 *   Never name or hint at a diagnosis...
 *
 * There is deliberately no patient block. See rule 2 in the module header.
 *
 * @param {object} args
 * @param {object} [args.specialty]   SPECIALTIES entry; its `domain` picks the
 *                                    material wording. A missing or unknown
 *                                    specialty reads generically.
 * @param {{text: string, source: string}[]} args.findings
 * @param {{findingsAllowed: boolean, reason: string}} args.disclosureState
 * @returns {string}
 */
export function buildSpecialistBrief({ specialty, findings, disclosureState: state }) {
    const material = MATERIAL_LABELS[specialty?.domain] || 'the material for this case';
    const lines = [
        BRIEF_HEADER,
        `You have reviewed ${material}. ${BRIEF_NO_PATIENT}`,
        '',
    ];
    const list = arrayOf(findings).filter((f) => isObject(f) && cleanText(f.text));
    if (list.length === 0) {
        lines.push(BRIEF_NO_FINDINGS);
    } else if (state?.findingsAllowed === true) {
        lines.push(BRIEF_FINDINGS_LEAD);
        list.forEach((f) => lines.push(`- ${cleanText(f.text)}${cleanText(f.source) ? ` (${cleanText(f.source)})` : ''}`));
        if (state.reason === 'on_request') lines.push(BRIEF_ON_REQUEST);
    } else {
        lines.push(BRIEF_WITHHELD);
    }
    lines.push(BRIEF_NO_DIAGNOSIS);
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reply guard (pure)
// ---------------------------------------------------------------------------

/**
 * Lowercase, hyphens/dashes to spaces, every other non letter/number to a
 * space, whitespace collapsed. Matching then compares space-padded strings,
 * which is a whole-word / whole-phrase match ("carcinoma" does not match
 * inside "carcinomatosis").
 */
export function normaliseForMatch(text) {
    if (typeof text !== 'string') return '';
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{Pd}‐-―]/gu, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/**
 * Drop every sentence of a reply that names an answer term.
 *
 * @param {string} text
 * @param {string[]} terms   extractAnswerTerms()
 * @returns {{text: string, removed: number}} when every sentence is removed,
 *   text is GUARD_FALLBACK_REPLY
 */
export function guardSpecialistReply(text, terms) {
    if (typeof text !== 'string' || text.trim() === '') return { text: typeof text === 'string' ? text : '', removed: 0 };
    const needles = arrayOf(terms).map(normaliseForMatch).filter((t) => t.length >= 2).map((t) => ` ${t} `);
    if (needles.length === 0) return { text, removed: 0 };
    // A sentence runs to its terminal punctuation (or the end of the text).
    const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [text];
    const kept = sentences.filter((sentence) => {
        const hay = ` ${normaliseForMatch(sentence)} `;
        return !needles.some((needle) => hay.includes(needle));
    });
    const removed = sentences.length - kept.length;
    if (removed === 0) return { text, removed: 0 };
    const joined = kept.map((s) => s.trim()).filter(Boolean).join(' ');
    return { text: joined || GUARD_FALLBACK_REPLY, removed };
}
