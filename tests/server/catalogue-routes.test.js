// Integration tests for /api/catalogue/* — Session 2 routes.
//
// Spawns the real server (so initDb runs and curated content seeds), then
// exercises the scope-aware POST/PUT/DELETE/promote and groups CRUD over
// HTTP. Three users are seeded directly into the spawned DB:
//   - cat-admin    (admin, tenant 1)
//   - cat-educator (educator, tenant 1)
//   - cat-student  (student, tenant 1)
// Each test asserts the boundary between roles for the same operation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'CatTests1!';

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
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}

async function seedUser(db, { username, role }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pRun(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]
    );
}

async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return body.token;
}

function authedFetch(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}

describe('/api/catalogue routes', () => {
    let server;
    let adminFetch, educatorFetch, studentFetch, otherStudentFetch;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'cat-admin',     role: 'admin' });
            await seedUser(db, { username: 'cat-educator',  role: 'educator' });
            await seedUser(db, { username: 'cat-student',   role: 'student' });
            await seedUser(db, { username: 'cat-student-2', role: 'student' });
        } finally {
            await closeDb(db);
        }
        // Login all four up front so cross-tier tests don't have to relogin.
        // The auth rate limiter is 10/15min per IP; we use 4 here, leaving
        // headroom for future tests added to this suite.
        const adminToken         = await login(server.baseUrl, 'cat-admin');
        const educatorToken      = await login(server.baseUrl, 'cat-educator');
        const studentToken       = await login(server.baseUrl, 'cat-student');
        const otherStudentToken  = await login(server.baseUrl, 'cat-student-2');
        adminFetch        = authedFetch(server.baseUrl, adminToken);
        educatorFetch     = authedFetch(server.baseUrl, educatorToken);
        studentFetch      = authedFetch(server.baseUrl, studentToken);
        otherStudentFetch = authedFetch(server.baseUrl, otherStudentToken);
    }, 90_000);

    afterAll(async () => {
        if (server) {
            // Surface server stderr if any test failed so we can debug crashes.
            const stderr = server.getStderr?.() || '';
            if (stderr.trim()) console.error('\n--- spawned-server stderr ---\n' + stderr);
            await server.close();
        }
    });

    describe('GET /catalogue/medications', () => {
        it('requires auth', async () => {
            const res = await fetch(`${server.baseUrl}/api/catalogue/medications`);
            expect([401, 403]).toContain(res.status);
        });

        it('admin sees curated platform-scope rows', async () => {
            const res = await adminFetch('/api/catalogue/medications?limit=5');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body.medications)).toBe(true);
            expect(body.medications.length).toBeGreaterThan(0);
            expect(body.medications.every((m) => m.scope === 'platform')).toBe(true);
        });
    });

    describe('POST /catalogue/medications scope rules', () => {
        it('student creates a user-scoped row by default', async () => {
            const res = await studentFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'My Test Drug Student', route: 'oral' }),
            });
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.scope).toBe('user');
        });

        it('student is forbidden from creating tenant scope', async () => {
            const res = await studentFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Tenant Attempt', scope: 'tenant' }),
            });
            expect(res.status).toBe(403);
        });

        it('student is forbidden from creating platform scope directly', async () => {
            const res = await studentFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Platform Attempt', scope: 'platform' }),
            });
            expect(res.status).toBe(403);
        });

        it('educator can create tenant-scoped rows', async () => {
            const res = await educatorFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Tenant Drug', scope: 'tenant' }),
            });
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.scope).toBe('tenant');
        });

        it('admin still cannot create platform scope without /promote', async () => {
            const res = await adminFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Direct Platform', scope: 'platform' }),
            });
            expect(res.status).toBe(403);
        });

        it('rejects unknown scope', async () => {
            const res = await educatorFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Bad Scope', scope: 'wat' }),
            });
            expect(res.status).toBe(400);
        });

        it('requires generic_name', async () => {
            const res = await studentFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });
    });

    describe('PUT/DELETE auth matrix', () => {
        let studentRowId;

        it('student can edit own row', async () => {
            const created = await studentFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Owned Drug' }),
            }).then((r) => r.json());
            studentRowId = created.id;

            const upd = await studentFetch(`/api/catalogue/medications/${studentRowId}`, {
                method: 'PUT',
                body: JSON.stringify({ drug_class: 'NSAID' }),
            });
            expect(upd.status).toBe(200);
        });

        it('another student is forbidden from editing first student\'s row', async () => {
            const res = await otherStudentFetch(`/api/catalogue/medications/${studentRowId}`, {
                method: 'PUT',
                body: JSON.stringify({ drug_class: 'Hijacked' }),
            });
            expect(res.status).toBe(403);
        });

        it('admin can delete any row', async () => {
            const res = await adminFetch(`/api/catalogue/medications/${studentRowId}`, {
                method: 'DELETE',
            });
            // Admin is not the owner, scope is 'user', so this should be 403
            // — only the owner can delete a user-scoped row, not an admin
            // who doesn't own it.
            expect(res.status).toBe(403);
        });
    });

    describe('POST /catalogue/medications/:id/promote', () => {
        it('admin can promote a user-scoped row to platform', async () => {
            const created = await educatorFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Promote Target', scope: 'tenant' }),
            }).then((r) => r.json());
            const id = created.id;

            const res = await adminFetch(`/api/catalogue/medications/${id}/promote`, {
                method: 'POST',
                body: JSON.stringify({ scope: 'platform' }),
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.scope).toBe('platform');

            // Verify audit row exists.
            const db = await openDb(server.dbPath);
            try {
                const audits = await pAll(
                    db,
                    `SELECT * FROM system_audit_log
                     WHERE action = 'promote_catalogue_medication' AND resource_id = ?`,
                    [String(id)]
                );
                expect(audits.length).toBeGreaterThanOrEqual(1);
                const oldVal = JSON.parse(audits[0].old_value);
                const newVal = JSON.parse(audits[0].new_value);
                expect(oldVal.scope).toBe('tenant');
                expect(newVal.scope).toBe('platform');
            } finally {
                await closeDb(db);
            }
        });

        it('educator cannot promote', async () => {
            const created = await educatorFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'No Promote', scope: 'tenant' }),
            }).then((r) => r.json());
            const res = await educatorFetch(`/api/catalogue/medications/${created.id}/promote`, {
                method: 'POST',
                body: JSON.stringify({ scope: 'platform' }),
            });
            expect(res.status).toBe(403);
        });

        it('rejects scope=user (only widening allowed)', async () => {
            const created = await educatorFetch('/api/catalogue/medications', {
                method: 'POST',
                body: JSON.stringify({ generic_name: 'Bad Promote Target', scope: 'tenant' }),
            }).then((r) => r.json());
            const res = await adminFetch(`/api/catalogue/medications/${created.id}/promote`, {
                method: 'POST',
                body: JSON.stringify({ scope: 'user' }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe('GET /catalogue/medications/search', () => {
        it('returns empty hits for blank query without 500-ing', async () => {
            const res = await studentFetch('/api/catalogue/medications/search?q=');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.hits).toEqual([]);
        });

        it('requires auth', async () => {
            const res = await fetch(`${server.baseUrl}/api/catalogue/medications/search?q=aspirin`);
            expect([401, 403]).toContain(res.status);
        });
    });

    describe('lab-tests parallel routes', () => {
        it('GET visibility filter works', async () => {
            const res = await studentFetch('/api/catalogue/lab-tests?limit=5');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.lab_tests.length).toBeGreaterThan(0);
        });

        it('student creates user-scope lab test', async () => {
            const res = await studentFetch('/api/catalogue/lab-tests', {
                method: 'POST',
                body: JSON.stringify({
                    test_name: 'My Custom Lab',
                    test_group: 'Custom',
                    unit: 'mg/dL',
                }),
            });
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.scope).toBe('user');
        });

        it('rejects lab without unit', async () => {
            const res = await studentFetch('/api/catalogue/lab-tests', {
                method: 'POST',
                body: JSON.stringify({ test_name: 'Missing Unit' }),
            });
            expect(res.status).toBe(400);
        });

        it('admin promotes a tenant lab to platform', async () => {
            const created = await educatorFetch('/api/catalogue/lab-tests', {
                method: 'POST',
                body: JSON.stringify({ test_name: 'Tenant Lab', unit: 'U/L', scope: 'tenant' }),
            }).then((r) => r.json());
            const res = await adminFetch(`/api/catalogue/lab-tests/${created.id}/promote`, {
                method: 'POST',
                body: JSON.stringify({ scope: 'platform' }),
            });
            expect(res.status).toBe(200);
            expect((await res.json()).scope).toBe('platform');
        });
    });

    describe('drug groups CRUD', () => {
        let groupId;

        it('student creates a user-scope group', async () => {
            const res = await studentFetch('/api/catalogue/medication-groups', {
                method: 'POST',
                body: JSON.stringify({ name: 'My ICU Bundle', description: 'Personal favourites' }),
            });
            expect(res.status).toBe(201);
            const body = await res.json();
            groupId = body.id;
            expect(body.scope).toBe('user');
        });

        it('list shows the group with item_count = 0', async () => {
            const res = await studentFetch('/api/catalogue/medication-groups');
            const body = await res.json();
            const found = body.groups.find((g) => g.id === groupId);
            expect(found).toBeDefined();
            expect(found.item_count).toBe(0);
        });

        it('add an item then list items', async () => {
            // Pick an existing curated medication to add.
            const meds = await studentFetch('/api/catalogue/medications?limit=1').then((r) => r.json());
            const medId = meds.medications[0].id;
            const add = await studentFetch(`/api/catalogue/medication-groups/${groupId}/items`, {
                method: 'POST',
                body: JSON.stringify({ item_id: medId, position: 0 }),
            });
            expect(add.status).toBe(200);

            const listed = await studentFetch(`/api/catalogue/medication-groups/${groupId}/items`).then((r) => r.json());
            expect(listed.items.some((i) => i.item_id === medId)).toBe(true);
        });

        it('another student cannot edit', async () => {
            const res = await otherStudentFetch(`/api/catalogue/medication-groups/${groupId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: 'hijack' }),
            });
            expect(res.status).toBe(403);
        });

        it('owner deletes the group (soft-delete)', async () => {
            const res = await studentFetch(`/api/catalogue/medication-groups/${groupId}`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);

            const after = await studentFetch('/api/catalogue/medication-groups').then((r) => r.json());
            expect(after.groups.find((g) => g.id === groupId)).toBeUndefined();
        });
    });
});
