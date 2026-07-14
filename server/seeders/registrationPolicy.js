/**
 * Registration-policy seeder — FRESH INSTALLS ONLY.
 *
 * A brand-new instance should not be wide open the moment it is reachable, so
 * a fresh database is seeded to a safe mode. An EXISTING install must never be
 * touched: it has no `registration_mode` row, absent means 'open', and 'open'
 * is exactly what it has always done. Changing that under an operator who never
 * asked would lock their users out.
 *
 * That distinction is the whole reason this lives in the seeders (which run
 * only via `needsSeeding()` → users table empty) rather than in the boot-time
 * `setSettingIfEmpty()` path used for `tts_provider`. setSettingIfEmpty is
 * idempotent per KEY, not per INSTALL: it would happily insert this row on an
 * upgraded install that simply never had it, flipping a working open instance
 * to closed on restart. Do not "simplify" it that way.
 *
 * Phase 1 seeds 'closed' (admins create users). When the approval queue lands,
 * this becomes 'approval' — strangers may ask, nobody gets in unreviewed.
 */

import { logger } from '../logger.js';

const seederLog = logger('seeder');

export const FRESH_INSTALL_REGISTRATION_MODE = 'closed';

/**
 * @param {Object} db - SQLite database instance
 * @returns {Promise<{seeded: number, skipped: number}>}
 */
export function seedRegistrationPolicy(db) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'registration_mode'`,
            (err, row) => {
                if (err) return reject(err);

                // Someone already decided. Never overwrite an explicit choice.
                if (row) {
                    seederLog.info('registration policy seeding skipped', { existing: row.setting_value });
                    return resolve({ seeded: 0, skipped: 1 });
                }

                db.run(
                    `INSERT INTO platform_settings (setting_key, setting_value) VALUES ('registration_mode', ?)`,
                    [FRESH_INSTALL_REGISTRATION_MODE],
                    (insertErr) => {
                        if (insertErr) return reject(insertErr);
                        seederLog.info('fresh install: registration policy seeded', {
                            mode: FRESH_INSTALL_REGISTRATION_MODE,
                            note: 'the first account still claims this instance as admin (bootstrap bypasses the policy)'
                        });
                        resolve({ seeded: 1, skipped: 0 });
                    }
                );
            }
        );
    });
}

export default seedRegistrationPolicy;
