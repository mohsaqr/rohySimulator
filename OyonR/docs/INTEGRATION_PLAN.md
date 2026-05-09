# Oyon → Rohy Integration & Logging Plan

Date: 2026-05-08
Scope: a non-destructive, additive plan to wire the standalone Oyon
sidecar (`Oyon/`) into Rohy without modifying
existing Rohy source files beyond a single, minimal, feature-flagged
mount point.

This plan complements (does not replace):
- `docs/HANDOFF.md` — current sidecar state and design constraints.
- `docs/DESIGN_OVERVIEW.md` — original architectural plan.
- `docs/IMPLEMENTATION_PLAN.md` — pipeline-level plan.

It does replace (supersedes) the install instructions in
`examples/rohy-backend/ATTACH_BACKEND.md` — see "Backend
attachment" below.

---

## 1. Non-destructive contract

Anyone executing this plan must hold these invariants. They are the
acceptance criteria for "non-destructive."

| Invariant | Meaning | Verifiable by |
|---|---|---|
| **No edits to existing Rohy migrations** | `migrations/0001_*` … `migrations/0010_*` are read-only; new schema lands in a new numbered file | `git diff migrations/000*` shows no changes |
| **No edits to existing route files** | `server/routes/*.js` files unchanged; new routes live in a new file | `git diff server/routes/` shows only an addition |
| **No edits to existing client source files** | `src/App.jsx` and any `src/components/**` unchanged; Oyon UI mounts via a new component | `git diff src/` shows only additions |
| **One single-line edit allowed** | `server/routes.js` gets exactly one new `router.use(emotionRoutes)` line, gated by env flag | grep diff for `routes.js` |
| **Default off** | Setting `OYON_ENABLED=false` (or unset) makes Oyon invisible to users and inert on the server | run server without env var → 404 on `/api/sessions/:id/emotions/batch` |
| **Removable in one revert** | Reverting the Oyon merge restores Rohy bit-for-bit (modulo one new migration that is `DROP`-able) | `git revert <merge>` followed by `DROP TABLE emotion_windows; DELETE FROM client_logs WHERE source LIKE 'oyon-%';` returns the DB to pre-Oyon state |
| **No raw frame storage** | Browser sends only aggregate windows; server validates and rejects any payload containing `frame*`, `image*`, `pixels`, `landmarks`, `blob`, `base64` | acceptance test in `tests/server/emotion-routes.test.js` |
| **Tenant-isolated** | Every read/write filters by `tenant_id` from the session | tenant cross-access test |

If any of those invariants would be broken, **stop and revise the plan
before continuing**.

---

## 2. Phased rollout

Each phase is independently revertible. Don't merge a phase unless the
previous one is green in CI and acceptance-tested.

| Phase | Touches | Goal | Exit gate |
|---|---|---|---|
| **0. Approval** | docs only | Ethics/legal sign-off; consent text drafted; deployment scope decided | written sign-off in `docs/plans/` |
| **1. Sidecar bundle** | `package.json`, `vite.config.js` (additive only) | Oyon is importable from Rohy as `oyon` (workspace-linked, no actual install in production) | `import { useRohyFer } from 'oyon/react';` resolves in dev |
| **2. Backend (off)** | new migration, new route file, single-line mount | Migration runs, route exists but every request returns `403 oyon-disabled` unless env flag set | tests pass with flag both on and off |
| **3. Frontend (off)** | new opt-in component | Component imported by `App.jsx` once but renders `null` unless flag is on | UI unchanged for users without flag |
| **4. Pilot** | env flag on for tenants with explicit consent | A small group runs end-to-end; aggregate windows arrive in DB; no impact on non-pilot tenants | retention/audit check |
| **5. Soft launch** | enable per-user opt-in toggle | All tenants can enable; default off per user | dashboard ready, governance docs published |

---

## 3. What lives where

```
Rohy (existing, mostly untouched)
├── migrations/
│   └── 0011_emotion_windows.sql           [NEW — see §4]
├── server/
│   ├── routes/
│   │   └── emotion-routes.js              [NEW — see §5]
│   └── routes.js                          [+1 conditional line — see §5.4]
├── src/
│   ├── components/
│   │   └── emotion/                       [NEW — see §6]
│   │       ├── OyonMount.jsx
│   │       ├── OyonConsentModal.jsx
│   │       └── OyonStatusChip.jsx
│   └── App.jsx                            [+1 line: <OyonMount /> — see §6.4]
└── docs/
    └── OYON.md                            [NEW — operator + governance doc]

Oyon sidecar (existing)
└── Oyon/                                  [unchanged; consumed via npm workspace link]
```

