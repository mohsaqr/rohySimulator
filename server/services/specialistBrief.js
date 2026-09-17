// On-call specialists: the server-side case brief and the reply guard.
//
// A specialist (pathologist, cardiologist, radiologist; server/shared/
// specialties.js) is told what the case material shows so it can confirm what
// the learner describes. What it is told, and when, is decided HERE, on the
// server, from the case document — never from a client-built prompt, which
// the learner's browser would hold (LEARNINGS 2026-09-17, "the proxy trusts
// client system_prompt").
//
// Two rules shape every function below:
//   1. FINDINGS are what the material shows; they may be discussed once the
//      disclosure gate opens. DIAGNOSES are the answer key (pathology
//      diagnosis.expected/accept, ECG accepted_diagnoses/rhythm/rationale,
//      radiology impression/interpretation, the case's own diagnosis); they
//      never enter the brief. Extraction is an explicit ALLOW list of fields,
//      so a field added to a document later is private by default.
//   2. The model can still name a diagnosis from the findings alone, so
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
export const BRIEF_WITHHELD = 'You have reviewed the material, but do not describe specific findings yet. '
    + 'Ask what the student has looked at and what they saw, and teach them how to look.';
export const BRIEF_NO_FINDINGS = 'No findings were provided for this case; do not invent any.';
export const BRIEF_NO_DIAGNOSIS = 'Never name or hint at a diagnosis, even if asked directly; '
    + 'ask what they think and what supports it.';
export const BRIEF_ON_REQUEST = 'Share a finding only when the student asks about it.';

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
 * not change what the specialist knows. The patient columns of the live case
 * row are returned for caseSummary's fallbacks only.
 *
 * @param {object} args
 * @param {number|string} args.sessionId
 * @param {number} args.tenant
 * @returns {Promise<{config: object, caseRow: object}|null>} null when the
 *   session is not in this tenant or its case is gone.
 */
export async function loadSpecialistCaseData({ sessionId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT s.case_snapshot, c.config, c.patient_name, c.patient_age,
                c.patient_gender, c.chief_complaint
           FROM sessions s
           JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    if (!row) return null;
    const config = resolveSessionCaseConfig(row);
    return {
        config: isObject(config) ? config : {},
        caseRow: {
            patient_name: row.patient_name,
            patient_age: row.patient_age,
            patient_gender: row.patient_gender,
            chief_complaint: row.chief_complaint,
        },
    };
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

/**
 * The findings a specialist may discuss, for its domain.
 *
 * Reads ONLY: pathology/ECG `rubric.activities[].findings[].text`; PACS
 * `worklist[].report.findings`; legacy `radiology[].findings`. Impression,
 * interpretation, diagnosis, rationale and rhythm are never read.
 *
 * @param {'pathology'|'ecg'|'radiology'} domain
 * @param {object} config  parsed case config
 * @returns {{text: string, source: string}[]}
 */
export function extractFindings(domain, config) {
    if (!isObject(config)) return [];
    if (domain === 'pathology') return activityFindings(config.pathology, 'Activity');
    if (domain === 'ecg') return activityFindings(config.ecg, 'Activity');
    if (domain === 'radiology') return radiologyFindings(config);
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

/**
 * A short clinical frame for the specialist: patient name, age, sex, chief
 * complaint. Allow-listed fields only; config wins over the case row columns.
 * The case NAME and description are deliberately not used — case titles often
 * name the diagnosis ("Anterior STEMI").
 *
 * @param {object} config   parsed case config
 * @param {object} [caseRow] the case row's patient_* / chief_complaint columns
 * @returns {string} lines joined by newline; '' when nothing is authored
 */
export function caseSummary(config, caseRow) {
    const cfg = isObject(config) ? config : {};
    const row = isObject(caseRow) ? caseRow : {};
    const demographics = isObject(cfg.demographics) ? cfg.demographics : {};
    const history = isObject(cfg.structuredHistory) ? cfg.structuredHistory : {};
    const scalar = (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : cleanText(value));
    const lines = [
        ['Patient', scalar(cfg.patient_name) || scalar(row.patient_name)],
        ['Age', scalar(demographics.age) || scalar(row.patient_age)],
        ['Sex', scalar(demographics.gender) || scalar(row.patient_gender)],
        ['Chief complaint', scalar(history.chiefComplaint) || scalar(row.chief_complaint)],
    ];
    return lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n');
}

// ---------------------------------------------------------------------------
// Disclosure (pure)
// ---------------------------------------------------------------------------

/**
 * May the brief carry the findings on this turn?
 *
 * v1 rules: 'never' → no; 'on_request' → yes (the brief tells the specialist
 * to share only when asked); 'after_effort' → studentTurns >= minStudentTurns.
 *
 * TODO(oncall-disclosure): requireRoomActivity and requireInterpretation are
 * NOT enforced in v1. They need a server read of learning_events (did the
 * learner open the specialty's room; did they submit a read/report there).
 * Until then they are reported in `notEnforced` so logs show the gap.
 *
 * @param {object} args
 * @param {object} args.disclosure   normalised disclosure (normalizeDisclosure().value)
 * @param {number} args.studentTurns
 * @returns {{findingsAllowed: boolean, reason: string, notEnforced: string[]}}
 */
export function disclosureState({ disclosure, studentTurns }) {
    const d = isObject(disclosure) ? disclosure : {};
    const notEnforced = ['requireRoomActivity', 'requireInterpretation'].filter((key) => d[key] === true);
    const turns = Number.isFinite(studentTurns) ? studentTurns : 0;
    if (d.findings === 'on_request') {
        return { findingsAllowed: true, reason: 'on_request', notEnforced };
    }
    if (d.findings === 'after_effort') {
        const min = Number.isInteger(d.minStudentTurns) && d.minStudentTurns >= 0 ? d.minStudentTurns : Infinity;
        return turns >= min
            ? { findingsAllowed: true, reason: 'after_effort_met', notEnforced }
            : { findingsAllowed: false, reason: 'after_effort_turns_below_min', notEnforced };
    }
    // 'never', and anything unrecognised: closed.
    return { findingsAllowed: false, reason: d.findings === 'never' ? 'never' : 'unknown_mode', notEnforced };
}

// ---------------------------------------------------------------------------
// Brief (pure)
// ---------------------------------------------------------------------------

/**
 * The CASE BRIEF block appended to a specialist's persona prompt.
 *
 * @param {object} args
 * @param {object} [args.specialty]        SPECIALTIES entry (unused in text; kept for the log/contract)
 * @param {string} args.summary            caseSummary()
 * @param {{text: string, source: string}[]} args.findings
 * @param {{findingsAllowed: boolean, reason: string}} args.disclosureState
 * @returns {string}
 */
export function buildSpecialistBrief({ summary, findings, disclosureState: state }) {
    const lines = [BRIEF_HEADER];
    const frame = cleanText(summary) ? summary.trim() : '';
    if (frame) lines.push(frame);
    const list = arrayOf(findings).filter((f) => isObject(f) && cleanText(f.text));
    lines.push('');
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
