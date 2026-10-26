// Regression locks for account-level session revocation (security audit
// 2026-10-26):
//   L1-04 suspending/deactivating an account left its sessions live, so
//         reactivating it revived every old token (the attacker's included);
//   F-12 / L2-15 after a tenant move the user's sessions kept the old tenant
//         tag: password change / admin reset revoked `AND tenant_id = <new>`
//         and missed them, the new admin could not see or kill them, the old
//         admin kept seeing the user's IP and user agent;
//   L1-07 PUT /user/password checked the current password with no per-user
//         limit — a stolen session could guess it online.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { TEST_PASSWORD, all, authed, closeDb, get, mintToken, openDb, run, seedUser } from '../utils/authHttp.js';

const SECRET = 'sec2-a-sessions-secret-0123456789abcdef';

describe('account-level session revocation', () => {
    let server;
    let db;
    let rootToken;
    let t2AdminToken;
    let root;

    const tokenFor = async (id, username, tenantId = 1, role = 'student') =>
        mintToken(db, { id, username, role, tenant_id: tenantId }, SECRET);
    const sessionsOf = (userId) => all(db, 'SELECT id, is_active, tenant_id FROM active_sessions WHERE user_id = ? ORDER BY id', [userId]);

    beforeAll(async () => {
        // No ROHY_DISABLE_AUTH_RATE_LIMIT: the password-change limiter is under test.
        server = await startTestServer({ env: { JWT_SECRET: SECRET } });
        db = await openDb(server.dbPath);
        await run(db, `INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'sec2a-t2', 'Second tenant')`);
        const rootId = await seedUser(db, { username: 'sess_root', role: 'admin' });
        rootToken = await tokenFor(rootId, 'sess_root', 1, 'admin');
        root = authed(server.baseUrl, rootToken);
        const t2Id = await seedUser(db, { username: 'sess_t2_admin', role: 'admin', tenantId: 2 });
        t2AdminToken = await tokenFor(t2Id, 'sess_t2_admin', 2, 'admin');
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock (L1-04).
    it('PATCH status suspended revokes the sessions, and reactivation does not revive them', async () => {
        const id = await seedUser(db, { username: 'sess_suspend' });
        const token = await tokenFor(id, 'sess_suspend');
        const me = authed(server.baseUrl, token);
        expect((await me('/api/auth/verify')).status).toBe(200);

        expect((await root(`/api/users/${id}/status`, { method: 'PATCH', json: { status: 'suspended' } })).status).toBe(200);
        expect((await sessionsOf(id)).every((s) => s.is_active === 0)).toBe(true);
        expect((await root(`/api/users/${id}/status`, { method: 'PATCH', json: { status: 'active' } })).status).toBe(200);

        const after = await me('/api/auth/verify');
        expect(after.status).toBe(401);
        expect(await after.json()).toEqual({ error: 'Session revoked' });
    });

    it('bulk suspend and PUT status=inactive revoke the sessions too', async () => {
        const a = await seedUser(db, { username: 'sess_bulk' });
        const b = await seedUser(db, { username: 'sess_put' });
        await tokenFor(a, 'sess_bulk');
        await tokenFor(b, 'sess_put');
        expect((await root('/api/users/bulk-action', { method: 'POST', json: { action: 'suspend', ids: [a] } })).status).toBe(200);
        expect((await root(`/api/users/${b}`, { method: 'PUT', json: { status: 'inactive' } })).status).toBe(200);
        expect((await sessionsOf(a)).every((s) => s.is_active === 0)).toBe(true);
        expect((await sessionsOf(b)).every((s) => s.is_active === 0)).toBe(true);
    });

    describe('after a tenant move (F-12 / L2-15)', () => {
        let movedId;
        let tokenA;
        let tokenB;

        beforeAll(async () => {
            movedId = await seedUser(db, { username: 'sess_moved' });
            tokenA = await tokenFor(movedId, 'sess_moved');
            tokenB = await tokenFor(movedId, 'sess_moved');
            // What POST /users/:id/tenant does to the user row.
            await run(db, 'UPDATE users SET tenant_id = 2 WHERE id = ?', [movedId]);
        });

        it('a used session is re-tagged to the new tenant', async () => {
            expect((await authed(server.baseUrl, tokenB)('/api/auth/verify')).status).toBe(200);
            const deadline = Date.now() + 3000;
            let rows = await sessionsOf(movedId);
            // The re-tag is a best-effort write after the response; poll briefly.
            while (rows[1].tenant_id !== 2 && Date.now() < deadline) {
                 
                await new Promise((r) => setTimeout(r, 50));
                 
                rows = await sessionsOf(movedId);
            }
            expect(rows[1].tenant_id).toBe(2);
            expect(rows[0].tenant_id).toBe(1); // tokenA has not been used since the move
        });

        it("the new tenant's admin sees the moved user's sessions and the old tenant's admin does not", async () => {
            const t2 = await (await authed(server.baseUrl, t2AdminToken)('/api/admin/active-sessions')).json();
            const t1 = await (await root('/api/admin/active-sessions')).json();
            expect(t2.sessions.filter((s) => s.user_id === movedId).length).toBe(2);
            expect(t1.sessions.some((s) => s.user_id === movedId)).toBe(false);
        });

        // Regression lock: revocation was `AND tenant_id = <new>`, missing pre-move rows.
        it('a self password change revokes the other session even though it still carries the old tenant tag', async () => {
            const r = await authed(server.baseUrl, tokenB)('/api/user/password', {
                method: 'PUT', json: { current_password: TEST_PASSWORD, new_password: 'MovedPassw0rd1' },
            });
            expect(r.status).toBe(200);
            const rows = await sessionsOf(movedId);
            expect(rows[0]).toMatchObject({ tenant_id: 1, is_active: 0 });
            expect(rows[1].is_active).toBe(1); // the caller's own session stays
            expect((await authed(server.baseUrl, tokenA)('/api/auth/verify')).status).toBe(401);
        });

        it("the new tenant's admin can force-logout and reset; the old tenant's admin cannot touch the session", async () => {
            const tokenC = await tokenFor(movedId, 'sess_moved', 1);
            const rowC = await get(db, 'SELECT id FROM active_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [movedId]);
            expect((await root(`/api/admin/active-sessions/${rowC.id}`, { method: 'DELETE' })).status).toBe(404);
            expect((await authed(server.baseUrl, t2AdminToken)(`/api/admin/active-sessions/${rowC.id}`, { method: 'DELETE' })).status).toBe(200);
            expect((await authed(server.baseUrl, tokenC)('/api/auth/verify')).status).toBe(401);

            const tokenD = await tokenFor(movedId, 'sess_moved', 1);
            const reset = await authed(server.baseUrl, t2AdminToken)(`/api/users/${movedId}`, { method: 'PUT', json: { password: 'ResetPassw0rd2' } });
            expect(reset.status).toBe(200);
            expect((await authed(server.baseUrl, tokenD)('/api/auth/verify')).status).toBe(401);
        });
    });

    // Regression lock (L1-07).
    it('PUT /user/password stops after 5 wrong current passwords, even for the right one', async () => {
        const id = await seedUser(db, { username: 'sess_guess' });
        const me = authed(server.baseUrl, await tokenFor(id, 'sess_guess'));
        const attempt = (current) => me('/api/user/password', {
            method: 'PUT', json: { current_password: current, new_password: 'GuessPassw0rd3' },
        });
        const statuses = [];
        for (let i = 0; i < 5; i++) {
             
            statuses.push((await attempt(`Wrong${i}Passw0rd`)).status);
        }
        expect(statuses).toEqual([401, 401, 401, 401, 401]);
        const blocked = await attempt(TEST_PASSWORD);
        expect(blocked.status).toBe(429);
        expect((await blocked.json()).code).toBe('RATE_LIMITED');
    });
});
