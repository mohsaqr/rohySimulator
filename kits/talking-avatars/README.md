# Talking Avatars Kit

A complete, self-contained reference implementation of **3D talking-head
avatars with real-time lipsync and multi-provider TTS**, extracted from the
rohySimulator clinical training platform.

This kit covers the full pipeline:

```
   text  ─►  TTS provider  ─►  PCM audio + sample rate  ─►  Web Audio
                                                              │
                                                              ▼
                                                          AnalyserNode
                                                              │
                                                              ▼ (FFT)
   GLB avatar  ◄──────  Three.js morph weights  ◄────  wawa-lipsync
   (15 visemes +                                       (dominant viseme
    eye blinks)                                         per frame)
```

Drop the pieces into a React + Vite app, point it at any Express backend
that hosts `/api/tts`, and you have a patient (or any character) whose
mouth moves accurately while it speaks — locally on a laptop, with no GPU,
no Unity, no proprietary engines.

---

## Contents

```
kits/talking-avatars/
├── README.md                          ← this file
├── INSTALL.md                         ← 7-step drop-in walkthrough for a fresh project
├── package.json                       ← peerDependencies + exports map
├── glbs/
│   ├── manifest.json                  ← demographic + camera-framing index
│   └── *.glb                          ← 28 viseme-rigged head meshes (~226 MB total)
├── client/
│   ├── PatientAvatar.jsx              ← React + R3F component that renders the head
│   ├── visemes.js                     ← canonical 15-viseme key list (single source of truth)
│   ├── resolveAvatar.js               ← "which GLB should this character use?" logic
│   ├── avatarFraming.js               ← camera helpers (per-avatar framing)
│   ├── voiceService.js                ← TTS dispatch + Web Audio scheduling + lipsync glue
│   ├── VoiceContext.jsx               ← optional shared state (mode/listening/visemes)
│   ├── config.js                      ← apiUrl/baseUrl stubs (env-configurable)
│   └── authService.js                 ← token-getter stub (auth-optional)
├── server/
│   ├── ttsRoute.js                    ← drop-in Express router for /api/tts and /api/tts/voices
│   ├── kokoroTts.js                   ← local Kokoro-82M (free, ~330 MB model)
│   ├── googleTts.js                   ← Google Cloud TTS (free 1M chars/month, Chirp 3 HD)
│   └── wav.js                         ← shared PCM/WAV helpers used by both providers
├── examples/
│   ├── standalone.html                ← single-file vanilla-JS demo (no React, no bundler)
│   └── README.md                      ← how to run the demo
└── pipeline/
    ├── convert.mjs                    ← FBX → viseme-rigged GLB pipeline (RocketBox)
    ├── avatars.json                   ← which avatars to convert
    ├── package.json                   ← @gltf-transform, fbx2gltf, sharp, tga
    ├── README.md                      ← pipeline-specific docs
    └── .gitignore
```

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [The avatar asset model: GLBs and morph targets](#2-the-avatar-asset-model-glbs-and-morph-targets)
3. [The 15 Oculus visemes (and why these specifically)](#3-the-15-oculus-visemes-and-why-these-specifically)
4. [Where the GLBs come from — the conversion pipeline](#4-where-the-glbs-come-from--the-conversion-pipeline)
5. [The runtime morph driver — `PatientAvatar.jsx`](#5-the-runtime-morph-driver--patientavatarjsx)
6. [Lipsync — `wawa-lipsync` and the FFT-based viseme detector](#6-lipsync--wawa-lipsync-and-the-fft-based-viseme-detector)
7. [TTS providers — Kokoro vs. Google](#7-tts-providers--kokoro-vs-google)
8. [The streaming wire format — `application/x-rohy-pcm-stream`](#8-the-streaming-wire-format--applicationx-rohy-pcm-stream)
9. [Why a single shared `AudioContext`](#9-why-a-single-shared-audiocontext)
10. [Camera framing per avatar](#10-camera-framing-per-avatar)
11. [Eye blink animation](#11-eye-blink-animation)
12. [Avatar selection — case, agent, platform default, demographic fallback](#12-avatar-selection--case-agent-platform-default-demographic-fallback)
13. [Browser STT (the listening half)](#13-browser-stt-the-listening-half)
14. [Setup checklist (lifting this kit into a new project)](#14-setup-checklist-lifting-this-kit-into-a-new-project)
15. [Common problems and fixes](#15-common-problems-and-fixes)
16. [Licensing notes](#16-licensing-notes)
17. [Why we don't use Ready Player Me, Polly, ElevenLabs, etc.](#17-why-we-dont-use-ready-player-me-polly-elevenlabs-etc)

---

## 1. Architecture overview

The system is intentionally split into independent layers so each can be
swapped without touching the others.

| Layer | Responsibility | Where |
|---|---|---|
| **Asset** | A 3D head GLB with a fixed set of named morph targets (visemes + eye blinks) | `glbs/*.glb` |
| **TTS provider** | Turn text into raw PCM samples + sample rate | `server/kokoroTts.js`, `server/googleTts.js` |
| **Wire format** | Stream PCM frames from server to browser | `application/x-rohy-pcm-stream` (custom; defined in `voiceService.js`) |
| **Web Audio** | Decode int16 PCM into AudioBuffers, schedule them onto a gapless timeline | `voiceService.js` |
| **Lipsync** | FFT-analyse the analyser node, pick a dominant viseme per frame | `wawa-lipsync` (npm package, called from `voiceService.js`) |
| **Renderer** | Drive the GLB's morph weights from the dominant viseme | `client/PatientAvatar.jsx` (Three.js + `@react-three/fiber`) |
| **State** | Speaking / listening / current viseme / which character is active | `client/VoiceContext.jsx` |

The data flow is one-way: text in, mouth moves out. Visemes are emitted as
plain `{ viseme_aa: 1 }`-shape objects and stored in a `useRef` — never in
React state during a frame loop, because re-rendering at 60 FPS would
torch the main thread.

---

## 2. The avatar asset model: GLBs and morph targets

A "talkable" avatar in this kit is a `.glb` file (binary glTF 2.0) whose
mesh exposes a specific set of **morph targets** — one per viseme plus two
for blinks. Three.js / R3F reads `mesh.morphTargetInfluences[i]` every
frame and blends the corresponding shape key into the rest pose.

### What every GLB in `glbs/` contains

| Index | Morph target name | Shape |
|---|---|---|
| 0 | `viseme_sil` | mouth at rest (closed, neutral lips) |
| 1 | `viseme_PP` | bilabial closure — *p, b, m* |
| 2 | `viseme_FF` | labiodental — *f, v* |
| 3 | `viseme_TH` | interdental — *th* (voiced + voiceless) |
| 4 | `viseme_DD` | alveolar — *t, d, n, l* |
| 5 | `viseme_kk` | velar — *k, g* |
| 6 | `viseme_CH` | postalveolar — *ch, sh, j* |
| 7 | `viseme_SS` | sibilant — *s, z* |
| 8 | `viseme_nn` | engma — *ng* |
| 9 | `viseme_RR` | rhotic — *r* |
| 10 | `viseme_aa` | open vowel — *ah, a* |
| 11 | `viseme_E` | mid front vowel — *eh* |
| 12 | `viseme_I` | high front vowel — *ee* |
| 13 | `viseme_O` | mid back rounded — *oh* |
| 14 | `viseme_U` | high back rounded — *oo* |
| 15 | `eyeBlinkLeft` | left eye closed |
| 16 | `eyeBlinkRight` | right eye closed |

This is the **Oculus naming convention** — chosen because it is the most
widely supported across avatar marketplaces (Oculus VRM, Mixamo, Microsoft
RocketBox once converted, several Ready Player Me forks). The names matter:
the runtime indexes morph targets by these exact strings via
`mesh.morphTargetDictionary`, so any mismatch in case or hyphenation
silently breaks lipsync (the avatar will load and render, but the mouth
won't move).

### Why both `eyeBlinkLeft` and `eyeBlinkRight`

Some source avatars (RocketBox in particular) ship a single combined
`eyesClosed` morph instead of left/right. The runtime falls back to
`eyesClosed` if the per-eye targets are missing — see `PatientAvatar.jsx`
lines 65-68.

### File-size budget

Each GLB ranges from **2 MB** (vroid/brunette-t — small textures, low
poly) to **35 MB** (mpfb — high-res textures). The RocketBox-converted
heads sit at **6–10 MB**, which is the practical sweet spot: textures at
1024 px max, normals/tangents per morph deliberately omitted (the runtime
only needs POSITION deltas).

`du -sh glbs/` for this kit reports ~226 MB total across 28 heads.

---

## 3. The 15 Oculus visemes (and why these specifically)

Most TTS APIs and lipsync libraries quantize phonemes into a small visual
class set. The two prevailing standards are:

- **Disney / Preston Blair (12 visemes)** — older, used in legacy facial
  animation tooling. Doesn't distinguish *th* from *dd* well.
- **Oculus (15 visemes)** — what the Oculus Lip Sync SDK uses, and what
  Microsoft Speech, Amazon Polly, and `wawa-lipsync` all map to. Adds
  enough vowel discrimination that English speech reads correctly.

We use Oculus because every modern lipsync runtime targets it. The
alternative would be to do real phoneme analysis (e.g. running `espeak-ng`
to get phoneme + duration timings) and drive morphs from that. That gives
better accuracy but requires another binary on the server and adds
latency. The FFT path is "good enough at 60 fps with no extra dependency."

The single source of truth for the order is `client/visemes.js`:

```js
export const VISEME_KEYS = [
    'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
    'viseme_kk',  'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
    'viseme_aa',  'viseme_E',  'viseme_I',  'viseme_O',  'viseme_U'
];
```

Both the conversion pipeline and the runtime morph driver import this
array. **Don't duplicate the list anywhere** — order has to match across
build and runtime, and a one-source-of-truth array is the only way to
guarantee that.

---

## 4. Where the GLBs come from — the conversion pipeline

Three sources produced the 28 GLBs in `glbs/`:

| Group | Source | Count | License |
|---|---|---|---|
| `avatarsdk.glb`, `brunette*.glb`, `vroid.glb`, `avaturn.glb`, `mpfb.glb` | [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) demo set | 6 | MIT |
| `rb_*.glb` (22 files) | [Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox), converted via `pipeline/convert.mjs` | 22 | MIT (RocketBox) |

**Ready Player Me is intentionally NOT used** — see section 17 for why.

### The pipeline at a glance

`pipeline/convert.mjs` is a 318-line Node script that produces a fully
viseme-rigged GLB from a RocketBox FBX in five stages:

1. **Download** `<Name>_facial.fbx` from the public Microsoft-Rocketbox
   GitHub repo. Only the `_facial` variant ships the 15 viseme + 48 FACS
   blendshapes; the plain `.fbx` has no morphs and is useless for lipsync.
2. **FBX → GLB** via [`fbx2gltf`](https://github.com/facebookincubator/FBX2glTF).
   The raw output has ~175 morph targets (RocketBox includes every FACS
   shape: brow, cheek, jaw, etc.), white placeholder PNGs (FBX2glTF can't
   decode `.tga`), and one PBR material per region (`<prefix>_body`,
   `<prefix>_head`, `<prefix>_opacity`).
3. **Inject textures.** The pipeline reads the actual material names,
   downloads the matching `.tga` from the avatar's `Textures/` directory,
   decodes via the [`tga`](https://www.npmjs.com/package/tga) npm package,
   downscales to 1024 px max with [`sharp`](https://sharp.pixelplumbing.com/),
   re-encodes as PNG, and replaces the placeholder via `@gltf-transform`'s
   texture API.
4. **Map and prune morphs.** Walk every `PrimitiveTarget`, identify the
   blendshape name from the POSITION accessor's name (FBX2glTF stores
   them as `blendShapeN.AA_VI_NN_xx` for visemes and
   `blendShapeN.AK_NN_<OculusName>` for FACS), map to the canonical Oculus
   name (`viseme_PP`, `eyeBlinkLeft`, …), drop everything outside the
   17-morph keep set, and **reorder** the keepers into the canonical order
   from `client/visemes.js`. Critically, `target.setName(oculusName)` is
   called on every kept `PrimitiveTarget` *before* writing — the
   `@gltf-transform` writer reads names from `PrimitiveTarget` objects,
   so this is what makes `mesh.extras.targetNames` come out correct
   without any post-write JSON-chunk patching.
5. **Garbage collect.** Run `prune()` + `dedup()` from
   `@gltf-transform/functions` to drop orphaned accessors, bufferViews,
   textures, and samplers, then dedupe shared resources across LOD
   primitives. This is what gets the file from raw 12 MB down to the
   6-10 MB shipped range.

### Adding a new RocketBox avatar

```bash
cd pipeline
npm install                               # one-time, ~12 MB FBX2glTF binary
# 1. Edit avatars.json, append:
#    {"srcGroup": "Adults", "srcName": "Female_Adult_12",
#     "dstName": "rb_female_adult_12", "label": "Adult woman 12",
#     "gender": "female", "age": "adult"}
# 2. Run only this avatar:
npm run convert -- --only=rb_female_adult_12
# 3. Append the same entry to glbs/manifest.json under all[] and the
#    appropriate gender/age bucket. The runtime reads from the manifest;
#    the script does NOT touch the manifest.
```

The pipeline is **idempotent and additive**: by default it skips any
avatar whose final GLB already exists. Pass `--force` to overwrite.

### Adding a non-RocketBox avatar

If you have a `.glb` from another source (Mixamo, custom Blender export,
VRoid Studio, etc.), it works as long as the mesh exposes the 17 morph
targets named exactly as listed in section 2. If the source uses different
names (e.g. ARKit-style `mouthFunnel`, `jawOpen`), you have two options:

1. **Rename the morphs in Blender** before exporting — set the shape key
   names to match the Oculus names. Trivial in Blender 3.x+.
2. **Add a name-mapping pass** to your own conversion script. The
   pipeline's `mapBlendshapeToOculus()` function (in `convert.mjs`) is the
   reference implementation for RocketBox's `AK_NN_*` naming; copy and
   adapt for your source.

---

## 5. The runtime morph driver — `PatientAvatar.jsx`

The component is small (~200 lines) but several details in it are
load-bearing. Here are the non-obvious ones.

### Frame-loop reads from refs, not props

```js
// from PatientAvatar.jsx:114-120
const visemesRef = useRef({ viseme_sil: 1 });
useEffect(() => {
    if (visemes) visemesRef.current = visemes;
}, [visemes]);
```

The `visemes` prop changes on every dominant-viseme transition (~10–20×
per second during speech). If we read it via `props.visemes` inside
`useFrame`, every change would force a fiber re-render of the Canvas
subtree — which interrupts the WebGL frame and causes visible mouth
stutter. Storing visemes in a ref and updating the ref from a `useEffect`
keeps `useFrame` reading purely from a stable container, so the renderer
never re-mounts.

### Critically-damped morph interpolation

```js
// from PatientAvatar.jsx:47-63
const decay = 8 * delta;   // how fast a morph fades back to 0
const rise = 12 * delta;   // how fast a morph rises to its target

infl[idx] = want > cur
    ? Math.min(want, cur + rise)
    : Math.max(want, cur - decay);
```

The dominant-viseme stream from `wawa-lipsync` is a square wave: viseme A
at frame N, viseme B at frame N+1. Driving the morph weights directly to
`{ A: 1, B: 0 }` produces hard pops in the mouth shape. The interpolation
above smooths this to ~80 ms rise / ~125 ms fall, which reads as natural
lip motion. `rise > decay` because human mouths open faster than they
close.

The constants are tuned for 60 fps; if you drop to 30 fps the motion
feels mushy. They're framerate-independent because of the `* delta`
multiplier, but the visual effect changes.

### Cloned scene per instance

```js
const scene = useMemo(() => original.clone(true), [original]);
```

`useGLTF` caches the parsed glTF document — so two `<PatientAvatar>`s with
the same `url` would share one Three.js scene graph and fight over the
same `morphTargetInfluences` array. `original.clone(true)` deep-clones the
scene including morph state. Without this, switching from "patient" to
"nurse" while both panels are mounted would have one head's mouth driving
the other.

### The blink-target fallback

```js
const lIdx = dict.eyeBlinkLeft ?? dict.eyesClosed;
const rIdx = dict.eyeBlinkRight ?? dict.eyesClosed;
```

RocketBox ships `eyesClosed` (one combined morph) instead of left/right.
TalkingHead-set GLBs use the ARKit-style `eyeBlinkLeft` / `eyeBlinkRight`.
The fallback handles both without per-asset configuration.

---

## 6. Lipsync — `wawa-lipsync` and the FFT-based viseme detector

[`wawa-lipsync`](https://www.npmjs.com/package/wawa-lipsync) is a small
~5 KB npm package that runs an `AnalyserNode` FFT and classifies each
frame into one of the 15 Oculus visemes. It does NOT try to do real
phoneme recognition — instead it bins the frequency spectrum into formant
energy ratios and uses heuristics ("high energy below 800 Hz + closed
peak ~250 Hz = `viseme_aa`") to pick a dominant viseme.

### Why this is good enough

1. **No extra latency.** The FFT runs in the same `requestAnimationFrame`
   loop as the renderer. The viseme that goes onto the mouth at frame N
   is derived from the audio sample currently playing at frame N, with
   no buffering or pre-analysis.
2. **No model.** No MFCC, no neural net, no API call. Works offline,
   works on any browser with Web Audio.
3. **Provider-agnostic.** Kokoro, Google, Piper, OpenAI — they all
   produce the same shape of analyser output, so the lipsync code never
   needs to know which provider was used.

### Where it falls short

- **`viseme_TH` and `viseme_FF` are easily confused** with `viseme_PP`
  because the closure portion has very similar low-frequency energy.
  English speech is forgiving — readers can lipread these as the
  same closure if their durations are short — but if you slow-mo the
  output, you'll see TH render as PP about half the time. To fix that
  properly you'd need actual phoneme timings (espeak-ng or the TTS
  provider's `<mark>` SSML callbacks).
- **Vowel transitions are quantized.** The FFT bin closest to the
  current frame wins, so a `viseme_aa → viseme_E` transition lands on
  one frame instead of cross-fading. The morph interpolator in
  `PatientAvatar.jsx` smooths this out, but if you want continuous
  vowel space (e.g. an actual jaw-open scalar driven by F1), you'd
  need to bypass the dominant-viseme abstraction.

### Bypassing wawa's `connectAudio()`

```js
// from voiceService.js:75-80
_lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
_lipsync.analyser.connect(_lipsync.audioContext.destination);
```

`wawa-lipsync` ships a `connectAudio(htmlAudioElement)` helper that wraps
`createMediaElementSource()`. We don't use it because:

- We already have an `AudioBufferSourceNode` graph (Web Audio, no
  `<audio>` element).
- `createMediaElementSource` on a `blob:` URL is broken in some Chrome
  versions (silent or stuttering audio).

So we directly connect our `AudioBufferSourceNode → analyser →
destination`, where `analyser` is `_lipsync.analyser` — wawa's internal
node. That's the ~5-line trick that makes streaming TTS + lipsync work
end-to-end without modification to wawa.

### FFT size

`fftSize: 1024` gives ~46 Hz bin resolution at 48 kHz — enough to
discriminate F1 vowel formants without paying the larger window penalty
that 2048 imposes (~46 ms of latency on a 24 kHz stream). 512 is too
coarse; you start losing TH/SS discrimination.

---

## 7. TTS providers — Kokoro vs. Google

Both providers produce the same shape (raw 16-bit PCM with a sample
rate), so the client doesn't care which one synthesised the audio. The
choice is between local-and-free vs. cloud-and-better.

### Kokoro-82M (`server/kokoroTts.js`)

| Property | Value |
|---|---|
| Model | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (82M parameters) |
| Runtime | [`kokoro-js`](https://www.npmjs.com/package/kokoro-js) → ONNX → `onnxruntime-web` (WASM) |
| Cost | $0 |
| First-load | ~330 MB download (model + tokenizer + voicepacks) |
| Memory | ~600 MB resident after load |
| Speed | ~0.38× realtime on M-series CPU (q4 quant), ~0.66× on q8 |
| Sample rate | 24 kHz |
| Voices | ~10 English (American + British), Spanish, French, Hindi, Italian, Portuguese, Japanese, Mandarin |
| Streaming | Yes — per-sentence chunks via `TextSplitterStream` |

Three things worth understanding about the Kokoro service file:

**1. WASM thread tuning.**

```js
const _wasmThreads = Math.min(4, Math.max(1, os.cpus().length));
TRANSFORMERS_ENV.backends.onnx.wasm.numThreads = _wasmThreads;
```

`onnxruntime-web` defaults to single-threaded WASM. Benchmarked at ~20%
faster at 4 threads vs 1; past 4 it gets *slower* (thread overhead beats
parallelism for an 82M model). Must be set before any ORT session is
created — that's why the env mutation lives at module load.

**2. q4 quantization.**

```js
const DTYPE = 'q4';
```

4-bit quantized vs the float-precision baseline: ~40% faster, perceptual
quality difference on speech is essentially zero. q8 is the next step up
if you hear artifacts (rare in our testing).

**3. The `TextSplitterStream` close() workaround.**

```js
const splitter = new TextSplitterStream();
splitter.push(text);
splitter.close();
const stream = tts.stream(splitter, { voice, speed });
```

`kokoro-js` has an overload `tts.stream(text, opts)` that accepts a plain
string. *Don't use it.* Internally that overload creates a splitter and
forgets to close it — so the last sentence stays buffered and the async
iterator awaits forever. Building the splitter ourselves and explicitly
calling `close()` after pushing the text is what makes the stream
actually end on the final sentence.

### Google Cloud TTS (`server/googleTts.js`)

| Property | Value |
|---|---|
| Voices | Neural2 (older), Chirp HD (newer), **Chirp 3 HD (current)** |
| Cost | 1M chars/month free; $16/1M chars after for any of the three tiers above |
| Auth | API key on the URL (same as Cloud Speech-to-Text) |
| Sample rate | 24 kHz LINEAR16 |
| Streaming | No — REST API returns the full WAV in one response |
| Quality | Chirp 3 HD ≈ OpenAI `gpt-4o-mini-tts` quality, free tier |

**Why prefer Chirp 3 HD over Neural2.** Same pricing tier, dramatically
more natural prosody. Chirp 3 HD voices are 2024–2025 generation; Neural2
is 2022 and has a recognizable Google Assistant cadence. The voice list
in `googleTts.js:GOOGLE_VOICES` puts Chirp 3 HD first so they sort to
the top of voice pickers.

**The headphone EQ profile.**

```js
audioConfig: {
    audioEncoding: 'LINEAR16',
    sampleRateHertz: 24000,
    speakingRate: speed,
    effectsProfileId: ['headphone-class-device']
}
```

`effectsProfileId` is a free per-request flag that applies Google's
headphone-tuned EQ. Noticeable on headphones, neutral on speakers.
Always-on for negligible cost.

**RIFF header strip.**

```js
const isWavWrapped = audioBuf.length > 44 && audioBuf.slice(0, 4).toString() === 'RIFF';
const pcm = isWavWrapped ? audioBuf.slice(44) : audioBuf;
```

Even with `audioEncoding: 'LINEAR16'` (raw PCM), Google wraps the bytes
in a 44-byte RIFF/WAVE header. Strip it before yielding so the route's
shared `pipePcmStream` helper can treat Google output uniformly with
Kokoro's already-headerless PCM.

### When to use which

| Scenario | Use |
|---|---|
| Offline / air-gapped machines | Kokoro |
| First-time setup with no API keys | Kokoro |
| Low-latency single-machine | Kokoro (no network round-trip) |
| Best naturalness for distressed/elderly patients | Google Chirp 3 HD |
| Cohort of 20+ students hammering the same server | Google (synthesis is on Google's GPUs, not your CPU) |
| Uncommon languages | Google (50+ languages vs Kokoro's 10) |

The [rohySimulator](https://github.com/mohsaqr/rohySimulator) ships both
and lets the admin switch via a platform setting, so per-deployment cost
vs quality is a configuration choice.

---

## 8. The streaming wire format — `application/x-rohy-pcm-stream`

A custom MIME type because the standard ones don't fit. We need to
stream **per-sentence PCM chunks** from server to client *with the
sample rate up front*, while keeping the format trivial to parse in
both Node and the browser.

### Wire layout (little-endian throughout)

```
┌──────────────────────────┐
│  4 bytes — sampleRate    │  uint32 LE, sent once at the start
├──────────────────────────┤
│  4 bytes — frameLen #1   │  uint32 LE, length of next PCM chunk in bytes
├──────────────────────────┤
│  N bytes — int16 PCM     │  raw signed 16-bit mono samples
├──────────────────────────┤
│  4 bytes — frameLen #2   │
├──────────────────────────┤
│  ...                     │
├──────────────────────────┤
│  4 bytes — 0 (EOF)       │  uint32 LE, terminator
└──────────────────────────┘
```

### Why custom

- **WAV** can't be streamed sensibly because the RIFF header carries the
  total length up front, which we don't know until synthesis ends.
- **MP3 / Opus** would require a decoder bundle on both sides; PCM is
  free in Web Audio (`AudioBuffer` is already PCM internally).
- **WebSockets** would work but would force a stateful connection per
  speak() call; HTTP fetch + ReadableStream is simpler and survives
  proxies / load balancers without configuration.
- **Server-Sent Events** are text-only.

The whole format fits in ~30 lines of parser (`readPcmFrames` in
`voiceService.js`) and ~30 lines of writer (`pipePcmStream` in the
backend route).

### First-sentence-fast playback

The big payoff: the browser can `decodeAudioData` and start playing the
**first** sentence's chunk while the server is still synthesising the
**second** sentence. For a 4-sentence reply at Kokoro's 0.4× realtime,
that's perceived latency of ~250 ms (synth time of one short sentence)
instead of ~3 s (synth time of all four). The patient starts answering
as you'd expect in a real conversation.

---

## 9. Why a single shared `AudioContext`

Browsers cap live `AudioContext` instances at ~6. Creating a new one per
TTS call exhausts the budget after a few exchanges and silently breaks
playback on the 7th. The kit reuses a singleton:

```js
// from voiceService.js:75-81
async function ensureLipsync() {
    if (_lipsync) return _lipsync;
    _lipsync = new Lipsync({ fftSize: 1024, historySize: 8 });
    _lipsync.analyser.connect(_lipsync.audioContext.destination);
    await _lipsync.audioContext.resume();
    return _lipsync;
}
```

The tradeoff: we lose the ability to "fully reset" the audio graph by
discarding the context. To compensate, `teardown()` (called on cancel /
new speak) explicitly stops every active source, disconnects them, and
clears the `_activeSources` array — so leaks don't accumulate. The
context itself stays warm.

---

## 10. Camera framing per avatar

Each avatar has slightly different scale, neck length, and head size
depending on its source. A single fixed camera position makes some
heads tiny and others fill the frame. The manifest stores per-avatar
camera overrides:

```json
{
  "id": "rb_female_adult_07.glb",
  "camera": { "pos": [0, 1.62, 1.05], "lookY": 1.62, "fov": 22 }
}
```

`avatarFraming.resolveCamera()` picks the override if present, else the
manifest default, else `DEFAULT_CAMERA`. The case editor and settings
panels expose sliders that write back to `manifest.json` so authors can
fine-tune per case. See `client/avatarFraming.js`.

---

## 11. Eye blink animation

Procedural — no data file. Every 3500–5500 ms (random within that
window), the blink ref flips to true for 130 ms. The morph driver picks
this up naturally because it reads `blinkRef.current` every frame.

```js
// from PatientAvatar.jsx:122-143
const schedule = () => {
    const wait = 3500 + Math.random() * 2000;
    timeoutId = setTimeout(() => {
        blinkRef.current = true;
        setBlinkTick(t => t + 1);   // forces a re-render to start the blink
        setTimeout(() => {
            blinkRef.current = false;
            schedule();              // schedule next blink
        }, 130);
    }, wait);
};
```

The `setBlinkTick` is purely to trigger React to re-evaluate — the
actual blink value lives in the ref. 130 ms is the average human blink
duration. Real human blink rate averages ~17/min; we sit a bit slower
to avoid looking nervous on screen.

---

## 12. Avatar selection — case, agent, platform default, demographic fallback

`client/resolveAvatar.js` is the **single source of truth** for "which
GLB should this character use right now?" Resolution priority:

1. **Explicit `avatarId`** — the case author picked a specific head for
   this case (or this agent persona). Wins everything.
2. **Platform default by gender** — admin set "default female" /
   "default male" in the platform settings tab.
3. **Demographic auto-pick** — hash the patient ID/name into one of the
   `manifest[gender][ageBucket]` pools so the same patient always gets
   the same head, but two different patients of the same demographic
   get visually distinct heads.
4. **`manifest.fallback[0]`** — last-resort hardcoded fallback so the
   panel never renders empty.

Single function, ~15 lines. The fact that it lives in one place is what
makes "swap a case avatar" or "set a platform default" reliable —
there's one resolution rule, not four scattered fallback chains.

---

## 13. Browser STT (the listening half)

Symmetric with TTS but uses the platform's `SpeechRecognition` API. No
server involvement — the audio never leaves the browser.

```js
// from voiceService.js:325-368
startListening({ lang, onResult, onError, onEnd }) {
    const rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => onResult({ final, interim, isFinal });
    rec.start();
}
```

Limitations: Safari iOS has historically been spotty (cuts off at
~60 s, doesn't fire `onend` reliably); Firefox doesn't support it at
all. For a robust cross-browser STT you'd front this with a server-side
Whisper / Cloud Speech path — out of scope for this kit.

---

## 14. Setup checklist (lifting this kit into a new project)

### Client

```bash
npm install three @react-three/fiber @react-three/drei wawa-lipsync
```

Copy `client/*` to your project. The imports inside expect:

- `../config/api.js` exporting `apiUrl()` and `baseUrl()` — your project's
  base URL helpers. Trivial to provide; example:
  ```js
  export const apiUrl  = (path) => `${import.meta.env.VITE_API_URL}/api${path}`;
  export const baseUrl = (path) => `${import.meta.env.VITE_API_URL}${path}`;
  ```
- `../services/authService.js` exporting `AuthService.getToken()` — your
  auth token getter. If you're not auth-gated, just `() => null`.

Mount the `<VoiceProvider>` near the top of your tree. Use `useVoice()`
to read `{ visemes, speaking, listening, ... }` and pass `visemes` into
`<PatientAvatar />`.

### Server

```bash
npm install express
# Kokoro path:
npm install kokoro-js @huggingface/transformers
# Google path: just needs an API key — no extra deps
```

Copy `server/*` next to your route handler. Add a `/api/tts` POST
handler that dispatches to either provider — see `rohySimulator/server/routes.js`
for the reference implementation (`router.post('/tts', ...)`). It accepts
`{ text, voice, rate, gender }` and returns either:

- `Content-Type: audio/wav` (single buffer mode) — for non-streaming
  callers like agents; or
- `Content-Type: application/x-rohy-pcm-stream` (chunk-streamed mode) —
  when the client sends `Accept: application/x-rohy-pcm-stream` or
  `?stream=1`.

For Google, set either `process.env.GOOGLE_TTS_API_KEY` or pass `apiKey`
to `synthesizeGoogleStream({...})`.

### Avatars

```bash
mkdir -p public/avatars/heads
cp kits/talking-avatars/glbs/*.glb public/avatars/heads/
cp kits/talking-avatars/glbs/manifest.json public/avatars/heads/
```

The runtime fetches `/avatars/heads/<filename>.glb` and
`/avatars/heads/manifest.json` — adjust paths in `PatientAvatar.jsx` /
your `baseUrl()` helper if you host them elsewhere.

### Pipeline (only needed to add new RocketBox avatars)

```bash
cd kits/talking-avatars/pipeline
npm install
npm run convert
```

Read `pipeline/README.md` for details.

---

## 15. Common problems and fixes

### Avatar loads but mouth doesn't move

- Open browser devtools → Network tab. Confirm `/api/tts` is being
  called and returns 200.
- Confirm `Content-Type` is either `audio/wav` or
  `application/x-rohy-pcm-stream`.
- In the Console, log `_lipsync.viseme` inside the rAF loop. If it's
  always `viseme_sil`, the analyser isn't getting audio data — check
  the `source.connect(analyser)` chain.
- Check `mesh.morphTargetDictionary` for one of the avatars in
  `glbs/`. It should contain `viseme_aa`, `viseme_PP`, etc. If not,
  the GLB doesn't have the morph names the runtime expects — re-run
  the conversion pipeline or rename the morphs in Blender.

### Audio plays but is choppy / has pops between sentences

- Streaming path: the `nextStartTime` cursor is supposed to keep
  consecutive chunks gapless. Confirm `audioCtx.currentTime` isn't
  drifting (it shouldn't — Web Audio is sample-accurate). The most
  common cause is a paused tab — `AudioContext` suspends, the cursor
  goes stale.
- Non-streaming path (single WAV decoded at once): no chunk boundaries
  to worry about. If you're hearing pops, it's a clipping issue in
  the decode — check `int16BytesToAudioBuffer`'s scaling math.

### Kokoro hangs on the last sentence

Almost always the unclosed-splitter bug from kokoro-js. Confirm
`server/kokoroTts.js` builds its own `TextSplitterStream` and explicitly
calls `splitter.close()` after pushing text. Don't use the
`tts.stream(string, opts)` overload.

### Google returns 403

API key isn't enabled for the Text-to-Speech API. Console → APIs &
Services → Library → search "Cloud Text-to-Speech API" → Enable.

### Multiple `AudioContext` warnings in the console

You're creating a new context per call. Reuse the one inside
`_lipsync.audioContext`. Browsers cap at ~6 contexts; after that, new
ones are created in a "suspended" state and never resume.

### "morphTargetDictionary is undefined"

The GLB you're loading isn't morph-rigged. Some Blender exports skip
shape keys if "Shape Keys" isn't checked in the export panel. Re-export
with shape keys included, or run the model through `pipeline/convert.mjs`.

---

## 16. Licensing notes

| Asset / code | License | Source |
|---|---|---|
| `glbs/avatarsdk.glb`, `brunette*.glb`, `vroid.glb`, `avaturn.glb`, `mpfb.glb` | MIT | [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) |
| `glbs/rb_*.glb` (22 files) | MIT | [Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox), converted by this kit's pipeline |
| `client/*`, `server/*`, `pipeline/*`, this README | Same as parent project (rohySimulator) — check repo root LICENSE |
| Kokoro-82M model weights | Apache-2.0 | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) — downloaded at runtime, not bundled |
| Google Cloud TTS output | Google Cloud Platform Terms of Service apply |
| `wawa-lipsync` | MIT | npm |
| `@react-three/fiber`, `@react-three/drei`, `three` | MIT | npm |
| `kokoro-js`, `@huggingface/transformers` | Apache-2.0 / MIT | npm |
| `fbx2gltf`, `@gltf-transform/*`, `sharp`, `tga` | MIT / various permissive | npm |

All shipped GLBs are free to redistribute under MIT. Microsoft RocketBox
is distributed for academic and commercial use under MIT per the upstream
repo's LICENSE.

---

## 17. Why we don't use Ready Player Me, Polly, ElevenLabs, etc.

A few defensible choices worth flagging up-front:

### Ready Player Me — gone

Ready Player Me used to be the default for the rohySimulator. They
deprecated their public avatar service. The 22 RocketBox heads were
specifically converted to replace RPM as the canonical avatar source.
**Do not suggest RPM as an avatar source going forward.**

### Amazon Polly

Same quality tier as Google Neural2 (one generation behind Chirp 3 HD).
Pricing is similar ($4/1M for standard voices, $16/1M for neural).
Worth adding as a third provider if you need region-locked / VPC-only
synthesis, but for general use Google is the better choice today.

### ElevenLabs

Best quality of any current TTS service, but:

- ~$5/1M chars on the lowest paid tier — 30× more expensive than Google.
- No meaningful free tier for production use.
- Requires API key, no SLA on their lower tiers.

If you have the budget and quality is the only metric, ElevenLabs would
be a 4-line addition to this kit (same shape as `googleTts.js`). It just
isn't the right default for an open educational tool.

### OpenAI `gpt-4o-mini-tts`

Already supported in the parent rohySimulator (`server/services/openaiTts.js`).
Not in this kit because the `kokoroTts.js` + `googleTts.js` pair already
covers the local-or-cloud spectrum the kit is meant to demonstrate.
Adding OpenAI is straightforward if you want a third option — copy the
pattern.

### Native phoneme-driven lipsync

What this kit *doesn't* do: ask the TTS provider for SSML `<mark>`
events or phoneme timing metadata, and drive morphs from those instead
of the FFT. That's the route to "perfect" lipsync. The cost is:

- Server-side phoneme alignment (espeak-ng, or provider-specific marks).
- A second wire format for marks alongside the audio.
- A scheduler that pairs marks with audio time positions.

Worth doing if you're shipping a flagship product. Overkill for an
educational sim where 60 fps FFT lipsync already reads as natural to
~95 % of viewers.

---

## Reference: the file-by-file map

Everything in this kit, with line-counts and one-line summaries:

```
client/
  PatientAvatar.jsx          194 lines    R3F component; per-frame morph driver, scene clone, blink scheduler
  visemes.js                  14 lines    The 15-key canonical viseme list (single source of truth)
  resolveAvatar.js            30 lines    Pick which GLB to render for a given character
  avatarFraming.js            27 lines    Per-avatar camera resolution + slider patch helpers
  voiceService.js            408 lines    TTS dispatch, PCM streaming parser, Web Audio scheduling, lipsync glue, browser STT
  VoiceContext.jsx            45 lines    Optional shared state (mode/listening/speaking/visemes/headManifest)

server/
  kokoroTts.js               120 lines    Kokoro-82M loader + streaming/non-streaming synthesis
  googleTts.js               162 lines    Google Cloud TTS REST client + voice catalog
  wav.js                      36 lines    Shared PCM/WAV helpers (header builder, float→int16)

pipeline/
  convert.mjs                318 lines    RocketBox FBX → viseme-rigged GLB pipeline
  avatars.json                14 lines    List of avatars to convert
  package.json                            @gltf-transform, fbx2gltf, sharp, tga
  README.md                              Pipeline-specific docs

glbs/
  manifest.json                          Demographic + camera-framing index for the 28 GLBs
  *.glb                                  28 viseme-rigged head meshes (~226 MB total)
```

Total kit code: ~1380 lines across 13 files. Total assets including
GLBs: ~226 MB.

That's everything needed to put a face on a chatbot.
