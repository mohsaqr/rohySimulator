# Client Clinical Workflow Components Audit

Files reviewed:
- `src/components/chat/*`
- `src/components/discussion/*`
- `src/components/examination/*`
- `src/components/investigations/*`
- `src/components/monitor/*`
- `src/components/orders/*`
- `src/components/treatments/*`
- `src/components/patient/*`

Enterprise assessment:
- Important UI workflows have some tests: chat, discussion screen, patient monitor, and orders drawer.
- Clinical workflow components feed PatientRecord events, notifications, orders, labs, radiology, and treatment effects.

Findings:
- Medium: several high-risk instructor controls have limited direct tests, including lab value editing, treatment administration/discontinuation, radiology ordering, and physical examination recording.
- Medium: clinical UI logic often performs direct `fetch` calls. A shared API client would centralize auth headers, error handling, retries, and request-id propagation.
- Low: some components mix data fetching, local UI state, and clinical event recording. That makes edge cases harder to test without heavy component mocks.

Recommended next tests:
- Add focused tests for `LabValueEditor`, `TreatmentPanel`, `InvestigationPanel`, and `ManikinPanel`.
- Add tests that verify PatientRecord event creation for order, exam, result view, treatment administration, and alarm acknowledgement.
- Add error-state tests for network failure and unauthorized responses on clinical workflows.

Status:
- No code change made in this module during this pass.
