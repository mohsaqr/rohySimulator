// Put a case in the tenant's default course (the one boot seeds, `is_default = 1`).
//
// Course access is enforced by default: a student sees a case only through a
// course they belong to. A test student who belongs to no other course is
// auto-enrolled into the default course at login — exactly like someone who
// registered themselves — so a case placed here is one they can open. Use this
// in tests about WHAT a student receives from a case, so they reach it the way
// a real learner does instead of switching course access off.
import sqlite3 from 'sqlite3';

export async function putInDefaultCourse(dbPath, caseId, tenantId = 1) {
    const db = await new Promise((resolve, reject) => {
        const handle = new (sqlite3.verbose()).Database(dbPath, (err) => (err ? reject(err) : resolve(handle)));
    });
    try {
        const changes = await new Promise((resolve, reject) => db.run(
            `INSERT INTO cohort_cases (cohort_id, case_id)
             SELECT id, ? FROM cohorts WHERE tenant_id = ? AND is_default = 1 AND deleted_at IS NULL`,
            [caseId, tenantId],
            function done(err) { if (err) reject(err); else resolve(this.changes); },
        ));
        if (changes !== 1) throw new Error(`putInDefaultCourse(${caseId}): tenant ${tenantId} has no default course`);
    } finally {
        await new Promise((resolve) => db.close(() => resolve()));
    }
}
