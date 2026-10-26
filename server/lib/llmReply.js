// What of a provider's answer reaches the browser, and how much of it the
// server will read.
//
// Security audit 2026-10-26:
//   F-22 / L3-03 — the non-streamed path returned the upstream JSON whole,
//     including `reasoning_content` / `reasoning` (a reasoning model's private
//     chain of thought, which may restate the persona prompt and the case's
//     answer) and any `<think>…</think>` block in the content; the specialist
//     reply guard checked `message.content` only. The reply is now rebuilt
//     from scratch: `{ choices: [{ message: { role, content }, finish_reason }],
//     usage, model }`, with think blocks removed from the content, on both the
//     streamed and the non-streamed path.
//   L3-07 — upstream bodies were read unbounded (`response.json()`,
//     `response.text()`, the SSE buffer). An endpoint an educator typed could
//     send gigabytes into this process. Reads are capped.
//   L3-10 — a reply the proxy produced is remembered (a digest, in memory) so
//     the conversation routes can tell a real agent turn from one a learner
//     wrote themselves.

import crypto from 'node:crypto';

/** Largest upstream JSON body the non-streamed path will read. */
export const MAX_UPSTREAM_JSON_BYTES = 2 * 1024 * 1024;
/** Largest upstream error body read (only for the log). */
export const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;
/** Largest single SSE event the stream parser will buffer. */
export const MAX_SSE_BUFFER_CHARS = 1024 * 1024;
/** Most reply text one streamed answer may carry before it is cut off. */
export const MAX_STREAM_REPLY_CHARS = 400_000;

export class UpstreamBodyTooLargeError extends Error {
    constructor(limit) {
        super(`upstream body exceeds ${limit} bytes`);
        this.name = 'UpstreamBodyTooLargeError';
        this.code = 'UPSTREAM_TOO_LARGE';
        this.limit = limit;
    }
}

/**
 * Read a fetch Response body as text, at most `maxBytes`. Over the cap the
 * body is cancelled and UpstreamBodyTooLargeError is thrown — unless
 * `truncate` is set, in which case the first `maxBytes` are returned (for
 * error bodies, which are only logged).
 */
