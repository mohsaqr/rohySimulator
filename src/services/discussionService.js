import { apiUrl } from '../config/api';
import { AgentService } from './AgentService';

// The discussant resolution order:
//   1) Per-case attached discussant in case_agents (overrides apply)
//   2) Platform-default discussant template (is_default=1, agent_type='discussant')
//   3) null — feature disabled gracefully
//
// For MVP we use the platform default. Per-case overrides become live once
// the admin attaches a discussant via case_agents (which already works through
// the existing /cases/:id/agents endpoint — no new wiring needed).

function authHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDiscussantForCase(caseId) {
    if (caseId) {
        try {
            const res = await fetch(apiUrl(`/cases/${caseId}/agents`), { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                const attached = (data.agents || []).find(a => a.agent_type === 'discussant' && a.enabled !== 0);
                if (attached) return normalizeAgent(attached);
            }
        } catch (err) {
            console.warn('[discussionService] failed to load case agents:', err.message);
        }
    }
    const templates = await AgentService.getTemplates();
    const fallback =
        templates.find(t => t.agent_type === 'discussant' && t.is_default) ||
        templates.find(t => t.agent_type === 'discussant');
    return fallback ? normalizeAgent(fallback) : null;
}

function normalizeAgent(raw) {
    const config = parseConfig(raw.config) || parseConfig(raw.config_override) || {};
    // Admin UI stores agent gender at config.gender (top-level); voice settings
    // may also carry their own gender override at config.voice.gender. Surface
    // both so downstream voice resolution can pick the right slot.
    const gender = config.voice?.gender || config.gender || null;
    return {
        id: raw.id,
        templateId: raw.agent_template_id || raw.id,
        name: raw.name_override || raw.name || 'Discussant',
        roleTitle: raw.role_title || 'Case Debrief Tutor',
        avatarUrl: raw.avatar_url || null,
        systemPrompt: raw.system_prompt_override || raw.system_prompt || '',
        contextFilter: raw.context_filter_override || raw.context_filter || 'full',
        unlockTrigger: config.unlock_trigger || 'after_case_ended',
        gender,
        voice: config.voice ? { ...config.voice, gender: gender || config.voice.gender } : (gender ? { gender } : null),
        rawConfig: config,
    };
}

function parseConfig(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
}

// Build case-context block prepended to the discussant's system prompt.
// Honors context_filter to keep Socratic / minimal modes spoiler-free.
export function buildCaseContext(activeCase, contextFilter) {
    if (!activeCase || contextFilter === 'minimal') return '';
    const parts = [];
    const cfg = activeCase.config || {};

    const summary = `Case: ${activeCase.name || 'Unnamed'}`
        + (cfg.patient_name ? ` — patient ${cfg.patient_name}` : '')
        + (cfg.demographics?.age ? `, ${cfg.demographics.age}y` : '')
        + (cfg.demographics?.gender ? ` ${cfg.demographics.gender}` : '');
    parts.push(summary);

    if (cfg.structuredHistory?.chiefComplaint) {
        parts.push(`Chief complaint: ${cfg.structuredHistory.chiefComplaint}`);
    }

    if (contextFilter === 'history' || contextFilter === 'full') {
        if (cfg.structuredHistory?.historyOfPresentIllness) {
            parts.push(`HPI: ${cfg.structuredHistory.historyOfPresentIllness}`);
        }
        if (cfg.structuredHistory?.pastMedicalHistory) {
            parts.push(`PMH: ${cfg.structuredHistory.pastMedicalHistory}`);
        }
    }

    if (contextFilter === 'vitals' || contextFilter === 'full') {
        if (cfg.initial_vitals) {
            const v = cfg.initial_vitals;
            parts.push(`Initial vitals: HR ${v.hr || '?'} BP ${v.bpSys || '?'}/${v.bpDia || '?'} SpO2 ${v.spo2 || '?'}% RR ${v.rr || '?'} T ${v.temp || '?'}°C`);
        }
    }

    if (contextFilter === 'full') {
        if (cfg.structuredHistory?.medications) parts.push(`Pre-admission meds: ${cfg.structuredHistory.medications}`);
        if (cfg.structuredHistory?.allergies) parts.push(`Allergies: ${cfg.structuredHistory.allergies}`);
        if (cfg.diagnosis || cfg.expected_diagnosis) parts.push(`Expected diagnosis: ${cfg.diagnosis || cfg.expected_diagnosis}`);
        if (cfg.treatment_plan) parts.push(`Expected treatment plan: ${cfg.treatment_plan}`);
        if (cfg.learning_objectives) {
            const lo = Array.isArray(cfg.learning_objectives) ? cfg.learning_objectives.join('; ') : cfg.learning_objectives;
            parts.push(`Learning objectives: ${lo}`);
        }
    }

    if (parts.length === 0) return '';
    return `\n\n=== CASE CONTEXT ===\n${parts.join('\n')}\n=== END CONTEXT ===\n`
        + `\nNote: the learner's actual orders, exam findings, lab results, and treatments performed in this session aren't in this prompt; ask the learner about them rather than assuming.\n`;
}
