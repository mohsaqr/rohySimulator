// Phase 3 — llmService streaming + contract tests.
//
// Covers src/services/llmService.js — specifically the streaming path
// `streamMessage()` which POSTs to /api/proxy/llm?stream=1 and consumes
// an SSE body. Public surface under test:
//
//   LLMService.streamMessage(sessionId, messages, systemPrompt,
//                            sessionMode, { onDelta, signal })
//
// CONTRACT NOTES (locked from actual source behaviour, not idealised):
//
//   * The service THROWS `LLMError` on HTTP !ok, on a fetch rejection,
//     and on the stream idle timeout — it never resolves with an
//     error-shaped string. (Until 2026-08-30 it returned the literal
//     `Error: <detail>`; the debrief discussant never checked for that
//     prefix and spoke + persisted the sentinel as a tutor turn.)
//   * Caller-initiated abort (via the AbortSignal passed in `signal`)
//     resolves to '' (empty string), NOT a throw / rejection. The
//     watchdog-initiated abort returns a different "did not respond
//     within 60s" error string.
//   * Malformed JSON inside a `data:` SSE line is SILENTLY SKIPPED
//     (the `try { JSON.parse } catch { continue; }` branch). The
//     stream continues with subsequent valid events.
//   * `[DONE]` sentinel lines are ignored (no onDelta, no error).
//   * Body shape: { session_id, messages, system_prompt, stream:true,
//     session_mode? }. There is NO `provider` field in this codebase —
//     provider routing is server-side keyed off session_mode. We lock
//     "client does not invent a `provider` field" + "session_mode is
//     passed through verbatim when supplied".
//   * There is no separate `complete()` method. `streamMessage()`
//     itself returns the accumulated full text (concat of all deltas)
//     on success — that's the "complete" surface we lock.
//   * Auth header: Bearer <token> from localStorage; absent entirely
//     when no token is set.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LLMError, LLMService } from './llmService.js';

// ----- helpers -----------------------------------------------------------

/**
 * Build a Response whose body is a ReadableStream emitting the given
 * pre-encoded SSE chunks. Each chunk is enqueued as-is (caller is
 * responsible for the trailing \n\n delimiters that the parser needs).
 */
function sseResponse(chunks, { status = 200, contentType = 'text/event-stream' } = {}) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            for (const c of chunks) {
                controller.enqueue(encoder.encode(c));
            }
            controller.close();
        },
    });
    return new Response(stream, {
        status,
        headers: { 'Content-Type': contentType },
    });
}

/**
 * Build a Response whose body stream stays open until `release()` is
 * called. Useful for asserting abort behaviour mid-stream.
 */
function pendingSseResponse() {
    const encoder = new TextEncoder();
    let controllerRef;
    const stream = new ReadableStream({
        start(controller) {
            controllerRef = controller;
        },
    });
    return {
        response: new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        }),
        push(chunk) { controllerRef.enqueue(encoder.encode(chunk)); },
        close() { controllerRef.close(); },
    };
}

const SESSION_ID = 'sess-123';
const MESSAGES = [{ role: 'user', content: 'hello' }];
const SYSTEM_PROMPT = 'You are a patient.';

// ----- suite -------------------------------------------------------------

