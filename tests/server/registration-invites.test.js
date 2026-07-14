// Registration invites: one token that works as a link AND as a typed code.
//
// The platform cannot send email, so an invite is a copy-paste artifact. That
// makes two properties load-bearing:
//   * the token must survive being retyped (case, hyphens, spaces), and
//   * it must be unguessable, because it MINTS AN ACCOUNT — with a role, and
//     possibly a course.
// Both are tested here, along with the race on the last use of an invite.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { JOIN_CODE_ALPHABET } from '../../server/lib/joinCode.js';

const PASSWORD = 'InviteTest1!';
const ENV = { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' };

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

async function login(baseUrl, username, password = PASSWORD) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    return (await res.json()).token;
}
function authed(baseUrl, token) {
    return (path, init = {}) => {
        const headers = { authorization: `Bearer ${token}`, ...(init.headers || {}) };
        if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
        return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
}
async function register(baseUrl, username, body = {}) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            username,
            email: body.email ?? `${username}@example.com`,
            password: PASSWORD,
            ...body,
        }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('registration invites', () => {
    let server;
    let admin, educator;
    let ids = {};

    async function mintInvite(payload = {}, as = admin) {
        const res = await as('/api/registration-invites', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    }

    beforeAll(async () => {
        // seed:true ⇒ an existing install, so the mode is 'open' (absent).
        server = await startTestServer({ seed: true, env: ENV });
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(PASSWORD, 4);
            const a = await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('inv-admin', 'inv-admin', 'inv-admin@example.com', ?, 'admin', 1, 'active')`,
                [hash]
            );
            ids.admin = a.lastID;
            const e = await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('inv-educator', 'inv-educator', 'inv-educator@example.com', ?, 'educator', 1, 'active')`,
                [hash]
            );
            ids.educator = e.lastID;
            const c = await pRun(
                db,
                `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Cardiology 101', ?, 1)`,
                [ids.admin]
            );
            ids.cohort = c.lastID;
        } finally {
            await closeDb(db);
        }
        admin = authed(server.baseUrl, await login(server.baseUrl, 'inv-admin'));
        educator = authed(server.baseUrl, await login(server.baseUrl, 'inv-educator'));
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    describe('minting', () => {
        it('produces a 12-char token from the ambiguity-free alphabet', async () => {
            const { status, body } = await mintInvite({ role: 'student' });
            expect(status).toBe(201);
            const token = body.invite.token;
            expect(token).toHaveLength(12);
            // No 0/O or 1/I/L — the token gets read aloud and retyped.
            for (const ch of token) expect(JOIN_CODE_ALPHABET).toContain(ch);
        });

        it('refuses to mint an invite for a role above the minter', async () => {
            const res = await mintInvite({ role: 'admin' }, educator);
            // An educator cannot reach the route at all (admin-gated), which is a
            // stronger guarantee than the rank check behind it.
            expect(res.status).toBe(403);
        });

        it('refuses a course that does not exist', async () => {
            const res = await mintInvite({ role: 'student', cohort_id: 99999 });
            expect(res.status).toBe(404);
        });

        it('refuses a nonsense max_uses', async () => {
            expect((await mintInvite({ max_uses: 0 })).status).toBe(400);
            expect((await mintInvite({ max_uses: -3 })).status).toBe(400);
        });

        it('never writes the token to the audit log', async () => {
            const { body } = await mintInvite({ role: 'student' });
            const db = await openDb(server.dbPath);
            const row = await pGet(
                db,
                `SELECT new_value FROM system_audit_log WHERE action = 'registration_invite_created'
                  ORDER BY id DESC LIMIT 1`
            );
            await closeDb(db);
            // redaction.js hides any field named `token` — so the audit trail
            // records WHO minted WHAT without storing the credential itself.
            expect(row).toBeTruthy();
            expect(row.new_value).not.toContain(body.invite.token);
        });
    });

    describe('the public preview', () => {
        it('names the course, so the register screen can say what you were invited to', async () => {
            const { body } = await mintInvite({ role: 'student', cohort_id: ids.cohort });
            const res = await fetch(`${server.baseUrl}/api/auth/invite/${body.invite.token}`);
            expect(res.status).toBe(200);
            const preview = await res.json();
            expect(preview.valid).toBe(true);
            expect(preview.cohort_name).toBe('Cardiology 101');
            expect(preview.role).toBe('student');
        });

        it('leaks nothing about who made it or why', async () => {
            const { body } = await mintInvite({ role: 'student', note: 'for the resit cohort' });
            const preview = await (await fetch(`${server.baseUrl}/api/auth/invite/${body.invite.token}`)).json();
            expect(Object.keys(preview).sort()).toEqual(
                ['cohort_name', 'email_domain', 'expires_at', 'role', 'uses_left', 'valid']
            );
            expect(JSON.stringify(preview)).not.toContain('resit');
        });

        it('answers 200 with a reason for a bad token (one client code path)', async () => {
            const res = await fetch(`${server.baseUrl}/api/auth/invite/NOSUCHTOKEN1`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ valid: false, reason: 'not_found' });
        });
    });

    describe('redemption', () => {
        it('applies the invite role and drops the redeemer into its course', async () => {
            const { body } = await mintInvite({ role: 'educator', cohort_id: ids.cohort });
            const res = await register(server.baseUrl, 'invited-teacher', { invite: body.invite.token });

            expect(res.status).toBe(201);
            expect(res.body.user.role).toBe('educator');   // NOT 'student'

            const db = await openDb(server.dbPath);
            const membership = await pGet(
                db,
                `SELECT 1 AS ok FROM cohort_members WHERE cohort_id = ? AND user_id = ? AND deleted_at IS NULL`,
                [ids.cohort, res.body.user.id]
            );
            const use = await pGet(
                db,
                `SELECT user_id FROM registration_invite_uses WHERE invite_id = ?`,
                [body.invite.id]
            );
            await closeDb(db);
            expect(membership?.ok).toBe(1);
            expect(use.user_id).toBe(res.body.user.id);    // the ledger recorded it
        });

        // The token gets read off a slide and retyped. If case or hyphens broke
        // it, the feature would appear broken to exactly the people it is for.
        it('accepts the token however it was retyped', async () => {
            const { body } = await mintInvite({ role: 'student' });
            const t = body.invite.token;
            const mangled = `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}`.toLowerCase();

            const res = await register(server.baseUrl, 'retyper', { invite: ` ${mangled} ` });
            expect(res.status).toBe(201);
        });

        it('rejects a revoked invite and says so', async () => {
            const { body } = await mintInvite({ role: 'student' });
            expect((await admin(`/api/registration-invites/${body.invite.id}`, { method: 'DELETE' })).status).toBe(200);

            const res = await register(server.baseUrl, 'too-late', { invite: body.invite.token });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('invite_revoked');
        });

        it('rejects an expired invite', async () => {
            const { body } = await mintInvite({
                role: 'student',
                expires_at: new Date(Date.now() - 60_000).toISOString(),
            });
            const res = await register(server.baseUrl, 'expired-user', { invite: body.invite.token });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('invite_expired');
        });

        it('honours max_uses: the second redeemer is turned away', async () => {
            const { body } = await mintInvite({ role: 'student', max_uses: 1 });

            expect((await register(server.baseUrl, 'first-in', { invite: body.invite.token })).status).toBe(201);

            const second = await register(server.baseUrl, 'second-in', { invite: body.invite.token });
            expect(second.status).toBe(400);
            expect(second.body.code).toBe('invite_exhausted');
        });

        // A failed registration must NOT burn a use, or a typo'd username would
        // silently consume someone else's seat.
        it('hands the use back when the registration itself fails', async () => {
            const { body } = await mintInvite({ role: 'student', max_uses: 1 });

            const clash = await register(server.baseUrl, 'inv-admin', { invite: body.invite.token });
            expect(clash.status).toBe(409);   // username already exists

            const db = await openDb(server.dbPath);
            const row = await pGet(db, 'SELECT uses FROM registration_invites WHERE id = ?', [body.invite.id]);
            await closeDb(db);
            expect(row.uses).toBe(0);         // not burnt

            // ...and the seat is still there for its rightful owner.
            expect((await register(server.baseUrl, 'rightful-owner', { invite: body.invite.token })).status).toBe(201);
        });

        // Two people click the same one-use link at the same moment. The
        // conditional UPDATE means exactly one of them can win.
        it('cannot be double-spent by a race', async () => {
            const { body } = await mintInvite({ role: 'student', max_uses: 1 });

            const results = await Promise.all([
                register(server.baseUrl, 'racer-a', { invite: body.invite.token }),
                register(server.baseUrl, 'racer-b', { invite: body.invite.token }),
            ]);
            const created = results.filter((r) => r.status === 201);
            const refused = results.filter((r) => r.status === 400);

            expect(created).toHaveLength(1);
            expect(refused).toHaveLength(1);
            expect(refused[0].body.code).toBe('invite_exhausted');
        });

        it('an invite email rule beats the global allowlist', async () => {
            const { body } = await mintInvite({ role: 'student', email_pattern: '@nhs.uk' });

            const wrong = await register(server.baseUrl, 'wrong-domain', {
                invite: body.invite.token, email: 'someone@gmail.com',
            });
            expect(wrong.status).toBe(400);
            expect(wrong.body.code).toBe('email_domain_not_allowed');

            const right = await register(server.baseUrl, 'external-examiner', {
                invite: body.invite.token, email: 'examiner@nhs.uk',
            });
            expect(right.status).toBe(201);
        });

        // Silently ignoring a bad token and creating a plain student would drop
        // the role and course the invite carried — landing the user in the wrong
        // place with no error to explain it.
        it('a bad token is an error even in open mode, never silently ignored', async () => {
            const res = await register(server.baseUrl, 'typo-user', { invite: 'TOTALLYBOGUS' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('invite_not_found');
        });
    });

    describe('invite mode', () => {
        let inviteModeServer;
        let modeAdmin;

        beforeAll(async () => {
            inviteModeServer = await startTestServer({
                seed: true,
                env: ENV,
                platformSettings: { registration_mode: 'invite' },
            });
            const db = await openDb(inviteModeServer.dbPath);
            try {
                const hash = await bcrypt.hash(PASSWORD, 4);
                await pRun(
                    db,
                    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                     VALUES ('mode-admin', 'mode-admin', 'mode-admin@example.com', ?, 'admin', 1, 'active')`,
                    [hash]
                );
            } finally {
                await closeDb(db);
            }
            modeAdmin = authed(inviteModeServer.baseUrl, await login(inviteModeServer.baseUrl, 'mode-admin'));
        }, 90_000);

        afterAll(async () => { if (inviteModeServer) await inviteModeServer.close(); });

        it('turns away a signup with no invite', async () => {
            const res = await register(inviteModeServer.baseUrl, 'no-invite');
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('invite_required');
        });

        it('lets an invited person straight in', async () => {
            const minted = await modeAdmin('/api/registration-invites', {
                method: 'POST',
                body: JSON.stringify({ role: 'student' }),
            });
            const { invite } = await minted.json();

            const res = await register(inviteModeServer.baseUrl, 'has-invite', { invite: invite.token });
            expect(res.status).toBe(201);
            expect(res.body.token).toBeTruthy();   // invited ⇒ logged straight in
        });

        it('tells the login screen an invite is required', async () => {
            const probe = await (await fetch(`${inviteModeServer.baseUrl}/api/auth/registration-policy`)).json();
            expect(probe.mode).toBe('invite');
            expect(probe.invite_required).toBe(true);
            expect(probe.self_registration).toBe(true);
        });
    });

    describe('closed mode', () => {
        let closedServer;

        beforeAll(async () => {
            closedServer = await startTestServer({
                seed: true,
                env: ENV,
                platformSettings: { registration_mode: 'closed' },
            });
        }, 90_000);

        afterAll(async () => { if (closedServer) await closedServer.close(); });

        // Closed means closed. Honouring outstanding invites here would make
        // 'closed' silently equivalent to 'invite' and surprise the admin who
        // just locked the door. (The invites are suspended, not revoked — flip
        // back to invite mode and they work again.)
        it('rejects even a valid invite', async () => {
            // NB: every character must be IN the alphabet. A token containing
            // I/L/O would be stripped by normalizeCode() and never match, so
            // this test would pass for the wrong reason (invite_not_found).
            const token = 'ABCDEFGH2345';
            const db = await openDb(closedServer.dbPath);
            await pRun(
                db,
                `INSERT INTO registration_invites (tenant_id, token, role, created_by) VALUES (1, ?, 'student', 1)`,
                [token]
            );
            await closeDb(db);

            const res = await register(closedServer.baseUrl, 'invited-but-closed', { invite: token });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('registration_closed');
        });
    });
});
