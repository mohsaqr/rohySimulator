# Session Handoff — 2026-05-02

Branch `feat/voice-avatars`, **nothing committed this session**. Latest commit on branch: `b546e11 feat(voice): Kokoro TTS provider, LLM streaming, avatar in patient visual`.

The branch now carries **four contiguous in-progress workstreams**:

- **A.** Patient/agent visual identity rewrite (morning — 2026-05-02 AM).
- **B.** Avatar library expansion + simplify cleanup (afternoon — 2026-05-02 mid-day).
- **C.** Central NotificationCenter + producer migrations (this session — 2026-05-02 PM, the bulk of new code).
- **D.** Google TTS quality upgrade + standalone Talking-Avatars Kit (this session, late).

They land together as one large piece of work — 24 modified files, ~120 new files, ~3,500 LOC net change. Splitting into multiple PRs is possible but not required.

---

## Completed

### A. Patient/agent visual identity rewrite (AM)

- Photos removed end-to-end (`cases.image_url` ALTER, `/api/upload` deleted, all `<img src=image_url>` gone).
- `src/utils/resolveAvatar.js` is the single source of truth for "which GLB?" — explicit `avatarId` → platform default by gender → demographic hash → `manifest.fallback[0]`.
- `src/components/settings/AvatarsSettingsTab.jsx` and `AgentTemplateManager.jsx` have unified Avatar & Voice blocks (gender, avatar dropdown, framing sliders, TTS engine, voice id, speech rate).
- `activeParticipant` slot in VoiceContext lets PatientVisual mirror whoever the trainee is currently talking to.
- `src/utils/stageDirections.js` strips `*nods*`-style stage directions from display *and* TTS.
- `agent_templates` table dedup'd 90 → 3 rows; UNIQUE INDEX added.

### B. Avatar library expansion + cleanup (mid-day)

- 22 viseme-rigged RocketBox GLBs now in `public/avatars/heads/rb_*.glb` (10 morning + 12 afternoon, all carrying the canonical 17 morph targets in Oculus order).
- Reproducible RocketBox pipeline at `scripts/rocketbox-convert/` (replaces `/tmp` one-shot). Idempotent + additive; `--force` overrides; `--only=` runs subset.
- `src/utils/visemes.js` extracted as the single source of truth for `VISEME_KEYS` (15 entries). Both `PatientAvatar.jsx` and `convert.mjs` import from it.
- `manifest.json` extended to 28 entries.
- `/simplify` cleanup: viseme dedup, per-material `Promise.all` texture fetches, `MIME_PNG` constant.

### C. Central NotificationCenter (this session — main body of work)

Replaced four parallel notification systems (`ToastContext`, `useAlarms` self-contained alarm hook, `EventLogger` singleton with own batching, native `alert()`) with **one** central `NotificationCenter` that every producer reports to.

**Core (new)** — `src/notifications/`:

- `types.js` — `SOURCES` (clinical/system/user/telemetry), `SEVERITIES` (debug→critical), `SURFACES` (toast/banner/audio/history/backend/console), `AUDIO_PATTERNS` (urgent/beep/chime/none).
- `defaults.js` — `DEFAULT_ROUTING` matrix (severity × source → surfaces[]), `DEFAULT_PREFS` (DND, mutes, severity threshold, audio frequencies, dedup window, max visible toasts), `DEFAULT_TTL_MS`, `DEFAULT_AUDIO_PATTERN`.
- `routing.js` — `routeNotification(notification, prefs, transient)` applies the mute hierarchy: `acked` → `snoozed` → `DND/paused` (clinical critical bypasses) → `minSeverity` → `mutedSources` → per-surface mutes.
- `persistence.js` — localStorage (sync) + `/api/notification-prefs` (async) for `prefs`, `snoozed`, `acked`.
- `NotificationContextObject.js` — bare `createContext(null)` so the provider file is component-only (HMR-friendly).
- `NotificationContext.jsx` — `<NotificationProvider>` with `notify`, `resolve`, `ack`, `ackAll`, `snooze`, `snoozeAll`, `dismiss`, `pause`, `resume`, `subscribe`, plus state: `active`, `history`, `snoozed`, `acked`, `prefs`.
- `useNotifications.js` — the hook (split for HMR rule).
- `externalApi.js` — module-level `setExternalApi`/`getExternalApi` so non-React producers (EventLogger singleton) can dispatch.
- `index.js` — barrel.

