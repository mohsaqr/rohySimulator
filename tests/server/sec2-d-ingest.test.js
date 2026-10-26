// Security fix pass 2026-10-26, lane D — learning-event ingest.
//
// Regression lock: a session-less event used to be stored under `event.user_id ?? principal`, so a student filed events (chat text included) under any classmate's id (F-36 / L7-10 / L8-04).
// Regression lock: every forged event of a batch queued its own audit append on the process-wide audit queue — 500 per batch, 240 batches a minute — and the batch was still accepted (F-05 / L8-01). Now: one audit row per call, the batch refused past one forged event, at most 5 distinct sessions per batch, and an EVENT budget per user.
// Regression lock: `offset_ms` backdated an event by up to 24 h, before its own session began (L8-11).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, all, seedUser, mintToken } from '../utils/authHttp.js';
import { anchorToServer, ANCHOR_MAX_OFFSET_MS } from '../../server/shared/time.js';

const SECRET = 'sec2-d-ingest-secret';

describe('anchorToServer bounds (L8-11)', () => {
    const received = Date.UTC(2026, 9, 26, 12, 0, 0);
    it('no longer backdates by hours: an offset past ten minutes reads as the receipt time', () => {
        expect(ANCHOR_MAX_OFFSET_MS).toBe(10 * 60 * 1000);
        expect(anchorToServer(received, 2 * 60 * 60 * 1000)).toBe(new Date(received).toISOString());
    });
    it('never anchors before notBeforeMs', () => {
        const notBefore = received - 30_000;
        expect(anchorToServer(received, 5 * 60_000, { notBeforeMs: notBefore })).toBe(new Date(notBefore).toISOString());
        expect(anchorToServer(received, 10_000, { notBeforeMs: notBefore })).toBe(new Date(received - 10_000).toISOString());
    });
});

