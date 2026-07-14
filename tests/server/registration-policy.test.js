// The registration policy: who is allowed to create an account.
//
// Two invariants dominate this file:
//
//   1. THE BOOTSTRAP SURVIVES EVERY MODE. `POST /auth/register` resolves the
//      empty-instance claim BEFORE it reads the policy, so a fresh box is always
//      claimable by its first visitor — even one shipped as `closed`. Get this
//      ordering wrong and a closed fresh install has no path to a first admin at
//      all, which is the exact dead end 2.5.2 fixed.
//
//   2. AN INSTALL THAT NEVER OPTS IN IS UNCHANGED. With no `registration_mode`
//      row, register behaves byte-for-byte as it did before this feature.
//
// The mode is seeded into the sqlite file BEFORE the server spawns: registration
// policy is read through a 15s cache, so writing it into a running server's DB
// would look unchanged for up to 15 seconds.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'RegPolicy1!';
const ENV = { NODE_ENV: 'production', FRONTEND_URL: 'http://localhost', ROHY_DISABLE_AUTH_RATE_LIMIT: '1' };

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
    );
}

async function register(baseUrl, username, extra = {}) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username,
            email: extra.email ?? `${username}@example.com`,
            password: PASSWORD,
            ...extra,
        }),
    });
    return {
        status: res.status,
        body: await res.json().catch(() => ({})),
        setCookie: res.headers.getSetCookie?.() ?? [],
    };
}

async function seedAdmin(dbPath, username = 'rp-admin') {
    const db = await openDb(dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        const r = await pRun(
            db,
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
            [username, username, `${username}@example.com`, hash]
        );
        return r.lastID;
    } finally {
        await closeDb(db);
    }
}

// ---------------------------------------------------------------------------
// Invariant 1: the bootstrap claim ignores the policy, in every mode.
// ---------------------------------------------------------------------------
describe.each(['open', 'approval', 'invite', 'closed'])(
    'bootstrap claim under registration_mode=%s',
    (mode) => {
        let server;

        beforeAll(async () => {
            server = await startTestServer({
                seed: false,
                env: ENV,
                platformSettings: { registration_mode: mode },
            });
        }, 90_000);

        afterAll(async () => { if (server) await server.close(); });

        it('lets the FIRST account claim the empty instance as admin', async () => {
            const res = await register(server.baseUrl, 'founder');
            expect(res.status).toBe(201);
            expect(res.body.user.role).toBe('admin');
            expect(res.body.token).toBeTruthy();
            // Auto-login: the claim sets the auth + CSRF cookies like any login.
            expect(res.setCookie.join(';')).toMatch(/rohy_auth/);
        });

        it('then applies the mode to everyone after them', async () => {
            const res = await register(server.baseUrl, 'second');
            if (mode === 'closed') {
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('registration_closed');
            } else if (mode === 'invite') {
                // The claim above went through WITHOUT an invite (bootstrap
                // bypasses the policy). Everyone after them needs one.
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('invite_required');
            } else {
                // open (and, until the approval queue lands, 'approval') still
                // admit a self-registering student.
                expect(res.status).toBe(201);
                expect(res.body.user.role).toBe('student');
            }
        });
    }
);

