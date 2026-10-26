// Security fix pass 2026-10-26, lane D — migration 0073 and the migrate CLI.
//
// Regression lock: heart rate and respiration were ON by default (0040) for every tenant; 0073 turns them off ONLY where no administrator ever saved the Oyon settings (F-04).
// Regression lock: survey_responses had no unique index, so concurrent submits both landed; 0073 keys the earliest response per (survey, user, cohort) and indexes the key without deleting any stored duplicate (F-37 / F-39).
// Regression lock: scripts/migrate.js applied migrations without the pre-migration backup the boot path takes (L7-19).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../server/migrationRunner.js';

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(repoRoot, 'migrations');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2d-mig-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const open = (file) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
});
const close = (db) => new Promise((resolve) => db.close(() => resolve()));
const run = (db, sql, p = []) => new Promise((resolve, reject) => db.run(sql, p, function done(err) { err ? reject(err) : resolve(this); }));
const all = (db, sql, p = []) => new Promise((resolve, reject) => db.all(sql, p, (err, rows) => (err ? reject(err) : resolve(rows))));

/** A migrations dir holding every file before 0073, so the test can seed data 0073 then rewrites. */
function migrationsBefore0073() {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'm-'));
    for (const f of fs.readdirSync(MIGRATIONS)) {
        if (/^\d{4}_.*\.sql$/.test(f) && f < '0073') fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    }
    return dir;
}

describe('migration 0073', () => {
    it('turns heart rate and respiration off only on never-saved tenants, and keys survey responses without deleting any', async () => {
        const dir = migrationsBefore0073();
        const db = await open(path.join(dir, 'db.sqlite'));
        try {
            await runMigrations(db, { migrationsDir: dir });
            // Tenant 1: never saved (lazy insert: created_at = updated_at).
            await run(db, `INSERT INTO oyon_settings (tenant_id, created_at, updated_at) VALUES ('1', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`);
            // Tenant 2: an administrator saved it (updated_at moved).
            await run(db, `INSERT INTO oyon_settings (tenant_id, created_at, updated_at) VALUES ('2', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z')`);
            // Tenant 3: timestamps equal, but the audit log records a save.
            await run(db, `INSERT INTO oyon_settings (tenant_id, created_at, updated_at) VALUES ('3', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`);
            await run(db, `INSERT INTO system_audit_log (action, resource_type, resource_id, tenant_id) VALUES ('oyon.settings_updated', 'oyon_settings', '3', 3)`);

            await run(db, `INSERT INTO users (id, username, password_hash, role, tenant_id) VALUES (50, 'm_u', 'x', 'student', 1)`);
            await run(db, `INSERT INTO surveys (id, title, created_by_id, tenant_id) VALUES (7, 'S', 50, 1)`);
            for (const [user, cohort] of [[50, null], [50, null], [50, 3], [null, null]]) {
                await run(db, 'INSERT INTO survey_responses (survey_id, user_id, cohort_id) VALUES (7, ?, ?)', [user, cohort]);
            }

            fs.copyFileSync(path.join(MIGRATIONS, '0073_privacy_audit_hash_v2_survey_dedupe.sql'), path.join(dir, '0073_privacy_audit_hash_v2_survey_dedupe.sql'));
            const result = await runMigrations(db, { migrationsDir: dir });
            expect(result.applied.map((m) => m.version)).toEqual(['0073']);

            const settings = await all(db, 'SELECT tenant_id, heart_rate_enabled AS hr, respiration_enabled AS rr FROM oyon_settings ORDER BY tenant_id');
            expect(settings).toEqual([
                { tenant_id: '1', hr: 0, rr: 0 },
                { tenant_id: '2', hr: 1, rr: 1 },
                { tenant_id: '3', hr: 1, rr: 1 },
            ]);

            const responses = await all(db, 'SELECT id, user_id, cohort_id, dedupe_key FROM survey_responses ORDER BY id');
            expect(responses.length).toBe(4); // nothing deleted
            expect(responses.map((r) => r.dedupe_key)).toEqual(['u:50:c:-', null, 'u:50:c:3', null]);
            await expect(run(db, "INSERT INTO survey_responses (survey_id, user_id, dedupe_key) VALUES (7, 50, 'u:50:c:-')"))
                .rejects.toThrow(/UNIQUE/);

            const cols = await all(db, 'PRAGMA table_info(system_audit_log)');
            expect(cols.some((c) => c.name === 'hash_version')).toBe(true);
        } finally {
            await close(db);
        }
    });
});

describe('scripts/migrate.js', () => {
    it('takes the pre-migration backup the boot path takes', async () => {
        const dir = fs.mkdtempSync(path.join(tmpRoot, 'cli-'));
        const dbFile = path.join(dir, 'database.sqlite');
        fs.writeFileSync(dbFile, '');
        const env = { ...process.env, ROHY_DB: dbFile, JWT_SECRET: 'x', ROHY_BACKUP_BEFORE_MIGRATE: '1' };
        await execFileP('node', [path.join(repoRoot, 'scripts', 'migrate.js')], { env, cwd: repoRoot });
        const backups = fs.readdirSync(dir).filter((f) => f.startsWith('database.sqlite.bak.'));
        expect(backups.length).toBe(1);
        expect(fs.statSync(path.join(dir, backups[0])).mode & 0o777).toBe(0o600);
        // Nothing pending on a second run: no second backup.
        await execFileP('node', [path.join(repoRoot, 'scripts', 'migrate.js')], { env, cwd: repoRoot });
        expect(fs.readdirSync(dir).filter((f) => f.startsWith('database.sqlite.bak.')).length).toBe(1);
    }, 120_000);
});
