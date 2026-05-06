// Phase 7 Performance Benchmark #2 — LLM token-streaming throughput.
//
// Per TESTING_PLAN.md line 208:
//   "LLM token-streaming throughput."
//
// SCOPE
//   Measures the wall-clock cost of the *consumption* path inside
//   src/services/llmService.js → streamMessage(): fetch invocation,
//   ReadableStream pull loop, TextDecoder buffering, the `\n\n`-delimited
//   SSE parser, JSON.parse per event, onDelta callback dispatch, and
//   final accumulation. The upstream LLM is fully stubbed via
//   vi.stubGlobal('fetch', ...) so no network calls happen — what we are
//   benchmarking is *our code's* per-token overhead, which is what would
//   regress under a careless refactor (e.g. an O(n²) string concat, an
//   allocation per delta, a dropped TextDecoder reuse).
//
//   We deliberately do NOT benchmark a real LLM. Real models are
//   network-bound and non-deterministic; their throughput numbers say
//   nothing about whether we just doubled our SSE parser's allocation
//   rate.
//
// BENCH GROUPS
//   1. streamMessage — TTFT (time to first onDelta callback)
//   2. streamMessage — total tokens/sec on a 1000-token canned stream
//   3. streamMessage — accumulation overhead with onDelta=null
//   4. streamMessage — abort response time (mid-stream cancellation)
//
// CONSTRAINTS
//   - No source modifications.
//   - No real network. All fetch calls are stubbed.
//   - No new npm dependencies.
//   - Run with: `npx vitest bench --run bench/llm-throughput.bench.js`
//
// NOTE
//   Numbers below are measurements of OUR pipeline at zero network
//   latency. Treat them as upper bounds on what the consumer code can
//   process; real-world throughput is dominated by upstream model speed
//   and network jitter, neither of which this benchmark exercises.

import { afterEach, beforeEach, bench, describe, vi } from 'vitest';

// llmService.js calls localStorage.getItem() unconditionally on every
// outbound request.  jsdom provides a real Storage; node does not.
// The actual shim install lives in ensureLocalStorageShim() below and
// runs lazily before the first streamMessage call so we can detect
// half-stubbed `localStorage` provided by vitest's node project.
import { LLMService } from '../src/services/llmService.js';

// ---------------------------------------------------------------------------
// Stream size for the bulk-throughput suites.  Big enough that fixed
// per-call overhead (fetch stub setup, response construction) is amortised
// across many parser iterations; small enough that the bench iterates
// often within Tinybench's default time budget.
// ---------------------------------------------------------------------------
const STREAM_TOKENS = 1000;

// ---------------------------------------------------------------------------
// Build a list of pre-encoded SSE chunks.  Each chunk contains exactly one
// event so the parser must run its full split / JSON.parse / accumulate
// path once per token — the realistic worst case.  Pre-built once at
// module load so per-iteration cost reflects parsing, not chunk
// construction.
// ---------------------------------------------------------------------------
function buildSseChunks(tokenCount) {
    const out = new Array(tokenCount + 1);
    for (let i = 0; i < tokenCount; i += 1) {
        // Six-character token + space → 7 chars per delta.  Realistic
        // for a chat completion (English text averages ~4 chars/token,
        // we go slightly over to keep accumulator non-trivial).
        out[i] = `data: {"delta":"tok${String(i).padStart(3, '0')} "}\n\n`;
    }
    out[tokenCount] = 'data: [DONE]\n\n';
    return out;
}

const CHUNKS_1K = buildSseChunks(STREAM_TOKENS);
const CHUNKS_SINGLE = ['data: {"delta":"x"}\n\n', 'data: [DONE]\n\n'];

const SESSION_ID = 'bench-session';
const MESSAGES = [{ role: 'user', content: 'hi' }];
const SYSTEM_PROMPT = 'You are a patient.';

// ---------------------------------------------------------------------------
// Construct an SSE Response.  The ReadableStream enqueues every prepared
// chunk synchronously then closes — equivalent to a server that has the
// whole completion ready before the client connects.  This is the
// configuration that exposes consumer-side overhead most cleanly: the
// reader.read() loop never blocks on the network.
// ---------------------------------------------------------------------------
const ENCODER = new TextEncoder();

