# Testing Plan — rohySimulator

Author: 2026-05-06 (after the discussant-voice 8-hour bug hunt). Owner: TBD.

## Why this plan exists

Tonight a real bug — `ChatInterface.jsx:227` leaking the patient case's voice config into the shared `VoiceContext`, contaminating the discussant's pitch resolution — went undetected for ~8 hours of debugging because the platform has **no React component tests, no E2E tests, no CI, and no client-side unit tests** outside one file (`src/utils/sentenceSplit.test.js`). The 18 `scripts/audit-*.sh` shell scripts test the HTTP boundary thoroughly but cannot see client-side state propagation, audio playback parameters, or React context contamination.

The plan below is structured so each phase delivers value independently. **Phase 0 + Phase 1 alone would have caught tonight's bug.**

---

## Phase 0 — Foundation (1 day)

Before any test is written, the runner must exist.

| Task | File | Note |
|---|---|---|
| Add Vitest + React Testing Library + jsdom | `package.json` (devDeps) | Vitest > Jest because Vite is already the bundler — zero config drift. |
| Add `npm test`, `npm run test:watch`, `npm run test:ci` scripts | `package.json` | `test:ci` runs once, no watch, prints to JUnit. |
| Add `vitest.config.ts` with jsdom env + alias parity with `vite.config.js` | repo root | Mirror Vite's `resolve.alias` so imports work. |
| Add `tests/setup.ts` — global RTL setup, mocked `localStorage`, mocked `fetch`, fake timers helper | `tests/setup.ts` | Reuse across all suites. |
| Add `tests/utils/` for helpers: `renderWithProviders`, `mockTtsServer`, `seedDb` | `tests/utils/` | Keep test code DRY. |
| Add a GitHub Actions skeleton: lint, typecheck, build, vitest, audit scripts | `.github/workflows/ci.yml` | Audit scripts run against a throwaway server on a high port (pattern from `audit-observability.sh`). |
| Document the test pyramid + how to run locally | `tests/README.md` | One page. Where each tier lives, how to add a test. |

**Acceptance**: `npm test` and `npm run test:ci` work locally. CI skeleton runs (will mostly fail until Phase 1 lands; that's fine — green-by-default isn't the goal yet).

---

## Phase 1 — Critical regression coverage (1-2 days)

Every test in this phase exists because it would have caught a bug we actually shipped. No new infrastructure, just regression locks.

### 1.1 — `voiceResolver.resolveVoice()` unit tests
**File**: `src/utils/voiceResolver.test.js`
**Coverage**: all 5 tiers + edge cases.

- Tier 1 (`case_voice` override) wins regardless of platform/voice settings.
- Tier 2 (platform persona default `default_voice_<provider>_<slot>`) when no override.
- Tier 3 (`voice_<provider>_<slot>`) when no persona default.
- Tier 4 (hardcoded `PROVIDER_FALLBACK_VOICE`) when no slot configured.
- Tier 5 (catalog-first) only with `ttsVoices` array.
- `gender='male'` + `age<13` → `child` slot.
- `gender=''` + `age=undefined` → `male` slot (default).
- `voice.tts_pitch` wins over `voiceSettings.tts_pitch` (the bug from tonight).
- `voice.tts_rate` wins over `voiceSettings.tts_rate`.
- `pickNum` returns first finite value across `voice → persona → voiceSettings`.

### 1.2 — `ChatInterface` VoiceContext non-leak (THE TONIGHT BUG)
**File**: `src/components/chat/ChatInterface.test.jsx`
**Assertion**: when ChatInterface is mounted with an `activeCase` that has `config.voice.tts_pitch`, the value pushed into `VoiceContext.voiceSettings` MUST NOT contain that case-level field.

Mount with:
```js
const activeCase = { id: 1, config: { voice: { tts_pitch: 1.05, tts_rate: 1.15, case_voice: 'en-US-Neural2-J' } } };
const platformVoice = { tts_pitch: 1.0, tts_rate: 1.0, voice_google_male: 'en-US-Chirp3-HD-Charon' };
```
Mock `/api/platform-settings/voice` → return `platformVoice`. Render. Read `VoiceContext.voiceSettings`. Assert `tts_pitch === 1.0` (platform), not `1.05` (case).

This locks the architectural fix Codex shipped tonight.

### 1.3 — Pitch coupling regression
**File**: `src/services/voiceService.test.js`
**Assertion**: `playbackRate` on every scheduled `AudioBufferSourceNode` is exactly `1.0`.