Two source-tree edits are unavoidable to make the integration usable:
the route mount and the component mount. Both are single lines, both
are behind `OYON_ENABLED`, both can be reverted in one commit.

---

## 4. Database schema (additive, removable)

### 4.1 Decision: NEW table, not extending `emotion_logs`

The backend template (`examples/rohy-backend/0011_emotion_windows.sql`)
creates a dedicated `emotion_windows` table. Reasons:

- `emotion_logs` predates the FER design and may be used by future code we
  don't want coupled to FER columns.
- A new table is dropped in one statement; column additions can never be
  cleanly removed in SQLite without a table rebuild.
- A new table makes governance simpler: "the FER data is one table; here
  is its retention policy" beats "the FER data is some columns added to a
  table that has other meanings."

Keep `emotion_logs` untouched. The template uses:

### 4.2 New migration `migrations/0011_emotion_windows.sql`

```sql
-- Aggregated facial-expression telemetry, written only when a user has
-- explicitly consented for the active session. No raw frames are stored.
CREATE TABLE IF NOT EXISTS emotion_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  case_id TEXT,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  dominant_emotion TEXT,
  probabilities TEXT,           -- JSON: { neutral: 0.x, happy: 0.x, ... }
  valence REAL,                 -- [-1, 1] or NULL if model lacks v/a
  arousal REAL,                 -- [-1, 1] or NULL
  confidence REAL,              -- [0, 1]
  entropy REAL,                 -- bits, [0, log2(num_labels)]
  valid_frames INTEGER NOT NULL DEFAULT 0,
  missing_face_ratio REAL NOT NULL DEFAULT 0,
  quality TEXT,                 -- JSON: { meanFaceAreaRatio, totalFrames, ... }
  model_name TEXT,
  model_version TEXT,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('local-browser')),
  consent_version TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emotion_windows_tenant_session
  ON emotion_windows(tenant_id, session_id, window_start);
CREATE INDEX IF NOT EXISTS idx_emotion_windows_tenant_user_time
  ON emotion_windows(tenant_id, user_id, window_start DESC);
```

### 4.3 Retention

Hook into Rohy's existing retention sweep (see `migrations/0005_retention.sql`).
Add a deletion clause for `emotion_windows` matching the same retention
horizon as `emotion_logs`. This is implemented in §5.5 (server-side cron),
not in the migration itself.

### 4.4 Purge / anonymization

When a user is purged or anonymized, `emotion_windows` rows for that
`user_id` must be deleted or have `user_id` rewritten to a tombstone. Add
the FOR clause to the existing purge handler **without editing it** — the
Oyon route module exports a `purgeUser(userId)` function and the existing
handler imports it lazily through a registry pattern (§5.6).

---

## 5. Backend (`server/routes/emotion-routes.js`)

### 5.1 Surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/sessions/:sessionId/emotions/batch` | user | Append validated aggregate windows |
| `GET` | `/api/sessions/:sessionId/emotions` | owner / educator / admin | Read aggregates for a session |
| `GET` | `/api/admin/emotions/export` | admin | Pseudonymized export (research) |
| `POST` | `/api/sessions/:sessionId/emotions/consent` | user | Record consent grant/revoke |

All are gated on `process.env.OYON_ENABLED === '1'`. When disabled, the
router responds `404` (or `403 { reason: 'oyon-disabled' }`) so a probe
cannot tell whether Oyon is unconfigured vs intentionally off.

### 5.2 Validation contract (server-side)

Reuses `validateEmotionBatch` from `oyon/validation` via the workspace
import. The server-side wrapper additionally
additionally enforces:

- `events.length <= 64` per request
- each event byte size ≤ 4 KB after JSON
- each event timestamp within `[session.started_at - 60s, session.ended_at + 60s]`
- `tenant_id`, `session_id`, `user_id` match the authenticated context — body values **ignored** if present, never trusted
- absent `consent_version` → reject
- absent `capture_mode` or value other than `local-browser` → reject
- any forbidden field (`frame*`, `image*`, `pixels`, `landmarks`, `blob`, `base64`, `video*`) → reject the whole batch with a 400 (do not silently strip — surface the problem)

### 5.3 Ownership / tenant guard

Reuse the existing helper used by `sessions-routes.js` and
`patient-record-routes.js`:

```js
const session = await getOwnedSession(req, sessionId);
// throws 403 if not owner/educator/admin within tenant
```

