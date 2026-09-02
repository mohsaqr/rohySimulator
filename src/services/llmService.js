/**
 * LLM service. Routes JSON sites through apiFetch; the streaming SSE path
 * still uses parseAs:'response' so it can read the body reader directly while
 * still benefiting from centralised auth header injection.
 */

import { ApiError, apiFetch, apiPost, apiPut } from './apiClient.js';

/**
 * A failed LLM call. THROWN, never returned.
 *
 * This module used to signal failure by RETURNING the string
 * `Error: <detail>` and leaving every caller to sniff it with
 * `startsWith('Error:')`. The patient chat did that check; the debrief
 * discussant did not — so an upstream 500 was rendered as ordinary tutor
 * speech and written into `agent_conversations` as a real turn, where it
 * replayed on restore and polluted the analytics (2026-08-30 UI review, #6).
 * A sentinel a caller may forget to check is not error handling. Failure is
 * a rejection now, so forgetting to handle it is loud instead of silent.
 *
 * `status` is the HTTP status when the failure came from the proxy;
 * null for transport failures and the stream idle timeout.
 *
 * `code` is a MACHINE code for the failures this module itself recognises
 * ('rate_limited' | 'service_unavailable' | 'cannot_connect' | 'timeout').
 * A service module has no `t()` — the code is what lets the component that
 * renders the bubble show the message in the viewer's language instead of
 * this file's English (2026-08-30 UI review, #24d). `message` stays English
 * for logs; a failure with no `code` carries server-supplied text and is
 * shown verbatim. `meta` carries the values those messages interpolate.
 */
export class LLMError extends Error {
    constructor(message, { status = null, detail = null, cause = null, code = null, meta = null } = {}) {
        super(message);
        this.name = 'LLMError';
        this.status = status;
        this.detail = detail ?? message;
        this.code = code;
        this.meta = meta ?? {};
        if (cause) this.cause = cause;
    }
}

// What the model is sent: role and content, nothing else. The client's
// message objects carry bookkeeping (`source`, `error`) that must never
// reach a provider — strict OpenAI-compatible servers reject unknown
// message properties, and the rest silently accept them.
export function wireMessages(messages) {
    return (messages ?? []).map(({ role, content }) => ({ role, content }));
}

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
     *
     * Throws {@link LLMError} on any failure (same contract as
     * streamMessage) — there is no error-shaped return value.
     */
    async sendMessage(sessionId, messages, systemPrompt, sessionMode, { caseLanguage = null } = {}) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'user') {
            await this.logInteraction(sessionId, 'user', lastMsg.content);
        }

        try {
            const body = {
                session_id: sessionId,
                messages: wireMessages(messages),
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
                    throw new LLMError(
                        `Rate limit exceeded: ${err.message}.${resetsAt ? ` Resets at ${resetsAt}.` : ''}`,
                        { status: 429, cause: err, code: 'rate_limited', meta: { resetsAt: resetsAt || null } }
                    );
                }
                if (err.status === 503) {
                    throw new LLMError(`AI service unavailable: ${err.message || 'unknown'}`, { status: 503, cause: err, code: 'service_unavailable' });
                }
                console.error(`[LLMService] ${err.status} from /proxy/llm:`, err.message);
                throw new LLMError(err.message, { status: err.status, cause: err });
            }
            console.error('LLM Error', err);
            throw new LLMError('Could not connect to AI patient. Please check with your administrator.', { cause: err, code: 'cannot_connect' });
        }
    },

    /**
     * Streaming variant of sendMessage. Calls /proxy/llm with stream=1, parses
     * SSE deltas, and invokes onDelta(text) for each token chunk. Returns the
     * accumulated full text on completion. Falls back to non-streaming if the
     * server doesn't return text/event-stream.
     *
     * FAILURE CONTRACT: rejects with {@link LLMError} on a non-ok response, a
     * transport failure, or the stream idle timeout. It NEVER resolves with an
     * error-shaped string — a caller that renders the resolved value is
     * therefore guaranteed to be rendering model output, and a caller that
     * persists it is guaranteed to be persisting a real turn.
     * Caller-initiated abort (the `signal` option) still resolves with '' —
     * that is a cancellation, not a failure.
     */
    async streamMessage(sessionId, messages, systemPrompt, sessionMode, { onDelta, signal, silent = false, agentTemplateId = null, persistInteractions = true, caseLanguage = null, studentAffect = null, source = null } = {}) {
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
            this.logInteraction(sessionId, 'user', lastMsg.content, source);
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
                messages: wireMessages(messages),
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
                throw new LLMError(detail, { status: response.status, detail });
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
                this.logInteraction(sessionId, 'assistant', acc, source);
            }
            return acc;
        } catch (err) {
            disarmWatchdog();
            // The non-ok branch above throws from inside this try — pass it
            // through untouched so its status survives to the caller.
            if (err instanceof LLMError) throw err;
            if (err.name === 'AbortError') {
                if (watchdog.signal.aborted) {
                    throw new LLMError(
                        `LLM did not respond within ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Check the server console for the actual upstream error (look for "[LLM Proxy]" lines).`,
                        { cause: err, code: 'timeout', meta: { seconds: STREAM_IDLE_TIMEOUT_MS / 1000 } }
                    );
                }
                // Caller cancelled (left the room, sent again) — not a failure.
                return '';
            }
            console.error('[LLMService] streamMessage error', err);
            // apiFetch turns "the request never left the browser" into an
            // ApiError with code 'NETWORK' (status 0). Same user-visible
            // situation as the non-stream transport failure above, so it
            // carries the same translatable code.
            const transport = err?.code === 'NETWORK' || err instanceof TypeError;
            throw new LLMError(err.message, {
                status: err.status ?? null,
                cause: err,
                code: transport ? 'cannot_connect' : null,
            });
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

    // `source` says where a turn came from — 'typed', 'voice' (the chat's
    // microphone) or a plugin room id — so the educator's transcript and the
    // analytics can tell a typed question from a spoken one. Null = unknown,
    // which is what every row before the column existed reads as.
    async logInteraction(sessionId, role, content, source = null) {
        if (!sessionId) return;
        try {
            await apiPost('/interactions', { session_id: sessionId, role, content, ...(source ? { source } : {}) });
        } catch (e) {
            console.error('Logging failed', e);
        }
    }
};
