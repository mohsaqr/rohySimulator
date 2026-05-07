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

function makeReq({ headers = {}, user = undefined } = {}) {
    return { headers, user };
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
