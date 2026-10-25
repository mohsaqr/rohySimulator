// Course settings keys with a contract (server/shared/courseSettings.js):
//   oyon_sensing_enabled — boolean (absent = false)
//   agreement            — null or { title ≤200 chars, body Markdown ≤64 KB },
//                          trimmed; an empty body is stored as no agreement
// validated on POST /cohorts and PATCH /cohorts/:id (settings stays a
// whole-object replace). GET /cohorts/mine gives a learner exactly those two
// keys of each course's settings — nothing else from the blob.
//
// Regression lock: bad types and oversize values are 400 invalid_course_settings
// and leave the stored settings untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { mintToken, openDb, closeDb, run, get } from '../utils/authHttp.js';

const SECRET = 'cohort-course-settings-secret';

describe('course settings: Oyon sensing + agreement', () => {
    let server;
    let eduTok, stuTok;
    let stuId;

    const call = async (tok, method, path, body) => {
        const res = await fetch(`${server.baseUrl}/api${path}`, {
            method,
            headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
    };
    const create = (settings) => call(eduTok, 'POST', '/cohorts', { name: `c-${Math.random()}`, settings });
    const storedSettings = async (id) => {
        const db = await openDb(server.dbPath);
        try { return JSON.parse((await get(db, 'SELECT settings FROM cohorts WHERE id = ?', [id])).settings || 'null'); } finally { await closeDb(db); }
    };

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET } });
        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['cs_edu', 'educator'], ['cs_stu', 'student']]) {
            await run(db, `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                           VALUES (?, ?, ?, ?, ?, 'active', 1)`, [u, u, pwd, `${u}@example.com`, role]);
        }
        const eduId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['cs_edu'])).id;
        stuId = (await get(db, 'SELECT id FROM users WHERE username = ?', ['cs_stu'])).id;
        await closeDb(db);
        eduTok = await mintToken(server.dbPath, { id: eduId, username: 'cs_edu', role: 'educator', tenant_id: 1 }, SECRET, { jti: 'cse' });
        stuTok = await mintToken(server.dbPath, { id: stuId, username: 'cs_stu', role: 'student', tenant_id: 1 }, SECRET, { jti: 'css' });
    });

    afterAll(async () => { if (server) await server.close(); });

    it.each([
        ['oyon_sensing_enabled as a string', { oyon_sensing_enabled: 'yes' }],
        ['oyon_sensing_enabled as 1', { oyon_sensing_enabled: 1 }],
        ['agreement as a string', { agreement: 'read this' }],
        ['agreement as an array', { agreement: [] }],
        ['agreement without a body', { agreement: { title: 'T' } }],
        ['agreement title not a string', { agreement: { title: 5, body: 'x' } }],
        ['agreement title over 200 chars', { agreement: { title: 'a'.repeat(201), body: 'x' } }],
        ['agreement body over 64 KB', { agreement: { title: 'T', body: 'a'.repeat(64 * 1024 + 1) } }],
    ])('POST rejects %s', async (_label, settings) => {
        const res = await create(settings);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_course_settings');
        expect(typeof res.body.error).toBe('string');
    });

    it('POST saves valid keys trimmed, keeping other settings keys', async () => {
        const res = await create({
            oyon_sensing_enabled: true,
            default_case_access: true,
            agreement: { title: '  Research information  ', body: '\n## Purpose\n\nWe study learning.\n\n' },
        });
        expect(res.status).toBe(201);
        expect(await storedSettings(res.body.cohort.id)).toEqual({
            oyon_sensing_enabled: true,
            default_case_access: true,
            agreement: { title: 'Research information', body: '## Purpose\n\nWe study learning.' },
        });
    });

    it('an empty agreement body is stored as no agreement; a 64 KB body is accepted', async () => {
        const empty = await create({ agreement: { title: 'Rules', body: '   \n ' } });
        expect(empty.status).toBe(201);
        expect(await storedSettings(empty.body.cohort.id)).toEqual({ agreement: null });
        const full = await create({ agreement: { title: '', body: 'a'.repeat(64 * 1024) } });
        expect(full.status).toBe(201);
    });

    it('PATCH validates too and leaves stored settings untouched on a bad value', async () => {
        const made = await create({ oyon_sensing_enabled: true });
        const id = made.body.cohort.id;
        const bad = await call(eduTok, 'PATCH', `/cohorts/${id}`, { name: 'x', settings: { oyon_sensing_enabled: 'true' } });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('invalid_course_settings');
        expect(await storedSettings(id)).toEqual({ oyon_sensing_enabled: true });
        const good = await call(eduTok, 'PATCH', `/cohorts/${id}`, {
            name: 'x', settings: { oyon_sensing_enabled: false, agreement: { title: 'T', body: ' Body ' } },
        });
        expect(good.status).toBe(200);
        expect(await storedSettings(id)).toEqual({ oyon_sensing_enabled: false, agreement: { title: 'T', body: 'Body' } });
    });

    it('GET /cohorts/mine gives a learner the agreement and the Oyon flag only', async () => {
        const made = await create({
            oyon_sensing_enabled: true,
            teacher_private_note: 'do not show',
            agreement: { title: 'Course rules', body: 'Be kind.' },
        });
        const plain = await create({ default_case_access: true });
        const db = await openDb(server.dbPath);
        await run(db, 'INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)', [made.body.cohort.id, stuId]);
        await run(db, 'INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)', [plain.body.cohort.id, stuId]);
        await closeDb(db);

        const res = await call(stuTok, 'GET', '/cohorts/mine');
        expect(res.status).toBe(200);
        const mine = res.body.cohorts.find((c) => c.id === made.body.cohort.id);
        const other = res.body.cohorts.find((c) => c.id === plain.body.cohort.id);
        expect(mine.oyon_sensing_enabled).toBe(true);
        expect(mine.agreement).toEqual({ title: 'Course rules', body: 'Be kind.' });
        expect(mine).not.toHaveProperty('settings');
        expect(JSON.stringify(res.body)).not.toContain('do not show');
        expect(other.oyon_sensing_enabled).toBe(false);
        expect(other.agreement).toBeNull();
    });
});
