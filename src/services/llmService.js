/**
 * Service to handle LLM communication and Backend persistence.
 * LLM configuration is now managed server-side by administrators.
 */

import { apiUrl } from "../config/api";

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
            const res = await fetch(apiUrl(`/sessions`), {
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
            const res = await fetch(apiUrl(`/sessions/${sessionId}/end`), {
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
    async sendMessage(sessionId, messages, systemPrompt, sessionMode) {
        // 1. Log User Message
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user') {
            await this.logInteraction(sessionId, 'user', lastMsg.content);
        }

        try {
            // 2. Call LLM via authenticated proxy
            // Server handles: LLM config, rate limiting, usage tracking
            const body = {
                session_id: sessionId,
                messages: messages,
                system_prompt: systemPrompt || 'You are a patient.'
            };
            if (sessionMode) body.session_mode = sessionMode;

            const response = await fetch(apiUrl(`/proxy/llm`), {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(body)
            });

            // Handle rate limiting
            if (response.status === 429) {
                const errorData = await response.json();
                console.warn('[LLMService] Rate limit exceeded:', errorData);
                return `Rate limit exceeded: ${errorData.error}. ${errorData.resetsAt ? `Resets at ${errorData.resetsAt}.` : ''}`;
            }

            // Handle service disabled / config error
            if (response.status === 503) {
                const errorData = await response.json().catch(() => ({}));
                return `AI service unavailable: ${errorData.error || 'unknown'}`;
            }

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[LLMService] ${response.status} from /proxy/llm:`, errText);
                // Return the actual server error so admins can see what's wrong.
                let detail = errText;
                try {
                    const j = JSON.parse(errText);
                    detail = j.error || j.message || errText;
                } catch { /* errText was not json */ }
                return `Error: ${detail}`;
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
     * Streaming variant of sendMessage. Calls /proxy/llm with stream=1, parses
     * SSE deltas, and invokes onDelta(text) for each token chunk. Returns the
     * accumulated full text on completion. Falls back to non-streaming if the
     * server doesn't return text/event-stream.
     */
    async streamMessage(sessionId, messages, systemPrompt, sessionMode, { onDelta, signal } = {}) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'user') {
            this.logInteraction(sessionId, 'user', lastMsg.content);
        }
        try {
            const body = {
                session_id: sessionId,
                messages,
                system_prompt: systemPrompt || 'You are a patient.',
                stream: true
            };
            if (sessionMode) body.session_mode = sessionMode;

            const response = await fetch(apiUrl('/proxy/llm?stream=1'), {
                method: 'POST',
                headers: { ...this.getAuthHeaders(), 'Accept': 'text/event-stream' },
                body: JSON.stringify(body),
                signal
            });

            if (!response.ok) {
                const errText = await response.text();
                let detail = errText;
                try { detail = JSON.parse(errText).error || errText; } catch { /* not json */ }
                return `Error: ${detail}`;
            }
            const ctype = response.headers.get('Content-Type') || '';
            if (!ctype.includes('text/event-stream')) {
                // Server didn't actually stream — fall back.
                const data = await response.json().catch(() => ({}));
                const text = data.choices?.[0]?.message?.content || '';
                if (text) onDelta?.(text);
                return text;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffered = '';
            let acc = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffered += decoder.decode(value, { stream: true });
                let sep;
                while ((sep = buffered.indexOf('\n\n')) >= 0) {
                    const block = buffered.slice(0, sep);
                    buffered = buffered.slice(sep + 2);
                    for (const line of block.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (dataStr === '[DONE]') continue;
                        let evt;
                        try { evt = JSON.parse(dataStr); } catch { continue; }
                        if (evt.delta) {
                            acc += evt.delta;
                            onDelta?.(evt.delta);
                        }
                        // evt.done arrives just before [DONE] — nothing to do
                    }
                }
            }

            this.logInteraction(sessionId, 'assistant', acc);
            return acc;
        } catch (err) {
            if (err.name === 'AbortError') return '';
            console.error('[LLMService] streamMessage error', err);
            return `Error: ${err.message}`;
        }
    },

    /**
     * Get current user's LLM usage
     */
    async getUsage() {
        try {
            const response = await fetch(apiUrl(`/llm/usage`), {
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
            await fetch(apiUrl(`/interactions`), {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({ session_id: sessionId, role, content })
            });
        } catch (e) {
            console.error('Logging failed', e);
        }
    }
};
