# Module Inventory — 2026-05-03

Snapshot of every module reviewed in the deep-review pass on `feat/voice-avatars`. Companion to `deep-review-2026-05-03.md` — that file lists findings, this one is the navigation index.

Counts at review time:

- **Client**: 107 files (`src/**/*.{js,jsx}`)
- **Server**: 13 files (`server/**/*.js`)
- **Total LOC**: ~50,700

Two files were deleted in this pass (see end). Line counts below reflect post-fix state.

---

## 1. Server foundation

| File | LOC | Purpose |
|---|---:|---|
| `server/server.js` | 200 | Express bootstrap, CORS, port-fallback listener, voice-key migration, Kokoro warmup |
| `server/db.js` | 2315 | Schema (45+ tables), inline `PRAGMA table_info` migrations, `seedDefaultAgents`, `seedDefaultTreatmentEffects`, default platform-settings + agent-avatar backfill |
| `server/middleware/auth.js` | 67 | JWT verify (`authenticateToken`), `requireAdmin`/`requireAuth`, `generateToken` (default TTL now 4h) |
| `server/seeders/index.js` | 83 | Top-level seeder runner, gated by `needsSeeding` (zero-users check) |
| `server/seeders/users.js` | 96 | `admin`/`student` defaults — now refused in `NODE_ENV=production` unless `ALLOW_DEFAULT_USERS=1` |
| `server/seeders/cases.js` | 574 | Representative clinical cases (STEMI, etc.) |

## 2. Server routes (`server/routes.js`, ~9120 LOC after fixes, 199 endpoints)

Section map:

| Section | Approx lines | Endpoints |
|---|---|---|
| Helpers + `verifySessionOwnership` (NEW) | 60-220 | (helper) |
| Multer config (default + body-image, split) | 220-290 | (helper) |
| Auth | 290-680 | `/auth/*`, `/users/{create,batch}` |
| Uploads | 680-770 | `/upload`, `/upload-body-image`, `/bodymap-regions` |
| Cases | 770-960 | `/cases` (CRUD + availability/default toggles) |
| Sessions + interactions | 960-1280 | `/sessions`, `/interactions`, analytics |
| Settings logs + exports | 1280-1700 | `/settings/log`, `/export/*` |
| Event log | 1700-1800 | `/events/batch` (now ownership-checked), `/sessions/:id/events` (now ownership-checked) |
| Learning analytics | 1800-2150 | `/learning-events/*` (POST + batch now ownership-checked) |
| Alarms + notification prefs | 2150-2370 | `/alarms/log` (now ownership-checked), `/notification-prefs` (now schema-validated + size-capped) |
| Investigations + labs + radiology | 2370-3640 | bulk |
| Treatments | 3640-4150 | orders, administer, discontinue, active-effects |
| LLM proxy | 4170-4710 | `/proxy/llm` (streaming + non-streaming). Note: still does not strictly verify `session_id` ownership before loading per-session settings — see deep-review §2 |
| Scenarios + repository | 4710-5030 | `/scenarios/*`, `/master/scenario-templates` |
| Physical exam, audit, prefs | 5030-5260 | `/sessions/:id/exam-findings` (POST + GET ownership-checked), `/admin/audit-log`, `/users/preferences` |
| Vitals + notes | 5260-5400 | `/sessions/:id/{vitals,notes}` (POST + GET ownership-checked) |
| Admin (export records, active sessions, db stats) | 5400-5500 | `/admin/*` |
| Master data | 5500-5950 | `/master/*` |
| Platform settings | 5950-6890 | `/platform-settings/*`, `/llm/models`, `/llm/usage` |
| TTS | 6890-7460 | `/tts`, `/tts/voices`, `/tts/usage` |
| LLM usage + pricing | 7460-7600 | `/llm/{usage,pricing}` |
| Patient record memory | 7600-7860 | `/patient-record/*` — **all 5 routes now `authenticateToken` + `verifySessionOwnership`** |
| Multi-agent system | 7860-8810 | `/agents/templates/*`, `/cases/:id/agents/*`, `/sessions/:id/agents/*`, `/team-communications` |
| TNA analytics | 8890-9015 | `/analytics/tna-sequences` |
| Emotion + questionnaire | 9015-end | `/emotion-logs`, `/questionnaire-responses` |

