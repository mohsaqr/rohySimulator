# Benchmarks

Vitest-driven performance benchmarks for rohySimulator. Currently:

- `tts-latency.bench.js` — TTS first-byte and total-time latency per provider
  (Google, OpenAI, Kokoro, Piper). Phase 7 #1 from `TESTING_PLAN.md`.

## CI threshold enforcement (deferred)

The audit (`module-audits/server-services-tts-proxies.md`) flagged that
"benchmark thresholds are not enforced in CI." That's still true — these
benches run on demand via `npm run bench`, never against a baseline.

To enforce thresholds we'd need:

1. A baseline JSON committed to the repo (per-provider mean / p95 in ms).
2. A bench-runner CI job with the necessary API keys (Google / OpenAI),
   or stubs that simulate realistic latency without leaving the network.
3. A comparison step that fails if the new run exceeds the baseline by
   more than ~25%, with a small grace window for noise.

The hard part is (2) — without consistent latency from the upstream
provider, the comparison is dominated by network noise. The pragmatic
path: run Kokoro (local subprocess) and Piper (local) under threshold
enforcement, leave the cloud providers as "diagnostic-only" benches
that record but don't gate.

Until that lands, treat `npm run bench` as a development tool: run it
before/after changes to the audio path and read the diff manually.

## Running

```
npm run bench                                 # all benches
npx vitest bench --run bench/tts-latency.bench.js   # one file
```

Each provider auto-skips when prerequisites are missing:

| Provider | Prereq |
|---|---|
| Google   | `GOOGLE_TTS_API_KEY` or `GOOGLE_API_KEY` env |
| OpenAI   | `OPENAI_API_KEY` env |
| Kokoro   | always runs (model warmup happens in `beforeAll`) |
| Piper    | `server/data/piper/venv/bin/piper` (or `PIPER_BIN` env) + a `.onnx` voice under `server/data/piper/` |

Vitest reports `min / max / mean / p75 / p99 / rme` per bench. Read the
`mean` column for the typical first-byte latency in ms.
