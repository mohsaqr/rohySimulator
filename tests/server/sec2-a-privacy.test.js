// Regression locks for the privacy follow-ups handed to lane A (security audit
// 2026-10-26):
//   L7-17 login_logs kept the raw attempted username of an UNKNOWN account —
//         whatever was typed, often a password in the wrong field — forever;
//   F-31 / F-32 the purge pseudonym was `deleted_user_<id>` (a key back to the
//         id) and the purge audit row wrote the erased username in clear;
//   L7-18 GET /admin/audit-log passed `limit` through parseInt unclamped
//         (`-1` = every row).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { all, authed, closeDb, get, mintToken, openDb, seedUser } from '../utils/authHttp.js';

const SECRET = 'sec2-a-privacy-secret-0123456789abcdef';

async function eventually(read, ok, { timeoutMs = 4000, stepMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, stepMs));
        last = await read();
    }
    return last;
}

const login = (baseUrl, username, password) => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
});

describe('privacy of login logs, purge and the audit log', () => {
    let server;
    let db;
    let root;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await openDb(server.dbPath);
        const rootId = await seedUser(db, { username: 'priv_root', role: 'admin' });
        root = authed(server.baseUrl, await mintToken(db, { id: rootId, username: 'priv_root', role: 'admin', tenant_id: 1 }, SECRET));
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    // Regression lock (L7-17).
    it('an unknown username is stored only as a keyed digest; a known account keeps its name', async () => {
        const typed = 'MySecretPassw0rd!';
        expect((await login(server.baseUrl, typed, 'x')).status).toBe(401);
        await seedUser(db, { username: 'priv_known' });
        expect((await login(server.baseUrl, 'priv_known', 'WrongPassw0rd')).status).toBe(401);

        const rows = await eventually(
            () => all(db, `SELECT user_id, username FROM login_logs WHERE action = 'failed_login' ORDER BY id`),
            (r) => r.length >= 2,
        );
        expect(rows.some((r) => r.username === typed)).toBe(false);
        expect(rows.find((r) => r.user_id === null).username).toMatch(/^hmac:[0-9a-f]{32}$/);
        expect(rows.some((r) => r.user_id !== null && r.username === 'priv_known')).toBe(true);
    });

    // Regression lock (F-31 / F-32).
    it('purge uses a random pseudonym and its audit row never names the erased user', async () => {
        const id = await seedUser(db, { username: 'priv_erase_me' });
        const res = await root(`/api/users/${id}/purge`, { method: 'POST' });
        expect(res.status).toBe(200);
        const { anonymized_username: pseudonym } = await res.json();
        expect(pseudonym).toMatch(/^deleted_user_[0-9a-f]{16}$/);
        expect(pseudonym).not.toBe(`deleted_user_${id}`);

        const audit = await eventually(
            () => get(db, `SELECT resource_name, old_value FROM system_audit_log WHERE action = 'purge_user' AND resource_id = ?`, [String(id)]),
            Boolean,
        );
        expect(audit.resource_name).toBe(pseudonym);
        expect(audit.old_value).not.toContain('priv_erase_me');
        expect(JSON.parse(audit.old_value)).toMatchObject({ pseudonym, former_username_digest: expect.stringMatching(/^hmac:/) });
    });

    // Regression lock (L7-18).
    it('GET /admin/audit-log clamps a negative limit instead of returning every row', async () => {
        // Two audited admin reads of a user's detail give tenant 1 at least two rows.
        const id = await seedUser(db, { username: 'priv_audited' });
        await root(`/api/users/${id}/detail`);
        await root(`/api/users/${id}/detail`);
        const count = await eventually(
            () => get(db, 'SELECT COUNT(*) AS n FROM system_audit_log WHERE tenant_id = 1'), (r) => r.n >= 2);
        expect(count.n).toBeGreaterThanOrEqual(2);
        const body = await (await root('/api/admin/audit-log?limit=-1')).json();
        expect(body.logs).toHaveLength(1);
    });
});
