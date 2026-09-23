// Standing specialists: the lab and radiology are on every case, the
// pathologist and the cardiologist on every case with slides or an ECG.
//
// - the registry marks the laboratorian and the radiologist `always`, the
//   pathologist and the cardiologist `with_material`;
// - attachStandingSpecialists() attaches the ones a case is missing, is
//   idempotent, and never touches a specialist already there (disabled, or an
//   educator's own template), a deleted case, or a tenant with no template;
// - the server attaches them at boot to every case, and to a case created by
//   POST /cases before answering;
// - DELETE refuses to remove one (409 standing_specialist), since the sweep
//   would put it back; other agents still delete.
//
// Regression lock: the on-call phone rendered nothing on a case with no
// specialist attached, and nothing attached one — so on an upgraded install
// the phone was on no case at all.
// Regression lock: the STEMI case showed a Pathology room with no pathologist
// on the phone — only the lab and radiology stood, whatever the case held.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { createTestDb } from '../utils/seedDb.js';
import { startTestServer } from '../utils/startTestServer.js';
import {
    SPECIALIST_TYPES,
    MATERIAL_SPECIALIST_TYPES,
    SPECIALTIES,
    STANDING_MODES,
    STANDING_SPECIALIST_TYPES,
    hasSpecialtyMaterial,
    isStandingSpecialistType,
    standsOnCase,
} from '../../server/shared/specialties.js';

const STANDING = ['laboratorian', 'radiologist'];
// A case document as a plugin room stores it; any non-empty object counts.
const PATHOLOGY_DOC = { schemaVersion: 1, specimens: [{ id: 'specimen-1' }] };
const ECG_DOC = { manifest: { schema_version: 1, recordings: [{ id: 'r1' }] } };
const attachedCounts = (counts) => ({ radiologist: 0, laboratorian: 0, pathologist: 0, cardiologist: 0, ...counts });

