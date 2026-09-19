/**
 * AgentService - Manages multi-agent communication for the simulation
 *
 * Handles:
 * - Fetching agent configurations (templates, case-specific)
 * - Managing agent state (paging, arrival, departure)
 * - Building debriefing context for LLM calls
 * - Sending messages to agents
 * - Team communications log
 *
 * All HTTP goes through apiFetch — bearer auth, JSON encoding, and the
 * ApiError contract are centralised. Per-status branches (429/503) are kept
 * by reading ApiError.status instead of poking at Response objects.
 */

import { ApiError, apiDelete, apiFetch, apiPost, apiPut } from './apiClient.js';
import { buildDiscussionCaseContext } from '../utils/casePromptContext.js';
import { normalizeKnowledge, scopeAtLeast } from '../../server/shared/agentKnowledge.js';

async function tryReturning(fallback, fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[AgentService] ${label} error:`, err);
    return fallback;
  }
}

export const AgentService = {
  // ==================== AGENT TEMPLATES ====================

  async getTemplates() {
    return tryReturning([], async () => {
      const data = await apiFetch('/agents/templates');
      return data?.templates || [];
    }, 'getTemplates');
  },

  async getTemplate(templateId) {
    return tryReturning(null, async () => apiFetch(`/agents/templates/${templateId}`), 'getTemplate');
  },

  async createTemplate(templateData) {
    try {
      return await apiPost('/agents/templates', templateData);
    } catch (err) {
      console.error('[AgentService] createTemplate error:', err);
      throw err;
    }
  },

  async updateTemplate(templateId, templateData) {
    try {
      return await apiPut(`/agents/templates/${templateId}`, templateData);
    } catch (err) {
      console.error('[AgentService] updateTemplate error:', err);
      throw err;
    }
  },

  async deleteTemplate(templateId) {
    try {
      return await apiDelete(`/agents/templates/${templateId}`);
    } catch (err) {
      console.error('[AgentService] deleteTemplate error:', err);
      throw err;
    }
  },

  async duplicateTemplate(templateId, newName) {
    try {
      return await apiPost(`/agents/templates/${templateId}/duplicate`, { name: newName });
    } catch (err) {
      console.error('[AgentService] duplicateTemplate error:', err);
      throw err;
    }
  },

  /**
   * Reset a standard (is_default=1) template back to its shipped baseline.
   * Server validates that the row is in fact a standard template; custom
   * templates reject with 400.
   */
  async resetTemplateToDefault(templateId) {
    try {
      return await apiPost(`/agents/templates/${templateId}/reset-to-default`);
    } catch (err) {
      console.error('[AgentService] resetTemplateToDefault error:', err);
      throw err;
    }
  },

  async testLLM(templateId) {
    try {
      return await apiPost(`/agents/templates/${templateId}/test-llm`);
    } catch (err) {
      console.error('[AgentService] testLLM error:', err);
      throw err;
    }
  },

  // ==================== CASE AGENTS ====================

  async getCaseAgents(caseId) {
    return tryReturning([], async () => {
      const data = await apiFetch(`/cases/${caseId}/agents`);
      return data?.agents || [];
    }, 'getCaseAgents');
  },

  async addAgentToCase(caseId, agentConfig) {
    try {
      return await apiPost(`/cases/${caseId}/agents`, agentConfig);
    } catch (err) {
      console.error('[AgentService] addAgentToCase error:', err);
      throw err;
    }
  },

  async updateCaseAgent(caseId, agentId, updates) {
    try {
      return await apiPut(`/cases/${caseId}/agents/${agentId}`, updates);
    } catch (err) {
      console.error('[AgentService] updateCaseAgent error:', err);
      throw err;
    }
  },

  async removeAgentFromCase(caseId, agentId) {
    try {
      return await apiDelete(`/cases/${caseId}/agents/${agentId}`);
    } catch (err) {
      console.error('[AgentService] removeAgentFromCase error:', err);
      throw err;
    }
  },

  async addDefaultAgentsToCase(caseId) {
    try {
      return await apiPost(`/cases/${caseId}/agents/add-defaults`);
    } catch (err) {
      console.error('[AgentService] addDefaultAgentsToCase error:', err);
      throw err;
    }
  },

  // ==================== SESSION AGENTS (Runtime State) ====================

  async getSessionAgents(sessionId) {
    return tryReturning([], async () => {
      const data = await apiFetch(`/sessions/${sessionId}/agents`);
      return data?.agents || [];
    }, 'getSessionAgents');
  },

  async pageAgent(sessionId, agentType) {
    try {
      return await apiPost(`/sessions/${sessionId}/agents/${agentType}/page`);
    } catch (err) {
      console.error('[AgentService] pageAgent error:', err);
      throw err;
    }
  },

  async arriveAgent(sessionId, agentType) {
    try {
      return await apiPost(`/sessions/${sessionId}/agents/${agentType}/arrive`);
    } catch (err) {
      console.error('[AgentService] arriveAgent error:', err);
      throw err;
    }
  },

  async departAgent(sessionId, agentType) {
    try {
      return await apiPost(`/sessions/${sessionId}/agents/${agentType}/depart`);
    } catch (err) {
      console.error('[AgentService] departAgent error:', err);
      throw err;
    }
  },

  async getAgentStatus(sessionId, agentType) {
    return tryReturning({ status: 'absent' }, async () =>
      apiFetch(`/sessions/${sessionId}/agents/${agentType}/status`),
      'getAgentStatus');
  },

  // ==================== AGENT CONVERSATIONS ====================

  async getConversation(sessionId, agentType) {
    return tryReturning([], async () => {
      const data = await apiFetch(`/sessions/${sessionId}/agents/${agentType}/conversation`);
      return data?.messages || [];
    }, 'getConversation');
  },

  // `channel` ('chat' | 'call') and `callId` are optional: a turn from the
  // team-agent tabs sends neither and the body stays { role, content }. The
  // on-call phone tags every turn with its channel, and call turns with the
  // id of the call they belong to, so a transcript can tell texts from calls.
  async addMessage(sessionId, agentType, role, content, { channel = null, callId = null } = {}) {
    const body = { role, content };
    if (channel) body.channel = channel;
    if (callId) body.call_id = callId;
    try {
      return await apiPost(`/sessions/${sessionId}/agents/${agentType}/conversation`, body);
    } catch (err) {
      console.error('[AgentService] addMessage error:', err);
      throw err;
    }
  },

  async clearConversation(sessionId, agentType) {
    try {
      return await apiDelete(`/sessions/${sessionId}/agents/${agentType}/conversation`);
    } catch (err) {
      console.error('[AgentService] clearConversation error:', err);
      throw err;
    }
  },

  // ==================== TEAM COMMUNICATIONS ====================

  async getTeamCommunications(sessionId) {
    return tryReturning([], async () => {
      const data = await apiFetch(`/sessions/${sessionId}/team-communications`);
      return data?.log || [];
    }, 'getTeamCommunications');
  },

  async addTeamCommunication(sessionId, agentType, keyPoints) {
    try {
      return await apiPost(`/sessions/${sessionId}/team-communications`, {
        agent_type: agentType,
        key_points: keyPoints
      });
    } catch (err) {
      console.error('[AgentService] addTeamCommunication error:', err);
      throw err;
    }
  },

  // ==================== DEBRIEFING & LLM INTEGRATION ====================

  /**
   * Build the situation an agent is told about, as this browser sees it.
   *
   * Scoped by the agent's `config.knowledge` (server/shared/agentKnowledge.js),
   * falling back to the legacy `context_filter` column for an agent nobody has
   * migrated.
   *
   * NOTE ON TRUST. For `none` and `handover` the server DROPS whatever this
   * returns and builds the block itself (services/situationBrief.js), because
   * an agent that is supposed to know only what the learner tells it must not
   * have its ignorance enforced by the learner's own browser. The narrowing
   * here saves a payload; it is not the security boundary.
   *
   * `memory_access` used to be read here to filter the record by verb. It
   * never worked: no route projection returned the column, and the branch that
   * consumed it called `getFilteredNarrative`, a method defined nowhere in the
   * repo. Both are gone. What the learner actually did is now rendered
   * server-side from rows the server read itself (services/encounterRecord.js)
   * and gated by `knowledge.record`.
   */
  buildDebriefingContext(agent, patientRecord, teamLog, currentVitals, activeCase = null) {
    const lines = [];

    const knowledge = normalizeKnowledge({
      knowledge: agent?.config?.knowledge,
      agentType: agent?.agent_type,
      contextFilter: agent?.context_filter,
    }).value;

    const caseContext = buildDiscussionCaseContext(activeCase, knowledge.scope, { answerKey: knowledge.answerKey });
    if (caseContext) {
      lines.push(caseContext.trim());
    }

    if (patientRecord) {
      lines.push('=== PATIENT BRIEFING ===');

      if (patientRecord.toNarrative && typeof patientRecord.toNarrative === 'function') {
        const narrative = patientRecord.toNarrative('context');
        if (narrative) lines.push(narrative);
      } else {
        const patient = patientRecord.record?.patient;
        if (patient) {
          lines.push(`Patient: ${patient.name || 'Unknown'}, ${patient.age || '?'} y/o ${patient.gender || ''}`);
          if (patient.chief_complaint) {
            lines.push(`Chief Complaint: ${patient.chief_complaint}`);
          }
        }
      }
    }

    // The live monitor. Gated on the chart scope like everything else: an
    // agent that is not given the configured vitals has no business reading
    // the current ones off the screen either. This block had NO agent-type
    // gate at all, so the family member was handed the learner's live
    // haemodynamics — the one leak the case-context scoping alone did not
    // close. A `handover` agent still gets observations, server-built from
    // session_vitals, in its own brief.
    if (currentVitals && scopeAtLeast(knowledge.scope, 'chart')) {
      lines.push('');
      lines.push('=== CURRENT VITALS ===');
      const vitalLabels = { hr: 'HR', spo2: 'SpO2', rr: 'RR', bpSys: 'BP Sys', bpDia: 'BP Dia', temp: 'Temp', etco2: 'ETCO2' };
      const vitalUnits = { hr: 'bpm', spo2: '%', rr: '/min', bpSys: 'mmHg', bpDia: 'mmHg', temp: '°C', etco2: 'mmHg' };
      Object.entries(currentVitals).forEach(([key, value]) => {
        if (vitalLabels[key] && value !== undefined) {
          lines.push(`${vitalLabels[key]}: ${value}${vitalUnits[key] || ''}`);
        }
      });
    }

    if (teamLog && teamLog.length > 0) {
      // An agent that was not given the chart is not given the whole team's
      // traffic either. Previously keyed on `context_filter === 'history'`;
      // now any scope below `chart` narrows it, which additionally catches
      // `summary` (the old `vitals`).
      const relevantLogs = scopeAtLeast(knowledge.scope, 'chart')
        ? teamLog
        : teamLog.filter(l => l.agent_type === 'relative' || l.agent_type === agent.agent_type);

      if (relevantLogs.length > 0) {
        lines.push('');
        lines.push('=== TEAM COMMUNICATIONS ===');
        relevantLogs.slice(0, 10).forEach(entry => {
          lines.push(`[${entry.agent_type}]: ${entry.key_points}`);
        });
      }
    }

    return lines.join('\n');
  },

  /**
   * Send a message to an agent via the LLM proxy
   * Handles the full flow: build context, send message, log response
   */
  //
  // Trailing options: `caseLanguage` (session dialogue language), `channel`
  // ('chat' | 'call', default 'chat') and `callId` (the call a turn belongs
  // to). channel/callId are written on BOTH the learner's and the agent's
  // turn; they do not change what is sent to the model.
  async sendAgentMessage(sessionId, agent, userMessage, patientRecord, teamLog, currentVitals, conversationHistory = [], activeCase = null, { caseLanguage = null, channel = 'chat', callId = null } = {}) {
    // The server builds a team agent's persona from its case agent id. Without
    // one, /proxy/llm would have nothing to build it from, so refuse before
    // writing the learner's turn or calling the model — an agent that answers
    // with no persona is worse than one that says it cannot be reached.
    if (agent?.case_agent_id == null) {
      const err = new Error('this agent has no case agent id');
      console.error('[AgentService] sendAgentMessage error:', err);
      return `Error: Could not communicate with ${agent?.name}. ${err.message}`;
    }
    try {
      const turnTags = { channel, callId };
      await this.addMessage(sessionId, agent.agent_type, 'user', userMessage, turnTags);

      // Only the situation this browser can see. The server leads with the
      // role anchor and the agent's authored prompt, which a learner's client
      // is no longer sent (server/services/agentPersona.js).
      const situation = this.buildDebriefingContext(agent, patientRecord, teamLog, currentVitals, activeCase);

      const messages = [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      const requestBody = {
        session_id: sessionId,
        messages,
        system_prompt: situation,
        agent_llm_config: { case_agent_id: agent.case_agent_id }
      };
      // Session dialogue language — the server appends the registry's
      // output-language directive (systemPromptAssembly), same contract as
      // the patient chat in llmService. Without this, nurse/consultant/
      // relative replies stay English in a non-English session.
      if (caseLanguage) requestBody.case_language = caseLanguage;

      let aiContent;
      try {
        const data = await apiPost('/proxy/llm', requestBody);
        aiContent = data?.choices?.[0]?.message?.content || '...';
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 429) {
            console.warn('[AgentService] Rate limit exceeded:', err.body);
            return `Rate limit exceeded: ${err.message}`;
          }
          if (err.status === 503) {
            return `Service unavailable: ${err.message}`;
          }
          throw new Error(`LLM API Error (${err.status}): ${err.message}`);
        }
        throw err;
      }

      await this.addMessage(sessionId, agent.agent_type, 'assistant', aiContent, turnTags);

      const keyPoints = this.extractKeyPoints(aiContent, agent.agent_type);
      if (keyPoints) {
        await this.addTeamCommunication(sessionId, agent.agent_type, keyPoints);
      }

      return aiContent;

    } catch (err) {
      console.error('[AgentService] sendAgentMessage error:', err);
      return `Error: Could not communicate with ${agent.name}. ${err.message}`;
    }
  },

  /**
   * Simple heuristic key-point extraction. First sentence or up to 100 chars.
   */
  extractKeyPoints(content) {
    if (!content || content.length < 20) return null;
    const firstSentence = content.match(/^[^.!?]*[.!?]/);
    if (firstSentence && firstSentence[0].length > 10) {
      return firstSentence[0].trim();
    }
    return content.substring(0, 100).trim() + '...';
  },

  // ==================== AVAILABILITY HELPERS ====================

  isAgentAvailable(agent, elapsedMinutes) {
    if (!agent.enabled) return false;
    switch (agent.availability_type) {
      case 'absent': return false;
      case 'on-call': return true;
      case 'present':
      default:
        if (agent.available_from_minute > 0 && elapsedMinutes < agent.available_from_minute) return false;
        if (agent.depart_at_minute && elapsedMinutes >= agent.depart_at_minute) return false;
        return true;
    }
  },

  // NOTE: there is deliberately no client-side wait calculation here.
  // `calculateWaitTime()` used to live at this spot — a second, rival
  // implementation of the arrival delay that nothing but its own unit
  // test ever called. It returned MINUTES while the live server path
  // returns seconds, and it applied none of the server's clamping, so
  // anyone who found it and wired it up would have shipped a wait an
  // order of magnitude off. The wait is computed once, server-side, in
  // POST /sessions/:id/agents/:type/page (server/routes/agents-routes.js)
  // and reaches the client only as `arrives_at` / `wait_seconds`.

  // `label` stays English (logged/tested contract); `labelKey`/`labelParams`
  // are the chat-namespace translation key the UI renders via
  // t(labelKey, labelParams) — this service stays hook-free.
  getAgentDisplayStatus(agent, elapsedMinutes) {
    if (!agent.enabled) {
      return { status: 'disabled', label: 'Not Available', labelKey: 'agent_status_not_available', canChat: false, canPage: false };
    }
    if (agent.status === 'present') {
      return { status: 'present', label: 'Available', labelKey: 'agent_status_available', canChat: true, canPage: false };
    }
    if (agent.status === 'paged') {
      return { status: 'paged', label: 'On the way...', labelKey: 'agent_status_on_the_way', canChat: false, canPage: false };
    }
    if (agent.status === 'departed') {
      return { status: 'departed', label: 'Left', labelKey: 'agent_status_left', canChat: false, canPage: false };
    }
    if (agent.availability_type === 'absent') {
      return { status: 'absent', label: 'Not Available', labelKey: 'agent_status_not_available', canChat: false, canPage: false };
    }
    if (agent.availability_type === 'on-call') {
      return { status: 'on-call', label: 'On-Call', labelKey: 'agent_status_on_call', canChat: false, canPage: true };
    }
    if (agent.available_from_minute > 0 && elapsedMinutes < agent.available_from_minute) {
      const minutes = agent.available_from_minute - elapsedMinutes;
      return {
        status: 'not-yet',
        label: `Available in ${minutes} min`,
        labelKey: 'agent_status_available_in',
        labelParams: { minutes },
        canChat: false,
        canPage: false
      };
    }
    if (agent.depart_at_minute && elapsedMinutes >= agent.depart_at_minute) {
      return { status: 'departed', label: 'Left', labelKey: 'agent_status_left', canChat: false, canPage: false };
    }
    return { status: 'present', label: 'Available', labelKey: 'agent_status_available', canChat: true, canPage: false };
  }
};

export default AgentService;
