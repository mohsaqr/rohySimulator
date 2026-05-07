# Client Utilities And Data Audit

Files reviewed:
- `src/utils/*`
- `src/data/*`
- `src/config/api.js`

Enterprise assessment:
- Utilities for config parsing, persona blocks, sentence splitting, voice fallback/resolution, and clinical state mapping have tests.
- Static data modules are straightforward and low-risk compared with service and route code.

Findings:
- Medium: `parseConfig` returns non-string objects directly. That is intentional, but callers can mutate the returned object if the source was shared. Consider cloning if config objects are reused across contexts.
- Low: static clinical templates and ranges need domain review ownership. Code tests cannot validate clinical correctness.
- Low: API URL config should be covered by environment-specific build smoke tests.

Recommended next tests:
- Add tests for `resolveAvatar`, `avatarFraming`, `visemes`, and `stageDirections` if these drive visible patient behavior.
- Add static-data schema validation tests for scenario templates, lab panels, and investigation templates.

Status:
- No code change made in this module during this pass.
