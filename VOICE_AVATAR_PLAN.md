# Voice + Avatar Implementation Plan (Stack T)

Self-contained spec for adding voice conversation and animated 3D avatar to Rohy's chat. A fresh session should be able to execute this end to end without needing prior conversation context.

## 1. Goal

Let students hold a voice conversation with the AI patient instead of typing. While the patient speaks, a 3D head with anatomically correct lip movement animates on screen. Voice mode is opt-in per session, controlled by an admin-configurable platform setting.

## 2. Hard constraints

These are non-negotiable. Anything that violates them is wrong.

1. **No grading.** No automatic scoring, no Opus calls at session end, no rubric system. Skip any "evaluate the student's performance" feature regardless of how natural it would feel to add.
2. **No hardcoded API choices anywhere in `src/` or `server/routes.js`.** Every model name, voice file, language, speech rate, pitch, and provider must be persisted server-side and fetched at runtime. Frontend defaults are forbidden.
3. **No third-party runtime APIs except Claude** (already in place via `/api/proxy/llm`). No D-ID, HeyGen, Tavus, Synthesia, ElevenLabs, OpenAI TTS, Cartesia, Deepgram, or any other paid voice/avatar service.
4. **Local-first.** TTS runs on the Rohy backend. STT runs in the browser. Avatar rendering is fully client-side.
5. **Free at runtime.** Per-session cost target ≈ **$0.13** (Claude only). No per-minute video, no per-character TTS bills.
6. **Pattern-match Rohy's existing code style.** ES modules, no state library, plain `fetch`, Tailwind, lucide-react icons, dark theme (`bg-neutral-900` cards, `border-neutral-700`, white/neutral-300 text).

## 3. Architecture: Stack T

```
┌────────────────────────────── BROWSER ──────────────────────────────┐
│                                                                      │
│  Mic ──► SpeechRecognition (lang from voice settings)                │
│                  │                                                   │
│                  ▼                                                   │
│              transcript                                              │
│                  │                                                   │
│                  ▼                                                   │
│  POST /api/proxy/llm   { messages, system_prompt,                    │
│                          session_mode: 'voice' }    [EXISTS]         │
│                  │                                                   │
│                  ▼                                                   │
│              reply text                                              │
│                  │                                                   │
│                  ▼                                                   │
│  POST /api/tts   { text, voice }                  [NEW]              │
│                  │                                                   │
│                  ▼                                                   │
│        WAV/MP3 audio stream                                          │
│                  │                                                   │
│       ┌──────────┴──────────┐                                        │
│       ▼                     ▼                                        │
│  <audio>            Web Audio AnalyserNode                           │
│   plays                     │                                        │
│   audio                     ▼                                        │
│                       wawa-lipsync                                   │
│                             │                                        │
│                             ▼                                        │
│                  visemes per frame                                   │
│                             │                                        │
│                             ▼                                        │
│              <Avatar /> (Three.js + r3f + RPM head)                  │
│                             │                                        │
│                             ▼                                        │
│              [3D head's lips deform with audio]                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────── EXPRESS SERVER ─────────────────────────┐
│                                                                      │
│  /api/proxy/llm      [exists] — extended to honor session_mode       │
│  /api/tts            [new]    — Piper renders audio                  │
│  /api/tts/voices     [new]    — lists Piper .onnx files on disk      │
│  /api/llm/models     [new or existing] — lists known model IDs       │
│  /api/platform-settings/voice  [new] — GET (auth) + PUT (admin)      │
└──────────────────────────────────────────────────────────────────────┘
```

## 4. Branch state at start of next session

- Branch `feat/voice-avatars` already exists, off `main` at `6144116`.
- Working tree should be clean. Verify with `git status`.
- Earlier SVG-based `src/services/voiceService.js` and `src/components/chat/PatientAvatar.jsx` were created and then deleted; do not resurrect them.
- `medkit-app/` exists in working tree as local reference (read-only). It's in `.git/info/exclude`, will not appear in `git status`. Use it for reference only — its license forbids redistribution.

If anything is dirty when starting:
```bash
git switch feat/voice-avatars
git status   # must be clean
```

## 5. Configuration schema

All settings live in the platform_settings table (or whatever Rohy uses for `/api/platform-settings/chat`). Group key: `voice`.