**Surfaces (new)** — `src/notifications/surfaces/`:

- `ToastSurface.jsx` — bottom-right cards. Hover/focus → `pause(id)`; mouse-leave/blur → `resume(id)` (fresh full TTL). Click-anywhere-to-dismiss.
- `BannerSurface.jsx` — top sticky banner for clinical critical/error/warning. Acknowledge + Snooze buttons.
- `AudioSurface.jsx` — single oscillator manager owned by the surface (NOT useAlarms). Listens for click/keydown/touchstart/visibilitychange to resume the AudioContext globally — fixes the legacy "alarms silent unless you click PatientMonitor first" bug. Picks loudest pattern (URGENT > BEEP > CHIME) when multiple alarms active.
- `BackendSurface.js` — bounded queue (500 cap) batches POSTs to `/api/alarms/log` (clinical) or `/api/learning-events/batch` (telemetry). `sendBeacon` on hide/unload for telemetry.
- `ConsoleSurface.js` — colour-tagged console output gated by `prefs.consoleMuted`.
- `HistorySurface.jsx` — embeddable component listing the rolling history (200-cap).
- `index.js` — barrel.

**Producers refactored**:

- `src/contexts/ToastContext.jsx` — rewritten as backwards-compat shim. 243 existing `toast.success/error/warning/info/confirm` call sites work unchanged. `useToast` lives in `src/contexts/useToast.js`; context object in `src/contexts/ToastContextObject.js` (HMR rule). `ConfirmModal` now closes on ESC.
- `src/hooks/useAlarms.js` — gutted from a 419-line self-contained hook to a ~210-line thin producer. Reads vitals, calls `notify({source: 'clinical', severity, key: 'alarm:hr_high', requiresAck: true, ttlMs: 0, data: {...}})` on threshold breaches, `resolve(key)` when vital normalises. Severity picked per breach (critical for severe out-of-range, warning for edge). Audio context, oscillator, mute persistence, ack/snooze tracking — ALL gone (center owns them now). Exposes the same shape PatientMonitor expected (`activeAlarms`, `snoozedAlarms`, `isMuted`, `setIsMuted`, `acknowledgeAlarm`, etc) so the alarm tab UI renders unchanged.
- `src/services/eventLogger.js` — same 130+ xAPI verbs and convenience methods preserved. `log()` now routes to `notify({source: 'telemetry', ...})` via `getExternalApi()`. Pre-mount events go into a 1000-cap buffer that replays on first center-bound `log()` call after mount. Removed: own batch queue, periodic flush, visibility/unload listeners, console-color block (BackendSurface and ConsoleSurface own those now).
- `src/components/examination/BodyMapDebug.jsx` — two `alert()` calls replaced with `toast.success()`.

**Wiring** — `src/App.jsx`:

- Mounted `<NotificationProvider>` wrapping `<ToastProvider>` (the shim depends on it).
- `<NotificationApiBridge />` — calls `setExternalApi(api)` on mount so EventLogger can dispatch.
- Surfaces mounted at root: `<ToastSurface />`, `<BannerSurface />`, `<AudioSurface />`, `<ConsoleSurface />`, `<BackendSurfaceBridge />` (which reads sessionId/userId/caseId from EventLogger.getStatus + useAuth and passes them to `<BackendSurface>`).

**UI** — `src/components/settings/NotificationsSettingsTab.jsx`:

- New settings tab. Sections: DND, Pause for X min, Min severity, Source mutes, Surface mutes (Audio/Banner/Console), Audio tuning (volume + per-pattern frequency sliders), Snooze duration, Live state (acked/snoozed/history counts + Clear all ACKs), Reset, Recent activity history.
- Wired into `ConfigPanel.jsx` sidebar — visible to **every user**, not just admins (a clinician needs to be able to mute their own alarms).
- `nowTick` state ticks every 30s so the "Paused (Nm left)" countdown updates without breaking React's purity rule.