### 5.4 Mount line (the single-line edit)

In `server/routes.js`, alphabetized with neighbors:

```js
import emotionRoutes from './routes/emotion-routes.js';
// ...
if (process.env.OYON_ENABLED === '1') router.use(emotionRoutes);
```

The `if` keeps the route off when the flag is unset. This is the **only**
edit to existing Rohy server code in the entire integration.

### 5.5 Retention sweep hook

Rather than edit the existing retention job, the new route module
**self-registers** a sweep callback when imported:

```js
// emotion-routes.js
import { registerRetentionSweep } from '../retention/registry.js'; // existing
registerRetentionSweep('emotion_windows', async (cutoff) => {
  await db.run('DELETE FROM emotion_windows WHERE created_at < ?', cutoff);
});
```

If `retention/registry.js` does not yet exist as a registry, see §11
"Open questions" — alternative is a small additive helper file rather
than touching the existing sweep.

### 5.6 Purge / anonymize hook

Same pattern: register a callback at module load. When the existing
purge handler runs, it walks the registry. Adding to the registry is
additive; the existing purge code does not need to know what
`emotion_windows` is.

---

## 6. Frontend (`src/components/emotion/`)

### 6.1 Files

```
src/components/emotion/
├── OyonMount.jsx          # mount-point; renders null unless enabled+consent
├── OyonConsentModal.jsx   # opt-in dialog with policy text
├── OyonStatusChip.jsx     # tiny "● capturing" or "⏸ paused" indicator
└── useOyon.js             # thin wrapper around oyon's useRohyFer
```

`OyonMount` is the only component imported by `App.jsx`. It owns the
consent modal, the runtime, and the status chip. If the feature flag
is off, `OyonMount` returns `null` and the rest of Rohy is unaffected.

### 6.2 Feature flag

Frontend flag is read from a Rohy-provided runtime config (e.g., the
existing `/api/health` or `/api/config` payload). Do not use a
build-time env var alone; production should be able to flip Oyon on per
tenant without redeployment.

```js
// useOyon.js
const { config } = useAppConfig();             // existing hook
const enabled = config?.flags?.oyon === true;
const { user, currentSession } = useAuth();    // existing hook
const fer = useRohyFer({
  enabled: enabled && Boolean(currentSession?.id),
  apiBaseUrl: '/api',
  getToken: () => localStorage.getItem('token'),
  getSession: () => ({
    sessionId: currentSession.id,
    userId: user.id,
    caseId: currentSession.case_id,
    tenantId: user.tenant_id,
  }),
  consentProvider: async () => promptConsent(), // shows OyonConsentModal
});
```

### 6.3 Where it mounts in the UI

`OyonMount` lives at the **top of `App.jsx`'s rendered tree**, alongside
`<ToastProvider>` and `<NotificationProvider>`. It does **not** wrap
existing children — it sits as a sibling. So removing it can never
break the app shell.

```jsx
// App.jsx — exactly one new line
<OyonMount />
{/* … existing tree below, untouched … */}
```

### 6.4 Single-line edit

The only edit to existing Rohy frontend code is one `<OyonMount />`
line in `src/App.jsx` (or `src/main.jsx`, depending on where providers
are mounted). Even this can be made zero-edit if there is a slot
component (e.g., `<AppExtras />`) that already takes children.

### 6.5 Consent flow

1. User starts a case.
2. If `oyon` flag is on AND `localStorage.oyon_consent_<sessionId>` is unset: show `OyonConsentModal`.
3. User chooses **Enable for this session** | **Skip** | **Always skip** (sets `localStorage.oyon_consent_global = 'never'`).
4. Choice is logged via `POST /api/sessions/:sessionId/emotions/consent`.
5. Camera is requested only after explicit Enable.
6. A small `OyonStatusChip` is always visible while capturing, with a one-click pause/stop.

---

## 7. Logging

Logging is the user-facing question that motivates this plan. Oyon must
hook into Rohy's existing logging infrastructure rather than build a
parallel one.

### 7.1 Three logging surfaces in Rohy

Per `docs/OBSERVABILITY.md`, `docs/AUDIT_TRAIL.md`,
`docs/LEARNING_ANALYTICS.md`:

| Surface | What it stores | Source of truth | Used for |
|---|---|---|---|
| **Server log** (`logger`) | Operational events, errors, request-id-tagged | `server/logger.js` | Debugging, ops |
| **`client_logs` table** | Browser-side logs uploaded over `/api/client-logs` (migration 0009) | EventLogger client → server | Frontend errors, telemetry |
| **`learning_events` table** | xAPI-style learner activity | EventLogger | Analytics dashboards |
| **`system_audit_log`** | Hash-chained audit of sensitive ops (migration 0008) | `writeAudit()` helper | Compliance, forensics |

