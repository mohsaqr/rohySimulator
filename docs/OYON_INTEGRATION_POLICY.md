# Oyon Integration Policy

Version: 1.0 — 2026-05-09

Supersedes the discussion in `docs/OYONR_INTEGRATION_NOTE.md` for everything
that follows.

## 1. Goal

Oyon is a **feature of Rohy**, not a separate service. It ships in the same
repository, runs in the same Express server, persists to the same SQLite
database, and is deployed by the same `npm run build`.

If any layer of Oyon breaks — env flag off, schema mis-migrated, model assets
missing, route throws, transport rejected — **Rohy continues to run**. Oyon
failures degrade visibly in Oyon's own UI; they do not propagate.

## 2. Boundaries

| Concern | Owner | Lives in |
|---|---|---|
| Oyon backend logic | Oyon | `server/routes/oyon-routes.js` |
| Oyon database tables | Oyon | `migrations/0011_oyon_addon.sql` (additive only) |
| Oyon UI | Oyon | `src/components/oyon/`, `src/components/settings/OyonSettingsTab.jsx` |
| Vendored capture engine | Oyon | `OyonR/` (refreshed via `npm run oyon:update`) |
| API surface | Oyon | every endpoint under `/api/addons/oyon/*` |
| Static assets | Oyon | `OyonR/standalone/` served via `/oyon/*` and `/standalone/*` |

Rohy code never imports across these boundaries. Tests and components inside
the boundary may import freely from one another.

### Database constraints
- Oyon tables are **additive only**. Never modify Rohy schemas.
- Foreign-key references to `sessions(id)` use `ON DELETE SET NULL` so Oyon
  rows can never block Rohy session deletion.
- Migration `0011_oyon_addon.sql` is idempotent and safe to re-run.

## 3. Failure-isolation tiers

Every layer has a defined degradation path. **No Oyon failure may throw uncaught
into Rohy's request lifecycle, migration sequence, or React render tree.**

| Layer | Failure mode | Behavior |
|---|---|---|
| Env flag | `OYON_ENABLED=0` or unset | Routes not mounted; miniature returns `null`; settings tab hidden |
| Module import | `import('./routes/oyon-routes.js')` throws | Logged once at boot; no Oyon routes mounted; Rohy boots normally |
| Migration | `0011_oyon_addon.sql` fails | Logged as warning; routes detect missing tables and respond 503; rest of Rohy migrates |
| Backend route | Any handler throws | Caught by handler-level try/catch, returns `500 {error: ...}`, never crashes the request loop |
| DB write | `INSERT INTO oyon_emotion_records` fails | 500 to client; miniature retries on next window; capture loop continues |
| Frontend config fetch | `GET /addons/oyon/config` fails | Miniature/settings tab return `null` and log once; no toast, no crash |
| Frontend Worker | Worker fails to load models | Pill shows `offline` state; main thread untouched; sim UI fully responsive |
| Capture POST | `/emotion-records` 4xx/5xx | Pill shows amber `⚠`; capture continues locally; retries on next window |
| Analytics fetch | Logs page can't reach backend | Empty state with retry button; never blank/broken |
| Camera permission | User denies | Clear status in pill; sim continues; user can retry |

**Hard rule:** every Oyon network call (frontend) and every Oyon route handler
(backend) is wrapped in try/catch and either degrades gracefully or returns a
typed error. There are no uncaught error paths.

## 4. Capture ownership (single source of truth)

- The Rohy **miniature** is the only capture engine in the integrated product.
  It runs the FER pipeline in a Web Worker so the React render thread is never
  blocked by inference.
- The standalone Oyon page (`/oyon/standalone/`) is **analytics-only** when
  launched from Rohy (`?source=rohy`). Its own capture controls are hidden in
  Rohy mode; the page reads from the Rohy backend.
- Emotion records live exclusively in `oyon_emotion_records` (Rohy DB). The
  standalone's `LocalEmotionTransport` is no longer used by any Rohy code path.

## 5. Privacy

- **Frames never leave the device.** All face detection and emotion
  classification happens in the user's browser (in a Web Worker).
- Only **aggregated windows** (dominant emotion, confidence, valence/arousal,
  frame counts, quality) are POSTed to the backend.
- **Per-session consent** is required before any backend write. Consent is
  granted by the session owner (the student) or implicitly by an admin/educator
  acting in their own session.
- Consent default is a per-user preference stored client-side; auto-granting
  on capture start is allowed when the preference is set.
- The terms of recording are visible in the Oyon settings tab.

## 6. Deployment

- Single deployable: `npm run build` produces a Rohy bundle that includes
  `OyonR/standalone/**` static assets and the vendored MediaPipe / ONNX ESM
  bundles in `OyonR/standalone/vendor/`.
- One Express server (port 3000 in dev, configurable in prod) serves both
  Rohy's API and Oyon's static + addon API.
- Caddy / reverse proxy config already routes `/api/*`, `/oyon/*`,
  `/standalone/*` through the same origin — no infrastructure changes.
- `OYON_ENABLED` is the deployment kill-switch.

## 7. Versioning & sync

- Oyon version pinned via `OyonR/package.json` (`"version": "0.1.0"` today).
- `npm run oyon:update` syncs `OyonR/` from the sibling `~/Documents/Github/Oyon`
  checkout. Dev-only — production deploys ship the committed snapshot.
- Patches applied to vendored Oyon files (e.g. importmap injection in
  `OyonR/standalone/index.html`, GPU delegate in `MediaPipeFaceTracker.js`) are
  re-applied automatically by an idempotent post-sync step in
  `scripts/update-oyonr.sh` *(future work — track separately)*.

## 8. Acceptance criteria

The integration is acceptable when all of the following hold:

1. Rohy boots normally with `OYON_ENABLED` unset.
2. Rohy boots normally with `OYON_ENABLED=1` and the addon module broken
   (e.g. routes file syntax error). Only Oyon UI is hidden; Rohy is fully
   functional.
3. Rohy boots normally if `oyon_emotion_records` table is missing.
   Backend returns 503 on Oyon endpoints; sim continues.
4. Camera permission denied → pill shows clear status, sim continues, user can
   retry.
5. Backend rejects emotion-records → pill shows `⚠`; capture continues; retries
   on next window.
6. Analytics page (Settings → Oyon → Emotion logs, and the standalone logs
   page when launched with `?source=rohy`) defaults to the **current session**
   and exposes a **session selector** for admins/educators (with "all sessions"
   option). Students see only their own records.
7. No model loading or inference work runs on the main thread (Worker pipeline).
8. Camera/model/save failures never freeze Rohy or trigger React error
   boundaries.
9. `npm run build` produces a single deployable that includes all Oyon static
   assets and works in production with one origin.
10. Oyon can be turned off without redeploying (env flag) and back on without
    code changes (env flag → restart).

## 9. Out of scope (for v1.0)

- Re-implementing the standalone Oyon's capture UI — the miniature is the only
  capturer. The standalone retains capture as a developer/QA tool when launched
  *without* `?source=rohy`.
- Cross-tenant analytics. Tenant scoping is enforced at every endpoint.
- Real-time push from backend to miniature. The miniature is its own producer.
