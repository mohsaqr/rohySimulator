# Server Database And Migrations Audit

Files reviewed:
- `server/db.js`
- `server/dbAdapter.js`
- `server/migrationRunner.js`
- `migrations/*.sql`
- `scripts/audit-*.sh`

Enterprise assessment:
- A versioned migration runner and audit scripts exist.
- Structural enterprise stages E1-E9 are documented as complete in `ENTERPRISE_AUDIT.md`.
- `server/dbAdapter.js` provides a Promise surface and transaction helper for future portability, but route code still uses callback SQLite directly in many places.

Findings:
- Fixed: application startup previously reported database readiness while default seed writes were still queued through callback APIs. `server/db.js` now awaits those default seed writes before resolving `dbReady`.
- Medium: application startup still imports seed scripts and performs first-boot seeding/migrations in `server/db.js`. This is practical for development but should be separated from request-serving startup for enterprise deploys.
- Medium: the database adapter is not yet the dominant persistence boundary. Direct `db.get/all/run` in route code makes future DB portability and consistent query timing harder.
- Low: SQLite is still the runtime database, with portability documented but not implemented.

Recommended next tests:
- Keep migration idempotency tests and add downgrade/dirty-database tests around failed migrations.
- Add adapter conformance tests for `transaction`, `upsert`, and rollback behavior.
- Add a static test that reports direct `db.*` use outside approved infrastructure modules.

Status:
- Fixed `dbReady`/default seeding readiness semantics in `server/db.js`.
