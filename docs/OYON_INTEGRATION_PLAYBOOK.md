# Oyon Integration Playbook

> The how-to-replicate companion to `OYON_INTEGRATION_POLICY.md` (boundaries) and
> `OYONR_INTEGRATION_NOTE.md` (history). This doc walks through what was built,
> file by file, and ends with a generalized checklist so the same pattern can be
> applied to the next third-party JS library you ingest.

**Scope.** Three concrete integration surfaces, in order of visibility:

1. **The pill** — the live emotion widget that runs in the chat sidebar.
2. **The logs** — server-side persistence of windowed emotion records, plus the admin viewer that surfaces them.
3. **The custom settings** — per-tenant runtime configuration (model profile, sample interval, aggregation knobs) editable from the admin UI.

Each section follows the same shape: *what it is → where it lives → how it works → what was non-obvious → the general principle to take away.*

---

## 0. The integration architecture (one minute)

```
┌────────────────────────────────────────────────────────────────────┐
│  Vendored upstream library                                         │
│  OyonR/                                                            │
│    src/core/EmotionRuntime.js     ← ONNX + MediaPipe orchestrator  │
│    standalone/                    ← demo HTML/JS that proves the   │
│                                     library works in isolation     │
│    standalone/vendor/             ← MediaPipe + ONNX wasm bundles  │
│                                     (gitignored, fetched at install│
│                                      via OyonR/scripts/download-   │
│                                      models.sh)                    │
│    standalone/models/             ← *.onnx weights (gitignored)    │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ npm dep: "oyon": "file:./OyonR"
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  Adapter layer (Rohy ↔ Oyon glue)                                  │
│  scripts/update-oyonr.sh        ← rsync upstream → OyonR/          │
│                                   (excludes /standalone/vendor)    │
│  scripts/oyon-overlay/          ← full-file overlays of the few   │
│                                   upstream files Rohy patches      │
│  scripts/apply-oyon-patches.mjs ← idempotent applicator, runs      │
│                                   after every npm run oyon:update  │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  Application layer (Rohy proper)                                   │
│  Server                                                            │
│    server/routes/oyon-routes.js          ← /api/addons/oyon/*      │
│    migrations/0011..0017_oyon_*.sql      ← additive schema only    │
│    server/security-headers.js            ← COOP + COEP for SAB     │
│  Client                                                            │
│    src/components/oyon/OyonCaptureWidget.jsx   ← the pill          │
│    src/components/oyon/modelProfiles.js        ← model registry    │
│    src/components/oyon/clientLogger.js         ← [oyon] tag        │
│    src/components/settings/OyonSettingsTab.jsx          ← admin UI │
│    src/components/settings/OyonLearningAnalyticsTab.jsx ← viewer   │
│  Build / deploy                                                    │
│    package.json postinstall              ← auto-fetch binaries     │
│    deploy/docker/Dockerfile              ← explicit RUN download   │
│    deploy/docker/Caddyfile               ← /oyon/* /standalone/*   │
└────────────────────────────────────────────────────────────────────┘
```

The key idea: **vendored upstream stays untouched**, **a thin adapter layer exists for the inevitable patches**, **the application talks to the library through one and only one entry point** (`import { EmotionRuntime } from 'oyon'`), and **deploy is fully self-contained** (postinstall + Dockerfile RUN handle the binaries that are too large to git-track).

For the ownership boundaries, see `OYON_INTEGRATION_POLICY.md`. The summary: Oyon failures must never propagate; if Oyon's env flag is off, schema mis-migrated, model assets missing, or a route throws, **Rohy keeps running**.

---

## 1. The pill (live emotion widget)

### What it is

A small badge that mounts in the chat sidebar showing the patient's (camera-derived) dominant emotion in real time. Updates ~3 Hz under normal load, with a confidence bar and a 4-letter label like `HAPPY` / `SAD` / `ANGER` / `NEUT`.

### Where it lives

| File | Purpose |
|---|---|
| `src/components/oyon/OyonCaptureWidget.jsx` | The component itself + the `CaptureSession` lifecycle wrapper |
| `src/components/oyon/clientLogger.js` | `oyonClientLog('debug'\|'info'\|'warn'\|'error', ...)` — single source of structured client logging |
| `src/components/oyon/modelProfiles.js` | Model registry (HSE / MobileViT / MBF) — the *only* file that knows model identifiers |
| `OyonR/src/core/EmotionRuntime.js` | The vendored runtime; orchestrates ONNX + MediaPipe + smoothing |