function sseResponse(chunks) {
    const stream = new ReadableStream({
        start(controller) {
            for (const c of chunks) {
                controller.enqueue(ENCODER.encode(c));
            }
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

// A fetch stub that:
//   * returns a fresh SSE response on every /proxy/llm call (Response
//     bodies can only be consumed once, so we cannot reuse one);
//   * resolves logInteraction sidecar calls with an empty 200.
function makeStreamingFetch(chunks) {
    return vi.fn((url) => {
        if (!String(url).includes('/proxy/llm')) {
            return Promise.resolve(new Response('{}', { status: 200 }));
        }
        return Promise.resolve(sseResponse(chunks));
    });
}

// In-memory localStorage shim used in node.  Defined once at module
// scope so the same instance survives across bench hooks (vi's
// unstubAllGlobals doesn't touch it because it was assigned directly,
// not via vi.stubGlobal).  jsdom already has its own Storage and we
// never overwrite it.  Note: vitest's node project sometimes provides
// a placeholder `localStorage` global without the full Storage API
// (the `--localstorage-file` warning in node), so we feature-test for
// `setItem` rather than just `typeof !== 'undefined'`.
function ensureLocalStorageShim() {
    const ls = globalThis.localStorage;
    if (!ls || typeof ls.setItem !== 'function') {
        const store = new Map();
        const shim = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => { store.set(k, String(v)); },
            removeItem: (k) => { store.delete(k); },
            clear: () => { store.clear(); },
            get length() { return store.size; },
            key: (i) => Array.from(store.keys())[i] ?? null,
        };
        try {
            // Most environments allow direct assignment.
            globalThis.localStorage = shim;
        } catch {
            // Fall back to defineProperty for environments where the
            // global is non-writable (e.g. earlier shim attempt at
            // module top frozen it).
            try {
                Object.defineProperty(globalThis, 'localStorage', {
                    configurable: true,
                    writable: true,
                    value: shim,
                });
            } catch { /* give up — real Storage probably exists already */ }
        }
    }
}

// Silence console once at module scope — bench loops produce thousands
// of "[LLMService] error" lines per second otherwise, which dwarfs the
// thing we're trying to measure.
const _origError = console.error.bind(console);
console.error = () => {};
console.warn = () => {};
console.log = () => {};

// Sanity: run one streamMessage with the 1000-token canned stream and
// surface the result on stderr.  This catches "fetch isn't being
// stubbed and we're benching the catch path" silently turning the
// throughput numbers into nonsense.  Prints once at module load.
async function sanityCheck() {
    ensureLocalStorageShim();
    globalThis.localStorage.setItem('token', 'sanity');
    globalThis.fetch = (url) => {
        if (!String(url).includes('/proxy/llm')) {
            return Promise.resolve(new Response('{}', { status: 200 }));
        }
        return Promise.resolve(sseResponse(CHUNKS_1K));
    };
    let n = 0;
    const r = await LLMService.streamMessage(
        SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
        { onDelta: () => { n += 1; } }
    );
    if (n !== STREAM_TOKENS) {
        _origError(`[bench sanity] expected ${STREAM_TOKENS} deltas, got ${n}; result starts: ${String(r).slice(0, 80)}`);
        throw new Error(`bench fetch stub broken: got ${n}/${STREAM_TOKENS} deltas`);
    }
}
await sanityCheck();

// Common bench setup: fresh fetch stub, JWT in storage.  We assign
// directly to globalThis instead of going through vi.stubGlobal so the
// stub survives any cleanup vitest performs between bench iterations
// (vitest's bench mode does not run beforeEach/afterEach per iteration,
// only per bench, and the stub registry behaviour around that has
// proved fragile).
function installFetch(fetchImpl) {
    ensureLocalStorageShim();
    globalThis.fetch = fetchImpl;
    try { globalThis.localStorage.setItem('token', 'bench-jwt'); } catch { /* ignore */ }
}

function uninstall() {
    // Intentionally no-op.  Each bench's beforeEach reinstalls a fresh
    // fetch stub before any code runs; we don't need to tear down.
}

// ===========================================================================
// 1. TTFT — time to first onDelta callback.
//
//    Measures call → first token observed.  With a stubbed transport this
//    is the pure framework overhead: fetch construction, header building,
//    AbortSignal wiring, watchdog arming, the first reader.read() chunk,
//    one TextDecoder call, one indexOf, one JSON.parse, one onDelta call.
//    A regression here means we added work *before* the user sees any
//    text in the chat bubble.
// ===========================================================================
describe('llmService.streamMessage — TTFT', () => {
    beforeEach(() => installFetch(makeStreamingFetch(CHUNKS_SINGLE)));
    afterEach(uninstall);

    bench('time to first delta (stubbed fetch, single-token stream)', async () => {
        await new Promise((resolve) => {
            // Resolve as soon as the first delta arrives.  We still let
            // the underlying call settle so the next iteration starts
            // from a clean state, but the *measured* path is the TTFT.
            const p = LLMService.streamMessage(
                SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
                {
                    onDelta: () => resolve(),
                }
            );
            // Defensive: if the stub somehow never delivers, ensure we
            // still let the bench iteration finish.
            p.then(() => resolve(), () => resolve());
        });
    });
});

// ===========================================================================
// 2. Total tokens/sec on a 1000-token canned stream.
//
//    The headline number.  Divide STREAM_TOKENS by mean iteration time
//    (Tinybench reports `mean` in ms) to get tokens/sec for the full
//    parse → accumulate → callback pipeline.  This is what catches an
//    accidental O(n²) accumulator or an extra allocation per delta.
// ===========================================================================
describe('llmService.streamMessage — total tokens/sec', () => {
    beforeEach(() => installFetch(makeStreamingFetch(CHUNKS_1K)));
    afterEach(uninstall);

    bench(`consume ${STREAM_TOKENS}-token SSE stream with onDelta`, async () => {
        let count = 0;
        await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            {
                onDelta: () => { count += 1; },
            }
        );
        // Touch `count` so JIT cannot dead-code-eliminate the callback.
        if (count < 0) throw new Error('unreachable');
    });
});

// ===========================================================================
// 3. Accumulation overhead with onDelta=null.
//
//    Same 1000-token stream, but the consumer doesn't subscribe to
//    deltas — only the final accumulated string matters.  Compares
//    directly against group #2: the delta is the per-token callback
//    dispatch cost.  If group #3 is *slower* than #2, the parser is
//    doing work proportional to deltas regardless of subscription
//    (a smell worth investigating).
// ===========================================================================
describe('llmService.streamMessage — accumulation overhead', () => {
    beforeEach(() => installFetch(makeStreamingFetch(CHUNKS_1K)));
    afterEach(uninstall);

    bench(`consume ${STREAM_TOKENS}-token SSE stream with onDelta=null`, async () => {
        const result = await LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            { onDelta: null }
        );
        // Force result reference so the optimiser can't elide the call.
        if (result.length < 0) throw new Error('unreachable');
    });
});

// ===========================================================================
// 4. Abort response time.
//
//    Stream is held open by a pull() that parks until the combined
//    AbortSignal fires.  We dispatch one synthetic delta so the
//    consumer enters its inner loop, then immediately abort.  Measures
//    "how quickly does cancelling settle the iterator?" — a UX-critical
//    number for the chat UI's stop button.  Spec says caller-initiated
//    abort resolves to '' (see llmService.test.js); the bench just
//    measures the latency of that settlement.
// ===========================================================================
describe('llmService.streamMessage — abort response time', () => {
    beforeEach(() => {
        const fetchMock = vi.fn((url, init) => {
            if (!String(url).includes('/proxy/llm')) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
            const stream = new ReadableStream({
                pull(controller) {
                    // Push exactly one delta then park forever (until abort).
                    if (!stream._pushed) {
                        stream._pushed = true;
                        controller.enqueue(ENCODER.encode('data: {"delta":"first"}\n\n'));
                        return undefined;
                    }
                    return new Promise((_, reject) => {
                        init.signal.addEventListener('abort', () => {
                            const err = new Error('aborted');
                            err.name = 'AbortError';
                            try { controller.error(err); } catch { /* already errored */ }
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
        installFetch(fetchMock);
    });
    afterEach(uninstall);

    bench('abort mid-stream and wait for settle', async () => {
        const ac = new AbortController();
        const p = LLMService.streamMessage(
            SESSION_ID, MESSAGES, SYSTEM_PROMPT, null,
            {
                onDelta: () => {
                    // First delta arrived → trigger the abort path.
                    ac.abort();
                },
                signal: ac.signal,
            }
        );
        await p;
    });
});
