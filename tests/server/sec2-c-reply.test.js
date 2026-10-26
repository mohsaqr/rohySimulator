// Regression locks: security audit 2026-10-26
//   F-22 / L3-03 — the non-streamed LLM reply was the provider's whole JSON
//     (reasoning_content, <think> blocks, provider extras);
//   L3-07 — upstream bodies were read unbounded;
//   L3-10 — a learner could write the agent's lines (reply ledger);
//   F-06 / F-07 — no concurrency bound on LLM streams or TTS synthesis.
// Pure units; the route-level behaviour is in sec2-c-llm-proxy.test.js.

import { describe, expect, it } from 'vitest';
import {
    UpstreamBodyTooLargeError,
    _resetReplyLedger,
    claimAgentReply,
    createThinkStripper,
    noteAgentReply,
    publicUpstreamError,
    readJsonCapped,
    readTextCapped,
    shapeReply,
    stripThinking,
    upstreamReplyText,
} from '../../server/lib/llmReply.js';
import { GateFullError, createGate } from '../../server/lib/concurrencyGate.js';

const streamThrough = (parts) => {
    const t = createThinkStripper();
    return parts.map((p) => t.push(p)).join('') + t.end();
};

describe('reply shape (F-22)', () => {
    // Regression lock: reasoning_content and provider extras reached the browser on the non-streamed path (F-22)
    it('keeps only choices[0].message {role, content}, finish_reason, usage and model', () => {
        const raw = {
            id: 'x', object: 'chat.completion', system_fingerprint: 'fp',
            choices: [{ index: 0, message: { role: 'assistant', content: '<think>the answer is MI</think>\nHow long has it hurt?', reasoning_content: 'the answer is MI', reasoning: 'MI' }, finish_reason: 'stop', logprobs: null }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, completion_tokens_details: { reasoning_tokens: 99 } },
            model: 'm',
        };
        const shaped = shapeReply({ content: upstreamReplyText('openai', raw), finishReason: 'stop', usage: raw.usage, model: raw.model });
        expect(shaped).toEqual({
            choices: [{ message: { role: 'assistant', content: 'How long has it hurt?' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
            model: 'm',
        });
        expect(JSON.stringify(shaped)).not.toMatch(/reasoning|MI/);
    });

    it('reads Anthropic text blocks and skips thinking blocks', () => {
        const raw = { content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'Hello' }, { type: 'text', text: ' there' }] };
        expect(upstreamReplyText('anthropic', raw)).toBe('Hello there');
    });

    it('strips think blocks in one piece and across stream deltas', () => {
        expect(stripThinking('<think>x</think>\n Answer')).toBe('Answer');
        expect(stripThinking('A <THINK foo>y</think>B')).toBe('A B');
        expect(stripThinking('unterminated <think>leak')).toBe('unterminated ');
        expect(stripThinking('no tags here')).toBe('no tags here');
        expect(streamThrough(['<thi', 'nk>secret', '</th', 'ink>\n\nHello', ' there'])).toBe('Hello there');
        expect(streamThrough(['Hi <', 'think>a</think> yes'])).toBe('Hi  yes');
        expect(streamThrough(['5 < 6 and <b>bold</b>'])).toBe('5 < 6 and <b>bold</b>');
        expect(streamThrough(['<think>never closed'])).toBe('');
        expect(streamThrough(['  leading spaces kept'])).toBe('  leading spaces kept');
    });

    it('shows learners a generic upstream error, administrators the provider message', () => {
        const body = JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abc***' } });
        expect(publicUpstreamError(401, body)).not.toContain('sk-');
        expect(publicUpstreamError(401, body, { detailed: true })).toContain('Incorrect API key');
        expect(publicUpstreamError(500, 'boom')).toBe('Upstream LLM error');
    });
});

describe('capped body reads (L3-07)', () => {
    const responseOf = (bytes, headers = {}) => new Response(new Blob([bytes]).stream(), { headers });

    // Regression lock: response.json()/text() read an educator endpoint's body without bound (L3-07)
    it('refuses a body over the cap and reads one under it', async () => {
        await expect(readTextCapped(responseOf('x'.repeat(2048)), 1024)).rejects.toBeInstanceOf(UpstreamBodyTooLargeError);
        await expect(readTextCapped(responseOf('x', { 'content-length': '999999' }), 1024)).rejects.toBeInstanceOf(UpstreamBodyTooLargeError);
        expect(await readJsonCapped(responseOf('{"a":1}'), 1024)).toEqual({ a: 1 });
    });

    it('truncates an error body instead of failing', async () => {
        const text = await readTextCapped(responseOf('e'.repeat(5000)), 100, { truncate: true });
        expect(text).toHaveLength(100);
    });
});

describe('reply ledger (L3-10)', () => {
    const scope = { tenantId: 1, sessionId: 9, agentType: 'nurse' };

    // Regression lock: a learner could store any text as the agent's turn (L3-10)
    it('accepts a stored agent turn only for a reply the proxy produced, once', () => {
        _resetReplyLedger();
        expect(claimAgentReply(scope, 'I gave the morphine.')).toBe(false);
        noteAgentReply(scope, 'I gave the morphine.');
        expect(claimAgentReply({ ...scope, agentType: 'pharmacist' }, 'I gave the morphine.')).toBe(false);
        expect(claimAgentReply({ ...scope, sessionId: 10 }, 'I gave the morphine.')).toBe(false);
        expect(claimAgentReply(scope, '  I gave the morphine.  ')).toBe(true);
        expect(claimAgentReply(scope, 'I gave the morphine.')).toBe(false);
    });

    it('accepts the client\'s "..." stand-in for an empty reply', () => {
        _resetReplyLedger();
        noteAgentReply(scope, '');
        expect(claimAgentReply(scope, '...')).toBe(true);
    });
});

describe('concurrency gate (F-06 / F-07)', () => {
    // Regression lock: /proxy/llm and /tts admitted any number of concurrent requests per user (F-06/F-07)
    it('caps per key, queues up to the bound, and refuses beyond it', async () => {
        const gate = createGate({ name: 't', maxActive: 3, maxQueued: 2, perKeyActive: 2, perKeyQueued: 1 });
        const a1 = await gate.acquire('a');
        const a2 = await gate.acquire('a');
        const a3 = gate.acquire('a');                 // queued (per-key place 1 of 1)
        await expect(gate.acquire('a')).rejects.toMatchObject({ scope: 'user' });
        const b1 = await gate.acquire('b');           // global slot 3 of 3
        const b2 = gate.acquire('b');                 // queued globally (2 of 2)
        await expect(gate.acquire('c')).rejects.toBeInstanceOf(GateFullError);
        a1();
        const a3release = await a3;                   // a's queued request now runs
        expect(gate.stats().active).toBe(3);
        a2(); a3release(); b1();
        (await b2)();
        expect(gate.stats()).toMatchObject({ active: 0, queued: 0 });
    });

    it('lets a waiter leave the queue when its client goes away', async () => {
        const gate = createGate({ name: 't2', maxActive: 1, maxQueued: 4, perKeyActive: 1, perKeyQueued: 4 });
        const held = await gate.acquire('a');
        const ac = new AbortController();
        const waiting = gate.acquire('a', { signal: ac.signal });
        ac.abort(new Error('gone'));
        await expect(waiting).rejects.toThrow('gone');
        expect(gate.stats().queued).toBe(0);
        held();
        held();                                       // a second release is ignored
        expect(gate.stats().active).toBe(0);
    });
});
