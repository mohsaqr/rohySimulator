import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startTestServer } from '../utils/startTestServer.js';
import { all, asUser, closeDb, openDb, run, seedUser } from '../utils/authHttp.js';

describe('admin feeds and exports use real TTS, vitals and scenario columns', () => {
    let server;
    let admin;
    let sessionId;
    let caseId;
    const timestamp = '2026-10-08T10:00:00.000Z';
    const range = 'from=2026-10-08&to=2026-10-08';

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'feed-source-admin', role: 'admin' });
            await Promise.all([1, 2].map(async (tenantId) => {
                const userId = await seedUser(db, { username: `feed-source-student-${tenantId}`, tenantId });
                const c = await run(db, 'INSERT INTO cases (name, tenant_id) VALUES (?, ?)', [`Feed case ${tenantId}`, tenantId]);
                const s = await run(db, 'INSERT INTO sessions (case_id, user_id, tenant_id, status) VALUES (?, ?, ?, ?)', [c.lastID, userId, tenantId, 'active']);
                if (tenantId === 1) { sessionId = s.lastID; caseId = c.lastID; }
                await Promise.all([timestamp, '2026-10-07T10:00:00.000Z', '2026-10-09T10:00:00.000Z'].map(async (ts) => {
                    await run(db, `INSERT INTO system_audit_log (timestamp, user_id, username, action, resource_name, tenant_id)
                        VALUES (?, ?, ?, ?, ?, ?)`, [ts, userId, `feed-source-student-${tenantId}`, `audit-t${tenantId}`, `Audit resource t${tenantId}`, tenantId]);
                    await run(db, `INSERT INTO tts_usage (user_id, date, provider, char_count, request_count, created_at, tenant_id)
                        VALUES (?, ?, ?, 123, 2, ?, ?)`, [userId, ts.slice(0, 10), `provider-t${tenantId}`, ts, tenantId]);
                    await run(db, `INSERT INTO session_vitals (session_id, timestamp, hr, spo2, tenant_id)
                        VALUES (?, ?, ?, 97, ?)`, [s.lastID, ts, 70 + tenantId, tenantId]);
                    await run(db, `INSERT INTO scenario_events (case_id, session_id, event_type, event_name, message, is_triggered, triggered_at, tenant_id)
                        VALUES (?, ?, 'vital_change', ?, ?, 1, ?, ?)`, [c.lastID, s.lastID, `step-t${tenantId}`, `Scenario message t${tenantId}`, ts, tenantId]);
                    await run(db, `INSERT INTO emotion_logs (session_id, user_id, case_id, emotion, timestamp, tenant_id)
                        VALUES (?, ?, ?, ?, ?, ?)`, [s.lastID, userId, c.lastID, `emotion-t${tenantId}`, ts, tenantId]);
                    await run(db, `INSERT INTO client_logs (tenant_id, user_id, session_id, level, component, msg, ts, received_at)
                        VALUES (?, ?, ?, 'warn', 'settings', ?, ?, ?)`, [tenantId, userId, s.lastID, `Client message t${tenantId}`, ts, ts]);
                    await run(db, `INSERT INTO oyon_emotion_records (tenant_id, user_id, session_id, case_id,
                        student_name_snapshot, window_start, window_end, dominant_emotion, confidence, capture_mode, consent_version)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.85, 'local-browser', 'test-v1')`,
                    [String(tenantId), String(userId), String(s.lastID), String(c.lastID), `feed-source-student-${tenantId}`, ts, ts, `calm-t${tenantId}`]);
                }));
                await run(db, `INSERT INTO scenario_events (case_id, event_type, event_name, tenant_id)
                    VALUES (?, 'scheduled', 'not-triggered', ?)`, [c.lastID, tenantId]);
            }));
        } finally { await closeDb(db); }
        admin = await asUser(server.baseUrl, 'feed-source-admin');
    }, 90000);

    afterAll(async () => { if (server) await server.close(); });

    it('chat feed includes stored TTS usage and filters dates and tenant', async () => {
        const res = await admin(`/api/chat-log/feed?${range}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.events.filter(row => row.source === 'tts')).toEqual([
            expect.objectContaining({ ts: timestamp, username: 'feed-source-student-1', role: 'provider-t1', content: 'provider-t1', model: 'provider-t1' }),
        ]);
        expect(body.sources.tts).toBe(1);
    });

    it('system feed includes the three stored sources with date and tenant isolation', async () => {
        const res = await admin(`/api/system-log/feed?${range}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        const rows = body.events.filter(row => ['tts', 'vitals', 'scenario'].includes(row.component));
        expect(rows).toHaveLength(3);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ ts: timestamp, component: 'tts', event: 'provider-t1', description: 'provider-t1', ref_type: 'provider', ref_id: 'provider-t1' }),
            expect.objectContaining({ ts: timestamp, component: 'vitals', username: 'feed-source-student-1', description: 'HR 71.0 SpO2 97.0', ref_type: 'session', ref_id: String(sessionId) }),
            expect.objectContaining({ ts: timestamp, component: 'scenario', event: 'vital_change', description: 'Scenario message t1', ref_type: 'scenario', ref_id: String(caseId) }),
        ]));
    });

    it('system feed excludes untriggered scenario definitions without a date filter', async () => {
        const res = await admin('/api/system-log/feed?limit=200');
        expect(res.status).toBe(200);
        const rows = (await res.json()).events.filter(row => row.component === 'scenario');
        expect(rows).toHaveLength(3);
        expect(rows.every(row => row.event === 'vital_change' && row.description === 'Scenario message t1' && row.ts)).toBe(true);
    });

    it('system and chat feeds include real Oyon samples and client logs', async () => {
        const systemRes = await admin(`/api/system-log/feed?${range}`);
        expect(systemRes.status).toBe(200);
        const rows = (await systemRes.json()).events.filter(row => ['client', 'oyon'].includes(row.component));
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ ts: timestamp, component: 'client', event: 'warn', description: 'Client message t1', ref_type: 'settings', username: 'feed-source-student-1' }),
            expect.objectContaining({ ts: timestamp, component: 'oyon', event: 'calm-t1', description: 'calm-t1 (0.85)', ref_id: String(sessionId) }),
        ]));
        const chatRes = await admin(`/api/chat-log/feed?${range}&session_id=${sessionId}`);
        expect(chatRes.status).toBe(200);
        expect((await chatRes.json()).events.filter(row => row.source === 'oyon')).toEqual([
            expect.objectContaining({ ts: timestamp, content: 'calm-t1', username: 'feed-source-student-1', session_id: String(sessionId) }),
        ]);
    });

    it('audit feed excludes other tenants and out-of-range rows', async () => {
        const feedRes = await admin(`/api/system-log/feed?${range}`);
        expect(feedRes.status).toBe(200);
        expect((await feedRes.json()).events.filter(row => row.component === 'admin')).toEqual([
            expect.objectContaining({ ts: timestamp, event: 'audit-t1', username: 'feed-source-student-1', description: 'Audit resource t1' }),
        ]);
    });

    it('admin CSV excludes other tenants and out-of-range rows', async () => {
        const exportRes = await admin(`/api/export/system-log/admin?${range}`);
        expect(exportRes.status).toBe(200);
        const lines = (await exportRes.text()).trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('Audit resource t1');
        expect(lines[1]).not.toContain('t2');
    });

    it.each(['vitals', 'scenario', 'emotion', 'client', 'oyon'])('%s CSV export filters actual timestamps and tenant', async (source) => {
        const res = await admin(`/api/export/system-log/${source}?${range}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        const lines = (await res.text()).trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain(timestamp);
        expect(lines[1]).not.toContain('t2');
        expect(lines[0]).toContain({ scenario: 'triggered_at', client: 'ts', oyon: 'window_start' }[source] || 'timestamp');
    });

    it('every feed SQL column and export date column exists in the migrated schema', async () => {
        const route = await readFile(new URL('../../server/routes/analytics-routes.js', import.meta.url), 'utf8');
        const chat = route.slice(route.indexOf("router.get('/chat-log/feed'"), route.indexOf('// --- SYSTEM LOG per-source CSV'));
        const system = route.slice(route.indexOf("router.get('/system-log/feed'"), route.indexOf('// --- SYSTEM LOG (raw DB'));
        // Optional LLM columns are selected only after a runtime PRAGMA probe.
        const feeds = (chat + system).replace(/^\s*const (?:inTok|outTok|latency|sessCol)\s*=.*$/gm, '');
        const tables = [...feeds.matchAll(/(?:FROM|JOIN) (\w+) (\w+)/g)];
        const exports = [...route.slice(route.indexOf('const EXPORT_SOURCES ='), route.indexOf('function csvCellEscape')).matchAll(/table: '(\w+)',\s+dateCol: '(\w+)',\s+tenant: (true|false)/g)];
        const db = await openDb(server.dbPath);
        try {
            const names = [...new Set([...tables.map(match => match[1]), ...exports.map(match => match[1])])];
            // table_xinfo includes the audit log's generated ts_utc column.
            const schema = Object.fromEntries(await Promise.all(names.map(async name => [name, (await all(db, `PRAGMA table_xinfo("${name}")`)).map(column => column.name)])));
            const missing = tables.flatMap(([, table, alias]) => [...feeds.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))]
                .filter(match => !schema[table].includes(match[1])).map(match => `${table}.${match[1]}`));
            missing.push(...exports.filter(([, table, column]) => !schema[table].includes(column)).map(([, table, column]) => `export:${table}.${column}`));
            const unscopedExports = exports.filter(([, table, , scoped]) => scoped === 'false' && schema[table].includes('tenant_id')).map(([, table]) => table);
            expect(unscopedExports).toEqual([]);
            const queries = [...feeds.matchAll(/return allP\(`([\s\S]*?)`, \[/g)];
            expect(queries).toHaveLength(22);
            const unscopedFeeds = queries.flatMap(([, sql]) => {
                const source = sql.match(/FROM (\w+) (\w+)/);
                if (!source || !schema[source[1]].includes('tenant_id')) return [];
                return new RegExp(`WHERE[\\s\\S]*\\b${source[2]}\\.tenant_id\\s*=\\s*\\?`).test(sql) ? [] : [source[1]];
            });
            expect(unscopedFeeds).toEqual([]);
            expect(names.length).toBeGreaterThanOrEqual(18);
            expect([...new Set(missing)]).toEqual([]);
        } finally { await closeDb(db); }
    });

    it('all feed queries and date-filtered exports run without swallowed SQL errors', async () => {
        const sources = ['auth', 'admin', 'config', 'learning', 'rejected', 'chat', 'alarm', 'llm', 'tts', 'emotion', 'oyon', 'vitals', 'scenario', 'client'];
        await Promise.all(sources.map(async source => {
            const res = await admin(`/api/export/system-log/${source}?${range}`);
            expect(res.status).toBe(200);
            expect(await res.text()).toContain('\n');
        }));
        await expect.poll(() => server.getStdout() + server.getStderr()).not.toMatch(/log feed subquery failed|system-log export errored mid-stream/);
    });
});
