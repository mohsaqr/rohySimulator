// tests/server/middleware/auth.test.js
//
// Phase E3 — RBAC middleware contract for `server/middleware/auth.js`.
//
// CONTRACT (observed reading server/middleware/auth.js end-to-end):
//   - ROLE_RANKS = { guest:0, student:1, user:1, reviewer:2, educator:3, admin:4 }
//     The legacy alias `user` shares rank 1 with `student` (ranks-table
//     entry); `normalizeRole('user')` -> 'student' so any string-keyed
//     lookup also resolves to student.
//   - `requireRole(minRank)` is rank-based: a caller passes iff
//     `getRoleRank(req.user) >= minRank`. With `req.user` missing it
//     returns 401, otherwise on insufficient rank it returns 403.
//   - `requireAdmin/Educator/Reviewer/Student` are pre-bound to
//     ROLE_RANKS.admin/educator/reviewer/student respectively.
//   - `authenticateToken` parses `Authorization: Bearer <jwt>`:
//       missing token       -> 401 'Access token required'
//       invalid/expired JWT -> 403 'Invalid or expired token'
//       valid JWT but the DB row is missing / soft-deleted / not 'active'
//                           -> 403 'Invalid or inactive user'
//     On success it overwrites `req.user.role` and `req.user.tenant_id`
//     from the FRESH DB row (so a demoted/promoted user is reflected on
//     the next request even with the same token).
//   - `resolveTenant(req)` returns `req.user?.tenant_id || 1` — there is
//     NO header fallback in the current implementation (despite the spec
//     mentioning one). We lock the actual chain: req.user.tenant_id, else 1.
//   - `requireSameTenant(getter)`:
//       getter returning null/undefined -> 404 'Resource not found'
//       getter result !== resolveTenant -> 403 'Access denied: tenant mismatch'
//       getter throws                   -> 500 with err.message
//
// Why we set `ROHY_DB` BEFORE importing auth.js:
//   `server/db.js` opens a sqlite connection at import time using
//   `process.env.ROHY_DB || './database.sqlite'`. To make the middleware
//   read from a throwaway test DB we must set the env var first and only
//   then `await import()` the module. Doing it in the same process keeps
//   middleware tests synchronous (no spawned Express server needed).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runMigrations } from '../../../server/migrationRunner.js';

// ---------------------------------------------------------------------------
// Test DB lifecycle
// ---------------------------------------------------------------------------

let tempDir;
let tempDbPath;
let testDb;
let auth; // dynamically imported after ROHY_DB is set

const JWT_SECRET = 'test-jwt-secret-for-auth-middleware-tests';

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}
function openSqlite(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}

function closeSqlite(db) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        db.close(() => resolve());
    });
}

// ---------------------------------------------------------------------------
// Express-like mocks
// ---------------------------------------------------------------------------

function makeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

function makeReq({ headers = {}, user = undefined, method = 'GET' } = {}) {
    return { headers, user, method };
}

function makeNext() {
    let called = false;
    let calledWith;
    const fn = (arg) => { called = true; calledWith = arg; };
    fn.wasCalled = () => called;
    fn.arg = () => calledWith;
    return fn;
}

// Wraps the callback-style middleware as a promise that resolves when EITHER
// `next()` is called OR `res.json()` is called (whichever happens first).
function runMiddleware(mw, req, res) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = () => { if (!settled) { settled = true; resolve(); } };

        const next = (arg) => {
            res.__nextCalled = true;
            res.__nextArg = arg;
            settle();
        };
        const origJson = res.json.bind(res);
        res.json = (payload) => {
            origJson(payload);
            settle();
            return res;
        };

        Promise.resolve(mw(req, res, next)).catch((err) => {
            res.__threw = err;
            settle();
        });
    });
}

// ---------------------------------------------------------------------------
// Helpers to seed users
// ---------------------------------------------------------------------------

