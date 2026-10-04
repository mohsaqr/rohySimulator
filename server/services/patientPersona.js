// The patient, built server-side.
//
// The patient's system prompt used to be assembled in the browser and posted
// to /proxy/llm, which used it verbatim — so any signed-in user could make the
// platform's model say anything as "the patient", and the browser had to hold
// the whole case (answer key included) to build it. The proxy now builds it
// here from what the server owns: the session's frozen case snapshot, the
// patient template the case resolves to, and the session's synced record.
// The assembly itself is server/shared/patientPrompt.js — the same code the
// browser used, so what the patient says does not change.

import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import { latestVitals } from './situationBrief.js';
import { buildPatientSystemPrompt } from '../shared/patientPrompt.js';

const log = logger('patient-persona');

const parseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
};

/**
 * The session's case as the patient sees it: the frozen snapshot first (the
 * persona must not change mid-session when an educator edits the case), the
 * live row only for a session that has no snapshot.
 *
 * @returns {Promise<{caseId:number, name:string|null, system_prompt:string|null, config:object}|null>}
 */
export async function loadSessionPatientCase({ sessionId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT s.case_id, s.case_snapshot, c.name, c.system_prompt, c.config
           FROM sessions s
           LEFT JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    if (!row) return null;
    const snap = parseJson(row.case_snapshot);
    if (snap && snap.config) {
        return {
            caseId: row.case_id,
            name: snap.name ?? row.name ?? null,
            system_prompt: snap.system_prompt ?? row.system_prompt ?? null,
            config: snap.config,
        };
    }
    return { caseId: row.case_id, name: row.name ?? null, system_prompt: row.system_prompt ?? null, config: parseJson(row.config, {}) || {} };
}

/**
 * The patient template a session speaks with — a server port of
 * src/utils/patientTemplate.js resolvePatientTemplate, same order:
 *   1. the case's attached, enabled patient agent (overrides merged);
 *   2. otherwise a platform-default patient template whose voice gender
 *      matches the case's first letter;
 *   3. for a non-female case, the first non-female default;
 *   4. otherwise null — a female case is never given a male template.
 *
 * @returns {Promise<{templateId:number, name:string, systemPrompt:string, config:object}|null>}
 */
export async function resolveSessionPatientTemplate({ caseId, tenant, caseConfig }) {
    const attached = await dbAdapter.get(
        `SELECT ca.agent_template_id, ca.name_override, ca.system_prompt_override, ca.config_override,
                at.name AS template_name, at.system_prompt AS template_system_prompt, at.config AS template_config
           FROM case_agents ca
           JOIN agent_templates at ON at.id = ca.agent_template_id
          WHERE ca.case_id = ? AND ca.tenant_id = ? AND at.tenant_id = ?
            AND at.agent_type = 'patient' AND at.deleted_at IS NULL
            AND (ca.enabled IS NULL OR ca.enabled != 0)
          ORDER BY ca.id LIMIT 1`,
        [caseId, tenant, tenant]
    );
    if (attached) {
        return {
            templateId: attached.agent_template_id,
            name: attached.name_override || attached.template_name || 'Patient',
            systemPrompt: attached.system_prompt_override || attached.template_system_prompt || '',
            config: { ...(parseJson(attached.template_config, {}) || {}), ...(parseJson(attached.config_override, {}) || {}) },
        };
    }
    const defaults = await dbAdapter.all(
        `SELECT id, name, system_prompt, config FROM agent_templates
          WHERE agent_type = 'patient' AND is_default = 1 AND tenant_id = ? AND deleted_at IS NULL
          ORDER BY id`,
        [tenant]
    );
    const firstLetter = String(caseConfig?.demographics?.gender || '').toLowerCase().charAt(0);
    const voiceLetter = (t) => String(parseJson(t.config, {})?.voice?.gender || '').toLowerCase().charAt(0);
    const exact = firstLetter ? defaults.find((t) => voiceLetter(t) === firstLetter) : null;
    const nonFemale = firstLetter === 'f' ? null : defaults.find((t) => voiceLetter(t) !== 'f');
    const chosen = exact || nonFemale || null;
    return chosen
        ? { templateId: chosen.id, name: chosen.name || 'Patient', systemPrompt: chosen.system_prompt || '', config: parseJson(chosen.config, {}) || {} }
        : null;
}

/**
 * What the patient knows of the session right now: the current vitals (the
 * synced record's current state, else the latest persisted reading) and the
 * record's events. Narrowing the events to what a patient may know happens in
 * the builder (PATIENT_ACTIVITY_VERBS).
 */
export async function loadPatientLiveState({ sessionId, tenant }) {
    const doc = await dbAdapter.get(
        `SELECT current_state FROM patient_record_documents WHERE session_id = ? AND tenant_id = ?`,
        [sessionId, tenant]
    );
    let vitals = parseJson(doc?.current_state, null)?.vitals || null;
    if (!vitals) {
        const row = await latestVitals({ sessionId, tenant });
        if (row) vitals = { hr: row.hr, rr: row.rr, spo2: row.spo2, temp: row.temp, bp_sys: row.bp_sys, bp_dia: row.bp_dia };
    }
    const rows = await dbAdapter.all(
        `SELECT verb, time_elapsed, category, region, source, item, content, finding, value, unit, abnormal, details
           FROM patient_record_events WHERE session_id = ? AND tenant_id = ? ORDER BY id`,
        [sessionId, tenant]
    );
    const events = rows.map((r) => ({
        ...(parseJson(r.details, {}) || {}),
        verb: r.verb, time: r.time_elapsed, category: r.category, region: r.region, source: r.source,
        item: r.item, content: r.content, finding: r.finding, value: r.value, unit: r.unit,
    }));
    return { vitals, events };
}

/**
 * Everything the proxy needs for a patient turn.
 *
 * @returns {Promise<{prompt:string, template:object|null, patientCase:object}|null>}
 *   null when the session does not exist in this tenant
 */
export async function buildSessionPatientPrompt({ sessionId, tenant }) {
    const patientCase = await loadSessionPatientCase({ sessionId, tenant });
    if (!patientCase) return null;
    const [template, liveState] = await Promise.all([
        resolveSessionPatientTemplate({ caseId: patientCase.caseId, tenant, caseConfig: patientCase.config }),
        loadPatientLiveState({ sessionId, tenant }),
    ]);
    if (!template) log.warn('no patient template resolved for session', { session_id: sessionId, case_id: patientCase.caseId });
    const prompt = buildPatientSystemPrompt({ patientCase, template, vitals: liveState.vitals, events: liveState.events });
    return { prompt, template, patientCase };
}
