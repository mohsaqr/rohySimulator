/**
 * Service to handle LLM communication and Backend persistence.
 * LLM configuration is now managed server-side by administrators.
 */

const BACKEND_URL = '/api';

export const LLMService = {

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

    /**
     * Start a new Session for a Case
     */
    async startSession(caseId, studentName = 'Student', monitorSettings = {}) {
        try {
            const res = await fetch(`${BACKEND_URL}/sessions`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({
                    case_id: caseId,
                    student_name: studentName,
                    monitor_settings: monitorSettings
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to start session');
            }
            return data.id; // Session ID
        } catch (err) {
            console.error('Failed to start session', err);
            return null;
        }
    },

    /**
     * End a session
     */
    async endSession(sessionId) {
        try {
            const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}/end`, {
                method: 'PUT',
                headers: this.getAuthHeaders()
            });
            if (!res.ok) {
                throw new Error('Failed to end session');
            }
            return await res.json();
        } catch (err) {
            console.error('Failed to end session', err);
            return null;
        }
    },

    /**
     * Send Message to LLM via authenticated server proxy
     * Server handles LLM configuration and rate limiting
     */
    async sendMessage(sessionId, messages, systemPrompt) {
        // 1. Log User Message
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user') {
            await this.logInteraction(sessionId, 'user', lastMsg.content);
        }

        try {
            // 2. Call LLM via authenticated proxy
            // Server handles: LLM config, rate limiting, usage tracking
            const response = await fetch(`${BACKEND_URL}/proxy/llm`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({
                    session_id: sessionId,
                    messages: messages,
                    system_prompt: systemPrompt || 'You are a patient.'
                })
            });

            // Handle rate limiting
            if (response.status === 429) {
                const errorData = await response.json();
                console.warn('[LLMService] Rate limit exceeded:', errorData);
                return `Rate limit exceeded: ${errorData.error}. ${errorData.resetsAt ? `Resets at ${errorData.resetsAt}.` : ''}`;
            }

            // Handle service disabled
            if (response.status === 503) {
                const errorData = await response.json();
                return `AI service unavailable: ${errorData.error}`;
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`LLM API Error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            const aiContent = data.choices?.[0]?.message?.content || '...';

            // 3. Log Assistant Response
            await this.logInteraction(sessionId, 'assistant', aiContent);

            return aiContent;

        } catch (err) {
            console.error('LLM Error', err);
            return "Error: Could not connect to AI patient. Please check with your administrator.";
        }
    },

    /**
     * Get current user's LLM usage
     */
    async getUsage() {
        try {
            const response = await fetch(`${BACKEND_URL}/llm/usage`, {
                headers: this.getAuthHeaders()
            });
            if (!response.ok) {
                throw new Error('Failed to get usage');
            }
            return await response.json();
        } catch (err) {
            console.error('Failed to get LLM usage:', err);
            return null;
        }
    },

    async logInteraction(sessionId, role, content) {
        if (!sessionId) return;
        try {
            await fetch(`${BACKEND_URL}/interactions`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({ session_id: sessionId, role, content })
            });
        } catch (e) {
            console.error('Logging failed', e);
        }
    }
};