## 3. Server services

| File | LOC | Purpose |
|---|---:|---|
| `server/services/kokoroTts.js` | 120 | Kokoro-82M ONNX (q4) loader + sentence-streamed PCM iterator |
| `server/services/googleTts.js` | 186 | Google Cloud TTS (Chirp 3 HD/Neural2), strips RIFF wrapper, headphone EQ profile |
| `server/services/openaiTts.js` | 154 | OpenAI `tts-1` PCM streaming |
| `server/services/voiceFallbacks.js` | 34 | Last-chance voice fallback per provider × gender |
| `server/services/wav.js` | 36 | `buildWavHeader`, `float32ToInt16Buffer` |
| `server/services/labDatabase.js` | 533 | In-memory lab catalogue from `Lab_database.json` + `heart.txt` |

## 4. Notifications system (`src/notifications/`)

| File | LOC | Purpose |
|---|---:|---|
| `types.js` | 44 | `SOURCES`, `SEVERITIES`, `SURFACES`, `AUDIO_PATTERNS`, `severityRank` |
| `defaults.js` | 101 | `DEFAULT_ROUTING` matrix, `DEFAULT_TTL_MS`, `DEFAULT_PREFS`, `HISTORY_CAP` |
| `routing.js` | 86 | `routeNotification`, `deriveKey`, `hashString` |
| `persistence.js` | 108 | localStorage + `/api/notification-prefs` sync |
| `NotificationContext.jsx` | 392 | Provider, `notify`, `resolve`, `ack`, `snooze`, `pause`, `resume`, `subscribe`, expiry effect |
| `NotificationContextObject.js` | 5 | Bare `createContext(null)` for HMR rule |
| `useNotifications.js` | 11 | Hook |
| `externalApi.js` | 8 | Module-level bridge for non-React producers |
| `surfaces/ToastSurface.jsx` | 78 | Bottom-right cards, hover-pause, click-anywhere-dismiss |
| `surfaces/BannerSurface.jsx` | 56 | Top sticky banner for clinical critical |
| `surfaces/AudioSurface.jsx` | 139 | Single oscillator, global gesture listener |
| `surfaces/BackendSurface.js` | 165 | Bounded queue (500 cap); now maps notification severities → schema-allowed `learning_events.severity` and picks a whitelisted verb |
| `surfaces/ConsoleSurface.js` | 33 | Colour-tagged console |
| `surfaces/HistorySurface.jsx` | 68 | Embeddable rolling-history list |

## 5. Client utils

| File | LOC | Purpose |
|---|---:|---|
| `resolveAvatar.js` | 30 | Avatar resolution: explicit → platform default by gender → demographic hash → fallback |
| `avatarFraming.js` | 27 | Camera resolve + slider patch merge |
| `parseConfig.js` | 9 | JSON-or-object normaliser |
| `stageDirections.js` | 18 | Strips `*action*` blocks |
| `visemes.js` | 14 | `VISEME_KEYS` (15 Oculus visemes) — single source of truth |
| `sentenceSplit.js` | 95 | Streaming-safe sentence boundary detector with abbreviation/decimal handling |
| `sentenceSplit.test.js` | 97 | `node --test` |
| `voiceFallbacks.js` | 17 | Client mirror of server file (drift risk noted) |
| `defaultRegions.js` | 1300+ | Polygon coords for body map |
| ~~`alarmAudio.js`~~ | — | **DELETED 2026-05-03** — superseded by AudioSurface |

## 6. Contexts

| File | LOC | Purpose |
|---|---:|---|
| `AuthContext.jsx` | 87 | `<AuthProvider>`, `useAuth`, login/register/logout/isAdmin |
| `VoiceContext.jsx` | 45 | Voice mode state, visemes, headManifest, platformAvatars, activeParticipant |
| `ToastContext.jsx` | 114 | Backwards-compat shim over NotificationCenter; `ConfirmModal` |
| `ToastContextObject.js` | 5 | HMR-rule split |
| `useToast.js` | 10 | Hook |

## 7. Client services