**PatientMonitor changes** — `src/components/monitor/PatientMonitor.jsx`:

- Removed the `audioContextRef` and the click-handler audio init (AudioSurface owns this now globally).
- `useAlarms` call signature: `useAlarms(displayVitals, sessionId)` (was `useAlarms(displayVitals, sessionId, audioContextRef.current)`).
- Alarm tab UI unchanged — the legacy `alarmSystem.{activeAlarms, snoozedAlarms, isMuted, ...}` shape is preserved by the refactored hook.

**Server**:

- `server/routes.js` — added `GET/PUT /api/notification-prefs`. Stored as JSON in the existing `user_preferences.notification_settings` column (no schema migration needed — `user_preferences` already existed at `db.js:1267-1280`). Upsert via `ON CONFLICT(user_id) DO UPDATE`.
- `server/routes.js` — **restored `POST /api/upload`** (with `authenticateToken` middleware this time). Codex review flagged it as a regression from the morning's photo removal: `PhysicalExamEditor.jsx:69,147` and `RadiologyEditor.jsx:167` still POST to `/api/upload` for auscultation audio and study images. Field name is `photo` (kept for compat).

### D. Google TTS upgrade + Talking-Avatars Kit (this session, late)

**Google TTS quality fixes** — `server/services/googleTts.js` + `server/routes.js`:

- Added 8 **Chirp 3 HD** voices (Aoede, Kore, Leda, Zephyr, Charon, Puck, Orus, Fenrir). Same pricing tier as Neural2 ($16/1M chars after 1M free) but dramatically more natural prosody. Reordered the catalog so Chirp 3 HD sorts first, then Chirp HD, then Neural2 (kept for backwards compat).
- `effectsProfileId: ['headphone-class-device']` added to every synthesis request — free per-request EQ profile, noticeably improves perceived quality on headphones.
- Speed clamp widened from 0.5–1.5 to 0.7–1.3 (`routes.js:6989`).
- Did NOT add Studio voices (~10× more expensive — separate "Studio" tier — and Chirp 3 HD is roughly comparable for free).

**Talking-Avatars Kit** — `kits/talking-avatars/`:

Self-contained, drop-in-portable bundle of the entire talking-head + lipsync + TTS pipeline. Built on user request as a "lift this into another project" deliverable.

- `README.md` — 933-line reference doc (17 sections): architecture, asset model, the 15 Oculus visemes, the conversion pipeline, runtime morph driver internals (refs vs props, critically-damped interpolation, scene cloning), wawa-lipsync's FFT approach, Kokoro vs Google comparison, the custom `application/x-rohy-pcm-stream` wire format, single-shared-AudioContext rationale, camera framing, blink animation, avatar selection priority chain, browser STT, setup checklist, troubleshooting, licensing, why-not-RPM/Polly/ElevenLabs.
- `INSTALL.md` — 7-step drop-in walkthrough for a fresh project.
- `package.json` — peerDependencies + exports map (kit is BYO-package — meant to be lifted, not installed).
- `glbs/` — all 28 GLBs + manifest.json (~226 MB).
- `client/` — `PatientAvatar.jsx`, `voiceService.js`, `VoiceContext.jsx`, `visemes.js`, `resolveAvatar.js`, `avatarFraming.js` plus **NEW** `config.js` (apiUrl/baseUrl env-configurable stubs) + `authService.js` (token-getter stub). All imports rewritten to use sibling-relative paths so the kit is self-contained.
- `server/` — `kokoroTts.js`, `googleTts.js`, `wav.js` plus **NEW** `ttsRoute.js` (drop-in Express router that wires both providers, the streaming format, and the voices catalog endpoint).
- `examples/standalone.html` — 422-line single-file vanilla-JS demo that re-implements the kit's pipeline without React. Importmap pulls three.js + wawa-lipsync from esm.sh. Same morph driver, same wire-format parser, same critically-damped interpolation. Sanity-check before integration.
- `examples/README.md` — how to run the demo.
- `pipeline/` — copies of `convert.mjs`, `avatars.json`, `package.json`, `README.md`, `.gitignore`.
- **Tarball** at `kits/talking-avatars.tar.gz` (180 MB) — single-file transport, excludes `node_modules` and `work/`.

