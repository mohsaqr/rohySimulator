// Per-case rooms: an educator switches rooms off, and a switched-off room is
// hidden AND locked (server/shared/caseRooms.js).
//
// - the registry: only the patient room is fixed; a missing setting means
//   every room is on but the default-off ones (the bedside), which a case
//   switches on through `rooms.enabled`; unknown keys are dropped with a
//   warning, a bad shape and the patient room are refused;
// - the learner projection drops a switched-off plugin room's document, so its
//   room cannot light in any client;
// - a learner's lab/radiology/exam actions in a switched-off room answer 403
//   room_disabled, the discussant is refused with the debrief room off, and a
//   specialist whose rooms are all off is on the phone but does not answer
//   (409 no_answer; `answers:false` on the session's agent list);
// - the session snapshot's rooms win over the live case, and staff pass.
//
// Regression lock: nothing on the server knew about rooms — every room was on
// every case, and every endpoint took orders whatever the room bar showed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import {
    DEFAULT_OFF_ROOMS,
    FIXED_ROOMS,
    SWITCHABLE_ROOM_KEYS,
    disabledRooms,
    isRoomEnabled,
    normaliseCaseRooms,
    specialistAnswers,
    withRoom,
} from '../../server/shared/caseRooms.js';
import { CORE_ROOM_KEYS } from '../../server/shared/pluginRegistry.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import {
    projectCaseSnapshotForRole,
    projectPluginDocumentsForRole,
} from '../../server/shared/pluginDocument.js';

const PATHOLOGY_DOC = { manifest: { title: 'Core biopsy' }, rubric: { activities: [] } };

