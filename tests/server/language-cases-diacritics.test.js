// Regression lock: the seeded German/Spanish/Italian cases were ASCII-folded ("42-jaehriger", "22 anos", "ultimo ano", "perche") and installs seeded before the fix kept that text forever (QA 2026-10-04, PRV-33)
//
// Real migrations on a throwaway sqlite file, the dbAdapter singleton pointed
// at it. An install seeded before the fix is simulated by inserting the OLD
// Spanish row — its old column values are read back out of migration 0064's
// own WHERE clauses, so the test exercises exactly what the migration matches.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../migrations/0064_language_cases_diacritics.sql'), 'utf8',
);
const OLD_ES_NAME = 'Cetoacidosis Diabetica - Diabetes Tipo 1';
const NEW_ES_NAME = 'Cetoacidosis Diabética - Diabetes Tipo 1';
// The old value a column UPDATE matches on: `… AND <col> = '<old>';`
const oldValue = (col) => {
    const block = MIGRATION.slice(MIGRATION.indexOf(`-- ${NEW_ES_NAME}`));
    const m = block.match(new RegExp(`AND ${col} = '((?:[^']|'')*)';`));
    return m ? m[1].replace(/''/g, "'") : null;
};

let testDb;
let dbAdapter;
let seedLanguageCases;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'lang-diacritics' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'lang-diacritics-tests';
    ({ default: dbAdapter } = await import('../../server/dbAdapter.js'));
    const { dbReady } = await import('../../server/db.js');
    await dbReady;
    ({ seedLanguageCases } = await import('../../server/seedLanguageCases.js'));
}, 60_000);

afterAll(async () => {
    await testDb?.cleanup();
});

const esRows = () => dbAdapter.all(
    `SELECT * FROM cases WHERE name IN (?, ?) AND deleted_at IS NULL`, [OLD_ES_NAME, NEW_ES_NAME],
);

describe('seeded language cases carry their accents (0064)', () => {
    it('a fresh seed writes the corrected text', async () => {
        await seedLanguageCases();
        const de = await dbAdapter.get(`SELECT description, system_prompt FROM cases WHERE name = ?`, ['Akute Anaphylaxie nach Wespenstich']);
        expect(de.description).toContain('42-jähriger');
        expect(de.system_prompt).not.toMatch(/jaehrig|Koerper|fuehl/);
        const [es] = await esRows();
        expect(es.name).toBe(NEW_ES_NAME);
        expect(es.description).toContain('22 años');
        expect(JSON.parse(es.config).clinicalRecords?.history ?? JSON.stringify(JSON.parse(es.config))).not.toContain('ultimo ano');
    });

    it('corrects an old install row in place, keeps an educator edit, and never duplicates it', async () => {
        // Back to the pre-fix state: one Spanish row, old title and old text,
        // with the system prompt edited by an educator.
        await dbAdapter.run(`DELETE FROM cases WHERE name IN (?, ?)`, [OLD_ES_NAME, NEW_ES_NAME]);
        const oldDescription = oldValue('description');
        const oldPatient = oldValue('patient_name');
        expect(oldDescription).toContain('22 anos');
        expect(oldPatient).toBe('Lucia Fernandez');
        await dbAdapter.run(
            `INSERT INTO cases (name, description, system_prompt, config, patient_name, chief_complaint, tenant_id, is_available, is_default)
             VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0)`,
            [OLD_ES_NAME, oldDescription, 'EDUCATOR EDITED PROMPT', oldValue('config'), oldPatient, oldValue('chief_complaint')],
        );

        await testDb.exec(MIGRATION);

        const rows = await esRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe(NEW_ES_NAME);
        expect(rows[0].description).toContain('22 años');
        expect(rows[0].patient_name).toBe('Lucía Fernández');
        expect(rows[0].chief_complaint).toContain('náuseas');
        expect(rows[0].config).toContain('último año');
        expect(rows[0].system_prompt).toBe('EDUCATOR EDITED PROMPT');

        // Re-running the migration and the boot seeder changes nothing and adds nothing.
        await testDb.exec(MIGRATION);
        await seedLanguageCases();
        expect(await esRows()).toHaveLength(1);
    });

    it('the seeder matches an un-migrated old title instead of inserting a second case', async () => {
        await dbAdapter.run(`UPDATE cases SET name = ? WHERE name = ?`, [OLD_ES_NAME, NEW_ES_NAME]);
        await seedLanguageCases();
        const rows = await esRows();
        expect(rows).toHaveLength(1);
    });
});
