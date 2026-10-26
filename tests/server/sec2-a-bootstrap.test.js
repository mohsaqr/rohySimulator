// Regression locks for the first-admin bootstrap (security audit 2026-10-26,
// F-30 / L6-06): the claim read COUNT(*) before a ~70 ms bcrypt hash and then
// inserted unconditionally, so simultaneous first signups all became admin;
// and there was no way to keep a stranger from claiming a fresh public box.

import { describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { all, closeDb, openDb, register } from '../utils/authHttp.js';

// validateEnv refuses a short JWT_SECRET in production.
const PROD_ENV = {
    NODE_ENV: 'production',
    JWT_SECRET: 'sec2-a-bootstrap-production-secret-Zq81xLp0Vw',
    ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
};

describe('first-admin bootstrap', () => {
    // Regression lock: every racer that read an empty table came back admin.
    it('makes exactly one admin out of simultaneous first signups', async () => {
        const fresh = await startTestServer({ seed: false, env: PROD_ENV });
        const db = await openDb(fresh.dbPath);
        try {
            const racers = await Promise.all(Array.from({ length: 5 }, (_, i) =>
                register(fresh.baseUrl, { username: `racer_${i}`, email: `racer_${i}@example.com`, password: 'GoodPassw0rd1' })));
            const admitted = racers.filter((r) => r.status === 201);
            expect(admitted).toHaveLength(1);
            expect(admitted[0].body.user.role).toBe('admin');
            // The losers are refused cleanly (bootstrap_claimed, or the fresh-install
            // policy once the table is no longer empty) — never a 5xx.
            expect(racers.every((r) => r.status === 201 || (r.status >= 400 && r.status < 500))).toBe(true);
            const admins = await all(db, `SELECT username FROM users WHERE role = 'admin'`);
            expect(admins).toHaveLength(1);
        } finally {
            await closeDb(db);
            await fresh.close();
        }
    }, 90_000);

    it('with ROHY_SETUP_TOKEN set, only the holder of the token can claim', async () => {
        const fresh = await startTestServer({ seed: false, env: { ...PROD_ENV, ROHY_SETUP_TOKEN: 'SETUP-7Q2-K9X' } });
        try {
            const policy = await (await fetch(`${fresh.baseUrl}/api/auth/registration-policy`)).json();
            expect(policy).toMatchObject({ bootstrap: true, setup_token_required: true });

            const none = await register(fresh.baseUrl, { username: 'stranger', email: 's@example.com', password: 'GoodPassw0rd1' });
            expect(none.status).toBe(403);
            expect(none.body.code).toBe('setup_token_required');
            const wrong = await register(fresh.baseUrl, { username: 'stranger', email: 's@example.com', password: 'GoodPassw0rd1', invite: 'SETUP-7Q2-K9Y' });
            expect(wrong.status).toBe(403);

            const owner = await register(fresh.baseUrl, { username: 'operator', email: 'op@example.com', password: 'GoodPassw0rd1', invite: 'SETUP-7Q2-K9X' });
            expect(owner.status).toBe(201);
            expect(owner.body.user.role).toBe('admin');
            const after = await (await fetch(`${fresh.baseUrl}/api/auth/registration-policy`)).json();
            expect(after.bootstrap).toBe(false);
            expect(after.setup_token_required).toBeUndefined();
        } finally {
            await fresh.close();
        }
    }, 90_000);
});