- Mock `AudioContext.createBufferSource()` to return a stub with a settable `playbackRate.value`.
- Call `VoiceService.beginSpeechSession({ pitch: 5 })` (5 semitones, anything).
- Stub a fetch response with a valid PCM stream.
- After playback scheduling, assert `stub.playbackRate.value === 1.0`.

Locks the second part of Codex's fix.

### 1.4 — TTS request body shape
**File**: `src/services/voiceService.test.js`
**Assertion**: when `beginSpeechSession({ voice, rate, pitch, gender, provider })` enqueues a sentence, the `fetch` body sent to `/api/tts?stream=1` contains exactly those fields and nothing else.

- Mock fetch.
- Call `enqueue('hi')`.
- Assert request body JSON parses to `{ text: 'hi', voice, rate, pitch, gender, provider }`.

This locks the wire-payload contract that took us hours to verify by hand tonight.

### 1.5 — Audition replay routes through `ttsFetch`
**File**: `src/services/voiceService.test.js`
**Assertion**: `auditionWirePayload(wire)` calls the same `/api/tts` path as runtime speech AND registers its `BufferSource` via `attachSource` so `cancelSpeech()` stops it.

This is the bug Codex caught earlier today (rogue Charon audio playing in the background).

### 1.6 — Server `/api/tts` semitone pitch handling
**File**: `tests/server/tts-route.test.js` OR an audit script.
**Assertion**:

- Body `{ pitch: 5 }` reaches Google with `audioConfig.pitch === 5`.
- Body `{ pitch: 50 }` is clamped to 10 (or whatever clamp Codex added).
- Body without `pitch` does NOT include `audioConfig.pitch` (omitted, not set to 0).

Pattern: stub `fetch` to Google's `texttospeech.googleapis.com`, capture the request body, assert.

### 1.7 — case_agents config merge
**File**: `tests/server/case-agents-merge.test.js`
**Assertion**: `GET /api/cases/:id/agents` returns config equal to `{...template_config, ...config_override}` for non-empty override; equal to `template_config` for empty override.

Pattern: seed a throwaway DB with template + case_agent rows, hit the endpoint, assert.

**Phase 1 acceptance**: all 7 suites green. CI runs them. The discussant-voice bug class is now locked down.

---

## Phase 2 — Server unit tests (3-4 days)

| Module | Test file | What to lock down |
|---|---|---|
| `server/services/googleTts.js` | `googleTts.test.js` | Voice validation against `VALID_VOICES`, languageCode parsing, WAV header stripping, error code mapping. |
| `server/services/openaiTts.js` | `openaiTts.test.js` | Voice validation, speed clamping, streaming PCM frame format. |
| `server/services/kokoroTts.js` | `kokoroTts.test.js` | Voice loading, sample rate handling, frame size. |
| `server/services/piperTts.js` | `piperTts.test.js` | Subprocess spawn (mocked), voice file resolution, missing-voice error. |
| `server/services/voiceFallbacks.js` | `voiceFallbacks.test.js` | Fallback table for every (provider, gender) combo; gender normalisation. |
| `server/redaction.js` | `redaction.test.js` | Each policy: secrets, PII, internal. JSON column redaction. Audit payload recursive redaction. |
| `server/observability.js` | `observability.test.js` | Request id validation/generation, SQL sanitization, slow-query threshold logic. |
| `server/middleware/auth.js` | `auth.test.js` | Role hierarchy comparison, `requireRole` rejection codes, `tenant_id` propagation. |
| `server/migrationRunner.js` | `migrationRunner.test.js` | Pending detection, checksum mismatch error, dry-run behaviour, baseline stamping. |
| `server/dbAdapter.js` | `dbAdapter.test.js` | Promise wrappers, transaction rollback, SQL fragment helpers. |

**Acceptance**: ~80 % branch coverage on each file. Tests run < 10s total.

---

## Phase 3 — Client unit tests (2-3 days)

