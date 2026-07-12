/**
 * LLM service. Routes JSON sites through apiFetch; the streaming SSE path
 * still uses parseAs:'response' so it can read the body reader directly while
 * still benefiting from centralised auth header injection.
 */

import { ApiError, apiFetch, apiPost, apiPut } from './apiClient.js';

export const LLMService = {

    /**
     * Start a new Session for a Case
     */
    async startSession(caseId, studentName = 'Student', monitorSettings = {}) {
        try {
            const data = await apiPost('/sessions', {
                case_id: caseId,
                student_name: studentName,
                monitor_settings: monitorSettings
            });
            return data?.id ?? null;
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
            return await apiPut(`/sessions/${sessionId}/end`);
        } catch (err) {
            console.error('Failed to end session', err);
            return null;
        }
    },

    /**
     * Send Message to LLM via authenticated server proxy
     * Server handles LLM configuration and rate limiting
     */
    async sendMessage(sessionId, messages, systemPrompt, sessionMode, { caseLanguage = null } = {}) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'user') {
            await this.logInteraction(sessionId, 'user', lastMsg.content);
        }

        try {
            const body = {
                session_id: sessionId,
                messages,
                system_prompt: systemPrompt || 'You are a patient.'
            };
            if (sessionMode) body.session_mode = sessionMode;
            // Patient-dialogue language. The server appends the registry's
            // output-language directive (systemPromptAssembly) — the client
            // never injects it into system_prompt itself, or it would double.
            if (caseLanguage) body.case_language = caseLanguage;

            const data = await apiPost('/proxy/llm', body);
            const aiContent = data?.choices?.[0]?.message?.content || '...';
            await this.logInteraction(sessionId, 'assistant', aiContent);
            return aiContent;

        } catch (err) {
            if (err instanceof ApiError) {
                if (err.status === 429) {
                    console.warn('[LLMService] Rate limit exceeded:', err.body);
                    const resetsAt = err.body?.resetsAt;
                    return `Rate limit exceeded: ${err.message}. ${resetsAt ? `Resets at ${resetsAt}.` : ''}`;
                }
                if (err.status === 503) {
                    return `AI service unavailable: ${err.message || 'unknown'}`;
                }
                console.error(`[LLMService] ${err.status} from /proxy/llm:`, err.message);
                return `Error: ${err.message}`;
            }
            console.error('LLM Error', err);
            return 'Error: Could not connect to AI patient. Please check with your administrator.';
        }
    },

    /**
     * Streaming variant of sendMessage. Calls /proxy/llm with stream=1, parses
     * SSE deltas, and invokes onDelta(text) for each token chunk. Returns the
     * accumulated full text on completion. Falls back to non-streaming if the
     * server doesn't return text/event-stream.
     */
    async streamMessage(sessionId, messages, systemPrompt, sessionMode, { onDelta, signal, silent = false, agentTemplateId = null, persistInteractions = true, caseLanguage = null, studentAffect = null } = {}) {
        const lastMsg = messages[messages.length - 1];
        // `silent` lets callers (e.g. the discussion opening turn) suppress
        // the user-side /interactions write so meta-prompts and sentinels
        // don't show up labelled as learner utterances in audit / review.
        //
        // `persistInteractions=false` skips the /interactions writes entirely
        // (both user and assistant). The `interactions` table is the PATIENT
        // chat thread and carries no agent discriminator, so the debrief
        // discussant must not write there — it owns its own transcript via
        // agent_conversations (useDiscussionEngine.logTurn). Writing both
        // made the discussant conversation reappear in the patient chat on
        // restore (Bug 8, 16.5.2026 report).
        if (persistInteractions && !silent && lastMsg?.role === 'user') {
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
            // Patient-dialogue language — server-side directive injection,
            // same contract as sendMessage above.
            if (caseLanguage) body.case_language = caseLanguage;
            // Observed learner affect (Plan A). Structured signal only —
            // the server validates it against the canonical vocabulary and
            // renders the transient prompt block itself (shared/affectNote);
            // same append-on-the-server contract as case_language.
            if (studentAffect) body.student_affect = studentAffect;
            // Per-persona LLM routing. When the caller (patient chat,
            // discussant, any agent) passes a template id, the server reads
            // that template's llm_provider / llm_model / llm_api_key /
            // llm_endpoint and uses them in place of the platform defaults.
            // Resolution is intentionally two-tier — template → platform —
            // with no per-case, per-session, or per-user overlay. The voice
            // 5-tier resolver taught us what that costs.
            if (agentTemplateId) {
                body.agent_llm_config = { agent_template_id: agentTemplateId };
            }

            armWatchdog();
            const response = await apiFetch('/proxy/llm?stream=1', {
                method: 'POST',
                json: body,
                headers: { Accept: 'text/event-stream' },
                signal: combined,
                parseAs: 'response',
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
                disarmWatchdog();
                const data = await response.json().catch(() => ({}));
                const text = data?.choices?.[0]?.message?.content || '';
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
                    armWatchdog();
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
            if (persistInteractions) {
                this.logInteraction(sessionId, 'assistant', acc);
            }
            return acc;
        } catch (err) {
            disarmWatchdog();
            if (err.name === 'AbortError') {
                if (watchdog.signal.aborted) {
                    return `Error: LLM did not respond within ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Check the server console for the actual upstream error (look for "[LLM Proxy]" lines).`;
                }
                return '';
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
            return await apiFetch('/llm/usage');
        } catch (err) {
            console.error('Failed to get LLM usage:', err);
            return null;
        }
    },

    async logInteraction(sessionId, role, content) {
        if (!sessionId) return;
        try {
            await apiPost('/interactions', { session_id: sessionId, role, content });
        } catch (e) {
            console.error('Logging failed', e);
        }
    }
};
