/**
 * Database Seeder
 * Seeds the database with default data when empty
 *
 * Usage:
 *   - Automatically runs on server startup if database is empty
 *   - Can also be run manually: node server/seeders/index.js
 *
 * The Basic course (default class + STEMI lesson/MCQ/survey + default-case
 * link) is part of the fresh-DB seed CONTRACT but is created by
 * server/seedStemiCourse.js, which server.js runs unconditionally right
 * after these seeders — migration 0031 no-ops on fresh installs because it
 * runs before any users exist. Contract pinned by
 * tests/server/seed-basic-course.test.js.
 */

import { seedUsers, defaultUsers } from './users.js';
import { seedCases, defaultCases } from './cases.js';
import { seedRegistrationPolicy } from './registrationPolicy.js';
import { logger } from '../logger.js';

const seederLog = logger('seeder');

/**
 * Run all seeders
 * @param {Object} db - SQLite database instance
 * @returns {Promise<Object>} Summary of seeding results
 */
export async function runSeeders(db) {
    seederLog.info('database seeding started');

    const results = {
        users: { seeded: 0, skipped: 0, error: null },
        cases: { seeded: 0, skipped: 0, error: null },
        registration: { seeded: 0, skipped: 0, error: null }
    };

    // Seed users first
    try {
        results.users = await seedUsers(db);
    } catch (err) {
        seederLog.error('user seeding failed', { error: err.message });
        results.users.error = err.message;
    }

    // Seed cases
    try {
        results.cases = await seedCases(db);
    } catch (err) {
        seederLog.error('case seeding failed', { error: err.message });
        results.cases.error = err.message;
    }

    // A fresh install should not be wide open on first boot. Non-fatal: if this
    // fails the instance falls back to 'open' (absent = open), which is the
    // pre-feature behaviour — never a hard boot failure over a default.
    try {
        results.registration = await seedRegistrationPolicy(db);
    } catch (err) {
        seederLog.error('registration policy seeding failed', { error: err.message });
        results.registration.error = err.message;
    }

    // Only the dev-default path creates the well-known accounts worth naming in
    // the boot log; a provisioned admin is the operator's own credential.
    const namedDefaults = results.users.seeded > 0 && !results.users.provisioned
        ? defaultUsers.map((u) => ({ role: u.role, username: u.username }))
        : [];

    seederLog.info('database seeding completed', {
        users_seeded: results.users.seeded,
        users_skipped: results.users.skipped,
        users_provisioned: Boolean(results.users.provisioned),
        cases_seeded: results.cases.seeded,
        cases_skipped: results.cases.skipped,
        default_users_created: namedDefaults
    });

    return results;
}

/**
 * Check if database needs seeding (is empty)
 * @param {Object} db - SQLite database instance
 * @returns {Promise<boolean>}
 */
export function needsSeeding(db) {
    return new Promise((resolve, _reject) => {
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err) {
                // Table might not exist yet
                resolve(true);
            } else {
                resolve(row.count === 0);
            }
        });
    });
}

export { seedUsers, seedCases, defaultUsers, defaultCases };

export default runSeeders;
