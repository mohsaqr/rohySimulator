/**
 * AgentService - Manages multi-agent communication for the simulation
 *
 * Handles:
 * - Fetching agent configurations (templates, case-specific)
 * - Managing agent state (paging, arrival, departure)
 * - Building debriefing context for LLM calls
 * - Sending messages to agents
 * - Team communications log
 */

import { apiUrl } from '../config/api';

const API_URL = '/api';

export const AgentService = {
  /**
   * Get authentication headers
   */
  getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  // ==================== AGENT TEMPLATES ====================

  /**
   * Get all agent templates
   */
  async getTemplates() {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch agent templates');
      const data = await response.json();
      return data.templates || [];
    } catch (err) {
      console.error('[AgentService] getTemplates error:', err);
      return [];
    }
  },

  /**
   * Get single agent template
   */
  async getTemplate(templateId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates/${templateId}`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch agent template');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] getTemplate error:', err);
      return null;
    }
  },

  /**
   * Create new agent template (admin only)
   */
  async createTemplate(templateData) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(templateData)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create template');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] createTemplate error:', err);
      throw err;
    }
  },

  /**
   * Update agent template (admin only)
   */
  async updateTemplate(templateId, templateData) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates/${templateId}`), {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(templateData)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update template');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] updateTemplate error:', err);
      throw err;
    }
  },

  /**
   * Delete agent template (admin only)
   */
  async deleteTemplate(templateId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates/${templateId}`), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete template');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] deleteTemplate error:', err);
      throw err;
    }
  },

  /**
   * Duplicate an agent template
   */
  async duplicateTemplate(templateId, newName) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates/${templateId}/duplicate`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ name: newName })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to duplicate template');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] duplicateTemplate error:', err);
      throw err;
    }
  },

  /**
   * Test LLM configuration for an agent template
   */
  async testLLM(templateId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/agents/templates/${templateId}/test-llm`), {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || err.message || 'LLM test failed');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] testLLM error:', err);
      throw err;
    }
  },

  // ==================== CASE AGENTS ====================

  /**
   * Get agents configured for a case
   */
  async getCaseAgents(caseId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/cases/${caseId}/agents`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch case agents');
      const data = await response.json();
      return data.agents || [];
    } catch (err) {
      console.error('[AgentService] getCaseAgents error:', err);
      return [];
    }
  },

  /**
   * Add agent to case
   */
  async addAgentToCase(caseId, agentConfig) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/cases/${caseId}/agents`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(agentConfig)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to add agent to case');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] addAgentToCase error:', err);
      throw err;
    }
  },

  /**
   * Update case agent configuration
   */
  async updateCaseAgent(caseId, agentId, updates) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/cases/${caseId}/agents/${agentId}`), {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update case agent');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] updateCaseAgent error:', err);
      throw err;
    }
  },

  /**
   * Remove agent from case
   */
  async removeAgentFromCase(caseId, agentId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/cases/${caseId}/agents/${agentId}`), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to remove agent from case');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] removeAgentFromCase error:', err);
      throw err;
    }
  },

  /**
   * Add all default agents to a case
   */
  async addDefaultAgentsToCase(caseId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/cases/${caseId}/agents/add-defaults`), {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to add default agents');
      }
      return await response.json();
    } catch (err) {
      console.error('[AgentService] addDefaultAgentsToCase error:', err);
      throw err;
    }
  },

  // ==================== SESSION AGENTS (Runtime State) ====================

  /**
   * Get agents for a session with current state
   */
  async getSessionAgents(sessionId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch session agents');
      const data = await response.json();
      return data.agents || [];
    } catch (err) {
      console.error('[AgentService] getSessionAgents error:', err);
      return [];
    }
  },

  /**
   * Page an agent (request their presence)
   */
  async pageAgent(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/page`), {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to page agent');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] pageAgent error:', err);
      throw err;
    }
  },

  /**
   * Mark agent as arrived
   */
  async arriveAgent(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/arrive`), {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to arrive agent');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] arriveAgent error:', err);
      throw err;
    }
  },

  /**
   * Mark agent as departed
   */
  async departAgent(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/depart`), {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to depart agent');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] departAgent error:', err);
      throw err;
    }
  },

  /**
   * Get single agent status
   */
  async getAgentStatus(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/status`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to get agent status');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] getAgentStatus error:', err);
      return { status: 'absent' };
    }
  },

  // ==================== AGENT CONVERSATIONS ====================

  /**
   * Get conversation history with an agent
   */
  async getConversation(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/conversation`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch conversation');
      const data = await response.json();
      return data.messages || [];
    } catch (err) {
      console.error('[AgentService] getConversation error:', err);
      return [];
    }
  },

  /**
   * Add message to conversation (for logging)
   */
  async addMessage(sessionId, agentType, role, content) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/conversation`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ role, content })
      });
      if (!response.ok) throw new Error('Failed to add message');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] addMessage error:', err);
      throw err;
    }
  },

  /**
   * Clear conversation with an agent
   */
  async clearConversation(sessionId, agentType) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/agents/${agentType}/conversation`), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to clear conversation');
      return await response.json();
    } catch (err) {
      console.error('[AgentService] clearConversation error:', err);
      throw err;
    }
  },

  // ==================== TEAM COMMUNICATIONS ====================

  /**
   * Get team communications log
   */
  async getTeamCommunications(sessionId) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/team-communications`), {
        headers: this.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to fetch team communications');
      const data = await response.json();
      return data.log || [];
    } catch (err) {
      console.error('[AgentService] getTeamCommunications error:', err);
      return [];
    }
  },

  /**
   * Add entry to team communications log
   */
  async addTeamCommunication(sessionId, agentType, keyPoints) {
    try {
      const response = await fetch(apiUrl(`${API_URL}/sessions/${sessionId}/team-communications`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ agent_type: agentType, key_points: keyPoints })
      });
      if (!response.ok) throw new Error('Failed to add team communication');
      return await response.json();
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
  buildDebriefingContext(agent, patientRecord, teamLog, currentVitals) {
    const lines = [];

    // Parse memory_access if it's a string
    let memoryAccess = agent.memory_access;
    if (typeof memoryAccess === 'string') {
      try {
        memoryAccess = JSON.parse(memoryAccess);
      } catch {
        memoryAccess = null;
      }
    }
    // Default to full access if not specified
    if (!memoryAccess) {
      memoryAccess = {
        OBTAINED: true, EXAMINED: true, ELICITED: true, NOTED: true,
        ORDERED: true, ADMINISTERED: true, CHANGED: true, EXPRESSED: true
      };
    }

    // 1. Patient Overview (from PatientRecord)
    if (patientRecord) {
      lines.push('=== PATIENT BRIEFING ===');

      // Check if patientRecord has the getFilteredNarrative method (from PatientRecord class)
      if (patientRecord.getFilteredNarrative && typeof patientRecord.getFilteredNarrative === 'function') {
        // Get narrative filtered by memory access
        const allowedVerbs = Object.entries(memoryAccess)
          .filter(([_, allowed]) => allowed)
          .map(([verb]) => verb);
        const narrative = patientRecord.getFilteredNarrative('context', allowedVerbs);
        if (narrative) {
          lines.push(narrative);
        }
      } else if (patientRecord.toNarrative && typeof patientRecord.toNarrative === 'function') {
        // Use the narrative in context style for LLM consumption
        const narrative = patientRecord.toNarrative('context');
        if (narrative) {
          lines.push(narrative);
        }
      } else {
        // Fallback: basic info
        const patient = patientRecord.record?.patient;
        if (patient) {
          lines.push(`Patient: ${patient.name || 'Unknown'}, ${patient.age || '?'} y/o ${patient.gender || ''}`);
          if (patient.chief_complaint) {
            lines.push(`Chief Complaint: ${patient.chief_complaint}`);
          }
        }
      }
    }

    // 2. Current Vitals
    if (currentVitals) {
      lines.push('');
      lines.push('=== CURRENT VITALS ===');
      const vitalLabels = {
        hr: 'HR',
        spo2: 'SpO2',
        rr: 'RR',
        bpSys: 'BP Sys',
        bpDia: 'BP Dia',
        temp: 'Temp',
        etco2: 'ETCO2'
      };
      const vitalUnits = {
        hr: 'bpm',
        spo2: '%',
        rr: '/min',
        bpSys: 'mmHg',
        bpDia: 'mmHg',
        temp: '°C',
        etco2: 'mmHg'
      };
      Object.entries(currentVitals).forEach(([key, value]) => {
        if (vitalLabels[key] && value !== undefined) {
          lines.push(`${vitalLabels[key]}: ${value}${vitalUnits[key] || ''}`);
        }
      });
    }

    // 3. Team Communications (filtered by context_filter)
    if (teamLog && teamLog.length > 0) {
      // For 'history' filter, only show relevant communications
      // For 'full' filter, show all
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

  /**
   * Build full system prompt for an agent with debriefing
   */
  buildAgentSystemPrompt(agent, debriefingContext) {
    const parts = [];

    // 1. Agent's base system prompt
    parts.push(agent.system_prompt);

    // 2. Debriefing context
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
  async sendAgentMessage(sessionId, agent, userMessage, patientRecord, teamLog, currentVitals, conversationHistory = []) {
    try {
      // 1. Log user message
      await this.addMessage(sessionId, agent.agent_type, 'user', userMessage);

      // 2. Build debriefing context
      const debriefingContext = this.buildDebriefingContext(agent, patientRecord, teamLog, currentVitals);

      // 3. Build full system prompt
      const systemPrompt = this.buildAgentSystemPrompt(agent, debriefingContext);

      // 4. Build messages array for LLM
      const messages = [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      // 5. Send to LLM proxy - include agent LLM config if specified
      const requestBody = {
        session_id: sessionId,
        messages: messages,
        system_prompt: systemPrompt
      };

      // Pass agent-specific LLM config if the agent has override settings
      if (agent.llm_provider || agent.agent_template_id) {
        requestBody.agent_llm_config = {
          agent_template_id: agent.agent_template_id || agent.id,
          provider: agent.llm_provider,
          model: agent.llm_model,
          api_key: agent.llm_api_key,
          endpoint: agent.llm_endpoint
        };
      }

      const response = await fetch(apiUrl(`${API_URL}/proxy/llm`), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody)
      });

      // Handle rate limiting
      if (response.status === 429) {
        const errorData = await response.json();
        console.warn('[AgentService] Rate limit exceeded:', errorData);
        return `Rate limit exceeded: ${errorData.error}`;
      }

      // Handle service disabled
      if (response.status === 503) {
        const errorData = await response.json();
        return `Service unavailable: ${errorData.error}`;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const aiContent = data.choices?.[0]?.message?.content || '...';

      // 6. Log assistant response
      await this.addMessage(sessionId, agent.agent_type, 'assistant', aiContent);

      // 7. Extract key points for team log (simple extraction)
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
   * Extract key points from an agent's response for team log
   * Simple heuristic: first sentence or up to 100 chars
   */
  extractKeyPoints(content, agentType) {
    if (!content || content.length < 20) return null;

    // Find first sentence
    const firstSentence = content.match(/^[^.!?]*[.!?]/);
    if (firstSentence && firstSentence[0].length > 10) {
      return firstSentence[0].trim();
    }

    // Fallback: first 100 chars
    return content.substring(0, 100).trim() + '...';
  },

  // ==================== AVAILABILITY HELPERS ====================

  /**
   * Check if an agent is available based on elapsed time
   */
  isAgentAvailable(agent, elapsedMinutes) {
    // Check if enabled
    if (!agent.enabled) return false;

    // Check availability type
    switch (agent.availability_type) {
      case 'absent':
        return false;

      case 'on-call':
        // On-call agents are available but need to be paged
        return true;

      case 'present':
      default:
        // Check if past available_from_minute
        if (agent.available_from_minute > 0 && elapsedMinutes < agent.available_from_minute) {
          return false;
        }
        // Check if before depart_at_minute
        if (agent.depart_at_minute && elapsedMinutes >= agent.depart_at_minute) {
          return false;
        }
        return true;
    }
  },

  /**
   * Calculate wait time for a paged agent
   */
  calculateWaitTime(agent) {
    const min = agent.response_time_min || 0;
    const max = agent.response_time_max || 0;
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Get display status for an agent
   */
  getAgentDisplayStatus(agent, elapsedMinutes) {
    if (!agent.enabled) {
      return { status: 'disabled', label: 'Not Available', canChat: false, canPage: false };
    }

    // Check session state first
    if (agent.status === 'present') {
      return { status: 'present', label: 'Available', canChat: true, canPage: false };
    }

    if (agent.status === 'paged') {
      return { status: 'paged', label: 'On the way...', canChat: false, canPage: false };
    }

    if (agent.status === 'departed') {
      return { status: 'departed', label: 'Left', canChat: false, canPage: false };
    }

    // Check availability configuration
    if (agent.availability_type === 'absent') {
      return { status: 'absent', label: 'Not Available', canChat: false, canPage: false };
    }

    if (agent.availability_type === 'on-call') {
      return { status: 'on-call', label: 'On-Call', canChat: false, canPage: true };
    }

    // Present type - check time-based availability
    if (agent.available_from_minute > 0 && elapsedMinutes < agent.available_from_minute) {
      return {
        status: 'not-yet',
        label: `Available in ${agent.available_from_minute - elapsedMinutes} min`,
        canChat: false,
        canPage: false
      };
    }

    if (agent.depart_at_minute && elapsedMinutes >= agent.depart_at_minute) {
      return { status: 'departed', label: 'Left', canChat: false, canPage: false };
    }

    // Default: present and available
    return { status: 'present', label: 'Available', canChat: true, canPage: false };
  }
};

export default AgentService;