| Setting | Type | Allowed values | Notes |
|---|---|---|---|
| `voice_mode_enabled` | bool | true / false | Master toggle. When false, no voice UI shows. |
| `tts_provider` | enum | `piper` \| `browser` | `browser` is the fallback when Piper unavailable. |
| `piper_voice_male` | string | filename without path | Must exist in `server/data/piper/`. |
| `piper_voice_female` | string | filename without path | Same. |
| `piper_voice_child` | string | filename without path | Same. |
| `tts_rate` | float | 0.5 – 1.5 | Speech rate multiplier. |
| `tts_pitch` | float | 0.5 – 1.5 | Pitch multiplier. |
| `stt_provider` | enum | `browser` | Only browser supported initially. |
| `stt_language` | string | BCP-47 locale | e.g. `en-US`, `en-GB`, `tr-TR`. |
| `avatar_type` | enum | `3d_head` \| `none` | Future: `photo`. |
| `llm_model_voice` | string \| null | any model ID, null = inherit | Voice-only override for the chat model. |

No defaults shipped in code. On first install, settings are empty and admin must populate via ConfigPanel before voice mode can be enabled. `voice_mode_enabled` defaults to `false`.

## 6. API contracts

### `GET /api/platform-settings/voice`
- Auth: `authenticateToken`
- Response: 200 with `{ voice_mode_enabled, tts_provider, piper_voice_male, ..., llm_model_voice }` — all fields, nullable where absent.
- Used by frontend to know whether to show voice UI and how to configure it.

### `PUT /api/platform-settings/voice`
- Auth: `authenticateToken` + `requireAdmin`
- Body: same shape as GET response (partial accepted).
- Validates types and enum values; rejects unknown keys.
- Returns 200 with updated full settings.

### `POST /api/tts`
- Auth: `authenticateToken`
- Body: `{ text: string, voice: string, rate?: number, pitch?: number }`
  - `voice` is one of the filenames discovered by `/api/tts/voices`.
  - `rate` and `pitch` default to settings values if omitted.
- Behavior:
  1. Validate `text` length (cap at e.g. 2000 chars to avoid abuse).
  2. Resolve voice file path against `server/data/piper/`. Reject if not found.
  3. Spawn `piper --model <voicePath> --output_raw` (or use Node ONNX binding).
  4. Stream audio back. Content-Type: `audio/wav`. Use chunked transfer encoding.
  5. Log usage (for cost tracking parity with `logInteraction`).
- On error: 500 with `{ error }`. Do not expose stderr details.

### `GET /api/tts/voices`
- Auth: `authenticateToken`
- Behavior: scan `server/data/piper/` for `*.onnx` files. Return `{ voices: [{ filename, displayName, language, gender }] }`. Parse displayName/language/gender from filename convention or sidecar `.json` if present.