**Toast hover-pause** — final polish this session:

User reported "the notification is so fast I can't get to acknowledge it." Two fixes in `src/notifications/`:

- Bumped `DEFAULT_TTL_MS` (`defaults.js`): debug 2→3s, success 3→5s, info 4→6s, warning 6→10s, error 8→15s, critical stays sticky.
- Added `pause(id)` and `resume(id)` to `NotificationContext.jsx`. `ToastSurface.jsx` wires `onMouseEnter`/`onFocus` → pause, `onMouseLeave`/`onBlur` → resume (with fresh full TTL — over-generous on purpose). Subtle white ring on paused toasts. Click-anywhere-to-dismiss (whole card is now a target, not just the X). `tabIndex={0}` + `aria-live="polite"` for keyboard / screen-reader users. Expiry `useEffect` skips notifications where `n.paused === true`.

### Codex review status

A working-tree review ran through `/codex:review` and surfaced 3 issues:

1. **[P1]** `/api/upload` removed but still used by PhysicalExamEditor + RadiologyEditor — **fixed** (restored with auth, see C above).
2. **[P1]** `routing.js:19-27` — clinical critical bypassed acked/snoozed checks, making Acknowledge/Snooze buttons useless on those banners — **fixed**. Now: `acked`/`snoozed` are explicit user actions on a specific key and *always* honoured (even for critical). Only blanket rules (DND/severity/source-mute) let critical clinical escape.
3. **[P3]** `useAlarms.js:162-169` — `snoozedAlarms.remaining` was reading a non-existent `s.remainingMin` from the center, rendering "Returns in undefined min" — **fixed**. `useAlarms` now keeps a `nowTick` state (30s interval) and computes `remaining = Math.max(0, Math.ceil((s.until - nowTick) / 60000))`.

User declined to run a deeper full-codebase Codex audit when offered. The Google TTS upgrades and toast hover-pause changes have NOT yet been Codex-reviewed.

---

## Current State

- **API server**: started this session, listening on `:3000` (PID 26436, log at `/tmp/rohy-server.log`). `node --watch server/server.js` so it auto-reloads on file changes. Migrations all clean — `cases.image_url` dropped, `idx_agent_templates_type_name` created, default agent personas seeded, lab/cardiac/radiology fixtures loaded.
- **Vite client**: started this session, ready in 2.5s on `:5173` (background task `bflpqt7en`, log at `/tmp/rohy-client.log`). HTTP 200, no compile errors. HMR active.
- **Build**: `npx vite build --logLevel=error` passes clean (warnings: pre-existing chunk-size only).
- **Lint**: clean on every file touched this session. AuthContext / VoiceContext have a pre-existing `react-refresh/only-export-components` warning that's intentionally left alone (matches established repo pattern; my new contexts follow the split-into-component-and-hook pattern to avoid the warning).
- **`/api/notification-prefs`**: live and authenticated. Confirmed via `curl` — 401 without token, 200 with valid one.
- **`/api/upload`**: live and authenticated. Confirmed — 401 no auth, 403 bad token.
- **Google TTS Chirp 3 HD voices**: live; `GET /api/tts/voices?provider=google` returns the new catalog. Behaviour change: every Google synthesis request now sets `effectsProfileId: ['headphone-class-device']`.

### Files modified (24)

