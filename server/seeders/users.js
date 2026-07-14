/**
 * User Seeder
 * Seeds the first users when the database is empty.
 *
 * Two bootstrap paths, because a fresh production install must be able to reach
 * an admin account without ever shipping a well-known password:
 *
 *   1. Operator-provisioned (ROHY_ADMIN_USERNAME + ROHY_ADMIN_PASSWORD) — seeds
 *      a single admin with the operator's own credentials. Allowed in production.
 *   2. Development defaults (admin/admin123 + student/student123) — refused in
 *      production unless ALLOW_DEFAULT_USERS=1.
 *
 * If neither applies, the instance boots with zero users and the first account
 * registered through the UI claims it as admin (see routes/auth-routes.js).
 */

import bcrypt from 'bcrypt';
import { logger } from '../logger.js';
import { validatePassword } from '../routes/_helpers.js';

const seederLog = logger('seeder');

export const defaultUsers = [
    {
        username: 'admin',
        name: 'System Administrator',
        email: 'admin@rohy.local',
        password: 'admin123',
        role: 'admin'
    },
    {
        username: 'student',
        name: 'Demo Student',
        email: 'student@rohy.local',
        password: 'student123',
        role: 'student'
    }
];

/**
 * Read the ROHY_ADMIN_* environment. These stay as direct member reads on the
 * process environment because scripts/docs-gen/gen-config.mjs discovers
 * variables by statically scanning source for exactly that shape — route the
 * lookup through an injected object and the variable silently disappears from
 * the generated config reference (which is what happened to ALLOW_DEFAULT_USERS
 * on the first cut of this change).
 *
 * @returns {{username?: string, password?: string, email?: string, name?: string}}
 */
export function adminEnv() {
    return {
        username: process.env.ROHY_ADMIN_USERNAME,
        password: process.env.ROHY_ADMIN_PASSWORD,
        email: process.env.ROHY_ADMIN_EMAIL,
        name: process.env.ROHY_ADMIN_NAME
    };
}

/**
 * The operator-provisioned admin described by the environment, or null when the
 * environment does not ask for one. Carries no well-known password, which is
 * why — unlike `defaultUsers` — it is allowed to seed in production.
 *
 * @param {Object} vars - Admin env values (defaults to adminEnv())
 * @returns {Object|null} A user record shaped like `defaultUsers` entries
 */
export function provisionedAdmin(vars = adminEnv()) {
    const username = (vars.username || '').trim();
    const password = vars.password || '';
    if (!username || !password) return null;

    return {
        username,
        name: (vars.name || '').trim() || 'System Administrator',
        email: (vars.email || '').trim() || `${username}@rohy.local`,
        password,
        role: 'admin'
    };
}

/**
 * Seed users into the database
 * @param {Object} db - SQLite database instance
 * @returns {Promise<{seeded: number, skipped: number, blocked?: boolean, provisioned?: boolean}>}
 */
export async function seedUsers(db) {
    const provisioned = provisionedAdmin();

    // An operator-provisioned admin uses the operator's own password, so the
    // production guard below does not apply to it — but a weak one would lock
    // them out at the login screen (same policy as /auth/register), so refuse
    // it loudly rather than seeding an account that cannot be used.
    if (provisioned) {
        const check = validatePassword(provisioned.password);
        if (!check.valid) {
            seederLog.error('ROHY_ADMIN_PASSWORD rejected', { errors: check.errors });
            return { seeded: 0, skipped: 0, blocked: true, provisioned: true };
        }
    }

    const toSeed = provisioned ? [provisioned] : defaultUsers;

    return new Promise((resolve, reject) => {
        // Refuse to seed default credentials in production unless explicitly
        // overridden — admin123/student123 is a dev convenience that must
        // never silently land in a real deployment.
        if (!provisioned && process.env.NODE_ENV === 'production' && process.env.ALLOW_DEFAULT_USERS !== '1') {
            seederLog.warn('default user seeding blocked in production', {
                hint: 'set ROHY_ADMIN_USERNAME + ROHY_ADMIN_PASSWORD to provision an admin, or register the first account through the UI to claim the instance'
            });
            resolve({ seeded: 0, skipped: 0, blocked: true });
            return;
        }

        // Check if any users exist
        db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (row.count > 0) {
                seederLog.info('user seeding skipped', { existing_users: row.count });
                resolve({ seeded: 0, skipped: row.count });
                return;
            }

            seederLog.info('no users found, seeding', { provisioned: Boolean(provisioned) });

            let seeded = 0;
            const errors = [];

            for (const user of toSeed) {
                try {
                    const password_hash = await bcrypt.hash(user.password, 10);

                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status, created_at)
                             VALUES (?, ?, ?, ?, ?, 1, 'active', CURRENT_TIMESTAMP)`,
                            [user.username, user.name, user.email, password_hash, user.role],
                            function(err) {
                                if (err) {
                                    rej(err);
                                } else {
                                    seederLog.info('default user created', {
                                        role: user.role,
                                        username: user.username
                                    });
                                    seeded++;
                                    res();
                                }
                            }
                        );
                    });
                } catch (e) {
                    seederLog.error('default user create failed', { username: user.username, error: e.message });
                    errors.push(e);
                }
            }

            if (errors.length > 0 && seeded === 0) {
                reject(new Error('Failed to seed any users'));
            } else {
                resolve({ seeded, skipped: 0, provisioned: Boolean(provisioned) });
            }
        });
    });
}

export default seedUsers;
