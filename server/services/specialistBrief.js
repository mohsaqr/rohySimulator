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
//      every reply passes through the reply guard (buildReplyGuard +
//      guardSpecialistReply), which drops any sentence naming the answer:
//      the authored answer phrases, their distinctive words matched through
//      inflection ("adenokarsinoomaan"), and, when the answer is malignant,
//      the words for malignancy in every case language ("syöpä",
//      "adenocarcinoma"). Streamed replies are cut into sentences on the
//      server and each one is guarded before it is written
//      (createStreamReplyGuard), so nothing reaches the learner unguarded.
//
// Pure functions take already-parsed JSON and never throw on malformed input:
// case documents are authored by hand and by third-party packages, and a bad
// shape must cost the brief a finding, not the learner a reply.

import dbAdapter from '../dbAdapter.js';
import { resolveSessionCaseConfig } from '../routes/_helpers.js';
import { DEFAULT_LANGUAGE, isKnownLanguage } from '../shared/languages.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { projectCaseConfigForRole } from './caseProjection.js';
import {
    AGGLUTINATIVE_LANGUAGES,
    GENERIC_WORDS,
    GUARD_FALLBACK_REPLIES,
    MALIGNANCY_TERMS,
} from './specialistGuardLexicon.js';

export { GUARD_FALLBACK_REPLIES } from './specialistGuardLexicon.js';

/** The English fallback (GUARD_FALLBACK_REPLIES.en); kept for callers that name it. */
export const GUARD_FALLBACK_REPLY = GUARD_FALLBACK_REPLIES.en;

/**
 * Sent when the guard removed every sentence of a reply: in the case
 * language, English for an unknown one.
 * @param {string} [language]  case language code
 * @returns {string}
 */
export function guardFallbackReply(language) {
    return GUARD_FALLBACK_REPLIES[language] || GUARD_FALLBACK_REPLIES[DEFAULT_LANGUAGE];
}

export const BRIEF_HEADER = '## CASE BRIEF (server)';
export const BRIEF_FINDINGS_LEAD = 'Findings you may share or confirm when the student asks or describes them:';
// Follows the scope line, which already says the material has been reviewed —
// so this one does not repeat it.
// Only reached when an educator chose the after_effort gate for the case.
export const BRIEF_WITHHELD = 'Do not describe specific findings yet: this case wants the student to look first. '
    + 'If they ask, say so in a sentence and ask what they saw.';
export const BRIEF_NO_FINDINGS = 'No findings were provided for this case; do not invent any.';
export const BRIEF_NO_DIAGNOSIS = 'Never name or hint at a diagnosis, even if asked directly: '
    + 'the conclusion is the student\'s to draw. Say what the findings show and leave it to them.';
export const BRIEF_ON_REQUEST = 'Share the findings when the student asks about the material; '
    + 'you need not list them before they ask.';
// The scope line. Says what the specialist has and, just as importantly, what
// it does not: no patient, no symptoms, no history. Without it a model briefed
// only on findings still happily invents a presentation to hang them on.
export const BRIEF_NO_PATIENT = 'You have not seen the patient and know nothing about them: '
    + 'not their symptoms, not their history, not why they presented, not what else has been done. '
    + 'If the student asks about any of that, say you only have the material in front of you.';

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
 * Lowercase, diacritics dropped (ä -> a, é -> e), hyphens/dashes to spaces,
 * every other non letter/number to a space, whitespace collapsed. Every side
 * of a comparison — answer terms, the lexicon, the reply — goes through this,
 * so "syöpä" and "syopa" are the same word. Phrase matching then compares
 * space-padded strings, which is a whole-word / whole-phrase match
 * ("carcinoma" does not match inside "carcinomatosis").
 */
