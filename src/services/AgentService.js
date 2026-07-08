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
import { roleAnchor } from '../utils/roleAnchor.js';

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

  async addMessage(sessionId, agentType, role, content) {
    try {
      return await apiPost(`/sessions/${sessionId}/agents/${agentType}/conversation`, { role, content });
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
   * Build debriefing context for an agent
   * Combines patient record, team communications, and agent-specific filtering
   * Respects agent's memory_access configuration to filter patient record data
   */
  buildDebriefingContext(agent, patientRecord, teamLog, currentVitals, activeCase = null) {
    const lines = [];

    let memoryAccess = agent.memory_access;
    if (typeof memoryAccess === 'string') {
      try { memoryAccess = JSON.parse(memoryAccess); } catch { memoryAccess = null; }
    }
    if (!memoryAccess) {
      memoryAccess = {
        OBTAINED: true, EXAMINED: true, ELICITED: true, NOTED: true,
        ORDERED: true, ADMINISTERED: true, CHANGED: true, EXPRESSED: true
      };
    }

    const caseContext = buildDiscussionCaseContext(activeCase, agent.context_filter || 'full');
    if (caseContext) {
      lines.push(caseContext.trim());
    }

    if (patientRecord) {
      lines.push('=== PATIENT BRIEFING ===');

      if (patientRecord.getFilteredNarrative && typeof patientRecord.getFilteredNarrative === 'function') {
        const allowedVerbs = Object.entries(memoryAccess)
          .filter(([, allowed]) => allowed)
          .map(([verb]) => verb);
        const narrative = patientRecord.getFilteredNarrative('context', allowedVerbs);
        if (narrative) lines.push(narrative);
      } else if (patientRecord.toNarrative && typeof patientRecord.toNarrative === 'function') {
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

    if (currentVitals) {
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
      const relevantLogs = agent.context_filter === 'history'
        ? teamLog.filter(l => l.agent_type === 'relative' || l.agent_type === agent.agent_type)
        : teamLog;

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

  buildAgentSystemPrompt(agent, debriefingContext) {
    // Role anchor leads — see src/utils/roleAnchor.js. Pre-fix agent
    // prompts had no role anchor at all; an admin-authored agent template
    // that opened with weak or ambiguous text (or omitted any "you are"
    // line entirely) let the model drift into whatever role the
    // conversation history suggested. With the anchor, a nurse stays a
    // nurse, a consultant stays a consultant, regardless of what the
    // learner says.
    const anchor = roleAnchor({
      role: agent.role_title || agent.agent_type || 'team member',
      name: agent.name,
    });
    const parts = [anchor, agent.system_prompt || ''];
    if (debriefingContext) {
      parts.push('');
      parts.push('--- CURRENT SITUATION ---');
      parts.push(debriefingContext);
    }
    return parts.join('\n');
  },

  /**
   * Send a message to an agent via the LLM proxy
   * Handles the full flow: build context, send message, log response
   */
  async sendAgentMessage(sessionId, agent, userMessage, patientRecord, teamLog, currentVitals, conversationHistory = [], activeCase = null) {
    try {
      await this.addMessage(sessionId, agent.agent_type, 'user', userMessage);

      const debriefingContext = this.buildDebriefingContext(agent, patientRecord, teamLog, currentVitals, activeCase);
      const systemPrompt = this.buildAgentSystemPrompt(agent, debriefingContext);

      const messages = [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      const requestBody = {
        session_id: sessionId,
        messages,
        system_prompt: systemPrompt
      };

      // Per-persona LLM routing — send only the template id. The server
      // (proxy-routes.js) reads the template by id and applies its LLM
      // fields server-side; the client never forwards keys or endpoints.
      // Previously this block also passed provider/model/api_key/endpoint
      // from the client, but the agents API redacts api_key to "[redacted]"
      // before it reaches the browser, so the server would have made the
      // LLM call with that literal string — a latent failure mode if any
      // future code path ever populated `agent.llm_provider` client-side.
      const agentTemplateId = agent.agent_template_id || agent.id;
      if (agentTemplateId) {
        requestBody.agent_llm_config = { agent_template_id: agentTemplateId };
      }

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

      await this.addMessage(sessionId, agent.agent_type, 'assistant', aiContent);

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

  calculateWaitTime(agent) {
    const min = agent.response_time_min || 0;
    const max = agent.response_time_max || 0;
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

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
