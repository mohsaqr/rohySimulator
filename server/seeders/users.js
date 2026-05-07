/**
 * User Seeder
 * Seeds default admin and student users when database is empty
 */

import bcrypt from 'bcrypt';
import { logger } from '../logger.js';

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
 * Seed users into the database
 * @param {Object} db - SQLite database instance
 * @returns {Promise<{seeded: number, skipped: number}>}
 */
export async function seedUsers(db) {
    return new Promise((resolve, reject) => {
        // Refuse to seed default credentials in production unless explicitly
        // overridden — admin123/student123 is a dev convenience that must
        // never silently land in a real deployment.
        if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEFAULT_USERS !== '1') {
            seederLog.warn('default user seeding blocked in production');
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

            seederLog.info('no users found, seeding defaults');

            let seeded = 0;
            const errors = [];

            for (const user of defaultUsers) {
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
                resolve({ seeded, skipped: 0 });
            }
        });
    });
}

export default seedUsers;