Oyon writes to **all four** surfaces, each for a specific reason.

### 7.2 Server log (operational)

Every Oyon route handler logs structured events through the existing
`logger`. Use these levels per `docs/OBSERVABILITY.md`:

| Event | Level | Notes |
|---|---|---|
| Batch accepted | `info` | `{ session_id, valid_frames, dominant_emotion }` (no PII other than id) |
| Validation rejected | `warn` | `{ reason, field }` — no payload echo |
| Forbidden field present | `warn` | one line, do not include the field's value |
| DB write failed | `error` | bubbles up to the existing error handler |
| Consent granted/revoked | `info` | tagged with audit-id for cross-reference |

All log lines carry the request-id middleware id so they correlate with
the rest of the request log.

### 7.3 `client_logs` (browser-side)

The Oyon frontend pipes its own warnings/errors through Rohy's
EventLogger using a dedicated `source: 'oyon-client'` tag. Examples:

| Trigger | Level | Payload (sanitized) |
|---|---|---|
| Camera permission denied | `warn` | `{ reason: 'permission-denied' }` |
| Model load failed | `error` | `{ profile, error: e.message }` |
| ONNX inference threw | `error` | `{ profile, ms_since_start }` |
| Sample loop fell behind > 2× expected | `warn` | `{ measured_fps, target_fps }` |

Never log: video frames, image data, landmarks, blendshape arrays, raw
probability arrays. The Oyon validation contract for browser→server
payloads (§5.2) applies symmetrically to the logging payloads — the
helper that uploads to `client_logs` runs the same validation contract
defensively before the network call.

### 7.4 `learning_events` (analytics timeline)

Aggregate windows are moderately dense — usually one every 8–10 seconds. Writing all of
them to `learning_events` would pollute the table and degrade existing
dashboards. Instead, emit **sparse alignment markers**:

| Verb | When emitted | Object |
|---|---|---|
| `OYON_CAPTURE_STARTED` | First successful sample after consent | session id |
| `OYON_CAPTURE_PAUSED` | User paused | session id |
| `OYON_CAPTURE_STOPPED` | User stopped or session ended | session id |
| `OYON_AFFECT_SHIFT` | Smoothed dominant emotion changed for ≥ 3 windows | `{ from, to, valence, arousal }` |
| `OYON_LOW_QUALITY` | ≥ 30 s of windows with `missing_face_ratio > 0.5` | `{ reason }` |

These verbs are added to `EventLogger.VERBS` in a new file
`src/eventLogger/oyonVerbs.js` (additive — does not modify the existing
`eventLogger.js`). The existing analytics dashboard reads `learning_events`
without any change and now sees Oyon events alongside other learner
activity.

### 7.5 `system_audit_log` (compliance)

The audit chain is the right place for events that have legal/ethics
weight. Per `docs/AUDIT_TRAIL.md`:

| Event | Reason | `actor` | `target` |
|---|---|---|---|
| `oyon.consent_granted` | Compliance: prove consent existed | `user_id` | `session_id` |
| `oyon.consent_revoked` | Compliance: prove user can withdraw | `user_id` | `session_id` |
| `oyon.tenant_enabled` | Ops: track per-tenant rollout | `admin_id` | `tenant_id` |
| `oyon.export_run` | Compliance: who exported research data | `admin_id` | `range` |
| `oyon.purge_completed` | Compliance: prove purge ran for a user | `system` | `user_id` |

These rows feed into the existing hash chain, so any tampering breaks
the chain and the verification job (per `AUDIT_TRAIL.md`) fails loudly.

### 7.6 What *not* to log

The plan explicitly excludes:

- Raw frames, images, video, audio (already enforced)
- Landmark or blendshape arrays (validation rejects)
- Per-sample probability arrays (only aggregate windows)
- The user's name or email in any of the four surfaces — use `user_id`
- The full case content (only `case_id` reference)

### 7.7 Field naming

To make cross-surface joins easy, all Oyon log entries use the same
field names everywhere they appear:

| Field | Type |
|---|---|
| `oyon_session_id` | text (Rohy session id) |
| `oyon_window_id` | int (`emotion_windows.id`) |
| `oyon_consent_version` | text |
| `oyon_model_profile` | text (e.g., `emotieff-mobilevit`) |
| `oyon_capture_mode` | text (`local-browser`) |