```
M HANDOFF.md
M package.json
M public/avatars/heads/manifest.json
M server/db.js
M server/routes.js                        (notification-prefs, /upload restored, google speed clamp)
M server/server.js
M server/services/kokoroTts.js
M src/App.jsx                             (NotificationProvider + 5 surfaces + bridges)
M src/components/chat/ChatInterface.jsx
M src/components/chat/PatientAvatar.jsx
M src/components/examination/BodyMapDebug.jsx  (alert() → toast.success())
M src/components/monitor/PatientMonitor.jsx     (audioContextRef + click handler removed; useAlarms signature)
M src/components/orders/OrdersDrawer.jsx
M src/components/patient/PatientVisual.jsx
M src/components/settings/AgentTemplateManager.jsx
M src/components/settings/ConfigPanel.jsx       (Notifications sidebar tab)
M src/components/settings/VoiceSettingsTab.jsx
M src/contexts/ToastContext.jsx                 (rewritten as shim over notify())
M src/contexts/VoiceContext.jsx
M src/hooks/useAlarms.js                        (gutted to thin producer, oscillator removed)
M src/services/authService.js
M src/services/eventLogger.js                   (routes through center, preserves API)
M src/services/llmService.js
M src/services/voiceService.js
```

### Files added — counts (full list via `git status --short`)

- 22 RocketBox GLBs in `public/avatars/heads/rb_*.glb` (untracked from earlier sessions, still uncommitted).
- 19 NEW notification-system files in `src/notifications/`, `src/contexts/`, `src/components/settings/NotificationsSettingsTab.jsx`.
- 5 NEW utilities: `src/utils/{avatarFraming,parseConfig,resolveAvatar,stageDirections,visemes}.js`.
- 4 NEW server services: `server/services/{googleTts,openaiTts,voiceFallbacks,wav}.js`.
- 4 NEW settings components: `src/components/settings/{AvatarFraming,AvatarsSettingsTab,CaseAvatarVoicePicker}.jsx`.
- `scripts/rocketbox-convert/` directory.
- `kits/talking-avatars/` directory (~73 files including 28 GLBs) plus `kits/talking-avatars.tar.gz` (180 MB).
- `server/database.sqlite.backup-20260502-102313` — keep a few days then delete.

`git status --short` reports **140 lines** of changes (modified + untracked).

---

## Key Decisions

- **Two fixed platform defaults beat demographic hash** for `avatar_id` fallback. Predictability over variety. Hash remains as step 3 of resolver.
- **Avatar always renders, voice mode or not.** Photos are gone — no static-image idle path.
- **Per-agent voice override layered on top of global.** Same shape as per-case (`config.voice = { tts_provider, case_voice, tts_rate }`).
- **Agent gender stored explicitly in `config.gender`.** Falling back to a name regex was fragile.
- **RocketBox is the canonical avatar source.** Ready Player Me unavailable (memory note).
- **Pipeline lives in the repo** (`scripts/rocketbox-convert/`), not `/tmp`. Reproducible from a fresh clone.
- **NotificationCenter design — separate event from surface.** A producer says "I want to fire this notification with this severity from this source"; the center decides which surfaces render it based on user prefs. This is what makes mute/DND/severity-threshold work consistently across toast, banner, audio, history, backend, console.
- **Backwards compat via `useToast` shim.** 243 call sites stayed unchanged. The engine swapped silently. Made the migration a "swap the engine" project, not a "rewrite the car" project.
- **Acked/snoozed wins over critical clinical.** When a clinician explicitly clicks Acknowledge or Snooze on a critical alarm, suppress it. Codex caught this (originally bypassed). DND/severity/source-mute (blanket rules) still let critical clinical escape — those aren't user actions on the specific alarm.
- **Hover-pause restarts with fresh full TTL on resume**, not remaining time. Sonner-style precise resume feels worse for clinical UX where users glance away. Generous resume = a forgiving system.
- **Toast click-anywhere-to-dismiss.** Bigger hit target. X button stays for users who learned that pattern.
- **AudioSurface listens globally** (click/keydown/touchstart/visibilitychange) for the resume gesture. Legacy `useAlarms` listened only on `document.click` inside PatientMonitor — broke when users navigated without clicking. Now any gesture anywhere unlocks audio.
- **`/api/upload` restored with auth** rather than updating the editors to use a different endpoint. The endpoint is the right shape for a generic media upload; the morning's deletion was over-eager.
- **Chirp 3 HD voices for Google.** Same price tier as Neural2, dramatically better quality. Studio voices skipped (10× pricier; Chirp 3 HD is comparable).
- **Talking-Avatars Kit gets duplicate GLBs.** 226 MB of avatars copied into `kits/talking-avatars/glbs/` rather than symlinked. Symlinks are fragile across zip/copy/network filesystems. Duplication is the right tradeoff for a portable bundle.
- **Standalone HTML demo uses vanilla JS via importmap.** No React, no bundler. Demonstrates the mechanics without the production wiring; serves as a sanity-check before integrating the React kit. Accepts the small `VISEME_KEYS` duplication as documented non-canonical.

