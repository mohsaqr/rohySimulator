# Rohy Enterprise Module Audit Index

Date: 2026-05-06

Scope reviewed:
- Server API, auth/RBAC/tenant controls, database/migrations, TTS/proxy services, observability, and catalogue routes.
- Client application shell, auth/session state, clinical workflow components, services, hooks, notifications, analytics, settings, utilities, and patient record modules.
- Nested `medkit-app` package at source and package-script level.

Method:
- Static module review using repository files, route inventory, test inventory, high-risk pattern search, and representative source reads.
- Targeted fixes and tests were added where a concrete behavioral gap was found during review.

Test additions from this audit:
- `src/services/PatientRecord/patientRecordSync.test.js`
- `src/services/TreatmentEffects/TreatmentEffectsEngine.test.js`
- `tests/server/route-auth-allowlist.test.js`
- `src/services/PatientRecord/PatientRecord.test.js`
- `src/notifications/routing.test.js`
- `src/hooks/useAlarms.test.js`
- `src/hooks/useTreatmentEffects.test.js`

Targeted fixes from this audit:
- Patient record read/event/delete client calls now send bearer auth headers.
- Treatment effect summaries now preserve `treatment_type` so by-type counts are accurate.
- Server database readiness now waits for default seed writes, removing late SQLite writes during tests/startup.

Module reports:
- `server-api.md`
- `server-auth-rbac-tenancy.md`
- `server-database-migrations.md`
- `server-services-tts-proxies.md`
- `client-app-shell-auth-session.md`
- `client-clinical-workflows.md`
- `client-services.md`
- `client-hooks.md`
- `client-notifications.md`
- `client-settings-admin.md`
- `client-analytics-tna.md`
- `client-utils-data.md`
- `patient-record.md`
- `medkit-app.md`
- `testing-strategy.md`
