# Client App Shell, Auth, And Session Audit

Files reviewed:
- `src/App.jsx`
- `src/contexts/AuthContext.jsx`
- `src/services/authService.js`
- `src/config/api.js`

Enterprise assessment:
- Session restore and view restore logic is explicit.
- Auth context clears session-specific local state on logout.
- `AuthService` has a focused unit test suite around login, register, verify, profile, logout, and auth headers.

Findings:
- Medium: JWT is stored in `localStorage`, so any client-side script injection can steal it. Enterprise posture should prefer HttpOnly secure cookies or a short-lived access token plus refresh flow.
- Medium: session/view state is persisted locally. The current code clears key known values, but a storage namespace registry would reduce missed cleanup risk as modules add keys.
- Low: `App.jsx` remains a large coordination component. It would be easier to audit if session lifecycle, case loading, and view routing moved behind hooks.

Recommended next tests:
- Add App-level tests for session restore after invalid session, logout cleanup, and cross-tab localStorage behavior.
- Add a storage namespace test that asserts every `rohy_*` persistent key has a documented owner and cleanup policy.

Status:
- No code change made in this module during this pass.
