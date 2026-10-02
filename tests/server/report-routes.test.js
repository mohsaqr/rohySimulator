// Report a problem — the relay to Prova (server/routes/report-routes.js), against a FAKE Prova.
//
// Locks: both routes need a signed-in user; the reporter Prova gets is the signed-in username, never one the
// page states; document/case content and unknown fields are refused before anything leaves; a 2 MB screenshot
// fits the route's own body cap while other routes keep 256 kb; the installation key is registered once,
// kept 0600, and never appears in an answer; Prova's rate limit passes through; with reporting off the read
// answers 200 with the reason and a report is a 404.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'ReportT3sts!';
const KEY = `pri_${'r'.repeat(43)}`;

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
const closeDb = (db) => new Promise((r) => db.close(() => r()));
const pRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { return err ? reject(err) : resolve(this); }));

async function seedUser(dbPath, username, role = 'student') {
    const db = await openDb(dbPath);
    try {
        const hash = await bcrypt.hash(PASSWORD, 4);
        await pRun(db, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, ?, 1, 'active')`,
            [username, username, `${username}@example.com`, hash, role]);
    } finally {
        await closeDb(db);
    }
}

async function login(server, username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    return (await res.json()).token;
}

function fakeProva() {
    const seen = { registrations: [], reports: [], mine: [] };
    const state = { mode: 'ok' };
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
        if (req.method === 'POST' && req.url === '/api/v1/intake/installations') { seen.registrations.push(body); return send(201, { key: KEY, installation: { id: 3, state: 'unverified' } }); }
        if (req.url.startsWith('/api/v1/intake/reports')) {
            if (req.headers['x-prova-installation'] !== KEY) return send(401, { error: 'unknown', code: 'installation_unknown' });
            if (state.mode === 'limited') return send(429, { error: '5 reports in the last hour from your account. Try again in 40 minutes.', code: 'rate_limited', scope: 'user', retry_after: 2400 });
            if (req.method === 'POST') { seen.reports.push(body); return send(201, { id: `AR-${seen.reports.length}`, status: 'received', duplicate: false, count: 1 }); }
            seen.mine.push(req.url);
            return send(200, { reports: [{ id: 'AR-1', title: 'x', status: 'fixed', status_label: 'Fixed in 3.0.1', fixed_in: '3.0.1', news: true }], news: 1 });
        }
        return send(404, { error: 'no' });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`, seen, state,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
    })));
}

const report = (over = {}) => ({
    what_happened: 'The monitor froze after I ordered a CBC',
    expected: 'The monitor keeps updating.',
    technical: { page: 'Case 12 · lab room', browser: 'Chrome 140', os: 'macOS 15.5', errors: ['GET /api/orders → 500'] },
    ...over,
});

describe('report relay (configured)', () => {
    let server; let prova; let token; let keyDir;
    beforeAll(async () => {
        prova = await fakeProva();
        keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-report-key-'));
        server = await startTestServer({ seed: false, env: { ROHY_PROVA_URL: prova.url, ROHY_REPORT_KEY_FILE: path.join(keyDir, 'report-key.json'), ROHY_REPORT_HOST: 'rohy.example' } });
        await seedUser(server.dbPath, 'beyza');
        token = await login(server, 'beyza');
    }, 60000);
    afterAll(async () => {
        await server?.close();
        await prova?.close();
        if (keyDir) fs.rmSync(keyDir, { recursive: true, force: true });
    });
    const post = (body, headers = {}) => fetch(`${server.baseUrl}/api/report`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

    it('needs a signed-in user for both routes', async () => {
        expect((await fetch(`${server.baseUrl}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report()) })).status).toBe(401);
        expect((await fetch(`${server.baseUrl}/api/reports/mine`)).status).toBe(401);
        expect(prova.seen.reports).toHaveLength(0);
    });

    it('relays with the signed-in username and Rohy\'s version; the key is registered once, 0600, never answered', async () => {
        const res = await post(report());
        expect(res.status).toBe(201);
        const text = await res.text();
        expect(JSON.parse(text).id).toBe('AR-1');
        expect(text).not.toContain(KEY);
        expect(prova.seen.registrations).toHaveLength(1);
        expect(prova.seen.registrations[0]).toMatchObject({ product: 'rohy', label: 'Rohy', host: 'rohy.example', kind: 'server' });
        const sent = prova.seen.reports[0];
        expect(sent.reporter).toEqual({ user: 'beyza' });
        expect(sent.technical.app).toMatchObject({ name: 'Rohy', host: 'rohy.example' });
        expect(sent.technical.app.version).toMatch(/^\d+\.\d+\.\d+/);
        const keyFile = path.join(keyDir, 'report-key.json');
        expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
        expect((await post(report({ what_happened: 'The lab room never finishes loading' }))).status).toBe(201);
        expect(prova.seen.registrations).toHaveLength(1);
    });

    it('refuses a stated reporter, document content and unknown fields before anything leaves', async () => {
        const before = prova.seen.reports.length;
        const cases = [
            [{ ...report(), reporter: { user: 'admin' } }, 'unknown_field'],
            [report({ content: 'the whole case JSON' }), 'document_content_refused'],
            [report({ technical: { page: 'x', source: 'case text' } }), 'document_content_refused'],
            [report({ caseData: {} }), 'unknown_field'],
            [report({ what_happened: 'short' }), 'text_too_short'],
        ];
        for (const [body, code] of cases) {
            const res = await post(body);
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe(code);
        }
        expect(prova.seen.reports.length).toBe(before);
    });

    it('takes a ~2 MB screenshot on this route; other routes keep the 256 kb cap', async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1900 * 1024)]);
        const res = await post(report({ screenshot: { media_type: 'image/png', name: 'shot.png', data: png.toString('base64') } }));
        expect(res.status).toBe(201);
        expect(prova.seen.reports.at(-1).screenshot.data.length).toBeGreaterThan(2_000_000);
        const big = await fetch(`${server.baseUrl}/api/terms/accept`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ x: 'y'.repeat(400 * 1024) }) });
        expect(big.status).toBe(413);
    });

    it('My reports: the signed-in user\'s, with seen passed on', async () => {
        const res = await fetch(`${server.baseUrl}/api/reports/mine?seen=1`, { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(JSON.parse(text).news).toBe(1);
        expect(text).not.toContain(KEY);
        expect(prova.seen.mine.at(-1)).toMatch(/user=beyza/);
        expect(prova.seen.mine.at(-1)).toMatch(/seen=1/);
    });

    it('passes Prova\'s rate limit through, naming the wait', async () => {
        prova.state.mode = 'limited';
        const res = await post(report({ what_happened: 'One report too many within the hour' }));
        prova.state.mode = 'ok';
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.error).toMatch(/Try again in 40 minutes/);
        expect(body.retry_after).toBe(2400);
    });
});

describe('report relay (off)', () => {
    let server; let token;
    beforeAll(async () => {
        server = await startTestServer({ seed: false, env: { ROHY_PROVA_URL: 'off' } });
        await seedUser(server.dbPath, 'aylin');
        token = await login(server, 'aylin');
    }, 60000);
    afterAll(async () => { await server?.close(); });

    it('the read answers 200 with the reason (no failed request in the console); a report is a 404', async () => {
        const mine = await fetch(`${server.baseUrl}/api/reports/mine`, { headers: { authorization: `Bearer ${token}` } });
        expect(mine.status).toBe(200);
        expect(await mine.json()).toEqual({ reports: [], news: 0, code: 'report_not_configured' });
        const res = await fetch(`${server.baseUrl}/api/report`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(report()) });
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe('report_not_configured');
    });
});
