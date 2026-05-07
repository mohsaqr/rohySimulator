# Client Hooks Audit

Files reviewed:
- `src/hooks/useAlarms.js`
- `src/hooks/useDiscussionEngine.js`
- `src/hooks/useTreatmentEffects.js`

Enterprise assessment:
- `useDiscussionEngine` has tests.
- `useAlarms` delegates notification persistence/routing to the notification center and keeps alarm threshold logic localized.
- `useTreatmentEffects` polls backend active effects and recalculates locally.

Findings:
- Fixed: `useAlarms` now has direct unit tests for threshold loading, first breach notification, backend overrides, disabled flags, severe/critical classification, ack-before-resolve latching, derived lists, and config save auth.
- Fixed: `useTreatmentEffects` now has direct unit tests for bearer-auth fetches, disabled/no-session clearing, backend errors, manual refresh, and aggregate application.
- Medium: `useTreatmentEffects` uses a singleton engine. This is efficient but can leak active treatment state between sessions if disabled/no-session paths are missed; the disabled/no-session behavior is now covered.
- Low: hooks read auth tokens directly from `localStorage` rather than through a shared client boundary.

Recommended next tests:
- Add periodic refresh timer tests for `useAlarms`.
- Add session-change tests for `useTreatmentEffects` across two non-null session IDs.

Status:
- Added hook tests for `useAlarms` and `useTreatmentEffects`.
