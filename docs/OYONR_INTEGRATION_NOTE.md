# OyonR Integration Note

Date: 2026-05-08

## Current State

Rohy now contains a full local copy of Oyon at:

```text
OyonR/
```

Rohy imports it as a local package:

```json
"oyon": "file:./OyonR"
```

The update mechanism is:

```bash
npm run oyon:update
```

This refreshes `OyonR/` from the sibling `../Oyon` checkout while excluding
`.git`, `node_modules`, and transient Playwright logs.

The full Oyon app is served by Rohy at:

```text
/oyon/standalone/
```

The full Oyon analytics/logs page is served at:

```text
/oyon/standalone/logs.html
```

The Oyon backend routes are mounted under:

```text
/api/addons/oyon/*
```

The Oyon database tables are additive only:

```text
oyon_settings
oyon_emotion_consents
oyon_emotion_records
```

## Important Correction

The miniature Oyon panel in Rohy is currently only a launcher/status widget.
It is not the real Oyon interface.

That is the right direction, but the current miniature still needs to be
fixed. It should not pretend to replace Oyon settings, analytics, logs, or
capture controls. It should be a compact, useful bridge into the full Oyon
application.

## What Is Wrong With The Current Miniature

The current miniature is too limited and confusing:

- It does not show enough useful live capture state.
- It does not clearly distinguish Rohy-linked data from standalone Oyon data.
- Its analytics summary is too shallow.
- It does not show whether Oyon capture is currently active, paused, stopped,
  unavailable, or disabled.
- It does not show whether the current Rohy session has consent.
- It does not show whether records are being saved into Rohy.
- It opens Oyon in a new tab, but does not pass Rohy context to Oyon yet.
- The full Oyon app still behaves mostly as standalone local Oyon.
- The full Oyon app does not yet write directly into Rohy through the attached
  session context.

## Intended Design

Rohy should keep a compact Oyon widget, but it should only do three things:

1. Show a concise status summary.
2. Open the full Oyon capture app.
3. Open the full Oyon analytics/logs page.

The full Oyon app should remain responsible for:

- camera capture,
- model selection,
- settings,
- smoothing controls,
- operations/logs,
- DynaJ/analytics,
- export,
- local diagnostic views.

Rohy should remain responsible for:

- authenticated user,
- tenant,
- current session,
- current case,
- consent records,
- saving aggregate emotion windows to the Rohy database,
- admin/student permissions.

## Needed Miniature Fixes

The Rohy miniature should show:

- Oyon availability: `ready`, `disabled`, `unavailable`, or `standalone only`.
- Current Rohy session id.
- Current case name/id.
- Consent state for the current session.
- Latest saved emotion record for the current session.
- Number of saved records for the current session.
- Last save time.
- Last save status: `saving`, `saved`, `failed`, or `not linked`.
- A clear button: `Open Oyon`.
- A clear button: `Open Oyon Analytics`.
- A new-tab icon for each full Oyon surface.

The miniature should not contain:

- custom Oyon settings forms,
- recreated analytics dashboards,
- recreated capture controls,
- small embedded iframes,
- partial versions of the Oyon UI.

## Needed Full Oyon Wiring

The next real work is to make the full Oyon app launched from Rohy receive
Rohy context.

When Rohy opens Oyon, it should pass:

```text
session_id
case_id
tenant_id
user_id
token or cookie-auth context
source=rohy
api_base=/api/addons/oyon
```

Recommended launch URL:

```text
/oyon/standalone/?source=rohy&session_id=<id>&case_id=<id>
```

Do not put secrets in the query string. Auth should come from same-origin
cookies or existing Rohy auth headers where possible.

Oyon standalone should detect `source=rohy` and switch from:

```text
LocalEmotionTransport
```

to:

```text
HttpEmotionTransport('/api/addons/oyon/emotion-records')
```

It should also use:

```text
/api/addons/oyon/consent
/api/addons/oyon/config
```

instead of only local browser storage.

## Backend Work Still Needed

The current Rohy backend already has basic Oyon routes, but it needs more:

- Confirm `POST /api/addons/oyon/emotion-records` accepts full Oyon windows
  from the real standalone app.
- Add a current-session summary endpoint for the miniature:

```text
GET /api/addons/oyon/session/:sessionId/summary
```

Suggested response:

```json
{
  "enabled": true,
  "session_id": "483",
  "case_id": "12",
  "consent_granted": true,
  "record_count": 42,
  "latest_emotion": "neutral",
  "latest_confidence": 0.82,
  "latest_window_start": "2026-05-08T20:00:00.000Z",
  "latest_save_status": "saved"
}
```

- Add a session-scoped records endpoint:

```text
GET /api/addons/oyon/sessions/:sessionId/emotion-records
```

- Keep all routes behind `OYON_ENABLED=1`.
- If Oyon fails, Rohy must continue normally.

## Frontend Work Still Needed

Update `src/components/oyon/OyonCaptureWidget.jsx` so it:

- uses a real summary endpoint instead of rough admin-live data,
- opens Oyon with current session/case context,
- shows clear status labels,
- hides or degrades gracefully when there is no active session,
- never blocks the Rohy simulator,
- never embeds the full Oyon app in a tiny panel.

The launch buttons should be:

```text
Open Oyon
Open Analytics
```

Both should open new tabs.

## Acceptance Criteria

The integration is acceptable when:

1. Rohy loads normally with `OYON_ENABLED` unset.
2. Rohy loads normally with `OYON_ENABLED=1`.
3. The miniature widget is informative but not a substitute for Oyon.
4. Clicking `Open Oyon` opens the real full Oyon app.
5. Clicking `Open Analytics` opens the real Oyon analytics/logs page.
6. Oyon launched from Rohy knows the active Rohy session and case.
7. Oyon saves aggregate emotion records into Rohy's `oyon_emotion_records`.
8. Admins can view records.
9. Students can view their records only when enabled.
10. Camera/model/save failures never break Rohy.

## Do Not Repeat

Do not rebuild Oyon inside Rohy.

Do not make tiny versions of Oyon settings, analytics, or capture UI.

Do not use an iframe as the primary integration unless there is a clear reason.

The correct model is:

```text
Rohy miniature = status + launch
OyonR full app = real capture/settings/analytics experience
Rohy backend = authenticated storage and permissions
```

