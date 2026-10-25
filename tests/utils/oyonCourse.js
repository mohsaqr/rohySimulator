// Oyon course gate fixture (server/lib/oyonSensingGate.js): a learner may be
// sensed only while an active member of a live course that enables Oyon.
// Suites that ingest Oyon data as a student enrol that student here, so the
// gate stays fully enforced and the fixture says why the writes are allowed.
import { run } from './authHttp.js';

/**
 * Create a live course in `tenant` with `settings.oyon_sensing_enabled: true`
 * and enrol `userId` as an active member. Returns the new cohort id.
 *
 * @param {import('sqlite3').Database} db  a raw sqlite3 handle on the test DB
 * @param {number} userId
 * @param {{ tenant?: number, ownerId?: number, settings?: object, name?: string }} [opts]
 */
export async function enrollInSensingCourse(db, userId, { tenant = 1, ownerId = userId, settings, name } = {}) {
    const r = await run(
        db,
        `INSERT INTO cohorts (name, owner_user_id, tenant_id, settings) VALUES (?, ?, ?, ?)`,
        [name || `oyon-course-${userId}-${tenant}`, ownerId, tenant, JSON.stringify(settings || { oyon_sensing_enabled: true })]
    );
    await run(db, `INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`, [r.lastID, userId]);
    return r.lastID;
}
