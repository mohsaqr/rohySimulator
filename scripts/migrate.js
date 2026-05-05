#!/usr/bin/env node
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../server/migrationRunner.js';

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
        const result = await runMigrations(db, { dryRun });
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
