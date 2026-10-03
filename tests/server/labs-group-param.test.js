// Regression lock: GET /api/labs/group/:groupName decoded the name a second time and 500'd on any '%' (schemathesis, v3.0.0-rc.2)
//
// Express has already percent-decoded req.params by the time the handler
// runs. The handler called decodeURIComponent() on it again, so a group name
// that legitimately contains '%' — or the fuzzer's `VN%C3%B4%C2%B7%25%40%C3%9C`,
// which Express decodes to `VNô·%@Ü` — threw URIError on the bare '%@' and
// came back as a 500. Both clients (LabInvestigationEditor, ConfigPanel)
// encode exactly once, so Express's own decode is the only one needed.
//
// This suite locks:
//   - a real group still resolves through a single encodeURIComponent (the
//     client's contract),
//   - a name carrying a bare '%' is a clean 200 with no tests, not a 500,
//   - the fuzzer's exact path is not a 500.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'LabGroup1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}

describe('GET /api/labs/group/:groupName decodes the name once', () => {
    let server;
    let token;

    const get = (path) => fetch(`${server.baseUrl}/api${path}`, {
        headers: { authorization: `Bearer ${token}` },
    });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(PASSWORD, 4);
            await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('lg-student', 'lg-student', 'lg-student@example.com', ?, 'student', 1, 'active')`,
                [hash]);
        } finally {
            await closeDb(db);
        }
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'lg-student', password: PASSWORD }),
        });
        if (!res.ok) throw new Error(`login → ${res.status}`);
        token = (await res.json()).token;
    }, 60_000);

    afterAll(async () => { await server?.close(); });

    it('resolves a real group through a single encodeURIComponent', async () => {
        const groupsRes = await get('/labs/groups');
        expect(groupsRes.status).toBe(200);
        const { groups } = await groupsRes.json();
        expect(groups.length).toBeGreaterThan(0);

        const res = await get(`/labs/group/${encodeURIComponent(groups[0])}`);
        expect(res.status).toBe(200);
        const { tests } = await res.json();
        expect(tests.length).toBeGreaterThan(0);
        expect(tests.every((t) => t.group === groups[0])).toBe(true);
    });

    it('answers a name containing a bare % with an empty list, not a 500', async () => {
        const res = await get(`/labs/group/${encodeURIComponent('50%@ group')}`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tests: [] });
    });

    it('does not 500 on the path schemathesis found', async () => {
        const res = await get('/labs/group/VN%C3%B4%C2%B7%25%40%C3%9C');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tests: [] });
    });
});
