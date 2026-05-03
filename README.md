# Rohy — Virtual Patient Simulation Platform

![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Stack](https://img.shields.io/badge/stack-React%2019%20%7C%20Node%20%7C%20SQLite-blue)

A comprehensive medical simulation platform for clinical education. Trainees converse with an AI-driven virtual patient — by text **or by voice with an animated 3D avatar** — while interpreting a live patient monitor, ordering labs and imaging, performing physical examinations, administering treatments that visibly change vitals, and being analyzed through a Transition Network Analysis dashboard.

Everything runs on your own infrastructure. Local TTS (Piper, Kokoro) and local LLMs (LM Studio, Ollama) are first-class — cloud providers (Anthropic, OpenAI, Google) are optional.

---

## Quick Start

```bash
# 1. Install
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

For optional local TTS, install Piper:

```bash
bash server/scripts/install-piper.sh
```

Kokoro TTS (~330 MB) is downloaded automatically on first use and warmed up at boot when selected.

> See [`docs/getting-started/quickstart.md`](docs/getting-started/quickstart.md) for a step-by-step walkthrough.

---

## Features

### Conversation
- **Multi-provider LLM** — Anthropic Claude, OpenAI, Google, LM Studio, Ollama. Per-platform API key & default model, runtime model switching, server-side rate limiting, per-user and platform-wide token usage tracking, admin-editable pricing table.
- **Voice mode** — Browser speech recognition (Web Speech API) for input. Streaming LLM replies for low time-to-first-audio. Sentence-level TTS scheduling for gapless playback.
- **TTS providers** — Piper (local), Kokoro (local, in-process via `kokoro-js`), Google Cloud TTS, OpenAI TTS. Per-provider voice selection, language, speech rate. Provider-specific voice IDs persisted server-side; no hardcoded voices in the client.
- **3D talking avatars** — 28+ pre-bundled GLB heads (RocketBox + RPM + procedural). Viseme-driven lipsync via [`wawa-lipsync`](https://www.npmjs.com/package/wawa-lipsync). Three.js / React-Three-Fiber rendering. Avatar framing controls per case. The patient visual mirrors whichever agent is currently speaking.

### Multi-Agent Cases
- **Agent templates** — Define reusable AI characters (patient, nurse, family member, consultant) with their own persona, voice, avatar, and LLM configuration.
- **Per-case agent roster** — Assign agents to a case with arrival/departure scripting; the trainee can talk to any present agent.
- **Team communications log** — Cross-agent message history per session.

### Patient Monitor
- **Vital signs** — HR, BP, SpO₂, RR, Temp, EtCO₂ with admin-editable ranges and alarm thresholds.
- **Physiologic ECG** — Sum-of-Gaussians waveform generator producing morphologically correct beats at any heart rate, with rhythm presets (NSR, SVT, VF, VT, AFib, asystole, …).
- **Treatment effects engine** — Active treatments produce time-decaying changes to vitals (a fluid bolus raises BP, then washes out). Visible in the `ActiveEffectsIndicator` overlay.
- **Scenario timeline** — Time-based vital-sign progression with optional manual override.

### Investigations
- **Laboratory** — 77+ tests with gender-specific normal ranges. Search by test or order entire panels (CBC, BMP, Cardiac, …). Per-case overrides, configurable turnaround per priority.
- **Radiology** — 745-line normal-report database (CT, MRI, US, plain film). Admin editor for case-specific abnormal reports. Image/video upload and display.
- **Physical examination** — Click-to-examine **BodyMap** (anatomically accurate invisible polygon regions) and a structured **Manikin** panel. Findings are persisted per session and available to the AI for context.
- **Structured neurological exam** — Cranial nerves, motor, sensory, reflexes, coordination as discrete examinable items.
- **Medications** — Searchable drug database; admin can bulk-import.
- **Clinical / patient records** — Hidden context the AI can read but the trainee discovers through interaction. Admin-controlled access scopes.

### Notifications & Alarms
- Centralized **NotificationCenter** with explicit producer/surface separation. Surfaces: toast, banner, audio, history, backend log, console.
- Routing matrix by severity × source. Per-user mutes, snooze, do-not-disturb (clinical-critical bypasses DND).
- Audio patterns: urgent / beep / chime / silent. Configurable frequencies.

### Analytics
- **TNA — Transition Network Analysis dashboard** — Sequences of trainee actions are mined into a directed weighted graph. Includes:
  - Network graph with curved bidirectional edges and self-loops
  - Levenshtein-distance + Ward's D2 hierarchical clustering of trainee behavior
  - InStrength centrality, frequency, distribution, and sequence index plots
  - Per-cluster sub-views with light/dark theme toggle
- **Session logs** — Every navigation, examination, order, treatment, message, monitoring action, and alarm response captured as xAPI-style events. Server-side merging into 10 clinical labels for analysis.
- **Exports** — Login logs, chat logs, settings logs, complete-session bundles, questionnaire responses (CSV / JSON).

### Authoring
- **Case wizard** — Persona, demographics, vitals, scenario, alarms, agents, treatments, labs, radiology, clinical records — all in a guided flow.
- **Scenario repository** — Reusable scenario templates with import/export.
- **6 pre-seeded acute case templates** + 10 additional clinical scenarios.
- **Versioning** — Cases keep edit history; admins can restore previous versions.
- **JSON import/export** — Cases, scenarios, settings.

### Sessions
- **End-of-session questionnaire** with admin-exportable responses.
- **Session timer** and patient name display.
- **Audit log** for admin actions.
- **Active session manager** for instructors.

### Auth & Multi-User
- JWT auth (4-hour default TTL), bcrypt password hashing.
- Roles: `admin` (full authoring + user management) and `user` (trainee).
- Batch user creation, password change, profile preferences.
- Rate-limited registration and login.

---

## Architecture

```
rohySimulator/
├── server/                    # Node 18+ / Express 5
│   ├── server.js              # Bootstrap, CORS, port fallback, voice-key migration, Kokoro warmup
│   ├── db.js                  # SQLite schema (45+ tables) and inline PRAGMA migrations
│   ├── routes.js              # ~199 endpoints
│   ├── middleware/auth.js     # JWT verify, role guards
│   ├── seeders/               # Default users, cases, agent templates, treatment effects
│   ├── services/              # Lab database, Piper / Kokoro / Google / OpenAI TTS, voice fallbacks
│   └── scripts/               # install-piper.sh, acute-case seeders
├── src/                       # React 19 + Vite 7
│   ├── components/
│   │   ├── chat/              # ChatInterface, PatientAvatar
│   │   ├── monitor/           # PatientMonitor, EventLog
│   │   ├── examination/       # BodyMap, ManikinPanel
│   │   ├── investigations/    # Lab + Radiology results modals
│   │   ├── orders/            # OrdersDrawer
│   │   ├── treatments/        # TreatmentPanel, ActiveEffectsIndicator
│   │   ├── analytics/tna/     # TNA dashboard (NetworkGraph, ClusterPanel, …)
│   │   └── settings/          # ConfigPanel + per-tab editors (LLM, voice, avatars, agents, …)
│   ├── notifications/         # Central NotificationCenter
│   ├── services/              # AgentService, voiceService, eventLogger, PatientRecord, TreatmentEffects
│   ├── contexts/              # Auth, Toast, Voice
│   └── data/                  # scenarioTemplates, labPanelTemplates
├── public/avatars/heads/      # 28+ GLB avatars + manifest.json
├── kits/talking-avatars/      # Standalone, embeddable voice + avatar kit
├── scripts/rocketbox-convert/ # GLB pipeline for adding new avatars
├── docs/                      # Documentation
├── Lab_database.json          # 77+ lab tests
└── DEMO_ALARM_CASE.json       # Sample case
```

---

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 19, Vite 7, TailwindCSS 4, Lucide icons, Three.js 0.184, @react-three/fiber 9, @react-three/drei 10, wawa-lipsync |
| Backend | Node 18+, Express 5, SQLite 3 (`sqlite3` async API), JWT, bcrypt, multer, express-rate-limit |
| TTS | Piper (local CLI), Kokoro (`kokoro-js`, in-process), Google Cloud TTS, OpenAI TTS |
| LLM | Anthropic Claude, OpenAI, Google, LM Studio, Ollama (proxied through `/api/proxy/llm`) |
| Analytics | [`tnaj`](https://github.com/mohsaqr/tna-js) (`tna`, `clusterSequences`, `centralities`) |

---

## Configuration

All runtime configuration lives in **Platform Settings** (admin-only) and is persisted in the `platform_settings` table. Nothing model- or voice-specific is hardcoded in the client.

Categories:
- **LLM** — provider, API key, default model, temperature, system-prompt overrides per agent
- **Voice** — TTS provider, per-(provider, gender) voice ID, speech rate, language
- **Avatars** — default avatar per gender, framing, mute toggles
- **Monitor** — alarm thresholds, audio patterns, pulse oximeter behavior
- **Chat** — message window, streaming, stage-direction stripping
- **Rate limits** — per-user and platform-wide caps
- **Notifications** — routing matrix, mute hierarchy, severity threshold

Environment (`server/.env`):

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | Server refuses to start without it |
| `JWT_EXPIRY` | no | Default `4h` |
| `PORT` | no | Default `3000`, falls through to next free port |
| `NODE_ENV` | no | `production` disables seeded default users (override with `ALLOW_DEFAULT_USERS=1`) |
| `FRONTEND_URL` | prod | Allowed CORS origin |

---

## Documentation

| Document | Description |
|---|---|
| [Documentation index](docs/README.md) | Full doc map |
| [Quick start](docs/getting-started/quickstart.md) | 3-minute setup walkthrough |
| [Authentication](docs/getting-started/authentication.md) | Users, roles, JWT |
| [Architecture](docs/reference/architecture.md) | System architecture and data flow |
| [System reference](docs/reference/system-documentation.md) | Complete API and DB schema |
| [Laboratory system](docs/guides/laboratory-system.md) | Lab tests, panels, gender ranges |
| [Scenario system](docs/guides/scenario-system.md) | Timeline-based deterioration |
| [Scenario selector](docs/guides/scenario-selector.md) | Choosing scenario templates |
| [Monitor settings](docs/guides/monitor-settings.md) | Vitals and alarm configuration |
| [ECG patterns](docs/guides/ecg-patterns.md) | Clinical ECG reference |
| [Clinical features](docs/guides/clinical-features.md) | Alarms, events, investigations |
| [Logging](docs/guides/logging-system.md) | Event tracking and CSV export |
| [Import/Export](docs/guides/import-export.md) | JSON case and settings management |
| [Alarm demo](docs/guides/alarm-demo.md) | Sample case for alarm testing |
| [Talking-Avatars Kit](kits/talking-avatars/README.md) | Embeddable voice + avatar kit |

---

## Development

```bash
npm run dev        # frontend (Vite) + backend (node --watch) concurrently
npm run client     # frontend only
npm run server     # backend only
npm run lint       # ESLint
npm run build      # production build, outputs to frontend/ via dist/
npm run production # run prebuilt server
```

Development tips:
- Vite dev server proxies `/api` → `http://localhost:3000`.
- Reset DB: stop the server, delete `server/rohy.db`, restart — seeders re-run automatically.
- Adding a TTS provider: implement an async-iterator service under `server/services/` mirroring `kokoroTts.js`, register it in the `/api/tts` route, and add a UI tab under `src/components/settings/VoiceSettingsTab.jsx`.
- Adding an avatar: drop a viseme-rigged GLB in `public/avatars/heads/`, append to `manifest.json`. The `scripts/rocketbox-convert/` pipeline handles RocketBox source models.

---

## Production

```bash
npm run build
NODE_ENV=production node server/server.js
```

The build copies `dist/` into `frontend/`, which Express serves statically alongside the API.

Production checklist:
- [ ] Strong, unique `JWT_SECRET`
- [ ] HTTPS terminator in front (nginx, Caddy, …)
- [ ] `FRONTEND_URL` set so CORS allows only your origin
- [ ] Default seeded users disabled (default in `NODE_ENV=production`)
- [ ] SQLite database backups
- [ ] Rate limits reviewed in Platform Settings → Rate limits
- [ ] LLM API keys scoped to this app

A sample deploy script is at `production/deploy.sh`.

---

## Roles

**Trainee (`user`)**
- Run sessions, talk to the patient (text or voice), order labs/radiology/treatments, examine, view own session history.

**Instructor (`admin`)**
- Everything above, plus: create/edit cases, configure agents and avatars, edit vitals/labs in real time, manage users, full analytics + exports, audit log, platform settings.

---

## Author

**Mohammed Saqr** — Professor of Computer Science, University of Eastern Finland
[www.saqr.me](https://www.saqr.me)

## License

MIT — see [LICENSE](LICENSE).
