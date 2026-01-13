/**
 * Database Seeder
 * Seeds the database with default data when empty
 *
 * Usage:
 *   - Automatically runs on server startup if database is empty
 *   - Can also be run manually: node server/seeders/index.js
 */

import { seedUsers, defaultUsers } from './users.js';
import { seedCases, defaultCases } from './cases.js';

/**
 * Run all seeders
 * @param {Object} db - SQLite database instance
 * @returns {Promise<Object>} Summary of seeding results
 */
export async function runSeeders(db) {
    console.log('\n========================================');
    console.log('  Database Seeder Starting...');
    console.log('========================================\n');

    const results = {
        users: { seeded: 0, skipped: 0, error: null },
        cases: { seeded: 0, skipped: 0, error: null }
    };

    // Seed users first
    try {
        results.users = await seedUsers(db);
    } catch (err) {
        console.error('[Seeder] Error seeding users:', err.message);
        results.users.error = err.message;
    }

    // Seed cases
    try {
        results.cases = await seedCases(db);
    } catch (err) {
        console.error('[Seeder] Error seeding cases:', err.message);
        results.cases.error = err.message;
    }

    // Summary
    console.log('\n========================================');
    console.log('  Seeder Summary');
    console.log('========================================');
    console.log(`  Users:  ${results.users.seeded} seeded, ${results.users.skipped} skipped`);
    console.log(`  Cases:  ${results.cases.seeded} seeded, ${results.cases.skipped} skipped`);

    if (results.users.seeded > 0) {
        console.log('\n  Default Credentials:');
        defaultUsers.forEach(u => {
            console.log(`    ${u.role.padEnd(8)} - ${u.username} / ${u.password}`);
        });
    }

    console.log('========================================\n');

    return results;
}

/**
 * Check if database needs seeding (is empty)
 * @param {Object} db - SQLite database instance
 * @returns {Promise<boolean>}
 */
export function needsSeeding(db) {
    return new Promise((resolve, reject) => {
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
