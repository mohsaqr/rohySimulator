// What a learner may receive of a case.
//
// Every prompt is built on the server now (patientPersona.js,
// agentSituation.js, specialistBrief.js), so the learner's browser no longer
// needs the authoring side of a case — the title (which often names the
// diagnosis), the description, the system prompt, the expected diagnosis, the
// persona notes, the investigations' values. It still received all of it,
// because GET /cases, GET /cases/:id and the session snapshot sent the row as
// stored. This is the projection for roles below reviewer, and it is an ALLOW
// list: a key an author adds to the case later is private by default and has
// to be named here before a learner sees it.
//
// The lists are the fields the learner runtime actually reads (survey of
// src/, 2026-10-04): the monitor, the exam, the patient card and summary, the
// records tab, the voice, the avatar, the rooms and plugin documents.
//
// Only RESPONSES are projected. The server's own readers (prompt builders,
// order routes) read the stored row and snapshot directly.

import { projectPluginDocumentsForRole, DOCUMENT_FULL_READ_ROLE } from '../shared/pluginDocument.js';
import { roleAllows } from '../shared/pluginRegistry.js';

/** Top-level case columns a learner's client reads. */
const LEARNER_CASE_COLUMNS = Object.freeze([
    'id', 'case_code', 'is_default',
    'patient_name', 'patient_age', 'patient_gender', 'chief_complaint',
    'course_id', 'course_name', 'course_is_default',
]);

/** config keys copied as they are. */
const LEARNER_CONFIG_KEYS = Object.freeze([
    'patient_name', 'patient_avatar', 'avatar_id', 'avatar_camera', 'greeting',
    'case_language', 'language',
    'initialVitals', 'initial_vitals', 'alarms', 'physical_exam', 'rooms',
    // Legacy flat vitals (PatientMonitor, CaseSummaryModal).
    'hr', 'spo2', 'rr', 'sbp', 'dbp', 'bpSys', 'bpDia', 'temp', 'etco2', 'rhythm', 'conditions',
]);

/** config keys whose value is an object narrowed to the listed sub-keys. */
const LEARNER_CONFIG_OBJECTS = Object.freeze({
    demographics: ['age', 'gender', 'mrn', 'allergies', 'dob', 'weight', 'height'],
    // What the patient would tell anyone who asked. Not `additionalNotes` /
    // `aiNotes`: those are the author's notes to the model.
    structuredHistory: [
        'chiefComplaint', 'hpi', 'historyOfPresentIllness', 'present_illness',
        'pmh', 'pastMedicalHistory', 'pastMedical', 'pastSurgical', 'psh',
        'medications', 'allergies', 'social', 'socialHistory', 'family', 'familyHistory', 'ros',
    ],
    // The Records tab, during the case.
    clinicalRecords: ['history', 'physicalExam', 'medications', 'procedures', 'notes'],
    voice: ['case_voice', 'tts_rate', 'tts_pitch', 'gender'],
});

/** Scenario timeline step fields the monitor engine reads. */
const LEARNER_STEP_KEYS = Object.freeze(['time', 'label', 'params', 'rhythm', 'conditions']);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function pick(source, keys) {
    const out = {};
    for (const key of keys) if (Object.hasOwn(source, key)) out[key] = source[key];
    return out;
}

/** Does this role receive the case as stored? */
export function readsWholeCase(role) {
    return roleAllows(role, DOCUMENT_FULL_READ_ROLE);
}

/**
 * A case config, narrowed for a learner: the allow-listed keys, and every
 * plugin document (key = manifest id) after the plugin's own learnerOmit
 * projection.
 *
 * @param {object|null|undefined} config  parsed config
 * @param {Array<object>} manifests
 * @param {string} role
 * @returns {object|null|undefined}
 */
export function projectCaseConfigForRole(config, manifests, role) {
    if (!isPlainObject(config)) return config;
    const documents = projectPluginDocumentsForRole(config, manifests, role);
    if (readsWholeCase(role)) return documents;
    const out = pick(config, LEARNER_CONFIG_KEYS);
    for (const [key, subKeys] of Object.entries(LEARNER_CONFIG_OBJECTS)) {
        if (isPlainObject(config[key])) out[key] = pick(config[key], subKeys);
    }
    for (const manifest of manifests ?? []) {
        const id = manifest?.id;
        if (id && Object.hasOwn(documents, id)) out[id] = documents[id];
    }
    return out;
}

/**
 * A scenario, narrowed for a learner to what the monitor plays: autoStart and
 * the timeline. Its description, its alternative evolutions and its source
 * appear only in the reviewer's Scenarios tab.
 */