describe('learning-event ingest hardening (lane D)', () => {
    let server;
    let stuId, victimId;
    let stuTok;
    let ownSession, otherSessions;

    const withDb = async (work) => {
        const db = await openDb(server.dbPath);
        try { return await work(db); } finally { await closeDb(db); }
    };
    const post = (path, body, tok = stuTok) => fetch(`${server.baseUrl}/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
    });
    const auditCount = () => withDb(async (db) => (await get(db,
        "SELECT COUNT(*) AS n FROM system_audit_log WHERE action = 'learning_event_rejected'")).n);
    const rejectedCount = () => withDb(async (db) => (await get(db, 'SELECT COUNT(*) AS n FROM learning_events_rejected')).n);

    beforeAll(async () => {
        // A small event budget so the budget test does not need 6000 events.
        server = await startTestServer({ env: { JWT_SECRET: SECRET, ROHY_LEARNING_EVENTS_PER_MINUTE: '60' } });
        await withDb(async (db) => {
            stuId = await seedUser(db, { username: 'd_ing_stu' });
            victimId = await seedUser(db, { username: 'd_ing_victim' });
            const c = await run(db, `INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('D', '', 'p', '{}', 1)`);
            ownSession = (await run(db,
                `INSERT INTO sessions (case_id, user_id, status, tenant_id, start_time) VALUES (?, ?, 'active', 1, datetime('now'))`,
                [c.lastID, stuId])).lastID;
            otherSessions = [];
            for (let i = 0; i < 6; i += 1) {
                otherSessions.push((await run(db,
                    `INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`,
                    [c.lastID, victimId])).lastID);
            }
        });
        stuTok = await mintToken(server.dbPath, { id: stuId, username: 'd_ing_stu', role: 'student', tenant_id: 1 }, SECRET);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    it('F-36: a session-less event is always the caller\'s, whatever user_id it names', async () => {
        const res = await post('/learning-events', {
            verb: 'VIEWED', object_type: 'component', object_name: 'd-forged-user', user_id: victimId,
        });
        expect(res.status).toBe(200);
        const row = await withDb((db) => get(db, "SELECT user_id FROM learning_events WHERE object_name = 'd-forged-user'"));
        expect(row.user_id).toBe(stuId);
    });

    it('F-05: a batch with more than one forged event is refused whole, with ONE audit row', async () => {
        const auditBefore = await auditCount();
        const quarantineBefore = await rejectedCount();
        const events = [
            { session_id: ownSession, verb: 'VIEWED', object_type: 'component', object_name: 'd-refused-own' },
            ...otherSessions.slice(0, 3).flatMap((sid) => [
                { session_id: sid, verb: 'SENT_MESSAGE', object_type: 'chat_message', message_content: 'forged prose' },
                { session_id: sid, verb: 'VIEWED', object_type: 'component' },
            ]),
        ];
        const res = await post('/learning-events/batch', { events });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('forged_session_events');
        // Nothing in the batch was stored — not even the caller's own event.
        const own = await withDb((db) => get(db, "SELECT COUNT(*) AS n FROM learning_events WHERE object_name = 'd-refused-own'"));
        expect(own.n).toBe(0);
        // One audit row for the whole call, never one per forged event.
        expect(await auditCount()).toBe(auditBefore + 1);
        // One shape-only quarantine row per forged session, not per event.
        expect(await rejectedCount()).toBe(quarantineBefore + 3);
        const audit = await withDb((db) => get(db,
            "SELECT error_message, metadata FROM system_audit_log WHERE action = 'learning_event_rejected' ORDER BY id DESC LIMIT 1"));
        expect(audit.error_message).toBe('not_owner');
        const meta = JSON.parse(audit.metadata);
        expect(meta).toMatchObject({ refused: true, forged_events: 6, reasons: { not_owner: 6 } });
        expect(meta.session_ids.length).toBeLessThanOrEqual(5);
        const quarantined = await withDb((db) => all(db, 'SELECT payload_json FROM learning_events_rejected ORDER BY id DESC LIMIT 3'));
        for (const q of quarantined) {
            expect(q.payload_json).not.toContain('forged prose');
            expect(JSON.parse(q.payload_json)._repeat).toBe(2);
        }
    });

    it('F-05: one stale forged event is tolerated, handled per event, and audited once', async () => {
        const auditBefore = await auditCount();
        const res = await post('/learning-events/batch', {
            events: [
                { session_id: otherSessions[0], verb: 'VIEWED', object_type: 'component' },
                { session_id: ownSession, verb: 'VIEWED', object_type: 'component', object_name: 'd-tolerated-1' },
                { session_id: ownSession, verb: 'VIEWED', object_type: 'component', object_name: 'd-tolerated-2' },
            ],
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.inserted).toBe(2);
        expect(body.dropped_reasons.not_owner).toBe(1);
        expect(await auditCount()).toBe(auditBefore + 1);
    });

    it('F-05: a batch naming more than five sessions is refused before any lookup or write', async () => {
        const auditBefore = await auditCount();
        const quarantineBefore = await rejectedCount();
        const res = await post('/learning-events/batch', {
            events: [ownSession, ...otherSessions].map((sid) => ({ session_id: sid, verb: 'VIEWED', object_type: 'component' })),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('too_many_sessions');
        expect(await auditCount()).toBe(auditBefore);
        expect(await rejectedCount()).toBe(quarantineBefore);
    });

    it('L8-11: an event is never anchored before its session began', async () => {
        const res = await post('/learning-events/batch', {
            events: [{ session_id: ownSession, verb: 'VIEWED', object_type: 'component', object_name: 'd-backdated', offset_ms: 9 * 60_000 }],
        });
        expect(res.status).toBe(200);
        const row = await withDb((db) => get(db,
            `SELECT le.timestamp AS ts, s.start_time AS started FROM learning_events le JOIN sessions s ON s.id = le.session_id
              WHERE le.object_name = 'd-backdated'`));
        const started = Date.parse(`${row.started.replace(' ', 'T')}${row.started.endsWith('Z') ? '' : 'Z'}`);
        // At most the one-minute grace before the recorded start.
        expect(Date.parse(row.ts)).toBeGreaterThanOrEqual(started - 60_000);
    });

    it('F-05: the per-user budget counts EVENTS, not requests', async () => {
        // The budget is 60 events a minute (env above); earlier tests used a
        // handful. 50 more fit; the next 20 do not.
        const batch = (n, tag) => ({
            events: Array.from({ length: n }, (_, i) => ({ session_id: ownSession, verb: 'VIEWED', object_type: 'component', object_name: `${tag}-${i}` })),
        });
        const ok = await post('/learning-events/batch', batch(40, 'd-budget-a'));
        expect(ok.status).toBe(200);
        const refused = await post('/learning-events/batch', batch(20, 'd-budget-b'));
        expect(refused.status).toBe(429);
        expect((await refused.json()).code).toBe('learning_events_rate_limited');
        const stored = await withDb((db) => get(db, "SELECT COUNT(*) AS n FROM learning_events WHERE object_name LIKE 'd-budget-b-%'"));
        expect(stored.n).toBe(0);
    });
});