---

## Open Issues

- **No browser smoke test of the full notification pipeline.** Toast dedup, banner ack/snooze, audio mute behaviour, DND, persistence across reload, snooze countdown — none of these have been clicked through manually since the build went green. The risk surface here is large; this is the highest-priority pre-commit verification.
- **`rb_business_female_02.glb` glasses lens** — renders the FBX2glTF placeholder white PNG because `f015_glasses_color.tga` doesn't exist in the source. Probably invisible (transparent lens) but worth eyeballing.
- **`rb_male_adult_15.glb` in two buckets** of `manifest.json` (`male.middle` and `male.elderly`) — pre-existing from morning, cosmetic.
- **3 seeded default agents have no `config.gender`** until an admin opens the persona editor.
- **Other machines with the pre-fix DB state** will accumulate the same 90-row `agent_templates` duplication. The `UNIQUE INDEX` creation in `db.js` will fail silently on first boot if duplicates still exist. They need to dedup first.
- **No follow-up Codex audit run** on the notification system, Google TTS upgrades, kit, or hover-pause changes. The first Codex review caught 3 P1/P3 issues — there may be more in code that hasn't been re-reviewed yet.
- **Talking-Avatars Kit GLBs duplicate the canonical copies** in `public/avatars/heads/`. Adds ~226 MB to the working tree. If we commit, we should probably gitignore `kits/talking-avatars/glbs/*.glb` and `kits/talking-avatars.tar.gz`, OR move the canonical copies under `kits/` and have the runtime fetch from `/avatars/heads/` via a server route that reads from the kit folder.
- **EventLogger ACTION → notification severity 'info' mapping** — the legacy xAPI severity ladder was DEBUG/INFO/ACTION/IMPORTANT/CRITICAL; ACTION is now mapped to 'info' in the SEV_MAP. Worth verifying nothing relies on ACTION being distinct from INFO in stored events.
- **`/api/notification-prefs` PUT has no body validation.** A malicious user could PUT a 50 MB JSON blob into `user_preferences.notification_settings`. Should enforce a size cap (~10 KB) and validate keys against `DEFAULT_PREFS`.
- **NotificationsSettingsTab is in ConfigPanel sidebar for all users.** The other admin tabs (users, platform, logs, etc) are gated by `isAdmin()`. Notifications is intentionally NOT (every user needs to control their own DND), but the gating boundary in ConfigPanel could become inconsistent — keep an eye on it.
- **No audit on whether `pause(id)` / `resume(id)` race conditions exist** when a toast dedups during hover. Theoretical: hover at t=0 → pause → key re-fires at t=2s (dedup window) → `setActive` updates `lastSeenAt` to now, but the existing `paused: true` is preserved (spread copies it). Should be fine but unverified.

---

## Next Steps

1. **Browser smoke test before commit.** End-to-end:
   - Trigger a toast (any error path) → confirm dedup if repeated
   - Hover the toast → white ring appears, timer pauses → mouse off → fresh full TTL
   - Click anywhere on a toast → dismisses
   - Settings → Notifications → toggle DND → all subsequent non-critical notifications silenced
   - Settings → Notifications → Pause for 5m → resumes after 5 min OR after clicking Resume
   - Load case → push HR > 120 → red banner + beep + history entry → click Acknowledge → silenced
   - Acknowledge a critical alarm → silenced even though HR still high
   - Drop HR into range, push back high → re-fires (proves `resolve()` cleared the ack)
   - Toggle Audio off → banner + history continue, beep stops
   - Refresh page → DND, mute, snooze, ack states all persist
   - Settings → Voice → preview a Chirp 3 HD voice → confirm noticeably more natural than Neural2
   - Admin → Body Map → Copy → toast appears (no native alert)
