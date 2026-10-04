// What a team agent or the debrief discussant is told about the case, built
// server-side.
//
// Both used to be assembled in the browser from the browser's copy of the
// whole case (answer key included) and posted as the "situation". That
// forced every learner's client to hold the answer key, and let a tampered
// client tell an agent anything. The server now builds the same blocks from
// rows it reads itself; the browser sends only the conversation
// (Phase 2, 2026-10-04).

import dbAdapter from '../dbAdapter.js';
import { normalizeKnowledge, scopeAtLeast } from '../shared/agentKnowledge.js';
import { buildDiscussionCaseContext } from '../shared/casePromptContext.js';
import { buildDiscussantSystemPrompt } from '../shared/discussantPrompt.js';
import { latestVitals } from './situationBrief.js';

const parseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
};

/**
 * The session's case for an agent's context: the frozen snapshot (name,
 * system_prompt, config) plus the live row's description, which the snapshot
 * does not carry.
 */
export async function loadSessionContextCase({ sessionId, tenant }) {
    const row = await dbAdapter.get(
        `SELECT s.case_id, s.case_snapshot, c.name, c.description, c.system_prompt, c.config
           FROM sessions s
           LEFT JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
          WHERE s.id = ? AND s.tenant_id = ?`,
        [sessionId, tenant]
    );
    if (!row) return null;
    const snap = parseJson(row.case_snapshot);
    const fromSnap = snap && snap.config;
    return {
        caseId: row.case_id,
        name: (fromSnap ? snap.name : null) ?? row.name ?? null,
        description: row.description ?? null,
        system_prompt: (fromSnap ? snap.system_prompt : null) ?? row.system_prompt ?? null,
        config: fromSnap ? snap.config : (parseJson(row.config, {}) || {}),
    };
}

/**
 * The session's discussant, in the browser's order (discussionService.js):
 * the case's attached, enabled discussant (overrides merged); else the
 * platform-default discussant template; else any discussant template.
 *
 * @returns {Promise<{templateId:number, name:string, roleTitle:string, systemPrompt:string,
 *   config:object, knowledge:{scope:string, answerKey:boolean, record:boolean}}|null>}
 */
export async function resolveSessionDiscussant({ caseId, tenant }) {
    const attached = await dbAdapter.get(
        `SELECT ca.agent_template_id, ca.name_override, ca.system_prompt_override, ca.config_override,
                at.name, at.role_title, at.system_prompt, at.config, at.context_filter
           FROM case_agents ca
           JOIN agent_templates at ON at.id = ca.agent_template_id
          WHERE ca.case_id = ? AND ca.tenant_id = ? AND at.tenant_id = ?
            AND at.agent_type = 'discussant' AND at.deleted_at IS NULL
            AND (ca.enabled IS NULL OR ca.enabled != 0)
          ORDER BY ca.id LIMIT 1`,
        [caseId, tenant, tenant]
    );
    const row = attached || await dbAdapter.get(
        `SELECT id AS agent_template_id, NULL AS name_override, NULL AS system_prompt_override, NULL AS config_override,
                name, role_title, system_prompt, config, context_filter
           FROM agent_templates
          WHERE agent_type = 'discussant' AND tenant_id = ? AND deleted_at IS NULL
          ORDER BY is_default DESC, id LIMIT 1`,
        [tenant]
    );
    if (!row) return null;
    const config = { ...(parseJson(row.config, {}) || {}), ...(parseJson(row.config_override, {}) || {}) };
    return {
        templateId: row.agent_template_id,
        name: row.name_override || row.name || 'Discussant',
        roleTitle: row.role_title || 'Case Debrief Tutor',
        systemPrompt: row.system_prompt_override || row.system_prompt || '',
        config,
        knowledge: normalizeKnowledge({ knowledge: config.knowledge, agentType: 'discussant', contextFilter: row.context_filter }).value,
    };
}

/** The discussant's whole case prompt for this session, or null for no session. */
export async function buildSessionDiscussantPrompt({ sessionId, tenant, opening = false }) {
    const caseForContext = await loadSessionContextCase({ sessionId, tenant });
    if (!caseForContext) return null;
    const discussant = await resolveSessionDiscussant({ caseId: caseForContext.caseId, tenant });
    if (!discussant) return { prompt: null, discussant: null, caseForContext };
    return { prompt: buildDiscussantSystemPrompt({ discussant, caseForContext, opening }), discussant, caseForContext };
}

const VITAL_LINES = [
    ['hr', 'HR', 'bpm'], ['spo2', 'SpO2', '%'], ['rr', 'RR', '/min'],
    ['bpSys', 'BP Sys', 'mmHg'], ['bpDia', 'BP Dia', 'mmHg'], ['temp', 'Temp', '°C'], ['etco2', 'ETCO2', 'mmHg'],
];

/**
 * A team agent's situation at `summary`, `history` or `chart` scope — the
 * blocks the browser used to send, from server rows:
 *   the case context for the scope (answer key only with knowledge.answerKey);
 *   the current vitals, for `chart` only;
 *   the team's traffic: everyone's at `chart`, otherwise the family's and the
 *   agent's own type's.
 * The learner's own record is NOT here: it is appended separately, and only
 * when knowledge.record allows it (services/encounterRecord.js). The browser
 * used to attach its record narrative regardless of that setting.
 */
export async function buildTeamAgentSituation({ sessionId, tenant, agentType, knowledge }) {
    const caseForContext = await loadSessionContextCase({ sessionId, tenant });
    if (!caseForContext) return '';
    const lines = [];
    const caseContext = buildDiscussionCaseContext(caseForContext, knowledge.scope, { answerKey: knowledge.answerKey === true });
    if (caseContext) lines.push(caseContext.trim());

    if (scopeAtLeast(knowledge.scope, 'chart')) {
        const doc = await dbAdapter.get(
            `SELECT current_state FROM patient_record_documents WHERE session_id = ? AND tenant_id = ?`,
            [sessionId, tenant]
        );
        const v = parseJson(doc?.current_state, null)?.vitals;
        let vitals = v ? { hr: v.hr, spo2: v.spo2, rr: v.rr, bpSys: v.bp_sys ?? v.bpSys, bpDia: v.bp_dia ?? v.bpDia, temp: v.temp, etco2: v.etco2 } : null;
        if (!vitals) {
            const row = await latestVitals({ sessionId, tenant });
            if (row) vitals = { hr: row.hr, spo2: row.spo2, rr: row.rr, bpSys: row.bp_sys, bpDia: row.bp_dia, temp: row.temp, etco2: row.etco2 };
        }
        const vitalLines = vitals
            ? VITAL_LINES.filter(([k]) => vitals[k] != null).map(([k, label, unit]) => `${label}: ${vitals[k]}${unit}`)
            : [];
        if (vitalLines.length) lines.push('', '=== CURRENT VITALS ===', ...vitalLines);
    }

    const log = await dbAdapter.all(
        `SELECT agent_type, key_points FROM team_communications_log
          WHERE session_id = ? AND tenant_id = ? ORDER BY created_at DESC, id DESC`,
        [sessionId, tenant]
    );
    const relevant = scopeAtLeast(knowledge.scope, 'chart')
        ? log
        : log.filter((l) => l.agent_type === 'relative' || l.agent_type === agentType);
    if (relevant.length) {
        lines.push('', '=== TEAM COMMUNICATIONS ===', ...relevant.slice(0, 10).map((e) => `[${e.agent_type}]: ${e.key_points}`));
    }
    return lines.join('\n');
}
