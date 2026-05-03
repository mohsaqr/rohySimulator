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

        // Defensive 60s watchdog: if no SSE event arrives in that window, abort
        // the fetch and surface a real error instead of leaving the chat bubble
        // empty forever. Reset on every chunk.
        const STREAM_IDLE_TIMEOUT_MS = 60_000;
        const watchdog = new AbortController();
        let watchdogTimer = null;
        const armWatchdog = () => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
            watchdogTimer = setTimeout(() => watchdog.abort(), STREAM_IDLE_TIMEOUT_MS);
        };
        const disarmWatchdog = () => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
            watchdogTimer = null;
        };

        // Combine the caller's signal (if any) with the watchdog so either can abort.
        const combined = signal
            ? AbortSignal.any?.([signal, watchdog.signal]) || watchdog.signal
            : watchdog.signal;

        const t0 = performance.now();
        let firstTokenAt = null;
        try {
            const body = {
                session_id: sessionId,
                messages,
                system_prompt: systemPrompt || 'You are a patient.',
                stream: true
            };
            if (sessionMode) body.session_mode = sessionMode;

            armWatchdog();
            const response = await fetch(apiUrl('/proxy/llm?stream=1'), {
                method: 'POST',
                headers: { ...this.getAuthHeaders(), 'Accept': 'text/event-stream' },
                body: JSON.stringify(body),
                signal: combined
            });

            if (!response.ok) {
                disarmWatchdog();
                const errText = await response.text();
                let detail = errText;
                try { detail = JSON.parse(errText).error || errText; } catch { /* not json */ }
                console.error(`[LLMService] HTTP ${response.status}:`, detail);
                return `Error: ${detail}`;
            }
            const ctype = response.headers.get('Content-Type') || '';
            if (!ctype.includes('text/event-stream')) {
                // Server didn't actually stream — fall back.
                disarmWatchdog();
                const data = await response.json().catch(() => ({}));
                const text = data.choices?.[0]?.message?.content || '';
                if (text) onDelta?.(text);
                return text;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffered = '';
            let acc = '';

            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    armWatchdog();   // reset idle timer on every chunk
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
                                if (firstTokenAt == null) {
                                    firstTokenAt = performance.now();
                                    console.log(`[LLMService] first token in ${Math.round(firstTokenAt - t0)}ms`);
                                }
                                acc += evt.delta;
                                onDelta?.(evt.delta);
                            }
                            // evt.done arrives just before [DONE] — nothing to do
                        }
                    }
                }
            } finally {
                // Without releaseLock the underlying response body stream stays
                // locked even after we throw / break, which holds the fetch
                // open and burns one of the browser's ~6 per-host connection
                // slots. Multiple errored streams → silent fetch starvation.
                try { reader.releaseLock(); } catch { /* already released */ }
            }
            disarmWatchdog();

            console.log(`[LLMService] full response in ${Math.round(performance.now() - t0)}ms (${acc.length} chars)`);
            this.logInteraction(sessionId, 'assistant', acc);
            return acc;
        } catch (err) {
            disarmWatchdog();
            if (err.name === 'AbortError') {
                if (watchdog.signal.aborted) {
                    return `Error: LLM did not respond within ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Check the server console for the actual upstream error (look for "[LLM Proxy]" lines).`;
                }
                return '';   // caller-initiated abort
            }
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
