# Session Handoff — 2026-05-01

## Completed (Tasks 6–12 from VOICE_AVATAR_PLAN.md)

Stack T scaffolding is in place end-to-end. Server starts cleanly, all new routes
register, validation works, admin guard works, full client bundle builds and lints.

### Backend (`server/routes.js`)
- `GET/PUT /api/platform-settings/voice` — generic platform_settings keyed CRUD
  with strict validation (path traversal blocked on voice filenames, range
  checks on rate/pitch, allowlist on enums, unknown-key rejection).
- `GET /api/tts/voices` — scans `server/data/piper/*.onnx` and returns
  `{voices, piperInstalled}`. Always includes `piperInstalled` so the frontend's
  warning banner triggers correctly.
- `POST /api/tts` — spawns Piper with `--output-raw`, buffers PCM, prepends a
  44-byte WAV header at the voice's native sample rate (read from the
  `.onnx.json` sidecar), streams `audio/wav` back. 50 MB safety cap.
- `GET /api/llm/models` — single allowed home for hardcoded Anthropic model IDs
  per plan §6 (Opus 4.7, Sonnet 4.6, Haiku 4.5, plus two legacy 3.5 entries).
- `POST /api/proxy/llm` — extended to accept `session_mode: 'voice'`. When set
  AND `llm_model_voice` is configured, that model overrides the resolved model
  for this single call (logged at console).

### Frontend
- `src/services/voiceService.js` — `isSttSupported()`, `startListening()`,
  `stopListening()`, `speak()`, `cancelSpeech()`. wawa-lipsync 0.0.2 owns the
  audio graph (do NOT pre-create AudioContext or MediaElementSource).
- `src/components/chat/PatientAvatar.jsx` — Three.js + r3f + drei. Loads RPM
  GLB via `useGLTF`, clones the scene per instance, drives morph target
  influences with smooth lerp (rise=12/s, decay=8/s) so the mouth doesn't
  flicker. Idle blink every 3.5–5s. Glow ring colored by listening/speaking.
- `src/components/settings/VoiceSettingsTab.jsx` — admin-only tab in
  ConfigPanel. Loads voice settings + `/api/tts/voices` + `/api/llm/models` in
  parallel, shows "Piper not installed" warning when binary is missing.
- `src/components/chat/ChatInterface.jsx` — voice toggle in tab bar, avatar
  above messages on patient tab, push-to-talk button replaces text input when
  voice mode active. Cleanup on case change and unmount.
- `src/services/llmService.js` — `sendMessage()` now takes a 4th
  `sessionMode` arg, threaded into the proxy/llm body.

### Setup
- `server/scripts/install-piper.sh` — platform-aware Piper installer.
  Apple Silicon caveat documented (no official arm64 binary; `brew install
  piper-tts` and set `PIPER_BIN` in `server/.env`).
- `.gitignore` — ignores `server/data/piper/` and `public/avatars/heads/*.glb`.
- `public/avatars/heads/manifest.json` — empty manifest stub so the file 200s.

## Smoke-test results (server-side, no Piper, no GLBs)

| Check | Result |
|---|---|
| Server boots cleanly | ✓ `Server is running on http://0.0.0.0:3010` |
| `GET /platform-settings/voice` no-token | 401 ✓ |
| `GET /platform-settings/voice` admin | clean null shape, `voice_mode_enabled:false` ✓ |
| `GET /llm/models` | curated Claude list ✓ |
| `GET /tts/voices` (no Piper) | `{voices:[], piperInstalled:false}` ✓ |
| `PUT /platform-settings/voice` student | 403 "Admin access required" ✓ |
| `PUT` valid full payload, then re-GET | round-trips correctly ✓ |
| `PUT piper_voice_male: "../../../etc/passwd"` | 400 "must be a safe .onnx filename" ✓ |
| `PUT tts_rate: 3.5` | 400 "must be between 0.5 and 1.5" ✓ |
| `PUT {hax: "..."}` | 400 "Unknown setting: hax" ✓ |
| Production `vite build` | 1.96 MB / 507 KB gzip — well under plan's 1 MB gzip cap ✓ |
| ESLint on new files | clean ✓ |

## Live browser verification (Playwright, 2026-05-01)

Drove the real app at `localhost:5173` (vite) → `localhost:3000` (express) with
Piper installed via `pipx install piper-tts`. Results:

- ✅ `/api/tts` end-to-end: 200, Content-Type `audio/wav`, valid RIFF/WAVE
  16-bit mono 22050 Hz, 28 KB for a 13-word sentence.
- ✅ Admin login → ConfigPanel → "Voice & Avatar" tab renders all controls,
  populated with the 3 installed Piper voices (jenny_dioco / amy / ryan), 7
  STT locales, all 5 LLM models, both sliders, both avatar radios.
- ✅ "Piper not installed" warning correctly absent (binary detected).
- ✅ Save round-trip: clicking Save in the UI persists to DB; subsequent GET
  returns the exact payload set in the form.
- ✅ Voice toggle button appears in chat tab bar after enabling voice mode
  platform-wide; disappears when toggled platform-wide off.