describe('the rooms registry', () => {
    it('fixes only the patient room, and offers every other core and plugin room', () => {
        expect(FIXED_ROOMS).toEqual(['chat']);
        expect([...SWITCHABLE_ROOM_KEYS].sort()).toEqual(
            [...CORE_ROOM_KEYS.filter((k) => k !== 'chat'), ...PLUGIN_MANIFESTS.map((m) => m.id)].sort(),
        );
        // A plugin room's key is its id — the client builds room keys from
        // `manifest.room.key`, so the two must agree.
        for (const m of PLUGIN_MANIFESTS) expect(m.room?.key ?? m.id, m.id).toBe(m.id);
    });

    it('turns only the default-off rooms off when a case stores no setting, or one it cannot read', () => {
        // The bedside duplicates the examination room, so it is off by default.
        expect(DEFAULT_OFF_ROOMS).toEqual(['room3d']);
        for (const config of [{}, null, undefined, 'not json', '[]', { rooms: null },
            { rooms: 'lab' }, { rooms: { disabled: 'lab' } }, { rooms: { disabled: [7] } }]) {
            expect(disabledRooms(config), JSON.stringify(config)).toEqual(['room3d']);
            for (const key of [...FIXED_ROOMS, ...SWITCHABLE_ROOM_KEYS]) {
                expect(isRoomEnabled(config, key)).toBe(key !== 'room3d');
            }
        }
    });

    it('switches a default-off room on only through rooms.enabled', () => {
        expect(isRoomEnabled({ rooms: { enabled: ['room3d'] } }, 'room3d')).toBe(true);
        // `enabled` means nothing for a room that is on anyway, and cannot
        // override `disabled`.
        expect(disabledRooms({ rooms: { enabled: ['room3d', 'lab'], disabled: ['lab'] } })).toEqual(['lab']);
        expect(disabledRooms({ rooms: { enabled: ['room3d'], disabled: ['room3d'] } })).toEqual(['room3d']);
    });

    it('writes a switch into the right list, and nothing at the defaults', () => {
        expect(withRoom(undefined, 'lab', false)).toEqual({ disabled: ['lab'] });
        expect(withRoom({ disabled: ['lab'] }, 'lab', true)).toBeUndefined();
        expect(withRoom(undefined, 'room3d', true)).toEqual({ enabled: ['room3d'] });
        expect(withRoom({ enabled: ['room3d'], disabled: ['lab'] }, 'room3d', false)).toEqual({ disabled: ['lab'] });
        expect(withRoom({ disabled: ['radiology'] }, 'lab', false)).toEqual({ disabled: ['lab', 'radiology'] });
    });

    it('reads the list from an object or a stored JSON string, ignoring the patient room and unknown keys', () => {
        const config = { rooms: { disabled: ['lab', 'chat', 'bogus', 'lab', 'examination'] } };
        expect(disabledRooms(config)).toEqual(['examination', 'lab', 'room3d']);
        expect(disabledRooms(JSON.stringify(config))).toEqual(['examination', 'lab', 'room3d']);
        expect(isRoomEnabled(config, 'chat')).toBe(true);
        expect(isRoomEnabled(config, 'lab')).toBe(false);
        expect(isRoomEnabled(config, 'radiology')).toBe(true);
    });

    it('validates for storage: refuses a bad shape and the patient room, drops unknowns with a warning', () => {
        expect(normaliseCaseRooms({})).toEqual({ rooms: undefined, problem: null, warnings: [] });
        // Back at the defaults: nothing to store.
        expect(normaliseCaseRooms({ rooms: { disabled: [], enabled: [] } }).rooms).toBeUndefined();
        for (const rooms of ['lab', ['lab'], { disabled: 'lab' }, { disabled: [1] }, { enabled: 'room3d' },
            { disabled: [], hidden: [] }]) {
            expect(normaliseCaseRooms({ rooms }).problem, JSON.stringify(rooms)).toBeTruthy();
        }
        expect(normaliseCaseRooms({ rooms: { disabled: ['chat'] } }).problem).toMatch(/chat/);
        const result = normaliseCaseRooms({ rooms: { disabled: ['radiology', 'gone-plugin', 'lab', 'lab'] } });
        expect(result.problem).toBeNull();
        expect(result.rooms).toEqual({ disabled: ['lab', 'radiology'] });
        expect(result.warnings).toEqual([expect.objectContaining({ field: 'config.rooms.disabled', received: 'gone-plugin' })]);
        // `enabled` takes only default-off rooms.
        const enabled = normaliseCaseRooms({ rooms: { enabled: ['lab', 'room3d'] } });
        expect(enabled.rooms).toEqual({ enabled: ['room3d'] });
        expect(enabled.warnings).toEqual([expect.objectContaining({ field: 'config.rooms.enabled', received: 'lab' })]);
    });

    it('lets a specialist answer while any of its rooms is on', () => {
        const off = (...keys) => ({ rooms: { disabled: keys } });
        expect(specialistAnswers('laboratorian', off('lab'))).toBe(false);
        expect(specialistAnswers('laboratorian', off('radiology'))).toBe(true);
        // The radiologist owns Radiology and PACS.
        expect(specialistAnswers('radiologist', off('radiology'))).toBe(true);
        expect(specialistAnswers('radiologist', off('radiology', 'pacs'))).toBe(false);
        expect(specialistAnswers('pathologist', off('pathology'))).toBe(false);
        // Not a specialist: not this rule's business.
        expect(specialistAnswers('nurse', off('lab', 'radiology'))).toBe(true);
        expect(specialistAnswers('laboratorian', {})).toBe(true);
    });
});

describe('the learner projection', () => {
    const config = { pathology: PATHOLOGY_DOC, rooms: { disabled: ['pathology'] } };

    it("drops a switched-off plugin room's document for a learner, and keeps it for staff", () => {
        const learner = projectPluginDocumentsForRole(config, PLUGIN_MANIFESTS, 'student');
        expect(learner).not.toHaveProperty('pathology');
        expect(learner.rooms).toEqual({ disabled: ['pathology'] });
        expect(config).toHaveProperty('pathology'); // not mutated
        expect(projectPluginDocumentsForRole(config, PLUGIN_MANIFESTS, 'educator')).toBe(config);
    });

    it('keeps the document when the room is on, and does the same through a session snapshot', () => {
        const on = { pathology: PATHOLOGY_DOC };
        expect(projectPluginDocumentsForRole(on, PLUGIN_MANIFESTS, 'student')).toHaveProperty('pathology');
        const snapshot = JSON.stringify({ case_id: 1, config });
        expect(JSON.parse(projectCaseSnapshotForRole(snapshot, PLUGIN_MANIFESTS, 'student')).config)
            .not.toHaveProperty('pathology');
    });
});

// ---------------------------------------------------------------------------
// Through the real server
// ---------------------------------------------------------------------------

const PASSWORD = 'CaseRooms1!';
const ALL_OFF = ['consultant', 'examination', 'lab', 'pathology', 'radiology', 'room3d'];

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}