describe('the specialty registry', () => {
    it('marks exactly the laboratorian and the radiologist standing', () => {
        expect([...STANDING_SPECIALIST_TYPES].sort()).toEqual(STANDING);
    });

    it('only ever marks a specialist standing', () => {
        for (const type of STANDING_SPECIALIST_TYPES) {
            expect(SPECIALIST_TYPES).toContain(type);
        }
        expect(isStandingSpecialistType('pathologist')).toBe(false);
        expect(isStandingSpecialistType('nurse')).toBe(false);
        expect(isStandingSpecialistType(undefined)).toBe(false);
    });

    it('gives every specialty a standing mode, and the pathologist and cardiologist with_material', () => {
        for (const type of SPECIALIST_TYPES) {
            expect(STANDING_MODES, type).toContain(SPECIALTIES[type].standing);
        }
        expect([...MATERIAL_SPECIALIST_TYPES].sort()).toEqual(['cardiologist', 'pathologist']);
    });

    it('finds material only in a non-empty document at one of the specialty\'s plugin rooms', () => {
        expect(hasSpecialtyMaterial('pathologist', { pathology: PATHOLOGY_DOC })).toBe(true);
        expect(hasSpecialtyMaterial('pathologist', JSON.stringify({ pathology: PATHOLOGY_DOC }))).toBe(true);
        expect(hasSpecialtyMaterial('cardiologist', { ecg: ECG_DOC })).toBe(true);
        // The other room's material is not this specialty's.
        expect(hasSpecialtyMaterial('pathologist', { ecg: ECG_DOC })).toBe(false);
        expect(hasSpecialtyMaterial('cardiologist', { pathology: PATHOLOGY_DOC })).toBe(false);
        // A key saved and never filled is no material — the room shows no tab.
        for (const empty of [{}, { pathology: {} }, { pathology: [] }, { pathology: 'x' },
            { pathology: null }, null, undefined, '', 'not json', '[1]', 42]) {
            expect(hasSpecialtyMaterial('pathologist', empty), JSON.stringify(empty)).toBe(false);
        }
        // A specialty with no plugin room, or no specialty, never has any.
        expect(hasSpecialtyMaterial('laboratorian', { lab: { a: 1 } })).toBe(false);
        expect(hasSpecialtyMaterial('nurse', { pathology: PATHOLOGY_DOC })).toBe(false);
    });

    it('stands the lab and radiology on any case, the pathologist only with slides', () => {
        for (const config of [{}, null, 'not json', { pathology: PATHOLOGY_DOC }]) {
            expect(standsOnCase('laboratorian', config)).toBe(true);
            expect(standsOnCase('radiologist', config)).toBe(true);
        }
        expect(standsOnCase('pathologist', {})).toBe(false);
        expect(standsOnCase('pathologist', { pathology: PATHOLOGY_DOC })).toBe(true);
        expect(standsOnCase('cardiologist', { ecg: ECG_DOC })).toBe(true);
        expect(standsOnCase('nurse', { pathology: PATHOLOGY_DOC })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// In-process: the sweep against a migrated, seeded database
// ---------------------------------------------------------------------------

describe('attachStandingSpecialists()', () => {
    let testDb;
    let attachStandingSpecialists;
    let attachStandingSpecialistsToAllCases;

    beforeAll(async () => {
        testDb = await createTestDb({ seed: true, label: 'standing' });
        process.env.ROHY_DB = testDb.dbPath;
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'standing-specialist-tests';
        const dbModule = await import('../../server/db.js');
        await dbModule.dbReady;
        ({ attachStandingSpecialists, attachStandingSpecialistsToAllCases } =
            await import('../../server/services/standingSpecialists.js'));
    }, 60_000);

    afterAll(async () => {
        await testDb?.cleanup();
    });

    const newCase = async (name, { tenant = 1, deleted = false, config = {} } = {}) => (await testDb.run(
        `INSERT INTO cases (name, description, system_prompt, config, tenant_id, deleted_at)
         VALUES (?, 'd', 'p', ?, ?, ${deleted ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
        [name, JSON.stringify(config), tenant],
    )).lastID;

    const agentsOf = (caseId) => testDb.all(
        `SELECT t.agent_type, t.is_default, ca.enabled, ca.availability_type
           FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
          WHERE ca.case_id = ? ORDER BY t.agent_type`, [caseId],
    );

    const defaultTemplateId = async (type) => (await testDb.get(
        `SELECT MIN(id) AS id FROM agent_templates
          WHERE agent_type = ? AND is_default = 1 AND tenant_id = 1 AND deleted_at IS NULL`, [type],
    )).id;

    it('has a tenant-1 default template for each standing specialty (not vacuous)', async () => {
        for (const type of SPECIALIST_TYPES) {
            expect(Number.isInteger(await defaultTemplateId(type)), type).toBe(true);
        }
    });

    it('attaches the lab and radiology, enabled and present, and nothing else', async () => {
        const caseId = await newCase('Bare case');
        const { attached } = await attachStandingSpecialists({ caseId });
        expect(attached).toEqual(attachedCounts({ radiologist: 1, laboratorian: 1 }));
        expect(await agentsOf(caseId)).toEqual([
            { agent_type: 'laboratorian', is_default: 1, enabled: 1, availability_type: 'present' },
            { agent_type: 'radiologist', is_default: 1, enabled: 1, availability_type: 'present' },
        ]);
    });

    it('is idempotent: a second run attaches nothing', async () => {
        const caseId = await newCase('Twice case');
        await attachStandingSpecialists({ caseId });
        const { attached } = await attachStandingSpecialists({ caseId });
        expect(attached).toEqual(attachedCounts({}));
        expect((await agentsOf(caseId)).map((a) => a.agent_type)).toEqual(STANDING);
    });

    it('leaves a disabled specialist disabled and does not add a second', async () => {
        const caseId = await newCase('Disabled radiologist case');
        await testDb.run(
            `INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled) VALUES (?, 1, ?, 0)`,
            [caseId, await defaultTemplateId('radiologist')],
        );
        await attachStandingSpecialists({ caseId });
        const agents = await agentsOf(caseId);
        expect(agents.map((a) => [a.agent_type, a.enabled])).toEqual([['laboratorian', 1], ['radiologist', 0]]);
    });

    it("counts an educator's own laboratorian template as the case's laboratorian", async () => {
        const own = (await testDb.run(
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, tenant_id)
             VALUES ('laboratorian', 'Our lab lead', 'p', 0, 1)`,
        )).lastID;
        const caseId = await newCase('Own lab case');
        await testDb.run(
            `INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled) VALUES (?, 1, ?, 1)`,
            [caseId, own],
        );
        await attachStandingSpecialists({ caseId });
        const agents = await agentsOf(caseId);
        expect(agents.filter((a) => a.agent_type === 'laboratorian')).toEqual([
            { agent_type: 'laboratorian', is_default: 0, enabled: 1, availability_type: 'present' },
        ]);
        expect(agents.map((a) => a.agent_type)).toContain('radiologist');
    });

    it('scopes to one case when given a caseId, and sweeps every live case without one', async () => {
        const a = await newCase('Scope A');
        const b = await newCase('Scope B');
        const gone = await newCase('Deleted case', { deleted: true });
        await attachStandingSpecialists({ caseId: a });
        expect(await agentsOf(b)).toEqual([]);

        await attachStandingSpecialistsToAllCases();
        expect((await agentsOf(b)).map((x) => x.agent_type)).toEqual(STANDING);
        expect(await agentsOf(gone)).toEqual([]);
    });

    // Regression lock: node-sqlite3 binds NaN as NULL, and NULL is the
    // sweep's "every case" — so Number('abc') once widened a one-case attach
    // into a sweep of the whole install.
    it('refuses a caseId that is not a positive integer, and attaches nothing anywhere', async () => {
        const bystander = await newCase('Bystander case');
        for (const bad of [undefined, null, 'abc', Number.NaN, 0, -3, 1.5]) {
            await expect(attachStandingSpecialists({ caseId: bad }), String(bad)).rejects.toBeInstanceOf(TypeError);
        }
        expect(await agentsOf(bystander)).toEqual([]);
    });

    it('accepts a numeric string, as a request body carries it', async () => {
        const caseId = await newCase('String id case');
        await attachStandingSpecialists({ caseId: String(caseId) });
        expect((await agentsOf(caseId)).map((a) => a.agent_type)).toEqual(STANDING);
    });

    // Regression lock: a row on a soft-deleted template is invisible at
    // runtime but still counted here, so the phone had no lab and every
    // repair path refused.
    it('repairs a case whose laboratorian row points at a soft-deleted template', async () => {
        const dead = (await testDb.run(
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, tenant_id, deleted_at)
             VALUES ('laboratorian', 'Purged lab lead', 'p', 0, 1, CURRENT_TIMESTAMP)`,
        )).lastID;
        const caseId = await newCase('Dead template case');
        await testDb.run(
            `INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled) VALUES (?, 1, ?, 1)`,
            [caseId, dead],
        );
        const { attached } = await attachStandingSpecialists({ caseId });
        expect(attached).toEqual(attachedCounts({ radiologist: 1, laboratorian: 1 }));
        const live = await testDb.all(
            `SELECT t.agent_type FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
              WHERE ca.case_id = ? AND t.deleted_at IS NULL ORDER BY t.agent_type`, [caseId],
        );
        expect(live.map((r) => r.agent_type)).toEqual(STANDING);
    });

    it('attaches the pathologist to a case with slides, the cardiologist to one with an ECG', async () => {
        const slides = await newCase('Slides case', { config: { pathology: PATHOLOGY_DOC } });
        const ecg = await newCase('ECG case', { config: { ecg: ECG_DOC } });
        const both = await newCase('Both case', { config: { pathology: PATHOLOGY_DOC, ecg: ECG_DOC } });
        const bare = await newCase('Empty documents case', { config: { pathology: {}, ecg: {} } });

        expect((await attachStandingSpecialists({ caseId: slides })).attached)
            .toEqual(attachedCounts({ radiologist: 1, laboratorian: 1, pathologist: 1 }));
        await attachStandingSpecialists({ caseId: ecg });
        await attachStandingSpecialists({ caseId: both });
        await attachStandingSpecialists({ caseId: bare });

        const types = async (id) => (await agentsOf(id)).map((a) => a.agent_type);
        expect(await types(slides)).toEqual(['laboratorian', 'pathologist', 'radiologist']);
        expect(await types(ecg)).toEqual(['cardiologist', 'laboratorian', 'radiologist']);
        expect(await types(both)).toEqual(['cardiologist', 'laboratorian', 'pathologist', 'radiologist']);
        expect(await types(bare)).toEqual(STANDING);
        // Enabled and present, from the shipped default, like the others.
        expect((await agentsOf(slides)).find((a) => a.agent_type === 'pathologist'))
            .toEqual({ agent_type: 'pathologist', is_default: 1, enabled: 1, availability_type: 'present' });
    });

    it('is idempotent for the pathologist, and leaves a disabled one alone', async () => {
        const caseId = await newCase('Disabled pathologist case', { config: { pathology: PATHOLOGY_DOC } });
        await testDb.run(
            `INSERT INTO case_agents (case_id, tenant_id, agent_template_id, enabled) VALUES (?, 1, ?, 0)`,
            [caseId, await defaultTemplateId('pathologist')],
        );
        await attachStandingSpecialists({ caseId });
        const { attached } = await attachStandingSpecialists({ caseId });
        expect(attached).toEqual(attachedCounts({}));
        const paths = (await agentsOf(caseId)).filter((a) => a.agent_type === 'pathologist');
        expect(paths.map((a) => a.enabled)).toEqual([0]);
    });

    it('sweeps the pathologist onto every live case with slides, and onto no other', async () => {
        const slides = await newCase('Sweep slides case', { config: { pathology: PATHOLOGY_DOC } });
        const plain = await newCase('Sweep plain case');
        const unreadable = (await testDb.run(
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
             VALUES ('Unreadable config case', 'd', 'p', 'not json', 1)`,
        )).lastID;
        const gone = await newCase('Sweep deleted slides case', { deleted: true, config: { pathology: PATHOLOGY_DOC } });

        await attachStandingSpecialistsToAllCases();
        const has = async (id) => (await agentsOf(id)).some((a) => a.agent_type === 'pathologist');
        expect(await has(slides)).toBe(true);
        expect(await has(plain)).toBe(false);
        expect(await has(unreadable)).toBe(false);
        expect((await agentsOf(unreadable)).map((a) => a.agent_type)).toEqual(STANDING);
        expect(await agentsOf(gone)).toEqual([]);
    });

    it("gives a tenant with no specialist template nothing, never another tenant's persona", async () => {
        await testDb.run(`INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (2, 'other', 'Other')`);
        const caseId = await newCase('Other tenant case', { tenant: 2 });
        const { attached } = await attachStandingSpecialists({ caseId });
        expect(attached).toEqual(attachedCounts({}));
        expect(await agentsOf(caseId)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Through the real server: boot sweep, POST /cases, DELETE guard
// ---------------------------------------------------------------------------

const PASSWORD = 'StandingSpec1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }),
    );
}
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))),
    );
}