### `GET /api/llm/models`
- Auth: `authenticateToken`
- Behavior: return list of known model IDs the admin can pick from. May already exist somewhere in the codebase — search first. If not, hard-code the list of currently-supported Anthropic model IDs in this single endpoint (this is the *only* place model names live, and even here they're behind an API call).

### Extend `POST /api/proxy/llm`
- Add optional `session_mode` field to request body.
- If `session_mode === 'voice'` AND voice settings have `llm_model_voice` set AND it's non-null, use that model for this call.
- Otherwise use the existing model resolution (whatever the proxy currently does).

## 7. Tasks (executive order)

Execute these in order — each depends on the prior.

### Task 6: Backend voice settings table + CRUD routes

**Files:**
- `server/db.js` — add migration for voice settings if using a typed table; otherwise reuse generic `platform_settings` (check existing chat settings to match pattern).
- `server/routes.js` — add `GET /api/platform-settings/voice` and `PUT /api/platform-settings/voice` near where `/api/platform-settings/chat` lives.
- `server/middleware/auth.js` — already has `authenticateToken` and `requireAdmin`; reuse.

**Validation:** strict allow-list on enum keys (`tts_provider`, `stt_provider`, `avatar_type`); range checks on `tts_rate` and `tts_pitch`; `llm_model_voice` accepts any string or null.

**Done when:** can hit GET/PUT with curl + JWT and see settings persist.

### Task 7: Backend Piper install + `/api/tts`

**Install Piper on the server:**
```bash
cd server
mkdir -p data/piper
# macOS / Linux: download static binary from https://github.com/rhasspy/piper/releases
curl -L -o data/piper/piper.tgz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_amd64.tar.gz
tar -xzf data/piper/piper.tgz -C data/piper
mv data/piper/piper data/piper/bin
# voice models (start with three):
curl -L -o data/piper/en_US-amy-medium.onnx        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o data/piper/en_US-amy-medium.onnx.json   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
curl -L -o data/piper/en_US-ryan-medium.onnx       https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx
curl -L -o data/piper/en_US-ryan-medium.onnx.json  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json
curl -L -o data/piper/en_GB-jenny_dioco-medium.onnx       https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx
curl -L -o data/piper/en_GB-jenny_dioco-medium.onnx.json  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json
```
Add `server/data/piper/` to `.gitignore` — voice models are large and don't belong in git. Document the download steps in `server/README.md` or `SETUP_ENV.sh`.

**Create the route in `server/routes.js`:**
```js
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PIPER_DIR = path.join(process.cwd(), 'server', 'data', 'piper');
const PIPER_BIN = path.join(PIPER_DIR, 'bin', 'piper');

router.post('/tts', authenticateToken, async (req, res) => {
    const { text, voice, rate, pitch } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
    }
    if (text.length > 2000) {
        return res.status(400).json({ error: 'text too long' });
    }
    const voiceFile = path.join(PIPER_DIR, voice);
    if (!voiceFile.startsWith(PIPER_DIR) || !fs.existsSync(voiceFile)) {
        return res.status(400).json({ error: 'unknown voice' });
    }

    res.set('Content-Type', 'audio/wav');
    res.set('Cache-Control', 'no-store');

    const args = ['--model', voiceFile, '--output-raw'];
    if (rate) args.push('--length-scale', String(1 / rate));
    const piper = spawn(PIPER_BIN, args);
    piper.stdin.write(text);
    piper.stdin.end();

    // Piper outputs raw 16-bit PCM at 22050 Hz on output-raw.
    // Convert to WAV by prepending the WAV header before streaming.
    // (See Piper docs for exact sample rate per voice — read from .onnx.json sidecar.)
    // Easiest: use --output-stream and let Piper write WAV directly to a pipe.
    piper.stdout.pipe(res);
    piper.stderr.on('data', d => console.warn('[piper]', d.toString()));
    piper.on('error', err => {
        console.error('[piper] spawn error', err);
        if (!res.headersSent) res.status(500).end();
    });
});

router.get('/tts/voices', authenticateToken, (req, res) => {
    if (!fs.existsSync(PIPER_DIR)) return res.json({ voices: [] });
    const files = fs.readdirSync(PIPER_DIR).filter(f => f.endsWith('.onnx'));
    const voices = files.map(filename => {
        const sidecar = path.join(PIPER_DIR, filename + '.json');
        let language = 'unknown', sampleRate = 22050;
        if (fs.existsSync(sidecar)) {
            try {
                const j = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
                language = j.language?.code || j.language?.name_native || 'unknown';
                sampleRate = j.audio?.sample_rate || sampleRate;
            } catch {}
        }
        const m = filename.match(/^([a-z]{2}_[A-Z]{2})-([^-]+)-/);
        const speaker = m?.[2] || filename;
        return { filename, displayName: speaker, language, sampleRate };
    });
    res.json({ voices });
});
```
**Note:** Use Piper's `--output-stream` flag if available in the version you install — it writes a proper WAV to stdout including the header. Otherwise prepend a WAV header manually. Test with `curl -X POST http://localhost:3000/api/tts -H 'Authorization: Bearer ...' -H 'Content-Type: application/json' -d '{"text":"Hello, my name is Maya.","voice":"en_US-amy-medium.onnx"}' --output test.wav && afplay test.wav` (macOS) or `aplay test.wav` (Linux).

**Done when:** curl POST returns playable WAV; voices endpoint lists the three files installed above.

### Task 8: voice-mode model override for `/proxy/llm`

**Files:** `server/routes.js` (the existing `/proxy/llm` handler).

**Logic:**
```js
// inside /proxy/llm handler, after parsing body:
const sessionMode = req.body.session_mode;  // 'voice' | undefined
let modelOverride = null;
if (sessionMode === 'voice') {
    const voiceSettings = await getPlatformSettings('voice');  // helper to read settings
    if (voiceSettings?.llm_model_voice) {
        modelOverride = voiceSettings.llm_model_voice;
    }
}
const modelToUse = modelOverride || existingResolvedModel;
```
**Done when:** PUT-ing `llm_model_voice` then sending a `/proxy/llm` request with `session_mode: 'voice'` causes the request to use the override; without `session_mode`, it does not.

### Task 9: Frontend voiceService for Stack T

**File:** `src/services/voiceService.js` (new — was deleted earlier).

**Responsibilities:**
- Detect STT support; expose `isSttSupported()`.
- `startListening({ lang, onResult, onError, onEnd })` — wraps SpeechRecognition. `lang` is passed in by the caller (read from voice settings — no default in this file).
- `stopListening()`.
- `speak({ text, voice, rate, pitch, onAudioReady, onVisemes, onStart, onEnd, onError })`:
  1. POST to `/api/tts` with `text` + `voice` + `rate` + `pitch`.
  2. Stream/blob the response into an HTMLAudioElement (or use MediaSource for true streaming).
  3. Wire a Web Audio AnalyserNode tap to the audio element via `MediaElementAudioSourceNode`.
  4. Feed analyser samples into `wawa-lipsync` each rAF; emit visemes via `onVisemes`.
  5. Fire `onStart` when audio plays, `onEnd` when finished.
- `cancelSpeech()` — stops audio and cancels analyser RAF loop.

**Dependencies:** `npm install wawa-lipsync` on the frontend.

**Implementation skeleton:**
```js
import { LipSync } from 'wawa-lipsync';
import { apiUrl } from '../config/api';
import { AuthService } from './authService';

const SR = typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export const VoiceService = {
    isSttSupported() { return !!SR; },
    _recognition: null,
    _audio: null,
    _audioCtx: null,
    _analyser: null,
    _lipsync: null,
    _rafId: null,

    startListening({ lang, onResult, onError, onEnd }) {
        if (!SR) return onError?.(new Error('STT not supported'));
        this.stopListening();
        const rec = new SR();
        rec.lang = lang;                    // caller-provided, no fallback
        rec.interimResults = true;
        rec.continuous = false;
        let finalT = '';
        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) finalT += r[0].transcript;
                else interim += r[0].transcript;
            }
            onResult?.({ final: finalT.trim(), interim: interim.trim(), isFinal: !!finalT });
        };
        rec.onerror = (e) => onError?.(new Error(e.error));
        rec.onend = () => { this._recognition = null; onEnd?.({ final: finalT.trim() }); };
        this._recognition = rec;
        rec.start();
    },

    stopListening() {
        if (this._recognition) { try { this._recognition.stop(); } catch {} this._recognition = null; }
    },

    async speak({ text, voice, rate, pitch, onVisemes, onStart, onEnd, onError }) {
        this.cancelSpeech();
        try {
            const res = await fetch(apiUrl('/tts'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AuthService.getToken()}`,
                },
                body: JSON.stringify({ text, voice, rate, pitch }),
            });
            if (!res.ok) throw new Error(`TTS failed (${res.status})`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            const audio = new Audio(url);
            this._audio = audio;
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this._audioCtx.createMediaElementSource(audio);
            const analyser = this._audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            analyser.connect(this._audioCtx.destination);
            this._analyser = analyser;
            this._lipsync = new LipSync(this._audioCtx);
            this._lipsync.connect(source);

            const tick = () => {
                if (!this._lipsync) return;
                this._lipsync.processAudio();
                onVisemes?.(this._lipsync.visemes);
                this._rafId = requestAnimationFrame(tick);
            };

            audio.onplay = () => { onStart?.(); tick(); };
            audio.onended = () => {
                URL.revokeObjectURL(url);
                this.cancelSpeech();
                onEnd?.();
            };
            audio.onerror = (e) => { onError?.(e); this.cancelSpeech(); };
            await audio.play();
        } catch (err) {
            onError?.(err);
        }
    },

    cancelSpeech() {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._audio) { try { this._audio.pause(); this._audio.src = ''; } catch {} this._audio = null; }
        if (this._audioCtx) { try { this._audioCtx.close(); } catch {} this._audioCtx = null; }
        this._analyser = null;
        this._lipsync = null;
    },
};
```
**Note:** the exact wawa-lipsync API (constructor, `processAudio`, `visemes`) may differ — verify against current docs at https://github.com/wass08/wawa-lipsync. Adapt as needed.

**Done when:** `VoiceService.speak({ text: 'Hello', voice: 'en_US-amy-medium.onnx' })` plays audio in the browser AND emits a stream of viseme objects through `onVisemes`.

### Task 10: 3D PatientAvatar component

**File:** `src/components/chat/PatientAvatar.jsx` (new — was deleted earlier).

**Dependencies:**
```bash
npm install three @react-three/fiber @react-three/drei
```

**Props:** `{ patient, speaking, listening, visemes }`

**Behavior:**
- Read `avatar_type` from voice settings via prop or context (caller passes it down).
- If `avatar_type === 'none'`, render nothing.
- If `avatar_type === '3d_head'`:
  - Pick GLB filename based on `patient.gender` and `patient.age` from `public/avatars/heads/manifest.json`.
  - Render `<Canvas>` with `<OrbitControls enableZoom={false} enableRotate={false}>` (or no controls).
  - Load GLB via `useGLTF` from `@react-three/drei`.
  - Each frame, update mesh `morphTargetInfluences` from `visemes` prop using ARKit/Oculus viseme name mapping.
  - Animate eye blinks via a separate effect (every 3.5–5 s).
  - Outer glow ring via CSS `box-shadow` on the canvas wrapper, color from `speaking`/`listening` state.

**RPM viseme target names** to map onto wawa-lipsync output:

| wawa viseme key | RPM morph target name |
|---|---|
| `aa` | `viseme_aa` |
| `O`  | `viseme_O` |
| `E`  | `viseme_E` |
| `I`  | `viseme_I` |
| `U`  | `viseme_U` |
| `PP` | `viseme_PP` |
| `FF` | `viseme_FF` |
| `TH` | `viseme_TH` |
| `DD` | `viseme_DD` |
| `kk` | `viseme_kk` |
| `CH` | `viseme_CH` |
| `SS` | `viseme_SS` |
| `nn` | `viseme_nn` |
| `RR` | `viseme_RR` |
| `sil` | `viseme_sil` |

Verify exact names by inspecting a downloaded RPM GLB in Blender or via `gltf-pipeline`.

**Skeleton:**
```jsx
import { Suspense, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

function HeadMesh({ url, visemes, blinking }) {
    const { scene } = useGLTF(url);
    const meshRef = useRef();

    useEffect(() => {
        scene.traverse((obj) => {
            if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
                meshRef.current = obj;
            }
        });
    }, [scene]);

    useFrame(() => {
        const mesh = meshRef.current;
        if (!mesh || !visemes) return;
        const dict = mesh.morphTargetDictionary;
        const infl = mesh.morphTargetInfluences;
        for (const [key, weight] of Object.entries(visemes)) {
            const idx = dict[`viseme_${key}`];
            if (idx != null) infl[idx] = weight;
        }
        if (blinking) {
            const lIdx = dict.eyeBlinkLeft;
            const rIdx = dict.eyeBlinkRight;
            if (lIdx != null) infl[lIdx] = 1;
            if (rIdx != null) infl[rIdx] = 1;
        } else {
            const lIdx = dict.eyeBlinkLeft;
            const rIdx = dict.eyeBlinkRight;
            if (lIdx != null) infl[lIdx] = 0;
            if (rIdx != null) infl[rIdx] = 0;
        }
    });

    return <primitive object={scene} />;
}

