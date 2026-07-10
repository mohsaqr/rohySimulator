// Migration 0034 (Voice 2.0 settings retirement) — carry-over rules and
// deletions, exercised directly against an in-memory sqlite DB so the
// legacy-row permutations are testable (the spawned-server path applies
// migrations before a test can insert legacy rows).
//
// Contract (VOICE2_PLAN.md §5.5):
//   - exactly ONE legacy default_voice_kokoro_* value (or both equal)
//     → carried into tts_default_voice_en;
//   - both set and DIFFERENT → no carry-over (boot seeding fills af_bella;
//     no silent gender tiebreak);
//   - an existing tts_default_voice_en is never overwritten;
//   - tts_provider, default_voice_*, and voice_<p>_<gender> rows are
//     deleted; voice_mode_enabled survives (the 0022 `voice_%` bug class);
//   - re-running the SQL is a no-op (re-run-safe).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
    path.join(__dirname, '..', '..', 'migrations', '0034_voice2_provider_follows_voice.sql'),
    'utf8'
);

function run(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null)));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}

describe('migration 0034 — Voice 2.0 settings retirement', () => {
    let db;

    beforeEach(async () => {
        db = new (sqlite3.verbose()).Database(':memory:');
        await exec(db, `
            CREATE TABLE platform_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                updated_by INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    });

    afterEach(() => new Promise((resolve) => db.close(() => resolve())));

    const insert = (key, value) =>
        run(db, 'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
    const valueOf = async (key) =>
        (await get(db, 'SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]))?.setting_value ?? null;

    it('carries a single legacy kokoro value into tts_default_voice_en', async () => {
        await insert('tts_provider', 'kokoro');
        await insert('default_voice_kokoro_female', 'af_sky');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('tts_default_voice_en')).toBe('af_sky');
        expect(await valueOf('tts_provider')).toBe(null);
        expect(await valueOf('default_voice_kokoro_female')).toBe(null);
    });

    it('carries when both legacy genders agree', async () => {
        await insert('default_voice_kokoro_female', 'af_sky');
        await insert('default_voice_kokoro_male', 'af_sky');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('tts_default_voice_en')).toBe('af_sky');
    });

    it('does NOT carry when the legacy genders conflict (no silent tiebreak)', async () => {
        await insert('default_voice_kokoro_female', 'af_sky');
        await insert('default_voice_kokoro_male', 'am_liam');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('tts_default_voice_en')).toBe(null); // boot seed fills af_bella later
        expect(await valueOf('default_voice_kokoro_male')).toBe(null); // still retired
    });

    it('never overwrites an existing tts_default_voice_en', async () => {
        await insert('tts_default_voice_en', 'bm_lewis');
        await insert('default_voice_kokoro_female', 'af_sky');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('tts_default_voice_en')).toBe('bm_lewis');
    });

    it('ignores empty-string legacy values', async () => {
        await insert('default_voice_kokoro_female', '');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('tts_default_voice_en')).toBe(null);
    });

    it('deletes slot rows but PRESERVES voice_mode_enabled (the 0022 bug class)', async () => {
        await insert('voice_mode_enabled', 'true');
        await insert('voice_google_female', 'en-US-Chirp3-HD-Aoede');
        await insert('voice_kokoro_male', 'am_liam');
        await insert('default_voice_google_female', 'en-US-Neural2-F');
        await exec(db, MIGRATION_SQL);
        expect(await valueOf('voice_mode_enabled')).toBe('true');
        expect(await valueOf('voice_google_female')).toBe(null);
        expect(await valueOf('voice_kokoro_male')).toBe(null);
        expect(await valueOf('default_voice_google_female')).toBe(null);
    });

    it('is re-run-safe (idempotent)', async () => {
        await insert('tts_provider', 'google');
        await insert('default_voice_kokoro_female', 'af_sky');
        await exec(db, MIGRATION_SQL);
        await exec(db, MIGRATION_SQL); // second run must not throw or change anything
        expect(await valueOf('tts_default_voice_en')).toBe('af_sky');
        const rows = await all(db, "SELECT setting_key FROM platform_settings WHERE setting_key = 'tts_default_voice_en'");
        expect(rows.length).toBe(1);
    });
});
