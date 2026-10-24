// Registration / auth-entry pathways — the gaps the audit found, plus a
// regression lock on every defect fixed in the same pass.
//
// Server-integration tier: a real Express child on a throwaway sqlite DB
// (startTestServer), driven over HTTP. Users are seeded straight into the DB
// via the shared helper so seeding does NOT run through the registration policy
// these tests exist to exercise.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, get, asUser, register, TEST_PASSWORD } from '../utils/authHttp.js';

describe('registration & auth-entry pathways', () => {
    let server;
    let db;

    beforeAll(async () => {
        // approval is seeded as the platform mode so it is in force from the first
        // request — registrationPolicy() caches for 15s, so a mode set over HTTP
        // would not take hold in time (see createTestDb's platformSettings note).
        server = await startTestServer({
            platformSettings: { registration_mode: 'open' },
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        // A pre-existing admin means the next signup is NOT a bootstrap claim, so
        // the policy actually governs it.
        await seedUser(db, { username: 'root', role: 'admin' });
    });

    afterAll(async () => {
        await closeDb(db);
        await server.close();
    });

    // ----- password policy (was entirely uncovered) -----------------------

    describe('password policy on /auth/register', () => {
        it('rejects a password with no uppercase letter', async () => {
            const r = await register(server.baseUrl, {
                username: 'weak1', email: 'weak1@example.com', password: 'lowercase1',
            });
            expect(r.status).toBe(400);
        });

        it('rejects a password shorter than 8 characters', async () => {
            const r = await register(server.baseUrl, {
                username: 'weak2', email: 'weak2@example.com', password: 'Ab1',
            });
            expect(r.status).toBe(400);
        });

        it('accepts a password that meets every rule', async () => {
            const r = await register(server.baseUrl, {
                username: 'strong1', email: 'strong1@example.com', password: 'GoodPass1',
            });
            expect(r.status).toBe(201);
        });
    });

    // ----- suspended login (DEFECT: was 200 + token + audit success) ------

    describe('a disabled account cannot log in', () => {
        it('refuses a suspended user with 403 and writes no successful login', async () => {
            await seedUser(db, { username: 'suspended1', status: 'suspended' });

            const res = await fetch(`${server.baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'suspended1', password: TEST_PASSWORD }),
            });
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.token).toBeUndefined();

            // Regression lock: the bug wrote a SUCCESSFUL login_logs row and an
            // active_sessions row for an account an admin had just switched off.
            const good = await get(db,
                `SELECT COUNT(*) AS n FROM login_logs WHERE username = ? AND action = 'login'`,
                ['suspended1']);
            expect(good.n).toBe(0);
        });
    });

    // ----- account lockout (DEFECT: never fired east of UTC) --------------

    describe('account lockout actually locks', () => {
        // Regression lock: locked_until is a SQLite UTC timestamp with no `Z`; the
        // read parsed it as LOCAL time, so on a server east of UTC the lock was
        // always already "in the past" and the 423 branch never fired. This test
        // runs with the child server pinned to a non-UTC zone precisely so a
        // reintroduction of the raw `new Date(locked_until)` parse fails here.
        let tzServer;
        let tzDb;

        beforeAll(async () => {
            tzServer = await startTestServer({
                platformSettings: { registration_mode: 'open' },
                env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1', TZ: 'Asia/Kolkata' },  // UTC+5:30
            });
            tzDb = await openDb(tzServer.dbPath);
            await seedUser(tzDb, { username: 'locky' });
        });

        afterAll(async () => {
            await closeDb(tzDb);
            await tzServer.close();
        });

        it('returns 423 on the attempt after 5 failures — even with the correct password', async () => {
            const bad = () => fetch(`${tzServer.baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'locky', password: 'WrongPass9' }),
            });
            for (let i = 0; i < 5; i++) {
                // eslint-disable-next-line no-await-in-loop
                const r = await bad();
                expect(r.status).toBe(401);
            }

            // The 6th attempt uses the CORRECT password: a working lock must still
            // refuse it. Under the bug this returned 200 and logged the user in.
            const res = await fetch(`${tzServer.baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'locky', password: TEST_PASSWORD }),
            });
            expect(res.status).toBe(423);
        });
    });

    // ----- bootstrap claim on an empty instance --------------------------

    describe('bootstrap claim on an empty instance', () => {
        // The first signup on an empty box claims it as admin — whatever role it
        // asked for — BEFORE the policy is read, so a fresh install always has a
        // path to a first admin, even one shipped `closed`. An empty instance
        // needs BOTH seed:false (no pre-seeded rows) AND production env, because
        // production suppresses the default admin/student boot seeder — otherwise
        // users starts at 2, the claim never triggers, and the seeded `closed`
        // policy 403s both racers (the exact way this test failed before).
        //
        // Two SIMULTANEOUS first signups is a known, deliberately tolerated
        // TOCTOU: both read userCount===0 and both claim admin. The blast radius
        // is two admins on a box nobody else has reached yet — not a stranger let
        // in — so we lock the invariant we DO guarantee (the empty instance IS
        // claimed, and every signup that wins the claim is an admin) rather than
        // the stricter single-winner one the code does not provide.
        //
        // We do NOT assert both racers get 201: scheduling is free to let one
        // INSERT land before the other's COUNT, in which case the loser sees
        // userCount===1, falls through to the seeded fresh-install policy (closed)
        // and is denied. Both outcomes are correct; asserting "both 201" would be
        // a latent flake. What must hold: ≥1 admin exists, and no admitted signup
        // came back as a non-admin (which would mean the claim path broke).
        it('claims an empty instance for its first signup, tolerating a concurrent racer', async () => {
            const fresh = await startTestServer({
                seed: false,
                // validateEnv refuses a JWT_SECRET under 32 chars in production.
                env: { NODE_ENV: 'production', JWT_SECRET: 'rohy-tests-production-secret-0123456789', ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
            });
            const freshDb = await openDb(fresh.dbPath);
            try {
                const both = await Promise.all([
                    register(fresh.baseUrl, { username: 'racer_a', email: 'a@example.com', password: 'GoodPass1' }),
                    register(fresh.baseUrl, { username: 'racer_b', email: 'b@example.com', password: 'GoodPass1' }),
                ]);
                // At least one racer claimed the instance…
                const admitted = both.filter((r) => r.status === 201);
                expect(admitted.length).toBeGreaterThanOrEqual(1);
                // …every admitted racer is an admin (the claim, not a plain signup)…
                expect(admitted.every((r) => r.body?.user?.role === 'admin')).toBe(true);
                // …any non-admitted racer lost the race to the policy, never 500…
                expect(both.every((r) => r.status === 201 || (r.status >= 400 && r.status < 500))).toBe(true);
                // …and the box ends up claimed.
                const admins = await get(freshDb, `SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`);
                expect(admins.n).toBeGreaterThanOrEqual(1);
            } finally {
                await closeDb(freshDb);
                await fresh.close();
            }
        }, 90_000);
    });

    // ----- invite admin routes (were exercised only via direct DB writes) -

    describe('invite admin routes', () => {
        it('mints, lists, and reads the uses ledger for an invite', async () => {
            const admin = await asUser(server.baseUrl, 'root');

            const created = await admin('/api/registration-invites', {
                method: 'POST', json: { role: 'student', max_uses: 3 },
            });
            expect(created.status).toBe(201);
            const { invite } = await created.json();
            expect(invite.token).toBeTruthy();

            const listed = await admin('/api/registration-invites');
            expect(listed.status).toBe(200);
            const { invites } = await listed.json();
            expect(invites.some((i) => i.token === invite.token)).toBe(true);

            const uses = await admin(`/api/registration-invites/${invite.id}/uses`);
            expect(uses.status).toBe(200);
            expect((await uses.json()).uses).toEqual([]);
        });

        it('revokes an invite and then refuses to redeem it', async () => {
            const admin = await asUser(server.baseUrl, 'root');
            const created = await admin('/api/registration-invites', {
                method: 'POST', json: { role: 'student' },
            });
            const { invite } = await created.json();

            const del = await admin(`/api/registration-invites/${invite.id}`, { method: 'DELETE' });
            expect(del.status).toBe(200);

            const redeem = await register(server.baseUrl, {
                username: 'afterrevoke', email: 'ar@example.com', password: 'GoodPass1', invite: invite.token,
            });
            expect(redeem.status).toBe(400);
            expect(redeem.body.code).toBe('invite_revoked');
        });

        it('is closed to a non-admin', async () => {
            await seedUser(db, { username: 'plainstudent' });
            const student = await asUser(server.baseUrl, 'plainstudent');
            const r = await student('/api/registration-invites', { method: 'POST', json: { role: 'student' } });
            expect(r.status).toBe(403);
        });
    });
});

// ---------------------------------------------------------------------------
// The approval queue (registration_mode = 'approval', migration 0038).
//
// Its own server: approval is seeded pre-boot so the 15s policy cache has it in
// force from the first request. A pre-existing admin means every signup is
// governed by the policy rather than claiming the empty instance.
// ---------------------------------------------------------------------------

describe('registration approval queue', () => {
    // The password an applicant chooses at request time. On approval the hash
    // moves to the users row untouched, so they sign in with THIS — no admin
    // ever sets or sees a password.
    const APPLICANT_PW = 'GoodPass1';
    let server;
    let db;
    let admin;

    beforeAll(async () => {
        server = await startTestServer({
            platformSettings: { registration_mode: 'approval' },
            env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' },
        });
        db = await openDb(server.dbPath);
        await seedUser(db, { username: 'queen', role: 'admin' });
        admin = await asUser(server.baseUrl, 'queen');
    });

    afterAll(async () => {
        await closeDb(db);
        await server.close();
    });

    it('parks an applicant instead of admitting them (202, no user, no token)', async () => {
        const r = await register(server.baseUrl, {
            username: 'applicant1', email: 'applicant1@example.com', password: APPLICANT_PW,
        });
        // Regression lock: approval used to fall through to the plain-student
        // INSERT and hand back a 201 + token, silently running `open`.
        expect(r.status).toBe(202);
        expect(r.body.code).toBe('approval_pending');
        expect(r.body.token).toBeUndefined();

        // No users row — an applicant is deliberately NOT a user yet.
        const asUserRow = await get(db, `SELECT COUNT(*) AS n FROM users WHERE username = ?`, ['applicant1']);
        expect(asUserRow.n).toBe(0);
        // …but a pending request exists.
        const req = await get(db,
            `SELECT status FROM registration_requests WHERE username = ?`, ['applicant1']);
        expect(req.status).toBe('pending');
    });

    it('refuses a second request for the same username (partial unique index)', async () => {
        // Self-contained: create the first request here rather than leaning on the
        // park test above, so this still exercises the collision when run alone.
        const first = await register(server.baseUrl, {
            username: 'dup_applicant', email: 'dup@example.com', password: APPLICANT_PW,
        });
        expect(first.status).toBe(202);
        const dup = await register(server.baseUrl, {
            username: 'dup_applicant', email: 'other@example.com', password: APPLICANT_PW,
        });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('approval_already_requested');
    });

    it('shows the queue to an admin and hides it from a student', async () => {
        await register(server.baseUrl, {
            username: 'queue_applicant', email: 'queue@example.com', password: APPLICANT_PW,
        });
        const seen = await admin('/api/registration-requests?status=pending');
        expect(seen.status).toBe(200);
        const { requests } = await seen.json();
        expect(requests.some((r) => r.username === 'queue_applicant')).toBe(true);
        // The hash is never selected back out — nobody, admin included, needs it.
        expect(requests.every((r) => r.password_hash === undefined)).toBe(true);

        await seedUser(db, { username: 'nosy', role: 'student' });
        const student = await asUser(server.baseUrl, 'nosy');
        const denied = await student('/api/registration-requests');
        expect(denied.status).toBe(403);
    });

    it('approve mints the account, and the applicant signs in with their own password', async () => {
        await register(server.baseUrl, {
            username: 'approve_applicant', email: 'approve@example.com', password: APPLICANT_PW,
        });
        const req = await get(db, `SELECT id FROM registration_requests WHERE username = ?`, ['approve_applicant']);
        const approved = await admin(`/api/registration-requests/${req.id}/approve`, {
            method: 'POST', json: { role: 'student' },
        });
        expect(approved.status).toBe(201);

        // The users row now exists…
        const userRow = await get(db, `SELECT role FROM users WHERE username = ?`, ['approve_applicant']);
        expect(userRow.role).toBe('student');
        // …and the password they chose at request time works — distinct from the
        // seed helper's TEST_PASSWORD, so a green login proves the request hash
        // (not a coincidental match) moved into the users row.
        expect(APPLICANT_PW).not.toBe(TEST_PASSWORD);
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'approve_applicant', password: APPLICANT_PW }),
        });
        expect(login.status).toBe(200);
        // Landed inside the auto-enrol default course like every other entry path.
        const member = await get(db,
            `SELECT COUNT(*) AS n FROM cohort_members m JOIN users u ON u.id = m.user_id
              WHERE u.username = ? AND m.deleted_at IS NULL`, ['approve_applicant']);
        expect(member.n).toBeGreaterThanOrEqual(1);

        // Regression lock: the approved request kept its copy of the password
        // hash forever. It moved to the users row; the request keeps none.
        const decided = await get(db, `SELECT password_hash FROM registration_requests WHERE id = ?`, [req.id]);
        expect(decided.password_hash).toBe('');
    });

    it('refuses a non-admin the approve route entirely', async () => {
        // The approve/reject routes are `requireAdmin`, so a sub-admin is turned
        // away by the ROUTE gate (403 'Insufficient role') BEFORE the handler's
        // own rank-ceiling check is reached. This test locks that gate — it does
        // NOT exercise the in-handler ceiling, which is unreachable via the route
        // (the only approver who clears requireAdmin is an admin, and no role
        // outranks admin, so `role_rank > approver_rank` there is defensive dead
        // code). An earlier version of this test claimed to prove the ceiling and
        // would have passed even with that check deleted.
        await seedUser(db, { username: 'teach', role: 'educator' });
        const educator = await asUser(server.baseUrl, 'teach');
        await register(server.baseUrl, {
            username: 'gate_applicant', email: 'ga@example.com', password: APPLICANT_PW,
        });
        const req = await get(db, `SELECT id FROM registration_requests WHERE username = ?`, ['gate_applicant']);
        const r = await educator(`/api/registration-requests/${req.id}/approve`, {
            method: 'POST', json: { role: 'admin' },
        });
        expect(r.status).toBe(403);
        expect((await r.json()).error).toBe('Insufficient role');
    });

    it('reject leaves no account, and the applicant may apply again', async () => {
        await register(server.baseUrl, {
            username: 'applicant2', email: 'applicant2@example.com', password: APPLICANT_PW,
        });
        const req = await get(db, `SELECT id FROM registration_requests WHERE username = ?`, ['applicant2']);
        const rejected = await admin(`/api/registration-requests/${req.id}/reject`, {
            method: 'POST', json: { note: 'not this term' },
        });
        expect(rejected.status).toBe(200);

        const userRow = await get(db, `SELECT COUNT(*) AS n FROM users WHERE username = ?`, ['applicant2']);
        expect(userRow.n).toBe(0);

        // The rejected row is RETAINED — it is the record that someone asked and
        // was told no. Assert it explicitly, so a reject route that DELETED the row
        // (which would also let re-application through) can't pass this test.
        const rej = await get(db,
            `SELECT COUNT(*) AS n FROM registration_requests WHERE username = ? AND status = 'rejected'`,
            ['applicant2']);
        expect(rej.n).toBe(1);
        // Regression lock: a rejected request kept the applicant's password
        // hash forever, though no account would ever be made from it.
        const rejRow = await get(db,
            `SELECT password_hash FROM registration_requests WHERE username = ? AND status = 'rejected'`,
            ['applicant2']);
        expect(rejRow.password_hash).toBe('');

        // The partial unique index covers LIVE (pending) rows only, so a rejected
        // applicant is free to re-apply — leaving a rejected row AND a fresh
        // pending one side by side. That coexistence is the index working.
        const reapply = await register(server.baseUrl, {
            username: 'applicant2', email: 'applicant2@example.com', password: APPLICANT_PW,
        });
        expect(reapply.status).toBe(202);
        const pend = await get(db,
            `SELECT COUNT(*) AS n FROM registration_requests WHERE username = ? AND status = 'pending'`,
            ['applicant2']);
        expect(pend.n).toBe(1);
    });

    it('lets a valid invite skip the queue entirely', async () => {
        // The admin who minted the invite already approved this person by name;
        // sending them to the queue would ask the same admin the same question
        // twice. Same reasoning that lets an invite through a closed door.
        const minted = await admin('/api/registration-invites', {
            method: 'POST', json: { role: 'student' },
        });
        const { invite } = await minted.json();
        const r = await register(server.baseUrl, {
            username: 'invited_in_approval', email: 'iia@example.com',
            password: APPLICANT_PW, invite: invite.token,
        });
        expect(r.status).toBe(201);        // straight in, not queued
        expect(r.body.token).toBeTruthy();
        // The distinguishing assertion: a plain 201+token is also what the
        // pre-queue code produced. What makes this the INVITE-skips-QUEUE lock is
        // that NO request row was parked — the invitee bypassed the queue, not
        // merely got admitted.
        const parked = await get(db,
            `SELECT COUNT(*) AS n FROM registration_requests WHERE username = ?`,
            ['invited_in_approval']);
        expect(parked.n).toBe(0);
    });
});