### How it works

```
mount
  └─→ fetch /api/addons/oyon/config            (tenant's runtime config)
        └─→ new CaptureSession({ runtimeConfig })
              └─→ preloadModels()              (downloads ~40 MB ONNX into the browser)
                    └─→ new EmotionRuntime({ ... })
                          └─→ runtime.start()
                                ├─→ emits 'sample' every sample_interval_ms (~333 ms)
                                │     └─→ React state setEmotion(topLabel(probabilities))
                                │           └─→ pill re-renders with the new label
                                └─→ emits 'window' every aggregate_window_ms (~10 s)
                                      └─→ POST /api/addons/oyon/emotion-records
unmount
  └─→ session.stop()
        └─→ runtime.dispose()                  (releases ONNX + MediaPipe + nulls refs)
```

`OyonCaptureWidget.jsx:137-216` is where the React side glues this together. The component is intentionally small (~250 LOC); all heavy lifting is in `CaptureSession` (a non-React class declared at the top of the same file) and in the vendored `EmotionRuntime`.

### Non-obvious bits

- **Tenant config arrives BEFORE runtime init.** The widget fetches `/api/addons/oyon/config.runtime` first, then constructs `EmotionRuntime` with the saved model profile, sample interval, window length, smoothing, hold, and switch confidence. Earlier code only forwarded `model + sample_interval_ms`; the result was that captured windows silently diverged from the admin's saved knobs. Forward the *full* runtime config or you create a phantom-config bug.
- **Pill cadence comes from `sample` events, not `window` events.** Earlier code read `p.dominant` from the sample — a field the runtime never emits. The displayed word only updated when a 10 s `window` event arrived. Fix: derive the pill label from `topLabel(p.probabilities)` per `sample`. **Lesson: when one displayed field lags but its neighbours update fluidly, suspect the fields come from different event streams, not different cadences.**
- **`stop()` ≠ `dispose()`.** `EmotionRuntime.stop()` keeps ONNX + MediaPipe alive so a restart is cheap. `dispose()` actually frees the WebGPU/WASM resources. The widget calls `dispose()` in its unmount path so repeated session/case switches don't accumulate GPU memory. **General rule: when a vendor library distinguishes pause from teardown, every consumer of the pause path must consider whether it should actually be calling teardown.**
- **Consent is opt-in.** `localStorage['oyon.defaultConsent']` gates the `POST /consent` call. Capture still runs locally without consent (the user sees the live preview / live pill), but nothing is persisted. Earlier code blindly POSTed `consent_granted: true` because "Rohy auth implies consent" — that's a category error: auth ≠ consent.
- **Live changes to settings re-key the widget.** When the admin changes a runtime knob in `OyonSettingsTab`, that tab dispatches a `oyon:setting-changed` window event. The widget listens for this (and for cross-tab `storage` events) and re-fetches `/config.runtime`, which triggers a clean re-init via React's effect dependency array. This is the canonical single-source-of-truth pattern in this integration.

### General principle

> **The "integration entry point" should be one file, and that file should be the only place in your application that knows about the vendor library's class names.** For Oyon that file is `OyonCaptureWidget.jsx` — `import { EmotionRuntime } from 'oyon'` appears nowhere else. If you need to swap `EmotionRuntime` for `EmotionRuntime2`, you change one line. If you have ten components each instantiating the runtime, you've already lost.

---

## 2. The logs (server persistence + viewer)

### What it is

Every `window` event the runtime emits is POSTed to the server, persisted in `oyon_emotion_records`, and surfaced in two places:

1. **The Chat Log tab** (admin-only, `src/components/analytics/ChatLogTable.jsx`) — Oyon emotion records appear inline alongside chat messages and LLM/TTS events with `source: oyon`.
2. **The dedicated Oyon Learning Analytics tab** (`src/components/settings/OyonLearningAnalyticsTab.jsx`) — emotion-only timeline, with consent records and per-window aggregates.

### Where it lives

