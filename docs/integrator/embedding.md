# Embedding the avatar kit

`kits/talking-avatars/` is a self-contained, lift-and-drop kit for putting a
lipsynced talking head into a third-party app. It is **meant to be copied
into your project, not installed as an npm package** — there is no published
package and `package.json` is marked `private`. The `package.json`
`peerDependencies` / `optionalDependencies` lists exist to tell you what to
add to *your* install list.

## What the kit contains

```text
kits/talking-avatars/
  client/      React + three.js front-end pieces
  server/      Drop-in Express TTS route + provider services
  glbs/        Sample avatar GLBs
  examples/    standalone.html — framework-free end-to-end demo
  pipeline/    Avatar conversion pipeline (own package.json)
```

The export map in `package.json` is the public surface:

| Import | What it is |
|---|---|
| `./client/PatientAvatar` | The React component — loads a GLB, drives morph targets every frame |
| `./client/VoiceContext` | React context wiring playback + speaking state |
| `./client/voiceService` | Calls `/api/tts`, decodes audio, feeds the lipsync analyser |
| `./client/visemes` | `VISEME_KEYS` — the canonical 15-viseme Oculus order |
| `./client/resolveAvatar` | Maps an avatar id to a GLB URL |
| `./client/avatarFraming` | Camera framing helper |
| `./client/config` | `baseUrl` for API calls |
| `./client/authService` | Token plumbing for the kit's API calls |
| `./server/ttsRoute` | Express router exposing `POST /tts` |
| `./server/kokoroTts`, `./server/googleTts`, `./server/wav` | Provider services + WAV helper |

## Peer requirements (you provide these in your bundler)

`react >=18 <20`, `react-dom >=18 <20`, `three`, `@react-three/fiber`,
`@react-three/drei`, `wawa-lipsync`. Node `>=20`.

Optional, only if you also run the kit's server side: `kokoro-js` +
`@huggingface/transformers` (Kokoro provider), `express >=4`
(`server/ttsRoute.js` as-is).

## The non-negotiable invariant: viseme order

`client/visemes.js` exports `VISEME_KEYS` — the **canonical 15-viseme
Oculus order**:

```text
viseme_sil  viseme_PP  viseme_FF  viseme_TH  viseme_DD
viseme_kk   viseme_CH   viseme_SS  viseme_nn  viseme_RR
viseme_aa   viseme_E    viseme_I   viseme_O   viseme_U
```

`PatientAvatar` clones the GLB scene (so multiple avatars sharing a URL
don't fight over morph state) and mutates `morphTargetInfluences` in place
each frame against this order. The `wawa-lipsync` rig and every cross-platform
avatar depend on this exact order — do not reorder it. (The wider Rohy app
uses the 17-morph Oculus set documented in the platform's avatar notes; the
kit's lip rig is the 15-viseme subset.)

## React integration

```jsx
import { PatientAvatar } from 'talking-avatars-kit/client/PatientAvatar';
import { VoiceContext } from 'talking-avatars-kit/client/VoiceContext';

function Scene() {
  return (
    <VoiceContext>
      <PatientAvatar url="/avatars/heads/avatarsdk.glb" />
    </VoiceContext>
  );
}
```

`PatientAvatar` renders its own `@react-three/fiber` `Canvas`. `VoiceContext`
owns the speaking/listening state and the call into `voiceService`, which
POSTs to your `/api/tts` (same origin by default; override via
`client/config.js` `baseUrl`).

## Framework-free smoke test

`examples/standalone.html` exercises the whole pipeline with **no React** —
it loads three.js + `wawa-lipsync` from a CDN import map, loads a GLB, calls
`/api/tts`, and drives morph targets from the FFT analyser. Run the kit's
`server/ttsRoute.js` on the same origin first, or set the API base field in
the page. Use it to verify a host environment before wiring the React
components.

## Server side

`server/ttsRoute.js` is a drop-in Express router exposing `POST /tts`. It
dispatches to the bundled Kokoro (local, free) or Google (cloud, needs a
key) providers. The request/response contract matches the platform's
`/api/tts` — see [Adding a TTS/LLM provider](/integrator/providers) for the
synthesis contract and [API authentication](/integrator/api-auth) if you
gate the route. Audio comes back as `audio/wav`, or as a chunked
`application/x-rohy-pcm-stream` when the client requests streaming.

::: warning
The kit ships sample GLBs under `glbs/`. Substitute your own licensed heads;
keep the morph-target dictionary names matching `VISEME_KEYS` or lipsync
silently no-ops (the per-key index lookup just skips missing morphs).
:::