// OpenAI-compatible upstream: any request that reaches it was not refused.
function startLlm() {
    const bodies = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            bodies.push(JSON.parse(raw || '{}'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'cmpl-1',
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, bodies, close: () => new Promise((r) => server.close(r)),
    })));
}

describe('the server', () => {
    let server;
    let llm;
    let student;
    let educator;
    const ids = {};

    const as = (token, method, path, body) => fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username) => {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: PASSWORD }),
        });
        if (!res.ok) throw new Error(`login ${username} -> ${res.status}`);
        return (await res.json()).token;
    };

    beforeAll(async () => {
        llm = await startLlm();
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(PASSWORD, 4);
            const studentId = (await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('rooms-student', 'S', 'rooms-student@example.com', ?, 'student', 1, 'active')`, [hash])).lastID;
            await pRun(db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES ('rooms-educator', 'E', 'rooms-educator@example.com', ?, 'educator', 1, 'active')`, [hash]);
            await pRun(db, `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value) VALUES
                ('llm_enabled', 'true'), ('llm_provider', 'custom'), ('llm_base_url', ?), ('llm_model', 'test-model')`,
            [llm.baseUrl]);

            const addCase = async (name, config) => (await pRun(db,
                `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES (?, 'd', 'p', ?, 1)`,
                [name, JSON.stringify(config)])).lastID;
            ids.offCase = await addCase('Pathology and history only',
                { pathology: PATHOLOGY_DOC, rooms: { disabled: ALL_OFF.filter((k) => k !== 'pathology') } });
            ids.onCase = await addCase('Every room', { pathology: PATHOLOGY_DOC });
            ids.bedsideCase = await addCase('Bedside exam only', { rooms: { disabled: ['examination'], enabled: ['room3d'] } });

            const addTemplate = async (type) => (await pRun(db,
                `INSERT INTO agent_templates (agent_type, name, role_title, system_prompt, config, tenant_id)
                 VALUES (?, ?, 'r', 'prompt', '{}', 1)`, [type, `Rooms ${type}`])).lastID;
            ids.discussantTemplate = await addTemplate('discussant');
            const labTemplate = await addTemplate('laboratorian');
            const pathTemplate = await addTemplate('pathologist');
            const attach = async (caseId, templateId) => (await pRun(db,
                `INSERT INTO case_agents (case_id, agent_template_id, enabled, availability_type, tenant_id)
                 VALUES (?, ?, 1, 'present', 1)`, [caseId, templateId])).lastID;
            ids.offLab = await attach(ids.offCase, labTemplate);
            ids.offPath = await attach(ids.offCase, pathTemplate);
            ids.onLab = await attach(ids.onCase, labTemplate);

            const addSession = async (caseId, snapshot = null) => (await pRun(db,
                `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id, case_snapshot)
                 VALUES (?, ?, 'Rooms Student', 'active', 1, ?)`, [caseId, studentId, snapshot])).lastID;
            ids.offSession = await addSession(ids.offCase);
            ids.onSession = await addSession(ids.onCase);
            ids.bedsideSession = await addSession(ids.bedsideCase);
            // Started before the rooms were switched off: its snapshot has them all.
            ids.pinnedSession = await addSession(ids.offCase,
                JSON.stringify({ case_id: ids.offCase, config: { pathology: PATHOLOGY_DOC } }));
        } finally {
            await closeDb(db);
        }
        student = await login('rooms-student');
        educator = await login('rooms-educator');
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
        if (llm) await llm.close();
    });

    const refused = async (res, code) => {
        expect(res.status).toBe({ no_answer: 409, invalid_rooms: 400, room_disabled: 403 }[code]);
        expect((await res.json()).code).toBe(code);
    };

    describe('saving a case', () => {
        const save = (config) => as(educator, 'PUT', `/api/cases/${ids.bedsideCase}`,
            { name: 'Bedside exam only', description: 'd', system_prompt: 'p', config });

        it('refuses a rooms setting it cannot read, and switching the patient room off', async () => {
            await refused(await save({ rooms: { disabled: 'lab' } }), 'invalid_rooms');
            await refused(await save({ rooms: { disabled: ['chat'] } }), 'invalid_rooms');
        });

        it('stores a valid one sorted, dropping an unknown room with a warning', async () => {
            const res = await save({ rooms: { disabled: ['gone-plugin', 'examination'], enabled: ['room3d'] } });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.config.rooms).toEqual({ disabled: ['examination'], enabled: ['room3d'] });
            expect(body.warnings).toEqual([expect.objectContaining({ received: 'gone-plugin' })]);
        });
    });

    describe('a learner in a switched-off room', () => {
        it('cannot see or order labs', async () => {
            await refused(await as(student, 'GET', `/api/sessions/${ids.offSession}/available-labs`), 'room_disabled');
            await refused(await as(student, 'POST', `/api/sessions/${ids.offSession}/order-labs`, { lab_ids: ['cbc'] }), 'room_disabled');
        });

        it('cannot see or order imaging', async () => {
            await refused(await as(student, 'GET', `/api/sessions/${ids.offSession}/available-radiology`), 'room_disabled');
            await refused(await as(student, 'POST', `/api/sessions/${ids.offSession}/order-radiology`, { radiology_ids: ['cxr'] }), 'room_disabled');
        });

        it('cannot examine with both the examination room and the bedside off, and can with the bedside switched on', async () => {
            const finding = { body_region: 'chest', exam_type: 'auscultation', finding: 'clear' };
            await refused(await as(student, 'POST', `/api/sessions/${ids.offSession}/exam-findings`, finding), 'room_disabled');
            const bedside = await as(student, 'POST', `/api/sessions/${ids.bedsideSession}/exam-findings`, finding);
            expect(bedside.status).toBeLessThan(300);
        });

        it('has no discussant with the debrief room off', async () => {
            const ask = (sessionId) => as(student, 'POST', '/api/proxy/llm', {
                session_id: sessionId, messages: [{ role: 'user', content: 'How did I do?' }],
                system_prompt: 'debrief', agent_llm_config: { agent_template_id: ids.discussantTemplate },
            });
            const before = llm.bodies.length;
            await refused(await ask(ids.offSession), 'room_disabled');
            expect(llm.bodies.length).toBe(before);
            expect((await ask(ids.onSession)).status).toBe(200);
        });
    });

    describe('the phone', () => {
        it('lists a specialist whose rooms are off, but marks that it does not answer', async () => {
            const res = await as(student, 'GET', `/api/sessions/${ids.offSession}/agents`);
            expect(res.status).toBe(200);
            const answers = Object.fromEntries((await res.json()).agents.map((a) => [a.agent_type, a.answers]));
            expect(answers).toEqual({ laboratorian: false, pathologist: true });
        });

        it('refuses to page it, to log a conversation with it, or to route an LLM turn to it', async () => {
            await refused(await as(student, 'POST', `/api/sessions/${ids.offSession}/agents/laboratorian/page`), 'no_answer');
            await refused(await as(student, 'POST', `/api/sessions/${ids.offSession}/agents/laboratorian/conversation`,
                { role: 'user', content: 'Hello?' }), 'no_answer');
            const before = llm.bodies.length;
            await refused(await as(student, 'POST', '/api/proxy/llm', {
                session_id: ids.offSession, messages: [{ role: 'user', content: 'Hello?' }],
                system_prompt: 'lab', agent_llm_config: { case_agent_id: ids.offLab },
            }), 'no_answer');
            expect(llm.bodies.length).toBe(before);
        });

        it('still answers for a specialist whose room is on', async () => {
            const page = await as(student, 'POST', `/api/sessions/${ids.offSession}/agents/pathologist/page`);
            expect(page.status).toBe(200);
            const listed = await (await as(student, 'GET', `/api/sessions/${ids.onSession}/agents`)).json();
            expect(listed.agents.find((a) => a.agent_type === 'laboratorian').answers).toBe(true);
        });
    });

    describe('what is not refused', () => {
        it("keeps a session on the rooms it started with (the snapshot's)", async () => {
            const res = await as(student, 'GET', `/api/sessions/${ids.pinnedSession}/available-labs`);
            expect(res.status).toBe(200);
        });

        it('lets staff preview a switched-off room', async () => {
            const res = await as(educator, 'GET', `/api/sessions/${ids.offSession}/available-labs`);
            expect(res.status).toBe(200);
        });

        it('serves a learner whose case has every room on', async () => {
            expect((await as(student, 'GET', `/api/sessions/${ids.onSession}/available-labs`)).status).toBe(200);
            expect((await as(student, 'GET', `/api/sessions/${ids.onSession}/available-radiology`)).status).toBe(200);
        });
    });
});