- ✅ Click "Voice" → push-to-talk button replaces text input, displays
  "Click to talk to John Martinez" (per-patient name interpolation works).
- ✅ Click "Voice on" → reverts to text input, push-to-talk gone.
- ✅ Lazy chunk: `PatientAvatar.jsx` (24 KB transfer) loaded only on first
  voice-mode toggle, never sooner.
- ✅ Avatar shell renders with the "no avatar configured" placeholder
  (manifest has empty arrays — Task 13 still pending).
- ✅ Student account → ConfigPanel sidebar contains zero admin tabs
  (Voice & Avatar correctly hidden along with all others).

What couldn't be verified in headless Playwright:

- Real microphone capture / SpeechRecognition (browser permission gate).
- Audio playback through speakers (no audio device).
- Live viseme animation on a populated head (no GLB sourced yet).
- LLM call in voice-mode (LLM not configured with an API key on this dev
  install).

## Open / not yet done

### Task 13 — RPM head GLBs (manual only)
The GLB models are demo-account creator content from readyplayer.me. Steps:

1. `https://readyplayer.me` → log in → use the avatar creator to make
   ~10 avatars covering: female × {young, middle, elderly}, male × same,
   2 children, 1 fallback. Mix skin tones and ethnicities.
2. For each avatar id, download a head-only GLB with viseme morphs:
   `https://api.readyplayer.me/v1/avatars/<id>.glb?meshLod=1&textureSizeLimit=512&morphTargets=Oculus%20Visemes,ARKit`
3. Drop them in `public/avatars/heads/` named like `f-young-1.glb`, etc.
4. Update `public/avatars/heads/manifest.json` with the filenames, e.g.
   `{ "female": { "young": ["f-young-1.glb"], ... }, "fallback": ["m-middle-1.glb"] }`.
5. Verify each GLB has the 15 `viseme_*` morph targets at
   `https://gltf-viewer.donmccurdy.com/`.

The `PatientAvatar` component already handles missing manifest entries
gracefully — it shows a "no avatar configured" placeholder.

### Task 14 — full browser E2E (manual only)
Server-side smoke tests above all pass. The browser-side checks require the
user at the keyboard:

1. `bash server/scripts/install-piper.sh` (on Apple Silicon: `brew install
   piper-tts` then `echo "PIPER_BIN=/opt/homebrew/bin/piper" >> server/.env`).
2. `npm run dev`.
3. Login as `admin` / `admin123`. Open ConfigPanel → "Voice & Avatar" tab.
4. Pick voices, set rate/pitch, language=`en-US`, avatar=`3d_head`,
   `voice_mode_enabled=true`. Save.
5. Pick a case. Reload chat. The "Voice" button appears in the tab bar.
6. Click "Voice" → avatar loads → click "Click to talk" → speak → release →
   transcript auto-submits → patient responds in audio with animated lips.
7. Set `llm_model_voice` to a different model. Send a voice message. Server log
   should print `[LLM Proxy] Voice-mode override active: model=<id>`.
8. Set `voice_mode_enabled=false`. Reload. Voice toggle disappears.
9. Login as `student` / `student123`. ConfigPanel → "Voice & Avatar" tab is
   hidden in the admin-only sidebar.
10. (Optional) Test in Firefox: voice toggle still appears, push-to-talk shows
    "Speech recognition not supported".

## Hard-constraint audit (plan §11 done definition)

| Constraint | Status |
|---|---|
| No grading/scoring code | ✓ none added |
| No third-party runtime APIs except Claude | ✓ Piper local, STT browser-native, avatar local |
| No model/voice/language literals in `src/` | ✓ all from `/api/platform-settings/voice` and `/api/llm/models` |
| Local-first, free at runtime | ✓ |
| Admin-only voice settings | ✓ 403 verified for student |
| Text mode unchanged when voice off | ✓ voice toggle hidden, no code paths cross |
| `feat/voice-avatars` branch ready for PR | ⚠ uncommitted; user owns commit/push decision |

## How to commit

Not committed per global CLAUDE.md ("Do not run any git commands without
explicitly asking the user first"). Suggested staging:

```
git add server/routes.js \
        server/scripts/install-piper.sh \
        src/services/voiceService.js \
        src/services/llmService.js \
        src/components/chat/PatientAvatar.jsx \
        src/components/chat/ChatInterface.jsx \
        src/components/settings/VoiceSettingsTab.jsx \
        src/components/settings/ConfigPanel.jsx \
        public/avatars/heads/manifest.json \
        package.json package-lock.json \
        .gitignore HANDOFF.md
```

## Context

- Branch: `feat/voice-avatars` off `main@6144116`.
- Node deps added: `wawa-lipsync@0.0.2`, `three@latest`, `@react-three/fiber`, `@react-three/drei@10.7.7`.
- Default seeded users: `admin/admin123`, `student/student123`.
- Dev server: `PORT=3000` (default in `.env`); use `PORT=3010` to avoid conflict with the Vite dev port.
- The pre-existing `BASE_PATH is not defined` lint error in `ChatInterface.jsx:880` and the
  set-state-in-effect at line 460 were both in the file before this session and were
  not touched.
