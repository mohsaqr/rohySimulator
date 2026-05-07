# Client Settings And Admin Audit

Files reviewed:
- `src/components/settings/*`
- `src/components/auth/*`
- `src/components/debug/DiagnosticBar.jsx`

Enterprise assessment:
- Several settings controls have tests, including persona editor, avatar/voice picker, config panel, and test voice button.
- Admin-only actions generally call protected server endpoints and use bearer auth.
- Diagnostic bar masks API key display.

Findings:
- Medium: some admin settings modules still own direct fetch logic and token handling. Centralizing through a typed API client would reduce missing-auth and inconsistent-error risks.
- Medium: high-impact editors such as lab tests, medications, radiology, physical exam, and clinical records have little direct test coverage.
- Low: diagnostic tooling is gated by localStorage and can reveal operational metadata to someone with browser access. It masks secrets, but enterprise deployments should decide whether this is allowed outside development/admin roles.

Recommended next tests:
- Add component tests for lab test manager, medication manager, radiology editor, physical exam editor, and clinical records editor.
- Add tests that non-admin users cannot see or trigger admin-only settings actions.
- Add diagnostic bar tests for secret masking and role/tenant visibility expectations.

Status:
- No code change made in this module during this pass.