| File | LOC | Purpose |
|---|---:|---|
| `authService.js` | 128 | `login/register/verifyToken/getProfile/logout/getToken/authHeaders` |
| `voiceService.js` | 408 | STT (`SpeechRecognition`) + TTS (`/tts` PCM streaming) + wawa-lipsync analyser |
| `llmService.js` | 281 | `sendMessage` (non-streaming), `streamMessage` (SSE deltas, 60s idle watchdog), usage |
| `eventLogger.js` | 370 | xAPI verb taxonomy (130+ methods), routes via `getExternalApi()` |
| `AgentService.js` | 762 | Multi-agent template + case-agent + session-agent CRUD |
| `PatientRecord/PatientRecord.js` | 618 | 8-verb event log, in-memory record |
| `PatientRecord/PatientRecordContext.jsx` | 286 | React provider |
| `PatientRecord/patientRecordSync.js` | 200 | DB sync — now sends `Authorization: Bearer …` on every call |
| `TreatmentEffects/TreatmentEffectsEngine.js` | 206 | Onset/peak/decline pharmacokinetic model |

## 8. Hooks

| File | LOC | Purpose |
|---|---:|---|
| `useAlarms.js` | 236 | Vitals → notify(); thresholds load + save; legacy public shape preserved |
| `useTreatmentEffects.js` | 152 | Polls `/active-effects`, computes per-tick effect aggregate |
| ~~`useEventLog.js`~~ | — | **DELETED 2026-05-03** — duplicate of EventLogger; three call sites in PatientMonitor migrated to `EventLogger.vitalAdjusted` / `EventLogger.buttonClicked` |

## 9. Avatar / chat

| File | LOC | Purpose |
|---|---:|---|
| `chat/ChatInterface.jsx` | 1377 | Streaming LLM → per-sentence TTS dispatch, mic, agent tabs |
| `chat/PatientAvatar.jsx` | 195 | Three.js GLB head, viseme-driven morph driver, blink loop |
| `patient/PatientVisual.jsx` | 80 | Lazy-loads PatientAvatar, derives participant |

## 10. Monitor

| File | LOC | Purpose |
|---|---:|---|
| `monitor/PatientMonitor.jsx` | ~2188 | ECG (sum-of-Gaussians, Atterhög/Fridericia intervals), pleth, resp, jitter, scenario engine. Scenario engine now reads `params`/`conditions` via refs (`simulationParams`, `conditionsRef`) to keep the 1s tick stable |
| `monitor/EventLog.jsx` | 200 | Polls `/sessions/:id/events` every 10s |

## 11. Examination

| File | LOC | Purpose |
|---|---:|---|
| `examination/BodyMap.jsx` | 219 | Polygon-region overlay, localStorage cache then server fallback |
| `examination/BodyMapDebug.jsx` | 332 | Admin polygon editor (now gated to `import.meta.env.DEV` via App.jsx) |
| `examination/ManikinPanel.jsx` | 400 | Top-level physical exam UI |
| `examination/AuscultationPanel.jsx` | 321 | Heart/lung audio playback at anatomical points |
| `examination/ExamLog.jsx` | 98 | List of performed exams |
| `examination/ExamTypeSelector.jsx` | 100 | UI control |
| `examination/FindingDisplay.jsx` | 104 | UI control |

## 12. Investigations

| File | LOC | Purpose |
|---|---:|---|
| `investigations/InvestigationPanel.jsx` | 546 | Lab order picker |
| `investigations/LabResultsModal.jsx` | 391 | Lab results view |
| `investigations/RadiologyResultsModal.jsx` | 374 | Radiology results view |
| `investigations/ResultsModal.jsx` | 219 | Generic results modal |
| `investigations/LabValueEditor.jsx` | 311 | Inline value editing |
| `investigations/ClinicalRecordsPanel.jsx` | 342 | Records browser |

## 13. Orders & treatments

| File | LOC | Purpose |
|---|---:|---|
| `orders/OrdersDrawer.jsx` | 1300 | Bottom drawer: labs / radiology / drugs / records tabs (refactor candidate) |
| `treatments/TreatmentPanel.jsx` | 650 | Medication / IV fluid / oxygen / nursing intervention orders |
| `treatments/ActiveEffectsIndicator.jsx` | 224 | Real-time effect summary tile |

## 14. Settings / admin