describe('LLMService.streamMessage', () => {
    let fetchMock;

    beforeEach(() => {
        // Always start with a clean localStorage and a fresh fetch stub.
        localStorage.clear();
        localStorage.setItem('token', 'test-jwt-token');
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        // Silence service's internal console.error/log noise.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // --- 1. Streaming consumption ---------------------------------------
    it('invokes onDelta for each SSE delta in order, then resolves with concatenation', async () => {
        // CONTRACT: deltas arrive in source order; streamMessage's return
        // value is the concatenation of every onDelta argument.
        fetchMock.mockImplementation((url) => {
            // First call (logInteraction for user msg) → just return ok.
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"Hel"}\n\n',
                'data: {"delta":"lo, "}\n\n',
                'data: {"delta":"world"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );

        expect(seen).toEqual(['Hel', 'lo, ', 'world']);
        expect(result).toBe('Hello, world');
    });

    it('handles multiple deltas split across a single network chunk', async () => {
        // CONTRACT: SSE parser must tolerate multiple `\n\n`-delimited
        // events arriving in one TCP/ReadableStream chunk.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"A"}\n\ndata: {"delta":"B"}\n\ndata: {"delta":"C"}\n\n',
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );

        expect(seen).toEqual(['A', 'B', 'C']);
        expect(result).toBe('ABC');
    });

    it('reassembles a single SSE event split across multiple network chunks', async () => {
        // CONTRACT: a `data:` line whose JSON straddles two enqueued
        // chunks must be parsed as one event once \n\n arrives.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"del',          // first half
                'ta":"split"}\n\n',     // second half + delimiter
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );

        expect(seen).toEqual(['split']);
        expect(result).toBe('split');
    });

    // --- 2. Abort handling ----------------------------------------------
    it('caller-initiated abort settles the call to empty string', async () => {
        // CONTRACT: aborting via the supplied signal returns '' (not a
        // throw, not the watchdog message). Verified by triggering abort
        // before the stream ever produces a token.
        const ac = new AbortController();
        const pending = pendingSseResponse();

        fetchMock.mockImplementation((url, init) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            // The service passes a combined AbortSignal in init.signal —
            // hook abort to reject the fetch with an AbortError, which
            // is what a real fetch implementation would do.
            return new Promise((resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
                // Never actually resolve unless aborted.
                setTimeout(() => resolve(pending.response), 10_000);
            });
        });

        const p = LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {}, signal: ac.signal }
        );
        // Abort on the next tick.
        queueMicrotask(() => ac.abort());

        const result = await p;
        expect(result).toBe('');
    });

    it('mid-stream abort stops consumption and yields no further onDelta calls', async () => {
        // CONTRACT: once the caller's signal aborts, the reader loop
        // unwinds and onDelta is not called for any further enqueued
        // chunks. We model this by handing the service a ReadableStream
        // whose pull() honours the combined AbortSignal: the first
        // pull yields one delta synchronously, the next pull blocks
        // until abort fires and then errors the stream (which is what
        // a real fetch+aborted-body would do).
        const ac = new AbortController();
        const encoder = new TextEncoder();
        let pulls = 0;

        fetchMock.mockImplementation((url, init) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            const stream = new ReadableStream({
                pull(controller) {
                    pulls += 1;
                    if (pulls === 1) {
                        controller.enqueue(encoder.encode('data: {"delta":"first"}\n\n'));
                        return;
                    }
                    // Subsequent pulls park until the signal aborts.
                    return new Promise((_, reject) => {
                        init.signal.addEventListener('abort', () => {
                            const err = new Error('aborted');
                            err.name = 'AbortError';
                            try { controller.error(err); } catch { /* ignore */ }
                            reject(err);
                        });
                    });
                },
            });
            return Promise.resolve(new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            }));
        });

        const seen = [];
        const p = LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t), signal: ac.signal }
        );

        // Give the reader a moment to process the first delta, then abort.
        await new Promise((r) => setTimeout(r, 30));
        ac.abort();

        const result = await p;
        // Already-emitted delta stays; no new ones after abort.
        expect(seen).toEqual(['first']);
        // Caller abort returns '' — accumulated text is discarded.
        expect(result).toBe('');
    });

    // --- 3. Provider / body routing -------------------------------------
    it('request body contains stream:true and the supplied session_mode (no invented "provider" field)', async () => {
        // CONTRACT: the client does not synthesise a `provider` field;
        // routing is keyed server-side off `session_mode` when present.
        // `stream: true` is always set.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, 'monitor',
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        expect(proxyCall).toBeDefined();
        const sentBody = JSON.parse(proxyCall[1].body);
        expect(sentBody).toMatchObject({
            session_id: SESSION_ID,
            messages: MESSAGES,
            system_prompt: SYSTEM_PROMPT,
            stream: true,
            session_mode: 'monitor',
        });
        expect(sentBody).not.toHaveProperty('provider');
    });

    it('forwards agent_llm_config.agent_template_id when caller passes agentTemplateId', async () => {
        // CONTRACT (post-v2.1.0): per-persona LLM routing. When the caller
        // (patient chat, discussant, any agent path) sends an
        // agentTemplateId, the body includes the canonical minimal payload
        // `agent_llm_config: { agent_template_id }`. The server reads the
        // template by id and applies its LLM fields server-side. The client
        // never forwards provider/model/api_key/endpoint.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, 'voice',
            { onDelta: () => {}, agentTemplateId: 42 }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        const sentBody = JSON.parse(proxyCall[1].body);
        expect(sentBody.agent_llm_config).toEqual({ agent_template_id: 42 });
        // Minimal payload — no client-side provider/model/api_key/endpoint.
        expect(sentBody.agent_llm_config).not.toHaveProperty('provider');
        expect(sentBody.agent_llm_config).not.toHaveProperty('model');
        expect(sentBody.agent_llm_config).not.toHaveProperty('api_key');
        expect(sentBody.agent_llm_config).not.toHaveProperty('endpoint');
    });

    it('omits agent_llm_config entirely when no agentTemplateId is passed', async () => {
        // CONTRACT: a falsy/null agentTemplateId means "use the platform
        // default LLM" — the field is absent from the body, not present
        // with a null value. Server treats absence as platform-default
        // resolution.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, 'voice',
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        const sentBody = JSON.parse(proxyCall[1].body);
        expect(sentBody).not.toHaveProperty('agent_llm_config');
    });

    it('omits session_mode entirely when caller does not pass one', async () => {
        // CONTRACT: falsy session_mode → field is not present at all
        // (server uses its default), not sent as null/undefined.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        const sentBody = JSON.parse(proxyCall[1].body);
        expect(sentBody).not.toHaveProperty('session_mode');
    });

    it('targets POST /api/proxy/llm?stream=1 with Accept: text/event-stream', async () => {
        // CONTRACT: streaming endpoint shape and headers are part of
        // the wire contract with the server proxy.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        expect(String(proxyCall[0])).toMatch(/\/api\/proxy\/llm\?stream=1$/);
        expect(proxyCall[1].method).toBe('POST');
        expect(proxyCall[1].headers).toMatchObject({
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json',
        });
    });

    // --- 4. Error response (HTTP !ok) -----------------------------------
    // Regression lock: a non-ok /proxy/llm response REJECTS with an LLMError
    // carrying the status. It used to resolve with the string "Error: …",
    // which the debrief discussant then spoke and persisted as a real tutor
    // turn (2026-08-30 UI review, #6). A sentinel a caller can forget to
    // check is not error handling.
    it('rejects with LLMError (status 500) when the server returns 500', async () => {
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(new Response(
                JSON.stringify({ error: 'upstream exploded' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            ));
        });

        const err = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        ).then(
            (value) => { throw new Error(`expected a rejection, resolved with ${JSON.stringify(value)}`); },
            (e) => e
        );
        expect(err).toBeInstanceOf(LLMError);
        expect(err.status).toBe(500);
        expect(err.message).toBe('upstream exploded');
        // And no "Error:"-shaped string anywhere in the message — the caller
        // must not be able to fall back to sniffing a prefix.
        expect(err.message.startsWith('Error:')).toBe(false);
    });

    it('uses raw response text as the rejection detail when the 500 body is not JSON', async () => {
        // CONTRACT: non-JSON error bodies reach the caller unchanged, on
        // the thrown LLMError rather than in a returned string.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(new Response('plain text death', { status: 500 }));
        });

        await expect(LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        )).rejects.toMatchObject({ name: 'LLMError', status: 500, message: 'plain text death' });
    });

    // --- 5. Network error (fetch rejection) -----------------------------
    // Regression lock: a transport failure rejects too — same contract as a
    // non-ok response, so no caller needs two failure shapes.
    it('rejects with LLMError when fetch itself rejects', async () => {
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.reject(new TypeError('network down'));
        });

        // apiFetch wraps transport failures with a "Network error:" prefix so
        // they're distinguishable from server-returned errors at a glance.
        await expect(LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        )).rejects.toMatchObject({ name: 'LLMError', message: 'Network error: network down' });
    });

    // --- 6. Empty stream -----------------------------------------------
    it('completes cleanly with empty string when server closes the stream immediately', async () => {
        // CONTRACT: a 200 text/event-stream response that immediately
        // closes (no events) yields '' and no onDelta calls.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([])); // empty body
        });

        const onDelta = vi.fn();
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta }
        );
        expect(result).toBe('');
        expect(onDelta).not.toHaveBeenCalled();
    });

    // --- 7. Malformed SSE chunk -----------------------------------------
    it('silently skips malformed JSON in a data: line and keeps consuming subsequent valid events', async () => {
        // CONTRACT: a `data:` line whose payload is not valid JSON is
        // dropped (try/catch with `continue`). The next valid event
        // still produces an onDelta. We lock SKIP semantics here.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"ok-before"}\n\n',
                'data: {not valid json\n\n',
                'data: {"delta":"ok-after"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );
        expect(seen).toEqual(['ok-before', 'ok-after']);
        expect(result).toBe('ok-beforeok-after');
    });

    it('ignores [DONE] sentinel without invoking onDelta', async () => {
        // CONTRACT: the literal string "[DONE]" inside `data:` is a
        // termination sentinel and must not be treated as a delta.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"x"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );
        expect(seen).toEqual(['x']);
        expect(result).toBe('x');
    });

    // --- 8. Auth header -------------------------------------------------
    it('sends Authorization: Bearer <token> on the streaming call', async () => {
        // CONTRACT: every authenticated call includes the Bearer token
        // sourced from localStorage('token').
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        expect(proxyCall[1].headers.Authorization).toBe('Bearer test-jwt-token');
    });

    it('omits Authorization header entirely when no token is in localStorage', async () => {
        // CONTRACT: getAuthHeaders only sets Authorization when the
        // token exists; absence is meaningful (anonymous request).
        localStorage.removeItem('token');
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        );

        const proxyCall = fetchMock.mock.calls.find(
            ([u]) => String(u).includes('/proxy/llm')
        );
        expect(proxyCall[1].headers).not.toHaveProperty('Authorization');
    });

    // --- 9. Token accumulation ------------------------------------------
    it('return value equals the concatenation of every emitted delta (the "complete()" surface)', async () => {
        // CONTRACT: there is no separate complete() method — the
        // resolved value of streamMessage IS the full accumulated text.
        // Lock equality with the join of streamed tokens.
        const tokens = ['The ', 'quick ', 'brown ', 'fox', '.'];
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                ...tokens.map((t) => `data: ${JSON.stringify({ delta: t })}\n\n`),
                'data: [DONE]\n\n',
            ]));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );
        expect(result).toBe(seen.join(''));
        expect(result).toBe(tokens.join(''));
    });

    // --- 10. Non-streaming fallback (bonus contract) --------------------
    it('falls back to choices[0].message.content when server replies application/json', async () => {
        // CONTRACT: if the server doesn't honour the streaming request
        // (Content-Type != text/event-stream), the client parses the
        // JSON body and surfaces .choices[0].message.content via one
        // synthesised onDelta call, then returns the same string.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(new Response(
                JSON.stringify({ choices: [{ message: { content: 'fallback text' } }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            ));
        });

        const seen = [];
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: (t) => seen.push(t) }
        );
        expect(result).toBe('fallback text');
        expect(seen).toEqual(['fallback text']);
    });

    // --- 11. silent: true suppresses user-side /interactions write ------
    it('skips logInteraction for the user turn when silent: true', async () => {
        // CONTRACT: discussion openings + meta-prompt sentinels are sent
        // to the model but should NOT appear in the audit/review trail
        // labelled as learner utterances. `silent: true` suppresses the
        // user-side /interactions POST while still sending the prompt
        // through to /proxy/llm. The assistant-turn log still fires.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"answer"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {}, silent: true }
        );

        const interactionCalls = fetchMock.mock.calls.filter(
            ([u]) => String(u).includes('/interactions')
        );
        // No user-turn write under silent. The assistant log path is
        // async and fire-and-forget, but if it fires it would be the
        // only /interactions call — and its body would be role:'assistant'.
        for (const [, init] of interactionCalls) {
            const body = init?.body ? JSON.parse(init.body) : {};
            expect(body.role).not.toBe('user');
        }
    });

    it('still logs the user turn (role:"user") when silent is omitted', async () => {
        // CONTRACT counterpart: default behaviour must log. This locks
        // the regression direction — if the default flipped to silent,
        // every normal chat message would silently drop out of audit.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"answer"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: () => {} }
        );

        const userTurnCall = fetchMock.mock.calls.find(([u, init]) => {
            if (!String(u).includes('/interactions')) return false;
            try { return JSON.parse(init?.body || '{}').role === 'user'; }
            catch { return false; }
        });
        expect(userTurnCall).toBeDefined();
    });

    // --- 12. persistInteractions:false writes NOTHING to /interactions ---
    it('skips BOTH user and assistant /interactions writes when persistInteractions:false (Bug 8)', async () => {
        // CONTRACT: the debrief discussant owns its transcript via
        // agent_conversations. It must never touch the patient `interactions`
        // thread, or the debrief reappears in the patient chat on restore.
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(sseResponse([
                'data: {"delta":"debrief reply"}\n\n',
                'data: [DONE]\n\n',
            ]));
        });

        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, 'discussion',
            { onDelta: () => {}, persistInteractions: false }
        );

        const interactionCalls = fetchMock.mock.calls.filter(
            ([u]) => String(u).includes('/interactions')
        );
        expect(interactionCalls).toHaveLength(0);
    });
    // --- Machine codes for translatable bubbles ---------------------------
    // Regression lock: a service module has no t(), so the failures it
    // recognises must be tagged with a machine `code` (+ any values the
    // message interpolates) for the component to render in the viewer's
    // language. Before 2026-08-30 the English prose WAS the contract and the
    // patient bubble read English in all six locales (UI review #24d).
    it('tags a transport failure with code cannot_connect', async () => {
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.reject(new TypeError('Failed to fetch'));
        });

        const err = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null, { onDelta: () => {} }
        ).then(
            (value) => { throw new Error(`expected a rejection, resolved with ${JSON.stringify(value)}`); },
            (e) => e
        );
        expect(err).toBeInstanceOf(LLMError);
        expect(err.code).toBe('cannot_connect');
    });

    it('leaves server-supplied failures uncoded so their text is shown verbatim', async () => {
        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            return Promise.resolve(new Response(
                JSON.stringify({ error: 'upstream exploded' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            ));
        });

        const err = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null, { onDelta: () => {} }
        ).then(
            (value) => { throw new Error(`expected a rejection, resolved with ${JSON.stringify(value)}`); },
            (e) => e
        );
        expect(err.code).toBeNull();
        expect(err.message).toBe('upstream exploded');
    });
});
