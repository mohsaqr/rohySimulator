# Client Analytics And TNA Audit

Files reviewed:
- `src/components/analytics/*`
- `src/components/analytics/tna/*`
- `tests/server/analytics-tna.test.js`

Enterprise assessment:
- Server analytics TNA has test coverage.
- Client TNA utilities wrap `dynajs` and provide compatibility for legacy dashboards.
- Dashboard components query protected analytics endpoints with bearer auth.

Findings:
- Medium: analytics dashboards render complex derived data with limited client-side tests. Regressions in filter parameters, empty data, and partial endpoint failure are likely to be caught late.
- Low: `tnaUtils.centralities()` creates a dummy `tnajTna` model that is not used. This is harmless but confusing and should be removed in a cleanup pass.
- Low: legacy and replacement TNA dashboards coexist, increasing maintenance cost.

Recommended next tests:
- Add unit tests for `tnaUtils` cluster, prune, max weight, and centrality edge cases.
- Add component tests for empty data, failed requests, and filter changes in TNA dashboards.

Status:
- No code change made in this module during this pass.
