# Changelog

All notable changes to rohy are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: bump versions with `npm version major|minor|patch` from the
repo root (this updates `package.json` + `package-lock.json` and creates a
tag in one step). Add a new section at the top of this file for every
release before tagging.

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
