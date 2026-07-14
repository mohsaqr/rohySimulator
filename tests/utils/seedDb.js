// Helpers for spinning up a throwaway sqlite database for server tests.
//
// `createTestDb()` opens a temp sqlite file, runs every migration in
// `migrations/` against it via the project's own migrationRunner, and
// returns:
//
//   { db, dbPath, run, get, all, exec, cleanup }
//
// Where `run/get/all/exec` are Promise-flavored convenience wrappers
// matching `server/dbAdapter.js` (we re-implement them here so tests don't
// have to import the singleton, which carries its own DB connection).
//
// When you want default agent rows etc. seeded, pass `{ seed: true }`.
// Seeding intentionally only inserts a minimal admin user + the agent
// templates that ship with the platform — not the full `runSeeders()`
// from `server/seeders/index.js`, because that one assumes the
// production sqlite3 singleton.
//
// Always call `cleanup()` (or pass through `{ db, dbPath, cleanup }` from
// startTestServer) to delete the temp file when the test ends.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import { runMigrations } from '../../server/migrationRunner.js';

function makeTempDbPath(label = 'test') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rohy-${label}-`));
    return { dir, file: path.join(dir, 'db.sqlite') };
}

function open(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}

function close(db) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        db.close(() => resolve());
    });
}

function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}
function pExec(db, sql) {
    return new Promise((resolve, reject) =>
        db.exec(sql, (err) => err ? reject(err) : resolve())
    );
}

/**
 * Create a fresh sqlite database, run migrations, optionally seed.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.seed=false]   Insert minimal default rows.
 * @param {string}  [opts.label='test'] Used for the tempdir prefix.
 * @param {object}  [opts.platformSettings] key→value rows written BEFORE the
 *   server boots. Needed for anything the server reads through a cache: writing
 *   `registration_mode` into a RUNNING server's DB looks unchanged for up to 15s
 *   (see registrationPolicy() in server/routes/_helpers.js), so a test that wants
 *   a mode in force from the first request must seed it here, not over HTTP.
 * @returns {Promise<{db, dbPath, dir, run, get, all, exec, cleanup}>}
 */
export async function createTestDb(opts = {}) {
    const { seed = false, label = 'test', platformSettings = null } = opts;
    const { dir, file } = makeTempDbPath(label);
    const db = await open(file);

    await runMigrations(db);

    if (seed) {
        await seedMinimal(db);
    }

    if (platformSettings) {
        for (const [key, value] of Object.entries(platformSettings)) {
            await pRun(
                db,
                `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
                 ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
                [key, String(value)]
            );
        }
    }

    let cleanedUp = false;
    async function cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        await close(db);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    return {
        db,
        dbPath: file,
        dir,
        run: (sql, params) => pRun(db, sql, params),
        get: (sql, params) => pGet(db, sql, params),
        all: (sql, params) => pAll(db, sql, params),
        exec: (sql) => pExec(db, sql),
        cleanup,
    };
}

/**
 * Insert a minimal set of rows so route tests have something to query
 * without importing the full prod seeder (which depends on the singleton
 * `server/db.js` connection).
 *
 * - One admin user (`testadmin` / `testpass`) with a precomputed-ish
 *   bcrypt hash. We don't import bcrypt here to keep test setup fast;
 *   tests that need a real login should hash a fresh password themselves.
 *   The hash below is `bcrypt.hashSync('testpass', 4)` — low cost, just
 *   for tests.
 */
async function seedMinimal(db) {
    // Random hash so two test runs in parallel don't collide on something
    // someone might accidentally check against. Real auth tests should
    // generate their own bcrypt hash.
    const placeholderHash = `$2b$04$${crypto.randomBytes(22).toString('base64').slice(0, 22)}.${crypto.randomBytes(22).toString('base64').slice(0, 31)}`;
    try {
        await pRun(
            db,
            `INSERT OR IGNORE INTO users (username, email, password_hash, role)
             VALUES (?, ?, ?, ?)`,
            ['testadmin', 'test@example.com', placeholderHash, 'admin']
        );
    } catch {
        // Schema may not have a users table yet on a partially-migrated
        // tree — that's fine, callers can opt out of seed.
    }
}

export default createTestDb;