| Module | Test file | What to lock down |
|---|---|---|
| `src/utils/voiceResolver.js` | covered in Phase 1 | (already in 1.1) |
| `src/utils/parseConfig.js` | `parseConfig.test.js` | Object passthrough, JSON string parse, malformed JSON returns `{}`. |
| `src/utils/voiceFallbacks.js` | `voiceFallbacks.test.js` | Mirror of server-side fallbacks (catch drift). |
| `src/utils/personaBlocks.js` | `personaBlocks.test.js` | Dos/Don'ts formatting, missing-config tolerance. |
| `src/services/AgentService.js` | `AgentService.test.js` | All endpoints with mocked fetch, error paths, auth header. |
| `src/services/AuthService.js` | `AuthService.test.js` | Token storage, expiry detection, header building. |
| `src/services/llmService.js` | `llmService.test.js` | Streaming consumption, abort handling, provider routing. |
| `src/services/discussionService.js` | `discussionService.test.js` | `fetchDiscussantForCase` fallback chain, `normalizeAgent` shape, `buildCaseContext` filtering. |
| `src/contexts/VoiceContext.jsx` | `VoiceContext.test.jsx` | Provider mounts, default values, useVoice hook outside provider throws. |
| `src/services/eventLogger.js` | `eventLogger.test.js` | Status transitions, component lifecycle events, status snapshot. |

**Acceptance**: each export has at least one test. No untested public function.

---

## Phase 4 — Component / hook tests (4-5 days)