export default function PatientAvatar({ patient, speaking, listening, visemes, avatarType = '3d_head', headManifest }) {
    const [blinking, setBlinking] = useState(false);
    useEffect(() => {
        const id = setInterval(() => {
            setBlinking(true);
            setTimeout(() => setBlinking(false), 130);
        }, 3500 + Math.random() * 2000);
        return () => clearInterval(id);
    }, []);

    if (avatarType === 'none') return null;
    if (!headManifest) return null;

    const url = pickHead(patient, headManifest);
    const ringColor = listening ? '#22c55e' : speaking ? '#3b82f6' : 'transparent';

    return (
        <div
            className="rounded-full overflow-hidden"
            style={{
                width: 200, height: 200,
                boxShadow: ringColor !== 'transparent' ? `0 0 0 4px ${ringColor}, 0 0 24px ${ringColor}` : 'none',
                transition: 'box-shadow 200ms',
            }}
        >
            <Canvas camera={{ position: [0, 1.6, 0.6], fov: 25 }}>
                <ambientLight intensity={1.0} />
                <directionalLight position={[2, 3, 2]} intensity={1.2} />
                <Suspense fallback={null}>
                    <HeadMesh url={url} visemes={visemes} blinking={blinking} />
                </Suspense>
            </Canvas>
        </div>
    );
}

