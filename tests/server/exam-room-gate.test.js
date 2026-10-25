// One examination room per case, enforced on the server: requireSessionRoom()
// (server/routes/_helpers.js) refuses a learner the examination room on a case
// whose examination room is the 3D bedside, and the bedside on a case at the
// defaults — including a case stored before the rule existed, whose
// `rooms.enabled` lists the bedside and says nothing about the examination
// room.
//
// Regression lock: a case that switched the bedside on offered BOTH the
// bedside and the examination room, and the server took orders for both.
//
// Real migrations on a throwaway sqlite file; the dbAdapter singleton points
// at it (ROHY_DB is read when db.js loads, so it is set before the import).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

let testDb;
let requireSessionRoom;
const sessions = {};

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'exam-room-gate' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'exam-room-gate-tests';
    const { dbReady } = await import('../../server/db.js');
    await dbReady;
    ({ requireSessionRoom } = await import('../../server/routes/_helpers.js'));

    const studentId = (await testDb.run(
        `INSERT INTO users (username, email, password_hash, role, tenant_id, status)
         VALUES ('gate-student', 'gate-student@example.com', 'x', 'student', 1, 'active')`)).lastID;
    const addSession = async (name, config) => {
        const caseId = (await testDb.run(
            `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES (?, 'd', 'p', ?, 1)`,
            [name, JSON.stringify(config)])).lastID;
        return (await testDb.run(
            `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id) VALUES (?, ?, 'S', 'active', 1)`,
            [caseId, studentId])).lastID;
    };
    sessions.defaults = await addSession('Defaults', {});
    // Stored before the rule: only the bedside is named.
    sessions.oldBedside = await addSession('Old bedside', { rooms: { enabled: ['room3d'] } });
    sessions.bedside = await addSession('Bedside', { rooms: { disabled: ['examination'], enabled: ['room3d'] } });
    sessions.none = await addSession('No examination room', { rooms: { disabled: ['examination'] } });
}, 60_000);

afterAll(async () => {
    await testDb?.cleanup();
});

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

const student = { user: { id: 999, role: 'student', tenant_id: 1 } };

async function gate(sessionId, rooms, req = student) {
    const res = fakeRes();
    const allowed = await requireSessionRoom(req, res, sessionId, rooms);
    return { allowed, status: res.statusCode, code: res.body?.code ?? null };
}

const REFUSED = { allowed: false, status: 403, code: 'room_disabled' };
const ALLOWED = { allowed: true, status: 200, code: null };

describe('requireSessionRoom: one examination room per case', () => {
    it('a case at the defaults serves the examination room and refuses the bedside', async () => {
        expect(await gate(sessions.defaults, ['examination'])).toEqual(ALLOWED);
        expect(await gate(sessions.defaults, ['room3d'])).toEqual(REFUSED);
    });

    it('a case stored with only rooms.enabled=[room3d] serves the bedside and refuses the examination room', async () => {
        expect(await gate(sessions.oldBedside, ['room3d'])).toEqual(ALLOWED);
        expect(await gate(sessions.oldBedside, ['examination'])).toEqual(REFUSED);
    });

    it('a bedside case written with the examination room switched off says the same', async () => {
        expect(await gate(sessions.bedside, ['room3d'])).toEqual(ALLOWED);
        expect(await gate(sessions.bedside, ['examination'])).toEqual(REFUSED);
    });

    it('a case with no examination room refuses both, and an exam finding from either', async () => {
        expect(await gate(sessions.none, ['examination'])).toEqual(REFUSED);
        expect(await gate(sessions.none, ['room3d'])).toEqual(REFUSED);
        expect(await gate(sessions.none, ['examination', 'room3d'])).toEqual(REFUSED);
    });

    it('an exam finding (either room) is served wherever the case has an examination room', async () => {
        for (const id of [sessions.defaults, sessions.oldBedside, sessions.bedside]) {
            expect(await gate(id, ['examination', 'room3d'])).toEqual(ALLOWED);
        }
    });

    it('staff pass, as for every room', async () => {
        const reviewer = { user: { id: 1, role: 'reviewer', tenant_id: 1 } };
        expect(await gate(sessions.oldBedside, ['examination'], reviewer)).toEqual(ALLOWED);
    });
});
