// tests/server/migrationRunner.test.js
//
// Stage E2 — locks the contract of `server/migrationRunner.js`:
//
//   - Discovers `migrations/*.sql` files matching /^\d+_.+\.sql$/
//     and applies them in lexicographic order (so '0001' < '0010' < '0100').
//   - Tracks state in `schema_migrations(version, name, applied_at, checksum)`
//     where `version` is the leading digits before the first `_`.
//   - Verifies checksums on every run; mutating an applied file on disk
//     causes the runner to throw with message:
//         "Migration checksum mismatch for <name>"
//     (see runMigrations() in server/migrationRunner.js, ~L203).
//   - Supports `dryRun: true` which lists pending migrations without
//     creating `schema_migrations` and without executing the SQL.
//   - Baseline-stamps version '0001' on a database that already has the
//     pre-E2 schema (BASELINE_TABLES present), without re-running the SQL.
//   - Idempotent: a second consecutive run applies nothing new.
//   - On a SQL syntax error the runner rejects and does NOT record the
//     migration in `schema_migrations`.
//   - First run on a fresh DB auto-creates `schema_migrations`.
//
// Tests use isolated tempdirs/tempfiles per `it()` and clean up in
// `afterEach`. We open raw sqlite3 connections rather than going through
// `seedDb.js` because seedDb invokes the runner against the real
// `migrations/` directory — for these tests we want a controlled set of
// fake migration files in a tempdir.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import {
    runMigrations,
    discoverMigrations
} from '../../server/migrationRunner.js';

// ---------------------------------------------------------------------------
// Promise wrappers around sqlite3 (mirrors helpers in seedDb.js, kept local
// so we don't pollute another test helper while sibling agents work in it).
// ---------------------------------------------------------------------------

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}

function closeDb(db) {
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
function pExec(db, sql) {
    return new Promise((resolve, reject) =>
        db.exec(sql, (err) => err ? reject(err) : resolve())
    );
}

// ---------------------------------------------------------------------------
// Tempdir / tempfile helpers
// ---------------------------------------------------------------------------

function makeTempEnv() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), `rohy-migration-test-${crypto.randomBytes(4).toString('hex')}-`)
    );
    const migrationsDir = path.join(root, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    const dbFile = path.join(root, 'db.sqlite');
    return { root, migrationsDir, dbFile };
}

function writeMigration(dir, name, sql) {
    fs.writeFileSync(path.join(dir, name), sql);
}

