# Adding a TTS / LLM provider

Rohy already ships four TTS providers (Kokoro, Piper, OpenAI, Google) behind
`POST /api/tts`, and several LLM providers behind `POST /api/proxy/llm`.
This page describes the real contract for adding another, using
`server/services/kokoroTts.js` as the reference TTS implementation.

The endpoint shapes are in the generated [API reference](/reference/api/);
TTS terminology is in the [glossary](/reference/glossary).

## The TTS provider contract

A provider is a module under `server/services/` that exposes async functions.
Mirror `kokoroTts.js`. Two shapes matter, and `proxy-routes.js` dynamically
`import()`s your module on demand:

### 1. A non-streaming WAV synthesizer

Returns a single `Buffer` containing a complete WAV (header + PCM):

```js
import { buildWavHeader, float32ToInt16Buffer } from './wav.js';

export async function synthesizeMyproviderWav({ text, voice, speed }) {
  // ... call your engine ...
  const pcm = float32ToInt16Buffer(audioFloat32);   // int16 LE
  return Buffer.concat([buildWavHeader(pcm.length, sampleRate), pcm]);
}
```

### 2. An async-iterator streaming synthesizer

This is the load-bearing part. Yield **per-sentence** chunks so the client
can start playing sentence one while the rest synthesize. Each yielded
object is exactly `{ sampleRate: number, pcm: Buffer }` where `pcm` is
int16 little-endian:

```js
export async function* synthesizeMyproviderStream({ text, voice, speed }) {
  for await (const chunk of myEngine.stream(text, { voice, speed })) {
    yield {
      sampleRate: chunk.sampling_rate,
      pcm: float32ToInt16Buffer(chunk.audio),
    };
  }
}
```

The route layer feeds this generator into the PCM stream pipe that emits the
`application/x-rohy-pcm-stream` response. Kokoro's own implementation is the
worked example — note it builds and explicitly `close()`s the splitter
itself, because the upstream library's string overload never closes its
internal splitter and the iterator would await forever (dropped last
sentence + hung "fails to end"). If your engine has the same shape, close
your stream deterministically.

### 3. A voice-list function and a voice validator

```js
export function listMyproviderVoices() {
  return [{
    filename: 'mv_amy',
    displayName: 'Amy',
    language: 'en',
    gender: 'female',          // MUST be lowercase
    traits: '',
    sampleRate: 24000,
  }];
}

export async function isMyproviderVoice(name) {
  return typeof name === 'string' && /* known? */ true;
}
```

::: danger
`gender` **must be lowercase**. Every other provider emits lowercase and
`proxy-routes.js` compares against lowercase. Kokoro shipped Title-Case
(`"Female"`) and every voice silently fell through the gender check and
re-routed to a hardcoded `af_bella` / `am_michael` pair until it was
normalized in `listKokoroVoices`. Do not repeat this.
:::

### Singleton + failure containment (for local-model providers)

`kokoroTts.js` lazy-loads a ~330 MB model once and reuses the instance.
Copy its failure model: a fatal load error (truncated ONNX, OOM, missing
files) sets a "disabled until restart" flag so every subsequent request
rejects fast instead of re-triggering an 80 MB re-download — and so an
ORT-WASM crash on a corrupt model can't take the whole Node process down.
Transient errors do not set the flag (next call retries). Expose a
`xDisabledReason()` hook so a healthcheck can surface it. Cloud providers
skip this and just need an API-key / quota error path.

## Register in `proxy-routes.js`

`server/routes/proxy-routes.js` is the dispatch point. Steps:

1. Add your provider id to `VOICE_TTS_PROVIDERS`
   (currently `['piper', 'kokoro', 'openai', 'google', 'browser']`).
2. In `resolveTtsVoice(provider, requestedVoice)`, add a `case` that
   `import()`s your `isMyproviderVoice` and returns
   `{ ok: false, reason }` on a miss. There is **no hardcoded fallback
   voice** — an unknown voice is surfaced to the admin, not silently
   swapped, so a persona authored under another provider is visible.
3. In `handleTtsSynthesis`, add an `if (ttsProvider === 'myprovider')`
   branch that dynamically imports your module, honors the same
   `rate` → `speed` clamp window the other providers use (keep cases
   portable across providers), and either pipes
   `synthesizeMyproviderStream(...)` when the client asks for streaming
   (`?stream=1` or `Accept: application/x-rohy-pcm-stream`) or returns
   `synthesizeMyproviderWav(...)` as `audio/wav` with `Cache-Control:
   no-store`.

Provider selection rules already enforced by the route — don't reinvent:

- The runtime `POST /api/tts` route ignores any `provider` in the body or
  query. The active provider is **always** `platform_settings.tts_provider`
  (default `kokoro`). This is the path every patient/discussant voice uses.
- `POST /api/tts/preview` (admin-only) is the **only** path that honors a
  `provider` override on the body/query, so admins can audition a voice
  without flipping the platform setting.
- Budget enforcement (`enforceBudget` / `recordUsage` keyed
  `tts-<provider>`) and the per-user usage row run **before** synthesis. A
  429 with a budget-exceeded body is returned if over budget. Keep your
  branch after these calls.

## LLM providers

LLM dispatch is also in `proxy-routes.js`, under `POST /api/proxy/llm`. The
contract differs from TTS: it resolves provider/model/endpoint/key with a
strict **agent > session > platform** precedence, emits SSE deltas on the
streaming branch, and records token usage + cost against
`llm_model_pricing`. To add a vendor, extend the `provider === '...'`
request-builder branch (it already special-cases `anthropic` vs the
OpenAI-compatible shape) and add a pricing row. Reuse the existing
precedence resolution and budget calls rather than parallel logic.

## UI surface

Add a tab/section under `src/components/settings/VoiceSettingsTab.jsx` so an
admin can select and preview the new provider. The preview button calls
`POST /api/tts/preview` with the `provider` override; it does **not** touch
the runtime path.

::: warning
Voice resolution, lipsync morphs, and the discussant voice path are covered
by the 2026-05-06 regression lock (per-case patient voice leaking into the
discussant). Adding a provider must not loosen it — run the e2e suite. See
[Contributing & tests](/integrator/contributing).
:::