| Component / hook | What to test |
|---|---|
| `DiagnosticBar` | Bar renders only when enabled. Wire history populates from `getRecentTtsRequests()`. Re-play button calls `auditionWirePayload`. A/B button uses the platform slot voice. Bar updates on `'rohy:tts-request'` events. |
| `ChatInterface` | Voice mode toggle. Agent tab switching. Patient TTS uses `activeCase.config.voice` directly (not via context). VoiceContext leak test (covered in Phase 1.2). |
| `useDiscussionEngine` | Voice resolution at start. Sentence streaming → enqueue. Cancel on unmount. `silentUser` mode. |
| `DiscussionScreen` | Discussant fetch. Start gate. PatientAvatar rendering. |
| `AgentPersonaEditor` | All form fields wired. Reset to defaults. Voice preview. LLM test. Avatar preview re-renders on field change. |
| `ConfigPanel` / `CaseWizard` | Tab navigation. Save flow. Persona editor handoff. |
| `CaseAvatarVoicePicker` | Provider dropdown. Voice list filtering. Test voice button. Pitch slider unit conversion (semitones now, after Codex's fix). |
| `TestVoiceButton` | Loading / playing / idle states. Stop on prop change. Pitch passed in body, not `audio.playbackRate` (post-fix). |
| `PatientMonitor` | Vitals rendering. Snapshot binding (no live admin edit bleed). Override guard. Auto-stop. |
| `AlarmCenter` / `NotificationProvider` | Ack idempotency client-side. Cross-case ack clearing on session change. |
| `OrdersDrawer` | Idempotency on /order-labs. Confirmation on bulk delete. |

**Acceptance**: every component listed has a smoke test (renders without error) + at least one behaviour test.

---

## Phase 5 — End-to-end Playwright suite (1 week)

Test suite lives in `tests/e2e/`. Each spec drives a fresh throwaway server on a non-`:3000` port + a fresh DB seeded with a known fixture.

| Spec | Flow |
|---|---|
| `auth.spec.ts` | First-user-becomes-admin. Admin/student login. Force-logout. Token expiry redirect. |
| `case-lifecycle.spec.ts` | Login → load case 1 → start session → patient speaks (assert wire payload via Playwright fetch override) → vitals tick → labs ordered → exam findings → end session → debrief discussant speaks → notes saved → close. |
| `voice-runtime.spec.ts` | Patient TTS → wire payload contains `voice=Neural2-J, pitch=0`. Discussant TTS → wire `voice=Neural2-D, pitch=0`. Decode response PCM, hash-compare against direct Google call (locks audio fidelity). |
| `voice-config-leak.spec.ts` | Set patient case voice config with non-zero pitch. Trigger discussant. Assert discussant request body has `pitch=0` (no leak). |
| `scenario-engine.spec.ts` | Run scenario timeline. Assert auto-stop after last frame. Manual override guard. |
| `alarms.spec.ts` | Ack from banner. Snooze. Cross-case ack clearing. Aria-live banner role. |
| `multi-tab.spec.ts` | Open same session in two tabs. Assert overlay banner appears. |
| `admin-flows.spec.ts` | Create case. Edit agent template. Reset to default. Duplicate. Delete. Audit log entries created. |
| `rbac.spec.ts` | Student denied admin endpoints. Reviewer read-only. Educator non-admin authoring. Self-escalation rejected. |
| `tenant.spec.ts` | Two-tenant isolation. Mass-assignment resistance. |
| `retention.spec.ts` | Purge endpoint dry-run vs apply. Soft-delete reads filter. |

**Acceptance**: `npm run test:e2e` runs all specs. CI runs them on every PR. Each spec < 30s.

---

## Phase 6 — Audio fidelity & external API regression (2 days)

| Test | What it catches |
|---|---|
| Google TTS reference hashing | One known-good WAV fixture per `(voice, text)` pair. Test hits live Google API with a known API key (CI secret) and asserts the response audio matches the fixture (within tolerance). Catches: Google deprecating a voice, silent voice substitution, model regressions. |
| Semitone pitch independence | Synthesize the same text at `pitch=0`, `pitch=5`, `pitch=-5`. Assert speed (audio duration) is constant; assert pitch (FFT peak) shifts by ~1.06× per semitone. Catches: pitch coupling sneaking back in. |
| Provider parity | Call `/api/tts` with all four providers + the same text. Assert all four return audio with reasonable duration / sample rate. Already in `audit-voices.sh` 10/10 — promote to Vitest if needed. |
| OpenAI / Kokoro / Piper smoke | Daily cron: hit each provider's voices endpoint, assert at least one voice is returned. |

**Acceptance**: external-API tests run nightly (not on every PR — too slow + costs Google credits). Failure pages an oncall.

---

## Phase 7 — Performance & load (1 week, optional)

Only if the platform sees real concurrent load. Skip until needed.

- TTS streaming first-byte latency benchmark (`bench/tts-latency.bench.js`).
- LLM token-streaming throughput.
- Concurrent session ceiling (how many simultaneous learners can the server handle?).
- DB query slow-query budget (already instrumented via E9 observability — add an alert).

---

## Phase 8 — Documentation & onboarding (ongoing)

- Every new test must have a 1-line comment explaining the bug it locks down OR the contract it asserts.
- `CLAUDE.md` gets a "Testing" section documenting the pyramid + how to add tests.
- New PRs without tests for changed behaviour get blocked by CI's coverage diff check.

---

## Estimated total effort

| Phase | Days | Cumulative |
|---|---|---|
| 0 — Foundation | 1 | 1 |
| 1 — Regression coverage | 1.5 | 2.5 |
| 2 — Server units | 3.5 | 6 |
| 3 — Client units | 2.5 | 8.5 |
| 4 — Component tests | 4.5 | 13 |
| 5 — Playwright E2E | 5 | 18 |
| 6 — Audio fidelity | 2 | 20 |
| 7 — Performance | 5 (optional) | 25 |

**Minimum viable** to prevent another night like tonight: **Phase 0 + Phase 1 = ~2.5 days.** That alone delivers regression locks for every bug we found over the past 24 hours.

**Realistic ship target**: Phase 0 → 5 in three weeks of one engineer's focused work.

---

## Where to start the next session

1. Read this file.
2. Review tonight's uncommitted diff (still on `main`):
   - `src/services/voiceService.js` (Codex pitch + audition fix)
   - `src/components/debug/DiagnosticBar.jsx` (wire history + replay)
   - `src/components/chat/ChatInterface.jsx` (VoiceContext leak fix)
   - `server/services/googleTts.js`, `server/routes.js` (semitone pitch)
   - `migrations/0006_tts_pitch_semitones.sql` (multiplier → semitones)
3. Decide commit/squash strategy for tonight's work.
4. Execute Phase 0. Ship in one PR.
5. Execute Phase 1 (especially 1.1, 1.2, 1.3) before merging tonight's diff. The tests should fail against the un-fixed code (proving they're real) and pass against the fixed code (proving they protect it).
6. Land the foundation + Phase 1 PR. Tonight's voice fix becomes the commit that all 7 regression tests are written against.
7. From there, work through Phase 2-5 in priority order. Phase 6 can run in parallel.

---

## Non-negotiables for tonight's work

Before committing any of tonight's changes, **at minimum** these tests must exist and pass:

- [ ] `voiceResolver.test.js` — at least the 5 tier tests.
- [ ] `ChatInterface.test.jsx` — the VoiceContext non-leak assertion.
- [ ] `voiceService.test.js` — `playbackRate === 1.0` always; pitch in body.
- [ ] An audit script (or new test) that hits `/api/tts` with `pitch: 5` and verifies the request body Google gets has `audioConfig.pitch === 5`.

Without these, tonight's fix is at risk the next time someone touches `ChatInterface`, `voiceService`, or `voiceResolver`. The bug took ~8 hours to find. The tests take ~3 hours to write. Trade.