export function projectScenarioForRole(scenario, role) {
    if (!isPlainObject(scenario) || readsWholeCase(role)) return scenario;
    const out = {};
    if (Object.hasOwn(scenario, 'autoStart')) out.autoStart = scenario.autoStart;
    if (Array.isArray(scenario.timeline)) {
        out.timeline = scenario.timeline.map((step) => (isPlainObject(step) ? pick(step, LEARNER_STEP_KEYS) : step));
    }
    return out;
}

/**
 * A case as GET /cases and GET /cases/:id return it (config and scenario
 * already parsed).
 *
 * @param {object} caseRow
 * @param {Array<object>} manifests
 * @param {string} role
 * @returns {object}
 */
export function projectCaseForRole(caseRow, manifests, role) {
    const config = projectCaseConfigForRole(caseRow.config, manifests, role);
    if (readsWholeCase(role)) return { ...caseRow, config };
    return {
        ...pick(caseRow, LEARNER_CASE_COLUMNS),
        config,
        scenario: projectScenarioForRole(caseRow.scenario, role),
    };
}

/**
 * A `sessions.case_snapshot` value as stored (JSON string or object),
 * returned in the same form. A learner gets the case id, the snapshot time and
 * the projected config and scenario — not the title or the system prompt. An
 * unparseable snapshot is returned as null for a learner (nothing in it can be
 * vouched for) and untouched for a reviewer.
 */
export function projectCaseSnapshotForRole(snapshot, manifests, role) {
    if (snapshot == null) return snapshot;
    const isString = typeof snapshot === 'string';
    let parsed = snapshot;
    if (isString) {
        try { parsed = JSON.parse(snapshot); } catch { return readsWholeCase(role) ? snapshot : null; }
    }
    if (!isPlainObject(parsed)) return readsWholeCase(role) ? snapshot : null;
    let projected;
    if (readsWholeCase(role)) {
        const config = projectCaseConfigForRole(parsed.config, manifests, role);
        if (config === parsed.config) return snapshot;
        projected = { ...parsed, config };
    } else {
        projected = {
            ...pick(parsed, ['case_id', 'snapshot_at']),
            config: projectCaseConfigForRole(parsed.config, manifests, role) ?? null,
            scenario: projectScenarioForRole(parsed.scenario, role) ?? null,
        };
    }
    return isString ? JSON.stringify(projected) : projected;
}

// ---------------------------------------------------------------------------
// Case titles in analytics payloads
// ---------------------------------------------------------------------------

/** Keys that carry a case's authoring title in analytics / Oyon payloads. */
export const CASE_TITLE_KEYS = Object.freeze(['case_name', 'case_title', 'case_title_snapshot', 'caseTitle', 'live_case_name']);

/**
 * Replace every case title in `payload` with the case's code (EN-0001) for a
 * caller below reviewer. The authoring title often names the diagnosis, and
 * these routes answer a learner about their OWN sessions, events and Oyon
 * records — the same identity the case browser shows them is the code.
 *
 * Walks plain objects and arrays; an object carrying a title key is relabelled
 * from its own `case_id` (or `caseId`), or set to null when it has none.
 * Returns the payload untouched for reviewer and above. One query.
 *
 * @param {*} payload
 * @param {string} role
 * @param {number} tenant
 * @param {{all: Function}} store dbAdapter, or anything with its `all(sql, params)` (injected: this module is otherwise pure)
 * @returns {Promise<*>}
 */
export async function withLearnerCaseLabels(payload, role, tenant, store) {
    if (readsWholeCase(role)) return payload;
    const ids = new Set();
    const titled = (node) => isPlainObject(node) && CASE_TITLE_KEYS.some((key) => Object.hasOwn(node, key));
    const caseIdOf = (node) => node.case_id ?? node.caseId ?? null;
    const collect = (node) => {
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if (!isPlainObject(node)) return;
        if (titled(node) && caseIdOf(node) != null) ids.add(Number(caseIdOf(node)));
        Object.values(node).forEach(collect);
    };
    collect(payload);
    const codes = new Map();
    if (ids.size > 0) {
        const list = [...ids].filter(Number.isFinite);
        const rows = list.length === 0 ? [] : await store.all(
            'SELECT id, case_code FROM cases WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))',
            [tenant, JSON.stringify(list)]
        );
        rows.forEach((row) => codes.set(Number(row.id), row.case_code));
    }
    const relabel = (node) => {
        if (Array.isArray(node)) return node.map(relabel);
        if (!isPlainObject(node)) return node;
        const out = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, relabel(value)]));
        if (titled(node)) {
            const id = caseIdOf(node);
            const label = id == null ? null : (codes.get(Number(id)) ?? `Case ${id}`);
            CASE_TITLE_KEYS.forEach((key) => { if (Object.hasOwn(out, key)) out[key] = label; });
        }
        return out;
    };
    return relabel(payload);
}
