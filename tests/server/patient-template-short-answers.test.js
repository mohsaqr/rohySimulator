// Regression lock: the default patient templates answer only what is asked.
//
// The shipped "Default Patient" prompts told the model to answer truthfully
// and express feelings; small models read that as licence to recite the case
// on "how are you?". Two halves keep a fresh install and an upgraded one
// identical: server/db.js seeds PATIENT_TEMPLATE_PROMPT where the template is
// missing, and migration 0054 rewrites installed copies that still carry the
// shipped text while leaving an admin-edited template alone.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(__dirname, '..', '..', 'migrations', '0054_patient_template_short_answers.sql');

const OLD_OPENING = 'You are the patient in this simulation. You stay in character throughout the conversation.';
const OLD_PROMPT = `${OLD_OPENING}\n\nYour role:\n- Answer the learner's questions truthfully.`;
const OLD_CONFIG = JSON.stringify({
    voice: { gender: 'male', case_voice: 'am_michael' },
    dos: ['Stay in character throughout', 'Use lay terms unless asked otherwise'],
    donts: ['Volunteer differential diagnoses'],
});
const EDITED_PROMPT = 'You are Mrs Kowalski. Our department wrote this prompt and wants to keep it.';

let testDb;
let PATIENT_TEMPLATE_PROMPT;
let PATIENT_TEMPLATE_DOS;
let PATIENT_TEMPLATE_DONTS;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'patient-template' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'patient-template-tests';
    const mod = await import('../../server/db.js');
    await mod.dbReady;
    ({ PATIENT_TEMPLATE_PROMPT, PATIENT_TEMPLATE_DOS, PATIENT_TEMPLATE_DONTS } = mod);
}, 60_000);

afterAll(async () => {
    await testDb?.cleanup();
});

describe('shipped patient prompt', () => {
    it('states the one-question-one-answer rule and the length cap', () => {
        expect(PATIENT_TEMPLATE_PROMPT).toMatch(/Answer only the question you were asked/);
        expect(PATIENT_TEMPLATE_PROMPT).toMatch(/one sentence, at most two/i);
        expect(PATIENT_TEMPLATE_PROMPT).toMatch(/Do not volunteer anything/);
        expect(PATIENT_TEMPLATE_PROMPT).not.toMatch(/Express how you're feeling/);
    });

    it('is what a fresh install seeds for both default patient templates', async () => {
        const rows = await testDb.all(
            `SELECT name, system_prompt, config FROM agent_templates
              WHERE agent_type = 'patient' AND is_default = 1 ORDER BY name`,
        );
        expect(rows.map((r) => r.name)).toEqual(['Default Female Patient', 'Default Patient']);
        for (const row of rows) {
            expect(row.system_prompt).toBe(PATIENT_TEMPLATE_PROMPT);
            const config = JSON.parse(row.config);
            expect(config.dos).toEqual(PATIENT_TEMPLATE_DOS);
            expect(config.donts).toEqual(PATIENT_TEMPLATE_DONTS);
        }
    });
});

describe('migration 0054 on an upgraded install', () => {
    const sql = readFileSync(MIGRATION, 'utf8');

    beforeAll(async () => {
        await testDb.run(
            `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, context_filter, communication_style, is_default, config)
             VALUES ('patient', 'Legacy Patient', 'Simulated Patient', ?, 'history', 'concise', 1, ?)`,
            [OLD_PROMPT, OLD_CONFIG],
        );
        await testDb.run(
            `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, context_filter, communication_style, is_default, config)
             VALUES ('patient', 'Edited Patient', 'Simulated Patient', ?, 'history', 'concise', 1, ?)`,
            [EDITED_PROMPT, JSON.stringify({ dos: ['Our own first rule'], donts: [] })],
        );
        await testDb.exec(sql);
    });

    it('rewrites a template that still carries the shipped text, prompt and lists', async () => {
        const row = await testDb.get(
            `SELECT system_prompt, config FROM agent_templates WHERE name = 'Legacy Patient'`,
        );
        expect(row.system_prompt).toBe(PATIENT_TEMPLATE_PROMPT);
        const config = JSON.parse(row.config);
        expect(config.dos).toEqual(PATIENT_TEMPLATE_DOS);
        expect(config.donts).toEqual(PATIENT_TEMPLATE_DONTS);
        expect(config.voice).toEqual({ gender: 'male', case_voice: 'am_michael' });
    });

    it('leaves an admin-edited template untouched', async () => {
        const row = await testDb.get(
            `SELECT system_prompt, config FROM agent_templates WHERE name = 'Edited Patient'`,
        );
        expect(row.system_prompt).toBe(EDITED_PROMPT);
        expect(JSON.parse(row.config).dos).toEqual(['Our own first rule']);
    });

    it('is idempotent', async () => {
        const before = await testDb.all(`SELECT name, system_prompt, config FROM agent_templates WHERE agent_type = 'patient' ORDER BY name`);
        await testDb.exec(sql);
        const after = await testDb.all(`SELECT name, system_prompt, config FROM agent_templates WHERE agent_type = 'patient' ORDER BY name`);
        expect(after).toEqual(before);
    });
});
