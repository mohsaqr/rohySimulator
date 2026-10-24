// Migration 0071 (on-call specialists talk like colleagues), exercised against
// an in-memory sqlite DB so the "still as seeded" / "educator edited" row
// permutations are testable (the spawned-server path seeds the new text
// before a test could insert an old row).
//
// Contract (migrations/MANIFEST.md, 0071):
//   - a seeded specialist still holding the old prompt / dos+donts / default
//     disclosure gets the new one — exactly what a fresh install seeds today
//     (server/db.js), so an upgraded install and a new one cannot differ;
//   - the old default disclosure is recognised with or without the retired
//     requireInterpretation flag;
//   - anything an educator changed is left alone, field by field;
//   - a non-default (educator-made) template is never touched;
//   - re-running the SQL is a no-op.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const MIGRATION_SQL = fs.readFileSync(path.join(ROOT, 'migrations', '0071_oncall_specialists_colleague_voice.sql'), 'utf8');
// server/db.js opens the database at import time, so it is read as text.
const DB_JS = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');

const TYPES = ['pathologist', 'cardiologist', 'radiologist', 'laboratorian'];
const OLD_DISCLOSURE = { findings: 'after_effort', minStudentTurns: 3, requireRoomActivity: true };
const NEW_DISCLOSURE = { findings: 'on_request', minStudentTurns: 3, requireRoomActivity: true };

const unsql = (s) => s.replace(/''/g, "'");

// The values each UPDATE matches on, read back out of the migration itself.
function oldValues(type) {
    const prompt = MIGRATION_SQL.match(new RegExp(`AND agent_type = '${type}'\\n   AND system_prompt = '((?:[^']|'')*)';`));
    const lists = MIGRATION_SQL.match(new RegExp(
        `AND agent_type = '${type}'\\n   AND json_valid\\(config\\)\\n`
        + `   AND json_extract\\(config, '\\$\\.dos'\\) = json\\('((?:[^']|'')*)'\\)\\n`
        + `   AND json_extract\\(config, '\\$\\.donts'\\) = json\\('((?:[^']|'')*)'\\);`));
    expect(prompt, `${type} old prompt`).not.toBeNull();
    expect(lists, `${type} old dos/donts`).not.toBeNull();
    return { prompt: unsql(prompt[1]), dos: JSON.parse(unsql(lists[1])), donts: JSON.parse(unsql(lists[2])) };
}

// What a fresh install seeds today.
function seeded(type) {
    const start = DB_JS.indexOf(`agent_type: '${type}',\n            name: SPECIALTIES.`);
    expect(start, `${type} in DEFAULT_AGENTS`).toBeGreaterThan(-1);
    const entry = DB_JS.slice(start, DB_JS.indexOf('\n        }', start));
    const prompt = entry.match(/system_prompt: `([^`]*)`/)[1];
    const list = (key) => [...entry.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    return { prompt, dos: list('dos'), donts: list('donts') };
}

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null)));

describe('migration 0071 — on-call specialists talk like colleagues', () => {
    let db;

    beforeEach(async () => {
        db = new (sqlite3.verbose()).Database(':memory:');
        await exec(db, `CREATE TABLE agent_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_type TEXT, name TEXT, system_prompt TEXT, config TEXT, is_default INTEGER DEFAULT 0)`);
    });
    afterEach(() => new Promise((resolve) => db.close(() => resolve())));

    async function insertOld(type, { prompt, dos, donts, disclosure = OLD_DISCLOSURE, isDefault = 1 } = {}) {
        const old = oldValues(type);
        const config = { specialty: type, disclosure, dos: dos ?? old.dos, donts: donts ?? old.donts, voice: { gender: 'female' } };
        return (await run(db, 'INSERT INTO agent_templates (agent_type, name, system_prompt, config, is_default) VALUES (?, ?, ?, ?, ?)',
            [type, `On-call ${type}`, prompt ?? old.prompt, JSON.stringify(config), isDefault])).lastID;
    }
    const row = async (id) => {
        const r = await get(db, 'SELECT system_prompt, config FROM agent_templates WHERE id = ?', [id]);
        return { prompt: r.system_prompt, config: JSON.parse(r.config) };
    };

    it.each(TYPES)('brings a still-seeded %s to exactly what a fresh install seeds', async (type) => {
        const id = await insertOld(type);
        await exec(db, MIGRATION_SQL);
        const after = await row(id);
        const fresh = seeded(type);
        expect(after.prompt).toBe(fresh.prompt);
        expect(after.config.dos).toEqual(fresh.dos);
        expect(after.config.donts).toEqual(fresh.donts);
        expect(after.config.disclosure).toEqual(NEW_DISCLOSURE);
        // Keys the migration does not own survive.
        expect(after.config.voice).toEqual({ gender: 'female' });
        expect(after.config.specialty).toBe(type);
    });

    // Regression lock: owner feedback 2026-10-24 — the cardiologist answered
    // "Hello" with "What have you looked at so far on the ECG, and how did you
    // start your interpretation?". The seeded prompts told it to.
    it.each(TYPES)('leaves no tutoring instruction in the %s prompt', (type) => {
        const { prompt, dos, donts } = seeded(type);
        expect(prompt).not.toMatch(/start by asking|let them (go first|describe)|^- teach/im);
        expect(prompt).toMatch(/do not quiz them/i);
        expect(prompt).toMatch(/do not name the diagnosis/i);
        expect(dos.join(' ')).not.toMatch(/before offering anything/i);
        expect(donts).toContain('State the diagnosis');
    });

    it('recognises the old default disclosure that still carries requireInterpretation', async () => {
        const id = await insertOld('cardiologist', { disclosure: { ...OLD_DISCLOSURE, requireInterpretation: true } });
        await exec(db, MIGRATION_SQL);
        expect((await row(id)).config.disclosure).toEqual(NEW_DISCLOSURE);
    });

    it('leaves each field an educator changed alone, and still updates the others', async () => {
        const edited = 'EDUCATOR PROMPT: quiz them hard.';
        const id = await insertOld('cardiologist', {
            prompt: edited,
            dos: ['Ask what they saw first'],
            disclosure: { ...OLD_DISCLOSURE, minStudentTurns: 5 },
        });
        await exec(db, MIGRATION_SQL);
        const after = await row(id);
        expect(after.prompt).toBe(edited);
        expect(after.config.dos).toEqual(['Ask what they saw first']);
        expect(after.config.disclosure).toEqual({ ...OLD_DISCLOSURE, minStudentTurns: 5 });
    });

    it('does not touch a disclosure with an extra field, or a template that is not the seeded default', async () => {
        const extra = await insertOld('radiologist', { disclosure: { ...OLD_DISCLOSURE, requireInterpretation: false } });
        const mine = await insertOld('pathologist', { isDefault: 0 });
        await exec(db, MIGRATION_SQL);
        expect((await row(extra)).config.disclosure).toEqual({ ...OLD_DISCLOSURE, requireInterpretation: false });
        const untouched = await row(mine);
        expect(untouched.prompt).toBe(oldValues('pathologist').prompt);
        expect(untouched.config.disclosure).toEqual(OLD_DISCLOSURE);
    });

    it('is a no-op when re-run', async () => {
        const id = await insertOld('laboratorian');
        await exec(db, MIGRATION_SQL);
        const once = await row(id);
        await exec(db, MIGRATION_SQL);
        expect(await row(id)).toEqual(once);
    });
});
