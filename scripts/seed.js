#!/usr/bin/env node
/**
 * Standalone seed runner.
 *
 * Audit finding #8: separates first-boot seeding from the request-serving
 * process. In production deploys you can set ROHY_NO_AUTO_SEED=1 on the
 * server process and run this script as a one-off job (e.g. a deploy hook)
 * to populate the database without coupling seeding to the listening
 * lifecycle.
 *
 *   ROHY_NO_AUTO_SEED=1 node server/server.js     # serves requests, no seed
 *   node scripts/seed.js                          # one-off seed
 *
 * Idempotent — every seeder is INSERT OR IGNORE / NOT EXISTS-guarded, so
 * running this twice does not duplicate rows.
 */

import { dbReady, runDbMigrations, seedDbDefaults } from '../server/db.js';

async function main() {
    // Wait for the singleton DB connection (and any auto-migration the
    // import-time bootDb already started) to settle before we run our own
    // pass. dbReady resolves whether or not auto-seed was enabled.
    await dbReady;
    await runDbMigrations();
    await seedDbDefaults();
    console.log('[seed] done.');
    // The sqlite connection holds the event loop open; force exit so the
    // CI / deploy hook that invoked us doesn't hang.
    process.exit(0);
}

main().catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exit(1);
});
