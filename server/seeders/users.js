/**
 * User Seeder
 * Seeds default admin and student users when database is empty
 */

import bcrypt from 'bcrypt';

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
        role: 'user'
    }
];

/**
 * Seed users into the database
 * @param {Object} db - SQLite database instance
 * @returns {Promise<{seeded: number, skipped: number}>}
 */
export async function seedUsers(db) {
    return new Promise((resolve, reject) => {
        // Check if any users exist
        db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (row.count > 0) {
                console.log(`[Seeder] Users table already has ${row.count} users, skipping user seeding`);
                resolve({ seeded: 0, skipped: row.count });
                return;
            }

            console.log('[Seeder] No users found, seeding default users...');

            let seeded = 0;
            const errors = [];

            for (const user of defaultUsers) {
                try {
                    const password_hash = await bcrypt.hash(user.password, 10);

                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO users (username, name, email, password_hash, role, status, created_at)
                             VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
                            [user.username, user.name, user.email, password_hash, user.role],
                            function(err) {
                                if (err) {
                                    rej(err);
                                } else {
                                    console.log(`[Seeder] Created ${user.role}: ${user.username} (${user.email})`);
                                    seeded++;
                                    res();
                                }
                            }
                        );
                    });
                } catch (e) {
                    console.error(`[Seeder] Failed to create user ${user.username}:`, e.message);
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