function pickHead(patient, manifest) {
    const age = Number(patient?.age) || 35;
    const gender = /^f/i.test(patient?.gender || '') ? 'female' : 'male';
    const bucket = age < 13 ? 'child' : age < 40 ? 'young' : age < 65 ? 'middle' : 'elderly';
    const pool = bucket === 'child' ? manifest.child : manifest[gender]?.[bucket] || manifest.fallback || [];
    if (pool.length === 0) return null;
    const seed = String(patient?.id ?? patient?.name ?? '');
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h) + seed.charCodeAt(i);
    return `/avatars/heads/${pool[Math.abs(h) % pool.length]}`;
}
```

**Done when:** the head loads, visible morph targets respond to viseme prop changes, eyes blink on idle, glow ring lights up correctly.

### Task 11: ConfigPanel voice tab

**Files:** `src/components/settings/ConfigPanel.jsx` (existing — modify), and possibly extract `src/components/settings/VoiceSettingsTab.jsx`.

**Pattern to follow:** look at how `chat` settings are loaded/saved in the existing ConfigPanel. Same pattern for `voice`. The CLAUDE.md notes the three insertion points:
1. Import the component at line ~19
2. Add sidebar button inside the `isAdmin()` block (after line ~311)
3. Add tab content before `</div>` closing the content area (around line ~855)

**UI:**
- Toggle: "Enable voice mode"
- Dropdown: "Default male voice" (populated from `/api/tts/voices`)
- Dropdown: "Default female voice"
- Dropdown: "Default child voice"
- Slider: TTS rate (0.5 – 1.5)
- Slider: TTS pitch (0.5 – 1.5)
- Dropdown: STT language (BCP-47 list — short curated list initially, e.g. en-US, en-GB, tr-TR, ar-SA, fr-FR, de-DE)
- Radio: Avatar type (`3D head`, `none`)
- Combobox: Voice-mode LLM override (autocomplete from `/api/llm/models`, "inherit" option = null)
- Save button → PUT `/api/platform-settings/voice`.

Show "Piper not installed" warning if `/api/tts/voices` returns empty.

**Done when:** admin can change settings and refresh page sees them persisted; non-admin users get 403 on PUT.

### Task 12: Wire pipeline into ChatInterface

**File:** `src/components/chat/ChatInterface.jsx` (modify).

**Changes:**
1. Import `VoiceService`, `PatientAvatar`, `Mic`, `MicOff` icons.
2. New state: `voiceMode` (bool), `listening` (bool), `speaking` (bool), `visemes` ({}), `voiceSettings` (loaded from `/api/platform-settings/voice` on mount), `headManifest` (loaded from `/avatars/heads/manifest.json`).
3. If `voiceSettings.voice_mode_enabled === false`, no voice UI shows — bail out of voice rendering entirely.
4. Add a toggle button in the chat header: shows mic icon, click flips `voiceMode`. Hide if `voice_mode_enabled` is false in settings.
5. When `voiceMode && activeTab === 'patient'`: render `<PatientAvatar />` above the messages, passing `patient={activeCase}`, `speaking`, `listening`, `visemes`, `avatarType={voiceSettings.avatar_type}`, `headManifest`.
6. Replace (or augment) the send button area with a push-to-talk button when `voiceMode`. On press: `VoiceService.startListening({ lang: voiceSettings.stt_language, onResult: ({final, interim, isFinal}) => { setInput(interim || final); if (isFinal) handleSend(); } })`. On release or `onEnd`: stop.
7. After `responseText` arrives in `handleSendToPatient`, if `voiceMode`: pick voice file (gender from `activeCase.gender` → `voiceSettings.piper_voice_male`/`female`/`child`) and call `VoiceService.speak({ text: responseText, voice, rate: voiceSettings.tts_rate, pitch: voiceSettings.tts_pitch, onStart: () => setSpeaking(true), onVisemes: setVisemes, onEnd: () => setSpeaking(false) })`.
8. When sending the LLM request in voice mode, include `session_mode: 'voice'` in the body so the backend can apply the voice model override.
9. Cleanup: cancel speech and stop listening on unmount, on session end, on case change.

**Done when:** with voice mode on, full loop works (speak → transcript → Claude → audio → animated mouth → next turn).

### Task 13: Source RPM head GLBs + manifest

**Steps:**
1. Go to https://readyplayer.me, log in (free), use the avatar creator.
2. Generate ~10 avatars covering: female × {young, middle, elderly} (3), male × {young, middle, elderly} (3), 2 children, 1 fallback. Aim for diversity in skin tone and ethnicity.
3. For each avatar, use the API endpoint `https://api.readyplayer.me/v1/avatars/<id>.glb?meshLod=1&textureSizeLimit=512&morphTargets=Oculus%20Visemes,ARKit` to download a head-light version with viseme morph targets included.
4. Place files in `public/avatars/heads/` named like `f-young-1.glb`, `m-elderly-2.glb`, etc.
5. Write `public/avatars/heads/manifest.json`:
```json
{
  "female": {
    "young":   ["f-young-1.glb", "f-young-2.glb"],
    "middle":  ["f-middle-1.glb"],
    "elderly": ["f-elderly-1.glb"]
  },
  "male": {
    "young":   ["m-young-1.glb"],
    "middle":  ["m-middle-1.glb", "m-middle-2.glb"],
    "elderly": ["m-elderly-1.glb"]
  },
  "child": ["child-1.glb", "child-2.glb"],
  "fallback": ["m-middle-1.glb"]
}
```