// Real-shape baseline: matches BASELINE_TABLES in migrationRunner.js so that
// `hasBaselineSchema()` returns true. The columns are intentionally minimal —
// the runner only looks up names in sqlite_master, never the columns.
const BASELINE_BOOTSTRAP_SQL = `
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE cases (id INTEGER PRIMARY KEY);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY);
    CREATE TABLE interactions (id INTEGER PRIMARY KEY);
    CREATE TABLE alarm_config (id INTEGER PRIMARY KEY);
    CREATE TABLE agent_templates (id INTEGER PRIMARY KEY);
    CREATE TABLE treatment_orders (id INTEGER PRIMARY KEY);
    CREATE TABLE questionnaire_responses (id INTEGER PRIMARY KEY);
`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('server/migrationRunner.js', () => {
    let env;
    let db;

    beforeEach(async () => {
        env = makeTempEnv();
        db = await openDb(env.dbFile);
    });

    afterEach(async () => {
        await closeDb(db);
        try {
            fs.rmSync(env.root, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    });

    // -----------------------------------------------------------------------
    // 1. Pending detection
    // -----------------------------------------------------------------------

    it('detects all SQL files as pending on a fresh DB and applies them once', async () => {
        // CONTRACT: `runMigrations` discovers every `\d+_.+\.sql` in the
        // configured dir. With 3 fresh files and an empty DB, all 3 must
        // appear in `result.applied` after the first invocation.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE t2 (id INTEGER);');
        writeMigration(env.migrationsDir, '0003_c.sql', 'CREATE TABLE t3 (id INTEGER);');

        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.dryRun).toBe(false);
        expect(result.applied.map((m) => m.version)).toEqual(['0001', '0002', '0003']);
        expect(result.applied.map((m) => m.name)).toEqual([
            '0001_a.sql', '0002_b.sql', '0003_c.sql'
        ]);

        const rows = await pAll(db, 'SELECT version FROM schema_migrations ORDER BY version');
        expect(rows.map((r) => r.version)).toEqual(['0001', '0002', '0003']);
    });

    it('after applying one migration manually, only the remaining two are applied next run', async () => {
        // CONTRACT: a row in `schema_migrations` with matching checksum
        // marks the migration as already-applied; only versions absent
        // from that table are re-run.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE t2 (id INTEGER);');
        writeMigration(env.migrationsDir, '0003_c.sql', 'CREATE TABLE t3 (id INTEGER);');

        // Apply only 0001 by running with just that file present, then add others.
        // Easier: run all three, drop tracking for 0002+0003, re-run.
        await runMigrations(db, { migrationsDir: env.migrationsDir });
        await pExec(db, "DELETE FROM schema_migrations WHERE version IN ('0002','0003')");
        await pExec(db, 'DROP TABLE t2; DROP TABLE t3;');

        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.applied.map((m) => m.version)).toEqual(['0002', '0003']);
    });

    // -----------------------------------------------------------------------
    // 2. Checksum mismatch error
    // -----------------------------------------------------------------------

    it('throws "Migration checksum mismatch for <name>" when an applied file is mutated on disk', async () => {
        // CONTRACT: see runMigrations() in server/migrationRunner.js (~L203):
        //   `throw new Error(\`Migration checksum mismatch for ${migration.name}\`)`
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        await runMigrations(db, { migrationsDir: env.migrationsDir });

        // Mutate the file content — sha256 will differ.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1_changed (id INTEGER);');

        await expect(
            runMigrations(db, { migrationsDir: env.migrationsDir })
        ).rejects.toThrow('Migration checksum mismatch for 0001_a.sql');
    });

    // -----------------------------------------------------------------------
    // 3. Dry-run behaviour
    // -----------------------------------------------------------------------

    it('dryRun=true does not create schema_migrations and does not execute pending SQL', async () => {
        // CONTRACT: in dry-run the runner returns early BEFORE
        // `ensureSchemaMigrations(db)` is called, so the table is not
        // created and no migration SQL runs.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE pending_t1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE pending_t2 (id INTEGER);');

        const result = await runMigrations(db, {
            migrationsDir: env.migrationsDir,
            dryRun: true
        });
        expect(result.dryRun).toBe(true);
        expect(result.applied).toEqual([]);

        // No schema_migrations table.
        const sm = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        );
        expect(sm).toBeNull();

        // No tables from the pending migrations.
        const t1 = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_t1'"
        );
        const t2 = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_t2'"
        );
        expect(t1).toBeNull();
        expect(t2).toBeNull();
    });

    it('a real run after a dryRun applies everything that was previously listed', async () => {
        // CONTRACT: dry-run is purely observational. The same DB, run
        // again without `dryRun`, must apply every pending migration.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE r1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE r2 (id INTEGER);');

        await runMigrations(db, { migrationsDir: env.migrationsDir, dryRun: true });
        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.applied.map((m) => m.version)).toEqual(['0001', '0002']);
    });

    // -----------------------------------------------------------------------
    // 4. Baseline stamping
    // -----------------------------------------------------------------------

    it('stamps 0001 as applied without running its SQL when DB already has BASELINE_TABLES', async () => {
        // CONTRACT: BASELINE_VERSIONS = {'0001'} and BASELINE_TABLES are
        // checked against sqlite_master. If `applied.size === 0` and all
        // baseline tables exist, the runner inserts a row into
        // schema_migrations for 0001 WITHOUT executing the SQL.
        //
        // We prove "did not run the SQL" by giving 0001 a body that would
        // throw if executed (creating a table that already exists, since
        // we pre-created `users` in the bootstrap).
        await pExec(db, BASELINE_BOOTSTRAP_SQL);

        // SQL that WOULD fail if executed (users already exists, no IF NOT EXISTS).
        writeMigration(
            env.migrationsDir,
            '0001_initial.sql',
            'CREATE TABLE users (id INTEGER PRIMARY KEY);'
        );

        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.baselineStamped.map((m) => m.version)).toEqual(['0001']);
        expect(result.applied).toEqual([]); // SQL was NOT executed.

        const row = await pGet(
            db,
            'SELECT version, name, checksum FROM schema_migrations WHERE version = ?',
            ['0001']
        );
        expect(row).not.toBeNull();
        expect(row.name).toBe('0001_initial.sql');
        expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does NOT baseline-stamp on a fresh DB with no pre-existing tables', async () => {
        // CONTRACT: hasBaselineSchema returns false when not all
        // BASELINE_TABLES are present. The 0001 SQL is therefore actually
        // executed instead of stamped.
        writeMigration(
            env.migrationsDir,
            '0001_initial.sql',
            'CREATE TABLE marker_table (id INTEGER PRIMARY KEY);'
        );

        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.baselineStamped).toEqual([]);
        expect(result.applied.map((m) => m.version)).toEqual(['0001']);

        const t = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='marker_table'"
        );
        expect(t).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // 5. Idempotent rerun
    // -----------------------------------------------------------------------

    it('a second consecutive run applies nothing and does not error', async () => {
        // CONTRACT: every applied version is filtered out on the second
        // pass (`effectiveApplied.has(migration.version)`), so
        // `result.applied` is empty.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE t2 (id INTEGER);');

        const first = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(first.applied).toHaveLength(2);

        const second = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(second.applied).toEqual([]);
        // Skipped should list every known version.
        expect(second.skipped.map((m) => m.version).sort()).toEqual(['0001', '0002']);
    });

    // -----------------------------------------------------------------------
    // 6. Sort order
    // -----------------------------------------------------------------------

    it('applies migrations in lexicographic version order regardless of write order', async () => {
        // CONTRACT: discoverMigrations sorts by `localeCompare`. Because
        // every filename uses the same width (4 digits), '0001' < '0010'
        // < '0100' as both lex-sort and numeric-sort.
        writeMigration(env.migrationsDir, '0100_late.sql', 'CREATE TABLE late_t (id INTEGER);');
        writeMigration(env.migrationsDir, '0001_first.sql', 'CREATE TABLE first_t (id INTEGER);');
        writeMigration(env.migrationsDir, '0010_middle.sql', 'CREATE TABLE middle_t (id INTEGER);');

        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.applied.map((m) => m.version)).toEqual(['0001', '0010', '0100']);
        expect(result.applied.map((m) => m.name)).toEqual([
            '0001_first.sql', '0010_middle.sql', '0100_late.sql'
        ]);

        // schema_migrations rows order also reflects insertion (and
        // therefore application) order.
        const rows = await pAll(
            db,
            'SELECT version FROM schema_migrations ORDER BY rowid'
        );
        expect(rows.map((r) => r.version)).toEqual(['0001', '0010', '0100']);
    });

    it('discoverMigrations(dir) ignores files that do not match /^\\d+_.+\\.sql$/', async () => {
        // CONTRACT: filter regex in discoverMigrations rejects anything
        // without leading digits + underscore + name + `.sql`. README.md,
        // dotfiles, and SQL with non-numeric prefix must be skipped.
        writeMigration(env.migrationsDir, '0001_real.sql', 'CREATE TABLE t1 (id INTEGER);');
        writeMigration(env.migrationsDir, 'README.md', '# notes');
        writeMigration(env.migrationsDir, 'not_a_migration.sql', 'select 1;');
        writeMigration(env.migrationsDir, '0002_real.sql', 'CREATE TABLE t2 (id INTEGER);');

        const list = discoverMigrations(env.migrationsDir);
        expect(list.map((m) => m.name)).toEqual(['0001_real.sql', '0002_real.sql']);
        // Each entry carries a hex sha256 checksum.
        list.forEach((m) => expect(m.checksum).toMatch(/^[0-9a-f]{64}$/));
    });

    // -----------------------------------------------------------------------
    // 7. Failure mid-migration
    // -----------------------------------------------------------------------

    it('a SQL syntax error rejects and does NOT record the broken migration', async () => {
        // CONTRACT: applyMigration() wraps exec() in BEGIN/COMMIT and
        // rolls back on error. The promise rejects (with the sqlite3
        // error) and `schema_migrations` does not get a row for that
        // version.
        writeMigration(env.migrationsDir, '0001_good.sql', 'CREATE TABLE good_t (id INTEGER);');
        writeMigration(
            env.migrationsDir,
            '0002_broken.sql',
            'CREATE TABL broken_t (id INTEGER);' // typo — TABL not TABLE
        );

        await expect(
            runMigrations(db, { migrationsDir: env.migrationsDir })
        ).rejects.toThrow();

        // 0001 still applied (it ran before the failure).
        const good = await pGet(
            db,
            'SELECT version FROM schema_migrations WHERE version = ?',
            ['0001']
        );
        expect(good).not.toBeNull();

        // 0002 NOT recorded.
        const broken = await pGet(
            db,
            'SELECT version FROM schema_migrations WHERE version = ?',
            ['0002']
        );
        expect(broken).toBeNull();

        // The broken table does not exist either.
        const tbl = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='broken_t'"
        );
        expect(tbl).toBeNull();
    });

    // -----------------------------------------------------------------------
    // 8. schema_migrations auto-creation + shape
    // -----------------------------------------------------------------------

    it('first non-dry-run on a fresh DB auto-creates the schema_migrations table', async () => {
        // CONTRACT: ensureSchemaMigrations() runs CREATE TABLE IF NOT EXISTS
        // schema_migrations(version PRIMARY KEY, name NOT NULL, applied_at,
        // checksum NOT NULL).
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');

        await runMigrations(db, { migrationsDir: env.migrationsDir });

        const tbl = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        );
        expect(tbl).not.toBeNull();

        // Columns exist with the documented names.
        const cols = await pAll(db, 'PRAGMA table_info(schema_migrations)');
        const names = cols.map((c) => c.name).sort();
        expect(names).toEqual(['applied_at', 'checksum', 'name', 'version']);

        // version is the primary key.
        const pk = cols.find((c) => c.name === 'version');
        expect(pk.pk).toBe(1);
    });

    it('records the sha256 checksum of the file body in schema_migrations.checksum', async () => {
        // CONTRACT: checksum() = sha256(sql). The runner stores that exact
        // hex digest, so re-hashing the file content must match the row.
        const sql = 'CREATE TABLE checksum_t (id INTEGER);';
        writeMigration(env.migrationsDir, '0001_check.sql', sql);

        await runMigrations(db, { migrationsDir: env.migrationsDir });

        const row = await pGet(
            db,
            'SELECT checksum FROM schema_migrations WHERE version = ?',
            ['0001']
        );
        const expected = crypto.createHash('sha256').update(sql).digest('hex');
        expect(row.checksum).toBe(expected);
    });

    it('returns dryRun=true result with empty applied[] when there are no pending migrations', async () => {
        // CONTRACT: dryRun returns `{ applied: [], skipped, baselineStamped, dryRun: true }`.
        // After a real run leaves the DB current, a follow-up dryRun
        // reports no new work without touching the DB.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        await runMigrations(db, { migrationsDir: env.migrationsDir });

        const result = await runMigrations(db, {
            migrationsDir: env.migrationsDir,
            dryRun: true
        });
        expect(result.dryRun).toBe(true);
        expect(result.applied).toEqual([]);
        expect(result.skipped.map((m) => m.version)).toEqual(['0001']);
        expect(result.baselineStamped).toEqual([]);
    });

    it('an empty migrations directory results in a no-op success', async () => {
        // CONTRACT: discoverMigrations on an empty dir returns []. The
        // runner still ensures schema_migrations exists (so the next
        // file added will track cleanly) and returns
        // `applied: [], skipped: [], baselineStamped: [], dryRun: false`.
        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.baselineStamped).toEqual([]);
        expect(result.dryRun).toBe(false);

        const tbl = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        );
        expect(tbl).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // 9. Audit #13 — downgrade / dirty-database safety
    // -----------------------------------------------------------------------

    it('"future" migration versions in DB are tolerated (downgrade contract)', async () => {
        // Scenario: a deploy applied 0001..0005, then was rolled back to a
        // build that only ships 0001..0003 on disk. The schema_migrations
        // table contains versions newer than discoverMigrations() can see.
        // The runner must NOT crash, must NOT re-run already-applied 0001-0003,
        // and must report no new work — the operator can then redeploy the
        // newer build to catch up.
        writeMigration(env.migrationsDir, '0001_a.sql', 'CREATE TABLE t1 (id INTEGER);');
        writeMigration(env.migrationsDir, '0002_b.sql', 'CREATE TABLE t2 (id INTEGER);');

        // Apply the on-disk migrations.
        await runMigrations(db, { migrationsDir: env.migrationsDir });

        // Pretend a future deploy applied a 0003 we no longer have on disk.
        const fakeChecksum = crypto.createHash('sha256').update('-- removed').digest('hex');
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO schema_migrations (version, name, applied_at, checksum)
                 VALUES ('0003', '0003_future.sql', CURRENT_TIMESTAMP, ?)`,
                [fakeChecksum],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Re-running against the older directory must not crash.
        const result = await runMigrations(db, { migrationsDir: env.migrationsDir });
        expect(result.applied).toEqual([]);
        expect(result.dryRun).toBe(false);

        // The future row is still there — the runner did not touch it.
        const future = await pGet(
            db,
            'SELECT version FROM schema_migrations WHERE version = ?',
            ['0003']
        );
        expect(future).not.toBeNull();
    });

    it('a multi-statement migration with a mid-statement failure leaves the DB clean', async () => {
        // Scenario (audit #13): operator authors 0001 with two statements;
        // the second fails. The transaction wrapper must roll back so the
        // first statement's effect is gone and the migration is NOT
        // recorded — re-running the migration after the operator fixes the
        // SQL must apply the (corrected) version cleanly.
        writeMigration(
            env.migrationsDir,
            '0001_partial.sql',
            `CREATE TABLE partial_t (id INTEGER);
             INSERT INTO doesnt_exist (id) VALUES (1);` // second statement errors
        );

        await expect(
            runMigrations(db, { migrationsDir: env.migrationsDir })
        ).rejects.toThrow();

        // BEGIN/COMMIT rollback: partial_t must NOT exist.
        const partial = await pGet(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='partial_t'"
        );
        expect(partial).toBeNull();

        // schema_migrations row not created.
        const row = await pGet(
            db,
            'SELECT version FROM schema_migrations WHERE version = ?',
            ['0001']
        );
        expect(row).toBeNull();

        // Operator fixes the SQL — second run applies cleanly.
        writeMigration(
            env.migrationsDir,
            '0001_partial.sql',
            `CREATE TABLE partial_t (id INTEGER);
             INSERT INTO partial_t (id) VALUES (1);`
        );
        await runMigrations(db, { migrationsDir: env.migrationsDir });

        const fixed = await pGet(
            db,
            'SELECT version FROM schema_migrations WHERE version = ?',
            ['0001']
        );
        expect(fixed).not.toBeNull();
        const inserted = await pGet(db, 'SELECT id FROM partial_t WHERE id = ?', [1]);
        expect(inserted).not.toBeNull();
    });
});