| File | Purpose |
|---|---|
| `migrations/0011_oyon_addon.sql` | Initial schema: `oyon_settings`, `oyon_emotion_consents`, `oyon_emotion_records`. Additive only. |
| `migrations/0014_oyon_records_nullable_user.sql` | Schema follow-up. |
| `migrations/0016_oyon_records_unique_record_id.sql` | Partial unique index for idempotency (see below). |
| `migrations/0017_oyon_records_window_metadata.sql` | Adds `window_ms`, `min_valid_frames`, `smoothing_alpha`, `min_hold_ms`, `min_switch_confidence` snapshot columns. |
| `server/routes/oyon-routes.js` | `POST /api/addons/oyon/emotion-records` and `POST /api/addons/oyon/consent`. |
| `src/components/analytics/ChatLogTable.jsx` | Unified Chat Log feed; reads `/api/chat-log/feed` which UNIONs Oyon emotion records into the timeline. |
| `src/components/settings/OyonLearningAnalyticsTab.jsx` | Dedicated Oyon-only viewer. |

### How it works

**The write path:**

```
client                                              server
  CaptureSession (10 s window expires)
    aggregator emits 'window' event
      └─→ POST /api/addons/oyon/emotion-records
          { session_id, window_start, window_end,
            dominant_emotion, probabilities, settings_snapshot }
                                                    │
                                                    ▼
                                           insertEmotionRecord()
                                             ├─ derive record_id =
                                             │    sha1(tenant|session|
                                             │         window_start|window_end)
                                             ├─ INSERT ... ON CONFLICT DO NOTHING
                                             │    (partial unique index from 0016)
                                             └─ return { ok, inserted, skipped }
```

**The read path** — UNION through the existing chat-log feed at `server/routes/analytics-routes.js:/chat-log/feed`. Oyon emotion records share the same row shape as every other source:

```sql
SELECT 'oyon' AS source, recorded_at AS ts, user_id, username,
       session_id, NULL AS role, dominant_emotion AS content,
       NULL AS model, NULL AS tokens_in, NULL AS tokens_out,
       NULL AS latency_ms
FROM oyon_emotion_records
WHERE tenant_id = ?
```

The viewer doesn't know or care that this row came from Oyon vs. an LLM call vs. a chat message — it just renders the `source` chip with the right colour.

### Non-obvious bits

