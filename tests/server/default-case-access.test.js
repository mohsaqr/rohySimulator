// Who gets the default case, and who lands in the default course.
//
// The owner's rule (2026-10-13): course access is enforced unless an admin turns
// it off; the default case (`cases.is_default`) is for people who register
// themselves; a student invited into a course gets that course, not the
// default case — unless the course says `settings.default_case_access: true`;
// and a course that does not allow it wins over also being in the default
// course. Every check below goes through the real routes (catalogue, direct
// read, session launch), because those are the doors a student actually uses.
//
// The enforcement switch is never written in this file: the platform_settings
// row is absent, which must read as ON.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'DefaultCaseAccess1!';

function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new (sqlite3.verbose()).Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
const closeDb = (db) => new Promise((resolve) => db.close(() => resolve()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { if (err) reject(err); else resolve(this); }));
const pGet = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    const token = (await res.json()).token;
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

describe('the default case is for people who register themselves', () => {
    let server;
    const ids = {};
    const as = {};

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash(PASSWORD, 4);
        const user = async (name, role = 'student') => (await pRun(db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, ?, 1, 'active')`, [name, name, `${name}@example.com`, hash, role])).lastID;
        const kase = async (name, isDefault = 0) => (await pRun(db,
            `INSERT INTO cases (name, tenant_id, is_available, is_default) VALUES (?, 1, 1, ?)`, [name, isDefault])).lastID;
        const course = async (name, { settings = null, startsAt = null } = {}) => (await pRun(db,
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, settings, starts_at)
             VALUES (?, ?, 1, ?, ?)`, [name, ids.teacher, settings, startsAt])).lastID;
        const member = (cohortId, userId) => pRun(db,
            `INSERT INTO cohort_members (cohort_id, user_id, member_role, status) VALUES (?, ?, 'student', 'active')`,
            [cohortId, userId]);
        const assign = (cohortId, caseId) => pRun(db,
            `INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)`, [cohortId, caseId]);

        try {
            ids.admin = await user('dca-admin', 'admin');
            ids.teacher = await user('dca-teacher', 'educator');

            ids.defaultCase = await kase('Default case', 1);
            ids.languageCase = await kase('Language case in the default course');
            ids.xCase = await kase('Course X case');
            ids.yCase = await kase('Course Y case');
            ids.loose = await kase('In no course');

            // Boot already seeds the tenant's one default course (auto-enrol);
            // it holds the default case, as the boot seeder links it.
            ids.defaultCourse = (await pGet(db,
                `SELECT id FROM cohorts WHERE tenant_id = 1 AND is_default = 1 AND deleted_at IS NULL`)).id;
            await assign(ids.defaultCourse, ids.defaultCase);
            await assign(ids.defaultCourse, ids.languageCase);
            ids.x = await course('Course X (default case off)');
            await assign(ids.x, ids.xCase);
            ids.y = await course('Course Y (default case on)', { settings: JSON.stringify({ default_case_access: true }) });
            await assign(ids.y, ids.yCase);
            ids.z = await course('Course Z (default case assigned)');
            await assign(ids.z, ids.defaultCase);
            ids.later = await course('Course starting next year', { startsAt: '2099-01-01' });
            ids.broken = await course('Course with broken settings', { settings: '{not json' });

            ids.selfReg = await user('dca-self');              // registered themselves: no course yet
            ids.invitedX = await user('dca-invited-x');        // invited into X
            await member(ids.x, ids.invitedX);
            ids.bothDX = await user('dca-default-and-x');      // self-registered first, later added to X
            await member(ids.defaultCourse, ids.bothDX);
            await member(ids.x, ids.bothDX);
            ids.inY = await user('dca-in-y');
            await member(ids.y, ids.inY);
            ids.inXY = await user('dca-in-x-and-y');
            await member(ids.x, ids.inXY);
            await member(ids.y, ids.inXY);
            ids.inZ = await user('dca-in-z');
            await member(ids.z, ids.inZ);
            ids.later = await user('dca-later');
            await member((await pGet(db, `SELECT id FROM cohorts WHERE name = 'Course starting next year'`)).id, ids.later);
            ids.broken = await user('dca-broken');
            await member((await pGet(db, `SELECT id FROM cohorts WHERE name = 'Course with broken settings'`)).id, ids.broken);
        } finally {
            await closeDb(db);
        }

        for (const name of ['dca-admin', 'dca-teacher', 'dca-self', 'dca-invited-x', 'dca-default-and-x',
            'dca-in-y', 'dca-in-x-and-y', 'dca-in-z', 'dca-later', 'dca-broken']) {
            as[name] = await login(server.baseUrl, name);
        }
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    const catalogue = async (who) => {
        const res = await as[who]('/api/cases');
        expect(res.status).toBe(200);
        return (await res.json()).cases.map((c) => c.id);
    };

    it('course access is on when nobody has touched the switch', async () => {
        const res = await as['dca-admin']('/api/platform-settings/cohort-case-enforcement');
        expect(res.status).toBe(200);
        expect((await res.json()).enabled).toBe(true);
        expect(await catalogue('dca-self')).not.toContain(ids.loose);
    });

    it('someone who registered themselves lands in the default course and gets the default case', async () => {
        const visible = await catalogue('dca-self');
        expect(visible).toContain(ids.defaultCase);
        expect(visible).toContain(ids.languageCase);
        expect(visible).not.toContain(ids.xCase);
    });

    // Regression lock: a student invited into a course got the default case and the default course's cases on top of their own
    it('a student invited into a course gets that course only — not the default case, not the default course', async () => {
        const visible = await catalogue('dca-invited-x');
        expect(visible).toEqual([ids.xCase]);
        expect((await as['dca-invited-x'](`/api/cases/${ids.defaultCase}`)).status).toBe(404);
        const launch = await as['dca-invited-x']('/api/sessions', {
            method: 'POST', body: JSON.stringify({ case_id: ids.defaultCase, student_name: 'dca-invited-x' }),
        });
        expect(launch.status).toBe(403);
    });

    it('a course that does not give the default case wins over also being in the default course', async () => {
        const visible = await catalogue('dca-default-and-x');
        expect(visible).not.toContain(ids.defaultCase);
        expect(visible).toContain(ids.languageCase);
        expect(visible).toContain(ids.xCase);
    });

    it('a course that gives the default case gives it, beside its own cases', async () => {
        const visible = await catalogue('dca-in-y');
        expect(visible).toContain(ids.defaultCase);
        expect(visible).toContain(ids.yCase);
        expect(visible).not.toContain(ids.languageCase);
        expect((await as['dca-in-y'](`/api/cases/${ids.defaultCase}`)).status).toBe(200);
        const launch = await as['dca-in-y']('/api/sessions', {
            method: 'POST', body: JSON.stringify({ case_id: ids.defaultCase, student_name: 'dca-in-y' }),
        });
        expect(launch.status).toBe(200);
    });

    it('one course that allows it is enough', async () => {
        expect(await catalogue('dca-in-x-and-y')).toEqual(expect.arrayContaining([ids.defaultCase, ids.xCase, ids.yCase]));
    });

    it('a course the default case is assigned to gives it like any other case', async () => {
        expect(await catalogue('dca-in-z')).toContain(ids.defaultCase);
    });

    it('a course that has not started yet still counts as being invited — no default case meanwhile', async () => {
        expect(await catalogue('dca-later')).toEqual([]);
    });

    it('one course with malformed settings neither grants the default case nor breaks the catalogue', async () => {
        expect(await catalogue('dca-broken')).toEqual([]);
    });

    it('educators still see every case', async () => {
        expect(await catalogue('dca-teacher')).toEqual(expect.arrayContaining(
            [ids.defaultCase, ids.languageCase, ids.xCase, ids.yCase, ids.loose]));
    });

    it('logging in puts only course-less people into the default course', async () => {
        const db = await openDb(server.dbPath);
        const seat = (userId) => pGet(db,
            `SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND user_id = ? AND deleted_at IS NULL`,
            [ids.defaultCourse, userId]);
        try {
            expect((await seat(ids.selfReg)).n).toBe(1);
            expect((await seat(ids.invitedX)).n).toBe(0);
            expect((await seat(ids.inY)).n).toBe(0);
            expect((await seat(ids.bothDX)).n).toBe(1);   // already there; nobody is removed
        } finally {
            await closeDb(db);
        }
    });
});
