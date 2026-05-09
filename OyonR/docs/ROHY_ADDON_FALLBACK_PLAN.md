# Rohy Add-On Plan With Full Fallback

Date: 2026-05-08

Goal: integrate Oyon into Rohy as an optional add-on. Rohy owns the
database rows, launch button, admin views, and student views. Oyon only
captures local browser emotion windows.

## Stability Contract

Oyon must never be in Rohy's critical path.

- If Oyon is disabled, Rohy behaves as if Oyon does not exist.
- If Oyon JavaScript fails to load, Rohy keeps running.
- If camera access is denied, Rohy keeps running.
- If model assets are missing, Rohy keeps running.
- If `/api/addons/oyon/*` fails, Rohy keeps running.
- If Oyon database tables are missing, only Oyon pages/routes fail.
- Oyon must not block login, cases, records, chat, grading, or normal
  dashboards.

## Add-On Shape

```text
Rohy core
  └─ add-on slots
       └─ Oyon Emotion Capture, if enabled and available
```

Recommended Rohy folder:

```text
addons/oyon/
  ├── addon.json
  ├── backend/routes.js
  ├── backend/service.js
  ├── migrations/001_oyon_addon.sql
  └── frontend/
      ├── StartEmotionButton.jsx
      ├── EmotionCaptureModal.jsx
      ├── AdminEmotionDashboard.jsx
      └── StudentEmotionView.jsx
```

Rohy should expose slots, not import Oyon into core workflows:

```text
front_page_actions      -> Start Emotion Capture button
case_toolbar_actions    -> capture status chip
admin_pages             -> Emotion Monitoring
student_pages           -> My Emotion Reflection
```

If the add-on is unavailable, slots render nothing.

## Database

Use Oyon-owned tables only:

- `oyon_emotion_records`
- `oyon_emotion_consents`
- `oyon_settings`

Do not modify existing Rohy tables. Store Rohy IDs as references:

- `tenant_id`
- `user_id`
- `student_id`
- `case_id`
- `session_id`
- `record_id`
- `course_id`
- `cohort_id`

Store snapshots for historical context:

- student display name
- role
- case title
- course/cohort labels
- launch page
- session type
- attempt number

The browser must not be trusted for these values. Rohy should attach
them server-side from the authenticated request and active session.

## API

Use isolated routes:

```text
POST /api/addons/oyon/emotion-records
GET  /api/addons/oyon/emotion-records
POST /api/addons/oyon/consent
GET  /api/addons/oyon/admin/live
GET  /api/addons/oyon/student/me
```

If `OYON_ENABLED` is not `1`, return `404` or `503` from these routes.
No existing Rohy API should call them as a dependency.

## Frontend Flow

1. Rohy renders normally.
2. Add-on slot renders `Start Emotion Capture` only when enabled.
3. Button click lazy-loads Oyon.
4. Consent is requested.
5. Camera starts only after consent.
6. Capture sends aggregate windows to Rohy.
7. Save failures are dropped after a tiny retry/circuit-breaker path.
8. Any failure shows a small Oyon-only unavailable state.

## Admin View

Admins can view:

- live active emotion captures
- student/session/case context
- current dominant emotion
- valence/arousal trend
- confidence and missing-face quality
- historical session timeline

Admin access must remain tenant/course scoped.

## Student View

Students may view their own summaries only if enabled:

```text
student_emotion_view_enabled = true
```

The student view should be reflective, not grading-oriented. It should
not show raw frames, landmarks, or hidden technical payloads.

## Full Fallback Behavior

Use `createRohyOyonAddon()` from `oyon/addon` for safe frontend launch.
It returns a no-op add-on when disabled and catches start/stop failures.

Use `FallbackEmotionTransport` for saves. It swallows telemetry write
failures, drops windows, and disables itself after repeated failures.

Emergency rollback is one setting:

```text
OYON_ENABLED=0
```

Result:

- launch button hidden
- Oyon routes disabled
- no camera use
- no model loading
- no writes
- admin/student Oyon pages hidden
- Rohy runs normally

## Implementation Order

1. Add Rohy add-on registry/slots if they do not already exist.
2. Copy `examples/rohy-addon/001_oyon_addon.sql` into Rohy migrations.
3. Add isolated `/api/addons/oyon/*` routes.
4. Add frontend button/modal as add-on slot content.
5. Lazy-load Oyon on click with `createRohyOyonAddon()`.
6. Add admin dashboard.
7. Add optional student reflection view.
8. Test disabled, missing assets, denied camera, failed API, missing DB,
   and normal capture.
