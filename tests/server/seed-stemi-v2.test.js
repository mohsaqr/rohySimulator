// Regression lock: the default STEMI case leaked its diagnosis to learners (triage note, monitor labels, exam text), carried two troponins, kept its ECG and angiogram in radiology, had no agents or rubric, and reperfused on its own; v2 fixes the content and a boot upgrader brings existing installs to it without overwriting an educator's edits (Phase 4, 2026-10-04)
//
// Each upgrade path runs in its own tenant of one migrated temp database:
//   1 fresh (seeded as v2)   2 untouched, current legacy prompt
//   3 untouched, 2026-07 prompt   4 edited in the editor   5 edited agents
//   6 deleted   7 renamed

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { validatePluginDocuments } from '../../server/shared/pluginDocument.js';
import { normalizeKnowledge } from '../../server/shared/agentKnowledge.js';
import { RHYTHMS } from '../../server/shared/rhythms.js';
import { projectCaseForRole } from '../../server/services/caseProjection.js';
import {
    STEMI_V2_CASE, STEMI_V2_AGENTS, STEMI_V2_TREATMENTS, STEMI_V2_ALONGSIDE_NAME, STEMI_SEED_REVISION,
} from '../../server/seeders/stemiV2.js';
import {
    LEGACY_STEMI_NAME, LEGACY_STEMI_SYSTEM_PROMPT, LEGACY_STEMI_SYSTEM_PROMPT_2026_07, LEGACY_MCQ_QUESTIONS,
} from '../../server/seeders/stemiLegacy.js';
import treatmentCatalogue from '../../server/data/treatment_effects.json' with { type: 'json' };

const config = JSON.parse(STEMI_V2_CASE.config);
const scenario = JSON.parse(STEMI_V2_CASE.scenario);

describe('STEMI v2 content', () => {
    it('passes the plugin document validators the case routes apply', () => {
        expect(validatePluginDocuments(config, PLUGIN_MANIFESTS)).toBeNull();
    });

    it('names the diagnosis nowhere a learner receives', () => {
        const learner = JSON.stringify(projectCaseForRole({ id: 1, ...STEMI_V2_CASE, config, scenario }, PLUGIN_MANIFESTS, 'student'));
        // Not 'infarct': his father died of one, and that is history he gives.
        for (const word of ['STEMI', 'LAD', 'anterior descending', 'ST elevation', 'ST-elevation', 'catheter', 'PCI', 'reperfus', 'defibrillat', 'Killip', 'injury pattern']) {
            expect(learner.toLowerCase(), word).not.toContain(word.toLowerCase());
        }
    });

    it('does not tell the patient he is having an infarct', () => {
        expect(STEMI_V2_CASE.system_prompt).not.toMatch(/infarct|STEMI|ST elevation/i);
    });

    it('carries one troponin, and the radiology room no longer answers the ECG or the angiogram', () => {
        const troponins = config.investigations.labs.filter((l) => /troponin/i.test(l.test_name));
        expect(troponins.map((l) => l.test_name)).toEqual(['High-Sensitivity Troponin T']);
        const byStudy = Object.fromEntries(config.radiology.map((r) => [r.studyId, r]));
        expect(byStudy.ecg_12lead.findings).not.toMatch(/ST|elevation|infarct/i);
        expect(byStudy.cardiac_cath.findings).toMatch(/not performed in the emergency department/i);
    });

    it('is Killip I everywhere: clear lungs, an S4 with a clip, a normal chest film', () => {
        const heartLungs = config.physical_exam.chest.auscultation;
        expect(heartLungs.finding).toMatch(/S4/);
        expect(heartLungs.finding).toMatch(/no crackles/i);
        expect(heartLungs.heartAudio).toBe('/sounds/s4-gallop.wav');
        expect(config.physical_exam.upperBack.auscultation.abnormal).toBe(false);
        expect(config.radiology.find((r) => r.studyId === 'xray_chest_portable').interpretation).toMatch(/no pulmonary oedema/i);
    });

    it('flags only findings that are abnormal (the v1 flags contradicted their text)', () => {
        expect(config.physical_exam.chest.palpation.abnormal).toBe(false);
        expect(config.physical_exam.upperArmLeft.special.abnormal).toBe(false);
        expect(config.physical_exam.footLeft.palpation.abnormal).toBe(false);
        expect(config.physical_exam.footRight.palpation.abnormal).toBe(false);
    });

    it('plays the untreated course and never reperfuses on its own', () => {
        const hr = scenario.timeline.map((s) => s.params.hr);
        expect(hr).toEqual([...hr].sort((a, b) => a - b));
        expect(scenario.timeline.every((s) => (s.conditions.stElev ?? 2) >= 2)).toBe(true);
        expect(scenario.timeline.map((s) => s.label).join(' ')).not.toMatch(/STEMI|PCI|reperfus|infarct/i);
        expect(scenario.alternatives.map((a) => a.id)).toEqual(['post_pci', 'vf_arrest', 'cardiogenic_shock']);
        const rhythms = [scenario, ...scenario.alternatives].flatMap((s) => s.timeline.map((step) => step.rhythm));
        for (const rhythm of rhythms) expect(RHYTHMS.map((r) => r.id ?? r), rhythm).toContain(rhythm);
    });

    it('rubric names exist in the treatment catalogue', () => {
        const names = new Set(treatmentCatalogue.rows.map((r) => `${r.treatment_type}:${r.treatment_name}`));
        for (const t of STEMI_V2_TREATMENTS) expect(names.has(`${t.treatment_type}:${t.treatment_name}`), t.treatment_name).toBe(true);
    });

    it('agent overrides pass the knowledge validator', () => {
        for (const agent of STEMI_V2_AGENTS) {
            const { errors, value } = normalizeKnowledge({ knowledge: agent.config_override.knowledge, agentType: agent.agent_type });
            expect(errors, agent.agent_type).toEqual([]);
            expect(value).toEqual(agent.config_override.knowledge);
        }
    });
});

