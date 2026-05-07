# Client Notifications Audit

Files reviewed:
- `src/notifications/*`
- `src/notifications/surfaces/*`

Enterprise assessment:
- Notification context has a substantive test suite.
- Storage keys are scoped per user, with one-shot migration from legacy keys.
- Routing rules explicitly distinguish ack, snooze, DND, severity thresholds, source mute, and surface mute.

Findings:
- Medium: critical clinical alarms respect explicit ack and snooze. That is a deliberate clinical UX choice, but it should be covered by tests and documented in safety acceptance criteria.
- Medium: backend persistence is best effort. For enterprise auditability, failure to log clinical alarms should be observable through telemetry or UI diagnostics.
- Low: localStorage remains the source of truth for several notification states, so shared-workstation behavior depends on correct user scoping.

Recommended next tests:
- Add BackendSurface tests for alarm log failure paths and retry/no-retry policy.
- Add migration tests for legacy unscoped notification keys.

Status:
- Added pure routing tests for critical clinical bypass behavior, explicit ack/snooze suppression, non-critical blanket suppression, muted surfaces, and stable key derivation.
