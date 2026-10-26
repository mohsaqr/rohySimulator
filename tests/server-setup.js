// Global setup for the server (node) test project.
//
// Loaded by vitest.config.js before any server test module is imported.
//
// Why this exists: server/middleware/auth.js fails fast — it calls
// process.exit(1) at import time if JWT_SECRET is unset. Locally a
// developer's server/.env supplies it, but CI has no server/.env, so any
// server test that imports an auth-touching module *in-process* (e.g. the
// parseChangelog unit tests in help-routes.test.js, which import
// server/routes/help-routes.js → auth.js) silently killed the vitest
// worker with "process.exit unexpectedly called with 1". Spawned-server
// tests (startTestServer) were unaffected because the child gets its own
// env — which is why 150 tests passed and only the in-process importers
// failed.
//
// `??=` so a real environment / server/.env still wins; this only fills
// the gap when nothing else set it. 64 chars keeps validateEnv-style
// length checks quiet too.
process.env.JWT_SECRET ??=
    'test-only-jwt-secret-do-not-use-in-production-0123456789abcdefXX';

// Tests assert development/production behaviour explicitly; default the
// node test env to 'test' only if the harness didn't set it.
process.env.NODE_ENV ??= 'test';

// In-process importers of server/db.js (anything that pulls in a route module
// directly, not via startTestServer) open whatever ROHY_DB names — and db.js
// reads it at module-load time. Without a default that is the developer's
// live server/database.sqlite, which then gets migrated and seeded by a unit
// test (observed 2026-10-26: migrations 0072–0074 landed on the dev DB from a
// test run). Point it at a per-worker temp file unless the harness set one.
// Regression lock: a unit test must never open the developer's dev database.
if (!process.env.ROHY_DB) {
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    process.env.ROHY_DB = join(mkdtempSync(join(tmpdir(), 'rohy-unit-db-')), 'unit.sqlite');
}
