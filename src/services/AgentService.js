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
   * Send a message to an agent via the LLM proxy and say, in a typed result,
   * whether it was answered. Nothing a transport failure produces is dressed
   * up as the agent's words: callers render `error` as an operational message
   * (with Retry) — never as a reply, never spoken, never logged as
   * agentMessageReceived (FI-0010 review, F13).
   *
   * Options: `caseLanguage` (session dialogue language), `channel` ('chat' |
   * 'call', default 'chat'), `callId` (the call a turn belongs to) and
   * `storeLearnerTurn` (default true; false on a Retry whose learner turn was
   * already stored, so the conversation and the server's turn count do not
   * gain a duplicate). channel/callId are written on BOTH the learner's and
   * the agent's turn; they do not change what is sent to the model.
   *
   * @returns {Promise<
   *   {ok: true, content: string, learnerTurnStored: true}
   *   | {ok: false, error: {kind: 'no_agent'|'rate_limited'|'unavailable'|'no_answer'|'failed', status: number|null, message: string}, learnerTurnStored: boolean}
   * >} never rejects
   */
  async requestAgentReply(sessionId, agent, userMessage, conversationHistory = [], { caseLanguage = null, channel = 'chat', callId = null, storeLearnerTurn = true } = {}) {
    // The server builds a team agent's persona from its case agent id. Without
    // one, /proxy/llm would have nothing to build it from, so refuse before
    // writing the learner's turn or calling the model — an agent that answers
    // with no persona is worse than one that says it cannot be reached.
    if (agent?.case_agent_id == null) {
      const err = new Error('this agent has no case agent id');
      console.error('[AgentService] requestAgentReply error:', err);
      return { ok: false, error: { kind: 'no_agent', status: null, message: err.message }, learnerTurnStored: false };
    }
    let learnerTurnStored = !storeLearnerTurn;
    try {
      const turnTags = { channel, callId };
      if (storeLearnerTurn) {
        await this.addMessage(sessionId, agent.agent_type, 'user', userMessage, turnTags);
        learnerTurnStored = true;
      }

      // No situation is sent: the server builds the agent's persona AND what
      // it is told about the case (its knowledge scope's case context, the
      // live vitals at chart scope, the team's traffic) from rows it reads
      // itself — services/agentSituation.js (Phase 2, 2026-10-04).

      const messages = [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      const requestBody = {
        session_id: sessionId,
        messages,
        agent_llm_config: { case_agent_id: agent.case_agent_id }
      };
      // Session dialogue language — the server appends the registry's
      // output-language directive (systemPromptAssembly), same contract as
      // the patient chat in llmService. Without this, nurse/consultant/
      // relative replies stay English in a non-English session.
      if (caseLanguage) requestBody.case_language = caseLanguage;

      const data = await apiPost('/proxy/llm', requestBody);
      const aiContent = data?.choices?.[0]?.message?.content || '...';

      await this.addMessage(sessionId, agent.agent_type, 'assistant', aiContent, turnTags);

      const keyPoints = this.extractKeyPoints(aiContent, agent.agent_type);
      if (keyPoints) {
        await this.addTeamCommunication(sessionId, agent.agent_type, keyPoints);
      }

      return { ok: true, content: aiContent, learnerTurnStored: true };
    } catch (err) {
      // Any step can fail — storing the learner's turn, the proxy, storing
      // the reply — and each is classified the same way. A failure with no
      // HTTP answer (network down — ApiError status 0 — or a bug) is
      // 'failed' with a null status.
      const isHttp = err instanceof ApiError && err.status > 0;
      let kind = 'failed';
      if (isHttp && err.status === 429) kind = 'rate_limited';
      else if (isHttp && err.status === 503) kind = 'unavailable';
      else if (isHttp && err.status === 409 && err.code === 'no_answer') kind = 'no_answer';
      console.error('[AgentService] requestAgentReply error:', err);
      return {
        ok: false,
        error: { kind, status: isHttp ? err.status : null, message: err?.message || String(err) },
        learnerTurnStored,
      };
    }
  },

  /**
   * Send a message to an agent via the LLM proxy — the original shape, kept
   * for the team-agent chat (ChatInterface handleSendToAgent): resolves to the
   * reply, or on failure to an English "Error: …" / "Rate limit exceeded: …"
   * / "Service unavailable: …" string. New callers use requestAgentReply,
   * which keeps a failure out of the conversation.
   *
   * `_patientRecord`, `_teamLog`, `_currentVitals` and `_activeCase` are kept
   * for callers' signatures and are no longer read.
   *
   * @returns {Promise<string>} never rejects
   */
  async sendAgentMessage(sessionId, agent, userMessage, _patientRecord, _teamLog, _currentVitals, conversationHistory = [], _activeCase = null, options = {}) {
    const { caseLanguage = null, channel = 'chat', callId = null } = options || {};
    const result = await this.requestAgentReply(sessionId, agent, userMessage, conversationHistory, { caseLanguage, channel, callId });
    if (result.ok) return result.content;
    const { kind, status, message } = result.error;
    if (kind === 'rate_limited') return `Rate limit exceeded: ${message}`;
    if (kind === 'unavailable') return `Service unavailable: ${message}`;
    const detail = status != null ? `LLM API Error (${status}): ${message}` : message;
    return `Error: Could not communicate with ${agent?.name}. ${detail}`;
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