**Important:** verify each downloaded GLB actually contains the `viseme_*` morph targets. Open one in https://gltf-viewer.donmccurdy.com/ — under "Mesh Inspector" you should see ~15 morph targets named `viseme_aa`, `viseme_PP`, etc. If not, redownload with `morphTargets=Oculus%20Visemes` query string explicitly set.

**Done when:** at least the 8 covered demographic buckets each load and animate.

### Task 14: Test end-to-end

Run on `feat/voice-avatars`:
```bash
npm run dev
```
Then in the browser:

1. **Settings unset:** open ConfigPanel → Voice tab. Verify Piper voice dropdowns are empty (or show "Piper not installed" if `/api/tts/voices` returns empty). With nothing set, voice toggle should NOT appear in the chat UI.
2. **Settings populated:** admin sets `voice_mode_enabled=true`, picks one voice for each gender, sets rate=1.0, pitch=1.0, language=en-US, avatar_type=3d_head, llm_model_voice=null. Save.
3. **Voice toggle:** reload chat. Voice toggle button is visible. Click it. Avatar appears above messages.
4. **Mic flow:** push-to-talk. Speak "Hello, how are you feeling today?". Release. Transcript appears in input, auto-submits. Loading spinner. After ~1–2s, audio plays from speakers. Avatar's lips animate while audio plays. Avatar's eyes blink periodically. After audio ends, mic is available again.
5. **Voice-mode model override:** in ConfigPanel set `llm_model_voice` to a different model. Send a voice message. Verify (in server logs) that the override model was used. Send a text message. Verify the original model was used.
6. **Disabled state:** set `voice_mode_enabled=false`. Reload chat. Voice toggle is gone. Text mode unchanged.
7. **Non-admin:** log in as student. Open ConfigPanel. Voice tab is hidden. PUT `/api/platform-settings/voice` returns 403.
8. **Browser without STT:** if testing on Firefox/Safari, voice toggle still appears but mic button shows "STT not supported in this browser" or similar graceful message.

