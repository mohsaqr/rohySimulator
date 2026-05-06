# Benchmarks

Vitest-driven performance benchmarks for rohySimulator. Currently:

- `tts-latency.bench.js` — TTS first-byte and total-time latency per provider
  (Google, OpenAI, Kokoro, Piper). Phase 7 #1 from `TESTING_PLAN.md`.

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
