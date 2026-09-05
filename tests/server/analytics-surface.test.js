// The analytics surface after the facet registry: one server-side filter
// (room included) behind every endpoint, a lensed sequence builder that the
// client dashboards match, the export carrying every column the schema has,
// and the moments feed counting each chat turn once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { eventsToSequences } from '../../src/components/analytics/tna/activityEvents.js';
import { activityLabel } from '../../server/shared/eventFacets.js';

const PASSWORD = 'SurfaceT3sts!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); }));
}
async function seedUser(db, username, role = 'admin') {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [username, username, `${username}@example.com`, hash, role]);
    return r.lastID;
}
async function seedEvent(db, { sessionId, userId, caseId, verb, objectType, objectId = null, room = null, ts, messageContent = null, messageRole = null }) {
    await pRun(db,
        `INSERT INTO learning_events (session_id, user_id, case_id, verb, object_type, object_id, object_name, severity, category, room, timestamp, tenant_id, message_content, message_role, vital_hr, client_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'INFO', 'CLINICAL', ?, ?, 1, ?, ?, 77, '2026-05-01T08:59:59.000Z')`,
        [sessionId, userId, caseId, verb, objectType, objectId, objectType, room, ts, messageContent, messageRole]);
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}

const t = (mins) => new Date(Date.UTC(2026, 4, 1, 9, mins, 0)).toISOString();