async function seedUser({
    id,
    username,
    role = 'student',
    status = 'active',
    tenant_id = 1,
    deleted_at = null,
}) {
    await pRun(
        testDb,
        `INSERT INTO users (id, username, name, email, password_hash, role, status, tenant_id, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, username, username, `${username}@example.com`, 'x', role, status, tenant_id, deleted_at]
    );
}

function signToken(payload, opts = {}) {
    return jwt.sign(payload, JWT_SECRET, opts);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-auth-mw-'));
    tempDbPath = path.join(tempDir, 'db.sqlite');

    // Migrations run against a freshly opened sqlite connection.
    const setupDb = await openSqlite(tempDbPath);
    await runMigrations(setupDb);
    await closeSqlite(setupDb);

    // Now point the singleton at this DB and provide a JWT secret BEFORE
    // dynamically importing auth.js (which immediately reads JWT_SECRET
    // and `db.js` opens the sqlite file at import time).
    process.env.ROHY_DB = tempDbPath;
    process.env.JWT_SECRET = JWT_SECRET;

    auth = await import('../../../server/middleware/auth.js');
    const { dbReady } = await import('../../../server/db.js');
    await dbReady;

    // Open a separate connection for our own seed/mutate ops so that we
    // don't collide with auth.js's singleton inside the same process.
    testDb = await openSqlite(tempDbPath);

    // Seed canonical user rows. Each role gets a distinct id so we can
    // sign role-specific tokens without re-seeding per test. The DB CHECK
    // constraint on users.role enforces the new five-role enum, so
    // 'guest' is allowed but legacy 'user' is NOT — we only exercise the
    // 'user' string via JWT payloads on `requireRole` (no DB lookup).
    await seedUser({ id: 100, username: 'guest_u',    role: 'guest' });
    await seedUser({ id: 101, username: 'student_u',  role: 'student' });
    await seedUser({ id: 102, username: 'reviewer_u', role: 'reviewer' });
    await seedUser({ id: 103, username: 'educator_u', role: 'educator' });
    await seedUser({ id: 104, username: 'admin_u',    role: 'admin' });
    await seedUser({ id: 200, username: 'inactive_u', role: 'student', status: 'inactive' });
    await seedUser({ id: 201, username: 'soft_del_u', role: 'admin',   deleted_at: '2024-01-01 00:00:00' });
    await seedUser({ id: 300, username: 'tenant1_u',  role: 'admin', tenant_id: 1 });
    await seedUser({ id: 301, username: 'tenant2_u',  role: 'admin', tenant_id: 2 });

    // tenants table needs id=2 since 0004_tenants.sql only inserts id=1.
    await pRun(
        testDb,
        `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (2, 'other', 'Other', 0)`
    );
});

afterAll(async () => {
    if (testDb) await closeSqlite(testDb);
    if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth middleware — ROLE_RANKS table', () => {
    it('locks the exact rank values for every documented role', () => {
        // CONTRACT: these integers are compared by `requireRole(minRank)`.
        // Changing them silently shifts every gate in the app.
        expect(auth.ROLE_RANKS.guest).toBe(0);
        expect(auth.ROLE_RANKS.student).toBe(1);
        expect(auth.ROLE_RANKS.reviewer).toBe(2);
        expect(auth.ROLE_RANKS.educator).toBe(3);
        expect(auth.ROLE_RANKS.admin).toBe(4);
    });

    it('CONTRACT: legacy "user" alias maps to rank 1 (same as student)', () => {
        // The map intentionally has both `student` and `user` at rank 1
        // so DB rows or stale JWTs that still carry role:'user' resolve
        // identically to student. Locks the alias presence.
        expect(auth.ROLE_RANKS.user).toBe(1);
        expect(auth.ROLE_RANKS.user).toBe(auth.ROLE_RANKS.student);
    });

    it('ROLE_RANKS is frozen (cannot be mutated at runtime)', () => {
        // `Object.freeze` in source. A mutation attempt must not change
        // the rank — silently in non-strict mode, or throw in strict.
        expect(Object.isFrozen(auth.ROLE_RANKS)).toBe(true);
    });
});

describe('auth middleware — requireRole(reviewer) hierarchy', () => {
    function callRequireRole(userRole) {
        const mw = auth.requireRole(auth.ROLE_RANKS.reviewer);
        const req = makeReq({ user: { id: 1, role: userRole } });
        const res = makeRes();
        const next = makeNext();
        mw(req, res, next);
        return { req, res, next };
    }

    it('admin (rank 4) passes a reviewer gate', () => {
        const { res, next } = callRequireRole('admin');
        expect(next.wasCalled()).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    it('educator (rank 3) passes a reviewer gate', () => {
        const { res, next } = callRequireRole('educator');
        expect(next.wasCalled()).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    it('reviewer (rank 2) passes the reviewer gate (>= boundary)', () => {
        const { res, next } = callRequireRole('reviewer');
        expect(next.wasCalled()).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    it('student (rank 1) is blocked with 403', () => {
        const { res, next } = callRequireRole('student');
        expect(next.wasCalled()).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Insufficient role' });
    });

    it('guest (rank 0) is blocked with 403', () => {
        const { res, next } = callRequireRole('guest');
        expect(next.wasCalled()).toBe(false);
        expect(res.statusCode).toBe(403);
    });
});

describe('auth middleware — legacy "user" role normalisation', () => {
    it('CONTRACT: legacy role "user" is treated as student (rank 1)', () => {
        // `getRoleRank` runs `normalizeRole` then looks up the rank, so a
        // JWT carrying role:'user' resolves to rank 1. Locks the alias
        // behaviour without touching DB rows (the new schema's CHECK
        // constraint won't store 'user' anyway).
        const mw = auth.requireRole(auth.ROLE_RANKS.student);
        const req = makeReq({ user: { id: 1, role: 'user' } });
        const res = makeRes();
        const next = makeNext();
        mw(req, res, next);
        expect(next.wasCalled()).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    it('CONTRACT: legacy "user" cannot escalate to reviewer (rank 2)', () => {
        const mw = auth.requireRole(auth.ROLE_RANKS.reviewer);
        const req = makeReq({ user: { id: 1, role: 'user' } });
        const res = makeRes();
        const next = makeNext();
        mw(req, res, next);
        expect(next.wasCalled()).toBe(false);
        expect(res.statusCode).toBe(403);
    });
});

describe('auth middleware — authenticateToken', () => {
    it('rejects request with NO Authorization header (401)', async () => {
        const req = makeReq();
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Access token required' });
        expect(res.__nextCalled).toBeFalsy();
    });

    it('rejects malformed JWT (403, "Invalid or expired token")', async () => {
        const req = makeReq({ headers: { authorization: 'Bearer not-a-real-jwt' } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        // CONTRACT: jwt.verify error path returns 403, not 401. Locks
        // the observed mapping (the comment in source says "Invalid or
        // expired token" which is shared by malformed + expired).
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Invalid or expired token' });
    });

    it('rejects EXPIRED JWT (403, "Invalid or expired token")', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { expiresIn: '-10s' });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Invalid or expired token' });
    });

    it('accepts a valid JWT and populates req.user from the DB row', async () => {
        const token = signToken({ id: 104, role: 'student' /* stale role in token */ });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBeNull(); // next() ran, no res.json call
        expect(res.__nextCalled).toBe(true);
        // CONTRACT: role + tenant_id are refreshed from the DB. The DB
        // row has role='admin' even though the token says 'student'.
        expect(req.user.role).toBe('admin');
        expect(req.user.tenant_id).toBe(1);
        expect(req.user.id).toBe(104);
    });

    it('CONTRACT: DB role refresh — role changes between requests are picked up', async () => {
        // Promote a fresh user, sign a token, then demote in the DB and
        // re-call. The same token must yield the new role on the second
        // call. Locks the "no caching, no token revocation needed for
        // role downgrades" behaviour.
        await seedUser({ id: 110, username: 'mutating_u', role: 'reviewer' });
        const token = signToken({ id: 110, role: 'reviewer' });

        const req1 = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res1 = makeRes();
        await runMiddleware(auth.authenticateToken, req1, res1);
        expect(req1.user.role).toBe('reviewer');

        await pRun(testDb, `UPDATE users SET role = 'student' WHERE id = ?`, [110]);

        const req2 = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res2 = makeRes();
        await runMiddleware(auth.authenticateToken, req2, res2);
        expect(req2.user.role).toBe('student');
    });

    it('rejects valid JWT for a SOFT-DELETED user (403, "Invalid or inactive user")', async () => {
        const token = signToken({ id: 201, role: 'admin' });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Invalid or inactive user' });
    });

    it('rejects valid JWT for an INACTIVE user (status != active)', async () => {
        const token = signToken({ id: 200, role: 'student' });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Invalid or inactive user' });
    });

    it('rejects valid JWT whose user_id no longer exists in the DB', async () => {
        const token = signToken({ id: 9_999_999, role: 'admin' });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Invalid or inactive user' });
    });

    it('CONTRACT: DB tenant_id refresh — tenant changes between requests are picked up', async () => {
        // Audit #12: a tenant migration must be reflected on the very next
        // request without forcing a token refresh. Locks that req.user.tenant_id
        // is read from the DB row, NOT from the JWT payload.
        await seedUser({ id: 120, username: 'tenant_migrating_u', role: 'admin', tenant_id: 1 });
        const token = signToken({ id: 120, role: 'admin', tenant_id: 1 });

        const req1 = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res1 = makeRes();
        await runMiddleware(auth.authenticateToken, req1, res1);
        expect(req1.user.tenant_id).toBe(1);

        await pRun(testDb, `UPDATE users SET tenant_id = 2 WHERE id = ?`, [120]);

        const req2 = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res2 = makeRes();
        await runMiddleware(auth.authenticateToken, req2, res2);
        // Same token, new request — tenant_id reflects the DB, not the JWT.
        expect(req2.user.tenant_id).toBe(2);
    });

    it('rejects malformed Authorization header lacking the Bearer prefix', async () => {
        // Audit #12: protect against `Authorization: <raw-token>` (no scheme).
        // extractToken's split-on-space requires `Bearer <jwt>`; anything
        // else means no token, which becomes 401.
        const token = signToken({ id: 104, role: 'admin' });
        const req = makeReq({ headers: { authorization: token } }); // missing "Bearer "
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Access token required' });
    });

    it('rejects "Bearer" with empty token after the space', async () => {
        const req = makeReq({ headers: { authorization: 'Bearer ' } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Access token required' });
    });

    it('rejects three-part Authorization header (Basic-style scheme abuse)', async () => {
        const req = makeReq({ headers: { authorization: 'Bearer foo bar' } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        // extractToken's `split(' ')` returns 3 parts here, so it falls
        // through to the cookie path (none) → 401. Locks the parser
        // strictness so future "be lenient" refactors don't accept it.
        expect(res.statusCode).toBe(401);
    });
});

describe('auth middleware — CSRF protection on cookie-auth state-changing requests', () => {
    // Cookie-auth POST/PUT/PATCH/DELETE require a valid double-submit
    // CSRF token (cookie + matching X-CSRF-Token header). Bearer-auth
    // requests skip the check — see middleware/csrf.js for rationale.

    function csrfReq({ method = 'POST', token, header, extraCookies = '' } = {}) {
        const cookies = [`rohy_auth=PLACEHOLDER`, extraCookies].filter(Boolean).join('; ');
        const headers = {};
        // We override the cookie line below per scenario.
        if (token !== undefined) {
            headers.cookie = `rohy_auth=PLACEHOLDER; rohy_csrf=${token}`;
        } else {
            headers.cookie = cookies;
        }
        if (header !== undefined) headers['x-csrf-token'] = header;
        return { method, headers };
    }

    it('cookie-auth POST without X-CSRF-Token → 403 "CSRF token missing"', async () => {
        const jwtToken = signToken({ id: 104, role: 'admin' }, { jwtid: 'csrf-missing' });
        await auth.recordActiveSession(jwtToken, { id: 104, tenant_id: 1 });

        const req = makeReq({
            method: 'POST',
            headers: { cookie: `rohy_auth=${jwtToken}; rohy_csrf=any-token` },
        });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'CSRF token missing' });
    });

    it('cookie-auth POST with mismatched cookie/header → 403 "CSRF token invalid"', async () => {
        const jwtToken = signToken({ id: 104, role: 'admin' }, { jwtid: 'csrf-mismatch' });
        await auth.recordActiveSession(jwtToken, { id: 104, tenant_id: 1 });

        const req = makeReq({
            method: 'POST',
            headers: {
                cookie: `rohy_auth=${jwtToken}; rohy_csrf=correct-token-x-43-chars-aaaaaaaaaaaaaa`,
                'x-csrf-token': 'wrong-token-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
            },
        });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'CSRF token invalid' });
    });

    it('cookie-auth POST with matching cookie/header → next() runs', async () => {
        const jwtToken = signToken({ id: 104, role: 'admin' }, { jwtid: 'csrf-ok' });
        await auth.recordActiveSession(jwtToken, { id: 104, tenant_id: 1 });
        const csrf = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg'; // 43 chars

        const req = makeReq({
            method: 'POST',
            headers: {
                cookie: `rohy_auth=${jwtToken}; rohy_csrf=${csrf}`,
                'x-csrf-token': csrf,
            },
        });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(req.user.id).toBe(104);
    });

    it('cookie-auth GET skips CSRF entirely (read methods are exempt)', async () => {
        const jwtToken = signToken({ id: 104, role: 'admin' }, { jwtid: 'csrf-get' });
        await auth.recordActiveSession(jwtToken, { id: 104, tenant_id: 1 });

        const req = makeReq({
            method: 'GET',
            headers: { cookie: `rohy_auth=${jwtToken}` },
            // No CSRF cookie, no header — irrelevant for GET.
        });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
    });

    it('bearer-auth POST without CSRF → next() (cross-site cant auto-attach Authorization)', async () => {
        const jwtToken = signToken({ id: 104, role: 'admin' }, { jwtid: 'csrf-bearer-skip' });
        await auth.recordActiveSession(jwtToken, { id: 104, tenant_id: 1 });

        const req = makeReq({
            method: 'POST',
            headers: { authorization: `Bearer ${jwtToken}` },
            // Deliberately no rohy_csrf cookie, no X-CSRF-Token header.
        });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(req.tokenSource).toBe('header');
    });
});

describe('auth middleware — HttpOnly cookie auth (rohy_auth)', () => {
    // The cookie path runs alongside the legacy bearer path: clients that
    // already use localStorage tokens keep working unchanged, clients that
    // use credentials:'include' get the HttpOnly protection. Login sets
    // BOTH (cookie + JSON token), logout clears the cookie and revokes
    // the active_sessions row.

    it('extractToken: prefers Authorization: Bearer when both header and cookie are present', () => {
        const req = makeReq({
            headers: {
                authorization: 'Bearer header-token',
                cookie: `rohy_auth=cookie-token`,
            },
        });
        expect(auth.extractToken(req)).toEqual({ token: 'header-token', source: 'header' });
    });

    it('extractToken: falls back to cookie when no header is present', () => {
        const req = makeReq({ headers: { cookie: 'foo=bar; rohy_auth=cookie-only; baz=qux' } });
        expect(auth.extractToken(req)).toEqual({ token: 'cookie-only', source: 'cookie' });
    });

    it('extractToken: returns {token:null} when neither header nor cookie carries one', () => {
        const req = makeReq({ headers: { cookie: 'foo=bar; baz=qux' } });
        expect(auth.extractToken(req)).toEqual({ token: null, source: null });
    });

    it('extractToken: tolerates URL-encoded cookie values', () => {
        const req = makeReq({ headers: { cookie: 'rohy_auth=ab%20cd' } });
        expect(auth.extractToken(req).token).toBe('ab cd');
    });

    it('authenticateToken accepts a valid JWT delivered via the cookie', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'cookie-accept' });
        await auth.recordActiveSession(token, { id: 104, tenant_id: 1 });

        const req = makeReq({ headers: { cookie: `rohy_auth=${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(req.user.id).toBe(104);
        // tokenSource is stashed so handlers like /auth/logout can decide
        // whether to clear the cookie.
        expect(req.tokenSource).toBe('cookie');
    });

    it('authenticateToken: cookie-mode tokens still go through active_sessions revocation', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'cookie-revoke' });
        await auth.recordActiveSession(token, { id: 104, tenant_id: 1 });
        await auth.revokeActiveSessionByToken(token);

        const req = makeReq({ headers: { cookie: `rohy_auth=${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        // The revoke-via-cookie path returns the same 401 as the bearer
        // path so the audit's revocation contract holds across both.
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Session revoked' });
    });
});

describe('auth middleware — server-side token revocation via active_sessions', () => {
    // Each test uses a unique jwtid so payload-derived JWTs don't collide on
    // active_sessions.token_hash (UNIQUE) — a deterministic-payload artefact,
    // not the production behaviour (real tokens carry an iat that always
    // differs).

    it('accepts a token whose active_sessions row has is_active=1', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'rev-accept' });
        await auth.recordActiveSession(token, { id: 104, tenant_id: 1 });

        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(req.user.id).toBe(104);
        expect(req.tokenHash).toBe(auth.hashToken(token));
    });

    it('rejects 401 "Session revoked" once the row is marked is_active=0', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'rev-revoked' });
        await auth.recordActiveSession(token, { id: 104, tenant_id: 1 });
        // Logout / admin force-logout / password change all flip is_active.
        await auth.revokeActiveSessionByToken(token);

        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Session revoked' });
        expect(res.__nextCalled).toBeFalsy();
    });

    it('accepts a token with NO active_sessions row at all (legacy compatibility)', async () => {
        // Tokens issued before this feature have no row to revoke. We let
        // them through so a deploy doesn't force every signed-in user to
        // re-login; their natural JWT expiry caps the worst case.
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'rev-legacy' });
        // Deliberately no recordActiveSession call.

        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(req.user.id).toBe(104);
    });

    it('rejects 401 "Session expired" if the row\'s expires_at is in the past', async () => {
        const token = signToken({ id: 104, role: 'admin' }, { jwtid: 'rev-expired' });
        const tokenHash = auth.hashToken(token);
        // Insert a row whose expires_at is already in the past.
        await pRun(
            testDb,
            `INSERT INTO active_sessions (user_id, token_hash, expires_at, tenant_id, is_active)
             VALUES (?, ?, datetime('now', '-1 hour'), ?, 1)`,
            [104, tokenHash, 1]
        );

        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Session expired' });
    });

    it('two distinct tokens for the same user revoke independently', async () => {
        // CONTRACT: the row is keyed by token_hash, not user_id. Revoking
        // one device must not log out the user's other sessions. Locks
        // the "force-logout one machine but stay logged in elsewhere" UX.
        const tokenA = signToken({ id: 104, role: 'admin' }, { jwtid: 'A' });
        const tokenB = signToken({ id: 104, role: 'admin' }, { jwtid: 'B' });
        await auth.recordActiveSession(tokenA, { id: 104, tenant_id: 1 });
        await auth.recordActiveSession(tokenB, { id: 104, tenant_id: 1 });
        await auth.revokeActiveSessionByToken(tokenA);

        const reqA = makeReq({ headers: { authorization: `Bearer ${tokenA}` } });
        const resA = makeRes();
        await runMiddleware(auth.authenticateToken, reqA, resA);
        expect(resA.statusCode).toBe(401);

        const reqB = makeReq({ headers: { authorization: `Bearer ${tokenB}` } });
        const resB = makeRes();
        await runMiddleware(auth.authenticateToken, reqB, resB);
        expect(resB.__nextCalled).toBe(true);
    });
});

describe('auth middleware — resolveTenant fallback chain', () => {
    it('returns req.user.tenant_id when present', () => {
        // CONTRACT (line 56 of auth.js): `req.user?.tenant_id || 1`.
        // The numeric tenant on req.user wins. We use 7 to make sure
        // the function isn't returning a hardcoded 1.
        expect(auth.resolveTenant({ user: { tenant_id: 7 } })).toBe(7);
    });

    it('falls back to default tenant 1 when req.user is missing', () => {
        // No user at all -> `?.tenant_id` short-circuits to undefined,
        // `|| 1` selects 1. Locks the actual fallback chain (there is
        // NO header-based fallback in the current implementation).
        expect(auth.resolveTenant({})).toBe(1);
    });

    it('falls back to 1 when req.user exists but has no tenant_id', () => {
        expect(auth.resolveTenant({ user: { id: 1, role: 'admin' } })).toBe(1);
    });

    it('CONTRACT: tenant_id of 0 falls back to 1 (`|| 1` is truthiness, not nullish)', () => {
        // `req.user?.tenant_id || 1` treats 0 as falsy. Locks the quirk.
        expect(auth.resolveTenant({ user: { tenant_id: 0 } })).toBe(1);
    });
});

describe('auth middleware — requireSameTenant', () => {
    it('blocks (403) when the resource belongs to a different tenant', async () => {
        const mw = auth.requireSameTenant(() => 2);
        const req = makeReq({ user: { tenant_id: 1, role: 'admin' } });
        const res = makeRes();
        await runMiddleware(mw, req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: 'Access denied: tenant mismatch' });
    });

    it('passes when caller and resource share a tenant_id', async () => {
        const mw = auth.requireSameTenant(() => 1);
        const req = makeReq({ user: { tenant_id: 1, role: 'admin' } });
        const res = makeRes();
        await runMiddleware(mw, req, res);
        expect(res.__nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    it('CONTRACT: getter returning null/undefined yields 404 "Resource not found"', async () => {
        const mw = auth.requireSameTenant(() => null);
        const req = makeReq({ user: { tenant_id: 1, role: 'admin' } });
        const res = makeRes();
        await runMiddleware(mw, req, res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: 'Resource not found' });
    });
});

describe('auth middleware — convenience wrappers + self-escalation', () => {
    it('CONTRACT: requireAdmin/Educator/Reviewer/Student wrappers exist and gate at their rank', () => {
        // Lock the four published wrappers from auth.js. Calling each
        // with a guest req must 403, calling each with admin must pass.
        const wrappers = ['requireAdmin', 'requireEducator', 'requireReviewer', 'requireStudent'];
        for (const name of wrappers) {
            expect(typeof auth[name]).toBe('function');

            const guestReq = makeReq({ user: { id: 1, role: 'guest' } });
            const guestRes = makeRes();
            auth[name](guestReq, guestRes, makeNext());
            expect(guestRes.statusCode).toBe(403);

            const adminReq = makeReq({ user: { id: 1, role: 'admin' } });
            const adminRes = makeRes();
            const adminNext = makeNext();
            auth[name](adminReq, adminRes, adminNext);
            expect(adminNext.wasCalled()).toBe(true);
        }
    });

    it('blocks self-escalation: a non-admin caller hitting a requireAdmin route gets 403', async () => {
        // End-to-end: authenticate first (DB-backed) so req.user reflects
        // the actual role, then run requireAdmin. Educator (rank 3) must
        // be rejected by the admin gate.
        const token = signToken({ id: 103, role: 'educator' });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = makeRes();
        await runMiddleware(auth.authenticateToken, req, res);
        expect(req.user.role).toBe('educator');

        const res2 = makeRes();
        const next2 = makeNext();
        auth.requireAdmin(req, res2, next2);
        expect(next2.wasCalled()).toBe(false);
        expect(res2.statusCode).toBe(403);
        expect(res2.body).toEqual({ error: 'Insufficient role' });
    });

    it('returns 401 (not 403) when requireRole runs without an authenticated user', () => {
        // CONTRACT: missing `req.user` distinguishes "not logged in" (401)
        // from "logged in but lacks the role" (403). Locks the split.
        const mw = auth.requireRole(auth.ROLE_RANKS.student);
        const req = makeReq();
        const res = makeRes();
        const next = makeNext();
        mw(req, res, next);
        expect(next.wasCalled()).toBe(false);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Authentication required' });
    });
});