| File | LOC | Purpose |
|---|---:|---|
| `settings/ConfigPanel.jsx` | 5148 | God-file (refactor candidate, deferred) |
| `settings/AgentTemplateManager.jsx` | 944 | Agent persona CRUD |
| `settings/AvatarsSettingsTab.jsx` | 494 | Per-gender persona defaults + per-agent assignment + gallery |
| `settings/AvatarFraming.jsx` | 66 | Camera framing sliders |
| `settings/CaseAvatarVoicePicker.jsx` | 324 | Per-case avatar+voice override editor |
| `settings/CaseTreatmentConfig.jsx` | 410 | Case-specific treatment availability/expectation |
| `settings/ClinicalRecordsEditor.jsx` | 547 | Records authoring |
| `settings/LabInvestigationEditor.jsx` | 1247 | Lab catalogue editor |
| `settings/LabTestManager.jsx` | 754 | Lab test CRUD |
| `settings/MedicationManager.jsx` | 467 | Medication CRUD |
| `settings/MedicationSearch.jsx` | 206 | Search box |
| `settings/NotificationsSettingsTab.jsx` | 304 | DND, mutes, snooze duration, audio tuning, history |
| `settings/PhysicalExamEditor.jsx` | 514 | Per-region/exam-type finding authoring |
| `settings/RadiologyEditor.jsx` | 603 | Radiology study authoring |
| `settings/ScenarioRepository.jsx` | 875 | Reusable scenario timelines |
| `settings/TestVoiceButton.jsx` | 152 | Voice preview |
| `settings/UserProfilePanel.jsx` | 661 | Self-service profile + password change |
| `settings/VoiceSettingsTab.jsx` | 653 | Provider, voice picker, rate/pitch sliders |

## 15. Analytics / TNA

| File | LOC | Purpose |
|---|---:|---|
| `analytics/SessionLogViewer.jsx` | 897 | Session-scoped event timeline + filter UI |
| `analytics/tna/TnaDashboard.jsx` | 414 | Top-level dashboard |
| `analytics/tna/NetworkGraph.jsx` | 396 | Force-directed transition network |
| `analytics/tna/DistributionPlot.jsx` | 156 | Cluster distribution |
| `analytics/tna/IndexPlot.jsx` | 132 | Per-cluster centrality indices |
| `analytics/tna/FrequencyChart.jsx` | 82 | Verb-frequency bars |
| `analytics/tna/CentralityChart.jsx` | 76 | Per-state centrality |
| `analytics/tna/ClusterPanel.jsx` | 76 | Cluster selector |
| `analytics/tna/tnaUtils.js` | 133 | Pure compute (`tna`, `prune`, `clusterSequences`) |
| `analytics/tna/tnaColors.js` | 46 | Cluster colour palette |

## 16. Auth / common / app

| File | LOC | Purpose |
|---|---:|---|
| `App.jsx` | ~648 | Top-level provider stacking, session restore. `?debug=bodymap` flag now gated on `import.meta.env.DEV`; bodymap-debug branch extracted into `<BodyMapDebugApp>` so its hooks aren't conditional. `showRegister` `useState` moved above any conditional return |
| `main.jsx` | 10 | `<StrictMode>` mount |
| `auth/LoginPage.jsx` | 129 | Login form |
| `auth/RegisterPage.jsx` | 223 | Register form |
| `common/EndSessionQuestionnaire.jsx` | 466 | Post-session reflection (hardcoded chest-pain differential) |
| `common/UsageIndicator.jsx` | 95 | LLM quota chip |
| `PatientRecordViewer.jsx` | 461 | Read-only record view |

---

## Modules removed in this pass (2026-05-03)

| Path | Reason |
|---|---|
| `src/utils/alarmAudio.js` | Superseded by `notifications/surfaces/AudioSurface.jsx`; PatientMonitor:9 comment had already noted it was unused |
| `src/hooks/useEventLog.js` | Duplicated `EventLogger.log()` while bypassing NotificationCenter and re-queueing failed events without bound |

## Out-of-scope subtrees

These were not part of the 2026-05-03 review and may be covered by separate inventories:

- `medkit-app/` — sibling app (FastAPI + Tauri/React); inventoried in the prior 2026-05-03 review.
- `kits/talking-avatars/` — portable bundle of the avatar/voice/TTS pipeline (~73 files); changes here usually mirror `src/` and `server/services/`.
- `scripts/rocketbox-convert/` — RocketBox GLB conversion pipeline.
- `production/deploy.sh` — out of JS lint scope.