## 8. File inventory

### New files
- `server/data/piper/` (gitignored, populated by setup script)
- `public/avatars/heads/*.glb` (10–12 head models)
- `public/avatars/heads/manifest.json`
- `src/services/voiceService.js`
- `src/components/chat/PatientAvatar.jsx`
- `src/components/settings/VoiceSettingsTab.jsx` (optional — could inline in ConfigPanel)

### Modified files
- `server/routes.js` — add `/api/tts`, `/api/tts/voices`, `/api/platform-settings/voice` routes; modify `/api/proxy/llm` for `session_mode`.
- `server/db.js` — add voice settings persistence if needed.
- `src/components/chat/ChatInterface.jsx` — wire voice mode + avatar.
- `src/components/settings/ConfigPanel.jsx` — add voice tab.
- `package.json` — add `wawa-lipsync`, `three`, `@react-three/fiber`, `@react-three/drei`.
- `.gitignore` — add `server/data/piper/*.onnx`, `server/data/piper/*.onnx.json`, `server/data/piper/bin/`.
- `SETUP_ENV.sh` or `server/README.md` — document Piper download steps.

### Deleted files
- (None — earlier SVG attempts already deleted before plan was written.)

## 9. Cost & latency targets (verification)

After implementation, measure and confirm:

| Metric | Target | How to verify |
|---|---|---|
| Per-session Claude cost | ≤ $0.13 (no grading) | Check existing usage tracking in `LLMService.logInteraction` and admin LLM usage UI. |
| Per-turn latency from "release mic" to "patient starts speaking" | < 2.0 s | Browser DevTools Network tab + `console.time` around `speak()`. |
| Piper render time per response | < 500 ms for typical 100-word response | Server-side timing log. |
| Bundle size impact | < 1 MB gzipped client added | `npm run build` then check `dist/` sizes. |
| Per-avatar GLB size | < 2 MB | `du -h public/avatars/heads/*.glb`. |
| Voice model server disk | ~30 MB × 3 voices ≈ 100 MB | `du -sh server/data/piper/`. |