2. **Commit.** Suggested split (or squash if preferred):
   - **(a)** Photo removal + avatar resolver + AvatarsSettingsTab + utils (resolveAvatar, avatarFraming, parseConfig, stageDirections, visemes).
   - **(b)** Agent editor avatar/voice + agent TTS + CaseAvatarVoicePicker.
   - **(c)** DB dedup + unique index + migration in `server/db.js`.
   - **(d)** RocketBox pipeline (`scripts/rocketbox-convert/`) + 12 new GLBs + manifest expansion.
   - **(e)** **NotificationCenter (the big one)** — `src/notifications/` + ToastContext shim + useAlarms refactor + EventLogger refactor + PatientMonitor audio init removal + NotificationsSettingsTab + App.jsx wiring + `/api/notification-prefs` route + `/api/upload` restoration.
   - **(f)** Google TTS Chirp 3 HD + effectsProfileId + speed widening.
   - **(g)** Talking-Avatars Kit (`kits/talking-avatars/` + tarball) — large; consider gitignoring the GLBs and tarball.
3. **Push to remote** when verified.
4. **Optional follow-ups**:
   - Run a deeper Codex audit on the notification system + Google upgrades + hover-pause (user declined this earlier in the session but it's still worth doing).
   - Add validation on `PUT /api/notification-prefs` body (size cap + key whitelist).
   - SSML mapping for stage directions → `<emphasis>` / `<break>` / `<prosody>` tags before sending to Google. Half-hour change. Notable perceived-quality win on emotional patients.
   - Server-side espeak phoneme timings for accurate lipsync (long-standing). wawa-lipsync FFT is good but imperceptible TH/FF/PP confusion.
   - Other machines: dedup their `agent_templates` rows before pulling this branch.
   - Delete `server/database.sqlite.backup-20260502-102313` once dedup is confirmed safe.

---

## Context

- **Branch**: `feat/voice-avatars` off `main`. Latest commit `b546e11`. ~140 lines of `git status --short` output.
- **Stack**: React 19 + Vite frontend, Express + sqlite3 backend, Three.js / @react-three/fiber / drei for 3D, wawa-lipsync (FFT-based viseme detection), Piper / Kokoro-82M / Google Cloud TTS / OpenAI for TTS, browser SpeechRecognition for STT.
- **Dev servers running**: API on `:3000` (PID 26436, foreground-from-this-session); Vite on `:5173` (background task `bflpqt7en`, log `/tmp/rohy-client.log`).
- **Plan files from earlier sessions**: `/Users/mohammedsaqr/.claude-claudef/plans/magical-spinning-sprout.md` covers AM photo removal + AvatarsSettingsTab work — does NOT cover this PM's NotificationCenter work or the kit.
- **Memory notes**:
   - Ready Player Me unavailable (`/Users/mohammedsaqr/.claude-claudef/projects/-Users-mohammedsaqr-Documents-Github-rohySimulator/memory/project_no_readyplayerme.md`). Do not suggest as avatar source.
- **NotificationCenter file map** (single source of truth for next-session navigation):
   ```
   src/notifications/
     types.js, defaults.js, routing.js, persistence.js
     NotificationContextObject.js, NotificationContext.jsx, useNotifications.js
     externalApi.js, index.js
     surfaces/{Toast,Banner,Audio,Backend,Console,History}Surface.{jsx,js} + index.js
   src/contexts/
     ToastContext.jsx (shim), useToast.js, ToastContextObject.js
   src/components/settings/NotificationsSettingsTab.jsx
   src/hooks/useAlarms.js (now a producer, not self-contained)
   src/services/eventLogger.js (routes via getExternalApi())
   ```
- **Talking-Avatars Kit reproducibility**: from a fresh clone, `cd kits/talking-avatars && cat README.md` for the full reference doc; `cat INSTALL.md` for the 7-step drop-in walkthrough; `cd pipeline && npm install && npm run convert` to rebuild any GLB; `examples/standalone.html` is a no-build sanity-check.
- **Tarball**: `kits/talking-avatars.tar.gz` — 180 MB, single-file transport for sharing the kit to another project.