let testDb;
let dbAdapter;
let upgradeStemiCaseForTenant;
let upgradeStemiQuiz;
let quizHtml;

const LEGACY_CONFIG = JSON.stringify({ patient_name: 'John Martinez', investigations: { labs: [{ test_name: 'Troponin I, cardiac' }] } });

async function insertCase(tenant, fields = {}) {
    const { lastID } = await dbAdapter.run(
        `INSERT INTO cases (name, system_prompt, config, version, is_default, is_available, tenant_id, deleted_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
        [fields.name ?? LEGACY_STEMI_NAME, fields.system_prompt ?? LEGACY_STEMI_SYSTEM_PROMPT, fields.config ?? LEGACY_CONFIG,
         fields.version ?? 1, tenant, fields.deleted_at ?? null]
    );
    return lastID;
}
const caseRow = (id) => dbAdapter.get('SELECT * FROM cases WHERE id = ?', [id]);
const agentsOf = (id) => dbAdapter.all(
    `SELECT t.agent_type, ca.name_override, ca.config_override FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id WHERE ca.case_id = ? ORDER BY ca.id`, [id]);
const rubricOf = (id) => dbAdapter.all('SELECT treatment_name FROM case_treatments WHERE case_id = ? ORDER BY id', [id]);

const ids = {};

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'stemi-v2' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'stemi-v2-tests';
    ({ default: dbAdapter } = await import('../../server/dbAdapter.js'));
    const { dbReady } = await import('../../server/db.js');
    await dbReady;
    ({ upgradeStemiCaseForTenant } = await import('../../server/seedStemiCase.js'));
    ({ upgradeStemiQuiz, quizHtml } = await import('../../server/seedStemiCourse.js'));

    // Agent template names are unique across tenants, so the seeded templates
    // are tenant 1's: other tenants get the case and the rubric, and the
    // upgrader logs the agents it could not attach.
    // 1: seeded as v2, the way seeders/cases.js does on a fresh install.
    ids.fresh = await insertCase(1, { name: STEMI_V2_CASE.name, system_prompt: STEMI_V2_CASE.system_prompt, config: STEMI_V2_CASE.config });
    ids.untouched = await insertCase(2);
    ids.untouchedOld = await insertCase(3, { system_prompt: LEGACY_STEMI_SYSTEM_PROMPT_2026_07 });
    ids.edited = await insertCase(4, { version: 2, system_prompt: 'An educator rewrote this.' });
    ids.editedAgents = await insertCase(5);
    const nurse = await dbAdapter.get(`SELECT id FROM agent_templates WHERE agent_type = 'nurse' LIMIT 1`);
    await dbAdapter.run(`INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled, availability_type, config_override) VALUES (?, 5, ?, 1, 'present', '{"tone":"calm"}')`, [ids.editedAgents, nurse.id]);
    ids.deleted = await insertCase(6, { deleted_at: '2026-09-01 00:00:00' });
    ids.renamed = await insertCase(7, { name: 'Chest pain (my version)' });
    // A default course for tenant 4, which receives the v2 alongside.
    const owner = await dbAdapter.get('SELECT id FROM users ORDER BY id LIMIT 1');
    ids.cohort4 = (await dbAdapter.run(`INSERT INTO cohorts (name, owner_user_id, tenant_id, auto_enroll, is_default) VALUES ('Basic course', ?, 4, 1, 1)`, [owner.id])).lastID;
    // A running session on tenant 2's case: its frozen snapshot must survive.
    ids.session = (await dbAdapter.run(`INSERT INTO sessions (case_id, user_id, student_name, status, case_snapshot, tenant_id) VALUES (?, ?, 'S', 'active', '{"frozen":true}', 2)`, [ids.untouched, owner.id])).lastID;
}, 60_000);

afterAll(async () => { await testDb?.cleanup(); });

describe('the boot upgrader', () => {
    it('fresh: attaches the agents and the rubric to a case seeded as v2', async () => {
        expect(await upgradeStemiCaseForTenant(1)).toBe('fresh');
        const agents = await agentsOf(ids.fresh);
        expect(agents.map((a) => a.agent_type)).toEqual(['nurse', 'relative', 'consultant', 'discussant']);
        expect(JSON.parse(agents[1].config_override).knowledge.scope).toBe('history');
        expect(agents[2].name_override).toBe('Dr. Priya Raman');
        expect((await rubricOf(ids.fresh)).map((r) => r.treatment_name)).toEqual(STEMI_V2_TREATMENTS.map((t) => t.treatment_name));
    });

    it('runs once per tenant: a second boot changes nothing, even after an educator removes an agent', async () => {
        await dbAdapter.run(`DELETE FROM case_agents WHERE case_id = ? AND name_override = 'Elena Martinez'`, [ids.fresh]);
        expect(await upgradeStemiCaseForTenant(1)).toBe('done');
        expect((await agentsOf(ids.fresh)).map((a) => a.agent_type)).toEqual(['nurse', 'consultant', 'discussant']);
    });

    it('in place: an untouched shipped case becomes v2 under the same id, and a running session keeps its snapshot', async () => {
        expect(await upgradeStemiCaseForTenant(2)).toBe('in_place');
        const row = await caseRow(ids.untouched);
        expect(row.system_prompt).toBe(STEMI_V2_CASE.system_prompt);
        expect(JSON.parse(row.config).seed_revision).toBe(STEMI_SEED_REVISION);
        expect(row.config).not.toContain('Troponin I, cardiac');
        expect(row.is_default).toBe(1);
        expect(await rubricOf(ids.untouched)).toHaveLength(STEMI_V2_TREATMENTS.length);
        expect((await dbAdapter.get('SELECT case_snapshot FROM sessions WHERE id = ?', [ids.session])).case_snapshot).toBe('{"frozen":true}');
    });

    it('in place: recognises the prompt shipped before 2026-08-31 too', async () => {
        expect(await upgradeStemiCaseForTenant(3)).toBe('in_place');
        expect((await caseRow(ids.untouchedOld)).system_prompt).toBe(STEMI_V2_CASE.system_prompt);
    });

    it('alongside: an edited case is left alone and v2 is added beside it, in the default course', async () => {
        expect(await upgradeStemiCaseForTenant(4)).toBe('alongside');
        expect((await caseRow(ids.edited)).system_prompt).toBe('An educator rewrote this.');
        const added = await dbAdapter.get('SELECT * FROM cases WHERE tenant_id = 4 AND name = ?', [STEMI_V2_ALONGSIDE_NAME]);
        expect(added).toMatchObject({ is_default: 0, is_available: 1, case_code: `EN-${String(added.id).padStart(4, '0')}` });
        expect(await dbAdapter.get('SELECT 1 AS ok FROM cohort_cases WHERE cohort_id = ? AND case_id = ?', [ids.cohort4, added.id])).toEqual({ ok: 1 });
        expect(await rubricOf(added.id)).toHaveLength(STEMI_V2_TREATMENTS.length);
    });

    it('alongside: an educator who only changed the agents counts as an edit', async () => {
        expect(await upgradeStemiCaseForTenant(5)).toBe('alongside');
        expect((await caseRow(ids.editedAgents)).system_prompt).toBe(LEGACY_STEMI_SYSTEM_PROMPT);
    });

    it('alongside: a renamed case is found by its shipped prompt and left alone', async () => {
        expect(await upgradeStemiCaseForTenant(7)).toBe('alongside');
        expect((await caseRow(ids.renamed)).name).toBe('Chest pain (my version)');
        expect(await dbAdapter.get('SELECT COUNT(*) AS n FROM cases WHERE tenant_id = 7 AND name = ?', [STEMI_V2_ALONGSIDE_NAME])).toEqual({ n: 1 });
    });

    it('nothing: a deleted case is not resurrected', async () => {
        expect(await upgradeStemiCaseForTenant(6)).toBe('nothing');
        expect(await dbAdapter.get('SELECT COUNT(*) AS n FROM cases WHERE tenant_id = 6 AND deleted_at IS NULL')).toEqual({ n: 0 });
    });
});

describe('the quiz upgrade', () => {
    it('replaces a quiz still exactly as shipped and leaves an edited one alone', async () => {
        const owner = await dbAdapter.get('SELECT id FROM users ORDER BY id LIMIT 1');
        const cohort = (await dbAdapter.run(`INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES ('Quiz', ?, 1)`, [owner.id])).lastID;
        const lesson = async () => (await dbAdapter.run(`INSERT INTO lessons (cohort_id, tenant_id, title, content_type, order_index, is_published, is_free) VALUES (?, 1, 'STEMI: Recognition & Management', 'text', 0, 1, 1)`, [cohort])).lastID;
        const shipped = await lesson();
        const edited = await lesson();
        const section = async (lessonId, content) => (await dbAdapter.run(`INSERT INTO lesson_sections (lesson_id, title, type, content, order_index) VALUES (?, 'Check your knowledge', 'text', ?, 1)`, [lessonId, content])).lastID;
        const shippedSection = await section(shipped, quizHtml(LEGACY_MCQ_QUESTIONS));
        const editedSection = await section(edited, `${quizHtml(LEGACY_MCQ_QUESTIONS)}<p>My note</p>`);

        await upgradeStemiQuiz();
        const read = async (id) => (await dbAdapter.get('SELECT content FROM lesson_sections WHERE id = ?', [id])).content;
        expect(await read(shippedSection)).toContain('proximal left anterior descending'.replace(/^./, 'P'));
        expect(await read(editedSection)).toContain('My note');
        expect(await upgradeStemiQuiz()).toBe(0);
    });
});