// ---------------------------------------------------------------------------
// Invariant 2: no setting row = the historical behaviour, untouched.
// ---------------------------------------------------------------------------
describe('registration policy: absent setting', () => {
    let server;

    beforeAll(async () => {
        // `seed: true` puts a user in the DB BEFORE the server boots, which is how
        // an UPGRADED install looks: users already exist, so needsSeeding() is
        // false and the fresh-install seeder never runs. No registration_mode row
        // ⇒ absent ⇒ open. (With seed:false the DB is empty, the server treats it
        // as a fresh install, and it would seed 'closed' — a different scenario.)
        server = await startTestServer({ seed: true, env: ENV });
        await seedAdmin(server.dbPath);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('is reported as open', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/registration-policy`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe('open');
        expect(body.self_registration).toBe(true);
        expect(body.bootstrap).toBe(false);
    });

    it('admits a self-registering student, with a token and cookies as before', async () => {
        const res = await register(server.baseUrl, 'walk-in');
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('student');
        expect(res.body.token).toBeTruthy();
        expect(res.setCookie.join(';')).toMatch(/rohy_auth/);
    });

    it('still refuses a self-requested elevated role', async () => {
        const res = await register(server.baseUrl, 'climber', { role: 'admin' });
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// closed
// ---------------------------------------------------------------------------
describe('registration policy: closed', () => {
    let server;
    let adminToken;

    beforeAll(async () => {
        server = await startTestServer({
            seed: false,
            env: ENV,
            platformSettings: { registration_mode: 'closed' },
        });
        await seedAdmin(server.dbPath);
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'rp-admin', password: PASSWORD }),
        });
        adminToken = (await login.json()).token;
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('refuses self-registration with a machine-readable code', async () => {
        const res = await register(server.baseUrl, 'stranger');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('registration_closed');
        // No account, and nothing that looks like a session.
        expect(res.body.token).toBeUndefined();
        expect(res.setCookie.join(';')).not.toMatch(/rohy_auth/);
    });

    it('advertises itself on the public probe so the login page can hide the link', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/registration-policy`);
        const body = await res.json();
        expect(body.mode).toBe('closed');
        expect(body.self_registration).toBe(false);
    });

    it('still lets an ADMIN create users — closed is not frozen', async () => {
        const res = await fetch(`${server.baseUrl}/api/users/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({
                username: 'made-by-admin', email: 'made@example.com', password: PASSWORD, role: 'student',
            }),
        });
        expect(res.status).toBe(201);
    });
});

// ---------------------------------------------------------------------------
// The admin surface + the email-domain allowlist
// ---------------------------------------------------------------------------
describe('registration policy: admin surface', () => {
    let server;
    let adminToken;

    async function setPolicy(payload) {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/registration`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    }

    beforeAll(async () => {
        // seed:true ⇒ an existing install, so the baseline is 'open' (absent).
        server = await startTestServer({ seed: true, env: ENV });
        await seedAdmin(server.dbPath);
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'rp-admin', password: PASSWORD }),
        });
        adminToken = (await login.json()).token;
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('rejects an unknown mode', async () => {
        const res = await setPolicy({ mode: 'whatever' });
        expect(res.status).toBe(400);
    });

    it('rejects a malformed email domain', async () => {
        const res = await setPolicy({ mode: 'open', email_domains: ['not a domain'] });
        expect(res.status).toBe(400);
    });

    it('requires admin', async () => {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/registration`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'closed' }),
        });
        expect(res.status).toBe(401);
    });

    // The write busts the 15s cache — the very next request must see the change,
    // or an admin closing registration would watch strangers keep signing up.
    it('takes effect immediately (the write busts the cache)', async () => {
        expect((await setPolicy({ mode: 'closed' })).status).toBe(200);
        expect((await register(server.baseUrl, 'after-close')).status).toBe(403);

        expect((await setPolicy({ mode: 'open' })).status).toBe(200);
        expect((await register(server.baseUrl, 'after-open')).status).toBe(201);
    });

    it('normalises stored domains (strips @, lowercases, trims)', async () => {
        const res = await setPolicy({ mode: 'open', email_domains: ['@UEF.fi', ' example.org '] });
        expect(res.status).toBe(200);
        expect(res.body.email_domains).toEqual(['uef.fi', 'example.org']);
    });

    it('enforces the allowlist on self-registration', async () => {
        await setPolicy({ mode: 'open', email_domains: ['uef.fi'] });

        const outsider = await register(server.baseUrl, 'gmail-user', { email: 'someone@gmail.com' });
        expect(outsider.status).toBe(400);
        expect(outsider.body.code).toBe('email_domain_not_allowed');

        const insider = await register(server.baseUrl, 'uef-user', { email: 'someone@uef.fi' });
        expect(insider.status).toBe(201);
    });

    it('does not let a sub-domain sneak past the allowlist', async () => {
        await setPolicy({ mode: 'open', email_domains: ['uef.fi'] });
        const res = await register(server.baseUrl, 'evil-user', { email: 'a@evil.uef.fi' });
        expect(res.status).toBe(400);
    });

    it('the public probe never leaks the user count', async () => {
        const res = await fetch(`${server.baseUrl}/api/auth/registration-policy`);
        const body = await res.json();
        expect(Object.keys(body).sort()).toEqual([
            'approval_required', 'bootstrap', 'email_domains', 'invite_required',
            'message', 'mode', 'self_registration',
        ]);
    });
});

// ---------------------------------------------------------------------------
// The fresh-install seed. A NEW box is closed; an UPGRADED one is untouched.
// ---------------------------------------------------------------------------
describe('fresh-install registration seed', () => {
    it('seeds closed on an empty database', async () => {
        // ALLOW_DEFAULT_USERS makes the seeder run its full fresh-install path.
        const server = await startTestServer({
            seed: false,
            env: { ...ENV, NODE_ENV: 'test', ALLOW_DEFAULT_USERS: '1' },
        });
        try {
            const db = await openDb(server.dbPath);
            const row = await pGet(
                db, `SELECT setting_value FROM platform_settings WHERE setting_key = 'registration_mode'`
            );
            await closeDb(db);
            expect(row?.setting_value).toBe('closed');
        } finally {
            await server.close();
        }
    }, 90_000);

    // The whole reason the seed lives in the seeders (the users-table-empty path)
    // rather than in the boot-time setSettingIfEmpty path used for tts_provider:
    // setSettingIfEmpty is idempotent per KEY, not per INSTALL. It would happily
    // insert this row on an UPGRADED install that simply never had it — silently
    // closing a working open instance on restart. `seed: true` gives us a DB that
    // already has a user when the server boots, i.e. exactly that install.
    it('does NOT seed a mode into an install that already has users', async () => {
        const server = await startTestServer({ seed: true, env: ENV });
        try {
            const db = await openDb(server.dbPath);
            const row = await pGet(
                db, `SELECT setting_value FROM platform_settings WHERE setting_key = 'registration_mode'`
            );
            await closeDb(db);
            expect(row).toBeFalsy();

            // ...and it therefore still behaves as open.
            const probe = await fetch(`${server.baseUrl}/api/auth/registration-policy`);
            expect((await probe.json()).mode).toBe('open');
        } finally {
            await server.close();
        }
    }, 90_000);
});
