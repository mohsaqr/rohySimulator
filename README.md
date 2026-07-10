# Rohy — AI Virtual Patient Simulation Platform

![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Stack](https://img.shields.io/badge/stack-React%2019%20%7C%20Node%20%7C%20SQLite-blue)
![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20playwright-success)

A comprehensive medical simulation platform for clinical education. Trainees converse with an AI-driven virtual patient — by text **or by voice with an animated 3D avatar** — interpret a live multi-parameter monitor with physiologically accurate ECG, order labs and imaging from a 225-test database with gender-specific normal ranges and 32 lab panels, perform structured physical examinations on a clickable anatomical body map across 67 named regions, administer 33 default treatments (18 medications + IV fluids + oxygen delivery + positioning) that produce time-decaying changes to vitals, navigate between five peer rooms (Patient · Examination · Laboratory · Radiology · Consultant) with badge dots signalling ready labs, ready imaging, and a present consultant, page on-call agents with a 1–3 minute server-anchored Call flow that survives refreshes and room hops, debrief afterwards with an AI discussant via a dedicated end-of-case "End & Debrief" button, and have every action — stamped with the active room — analysed in a Transition Network Analysis dashboard.

Everything runs on your own infrastructure. Local TTS (Piper, Kokoro) and local LLMs (LM Studio, Ollama) are first-class — cloud providers (Anthropic, OpenAI, Google) are optional. Multi-tenant ready, role-hierarchy aware (5 ranks), audit-logged, soft-deleted with right-to-erasure purge, and instrumented with structured-NDJSON observability.

---

## Quick Start

```bash
# 1. Install (also downloads ~93 MB of Oyon MediaPipe + ONNX bundles
#    via the postinstall hook — needs `curl` on PATH and internet)
npm install

# 2. Configure environment
cp server/.env.example server/.env
# Edit server/.env — at minimum set JWT_SECRET (required, server refuses to start without it)

# 3. Start frontend + backend together
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000
- **Default seeded users (development only):** `admin` / `admin123`, `student` / `student123` — refused in production unless you set `ALLOW_DEFAULT_USERS=1`

If the Oyon download was skipped (no `curl`, no network during `npm install`, behind a proxy), face/emotion capture won't work until you re-run:

```bash
npm run setup:oyon          # idempotent — only fetches missing files
```

For optional local TTS, install Piper:

```bash
bash server/scripts/install-piper.sh
```

Kokoro TTS (~330 MB) is downloaded automatically on first use and warmed up at boot when selected.

### Going to production?

**Latest release:** [`v1.0.0`](https://github.com/mohsaqr/rohySimulator/releases/tag/v1.0.0) — multi-arch Docker image at `ghcr.io/mohsaqr/rohy:v1.0.0`, plus self-contained source and Docker tarballs (sha256-verified, for air-gapped sites). The release workflow boots the published image and runs `tech-test.sh` against it before the tag finalises, so "tag exists" already means "verified to install."

Three sibling docs cover the operator lifecycle end-to-end:

| Doc | When to read it |
|---|---|
| **[docs/INSTALL.md](docs/INSTALL.md)** | Putting Rohy on a new machine. Five paths: published image (recommended) / Docker build / Linux+systemd / single-machine / air-gapped. Prerequisites, smoke verify, first-boot checklist, troubleshooting. |
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Hardening a real deploy. Build-vs-pull, reverse proxy (nginx/Caddy), TLS, environment reference, security checklist, deploy verification + live monitoring (`/admin/health`), Postgres readiness, retention. |
| **[docs/UPDATING.md](docs/UPDATING.md)** | Two upgrade paths: `bin/rohy-update` (source/systemd installs) or `docker pull` a newer tag (Docker installs). Pre-flight, atomic upgrade procedure, automatic rollback, off-site backup recipes, troubleshooting, contract-probe creds setup. Design rationale: [docs/UPDATE-STRATEGY.md](docs/UPDATE-STRATEGY.md). |

**TL;DR for the impatient:**

```bash
# Fastest: pull the published image
docker pull ghcr.io/mohsaqr/rohy:v1.0.0
docker compose -f deploy/docker/compose.yml up -d

# OR — Linux + systemd from source, public DNS, auto-TLS via certbot
sudo deploy/bootstrap.sh --frontend-url=https://your-host/rohy --admin-bootstrap

# Once installed, ongoing upgrades:
sudo rohy-update check       # source path — what would change?
sudo rohy-update apply       # snapshot → upgrade → verify → auto-rollback on failure
docker compose pull rohy     # docker path — fetch the new image tag
docker compose up -d         # apply
```

**Oyon (local-browser emotion capture) is ON by default in every deploy path.** Routes mount under `/api/addons/oyon/*`, the standalone analytics page at `/oyon/standalone/`, models auto-downloaded by `npm install`. Disable: `OYON_ENABLED=0` in env, restart. When disabled, the Settings tab shows a friendly panel — install size unchanged, only routes gated. See [DEPLOY.md § Disabling features](docs/DEPLOY.md#disabling-features) for path-by-path detail.

---

## Feature Catalogue

### Conversation & Multi-Agent System

- **5 multi-provider LLM backends** — Anthropic Claude, OpenAI, Google Gemini, LM Studio (local), Ollama (local). Per-platform API keys, runtime model switching, server-side streaming via `/api/proxy/llm`, 5-tier resolver precedence (platform → case → agent → session → user), per-user and platform-wide token usage tracking with admin-editable pricing tables.
- **5 default agent personas, fully editable** — Patient, Nurse (Sarah Mitchell), Consultant (Dr. James Chen), Family Member, Discussant. Each with its own persona prompt, dos/don'ts list, voice slot, avatar, communication style, memory access matrix, and LLM override.
- **Per-case agent rosters** — Assign any agents to a case with arrival/departure scripting, override their name and prompt per-case via `case_agents.config_override`, and route between them via the chat UI's tab system.
- **Page / Call flow with server-anchored ETA** — Paging an agent (Consultant, Nurse, etc.) computes a 1–3 minute arrival time server-side and stamps it on `agent_session_state.arrives_at` (migration 0024). The client drives the countdown from the row, so a browser refresh, room hop, or chat remount picks up exactly where it left off — the old in-memory `setTimeout` could drop the timer. Auto-arrival is convergent: any read of `/sessions/:id/agents` flips overdue paged agents to `present` in a single bounded UPDATE.
- **Discussant debrief flow** — Trainees end a case via a dedicated **End & Debrief** button that unlocks a separate `DiscussionScreen` with its own voice, avatar, LLM, and persona. The discussant's opening turn is sent as a `silent: true` LLM call so the meta-prompt never appears in the learner-utterance audit trail. Per-case attached discussants override the platform default; the resolver guarantees the patient's case voice does not leak into the discussant's playback (regression-locked at unit + component + e2e since 2026-05-06). Captures performance feedback and stores it in session notes.
- **Team communications log** — Cross-agent message history per session, queryable for analytics. Tenant-scoped reads + writes since the May-2026 audit hardening.
- **Stage-direction stripping** — `*nods*`-style annotations are removed from both the rendered transcript and the TTS request body (locked end-to-end with regression tests).

### Voice Mode (4 TTS providers, 28 avatars, viseme-driven lipsync)

| Provider | Type | Voices | Notes |
|---|---|---|---|
| **Google Cloud TTS** | Cloud | 19+ (Chirp 3 HD, Chirp HD, Neural2, en-US + en-GB + multilingual) | Semitone pitch control, headphone-class EQ profile, streaming PCM |
| **OpenAI TTS** | Cloud | 6 (Alloy, Echo, Fable, Onyx, Nova, Shimmer) | tts-1 / tts-1-hd, native streaming PCM at 24 kHz |
| **Kokoro** | **Local, in-process** | All bundled Kokoro voices | Runs via `kokoro-js` (ONNX), one-time ~330 MB download, warmed at boot |
| **Piper** | **Local subprocess** | Any installed `.onnx` voice | Auto-discovered from `server/data/piper/voices/` |

- **3D talking avatars** — **28 pre-bundled GLB heads** (RocketBox + RPM + procedural fallbacks). Viseme-driven lipsync via [`wawa-lipsync`](https://www.npmjs.com/package/wawa-lipsync) wired through Three.js / React-Three-Fiber. **17 morph targets in canonical Oculus order** for cross-platform compatibility.
- **Per-case + per-agent voice overrides** — Each case can pin a `case_voice` and `tts_pitch` (in semitones) and `tts_rate` independently of the platform default. Each agent template can override the same. The discussant's voice is resolved from a separate path so per-case patient overrides do not leak (locked at unit, component, and e2e test layers — incident date 2026-05-06).
- **Browser STT** — Web Speech API for input. Continuous mode with auto-pause on assistant speech.
- **Sentence-level streaming** — Streaming LLM replies are split at sentence boundaries and pre-fetched as TTS one sentence ahead, giving sub-second time-to-first-audio on local engines.
- **Diagnostic Bar** — Live runtime panel showing the literal `/api/tts` request body (voice, provider, pitch, rate, text), wire history (last 12 requests), and one-click audition replay so a contributor can A/B-compare what was actually sent vs. the platform's gender-slot voice.

### Patient Monitor (physiologic ECG + 7 vital channels)

- **7 vital signs**: HR, SpO₂, NIBP (sys/dia), RR, Temp, EtCO₂ — each with admin-editable display range, alarm thresholds (low/high), audio pattern (urgent/beep/chime/silent), and per-case override.
- **Physiologic ECG generator** — **Sum-of-Gaussians waveform** producing morphologically correct PQRST-T at any heart rate. **5 base rhythms** (Normal Sinus Rhythm, Atrial Fibrillation, Ventricular Tachycardia, Ventricular Fibrillation, Asystole) plus **9 ECG modifiers** (STEMI ST elevation, NSTEMI ST depression, Angina, Hyperkalemia wide QRS, Hypokalemia T-wave inversion, Pericarditis diffuse ST elevation, LBBB, PVC ectopics, signal noise level).
- **SpO₂ plethysmograph waveform** — pulsatile waveform synced to HR, optional toggle.
- **Treatment effects engine** — **33 default interventions seeded** with onset, peak, and duration kinetics, split across 4 categories:
  - **18 medications**: Epinephrine, Atropine, Adenosine, Amiodarone, Metoprolol, Esmolol, Norepinephrine, Dopamine, Vasopressin, Labetalol, Hydralazine, Nitroglycerin, Morphine, Fentanyl, Midazolam, Propofol, Furosemide, Albuterol
  - **5 IV fluids**: Normal Saline 500ml & 1000ml boluses, Lactated Ringers 500ml bolus, D5W 500ml, Albumin 5% 250ml
  - **5 oxygen delivery modes**: Nasal Cannula 2 / 4 / 6 L/min, Simple Face Mask 8 L/min, Non-Rebreather Mask 15 L/min
  - **5 nursing positioning maneuvers**: Trendelenburg, Fowler 45°, High Fowler 90°, Supine, Left Lateral

  Active treatments produce **time-decaying changes to vitals** — a fluid bolus raises BP then washes out, an oxygen mask lifts SpO₂, a positioning change adjusts hemodynamics — visible in the `ActiveEffectsIndicator` overlay. Admins can author additional medications + custom effect curves via `POST /api/master/medications` (with bulk import at `POST /api/master/medications/bulk`); each medication can have multiple dose forms tracked in `medication_doses`. The `medications` master catalog table records `medication_code`, `generic_name`, `brand_names[]`, `drug_class`, `route`, `typical_dose`, `frequency`, `indications[]`, `contraindications[]`, `side_effects[]`, `is_controlled`, `is_high_alert`.
- **Scenario timeline engine** — Time-keyframed vital-sign trajectories with linear interpolation between frames. **Stage-5 override guard**: any vital, rhythm, or condition the trainee manually pins is preserved across subsequent engine ticks (pre-fix only `rhythm` was guarded). Auto-stop fires ~2s past the last frame.
- **Snapshot binding** — Sessions freeze `cases.config` + `cases.scenario` into `sessions.case_snapshot` at session start so admin edits during a running session do not bleed into the simulator (Stage-1 audit fix, regression-locked at unit + e2e).
- **Vitals persistence** — Deadband-thresholded posts to `/sessions/:id/vitals`. On reload the monitor restores the latest persisted state instead of reverting to baseline.

### Investigations (225 lab tests + 74 radiology studies + 67 exam regions)

- **Laboratory** — **225 lab test entries across 33 groups** (196 unique tests in `Lab_database.json` plus 10 cardiac-crisis tests merged in from `heart.txt` at runtime via `server/services/labDatabase.js`). Categories include Hematology (CBC, Differential), Basic Metabolic Panel, Renal Function, Liver Function, Coagulation, Thyroid, Blood Gases, Cardiac Markers, Cardiology Crisis, Inflammatory Markers, Iron Studies, Vitamins, Lipid Panel, Diabetes, Metabolic, Urinalysis, Pancreatic, Adrenal, Reproductive Hormones, Tumor Markers, Drug Levels, Body Fluids, CSF, Autoimmune, Cardiovascular Risk, Toxicology, Trace Elements, Pituitary, Hemolysis Markers, Thrombophilia, Immunoglobulins, Parathyroid. **Gender-specific reference ranges where clinically relevant** (44 entries split by Male / Female: Hemoglobin 12-16 g/dL female / 14-18 g/dL male, Hematocrit, Iron, Testosterone, Estradiol, …). Search by test name or panel; admin can bulk-import additional tests via `POST /api/master/lab-tests`.
- **32 lab panel templates** — Acute MI Panel, Heart Failure, Unstable Angina, **Diabetic Ketoacidosis (DKA)**, Hyperosmolar Hyperglycemic State, Sepsis, Stroke Workup, Pulmonary Embolism, Acute Pancreatitis, Liver Failure, Renal Failure, … Each panel pins specific tests with `value_multiplier` or `custom_value` overrides for case-specific abnormal results.
- **Radiology** — **74 pre-loaded studies** spanning X-Ray, CT, MRI, Ultrasound, Cardiac (12-lead ECG, echocardiogram), Nuclear Medicine, Fluoroscopy, Mammography. Normal-report database for each study; per-case admin editor for abnormal reports; image / video upload + display for case-attached findings.
- **Investigations screen — pill-stack viewer** — When a lab or radiology order is ready, clicking the worklist row both adds it to the persistent pill stack (newest on top, dismissible via the per-pill X) *and* expands the full report in the right pane (single-click flow since `ab266a4`; the previous two-step "click row → pill, click pill → expand" was retired). Re-opening a previously viewed report from the stack flips the same pane back to the full report; closing returns to the welcome card + pill row. Orders that were already `viewed_at` on first poll auto-populate the stack so refreshing mid-session doesn't lose your scratch-pad.
- **1–5 minute turnaround band** — `case_investigations.turnaround_minutes` is clamped to the 1–5 minute simulation band (migration 0023 normalised legacy 30 / 60 / 240 / 2880 minute waits seeded before the clamp). Case authors who want longer waits adjust through the case wizard; the band keeps a single session tractable inside a teaching slot.
- **Physical Examination** — Two parallel surfaces:
  - **BodyMap**: anatomically accurate SVG silhouette with **invisible polygon hit regions** keyed to **67 named exam regions** (head/face/neck, chest, abdomen, back, extremities, perineum) across anterior + posterior + lateral views, gender-specific.
  - **ManikinPanel**: structured grid of region × exam-type (auscultation, palpation, percussion, inspection, special tests). Cranial nerves, motor, sensory, reflexes, coordination as discrete examinable items.
  - **Multi-region auscultation** — chest, abdomen, posterior, neck — with audio-clip playback per region.
  - **Idempotent recording** — `POST /sessions/:id/exam-findings` is keyed on `(session_id, body_region, exam_type)` so retries don't duplicate findings (Stage-6 audit fix).
- **Medication catalog** — Searchable drug database with admin bulk-import. Each medication has dose forms, routes, and links to treatment effect curves.
- **Clinical & patient records** — Hidden context the AI can read but the trainee discovers through interaction (medical history, social history, family history, recent encounters). Admin-controlled access scopes per agent (`memory_access` matrix).

### Notifications & Alarms (centralized, multi-surface)

Replaced 4 parallel notification systems (Toast, useAlarms, EventLogger, native `alert()`) with **one central NotificationCenter** that every producer reports to.

- **6 surfaces**: Toast (hover-pause + click-anywhere-to-dismiss), Banner (clinical-critical with Ack/Snooze, `role="alert"` aria-live), Audio (urgent/beep/chime/silent patterns, configurable frequency), Backend log (bounded queue with `sendBeacon` on unload), Console, History (per-user pane in Notification Settings).
- **Routing matrix** — Per-(severity × source) routing. Trainees and clinicians get their own DND, snooze duration, severity threshold, source mute, surface mute.
- **Mute hierarchy** — `acked → snoozed → DND → minSeverity → source/surface mutes`. Critical clinical alarms bypass DND but still respect ack and snooze.
- **Cross-case ack clearing** — `clearTransient(reason)` is called on every `sessionId` change so case A's acked alarms don't silence brand-new alarms in case B.
- **Audio resume** — Globally listens for click/keydown/touchstart to unblock the AudioContext (fixes the "alarms silent until you click PatientMonitor first" legacy bug).

### Room Navigation & Room-Aware State

- **Bottom RoomNavigator with five peer rooms** — Patient, Examination, Laboratory, Radiology, Consultant. Single source of truth on `App.jsx`'s `currentRoom` (consolidated from three floating-pill booleans). Each room is a peer, not a modal — switching rooms preserves the running session, the patient monitor, active treatment effects, and the chat transcript.
- **Badge dots on every room button** — A small unread dot signals per-room state the trainee needs to attend to: ready labs awaiting review, ready radiology awaiting review, and a paged consultant who has arrived. Replaces the retired floating "Ordered Tests (N)" panel that used to overlap the chat surface.
- **Every event carries the active room** — `learning_events.room` (migration 0021) stamps the room name (`chat` / `examination` / `lab` / `radiology` / `consultant`) on every event row server-side. TNA reads now segregate "the trainee paged the consultant from the lab room" from "from the patient room," which previously collapsed.
- **No back button on room screens** — Rooms exit through the RoomNavigator, not via in-screen Back affordances. The old inline "Switch room" / `[ ]` hotkey hint inside InvestigationsScreen was removed.

### Authoring (case wizard + scenario repository + agent editor)

- **Full-page Agent Persona Editor** — Identity, avatar with live 3D preview + framing sliders, voice (engine + voice ID + rate + pitch in semitones with preview), persona prompt, editable Dos / Don'ts lists with reorder, behaviour, LLM (with test button), memory access matrix, conditional discussant section. Reset-to-defaults restores shipped values from a JS source-of-truth array.
- **Case Wizard (12-step flow)** — Persona, demographics, vitals, scenario, alarms, agents, treatments, labs, radiology, physical exam, clinical records, and patient record documents.
- **Scenario Repository** — **16 pre-seeded clinical scenarios**: Septic Shock, STEMI Progression, Hypertensive Crisis, Progressive Respiratory Failure, Post-Resuscitation Recovery, Anaphylactic Shock, Diabetic Ketoacidosis, Acute Ischemic Stroke (CVA), Pulmonary Embolism, Upper GI Bleed, COPD Exacerbation, Severe Hypoglycemia, Complete Heart Block, AFib with RVR, Opioid Overdose, Acute Decompensated Heart Failure. Reusable templates with import / export.
- **12 pre-built acute clinical cases** — split between two seeders:
  - **6 auto-seeded on first boot** (`server/seeders/cases.js`): Acute Chest Pain (STEMI), Septic Shock (Pneumonia), Diabetic Ketoacidosis, Acute Asthma Exacerbation, Acute Stroke (Left MCA), Maria Mercedes (Acute STEMI)
  - **6 additional via `node server/scripts/seed-acute-cases.cjs`**: Massive Pulmonary Embolism (post-op DVT, hemodynamic instability), Acute Left MCA Stroke (tPA window), Diabetic Ketoacidosis – Severe (insulin pump failure), Opioid Overdose – Fentanyl, Complete Heart Block – Symptomatic, Flash Pulmonary Edema (decompensated heart failure)

  Each case ships with full vitals, scenario timelines, lab results, radiology reports, exam findings, agent rosters, family member personas, medication lists, allergies, social history, and PMH — evidence-based emergencies designed for state-of-the-art simulation.
- **Versioning** — Cases keep edit history in `case_versions`; admins can restore previous versions. Soft-deleted with `deleted_at` (Stage E7 retention).
- **JSON import / export** — Cases, scenarios, settings, lab panels — all round-trip through structured JSON.

### Analytics (TNA + xAPI event log)

- **Transition Network Analysis dashboard** — Sequences of trainee actions are mined into a directed weighted graph via [`tnaj`](https://github.com/mohsaqr/tna-js). Includes:
  - Network graph with curved bidirectional edges and self-loops
  - Levenshtein-distance + Ward's D2 hierarchical clustering of trainee behaviour
  - InStrength centrality, frequency, distribution, and sequence index plots
  - Per-cluster sub-views with light/dark theme toggle
- **xAPI-style event log** — Every navigation, examination, order, treatment, message, monitoring action, alarm response, and form interaction captured with **130+ verb categories**. Server-side merging into 10 clinical labels for analysis. Pre-mount events buffer (1000 cap) and replay on first center-bound `log()` after mount.
- **Exports** — Login logs, chat logs, settings logs, complete-session bundles, questionnaire responses, audit logs (CSV / JSON).
- **Emotion logging** — Stage-triggered emotion + intensity questionnaire surfacing during scenario state transitions.
- **Post-case questionnaires** — Clinical Reasoning Assessment + User Experience tracker, exportable per-cohort.

### Enterprise (9 audit stages: E1-E9 shipped)

| Stage | Subject | Highlights |
|---|---|---|
| **E1** | Schema integrity | FK cascades, hard-delete orphan prevention, missing-index sweep |
| **E2** | Migration framework | Versioned `migrations/*.sql` with checksum tracking, dry-run, baseline stamping |
| **E3** | RBAC role hierarchy | `guest(0) < student(1) < reviewer(2) < educator(3) < admin(4)` with central `requireRole()` enforcement, role_rank generated column |
| **E4** | Audit log coverage | Sensitive mutations log `oldValue` / `newValue` / metadata via `auditSuccess()`; secrets redacted before persistence |
| **E5** | Data classification + redaction | Centralized `redaction.js` policy (secrets, PII scope-controlled, internal); `apiKey` etc. redacted before any response leaves the server |
| **E6** | Multi-tenant readiness | `tenants` table, tenant-scoped queries on 40+ tables, `requireSameTenant()` middleware, mass-assignment-resistant inserts |
| **E7** | Soft-delete + retention | `deleted_at` on user-authored tables, retention sweep cron (`scripts/retention-sweep.js`), GDPR-aligned purge endpoint with dry-run |
| **E8** | Connection pooling + portability | Promise-based `dbAdapter.js` shim; SQL fragment helpers (`now()`, `upsert()`); Postgres readiness inventory |
| **E9** | Observability hooks | NDJSON request logging with request-id propagation, slow-query threshold, error tracker; configurable via `ROHY_LOG_LEVEL`, `ROHY_SLOW_QUERY_MS`, `ROHY_LOG_SKIP_PATHS` |

**May-2026 audit follow-up cycle** — Targeted hardening of gaps E3/E5/E6 found in a second-pass review:
- **Agent + session route ownership.** `POST/PUT/DELETE /cases/:id/agents` now require educator+ (`requireEducator`). Every session-scoped runtime endpoint (`/sessions/:id/agents`, `/page`, `/arrive`, `/depart`, `/status`, `/conversation`, `/team-communications`) goes through `verifySessionOwnership` so students can't read/write across each other's sessions by guessing the integer id. Every INSERT into `case_agents` / `agent_conversations` / `agent_session_state` / `team_communications_log` now stamps `tenant_id` (rows used to silently default to tenant 1 after migration 0004).
- **Orders/labs/radiology/treatment reads.** `/sessions/:id/orders`, `available-labs`, `available-radiology`, `radiology-orders`, `treatment-orders`, `active-effects` are now session-ownership-gated and tenant-filtered. Treatment endpoints used to `SELECT user_id FROM sessions` but never compared it to the caller — that fake-defence pattern is gone.
- **Oyon row-level visibility.** `oyon_emotion_records` carry frozen-at-write `student_can_view` / `educator_can_view` / `admin_can_view` flags. Reads now honour those flags via a caller-role-keyed predicate (`buildEmotionRecordsWhere`, `/admin/live`, `/analytics/session`, `/analytics/students`). Flipping a tenant toggle can no longer retroactively expose data captured under stricter rules; an educator cannot see admin-only rows.
- **Migration 0022 reclassified `destructive`** in `MANIFEST.md`. Predicate-based row DELETEs on user-authored tables (`cases`, `platform_settings`) without an FK guard are destructive per the contract; future operators upgrading past 0022 go through the `--allow-destructive` gate. The policy section now explicitly covers `DELETE FROM <table>` and `UPDATE <table> SET …` that overwrites user data.

### Oyon — Local-Browser Emotion Capture & Analytics

Camera-side emotion analytics for capture sessions. **Inference runs entirely
in the browser** (MediaPipe face landmarker + ONNX Runtime Web emotion
classifier); only aggregated 10-second windows leave the device — never
raw frames or landmarks (server validator hard-rejects raw-media fields).

- **Three production multi-task models** (HSE EfficientNet-B0, EmotiEffLib MobileViT, EmotiEffLib MobileFaceNet — all 8-emotion AffectNet: anger / contempt / disgust / fear / happy / neutral / sad / surprise + valence/arousal regression). Auto-downloaded by `npm install` from jsDelivr (~93 MB total). Air-gap path bundles them in the tarball.
- **Window aggregation** — 10s default window, 1Hz sampling, configurable per-tenant (window length, sample interval, min valid frames, smoothing alpha, hold time, switch confidence).
- **Per-session DB persistence** — `oyon_emotion_records` stores window-level dominant emotion + per-label probabilities + valence/arousal/entropy/stability/missing-face-ratio/quality-JSON. Dynamics features (`computeDynamicalFeatures`) attached when enabled.
- **Consent — opt-out by default once tenant enables Oyon.** Per-user toggle in Settings → Oyon. Server stamps records with the consent row's `consent_version`, not the client's claim (avoids version drift).
- **Live operator dashboards** — `/api/addons/oyon/admin/live` shows latest window per session; `/api/addons/oyon/admin/health` exposes per-endpoint 4xx counts (5min + 1h windows). Per-tenant view gates: admin / educator / student each toggleable.
- **Standalone analytics page** at `/oyon/standalone/` — works either as a guest demo or, when a `rohy_session` cookie is present, automatically attaches to the rohy backend. Includes logs dashboard at `/oyon/standalone/logs.html`.
- **Drift prevention (4 layers)**:
  1. Single canonical `ALLOWED_EMOTIONS` constant (`OyonR/src/config/emotionLabels.js`) imported by aggregator, validator, and every model config. Each model asserts its labels are a permutation of the canonical set at *import time* — typos fail to load.
  2. Pre-merge contract test (`OyonR/tests/contract.test.js`) composes synthetic samples → aggregator → validator end-to-end for every shipped profile, with a negative control reproducing the May-2026 7-of-8 sum bug.
  3. `tech-test.sh` contract probe (section 6) — when armed via `~/.rohy-deploy-creds`, every deploy POSTs a malformed batch and asserts the validator catches it.
  4. In-memory rejection counter at `/admin/health` — surfaces 4xx spikes without parsing journalctl.
- **Forward-compatible migrations** — Schema changes are additive-only by default; destructive changes follow a multi-release add → backfill → switch-reads → drop procedure. Policy in `migrations/MANIFEST.md`.
- **Toggle**: `OYON_ENABLED=0` in env disables the routes (Settings tab shows a friendly disabled panel; binary bundles still ship — toggling does not change install size).

The standalone library is also published independently — see [`OyonR/README.md`](OyonR/README.md) and [`OyonR/INSTALL.md`](OyonR/INSTALL.md) for embedding into a non-rohy app.

### Auth & Multi-User

- **JWT auth** with 4-hour default TTL, bcrypt password hashing.
- **5 roles**: guest, student, reviewer, educator, admin (rank-comparison via `requireRole()`).
- **Self-registration** — first user becomes admin if zero users exist; subsequent registrations default to `student`.
- **Force-logout**, **batch user creation**, **password change**, **profile preferences** with admin-controlled required-fields matrix.
- **Rate-limited** — 10 login attempts / 15 min / IP, 5 registrations / hour / IP; general API rate at 600 req/min/IP.
- **Token refresh on every request** — role / status / tenant_id refresh from `users` table so revocations take effect immediately.

---

## Architecture

```
rohySimulator/
├── server/                            # Node 22+ / Express 5
│   ├── server.js                      # Bootstrap, CORS, voice-key migration, Kokoro warmup
│   ├── db.js                          # SQLite schema (65 tables) + default seeders
│   ├── routes.js                      # 210 API endpoints
│   ├── dbAdapter.js                   # Promise wrappers, SQL fragment helpers (Stage E8)
│   ├── migrationRunner.js             # Versioned migration framework (Stage E2)
│   ├── observability.js               # Request-id, NDJSON, slow-query (Stage E9)
│   ├── redaction.js                   # Central response-redaction policy (Stage E5)
│   ├── middleware/
│   │   ├── auth.js                    # JWT, role hierarchy, tenant resolution
│   │   ├── requestId.js               # X-Request-Id propagation
│   │   ├── requestLogger.js           # NDJSON access log
│   │   └── errorHandler.js            # Last-mile error tracker
│   ├── seeders/                       # Default users, 6 acute cases, 5 agent personas
│   └── services/                      # Lab DB, googleTts, openaiTts, kokoroTts, voiceFallbacks, wav
├── migrations/                        # 24 versioned SQL migrations + MANIFEST.md (additive-by-default, destructive opt-in via --allow-destructive)
├── OyonR/                             # Local-browser emotion capture (MediaPipe + ONNX-Web)
│   ├── src/                           # Camera, face tracker, classifier, aggregator,
│   │                                  # validator, transports, settings, model configs
│   ├── tests/                         # 12 tests incl. contract.test.js (pre-merge guard)
│   ├── standalone/                    # Self-contained demo + logs dashboard
│   ├── examples/rohy-backend/         # Reference Express route adapter
│   └── scripts/download-models.sh     # jsDelivr vendor population (atomic, idempotent)
├── bin/
│   └── rohy-update                    # Operator CLI: check/apply/rollback/list-backups
├── src/                               # React 19 + Vite 7
│   ├── components/
│   │   ├── auth/                      # Login + register
│   │   ├── chat/                      # ChatInterface, PatientAvatar (lipsync-rigged)
│   │   ├── monitor/                   # PatientMonitor, EventLog
│   │   ├── examination/               # BodyMap, BodyMapDebug, ManikinPanel, AuscultationPanel,
│   │   │                              # ExamLog, ExamTypeSelector, FindingDisplay
│   │   ├── investigations/            # Lab + Radiology results modals, ClinicalRecordsPanel,
│   │   │                              # InvestigationPanel, LabValueEditor
│   │   ├── orders/                    # OrdersDrawer with idempotent /order-labs + /order-radiology
│   │   ├── treatments/                # TreatmentPanel, ActiveEffectsIndicator
│   │   ├── analytics/tna/             # 7 components: NetworkGraph, ClusterPanel, …
│   │   ├── discussion/                # DiscussionScreen + transcript + voice control
│   │   ├── debug/                     # DiagnosticBar (live wire payload + audition replay)
│   │   ├── patient/                   # PatientVisual, PatientSummaryCard
│   │   └── settings/                  # 23 components: ConfigPanel + per-tab editors
│   │                                  # (LLM, voice, avatars, agents, scenarios, alarms,
│   │                                  # labs, medications, body map, notifications, users)
│   ├── hooks/                         # useAlarms, useDiscussionEngine, useTreatmentEffects
│   ├── notifications/                 # Central NotificationCenter + 6 surfaces
│   ├── services/                      # AgentService, voiceService, eventLogger,
│   │                                  # PatientRecord, llmService, AuthService, discussionService
│   ├── contexts/                      # Auth, Toast, Voice, PatientRecord
│   └── data/                          # 215 lab tests, 32 lab panels, 16 scenario templates,
│                                      # investigation templates, exam regions, scenario timelines
├── public/avatars/heads/              # 28 GLB avatars + manifest.json
│                                      # (the standalone embeddable voice+avatar kit now
│                                      #  lives as a workspace sibling: ../talking-avatars/)
├── scripts/
│   ├── audit-*.sh                     # 18 enterprise audit scripts (E1-E9 + per-area)
│   ├── retention-sweep.js             # Cron-able log retention sweeper (E7)
│   ├── migrate.js                     # Manual migration runner (E2)
│   ├── rohy-backup.sh                 # Standalone DB snapshotter (VACUUM INTO)
│   ├── tech-test.sh                   # Comprehensive deploy verifier (POST_VERIFY hook)
│   ├── post-verify-rohy.sh            # Wrapper: mints a token before tech-test.sh
│   ├── smoke.sh                       # Lightweight liveness check
│   └── rocketbox-convert/             # GLB pipeline for adding new avatars
├── tests/                             # Vitest + Playwright suite (server, client, e2e, audio)
│   ├── server/                        # Server unit + integration tests
│   ├── e2e/                           # 12 Playwright specs
│   └── utils/                         # seedDb, startTestServer, mockTtsServer, renderWithProviders
├── bench/                             # 3 vitest benches: TTS latency, LLM throughput, concurrent sessions
├── docs/                              # Operator lifecycle: INSTALL, DEPLOY, UPDATING, UPDATE-STRATEGY
├── Lab_database.json                  # 215 lab tests with gender-specific ranges
└── server/data/radiology_database.json  # 74 radiology studies
```

### Database (65+ tables, 24 versioned migrations)

Core: `users`, `cases`, `sessions`, `interactions`, `event_log`, `case_versions`, `system_audit_log`.

Tenants: `tenants`, plus `tenant_id` columns on all user-owned tables (Stage E6).

Investigations: `lab_tests`, `lab_panels`, `panel_tests`, `case_investigations`, `investigation_orders`, `investigation_templates`, `investigation_parameters`, `investigation_views`, `lab_definitions`, `physical_exam_findings`, `body_regions`, `region_exam_types`, `body_map_coordinates`, `clinical_notes`, `medications`, `medication_doses`, `diagnoses`.

Scenarios: `scenarios`, `scenario_templates`, `scenario_timeline_points`, `scenario_events`, `vital_sign_history`, `session_vitals`.

Treatments: `treatment_orders`, `treatment_effects`, `active_treatments`, `case_treatments`.

Multi-agent: `agent_templates`, `case_agents`, `agent_conversations`, `agent_session_state`, `team_communications_log`.

Observability + governance: `llm_usage`, `llm_request_log`, `llm_model_pricing`, `tts_usage`, `alarm_config`, `alarm_events`, `emotion_logs`, `questionnaire_responses`, `export_records`, `login_logs`, `settings_logs`, `session_settings`, `session_notes`, `active_sessions`, `user_preferences`, `learning_events`, `patient_information`, `patient_record_events`, `patient_record_documents`, `exam_techniques`, `region_special_tests`, `region_default_findings`, `vital_sign_definitions`, `clinical_pathways`, `search_aliases`, `schema_migrations`.

---

## Tech Stack

| Layer | Stack |
|---|---|
| **Frontend** | React 19, Vite 7, TailwindCSS 4, Lucide icons, Three.js 0.184, @react-three/fiber 9, @react-three/drei 10, [`wawa-lipsync`](https://www.npmjs.com/package/wawa-lipsync) |
| **Backend** | Node 22+, Express 5, SQLite 3 (`sqlite3` async API + Promise adapter), JWT, bcrypt, multer, express-rate-limit |
| **TTS** | Piper (local CLI), Kokoro (`kokoro-js`, in-process ONNX), Google Cloud TTS, OpenAI TTS |
| **LLM** | Anthropic Claude, OpenAI, Google Gemini, LM Studio, Ollama (proxied through `/api/proxy/llm`) |
| **Analytics** | [`tnaj`](https://github.com/mohsaqr/tna-js) — `tna`, `clusterSequences`, `centralities` |
| **Testing** | Vitest 4 (client jsdom + server node projects), React Testing Library, msw, supertest, Playwright |
| **CI** | GitHub Actions (lint → build, test, audit, e2e) + Codecov gate (project ±1%, patch 60%) |

---

## Configuration

Runtime configuration lives in two places:

- **Platform Settings** (admin-only) — persisted in `platform_settings`. Categories: LLM, Voice, Avatars, Monitor, Chat, Notifications, Rate limits, Retention, Observability. Nothing model- or voice-specific is hardcoded in the client.
- **Environment** (`server/.env` in dev, `/etc/rohy/env` in systemd, `deploy/docker/.env` in compose) — `JWT_SECRET`, `NODE_ENV`, `FRONTEND_URL`, `ROHY_DB`, `OYON_ENABLED`, observability knobs, etc. Full reference table in [DEPLOY.md § Environment](docs/DEPLOY.md#environment-reference).

---

## Testing

The repo ships a comprehensive test pyramid (vitest + playwright):

| Tier | Files | Run with | Notes |
|---|---|---|---|
| Unit (utils, services, hooks) | `src/**/*.test.js`, `tests/server/**` | `npm test` | < 10s |
| Component (RTL) | `src/components/**/*.test.jsx` | `npm run test:client` | < 30s |
| Server route (supertest + spawned server) | `tests/server/**` | `npm run test:server` | < 10s |
| Audio fidelity (live API + FFT pitch shift) | `tests/server/audio/**` | `npm run test:server` | Skip without API keys |
| **Playwright E2E** | `tests/e2e/**/*.spec.js` | `npm run test:e2e` | Includes the 2026-05-06 regression lock |
| **OyonR contract** | `OyonR/tests/contract.test.js` | `cd OyonR && npm test` | Composes aggregator → validator with 8-emotion synthetic samples per shipped model. Negative control reproduces the May-2026 7-of-8 sum bug. |
| Benchmarks | `bench/**/*.bench.js` | `npm run bench` | Vitest bench mode |

Plus **18 enterprise audit shell scripts** at `scripts/audit-*.sh` (one per E-stage and one per feature area) that exercise the HTTP boundary and self-clean. **`scripts/tech-test.sh`** verifies a live deploy end-to-end (27 checks); see "Deploy verification & live monitoring" above.

---

## Documentation

### Operator-facing

| Document | What's inside |
|---|---|
| [`docs/UPDATING.md`](docs/UPDATING.md) | Operator manual for `bin/rohy-update`: pre-flight, upgrade procedure, rollback paths, off-site backup recipes (rsync + rclone), troubleshooting, contract-probe creds setup. |
| [`docs/UPDATE-STRATEGY.md`](docs/UPDATE-STRATEGY.md) | Design rationale: why operator-pull, why 1–2h downtime is OK, four-pillar architecture, phased roadmap. Read this before changing the update tool. |
| [`migrations/MANIFEST.md`](migrations/MANIFEST.md) | Migration policy: additive-only by default, multi-release procedure for destructive changes. |

### Oyon (emotion capture)

| Document | What's inside |
|---|---|
| [`OyonR/README.md`](OyonR/README.md) | Library overview: standalone usage, browser-only inference, transports. |
| [`OyonR/INSTALL.md`](OyonR/INSTALL.md) | Embedding into a non-rohy host app. |

### Engineering

| Document | What's inside |
|---|---|
| [`../talking-avatars/`](../talking-avatars/) | Embeddable voice + avatar kit — now a **standalone workspace-sibling repo** (relocated out of `kits/`). Ships a Claude Code skill (`SKILL.md`) and `LEARNINGS.md`. |

---

## Development

```bash
npm run dev          # frontend (Vite) + backend (node --watch) concurrently
npm run client       # frontend only
npm run server       # backend only
npm run lint         # ESLint
npm run build        # production build, outputs to frontend/ via dist/
npm run production   # run prebuilt server
npm test             # full unit + component + server suite (vitest)
npm run test:watch   # vitest watch mode
npm run test:client  # client-only (jsdom)
npm run test:server  # server-only (node)
npm run test:ci      # JUnit XML + coverage report
npm run test:e2e     # Playwright e2e
npm run bench        # vitest bench mode
```

Development tips:
- Vite dev server proxies `/api` → `http://localhost:3000`.
- Reset DB: stop the server, delete `server/database.sqlite`, restart — migrations + seeders re-run automatically.
- Adding a TTS provider: implement an async-iterator service under `server/services/` mirroring `kokoroTts.js`, register it in the `/api/tts` route, and add a UI tab under `src/components/settings/VoiceSettingsTab.jsx`.
- Adding an avatar: drop a viseme-rigged GLB in `public/avatars/heads/`, append to `manifest.json`. The `scripts/rocketbox-convert/` pipeline handles RocketBox source models with the canonical 17 morph targets in Oculus order.
- Adding a lab test: append to `Lab_database.json` (test_name, group, category, min_value, max_value, unit, normal_samples) — the seeder picks it up on next boot.
- Adding a scenario template: append to `src/data/scenarioTemplates.js` with timeline keyframes; it appears in the Scenario Repository.
- Adding an audit endpoint: write `scripts/audit-<area>.sh` mirroring the pattern in `scripts/audit-observability.sh` (start isolated server, drive HTTP, assert).

---

## Roles

**Guest (rank 0)** — pre-authentication.

**Student / Trainee (rank 1)**
- Run sessions, talk to the patient (text or voice), order labs / radiology / treatments, examine, view own session history.

**Reviewer (rank 2)**
- Read-only analytics + catalog access. Useful for QA reviewers without authoring rights.

**Educator (rank 3)**
- Trainee-level + create / edit cases, scenarios, agents, lab catalogs. Cannot touch platform settings, users, or audit logs.

**Admin (rank 4)**
- Full authoring + user management, agent persona editor, platform settings, audit logs + system_audit_log, soft-delete + purge endpoints, audit script runner.

---

## Embedding the Voice + Avatar Kit

The talking-avatars stack is also distributed as a **standalone embeddable kit**, now relocated to a workspace-sibling repo at [`../talking-avatars/`](../talking-avatars/) — a self-contained drop-in bundle of the entire talking-head + lipsync + TTS pipeline. Includes the 28-avatar GLB library, server-side TTS routes (Google + Kokoro), client-side `PatientAvatar` component, viseme map, a vanilla-JS standalone example, a Claude Code skill (`SKILL.md`), and a distilled `LEARNINGS.md`.

---

## Author

**Mohammed Saqr** — Professor of Computer Science, University of Eastern Finland
[www.saqr.me](https://www.saqr.me)

## License

MIT — see [LICENSE](LICENSE).