## 10. References

- Piper TTS: https://github.com/rhasspy/piper (binary releases, voices on HuggingFace `rhasspy/piper-voices`)
- Piper voices catalog (audible samples): https://rhasspy.github.io/piper-samples/
- wawa-lipsync: https://github.com/wass08/wawa-lipsync
- Ready Player Me docs: https://docs.readyplayer.me/ready-player-me/avatars/avatar-creator
- RPM head-only morph target download: https://docs.readyplayer.me/ready-player-me/api-reference/avatars/get-3d-avatars#avatar-meshlod
- Three.js: https://threejs.org/
- react-three-fiber: https://docs.pmnd.rs/react-three-fiber
- @react-three/drei (`useGLTF`): https://github.com/pmndrs/drei
- Browser SpeechRecognition support: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- ARKit / Oculus viseme reference: https://docs.unity3d.com/Packages/com.unity.live-capture.face-capture@latest

## 11. Done definition

The feature is complete when:
1. All 9 tasks in section 7 are checked off.
2. Test plan in section 14 passes for all 8 scenarios.
3. Cost targets in section 9 are met.
4. No model name, voice file, language, or rate appears as a literal string in `src/` or in non-route code.
5. A non-admin user cannot enable voice mode or change voice settings.
6. With Piper missing or `voice_mode_enabled=false`, the existing text chat flow is byte-for-byte unchanged.
7. Branch `feat/voice-avatars` opens cleanly as a PR against `main` — no conflicts.

## 12. Out of scope (do not build)

- Grading, scoring, evaluation of any kind.
- Real-time interruption / barge-in (would require LiveKit-style streaming).
- Multi-language LLM responses (separate feature; voice surface only).
- Cloud TTS providers (ElevenLabs, OpenAI, Cartesia).
- Cloud avatar providers (D-ID, HeyGen, Synthesia, Tavus).
- Webcam-based facial tracking (future, separate feature).
- Voice cloning from real patients.
- Persistent per-patient voice/avatar overrides (could be a future enhancement after MVP).

---

End of plan. Execute in order. Branch `feat/voice-avatars` is ready.
