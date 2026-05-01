# Session Handoff — 2026-05-01

## Completed

Built and shipped the full Stack T voice + 3D avatar feature on `feat/voice-avatars` (also pushed to `Withvoice`). PR #8 open against `main` at https://github.com/mohsaqr/rohySimulator/pull/8.

Four commits, current head `50b10eb`:
- `2b52056` — backend routes, voice service, ConfigPanel tab, ChatInterface wiring
- `661dd08` — Playwright live-verification handoff record
- `3108d21` — 6 MIT-licensed GLB heads from met4citizen/TalkingHead + procedural fallback
- `50b10eb` — revert of the procedural fallback (looked uncanny)

### Backend (`server/routes.js`)
- `GET/PUT /api/platform-settings/voice` — admin-only writes, strict validation (path traversal blocked on voice filenames, range checks on rate/pitch, allowlist on enums, unknown-key rejection).
- `POST /api/tts` — spawns Piper with `--output-raw`, prepends a 44-byte WAV header at the voice's native sample rate (read from the `.onnx.json` sidecar), streams `audio/wav`. 50 MB safety cap, 2000 char text cap.
- `GET /api/tts/voices` — scans `server/data/piper/*.onnx`, always reports `piperInstalled` flag (caught via early smoke test).
- `GET /api/llm/models` — single allowed home for Anthropic model IDs per plan §6 (Opus 4.7, Sonnet 4.6, Haiku 4.5, plus two legacy 3.5 entries).
- `POST /api/proxy/llm` — accepts `session_mode: 'voice'`; when set + `llm_model_voice` configured, swaps in the override model for that single call.

### Frontend
- `src/services/voiceService.js` — wawa-lipsync 0.0.2 owns the audio graph (do NOT pre-create `AudioContext` or `MediaElementSource`; each audio element can only feed one source node). Emits dominant Oculus viseme each frame.
- `src/components/chat/PatientAvatar.jsx` — Three.js + r3f + drei. Loads RPM-style GLB via `useGLTF`, clones the scene per instance, drives morph influences with smooth lerp (rise=12/s, decay=8/s) so the mouth doesn't flicker. Idle blink every 3.5–5 s. Glow ring colored by listening/speaking. Camera framed at `(0, 1.62, 1.05)` looking at `(0, 1.62, 0)` for head-and-shoulders shot of full-body GLBs.
- `src/components/settings/VoiceSettingsTab.jsx` — admin-only ConfigPanel tab. Loads voice settings + `/api/tts/voices` + `/api/llm/models` in parallel. Shows "Piper not installed" warning when binary is missing.
- `src/components/chat/ChatInterface.jsx` — voice toggle in tab bar, push-to-talk replaces text input on patient tab, avatar pane above messages. Cleanup on case change and unmount. `LLMService.sendMessage()` takes a 4th `sessionMode` arg threaded into the proxy/llm body.

### Setup
- `server/scripts/install-piper.sh` — downloads three starter Piper voices into `server/data/piper/`. Apple Silicon path: `pipx install piper-tts` then add `PIPER_BIN=$(which piper)` to `server/.env`.
- `.gitignore` — ignores `server/data/piper/` (binaries + onnx are large) but **NOT** `public/avatars/heads/*.glb` (committed because Ready Player Me shut down).
- 6 MIT-licensed GLB heads in `public/avatars/heads/` (~71 MB total): `avatarsdk.glb` (M), `avaturn.glb`, `brunette.glb`, `brunette-t.glb`, `mpfb.glb`, `vroid.glb` (all F). Manifest distributes them across age buckets.

## Current State

### What works (verified live, this session)
- Server boots cleanly, all routes register.
- Admin login → ConfigPanel → "Voice & Avatar" tab fully populated: 3 Piper voices, 7 STT locales, all 5 LLM models, both sliders, both avatar radios. No false "Piper not installed" warning.
- UI Save button persists settings round-trip through DB.
- Voice toggle appears in chat tab bar with `voice_mode_enabled=true`; disappears when toggled platform-wide off.
- Push-to-talk button replaces text input, displays patient name interpolated.
- `PatientAvatar.jsx` lazy chunk (~24 KB transfer in dev / 261 KB gzip in prod) fetched only on first voice-mode toggle.
- GLB head renders correctly framed (head-and-shoulders) — male `avatarsdk.glb` was rendered live and looked correct.
- Real Piper synthesis via `pipx install piper-tts`: `POST /api/tts` returned valid 28 KB RIFF/WAVE 16-bit mono 22050 Hz from "Hello doctor, I have been feeling chest pain since this morning."
- Student account: `PUT /platform-settings/voice` returns 403; Voice tab hidden in ConfigPanel sidebar.
- All validation paths return 400 with the right error message (path traversal, out-of-range rate, unknown key).

