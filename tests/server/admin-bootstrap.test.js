// How a fresh instance reaches its first admin.
//
// Regression guard: production refuses to seed the default admin/admin123
// (server/seeders/users.js) and /auth/register forces every account to
// 'student' — which together left a fresh Docker install with NO reachable
// path to an admin at all. Both bootstrap routes are covered here.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { provisionedAdmin } from '../../server/seeders/users.js';

const STRONG = 'BootstrapPass1';

async function register(baseUrl, username, extra = {}) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username,
            email: `${username}@example.com`,
            password: STRONG,
            ...extra,
        }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('provisionedAdmin()', () => {
    it('is null unless BOTH username and password are given', () => {
        expect(provisionedAdmin({})).toBeNull();
        expect(provisionedAdmin({ ROHY_ADMIN_USERNAME: 'ops' })).toBeNull();
        expect(provisionedAdmin({ ROHY_ADMIN_PASSWORD: STRONG })).toBeNull();
        expect(provisionedAdmin({ ROHY_ADMIN_USERNAME: '   ', ROHY_ADMIN_PASSWORD: STRONG })).toBeNull();
    });

    it('defaults name and email, and always carries the admin role', () => {
        const user = provisionedAdmin({ ROHY_ADMIN_USERNAME: 'ops', ROHY_ADMIN_PASSWORD: STRONG });
        expect(user).toMatchObject({
            username: 'ops',
            email: 'ops@rohy.local',
            password: STRONG,
            role: 'admin',
        });
        expect(user.name).toBeTruthy();
    });

    it('honours an explicit email', () => {
        const user = provisionedAdmin({
            ROHY_ADMIN_USERNAME: 'ops',
            ROHY_ADMIN_PASSWORD: STRONG,
            ROHY_ADMIN_EMAIL: 'ops@hospital.example',
        });
        expect(user.email).toBe('ops@hospital.example');
    });
});

// Path 1: the operator provisions the admin up front. This is the only path
// that works unattended in production, and it must work with NO well-known
// password in play — hence ALLOW_DEFAULT_USERS is deliberately unset here.
describe('admin bootstrap: operator-provisioned (ROHY_ADMIN_*)', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({
            seed: false,
            env: {
                NODE_ENV: 'production',
                ROHY_ADMIN_USERNAME: 'ops',
                ROHY_ADMIN_PASSWORD: STRONG,
                ROHY_ADMIN_EMAIL: 'ops@hospital.example',
                // Production CORS reads this; keep the child from tripping on it.
                FRONTEND_URL: 'http://localhost',
                ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
            },
        });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('seeds the operator admin on first boot, in production, with their own password', async () => {
        const res = await login(server.baseUrl, 'ops', STRONG);
        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('admin');
    });

    it('does not seed the well-known default accounts alongside it', async () => {
        const res = await login(server.baseUrl, 'admin', 'admin123');
        expect(res.status).toBe(401);
    });

    it('a later signup is still a student — the instance is already claimed', async () => {
        const res = await register(server.baseUrl, 'late-joiner');
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('student');
    });
});

// Path 2: nothing provisioned, so the first account through the UI claims the
// instance. The client sends no role at all (AuthService.register takes only
// username/email/password), so the claim must NOT depend on asking for one.
describe('admin bootstrap: first signup claims an unclaimed instance', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer({
            seed: false,
            env: {
                NODE_ENV: 'production',
                FRONTEND_URL: 'http://localhost',
                ROHY_DISABLE_AUTH_RATE_LIMIT: '1',
            },
        });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('boots with zero users: the default accounts are refused in production', async () => {
        const res = await login(server.baseUrl, 'admin', 'admin123');
        expect(res.status).toBe(401);
    });

    it('makes the first account admin even though the client sends no role', async () => {
        const res = await register(server.baseUrl, 'founder');
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('admin');
    });

    it('makes every later account a student', async () => {
        const res = await register(server.baseUrl, 'second');
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('student');
    });

    it('still refuses a later signup that asks for an elevated role', async () => {
        const res = await register(server.baseUrl, 'sneaky', { role: 'admin' });
        expect(res.status).toBe(403);
    });
});
