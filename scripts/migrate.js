#!/usr/bin/env node
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations, backupBeforeMigrate, pruneMigrationBackups } from '../server/migrationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dbPath = process.env.ROHY_DB || path.join(repoRoot, 'server', 'database.sqlite');
const dryRun = process.argv.includes('--dry-run');

const sqlite = sqlite3.verbose();
const db = new sqlite.Database(dbPath, async (err) => {
    if (err) {
        console.error(`[migration] failed to open ${dbPath}: ${err.message}`);
        process.exit(1);
    }

    try {
        // The same pre-migration snapshot the boot path takes (it used to be
        // taken only there, so a migration run from this CLI had no way back —
        // security audit 2026-10-26, L7-19). A dry run changes nothing and
        // needs none.
        const backup = dryRun ? { tookBackup: false } : await backupBeforeMigrate(db, dbPath);
        if (backup.tookBackup) console.log(`[migration] backup written to ${backup.backupPath}`);
        const result = await runMigrations(db, { dryRun });
        if (backup.tookBackup) await pruneMigrationBackups(dbPath);
        if (!dryRun) {
            console.log(`[migration] applied ${result.applied.length} migration${result.applied.length === 1 ? '' : 's'}`);
        }
        db.close((closeErr) => {
            if (closeErr) {
                console.error(`[migration] failed to close database: ${closeErr.message}`);
                process.exit(1);
            }
        });
    } catch (migrationErr) {
        console.error(`[migration] failed: ${migrationErr.message}`);
        db.close(() => process.exit(1));
    }
});