### What's NOT yet verified
- Real microphone capture / `SpeechRecognition` transcript (browser permission gated; Playwright headless can't grant).
- Audio playback through speakers and viseme animation on the rendered avatar.
- LLM call in voice mode end-to-end (LLM not configured with an API key on this dev install).
- The actual simulation flow — does voice mode feel right when interleaved with patient-record events, agent paging, monitor alarms, etc.? Untouched in this session.

### What was tried and reverted
- **Procedural three.js head** (`ProceduralHead.jsx`, deleted in `50b10eb`): tried building a face from primitives as a fallback when no GLB is configured. Result was uncanny — eyes looked like Pac-Man ghosts, mouth dominated lower face. Removed the file, the radio option, the allow-list entry, and the dispatch branch. Avatar choices are back to plan's two: `3d_head` or `none`.

## Key Decisions

- **Switched GLB source from Ready Player Me to met4citizen/TalkingHead.** RPM was acquired by Netflix in December 2025 and shut down for public use on 2026-01-31; the plan doc's Task 13 instructions are no longer executable. TalkingHead ships 6 demo GLBs under MIT, all explicitly designed with the 15-viseme Oculus blend shape set + ARKit blendshapes. Verified visemes are present via `strings $f | grep viseme_` on each binary.
- **Committed the GLBs to git rather than using LFS or hosting externally.** ~71 MB is acceptable; LFS would add deploy/CI complexity for assets that won't change.
- **Lazy-loaded the PatientAvatar chunk via `React.lazy`.** Three.js + r3f + drei add ~261 KB gzip. Students who never enable voice mode pay none of it. The chunk is fetched only on first voice toggle.
- **wawa-lipsync as the lipsync algorithm.** For audio without phoneme timings (Piper's default output), all FFT-based libraries hit the same ~6/10 quality ceiling — TalkingHead's audio analyzer is no better. The real upgrade path is server-side espeak phoneme timings (queued as Task #10), not a different library.
- **No procedural fallback.** A fallback that looks worse than the absence of the thing it falls back to is negative value.
- **Defense-in-depth on admin guard.** Server returns 403 on PUT for non-admins AND the UI hides the tab. Either layer alone would suffice; both means a curious student can't even discover voice settings exist.

## Open Issues

1. **Audio + video flow not yet exercised end-to-end by a human.** This is the single most important open thread. Until somebody clicks the mic, speaks, and hears + sees the patient respond, we don't know whether the integration is actually shippable.
2. **Procedural avatar removal** could leave a stale `avatar_type='procedural'` in some deployer's DB if they tested the previous commit (`3108d21`). The component currently treats unknown values as "render GLB" rather than failing loud, so it self-heals on the next save. Worth being aware of.
3. **No child-age GLBs.** Demo set has no children; the `child` bucket in `manifest.json` is empty. A pediatric case would render the fallback adult.
4. **5 of 6 GLBs are female.** Diversity skewed by what TalkingHead happened to ship.
5. **Pre-existing lint issues in `ChatInterface.jsx`** (`BASE_PATH is not defined` at line ~880, `set-state-in-effect` at line ~460) were not touched — they predate this work and are out of scope.

## Next Steps (priority order for next session)

### 1. Live audio + video test — HIGHEST PRIORITY
The whole feature is currently unproven from a user's perspective. Before any further work:

```bash
# Start the dev stack
cd /Users/mohammedsaqr/Documents/Github/rohySimulator
PORT=3000 node server/server.js &
npx vite &
open http://localhost:5173/
```

Walkthrough (also in PR description):
1. Login as `admin` / `admin123`.
2. Confirm voice settings still saved (admin → Settings → Voice & Avatar).
3. Pick the Acute Chest Pain - STEMI case (or any case).
4. Click "Voice" in the chat tab bar — avatar should appear above messages.
5. Click "Click to talk to John Martinez" — grant mic permission.
6. Speak: *"Hello, can you tell me about your chest pain?"*
7. Click the green "Listening… click to stop" button.
8. **Watch and listen for:**
   - Transcript appears in the input area
   - Auto-submits to Claude
   - Claude response renders as a chat message
   - Audio plays through speakers
   - Avatar's mouth animates while audio plays
   - Eyes blink periodically
   - Glow ring transitions: green (listening) → off → blue (speaking) → off

If any step fails, capture: browser console errors, Network tab `/api/tts` and `/api/proxy/llm` payloads, and which avatar GLB is being loaded.

### 2. Look at how voice mode meshes with the rest of the simulation
Once audio + video work in isolation, **observe the simulation**: does voice mode feel right when:
- Monitor alarms fire mid-patient-speech?
- The student pages an agent (nurse/consultant/relative) — should agent tab disable voice?
- Vital signs change while patient is talking?
- A scenario timeline event triggers (e.g., chest pain worsening)?
- The student switches between patient and agent tabs — does voice cleanup correctly?

Cleanup hooks are in place (cancel speech / stop listening on case change and unmount), but the multi-agent flow may need additional cleanup glue. **Do this with the simulation actually running**, not from reading code.

### 3. Decide on Task #10 (server-side espeak phoneme timings)
If the FFT-based lipsync looks visibly approximate during the live test (mouth opens but doesn't track specific phonemes), bump Task #10 to high priority. Implementation outline in the task description: piggyback espeak-ng on the same text Piper synthesizes, return `{audio, phonemes: [{p, t}]}`, drive visemes on a timeline synced with `audio.currentTime`. Adds ~50 ms server time.

### 4. Pediatric and male GLBs
If the simulation includes pediatric cases or needs more male diversity, source additional GLBs:
- Microsoft RocketBox (MIT, 100+ characters, but needs Mixamo re-rigging)
- Avaturn (free tier, has API)
- Generated via TalkingHead's blender scripts on RocketBox source

### 5. PR #8
Currently open. After live verification passes, merge or request review. The PR description is up to date as of `50b10eb`.

## Context

### Environment
- Node 25.5, npm; Apple Silicon Mac (Darwin arm64).
- Default seeded users: `admin/admin123`, `student/student123`.
- Branch: `feat/voice-avatars` (and identical mirror `Withvoice`) at `50b10eb`, both pushed to `origin`.
- Default ports: express :3000, vite :5173 (proxies `/api` to express).

### Dependencies added this session
- `wawa-lipsync@0.0.2`
- `three`
- `@react-three/fiber`
- `@react-three/drei@10.7.7`

### Piper install (Apple Silicon)
```bash
pipx install piper-tts
echo "PIPER_BIN=$(which piper)" >> server/.env
```
The `server/scripts/install-piper.sh` only downloads voice models on Apple Silicon (no prebuilt arm64 binary from upstream).

### Files of interest
- Plan: `VOICE_AVATAR_PLAN.md` (committed; note Task 13's RPM steps are obsolete, the implementation pivoted to TalkingHead GLBs)
- Voice settings registry: keys in `platform_settings` table prefixed `voice_`, `tts_`, `piper_`, `stt_`, `avatar_`, `llm_model_voice`
- 6 GLBs in `public/avatars/heads/`, manifest at `public/avatars/heads/manifest.json`
- Piper voices in `server/data/piper/` (gitignored): en_US-amy-medium, en_US-ryan-medium, en_GB-jenny_dioco-medium

### Things explicitly NOT in scope (per plan §12)
- Grading / scoring / evaluation
- Real-time interruption / barge-in
- Multi-language LLM responses
- Cloud TTS (ElevenLabs, OpenAI, Cartesia)
- Cloud avatars (D-ID, HeyGen, Synthesia, Tavus)
- Webcam-based facial tracking
- Voice cloning from real patients
- Persistent per-patient voice/avatar overrides

### Task tracker state
Task #10 is the only pending item: "Follow-up: server-side espeak phoneme timings for accurate lipsync". All Task 6–14 items are complete.