export async function readTextCapped(response, maxBytes, { truncate = false } = {}) {
    if (!response?.body) return '';
    const declared = Number(response.headers?.get?.('content-length'));
    if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
        try { await response.body.cancel(); } catch { /* already closed */ }
        throw new UpstreamBodyTooLargeError(maxBytes);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            if (truncate) {
                chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
                try { await reader.cancel(); } catch { /* already closed */ }
                break;
            }
            try { await reader.cancel(); } catch { /* already closed */ }
            throw new UpstreamBodyTooLargeError(maxBytes);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

/** Read and parse a capped JSON body. A body that is not JSON throws SyntaxError. */
export async function readJsonCapped(response, maxBytes = MAX_UPSTREAM_JSON_BYTES) {
    return JSON.parse(await readTextCapped(response, maxBytes));
}

const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const THINK_OPEN_TO_END = /<think\b[^>]*>[\s\S]*$/i;

/** Remove `<think>…</think>` blocks (and an unterminated trailing one) from a reply. */
export function stripThinking(text) {
    if (typeof text !== 'string' || !text) return typeof text === 'string' ? text : '';
    const out = text.replace(THINK_BLOCK, '').replace(THINK_OPEN_TO_END, '');
    return out === text ? text : out.replace(/^\s+/, '');
}

/**
 * The same, for a stream: push() each delta, get back what may be written.
 * A tag split across deltas is held until it can be decided; text inside a
 * think block is never returned. end() flushes a held partial tag that turned
 * out not to be one.
 */
export function createThinkStripper() {
    let inThink = false;
    let held = '';
    let atStart = true;
    let sawThink = false;
    const OPEN = '<think';
    const CLOSE = '</think';
    const lowerIndex = (s, needle) => s.toLowerCase().indexOf(needle);
    // Does `s` end with a prefix of `needle`? Returns its length.
    const partialSuffix = (s, needle) => {
        const lower = s.toLowerCase();
        for (let n = Math.min(needle.length, lower.length); n > 0; n--) {
            if (needle.startsWith(lower.slice(lower.length - n))) return n;
        }
        return 0;
    };
    function push(delta) {
        let s = held + String(delta ?? '');
        held = '';
        let out = '';
        while (s) {
            if (inThink) {
                const at = lowerIndex(s, CLOSE);
                if (at === -1) { held = s.slice(s.length - partialSuffix(s, CLOSE)); return finish(out); }
                const gt = s.indexOf('>', at);
                if (gt === -1) { held = s.slice(at); return finish(out); }
                s = s.slice(gt + 1);
                inThink = false;
                continue;
            }
            const at = lowerIndex(s, OPEN);
            if (at === -1) {
                const keep = partialSuffix(s, OPEN);
                out += s.slice(0, s.length - keep);
                held = s.slice(s.length - keep);
                return finish(out);
            }
            const gt = s.indexOf('>', at);
            if (gt === -1) { out += s.slice(0, at); held = s.slice(at); return finish(out); }
            out += s.slice(0, at);
            s = s.slice(gt + 1);
            inThink = true;
            sawThink = true;
        }
        return finish(out);
    }
    // Whitespace a think block leaves at the very start of the reply is
    // dropped, as stripThinking does; a reply with no think block is untouched.
    function finish(out) {
        if (!atStart) return out;
        const trimmed = sawThink || inThink ? out.replace(/^\s+/, '') : out;
        if (trimmed) atStart = false;
        return trimmed;
    }
    function end() {
        const rest = inThink ? '' : held;
        held = '';
        return finish(rest);
    }
    return { push, end };
}

/**
 * The browser-facing shape of a non-streamed reply, built from scratch.
 * `content` has think blocks removed; nothing else of the upstream body passes.
 */
export function shapeReply({ content, finishReason, usage, model }) {
    return {
        choices: [{
            message: { role: 'assistant', content: stripThinking(typeof content === 'string' ? content : '') },
            finish_reason: typeof finishReason === 'string' ? finishReason : 'stop',
        }],
        usage: {
            prompt_tokens: Number(usage?.prompt_tokens) || 0,
            completion_tokens: Number(usage?.completion_tokens) || 0,
            total_tokens: Number(usage?.total_tokens) || 0,
        },
        model: typeof model === 'string' ? model : null,
    };
}

/** The assistant text of an OpenAI-compatible or Anthropic non-streamed body. */
export function upstreamReplyText(provider, raw) {
    if (provider === 'anthropic') {
        const blocks = Array.isArray(raw?.content) ? raw.content : [];
        return blocks.filter((b) => b?.type === 'text' || b?.type === undefined).map((b) => (typeof b?.text === 'string' ? b.text : '')).join('');
    }
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return '';
}

/**
 * The message an upstream failure may show the person who asked. Learners get
 * a generic sentence by status class; administrators get the provider's own
 * short message (it is how they debug a key or model typo). The detail is
 * always logged by the caller.
 */
export function publicUpstreamError(status, errText, { detailed = false } = {}) {
    if (detailed) {
        try {
            const parsed = JSON.parse(errText);
            const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
            if (typeof msg === 'string' && msg.length > 0 && msg.length <= 500) return msg;
        } catch { /* not json */ }
    }
    if (status === 401 || status === 403) return 'The language model service refused the request (check its API key).';
    if (status === 404) return 'The language model or endpoint was not found.';
    if (status === 429) return 'The language model service is busy. Please try again shortly.';
    if (status >= 400 && status < 500) return 'The language model service could not process this request.';
    return 'Upstream LLM error';
}

// ---------------------------------------------------------------------------
// Reply ledger (L3-10)
// ---------------------------------------------------------------------------

const LEDGER_MAX_KEYS = 5000;
const LEDGER_MAX_PER_KEY = 64;
const LEDGER_TTL_MS = 30 * 60 * 1000;
const ledger = new Map();   // key -> [{ digest, at }]
const ledgerSecret = crypto.randomBytes(32);

const ledgerKey = ({ tenantId, sessionId, agentType }) => `${tenantId}:${sessionId}:${agentType}`;
const replyDigest = (content) => crypto.createHmac('sha256', ledgerSecret)
    .update(String(content ?? '').trim()).digest('base64url').slice(0, 22);

/**
 * Remember that the proxy produced `content` as `agentType`'s reply in this
 * session, so POST .../conversation can accept it as an assistant turn. An
 * empty reply is remembered as '...' too — the client stores that stand-in.
 */
export function noteAgentReply(scope, content) {
    if (!scope?.sessionId || !scope?.agentType) return;
    const key = ledgerKey(scope);
    const now = Date.now();
    const entries = (ledger.get(key) || []).filter((e) => now - e.at < LEDGER_TTL_MS);
    entries.push({ digest: replyDigest(content), at: now });
    if (!String(content ?? '').trim()) entries.push({ digest: replyDigest('...'), at: now });
    while (entries.length > LEDGER_MAX_PER_KEY) entries.shift();
    ledger.delete(key);
    ledger.set(key, entries);   // re-insert: Map order is the LRU order
    while (ledger.size > LEDGER_MAX_KEYS) ledger.delete(ledger.keys().next().value);
}

/**
 * Was `content` produced by the proxy for this agent in this session (and not
 * yet claimed)? A match is consumed, so one reply backs one stored turn.
 */
export function claimAgentReply(scope, content) {
    const key = ledgerKey(scope);
    const entries = ledger.get(key);
    if (!entries) return false;
    const digest = replyDigest(content);
    const now = Date.now();
    const at = entries.findIndex((e) => e.digest === digest && now - e.at < LEDGER_TTL_MS);
    if (at === -1) return false;
    entries.splice(at, 1);
    if (entries.length === 0) ledger.delete(key);
    return true;
}

/** Test seam. */
export function _resetReplyLedger() { ledger.clear(); }