describe('analytics surface', () => {
    let server, token, userId, caseId, sessionId, otherSessionId;
    const get = (path) => fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            userId = await seedUser(db, 'surface-admin');
            caseId = (await pRun(db, `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('Surface', '', 'p', '{}', 1)`)).lastID;
            sessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`, [caseId, userId])).lastID;
            otherSessionId = (await pRun(db, `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`, [caseId, userId])).lastID;
            // A session in two rooms, with a historical verb name, a chat turn
            // written BOTH to learning_events and to interactions (dual-write).
            await seedEvent(db, { sessionId, userId, caseId, verb: 'STARTED_SESSION', objectType: 'session', room: 'chat', ts: t(0) });
            await seedEvent(db, { sessionId, userId, caseId, verb: 'SENT_MESSAGE', objectType: 'chat_message', room: 'chat', ts: t(1), messageContent: 'hello', messageRole: 'user' });
            await seedEvent(db, { sessionId, userId, caseId, verb: 'ORDERED_LAB', objectType: 'lab_test', room: 'lab', ts: t(2) });
            await seedEvent(db, { sessionId, userId, caseId, verb: 'VIEWED_LAB_RESULT', objectType: 'lab_result', room: 'lab', ts: t(3) });
            await seedEvent(db, { sessionId, userId, caseId, verb: 'VIEWED_HISTORY', objectType: 'patient_record', room: 'chat', ts: t(4) });
            await seedEvent(db, { sessionId, userId, caseId, verb: 'OPENED_STUDY', objectType: 'imaging_study', room: 'pacs', ts: t(5) });
            await pRun(db, `INSERT INTO interactions (session_id, role, content, timestamp, tenant_id) VALUES (?, 'user', 'hello', ?, 1)`, [sessionId, t(1)]);
            // A pre-dual-write session: chat only in interactions.
            await pRun(db, `INSERT INTO interactions (session_id, role, content, timestamp, tenant_id) VALUES (?, 'user', 'legacy', ?, 1)`, [otherSessionId, t(10)]);
            await seedEvent(db, { sessionId: otherSessionId, userId, caseId, verb: 'ORDERED_LAB', objectType: 'lab_test', room: 'lab', ts: t(11) });
        } finally { await closeDb(db); }
        token = await login(server.baseUrl, 'surface-admin');
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('?room= narrows summary, events and sequences identically, and filter-options lists rooms', async () => {
        const summary = await (await get('/api/analytics/summary?room=lab')).json();
        const events = await (await get('/api/analytics/events?room=lab')).json();
        expect(summary.totalActivities).toBe(3);
        expect(events.total).toBe(3);
        expect(events.events.every((e) => e.room === 'lab')).toBe(true);
        const options = await (await get('/api/analytics/filter-options')).json();
        const rooms = Object.fromEntries(options.rooms.map((r) => [r.id, r]));
        expect(rooms.lab.count).toBe(3);
        expect(rooms.pacs.label).toBe('Pacs');
        expect(rooms.chat.label).toBe('Patient (main)');
        expect(rooms.chat.labelKey).toBe('room_chat');
    });

    it('?session_id= reaches the aggregates (it never used to)', async () => {
        const summary = await (await get(`/api/analytics/summary?session_id=${otherSessionId}`)).json();
        expect(summary.totalActivities).toBe(1);
    });

    it('/analytics/events is paged and carries the join columns', async () => {
        const page = await (await get(`/api/analytics/events?session_id=${sessionId}&limit=2&offset=0`)).json();
        expect(page.total).toBe(6);
        expect(page.events).toHaveLength(2);
        expect(page.events[0].case_name).toBe('Surface');
        expect(page.events[0].username).toBe('surface-admin');
        const all = await (await get('/api/learning-events/all?limit=5'));
        expect(all.headers.get('deprecation')).toBe('true');
    });

    it('the lensed server sequences equal the client builder over the same rows', async () => {
        const events = (await (await get(`/api/analytics/events?session_id=${sessionId}&limit=100`)).json()).events;
        const server = await (await get(`/api/analytics/tna-sequences?session_id=${sessionId}&lens=clinical-state&min_sequence_length=2`)).json();
        const client = eventsToSequences(events, {
            groupBy: 'actor-session',
            labelOf: (e) => activityLabel(e.verb, e.object_type, 'clinical-state', undefined, { objectId: e.object_id, result: e.result }),
        });
        expect(server.metadata.lens).toBe('clinical-state');
        expect(server.sequences).toEqual(client);
        // Historical names read as their canonical state: VIEWED_HISTORY →
        // assessing, VIEWED_LAB_RESULT → assessing; plugin verbs resolve too.
        expect(server.sequences[0]).toEqual(['regulating', 'communicating', 'investigating', 'assessing', 'assessing', 'assessing']);
        const fine = await (await get(`/api/analytics/tna-sequences?session_id=${sessionId}&lens=fine`)).json();
        expect(fine.sequences[0]).toContain('Read history');
        expect(fine.sequences[0]).toContain('Read lab result');
        // The default lens is byte-identical to the historical merge map.
        const tna = await (await get(`/api/analytics/tna-sequences?session_id=${sessionId}`)).json();
        expect(tna.metadata.lens).toBe('tna');
        expect(tna.sequences[0]).not.toContain('assessing');
    });

    it('the CSV export appends room, client_time, plugin and vitals after the original columns', async () => {
        const res = await get('/api/export/learning-events');
        expect(res.status).toBe(200);
        const [header, ...lines] = (await res.text()).trim().split('\n');
        const cols = header.split(',');
        expect(cols.slice(0, 19)).toEqual([
            'timestamp', 'user_id', 'username', 'case_id', 'case_name', 'session_id',
            'verb', 'object_type', 'object_id', 'object_name',
            'component', 'parent_component', 'result', 'duration_ms',
            'message_role', 'message_content', 'severity', 'category', 'context_json',
        ]);
        expect(cols.slice(19)).toEqual([
            'verb_canonical', 'room', 'client_time', 'plugin_id', 'plugin_version',
            'vital_hr', 'vital_spo2', 'vital_bp_sys', 'vital_bp_dia', 'vital_rr', 'vital_temp', 'vital_etco2', 'vital_rhythm',
        ]);
        const history = lines.find((l) => l.includes('VIEWED_HISTORY'));
        expect(history).toBeTruthy();
        expect(history).toContain('VIEWED_RECORD'); // verb_canonical
        expect(history).toContain('77');            // vital_hr
    });

    it('moments counts a chat turn once per session (event row elected over the interactions fallback)', async () => {
        const dual = await (await get(`/api/learning-events/moments?session_id=${sessionId}&limit=100`)).json();
        const dualChat = (dual.moments || dual.events || []).filter((m) => ['SENT_MESSAGE', 'RECEIVED_MESSAGE'].includes(m.verb));
        expect(dualChat).toHaveLength(1);
        expect(dualChat[0].source).toBe('event');
        const legacy = await (await get(`/api/learning-events/moments?session_id=${otherSessionId}&limit=100`)).json();
        const legacyChat = (legacy.moments || legacy.events || []).filter((m) => ['SENT_MESSAGE', 'RECEIVED_MESSAGE'].includes(m.verb));
        expect(legacyChat).toHaveLength(1);
        expect(legacyChat[0].source).toBe('chat');
    });

    it('readiness reports the timestamp shape check', async () => {
        const body = await (await fetch(`${server.baseUrl}/api/ready`)).json();
        expect(body.checks.timestamps).toBe('ok');
    });
});
