// Regression locks for account lifecycle findings (security audit 2026-10-26):
//   F-08 / L1-03 / L6-01 DELETE /users/:id nulled system_audit_log.user_id,
//         which is inside every row's hash — the audit chain reported tampering
//         after every routine delete;
//   L1-12 usernames were case-sensitive and the admin paths skipped
//         normalisation (`Admin` beside `admin`, `Alice@x` beside `alice@x`);
//   L1-10 approval-mode registration answered 409 for a taken name — an
//         account-enumeration oracle;
//   L2-10 invites outlived the admin who minted them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { authed, closeDb, get, mintToken, openDb, register, run, seedUser } from '../utils/authHttp.js';

const SECRET = 'sec2-a-accounts-secret-0123456789abcdef';
const PW = 'GoodPassw0rd1';

async function eventually(read, ok, { timeoutMs = 4000, stepMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
         
        await new Promise((r) => setTimeout(r, stepMs));
         
        last = await read();
    }
    return last;
}

describe('accounts — open registration instance', () => {
    let server;
    let db;
    let root;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { registration_mode: 'open' },
            env: { JWT_SECRET: SECRET, ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'sec2a-acc-t2', 'Second tenant')`);
        const rootId = await seedUser(db, { username: 'acc_root', role: 'admin' });
        root = authed(server.baseUrl, await mintToken(db, { id: rootId, username: 'acc_root', role: 'admin', tenant_id: 1 }, SECRET));
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock (F-08).
    it('the audit chain still verifies after DELETE /users/:id of a user who acted', async () => {
        const reg = await register(server.baseUrl, { username: 'acc_doomed', email: 'acc_doomed@example.com', password: PW });
        expect(reg.status).toBe(201);
        const id = reg.body.user.id;
        await eventually(() => get(db, `SELECT id FROM system_audit_log WHERE action = 'register_user_self' AND user_id = ?`, [id]), Boolean);

        const del = await root(`/api/users/${id}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
        expect(await get(db, 'SELECT id FROM users WHERE id = ?', [id])).toBeUndefined();
        await eventually(() => get(db, `SELECT id FROM system_audit_log WHERE action = 'admin_delete_user' AND resource_id = ?`, [String(id)]), Boolean);

        // The deleted user's own audit row keeps its user_id (it is hashed).
        const own = await get(db, `SELECT user_id FROM system_audit_log WHERE action = 'register_user_self' AND resource_id = ?`, [String(id)]);
        expect(own.user_id).toBe(id);
        const verify = await (await root('/api/admin/audit/verify')).json();
        expect(verify.ok).toBe(true);
    });

    describe('case-insensitive identities (L1-12)', () => {
        beforeAll(async () => { await seedUser(db, { username: 'acc_admin_name', email: 'acc_taken@example.com' }); });

        it('admin create refuses a case variant of an existing username or email', async () => {
            const byName = await root('/api/users/create', { method: 'POST', json: { username: 'ACC_Admin_Name', email: 'fresh1@example.com', password: PW } });
            expect(byName.status).toBe(409);
            const byMail = await root('/api/users/create', { method: 'POST', json: { username: 'acc_fresh1', email: 'ACC_Taken@Example.com', password: PW } });
            expect(byMail.status).toBe(409);
        });

        it('admin create stores a trimmed username and a trimmed, lower-cased email', async () => {
            const r = await root('/api/users/create', { method: 'POST', json: { username: '  acc_Trim  ', email: '  Acc.Trim@Example.COM ', password: PW } });
            expect(r.status).toBe(201);
            expect(await get(db, 'SELECT username, email FROM users WHERE id = ?', [(await r.json()).user.id]))
                .toEqual({ username: 'acc_Trim', email: 'acc.trim@example.com' });
        });

        it('batch, PUT and import refuse case clashes too', async () => {
            const batch = await (await root('/api/users/batch', {
                method: 'POST', json: { users: [{ username: 'Acc_Admin_Name', email: 'b1@example.com', password: PW }] },
            })).json();
            expect(batch.results.failed).toHaveLength(1);

            const mine = await seedUser(db, { username: 'acc_rename_me' });
            expect((await root(`/api/users/${mine}`, { method: 'PUT', json: { username: 'ACC_ADMIN_NAME' } })).status).toBe(409);

            await seedUser(db, { username: 'acc_other_tenant', tenantId: 2 });
            const imp = await (await root('/api/users/import', {
                method: 'POST', json: { rows: [{ username: 'ACC_Other_Tenant', email: 'imp1@example.com', password: PW }] },
            })).json();
            expect(imp.results.created).toHaveLength(0);
            expect(imp.results.failed[0].error).toMatch(/already exists/);
        });

        it('self-registration refuses a case variant of a staff username', async () => {
            const r = await register(server.baseUrl, { username: 'ACC_ROOT', email: 'impostor@example.com', password: PW });
            expect(r.status).toBe(409);
        });
    });

    describe('invites die with their minter’s rights (L2-10)', () => {
        let minterId;
        let minter;

        beforeAll(async () => {
            minterId = await seedUser(db, { username: 'acc_minter', role: 'admin' });
            minter = authed(server.baseUrl, await mintToken(db, { id: minterId, username: 'acc_minter', role: 'admin', tenant_id: 1 }, SECRET));
        });

        const mint = async (role) => (await (await minter('/api/registration-invites', { method: 'POST', json: { role } })).json()).invite.token;

        it('an admin invite stops working once its minter is demoted below admin', async () => {
            const token = await mint('admin');
            expect((await (await fetch(`${server.baseUrl}/api/auth/invite/${token}`)).json()).valid).toBe(true);
            await run(db, `UPDATE users SET role = 'educator' WHERE id = ?`, [minterId]);
            expect(await (await fetch(`${server.baseUrl}/api/auth/invite/${token}`)).json()).toEqual({ valid: false, reason: 'revoked' });
            const r = await register(server.baseUrl, { username: 'acc_via_invite', email: 'via@example.com', password: PW, invite: token });
            expect(r.status).toBe(400);
            expect(r.body.code).toBe('invite_revoked');
            await run(db, `UPDATE users SET role = 'admin' WHERE id = ?`, [minterId]);
        });

        it('an invite stops working once its minter is suspended or deleted', async () => {
            const token = await mint('student');
            await run(db, `UPDATE users SET status = 'suspended' WHERE id = ?`, [minterId]);
            expect((await register(server.baseUrl, { username: 'acc_via2', email: 'via2@example.com', password: PW, invite: token })).body.code)
                .toBe('invite_revoked');
            await run(db, `UPDATE users SET status = 'active', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [minterId]);
            expect((await (await fetch(`${server.baseUrl}/api/auth/invite/${token}`)).json()).reason).toBe('revoked');
        });
    });
});

describe('accounts — approval-mode registration (L1-10)', () => {
    let server;
    let db;
    let root;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { registration_mode: 'approval' },
            env: { JWT_SECRET: SECRET, ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        const rootId = await seedUser(db, { username: 'appr_root', role: 'admin' });
        root = authed(server.baseUrl, await mintToken(db, { id: rootId, username: 'appr_root', role: 'admin', tenant_id: 1 }, SECRET));
        await seedUser(db, { username: 'appr_existing', email: 'appr_existing@example.com' });
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock: a taken name answered 409, a free one 202.
    it('answers a taken and a free username with the same 202', async () => {
        const taken = await register(server.baseUrl, { username: 'Appr_Existing', email: 'someone@example.com', password: PW });
        const free = await register(server.baseUrl, { username: 'appr_newcomer', email: 'newcomer@example.com', password: PW });
        expect([taken.status, free.status]).toEqual([202, 202]);
        expect(taken.body).toEqual(free.body);
    });

    it('refuses at approval a request whose name is taken in any letter case', async () => {
        const reqRow = await get(db, `SELECT id FROM registration_requests WHERE username = 'Appr_Existing'`);
        const r = await root(`/api/registration-requests/${reqRow.id}/approve`, { method: 'POST', json: {} });
        expect(r.status).toBe(409);
        expect((await r.json()).code).toBe('username_taken');
    });
});
