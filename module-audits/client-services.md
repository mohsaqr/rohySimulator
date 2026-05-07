# Client Services Audit

Files reviewed:
- `src/services/AgentService.js`
- `src/services/authService.js`
- `src/services/discussionService.js`
- `src/services/eventLogger.js`
- `src/services/llmService.js`
- `src/services/notesService.js`
- `src/services/voiceService.js`
- `src/services/TreatmentEffects/*`
- `src/services/PatientRecord/*`

Enterprise assessment:
- Auth, agent, discussion, event logger, LLM, and voice services have unit tests.
- Service tests assert auth headers for key request wrappers.

Findings:
- High: `patientRecordSync` previously omitted bearer auth on protected read/event/delete endpoints. Fixed in this pass and covered by `src/services/PatientRecord/patientRecordSync.test.js`.
- Medium: service modules directly read `localStorage` in multiple places. This makes token handling inconsistent and complicates future migration to cookies or refresh-token flow.
- Medium: error handling style varies by service: some throw, some return null/empty arrays, and some log and suppress. Enterprise consumers need consistent failure contracts.

Tests added:
- `src/services/PatientRecord/patientRecordSync.test.js` proves protected patient-record endpoints send `Authorization: Bearer ...`.
- `src/services/TreatmentEffects/TreatmentEffectsEngine.test.js` covers treatment summary grouping and vital clamping.

Status:
- Fixed patient-record auth header gap.
- Fixed treatment summary type preservation in the TreatmentEffects module.
