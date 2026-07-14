# Changelog

All notable changes to rohy are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: bump versions with `npm version major|minor|patch` from the
repo root (this updates `package.json` + `package-lock.json` and creates a
tag in one step). Add a new section at the top of this file for every
release before tagging.

## [2.7.4] — 2026-07-14

### Security

- **An admin could take over another admin's account.** `PUT /users/:id` and
  `DELETE /users/:id` checked the *requested* role against the caller but never
  the *target's* rank — unlike `PATCH /users/:id/status` and
  `POST /users/bulk-action`, which both refuse a target at or above the caller.
  So any admin could open a peer admin in the edit form and set a new password.
  The Users table hid the Delete button for peers but rendered **Edit**
  unconditionally, and a hidden button is not a security boundary: the API is
  reachable directly. Both routes now carry the same target-rank guard as their
  siblings (editing *yourself* is still allowed), and the client only offers Edit
  where the server would accept it.

## [2.7.2] — 2026-07-14

Ports the two fixes released as 2.5.2 on the 2.5.x line (see below); both bugs
were present here too.

### Fixed

- **A fresh install can reach an admin again.** Production refuses to seed the
  well-known `admin`/`admin123` account and `/auth/register` forced every signup
  to `student`, so a freshly pulled image had no path to an admin at all — and
  the first-run setup wizard assumes you already are one. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin with
  your own password, or leave them unset and the first account registered through
  the UI claims the instance.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access ships as opt-in (`enforce_cohort_case_access`, default OFF), but
  the case catalog, the direct case read and the session launch gate all applied
  it to every student unconditionally — the flag was read by nobody, so the admin
  toggle (and the setup wizard's step 6) was a no-op, and students on every
  install have been restricted to the default case plus course assignments since
  migration 0030. All three sites now share one `caseAccessEnforcedFor()` gate.

## [2.7.1] — 2026-07-12

### Added

- **First-run setup for administrators.** New admins land in a six-step
  setup checklist: connect the AI engine (with a live connection test —
  students can't chat until it passes, and the wizard says so), pick the
  platform's default language, confirm the default course and case, enable
  voice, enable emotion capture, and choose who sees which cases. Every step
  is optional and everything stays editable later — the checklist can be
  dismissed and reopened any time from the menu → **Platform setup**.
- **A welcome screen for students and teachers.** On first login you pick
  your language, see the case you'll start with, choose whether you want to
  talk to the patient out loud (with a microphone check), and — where the
  camera-based emotion capture is enabled — see and decide the consent that
  was previously set silently. Teachers get a pointer to case authoring.
  Choices are saved to your account, so they follow you across devices.
- **Platform default language.** Administrators can now set the language new
  users start in (previously always English). Each user's own choice still
  wins.

### Fixed

- Your "talk to the patient" preference now survives a page reload instead
  of resetting to off every time.

## [2.7.0] — 2026-07-12

### Added

- **The patient senses how you're doing.** When an administrator enables
  affect routing, the AI patient is told each turn how you currently appear
  (from the consent-gated Oyon emotion capture) and reacts in character — a
  frightened patient settles when you seem calm, and gets more distressed
  when you seem flustered. The patient never claims to see or measure your
  emotions. Off by default, admin-configurable (signal type, confidence and
  freshness thresholds), and restricted to local AI providers unless
  explicitly widened. Nothing is routed without your capture consent.

## [2.5.2] — 2026-07-14

### Fixed

- **A fresh install can reach an admin again.** In `NODE_ENV=production` the
  seeder refuses to create the well-known `admin`/`admin123` account, and
  `/auth/register` forced every signup to `student` — so a freshly pulled
  Docker image had no path to an admin at all. Settings showed only three
  tabs, the case list showed one case, and case authoring was invisible,
  which read as a broken build rather than a permissions state. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin
  with your own password (works in production, no default credential ever
  exists), or leave them unset and the first account registered through the
  UI claims the instance. Both apply only while the `users` table is empty.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access is documented and shipped as opt-in (`enforce_cohort_case_access`,
  default OFF), but the case catalog, the direct case read, and the session
  launch gate all applied it to every student unconditionally — the flag was
  read by nobody and the admin toggle was a no-op. Since 0030 that has quietly
  restricted students on every install to the default case plus whatever a
  course assigned them. All three sites now consult the flag through one shared
  `caseAccessEnforcedFor()` gate, so an install that never opts in behaves as
  documented: students see every available case.

### Added

- `ROHY_ADMIN_USERNAME` / `ROHY_ADMIN_PASSWORD` / `ROHY_ADMIN_EMAIL` — provision
  the first admin at boot. Wired through `deploy/docker/compose.yml`; the
  entrypoint now announces which bootstrap path is live. A weak password is
  refused loudly rather than seeding an account nobody can log into.
- DEPLOY.md gains a "Getting the first admin" section, including how to promote
  an existing account that got stuck as a student.

## [2.5.0] — 2026-07-04

### Added

- **The patient makes eye contact and follows you.** When Oyon capture is
  running, the patient's (and debrief discussant's) eyes and head track
  your movements via the webcam face stream, glance at the vitals monitor
  when an alarm fires, and settle back into eye contact when you're still.
  He never looks down, and only rarely (and slightly) up.
- Monitor header redesign: the Oyon capture pill gets a reserved dock in
  the center, the Rohy wordmark leads the header, and the patient's name
  now captions the avatar.
- Settings sidebar is flat (no collapsing sections) and ordered by how
  often each area is used; reference catalogues (Body Map, Lab Database,
  Medications) live under Libraries near the bottom.

## [2.3.10] — 2026-05-17

### Changed

- **Removed the Playwright E2E job from CI.** It is a pre-existing
  brittle/flaky UI harness (many specs maintainer-marked
  `SKIP … brittle`; failures span unrelated files; headless render
  timeouts; several pass only on retry). It was red on `main` before
  this branch and gave no reliable signal as a blocking gate, so it
  blocked an otherwise-green pipeline. The suite still exists and runs
  locally via `npm run test:e2e`; CI now gates on lint + build + Vitest
  + HTTP audit (all green). E2E stabilisation is tracked separately.

## [2.3.9] — 2026-05-17

Patch release. Kokoro is the default everywhere on a clean install.

### Changed

- **`audit-voices.sh` now defaults to `kokoro`**, matching the
  clean-install `tts_provider` the server already seeds
  (`server.js` → `setSettingIfEmpty('tts_provider','kokoro')`, idempotent;
  `platform_settings.setting_key` is UNIQUE so it holds). Auditing
  piper/google/openai is now explicit opt-in via
  `ROHY_AUDIT_TTS_PROVIDERS` for operators who configured them, rather
  than a CI-only env override. A base install (CI or fresh deploy)
  audits the engine it actually runs — kokoro — with no special-casing.

## [2.3.8] — 2026-05-17

Patch release. Last pre-existing CI audit failure.

### Fixed

- **`audit-voices.sh` failed in CI** because it asserted HTTP 200 from
  `/api/tts` for piper (no binary/voices) and google/openai (no API
  keys) — providers CI doesn't provision. kokoro (in-process) already
  passed. The provider list is now `ROHY_AUDIT_TTS_PROVIDERS`-overridable
  (default = full set locally); the CI audit step sets it to `kokoro`.
  Not a regression — asserting an unconfigured provider works was wrong.

## [2.3.7] — 2026-05-17

Patch release. Pre-existing CI failures (red on main before this branch).

### Fixed

- **`JWT_SECRET` killed in-process server tests.** `server/middleware/
  auth.js` `process.exit(1)`s at import if `JWT_SECRET` is unset; CI has
  no `server/.env`, so any test importing an auth-touching module
  in-process (e.g. `help-routes.test.js`) silently killed the vitest
  worker. Added `tests/server-setup.js` (server project `setupFiles`)
  that sets a test `JWT_SECRET` (and default `NODE_ENV`) before imports.
  Fixes the Vitest and Docs `help-system` jobs; also fixes local runs
  without a `server/.env`.
- **Audit job same root cause.** `scripts/audit-retention.sh` spawns
  `retention-sweep.js`, which imports `auth.js`; the "Run audit scripts"
  CI step didn't pass `JWT_SECRET` (per-step env). Added it.
- **`DiscussionScreen` loading placeholder.** The discussant-name slot
  rendered nothing while loading; restored the `…` placeholder so the
  header doesn't reflow and the loading state is observable
  (DiscussionScreen.test CONTRACT 1).

### Notes

- E2E remains red: a **pre-existing** brittle/flaky UI suite (many specs
  are maintainer-marked `SKIP … brittle`; failures span unrelated files;
  some pass on retry; rest are headless render timeouts). Untouched by
  the 16.5.2026 bug fixes; needs a dedicated stabilization effort.

## [2.3.6] — 2026-05-17

Patch release. Regenerated API reference (docs drift gate).

### Fixed

- **Generated reference was stale vs source.** The Bug 5/6 changes to
  `server/routes/orders-routes.js` (tenant_id on order rows, turnaround
  default) changed the orders API surface, so `docs:gen:api` output
  drifted from the committed `docs/reference/api/orders.md` +
  `openapi.json` (+ a config line). Regenerated and committed so the
  Docs workflow's drift gate passes.

## [2.3.5] — 2026-05-17

Patch release. The actual fix for red CI — npm-version lockfile skew.

### Fixed

- **`package-lock.json` was generated by npm 11 (local Node 25); CI,
  server and Docker run npm 10 (Node 22).** An npm-11 lock omits part of
  the React transitive closure (`react@18.3.1`, `react-dom@18.3.1`,
  `@types/react@18.3.28`, `scheduler@0.23.2`, `@types/prop-types`) that
  npm 10's `npm ci` recomputes and requires, so every clean `npm ci` on
  Node 22 failed with `EUSAGE … Missing: …`. 2.3.4's regen didn't help
  (still npm 11). The lockfile is now regenerated with **npm 10.9.3**
  (the project's target toolchain — CI matrix 22.x, server, Docker);
  `npm@10 ci --dry-run` exits 0. Always regenerate the lock with Node 22 /
  npm 10, not a newer npm.

## [2.3.4] — 2026-05-17

Patch release. Fixes red CI / broken clean installs (root cause of the
2.3.1–2.3.3 deploy pain).

### Fixed

- **`package-lock.json` was structurally out of sync with
  `package.json`** since the docs/teacher-cohorts stages. Any `npm ci`
  on a clean checkout (GitHub Actions, fresh server, Docker) failed with
  `EUSAGE … Missing: react@18.3.1, @types/react@18.3.28, scheduler@0.23.2
  …`. Earlier `npm install --package-lock-only` regens were run from a
  machine whose `node_modules` already satisfied the tree, so npm saw
  "up to date" and never wrote the missing closure. The lockfile has now
  been regenerated from a **pristine** state (no `node_modules`, no
  prior lock); `npm ci` validates clean (`--dry-run` exit 0). This is the
  actual fix — `npm install` fallbacks in deploy paths (2.3.1–2.3.3) were
  papering over this; they remain as defence-in-depth.

## [2.3.3] — 2026-05-17

Patch release. Operator update path made consistent with install paths.

### Fixed

- **`bin/rohy-update` used `npm ci`** while every fresh-install path
  (`deploy/docker/Dockerfile`, `deploy/bootstrap.sh`,
  `deploy/local-install.sh`) already uses `npm install`. Because rohy's
  `file:` siblings (`dynajs`, `oyon`) make `npm ci`'s strict lock check
  environment-fragile, the first `rohy-update` on an otherwise-healthy
  install would fail (and could trigger a needless rollback). All three
  `npm ci` invocations (update, rollback, hard-rollback) now use
  `npm install`; `--silent` dropped so a failure is visible, not hidden.

## [2.3.2] — 2026-05-17

Patch release. Docs site reachable behind the prefix-stripping reverse proxy.

### Fixed

- **In-app Help article links 404'd in production.** The VitePress docs
  were mounted only at `/rohy/docs`, but the deploy reverse proxy strips
  the `/rohy/` prefix before forwarding (public `/rohy/docs/X` → backend
  `/docs/X`). The docs dist is now served at **both** `/rohy/docs` (local
  dev / non-stripping proxies) and `/docs` (nginx-stripped production), so
  Help links resolve regardless of front-proxy prefix handling.

## [2.3.1] — 2026-05-17

Patch release. Release-packaging fixes so a clean deploy actually works.

### Fixed

- **`npm ci` failed on clean installs.** `package-lock.json` was out of
  sync with `package.json` (the docs/VitePress devDependency closure was
  never fully locked after stage-0). Regenerated the lockfile; `npm ci`
  now succeeds on a pristine machine (the production deploy path).
- **`build` no longer hard-fails without the docs toolchain.** A failed
  `docs:build` (e.g. missing `vitepress`) previously aborted the entire
  app build before the frontend was produced. It is now fail-soft: the
  app frontend builds regardless; the docs site is built when available.

## [2.3.0] — 2026-05-16

Minor release. Teacher cohorts, the enterprise documentation site with
in-app Help & Support, and a full triage pass over the 16.5.2026 bug
report.

### Added

- **Teacher cohorts.** Teacher-owned classes with join codes, roster and
  completion-grid views, cohort-scoped analytics (summary, timeline,
  hourly, stats, TNA sequences), per-cohort case assignment and
  co-teachers (migrations 0025–0027).
- **Documentation site.** VitePress site (trainee → educator → admin →
  operator → integrator → security) with local search, served at
  `/rohy/docs/`, plus an in-app **Help & Support** drawer (role-filtered
  articles, parsed release notes, redacted diagnostics bundle).

### Fixed

- **Investigations.** Default labs no longer hardcode a 30-minute
  turnaround; lab/radiology order rows now persist `tenant_id` so
  non-default-tenant sessions actually receive results; the worklist no
  longer mislabels pending tests "Ready" (UTC parsing).
- **Educational integrity.** The authoring case title (which names the
  diagnosis) is no longer shown to students; only educators+ see it.
- **Physical exam.** Posterior body-map regions (upper/lower back,
  buttocks) resolve again; special-test chips are clickable.
- **Debrief.** The discussant conversation no longer bleeds into the
  patient chat; clinical alarms stop sounding after End & Debrief.
- **Misc.** Body Map Editor opens for admins in production; the duplicate
  "Default Patient" chat tab is gone; the avatar FOV control affects the
  preview; Help/diagnostics requests use the correct API path and the
  docs site is served + linked correctly.
- **Cohort analytics.** Out-of-order or failed scoped reloads no longer
  render the previous scope's stats.

## [2.1.0] — 2026-05-14

Minor release. Per-persona LLM routing and a global version badge.

### Added

- **Per-persona LLM routing.** Patient, discussant, and every agent
  (nurse, consultant, family, etc.) now route through the LLM
  configured on their `agent_template` row (`llm_provider`,
  `llm_model`, `llm_api_key`, `llm_endpoint`, `llm_temperature`,
  `llm_max_tokens`). Resolution is two-tier: template → platform
  default. No per-case, per-session, or per-user overlay — the voice
  5-tier resolver taught us what that costs.
  - `LLMService.streamMessage` accepts a new `agentTemplateId` option;
    when set, the body carries `agent_llm_config: { agent_template_id }`.
  - Patient chat (`ChatInterface.handleSendToPatient`) and discussant
    (`useDiscussionEngine.sendMessage`) now both forward their
    `patientTemplate.templateId` / `discussant.templateId`.
  - `AgentService.sendAgentMessage` consolidated to send the same
    minimal `{agent_template_id}` payload instead of the previous
    bigger payload that included the client-redacted `llm_api_key`
    (which would have triggered the server's "trust client config"
    branch and called the LLM with the literal string `'[redacted]'`).
- **Global version badge.** A small centred "Rohy <major>.<minor>"
  pill sits at the top of every screen — login, chat, exam,
  investigations, debrief, settings, persona editor. Reads the
  version from `package.json` so `npm version` is the only place a
  release number lives. Mounted once at the entry point
  (`src/main.jsx`) alongside `<App />`.

### Changed

- **`AgentService.sendAgentMessage` payload.** No longer forwards
  `provider`, `model`, `api_key`, or `endpoint` from the client.
  Sends `{agent_template_id}` only; server reads the rest from the
  database. Same shape as the patient and discussant paths now use.

## [2.0.0] — 2026-05-14

Second major release. Three feature platforms land at once — voice, on-device
emotion capture, and multi-room navigation — alongside the multi-agent care
team, real physiologic monitor, the case-debrief surface, and a multi-stage
enterprise hardening pass.

### Added

- **Voice & avatars.** Four TTS providers behind `/api/tts`: Google,
  OpenAI, Kokoro (in-process ONNX), Piper (subprocess; voices
  auto-discovered from `server/data/piper/voices/`). 28 GLB avatar heads
  with 17 morph targets in canonical Oculus order, viseme-driven lipsync
  via `wawa-lipsync`. 5-tier voice precedence (platform → case → agent →
  session → user) implemented in `src/utils/voiceResolver.js`. Per-case
  voice overrides, Patient persona default voice.
- **Multi-agent care team.** Per-case agent rosters covering patient,
  nurse, consultant, family member, and case-debrief tutor. Page/Call
  flow with 1–3 min server-anchored arrival ETAs that survive page
  reloads. End & Debrief flow with a Socratic discussant that opens the
  retrospective.
- **Multi-room navigation.** Five peer rooms (Patient, Physical
  Examination, Laboratory, Radiology, Consultant) consolidated into a
  single `currentRoom` source of truth in `src/App.jsx`. RoomNavigator
  with badge dots for unviewed activity. Every `learning_events` row
  now carries the active room (migration 0021).
- **Emotion capture (Oyon).** Vendored sub-library mounted at
  `/api/addons/oyon/*`. Browser-side inference via MediaPipe + ONNX Web;
  only aggregated 10-second windows leave the device. Three production
  models, single canonical emotion-label list, frozen-at-write
  visibility flags for analytics.
- **Investigations.** 225 labs across 33 groups, 74 radiology studies,
  67 exam regions, gender-specific reference ranges. Pill-stack viewer
  for cumulative report viewing, 1–5 minute turnarounds.
- **Patient monitor.** Physiologic ECG generator, 7 vitals, 5 rhythms,
  9 modifiers, treatment effects engine with 33 default treatments and a
  Stage-5 override guard that preserves manually-pinned vitals across
  engine ticks.
- **xAPI-style event log.** 130+ canonical verbs through
  `src/services/eventLogger.js`. Room-stamped, vitals-enriched session
  activity feed.
- **Case snapshot binding.** Session start freezes `cases.config` + 
  `cases.scenario` into `sessions.case_snapshot` so admin edits during
  a live session don't bleed into the running monitor.
- **Landing site.** Static one-page scientific site at `landing/` —
  hostable anywhere, no build step.
- **Operator update CLI.** `bin/rohy-update` reads
  `migrations/MANIFEST.md` to decide whether a migration is additive
  (auto-apply) or destructive (refuse without `--allow-destructive`).

### Changed

- **Enterprise prompt stability across case switches** (this release):
  cross-case LLM role bleed eliminated via three defence-in-depth
  layers. New `src/utils/roleAnchor.js` block leads every assembled
  system prompt (patient, discussant, every agent type). Case-id
  stamps on `patientTemplate` (`ChatInterface.jsx`) and the resolved
  discussant (`discussionService.js`) detect cross-case state mismatch.
  `useDiscussionEngine.sendMessage` and `buildPatientSystemPrompt` both
  refuse-or-drop on mismatched stamps. Opening sentinel for the
  discussant changed from `"Hello."` to `"[System: open the case
  debrief now.]"` — small voice-mode models no longer mirror back as
  the learner.
- **Notification dispatch consolidated.** All toast/banner/alarm
  producers now route through `src/notifications/`; the four parallel
  systems are retired.
- **Tenant scoping enforced via middleware** rather than ad-hoc
  `WHERE tenant_id =` in each handler. Role checks use rank comparison
  (`requireRole(RANKS.educator)`) rather than string equality.
- **TTS gender-based voice substitution removed.** The server plays the
  voice the client asks for; admins pick gender-appropriate voices in
  Settings → Voice or the case editor.

### Fixed

- **Cross-case prompt assembly** (`patientTemplate` retaining the prior
  case's value during the case-switch async window).
- **Discussant lazy-init hydration race** — replaced with an effect on
  `[sessionId]` plus a `hydrated` gate that prevents the initial empty
  render from clobbering the new session's localStorage history.
- **Stale TTS engine routing** — `engine` is now forwarded from
  `voiceResolver` to `/api/tts` so a Piper-configured case actually
  plays Piper instead of silently falling back to the platform default.
- **Kokoro voice case mismatch** — `kokoro-js` emits Title-Case gender;
  the rest of rohy expects lowercase. Now normalised in
  `listKokoroVoices` so every voice surfaces instead of collapsing to
  two defaults.
- **Lab database missing in deployed image** — `Lab_database.json` +
  `heart.txt` now copied into the runtime stage of the Docker image.
- **Snapshot binding** — admin edits to a case mid-session no longer
  bleed into the running monitor (regression-locked at unit + e2e).

### Security

- **May-2026 audit cycle.** Ownership + tenant gates added on
  agent/orders/labs/radiology/treatment session-scoped routes. Oyon
  row-level visibility enforced via role-keyed columns instead of
  blanket `(admin_can_view OR educator_can_view)`. Migration 0022
  reclassified additive → destructive in MANIFEST.md. Response
  redaction centralised in `server/redaction.js`.
- **Tests for silent-failure paths.** `silent:true` interactions path,
  rate-limit branches, and rejected cross-provider voice IDs now have
  unit coverage.

### Removed

- Stale tests locking retired behaviour: OrdersDrawer "Ordered Tests"
  panel, InvestigationsScreen two-step pill flow, TTS `body.provider`
  override on the main `/api/tts` route (preview path still honours it,
  gated by `requireAdmin`).

## [1.0.0] — 2026-04 (previous release)

Initial public release. Virtual-patient text chat with case-bound system
prompts, basic monitor, single-room layout, session persistence, admin
case editor, multi-tenant auth.

[2.1.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.1.0
[2.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.0.0
[1.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v1.0.0