describe('the server', () => {
    let server;
    let token;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const send = (method, path, body) => fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const caseAgents = (caseId) => withDb((db) => pAll(db,
        `SELECT ca.id, t.agent_type FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
          WHERE ca.case_id = ? ORDER BY t.agent_type`, [caseId]));

    beforeAll(async () => {
        server = await startTestServer();
        await withDb(async (db) => {
            const hash = await bcrypt.hash(PASSWORD, 4);
            await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('standing-educator', 'E', 'standing-educator@example.com', ?, 'educator', 1, 'active')`, [hash]);
        });
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'standing-educator', password: PASSWORD }),
        });
        if (!res.ok) throw new Error(`login -> ${res.status}: ${await res.text()}`);
        token = (await res.json()).token;
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it('attached the lab and radiology to every case that existed at boot', async () => {
        const rows = await withDb((db) => pAll(db,
            `SELECT c.id,
                    (SELECT GROUP_CONCAT(agent_type) FROM (
                        SELECT t.agent_type FROM case_agents ca
                          JOIN agent_templates t ON t.id = ca.agent_template_id
                         WHERE ca.case_id = c.id AND t.agent_type IN ('laboratorian', 'radiologist')
                         ORDER BY t.agent_type)) AS standing
               FROM cases c WHERE c.deleted_at IS NULL`));
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.standing, `case ${row.id}`).toBe('laboratorian,radiologist');
        }
    });

    // Regression lock: every create after the first lost its specialists to
    // SQLITE_BUSY — the audit chain writes on its own connection right before
    // the attach — until the attach retried like stampCaseCode does.
    it('attaches them on every one of several back-to-back creates', async () => {
        const counts = [];
        for (let i = 0; i < 5; i++) {
            const res = await send('POST', '/api/cases', {
                name: `Back-to-back ${i}`, description: 'd', system_prompt: 'p', config: {},
            });
            counts.push((await caseAgents((await res.json()).id)).length);
        }
        expect(counts).toEqual([2, 2, 2, 2, 2]);
    });

    it('attaches them to a case created over HTTP before answering', async () => {
        const res = await send('POST', '/api/cases', {
            name: 'Standing HTTP case', description: 'd', system_prompt: 'p', config: {},
        });
        expect(res.status).toBe(200);
        const { id } = await res.json();
        expect((await caseAgents(id)).map((a) => a.agent_type)).toEqual(STANDING);
    });

    it('refuses to remove a standing specialist with 409 standing_specialist, and keeps it', async () => {
        const created = await (await send('POST', '/api/cases', {
            name: 'No removal case', description: 'd', system_prompt: 'p', config: {},
        })).json();
        const [lab] = (await caseAgents(created.id)).filter((a) => a.agent_type === 'laboratorian');

        const res = await send('DELETE', `/api/cases/${created.id}/agents/${lab.id}`);
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('standing_specialist');
        expect((await caseAgents(created.id)).map((a) => a.agent_type)).toContain('laboratorian');
    });

    it('still lets a standing specialist be disabled', async () => {
        const created = await (await send('POST', '/api/cases', {
            name: 'Disable case', description: 'd', system_prompt: 'p', config: {},
        })).json();
        const [rad] = (await caseAgents(created.id)).filter((a) => a.agent_type === 'radiologist');
        const res = await send('PUT', `/api/cases/${created.id}/agents/${rad.id}`, { enabled: false });
        expect(res.status).toBe(200);
        const [row] = await withDb((db) => pAll(db, 'SELECT enabled FROM case_agents WHERE id = ?', [rad.id]));
        expect(row.enabled).toBe(0);
    });

    const newCaseOverHttp = async (name) => (await (await send('POST', '/api/cases', {
        name, description: 'd', system_prompt: 'p', config: {},
    })).json()).id;

    it('lets an educator swap their own laboratorian persona into the slot, keeping one', async () => {
        const caseId = await newCaseOverHttp('Own persona case');
        const own = await withDb(async (db) => (await pRun(db,
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, tenant_id)
             VALUES ('laboratorian', 'Dr Own Lab', 'p', 0, 1)`)).lastID);
        const [before] = (await caseAgents(caseId)).filter((a) => a.agent_type === 'laboratorian');

        const res = await send('POST', `/api/cases/${caseId}/agents`, { agent_template_id: own });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: before.id, swapped: true });
        const labs = await withDb((db) => pAll(db,
            `SELECT ca.id, ca.agent_template_id FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
              WHERE ca.case_id = ? AND t.agent_type = 'laboratorian'`, [caseId]));
        expect(labs).toEqual([{ id: before.id, agent_template_id: own }]);

        // Adding the persona already in the slot is still a conflict.
        const again = await send('POST', `/api/cases/${caseId}/agents`, { agent_template_id: own });
        expect(again.status).toBe(409);
        expect((await again.json()).code).toBe('specialty_already_attached');
    });

    it('still removes a standing row whose template was soft-deleted', async () => {
        const caseId = await newCaseOverHttp('Dead row removal case');
        const [rad] = (await caseAgents(caseId)).filter((a) => a.agent_type === 'radiologist');
        const dead = await withDb(async (db) => (await pRun(db,
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, tenant_id, deleted_at)
             VALUES ('radiologist', 'Purged rad', 'p', 0, 1, CURRENT_TIMESTAMP)`)).lastID);
        await withDb((db) => pRun(db, 'UPDATE case_agents SET agent_template_id = ? WHERE id = ?', [dead, rad.id]));

        const res = await send('DELETE', `/api/cases/${caseId}/agents/${rad.id}`);
        expect(res.status).toBe(200);
    });

    it('attaches them when a session starts on a case that lacks them', async () => {
        const caseId = await withDb(async (db) => (await pRun(db,
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
             VALUES ('Missed attach case', 'd', 'p', '{}', 1)`)).lastID);
        expect(await caseAgents(caseId)).toEqual([]);
        const res = await send('POST', '/api/sessions', { case_id: caseId, student_name: 'S' });
        expect(res.status).toBe(200);
        expect((await caseAgents(caseId)).map((a) => a.agent_type)).toEqual(STANDING);
    });

    const saveCase = (caseId, config) => send('PUT', `/api/cases/${caseId}`, {
        name: `Case ${caseId}`, description: 'd', system_prompt: 'p', config,
    });

    it('attaches the pathologist when a save adds slides, before answering', async () => {
        const caseId = await newCaseOverHttp('Slides added later case');
        expect((await caseAgents(caseId)).map((a) => a.agent_type)).toEqual(STANDING);

        const res = await saveCase(caseId, { pathology: PATHOLOGY_DOC });
        expect(res.status).toBe(200);
        expect((await caseAgents(caseId)).map((a) => a.agent_type))
            .toEqual(['laboratorian', 'pathologist', 'radiologist']);

        // The editor reads `standing` from the server, which decides DELETE.
        const listed = await (await send('GET', `/api/cases/${caseId}/agents`)).json();
        expect(Object.fromEntries(listed.agents.map((a) => [a.agent_type, a.standing])))
            .toEqual({ laboratorian: true, pathologist: true, radiologist: true });
    });

    it('attaches the pathologist to a case created with slides', async () => {
        const res = await send('POST', '/api/cases', {
            name: 'Created with slides', description: 'd', system_prompt: 'p', config: { pathology: PATHOLOGY_DOC },
        });
        expect(res.status).toBe(200);
        const { id } = await res.json();
        expect((await caseAgents(id)).map((a) => a.agent_type))
            .toEqual(['laboratorian', 'pathologist', 'radiologist']);
    });

    it('refuses to remove the pathologist while the case has slides, and allows it after', async () => {
        const caseId = await newCaseOverHttp('Pathologist stands case');
        await saveCase(caseId, { pathology: PATHOLOGY_DOC });
        const [path] = (await caseAgents(caseId)).filter((a) => a.agent_type === 'pathologist');

        const refused = await send('DELETE', `/api/cases/${caseId}/agents/${path.id}`);
        expect(refused.status).toBe(409);
        expect((await refused.json()).code).toBe('standing_specialist');

        // Slides gone: the sweep would no longer put it back, so it goes.
        await saveCase(caseId, {});
        const listed = await (await send('GET', `/api/cases/${caseId}/agents`)).json();
        expect(listed.agents.find((a) => a.agent_type === 'pathologist').standing).toBe(false);
        const removed = await send('DELETE', `/api/cases/${caseId}/agents/${path.id}`);
        expect(removed.status).toBe(200);
        expect((await caseAgents(caseId)).map((a) => a.agent_type)).toEqual(STANDING);
    });

    it("swaps an educator's own pathologist into the slot on a case with slides", async () => {
        const caseId = await newCaseOverHttp('Own pathologist case');
        await saveCase(caseId, { pathology: PATHOLOGY_DOC });
        const own = await withDb(async (db) => (await pRun(db,
            `INSERT INTO agent_templates (agent_type, name, system_prompt, is_default, tenant_id)
             VALUES ('pathologist', 'Dr Own Path', 'p', 0, 1)`)).lastID);
        const [before] = (await caseAgents(caseId)).filter((a) => a.agent_type === 'pathologist');

        const res = await send('POST', `/api/cases/${caseId}/agents`, { agent_template_id: own });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: before.id, swapped: true });
    });

    it('puts the pathologist on the phone when a session starts on a case with slides', async () => {
        const caseId = await withDb(async (db) => (await pRun(db,
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
             VALUES ('Slides, never attached', 'd', 'p', ?, 1)`, [JSON.stringify({ pathology: PATHOLOGY_DOC })])).lastID);
        const res = await send('POST', '/api/sessions', { case_id: caseId, student_name: 'S' });
        expect(res.status).toBe(200);
        expect((await caseAgents(caseId)).map((a) => a.agent_type))
            .toEqual(['laboratorian', 'pathologist', 'radiologist']);
    });

    it('still removes a specialist that is not standing', async () => {
        const created = await (await send('POST', '/api/cases', {
            name: 'Pathologist removal case', description: 'd', system_prompt: 'p', config: {},
        })).json();
        const [template] = await withDb((db) => pAll(db,
            `SELECT MIN(id) AS id FROM agent_templates
              WHERE agent_type = 'pathologist' AND is_default = 1 AND tenant_id = 1 AND deleted_at IS NULL`));
        const added = await send('POST', `/api/cases/${created.id}/agents`, { agent_template_id: template.id });
        expect(added.status).toBe(201);
        const { id: pathId } = await added.json();

        const res = await send('DELETE', `/api/cases/${created.id}/agents/${pathId}`);
        expect(res.status).toBe(200);
        expect((await caseAgents(created.id)).map((a) => a.agent_type)).toEqual(STANDING);
    });
});