- **Server-derived `record_id` killed the silent-replay bug.** The first idempotency fix added a partial unique index + `ON CONFLICT DO NOTHING` and a happy-path test — but the runtime/widget never set `record_id`, so the index was dormant for every real window. Fix: derive `record_id = sha1(tenant|session|window_start|window_end)` server-side. Replays from the runtime now collapse automatically; no client change required. **General principle: when adding an index/constraint, check the *producer* of the constrained field actually populates it, not just that the constraint mechanically engages.**
- **`consent_version` is server-authoritative.** The client may send a `consent_version` field, but the server ignores it and stamps the version from `oyon_settings.consent_version`. This prevents a stale tab from recording "consent granted under v3" when the deployment has moved to v4 with a more restrictive scope.
- **Ownership check is `req.user.id === session.user_id`.** Educators/admins can read any session in their tenant (per Rohy's `canReadAcrossUsers` rule), but they cannot *write* consent or emotion records on behalf of students. Read paths and write paths use different authorization rules; do not blindly reuse one for the other.
- **Vitals + emotions ride along the same trinity.** Every Oyon record is keyed on `(tenant_id, session_id, user_id)` — the same trinity the server enforces on `learning_events` (see `PLAN_LOGGING.md`). This means an admin filtering the activity feed by `user_id=42` sees that user's emotion records appear alongside their clinical actions, with no extra JOIN.
- **Express 5 auto-propagates async throws.** `oyon-routes.js` leans on this with one error-handler `router.use((err, ...))` that translates `no such table` into 503 and everything else into 500. No per-route try/catch noise. Other route files are migrating to the same pattern.

### General principle

> **Persistence layer for an integration should look like every other persistence layer in your app.** If your existing logs are keyed on `(tenant_id, session_id, user_id)` and joined with `users`/`cases` for display, the integration's table should be the same shape and the integration's read endpoint should produce the same row shape (`source`, `ts`, `user_id`, `username`, …) as the other feeds. The viewer then UNIONs them transparently. Don't invent a separate `OyonAnalyticsView` with its own column conventions when the existing log infrastructure can carry the rows for free.

---

## 3. The custom settings (per-tenant runtime config)

### What it is

An admin-only tab in Settings → Oyon → Capture Engine, exposing one model dropdown plus six numeric knobs (sample interval, window length, min valid frames, smoothing α, min hold, switch confidence). Saving the form persists into `oyon_settings` and broadcasts a `oyon:setting-changed` event so any open widget re-initialises with the new values.

### Where it lives

| File | Purpose |
|---|---|
| `migrations/0012_oyon_settings_runtime.sql` | Adds the seven runtime columns to `oyon_settings`. |
| `migrations/0013_oyon_settings_default_interval.sql` | Bumps existing rows from `sample_interval_ms = 1000` → `333`. |
| `migrations/0015_oyon_settings_safer_default.sql` | Schema-level `DEFAULT` follow-up so fresh tenants don't regress. |
| `server/routes/oyon-routes.js` | `GET /settings`, `PUT /settings` (admin-only), `GET /config` (returns a `runtime` block). |
| `src/components/settings/OyonSettingsTab.jsx` | The admin form. |
| `src/components/oyon/modelProfiles.js` | Single source of truth for the model registry. |

### How it works

```
admin opens Settings → Oyon                          server
  GET /api/addons/oyon/settings
      └─→ ensureSettings(tenantId)                   ──── ► returns full row,
                                                            DEFAULTs from
                                                            DEFAULT_RUNTIME
                                                            constant
admin edits "sample_interval_ms" → 500
admin clicks Save
  PUT /api/addons/oyon/settings { sample_interval_ms: 500, … }
      └─→ clamp + validate + UPDATE oyon_settings
admin form dispatches `oyon:setting-changed`
  └─→ any open OyonCaptureWidget refetches /config and re-inits
```

### Non-obvious bits

- **`ensureSettings` must INSERT every field from a single source-of-truth constant.** Earlier code relied on column-level `DEFAULT` to fill in missing values. When migration 0013 patched existing rows but column DEFAULT still pointed at the old value, fresh tenants kept getting the laggy default. Fix: `INSERT INTO oyon_settings (...) VALUES (?, ?, ?, ...)` from the `DEFAULT_RUNTIME` constant explicitly. **General principle: column DEFAULTs are fragile across migrations. Either INSERT every field explicitly from a single source-of-truth constant, or update the column DEFAULT in the same migration that updates the rows.**
- **The model registry has exactly one home.** `src/components/oyon/modelProfiles.js` is imported by both the miniature widget and the admin dropdown. Earlier the miniature hardcoded `HSE_EMOTION_MTL_CONFIG`, the standalone defaulted to `'hse-emotion-mtl'`, and the admin had no dropdown — three sources, zero coordination. **General principle: when N surfaces need to choose from the same set, the set is one module. Importing it everywhere is fine; defining it everywhere is not.**
- **Per-tenant config requires a migration even when "additive" feels enough.** Adding a runtime knob means: column in 0012, default-bump in 0013 if you change semantics, schema DEFAULT update in 0015 if 0013 only patched rows. Schema migrations to `oyon_settings` are *additive only* (per the integration policy) — never `DROP COLUMN` or `RENAME COLUMN` because Rohy can roll back to an older app version against a newer DB.
- **The standalone demo locks its own dropdown.** When Oyon's standalone demo runs *inside* Rohy (`?source=rohy`), `applyRohyTenantConfig()` overrides the demo's local model dropdown and disables it. This prevents an operator from drifting the model in the embedded demo while the tenant has chosen something else.

### General principle

> **Custom settings are infrastructure, not configuration.** Treat the settings table as the contract between every consumer of the integration. If three surfaces (miniature, standalone, admin) need to know the model, the table is the source. If a setting can drift between surfaces, you have a bug latent in the design — not a UX papercut.

---

## 4. Cross-cutting concerns

These don't belong to any one of the three pieces, but every integration of this shape eventually faces them.

### 4.1 Cross-origin isolation (COOP + COEP)

Oyon's emotion model runs on multi-threaded WASM via ONNX Runtime. Multi-threaded WASM needs `SharedArrayBuffer`. `SharedArrayBuffer` is gated behind `crossOriginIsolated`, which requires both:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

Both are set in `server/security-headers.js:91-92` (production) and `vite.config.js:20-21` (dev). Without these, ONNX silently falls back to single-threaded WASM — 5–10× slower, no fatal error. Verify with this in DevTools console:

```js
crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
```

`COEP: credentialless` is the safer choice over `require-corp` because it strips credentials from cross-origin subresources instead of demanding every cross-origin asset ship a CORP header. Third-party fonts/images that don't ship CORP would break the page under `require-corp`.

### 4.2 CSRF for the standalone demo

The Oyon standalone demo lives at `/standalone/` and POSTs to Rohy endpoints with `credentials: 'include'`. Rohy enforces double-submit CSRF for cookie-auth routes — meaning the request needs a `rohy_csrf` cookie copied into an `X-CSRF-Token` header. Earlier the standalone forgot this, and consent / emotion-records POSTs silently 403'd. Fix: a `rohyFetch` helper in `OyonR/standalone/standalone-demo.js` (overlaid via `scripts/oyon-overlay/`) reads the cookie and adds the header for every non-GET. **General principle: if your host enforces CSRF, every embedded surface that POSTs needs to honour it, even when "we control both ends."**

### 4.3 Idempotency at the persistence boundary

Already covered in §2: `record_id = sha1(tenant|session|window_start|window_end)`. The general shape:

> **Server-derived stable record IDs beat client-supplied ones for replay safety.** Client cooperation is fragile (it forgets, retries differ, intermediaries strip). For any "windowed observation" ingestion — whether emotions, vitals, telemetry pings, IoT readings — a hash of the natural identity (tenant + producer + window bounds) gives natural per-window identity that replays automatically collapse. No client change required.

### 4.4 Single source of truth (recurring theme)

Three places this pattern shows up in the Oyon integration:

| Source | What it owns | Why one source matters |
|---|---|---|
| `modelProfiles.js` | Model registry | Three surfaces (miniature, standalone, admin) need to agree on what models exist |
| `oyon_settings` table | Runtime config | The widget, the standalone demo, and the admin form all read from `/config` |
| `DEFAULT_RUNTIME` constant in `oyon-routes.js` | Default values | `ensureSettings` and the admin form-reset both pull from here |

**General principle: every time you find yourself thinking "I'll add the same value in two places, it's just easier", you are committing to a future bug. The first time the two places drift, you'll have a customer report you can't reproduce because *your* dev env happens to have the same value in both places.**

### 4.5 Structured logging on both sides

Server: `oyonLog.info / debug / warn` everywhere (built on the existing `logger('oyon-addon')` factory). Client: `oyonClientLog('debug', message, fields)` in `src/components/oyon/clientLogger.js`, prefixes every line with `[oyon]`. Worth the 30 lines of log-call boilerplate because:

```bash
# Reconstruct a full session from server side
journalctl -u rohy | grep '"component":"oyon-addon"'

# Reconstruct from the browser
# DevTools → Console → filter "[oyon]"
```

Both sides cover: config load → consent → preload → start → batch persist → stop. **General principle: a structured log on each side of the wire is non-optional for any integration that fails in interesting ways. Especially when the failure mode is "appears to work, just slowly" or "appears to work, just doesn't persist".**

### 4.6 Failure isolation

Per `OYON_INTEGRATION_POLICY.md`:

> If any layer of Oyon breaks — env flag off, schema mis-migrated, model assets missing, route throws, transport rejected — Rohy continues to run.

Mechanisms:

- `OYON_ENABLED` env flag: when unset, `oyon-routes.js` registers stubs that 404 without crashing.
- Migration runner is idempotent: missing tables produce 503, not 500.
- Widget mount path is wrapped in an error boundary (`src/components/oyon/OyonCaptureWidget.jsx` returns null on construct error).
- Standalone demo is fully separate; its absence at `/standalone/` doesn't affect the SPA.

**General principle: an integration that can take the host down is a worse integration than one that can be missing entirely. Plan the failure modes first, the success path second.**

---

## 5. Deploy: making the integration self-bootstrapping

### 5.1 The bundle problem

OyonR ships ~93 MB of MediaPipe + ONNX wasm bundles + emotion model weights in `OyonR/standalone/{vendor,models}/`. Carrying these in git history doubles the repo checkout size for everyone forever.

Decision: **gitignore them, fetch on install.**

```
.gitignore (rohy root):
  OyonR/standalone/vendor/
  OyonR/standalone/models/
  OyonR/node_modules/

OyonR/scripts/download-models.sh
  ↓ idempotent — skips files already present (checks size > 0)
  ↓ uses curl
  ↓ downloads to OyonR/standalone/{vendor,models}/
```

### 5.2 The install hook

`package.json`:

```json
{
  "scripts": {
    "postinstall": "bash OyonR/scripts/download-models.sh 2>/dev/null || echo '[oyon] model bundles not downloaded — run: npm run setup:oyon (needs curl + network)'",
    "setup:oyon": "bash OyonR/scripts/download-models.sh"
  }
}
```

The `|| echo` fallback is deliberate: if you're behind a corporate proxy or your CI has no network, `npm install` should still succeed. The explicit `npm run setup:oyon` (no fallback) gives a real error code when you re-run it manually.

### 5.3 Belt + suspenders in deploy paths

`deploy/docker/Dockerfile` builder stage adds `curl` to apt-get and **explicitly re-runs** the download right after `npm install`:

```dockerfile
RUN npm install --prefer-offline --no-audit --no-fund \
 && bash OyonR/scripts/download-models.sh
```

Idempotency means the second run is a no-op when postinstall already worked. The benefit is **loud failure**: a missing download fails the docker build instead of shipping a runtime image with no face/emotion assets.

`deploy/local-install.sh` and `deploy/bootstrap.sh` do the same thing for non-Docker paths.

### 5.4 Reverse-proxy paths

`deploy/docker/Caddyfile` carries explicit handlers for the three Oyon URL families that don't honour Rohy's `/rohy/` SPA base:

```caddyfile
handle /oyon/*       { reverse_proxy rohy:4000 }
handle /standalone/* { reverse_proxy rohy:4000 }
handle /api/addons/oyon* { reverse_proxy rohy:4000 }
```

**General principle: if your host SPA uses a non-root base (`/rohy/`), embedded surfaces with absolute URLs (`/standalone/vendor/foo.wasm`) will 404 unless your reverse proxy explicitly routes them. Audit every absolute URL the integration uses; either rewrite them through the SPA base, or add explicit handlers.**

---

## 6. The generalized checklist

When you add the next library — emotion classifier, voice biometric, eye tracker, gesture recognizer, anything substantial — work through this list in order. The Oyon integration spent multiple sessions discovering each of these the hard way; the cost of doing them up front is much smaller.

### Architecture

- [ ] **One vendored copy.** Decide the path (e.g. `LibName/`) and the package.json reference (`"libname": "file:./LibName"`). Never have multiple copies in different places.
- [ ] **One adapter layer.** A single directory (`scripts/libname-overlay/`) holds full-file overlays of the upstream files you need to patch. An idempotent applicator script (`scripts/apply-libname-patches.mjs`) runs after every upstream sync.
- [ ] **One application entry point.** Exactly one host file imports from the vendored package. Everything else imports from your wrapper.
- [ ] **One integration policy doc.** Short. States the boundary, the failure-isolation rule, and the "additive-only" schema rule.

### Vendored binary assets

- [ ] **gitignore them** if they're > ~10 MB total.
- [ ] **Idempotent download script** in the vendored tree (`LibName/scripts/download-models.sh`). Skip files already present.
- [ ] **postinstall hook** in root `package.json` that runs the script. Tolerant fallback so partial installs don't break.
- [ ] **Explicit re-run in every deploy path** (Dockerfile, bootstrap, local-install). Not tolerant — fail loud on missing assets.
- [ ] **README mentions the bootstrap step** plus the manual retry command (`npm run setup:libname`).

### Schema

- [ ] **Additive-only migrations.** Never `DROP COLUMN` or `RENAME COLUMN` in an integration table — Rohy can roll back to an older app version against a newer DB.
- [ ] **Per-tenant config table** with a single source-of-truth constant (`DEFAULT_LIBNAME_RUNTIME`) that `ensureSettings` INSERTs from explicitly. Don't rely on column-level DEFAULTs across migrations.
- [ ] **Persistence rows share the same trinity** as your existing logs (`tenant_id`, `session_id`, `user_id` or whatever the canonical authority columns are in your app).
- [ ] **Server-derived record IDs** for any windowed/repeated event ingestion. `sha1(tenant|session|window_bounds)` makes replays idempotent without client cooperation.
- [ ] **Partial unique index** matching the server-derived ID + `ON CONFLICT DO NOTHING` insert.

### Server route surface

- [ ] **All routes under one prefix** (`/api/addons/libname/*`). Mountable / unmountable as a unit.
- [ ] **Single error handler** at the bottom of the route file. Express 5 auto-propagates async throws — let it.
- [ ] **Read vs. write authorization split.** Educators/admins typically can READ across users in their tenant; they typically CANNOT WRITE on behalf of users. Don't reuse the read rule for the write rule.
- [ ] **Server-authoritative for security-relevant fields.** `consent_version`, audit timestamps, anything that could be replayed should not trust the client.

### Client widget

- [ ] **Single React entry point** (`LibNameWidget.jsx`) that imports from the vendored package.
- [ ] **Fetch tenant config BEFORE construct.** Pass the full config to the runtime — not just two convenient fields.
- [ ] **Forward live config changes.** The settings tab dispatches a `libname:setting-changed` window event; the widget listens and re-inits.
- [ ] **`dispose()` distinct from `stop()`** if the runtime is resource-heavy. Every consumer that previously called `stop()` needs to be audited for whether it should now call `dispose()`.
- [ ] **Structured client logger** (`libnameClientLog`). Tagged with `[libname]` so `console` filtering works.
- [ ] **Consent gating** for any data persistence. Local rendering is fine; server POST requires explicit opt-in.

### Settings UI

- [ ] **Single source of truth for any registry** (model list, voice list, profile list). Imported by every consumer; never re-defined.
- [ ] **Form save dispatches the live-update event.**
- [ ] **Cross-tab synchronisation** via the `storage` event for any localStorage-backed settings.

### Cross-origin / security

- [ ] **COOP + COEP** if the library uses `SharedArrayBuffer` (multi-threaded WASM, WebGPU, Atomics). Verify with `crossOriginIsolated` in DevTools.
- [ ] **CSRF token forwarding** for any embedded surface that POSTs back to the host. `credentials: 'include'` alone is not enough if the host enforces double-submit CSRF.
- [ ] **No hardcoded secrets** in the vendored tree. API keys come from tenant config, not environment vars in the bundled JS.

### Failure isolation

- [ ] **Env flag off → integration silently 404s; host keeps running.**
- [ ] **Missing tables → 503, not 500.**
- [ ] **Widget construct errors → return null, not propagate.**
- [ ] **Standalone demo absence → SPA still loads.**

### Observability

- [ ] **Server-side `logger('libname-addon')` everywhere** (config load → consent → start → batch persist → stop).
- [ ] **Client `[libname]`-tagged structured logs** at the same lifecycle points.
- [ ] **Persisted records visible in the existing log viewers** — don't build a separate viewer when you can UNION into the existing chat/activity feed with a `source: libname` chip.

### Reverse proxy

- [ ] **Audit every absolute URL** the library uses (`/static/`, `/vendor/`, `/api/`).
- [ ] **Add explicit handlers** for those paths in your reverse proxy if your SPA uses a non-root base.
- [ ] **Document the URL families** in the proxy config with a comment so the next operator knows why those handlers exist.

---

## 7. Reading order for the curious

If you've never opened the Oyon integration before, this is the order that pays off:

1. `OYON_INTEGRATION_POLICY.md` — boundaries (5 min)
2. `migrations/0011_oyon_addon.sql` through `0017_oyon_records_window_metadata.sql` — schema (10 min)
3. `server/routes/oyon-routes.js` — API surface (15 min)
4. `src/components/oyon/OyonCaptureWidget.jsx` — the widget (15 min)
5. `OyonR/src/core/EmotionRuntime.js` — the vendored runtime (read once, never patch directly) (20 min)
6. This doc — pattern to apply elsewhere (you're here)

Total: under two hours to grok the full integration.

---

## Appendix: Naming conventions used in this integration

| Pattern | Example | Why |
|---|---|---|
| `OYON_*` constant | `OYON_ENABLED`, `OYON_DEFAULT_CONSENT_VERSION` | Greppable; never collides with `ROHY_*` |
| `oyon_*` SQL identifier | `oyon_settings`, `oyon_emotion_records` | Same — namespace by prefix |
| `oyon-routes.js`, `oyon-overlay/` | hyphen-case for paths | Matches the rest of the codebase |
| `OyonCaptureWidget.jsx` | PascalCase for React components | Matches React convention |
| `oyonClientLog` / `oyonLog` | camelCase for functions | Matches JS convention; same prefix as identifiers |
| `[oyon]` log tag | brackets in the string | One grep target across server + client |

The whole point of these conventions: a fresh contributor running `grep -r oyon` at the repo root sees exactly the surface area of the integration. If you ever find a piece of the integration that doesn't show up in that grep, the convention has been violated and the boundary will eventually leak.