export function normaliseForMatch(text) {
    if (typeof text !== 'string') return '';
    return text
        .normalize('NFKC')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .normalize('NFC')
        .replace(/[\p{Pd}‐-―]/gu, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

// A word shorter than this is never guarded on its own: it is matched only
// as part of a whole answer phrase. Short words are where false hits live.
const MIN_GUARDED_WORD = 5;
// An answer phrase longer than this is prose (config.diagnosis is often a
// whole report: "Sigmasuolen adenokarsinooma …, joka kasvaa lihaskerroksen
// läpi …"); splitting it into words would censor every finding it mentions.
// Prose is still matched as a whole phrase.
const MAX_LABEL_WORDS = 4;
// Outside the agglutinative languages a guarded word may grow by this many
// letters (carcinoma -> carcinomas, carcinomi; Karzinom -> Karzinoms) and no
// more, so "invasive" does not reach into "invasion".
const MAX_SUFFIX = 3;
// Finnish case endings stripped from an answer word before it becomes a
// stem, longest first, in normaliseForMatch form (ä -> a). "-nen" adjectives
// take -se-/-s- in every other form (kolorektaalinen, kolorektaalisen).
const FINNISH_ENDINGS = ['nen', 'ssa', 'sta', 'lla', 'lta', 'lle', 'ksi', 'en', 'in', 'n', 'a'];
const TRAILING_VOWELS = /[aeiouyаәеиоөұүыіэюя]+$/u;

const normaliseList = (list) => arrayOf(list).map(normaliseForMatch).filter(Boolean);
const AGGLUTINATIVE = new Set(AGGLUTINATIVE_LANGUAGES);
const GENERIC = new Set(Object.values(GENERIC_WORDS).flatMap(normaliseList));
// Every language's malignancy words, applied together (see the lexicon).
const MALIGNANCY_ROOTS = [...new Set(Object.values(MALIGNANCY_TERMS).flatMap((entry) => normaliseList(entry.roots)))];
const MALIGNANCY_WORDS = [...new Set(Object.values(MALIGNANCY_TERMS).flatMap((entry) => normaliseList(entry.words)))];

const wordsOf = (text) => normaliseForMatch(text).split(' ').filter(Boolean);

/**
 * The stem an answer word is guarded by: what every inflected form of it
 * starts with. Agglutinative languages lose their case ending and trailing
 * vowels ("adenokarsinooma" -> "adenokarsinoom", "koolonin" -> "koolon");
 * elsewhere a long word loses only a final vowel ("carcinoma" -> "carcinom").
 * A stem that would fall under MIN_GUARDED_WORD keeps the whole word.
 *
 * @param {string} word      normalised (normaliseForMatch) single word
 * @param {string} language  case language code
 * @returns {string}
 */
export function stemForGuard(word, language) {
    if (AGGLUTINATIVE.has(language)) {
        let stem = word;
        if (language === 'fi') {
            const ending = FINNISH_ENDINGS.find((e) => stem.endsWith(e) && stem.length - e.length >= MIN_GUARDED_WORD);
            if (ending) stem = stem.slice(0, -ending.length);
        }
        stem = stem.replace(TRAILING_VOWELS, '');
        return stem.length >= MIN_GUARDED_WORD ? stem : word;
    }
    return word.length >= 7 ? word.replace(/[aeiouy]$/u, '') : word;
}

/** Does a reply word (normalised) carry this stem? */
function stemMatches(stem, word, language) {
    if (!word.startsWith(stem)) return false;
    return AGGLUTINATIVE.has(language) || word.length - stem.length <= MAX_SUFFIX;
}

// Every word a learner already holds of this case: the learner projection
// (caseProjection.js), i.e. what GET /cases/:id sends a student. A word the
// learner can read in their own material — the requisition says
// "sigmasuolen resektaatti" — is not the answer, so it is not guarded on its
// own even when an answer phrase contains it. Inline media is skipped.
function learnerVisibleWords(config) {
    const projected = projectCaseConfigForRole(config, PLUGIN_MANIFESTS, 'student');
    const words = new Set();
    const walk = (value) => {
        if (typeof value === 'string') {
            if (!value.startsWith('data:')) wordsOf(value).forEach((w) => words.add(w));
        } else if (Array.isArray(value)) {
            value.forEach(walk);
        } else if (isObject(value)) {
            Object.values(value).forEach(walk);
        }
    };
    walk(projected);
    return words;
}

// pathology diagnosis.requireTerms: the words the learner's own answer must
// contain to be marked right. They are part of the answer.
function requiredAnswerWords(domain, config) {
    if (domain !== 'pathology' || !isObject(config.pathology) || !isObject(config.pathology.rubric)) return [];
    return arrayOf(config.pathology.rubric.activities)
        .filter((activity) => isObject(activity) && isObject(activity.diagnosis))
        .flatMap((activity) => arrayOf(activity.diagnosis.requireTerms))
        .filter((term) => typeof term === 'string');
}

/**
 * Is the protected answer a malignancy? Looks inside compounds
 * ("adenokarsinooma" carries "karsinoom").
 *
 * @param {string[]} terms  answer phrases
 * @returns {boolean}
 */
export function isMalignantAnswer(terms) {
    return arrayOf(terms).some((term) => wordsOf(term).some((word) =>
        MALIGNANCY_ROOTS.some((root) => word.includes(root)) || MALIGNANCY_WORDS.includes(word)));
}

/**
 * Everything the reply guard needs for one specialist on one case.
 *
 * - phrases: extractAnswerTerms() — matched as whole phrases.
 * - stems: each distinctive word of a short answer label (≤ MAX_LABEL_WORDS
 *   words) and of pathology requireTerms, stemmed for the case language.
 *   Not guarded on its own: a word under MIN_GUARDED_WORD letters, a generic
 *   modifier or function word (lexicon GENERIC_WORDS), or a word the
 *   learner can already read in their own material (learnerVisibleWords).
 * - classRoots / classWords: the lexicon's malignancy words, every language,
 *   when the answer itself is malignant.
 *
 * @param {string} domain   specialty domain
 * @param {object} config   parsed case config
 * @param {object} [options]
 * @param {string} [options.fallbackLanguage]  used when the config carries no
 *   known case_language (a legacy case); defaults to English
 * @returns {{language: string, phrases: string[], stems: string[], classRoots: string[], classWords: string[]}}
 */
export function buildReplyGuard(domain, config, { fallbackLanguage } = {}) {
    const safeConfig = isObject(config) ? config : {};
    let language = DEFAULT_LANGUAGE;
    if (isKnownLanguage(safeConfig.case_language)) language = safeConfig.case_language;
    else if (isKnownLanguage(fallbackLanguage)) language = fallbackLanguage;
    const phrases = extractAnswerTerms(domain, safeConfig);
    const required = requiredAnswerWords(domain, safeConfig);
    const labelWords = [...phrases, ...required]
        .map(wordsOf)
        .filter((words) => words.length > 0 && words.length <= MAX_LABEL_WORDS)
        .flat()
        .filter((word) => word.length >= MIN_GUARDED_WORD && !GENERIC.has(word) && !/^\p{N}+$/u.test(word));
    const visible = labelWords.length > 0 ? [...learnerVisibleWords(safeConfig)] : [];
    const stems = [...new Set(labelWords.map((word) => stemForGuard(word, language)))]
        .filter((stem) => !visible.some((word) => stemMatches(stem, word, language)));
    const malignant = isMalignantAnswer([...phrases, ...required]);
    return {
        language,
        phrases,
        stems,
        classRoots: malignant ? MALIGNANCY_ROOTS : [],
        classWords: malignant ? MALIGNANCY_WORDS : [],
    };
}

/**
 * Does the guard have anything to look for?
 * @param {object} guard  buildReplyGuard()
 * @returns {boolean}
 */
export function guardHasTerms(guard) {
    if (!isObject(guard)) return false;
    return ['phrases', 'stems', 'classRoots', 'classWords'].some((key) => arrayOf(guard[key]).length > 0);
}

// A plain array is the original call shape: answer phrases only, matched as
// whole phrases.
function asGuard(guardOrTerms, language) {
    const lang = isKnownLanguage(language) ? language : DEFAULT_LANGUAGE;
    if (Array.isArray(guardOrTerms)) {
        return { language: lang, phrases: guardOrTerms, stems: [], classRoots: [], classWords: [] };
    }
    if (!isObject(guardOrTerms)) return { language: lang, phrases: [], stems: [], classRoots: [], classWords: [] };
    return {
        language: isKnownLanguage(guardOrTerms.language) ? guardOrTerms.language : lang,
        phrases: arrayOf(guardOrTerms.phrases),
        stems: arrayOf(guardOrTerms.stems),
        classRoots: arrayOf(guardOrTerms.classRoots),
        classWords: arrayOf(guardOrTerms.classWords),
    };
}

function compileGuard(guard) {
    const needles = guard.phrases.map(normaliseForMatch).filter((t) => t.length >= 2).map((t) => ` ${t} `);
    const stems = guard.stems.map(normaliseForMatch).filter(Boolean);
    const roots = guard.classRoots.map(normaliseForMatch).filter(Boolean);
    const classWords = new Set(guard.classWords.map(normaliseForMatch).filter(Boolean));
    const empty = needles.length + stems.length + roots.length + classWords.size === 0;
    const namesAnswer = (sentence) => {
        const normalised = normaliseForMatch(sentence);
        if (!normalised) return false;
        const hay = ` ${normalised} `;
        if (needles.some((needle) => hay.includes(needle))) return true;
        return normalised.split(' ').some((word) =>
            classWords.has(word)
            || roots.some((root) => word.includes(root))
            || stems.some((stem) => stemMatches(stem, word, guard.language)));
    };
    return { empty, namesAnswer, fallback: guardFallbackReply(guard.language) };
}

// A sentence ends at terminal punctuation (plus any closing quote/bracket)
// followed by whitespace, or at a line break. "3.5 cm" is not a boundary.
const SENTENCE_END = /[.!?…]+["'”’»)\]]*\s+|\n+/gu;

// Complete sentences (each with its trailing whitespace) and the unfinished
// rest. Joining parts + rest gives back the input exactly.
function cutSentences(text) {
    const parts = [];
    let start = 0;
    for (const match of text.matchAll(SENTENCE_END)) {
        const end = match.index + match[0].length;
        parts.push(text.slice(start, end));
        start = end;
    }
    return { parts, rest: text.slice(start) };
}

/**
 * Drop every sentence of a reply that names the answer.
 *
 * @param {string} text
 * @param {object|string[]} guardOrTerms  buildReplyGuard(), or a plain list
 *   of answer phrases (whole-phrase match only)
 * @param {object} [options]
 * @param {string} [options.language]  fallback language for a plain list
 * @returns {{text: string, removed: number}} when every sentence is removed,
 *   text is the fallback question in the guard's language
 */
export function guardSpecialistReply(text, guardOrTerms, { language } = {}) {
    if (typeof text !== 'string' || text.trim() === '') return { text: typeof text === 'string' ? text : '', removed: 0 };
    const compiled = compileGuard(asGuard(guardOrTerms, language));
    if (compiled.empty) return { text, removed: 0 };
    const { parts, rest } = cutSentences(text);
    const sentences = rest ? [...parts, rest] : parts;
    const kept = sentences.filter((sentence) => !compiled.namesAnswer(sentence));
    const removed = sentences.length - kept.length;
    if (removed === 0) return { text, removed: 0 };
    const joined = kept.map((s) => s.trim()).filter(Boolean).join(' ');
    return { text: joined || compiled.fallback, removed };
}

/**
 * The guard for a STREAMED reply. Deltas are held until a sentence is
 * complete; each complete sentence is checked and handed back only when it
 * names no answer. A sentence is therefore never on the wire before it has
 * been guarded — the cost is that text arrives a sentence at a time.
 *
 *   const g = createStreamReplyGuard(guard);
 *   write(g.push(delta));   // for every delta ('' while a sentence is open)
 *   write(g.end());         // the last sentence, or the fallback question
 *                           // when every sentence was removed
 *   g.removed               // sentences dropped
 *
 * @param {object|string[]} guardOrTerms  as guardSpecialistReply
 * @param {object} [options]
 * @param {string} [options.language]  fallback language for a plain list
 * @returns {{push: (delta: string) => string, end: () => string, readonly removed: number}}
 */
export function createStreamReplyGuard(guardOrTerms, { language } = {}) {
    const compiled = compileGuard(asGuard(guardOrTerms, language));
    let pending = '';
    let removed = 0;
    let wroteText = false;
    let ended = false;
    const pass = (sentence) => {
        if (sentence.trim() === '') return wroteText ? sentence : '';
        if (compiled.namesAnswer(sentence)) {
            removed += 1;
            return '';
        }
        wroteText = true;
        return sentence;
    };
    return {
        push(delta) {
            if (ended || typeof delta !== 'string' || delta === '') return '';
            pending += delta;
            const { parts, rest } = cutSentences(pending);
            pending = rest;
            return parts.map(pass).join('');
        },
        end() {
            if (ended) return '';
            ended = true;
            const last = pending ? pass(pending) : '';
            pending = '';
            if (!wroteText && removed > 0) return compiled.fallback;
            return last;
        },
        get removed() { return removed; },
    };
}