A grep across `client_logs`, `learning_events`, `system_audit_log`,
and `emotion_windows` for an `oyon_session_id` reconstructs the full
trace of what happened in that session.

---

## 8. Tests (must accompany each phase)

| Phase | Tests required to merge |
|---|---|
| Phase 2 | Migration runs idempotent; route 404s when flag off; route works when flag on; tenant cross-access denied; raw-frame payload rejected; oversized batch rejected; timestamp-out-of-range rejected; ownership escalation denied; consent-grant audit row appears |
| Phase 3 | `OyonMount` renders `null` when flag off; consent modal shows on first session; pause/resume affects camera track; status chip reflects runtime state; component teardown stops the camera (no leaked tracks) |
| Phase 4 | End-to-end: pilot user → consent → 60-second capture → DB rows appear → educator dashboard reads them → user purge wipes them |

The existing test pyramid (`docs` reference in CLAUDE.md) defines tiers
— unit, component, e2e, audio, bench. Oyon tests slot into the existing
tiers; do not invent new ones.

---

## 9. Rollback procedure

Every phase has an explicit rollback. Practice it once before pilot.

| Phase | Rollback |
|---|---|
| Phase 2 (backend) | `git revert <commit>`; run `DROP TABLE emotion_windows;` (data loss is intentional — only aggregate, no PII tied to the table that isn't already in `users`/`sessions`). |
| Phase 3 (frontend) | `git revert <commit>`; the `<OyonMount />` line is removed and the dynamic import is dead. |
| Phase 4 (pilot) | Set `OYON_ENABLED=0` in env; restart server. Routes 404, frontend mount renders `null`. Data already in `emotion_windows` stays for the retention sweep to clear, or `DROP` if compliance asks. |
| Phase 5 (soft launch) | Set per-tenant flag to `false`; existing data continues to be queryable by educators until retention drops it. |

---

## 10. Governance summary

This is a research feature in an education context. EU AI Act Art. 5
restricts emotion inference for educational use except medical/safety
contexts. Treat Rohy as a clinical/medical-education simulator
specifically — that scope **may** keep us inside the medical exception,
but the legal/ethics review must confirm.

Until that confirmation:

- **Do not** show emotion labels to the student during the case.
- **Do not** use emotion data for grading, ranking, or progression.
- **Do** show educators the data only for *post-hoc* reflection, with
  the uncertainty language already wired into the standalone UI.
- **Do** keep the feature off by default per tenant; opt-in per user;
  consent-recorded per session.

---

## 11. Open questions

These are the items I cannot decide unilaterally. Resolve before Phase 2.

1. **Retention horizon.** `emotion_logs` retention is set in
   `0005_retention.sql`. Should `emotion_windows` match it (recommended)
   or be shorter (e.g., 30 days for research data)?
2. **`registerRetentionSweep` registry.** Does Rohy already have a
   pluggable retention sweep, or do we need to add a tiny registry
   helper? If the latter, that's one new file under `server/retention/`,
   still additive.
3. **Per-tenant feature flag.** Where does Rohy currently store per-tenant
   flags? If there's no existing pattern, we need one. The minimum
   viable shape is a column on the `tenants` table OR a row in a generic
   `tenant_flags` key/value table. Adding either is one new migration.
4. **Educator dashboard surface.** Is the dashboard a separate React
   route or a tab on an existing case-review page? This decides whether
   we add a route or extend a view.
5. **Pilot tenants.** Which tenants/users participate in Phase 4?
   Compliance pre-approval likely required.
6. **Model assets in production.** Standalone serves models from
   `/standalone/models/`. In the integrated build, models go into
   `public/oyon/models/` of the Rohy frontend bundle (or a CDN with the
   right CORS headers). Roughly 30 MB per model — watch deploy size.

---

## 12. What this plan does *not* cover

- The model upgrade plan (POSTER++, DDAMFN++, ensembles). That belongs in
  a separate doc once Phase 4 is green.
- A dashboard UI design beyond surface-level placement.
- Mobile / tablet support for the camera capture (Rohy is laptop-first).
- The Tauri desktop variant of Rohy (handai, not rohySimulator) — out
  of scope.

---

## 13. One-line summary

> Add one new migration, one new server route file, one new component
> directory, and exactly two new lines to existing Rohy source. Gate
> all of it on a single env flag. Log everything that has compliance
> weight to the existing audit chain; everything operational to the
> existing logger; everything analytic to the existing
> `learning_events` table — never to a parallel store.
