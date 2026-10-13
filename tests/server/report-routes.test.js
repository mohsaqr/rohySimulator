// Report a problem — the relay to Prova (server/routes/report-routes.js), against a FAKE Prova.
//
// Locks: both routes need a signed-in user; the reporter Prova gets is the signed-in username, never one the
// page states; document/case content and unknown fields are refused before anything leaves; a 2 MB screenshot
// fits the route's own body cap while other routes keep 256 kb; a feature request (`kind`) and up to five
// `screenshots` pass through (relay 1.2.0 / widget 1.3.0), a sixth is refused, five full screenshots fit the
// route's cap (the relay's MAX_BODY) and a body over it is a 413; the installation key is registered once,
// kept 0600, and never appears in an answer; Prova's rate limit passes through; with reporting off the read
// answers 200 with the reason and a report is a 404. Relay 1.3.0 / widget 1.4.0: GET/POST
// /api/reports/:id/messages forward the signed-in username (and `seen`), the reply body is only
// `{ body, reply_to? }` under MESSAGE_BODY_MAX, an id that is not AR-<digits> is a 404 before Prova is called,
// cookie auth needs the CSRF header as on /api/report, and with reporting off both are a 404 with the reason.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { MAX_BODY, MESSAGE_BODY_MAX, MESSAGE_MAX, RELAY_VERSION, SCREENSHOTS_MAX } from '../../server/lib/prova-relay.js';

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

// Cookie sign-in: the auth cookie plus the double-submit CSRF cookie, as a browser holds them.
async function cookieLogin(server, username) {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    const csrf = cookies.find((c) => c.startsWith('rohy_csrf='))?.slice('rohy_csrf='.length);
    if (!csrf || !cookies.some((c) => c.startsWith('rohy_auth='))) throw new Error('login set no auth/CSRF cookie');
    return { cookie: cookies.join('; '), csrf };
}

function fakeProva() {
    const seen = { registrations: [], reports: [], mine: [], threads: [], replies: [] };
    const state = { mode: 'ok' };
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
        if (req.method === 'POST' && req.url === '/api/v1/intake/installations') { seen.registrations.push(body); return send(201, { key: KEY, installation: { id: 3, state: 'unverified' } }); }
        const thread = req.url.match(/^\/api\/v1\/intake\/reports\/(AR-\d+)\/messages/);
        if (thread) {
            if (req.headers['x-prova-installation'] !== KEY) return send(401, { error: 'unknown', code: 'installation_unknown' });
            if (req.method === 'POST') { seen.replies.push({ id: thread[1], body }); return send(201, { id: 41, from: 'you', kind: 'message', body: body.body }); }
            seen.threads.push(req.url);
            return send(200, { id: thread[1], kind: 'problem', title: 'x', status: 'received', can_reply: true,
                messages: [{ id: 7, from: 'team', author: 'Saqr', kind: 'question', body: 'Which browser?', open: true, options: ['Chrome', 'Safari'], at: '2026-10-13T08:00:00Z' }] });
        }
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
    const postMessage = (id, body, headers = {}) => fetch(`${server.baseUrl}/api/reports/${id}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const post = (body, headers = {}) => fetch(`${server.baseUrl}/api/report`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

    it('needs a signed-in user for both routes', async () => {
        expect((await fetch(`${server.baseUrl}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report()) })).status).toBe(401);
        expect((await fetch(`${server.baseUrl}/api/reports/mine`)).status).toBe(401);
        expect((await fetch(`${server.baseUrl}/api/reports/AR-1/messages`)).status).toBe(401);
        expect((await fetch(`${server.baseUrl}/api/reports/AR-1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hello' }) })).status).toBe(401);
        expect(prova.seen.reports).toHaveLength(0);
        expect(prova.seen.replies).toHaveLength(0);
    });

    // Regression lock: the My-reports badge's first read registered the installation with Prova on page load, before anyone had reported anything (QA 2026-10-04, PRV-38)
    it('a read before any report neither registers nor calls Prova', async () => {
        const res = await fetch(`${server.baseUrl}/api/reports/mine`, { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ reports: [], news: 0 });
        expect(prova.seen.registrations).toHaveLength(0);
        expect(prova.seen.mine).toHaveLength(0);
        expect(fs.existsSync(path.join(keyDir, 'report-key.json'))).toBe(false);
    });

    it('before any report a conversation is a 404 (read or reply) and nothing registers or reaches Prova', async () => {
        const read = await fetch(`${server.baseUrl}/api/reports/AR-1/messages?seen=1`, { headers: { authorization: `Bearer ${token}` } });
        expect(read.status).toBe(404);
        expect((await read.json()).code).toBe('not_found');
        const write = await postMessage('AR-1', { body: 'Still broken on my side' });
        expect(write.status).toBe(404);
        expect(prova.seen.registrations).toHaveLength(0);
        expect(prova.seen.threads).toHaveLength(0);
        expect(prova.seen.replies).toHaveLength(0);
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

    const shot = (name, bytes = 1024) => ({ media_type: 'image/png', name, data: Buffer.alloc(bytes, 7).toString('base64') });

    it('vendors relay 1.3.0, whose cap is 8.5 MB, which takes five screenshots and 16 KiB message bodies', () => {
        expect(RELAY_VERSION).toBe('1.3.0');
        expect(MESSAGE_BODY_MAX).toBe(16 * 1024);
        expect(MAX_BODY).toBe(8 * 1024 * 1024 + 512 * 1024);
        expect(SCREENSHOTS_MAX).toBe(5);
    });

    it('passes a feature request\'s `kind` and its `screenshots` through to Prova, field by field', async () => {
        const res = await post(report({
            kind: 'feature', what_happened: 'Let me pause the case clock while I read the labs', expected: 'A pause button on the monitor',
            technical: { page: 'Case 12 · lab room', browser: 'Chrome 140', os: 'macOS 15.5', errors: [] },
            screenshots: [shot('one.png'), shot('two.png', 2048)],
        }));
        expect(res.status).toBe(201);
        const sent = prova.seen.reports.at(-1);
        expect(sent.kind).toBe('feature');
        expect(sent.what_happened).toBe('Let me pause the case clock while I read the labs');
        expect(sent.screenshots).toEqual([shot('one.png'), shot('two.png', 2048)]);
        expect(sent.screenshot).toBeUndefined();
        expect(sent.reporter).toEqual({ user: 'beyza' });
        // A problem report still goes as before: `kind: 'problem'` passes too.
        expect((await post(report({ kind: 'problem', screenshots: [shot('p.png')] }))).status).toBe(201);
        expect(prova.seen.reports.at(-1)).toMatchObject({ kind: 'problem', screenshots: [shot('p.png')] });
    });

    it('refuses a sixth screenshot, an unknown kind and a screenshot with extra fields before anything leaves', async () => {
        const before = prova.seen.reports.length;
        const six = Array.from({ length: SCREENSHOTS_MAX + 1 }, (_, i) => shot(`s${i}.png`));
        const cases = [
            [report({ screenshots: six }), 'too_many_screenshots'],
            [report({ kind: 'question' }), 'invalid_field'],
            [report({ screenshots: [{ ...shot('x.png'), caption: 'case text' }] }), 'unknown_field'],
            [report({ screenshots: 'not a list' }), 'invalid_field'],
        ];
        for (const [body, code] of cases) {
            const res = await post(body);
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe(code);
        }
        expect(prova.seen.reports.length).toBe(before);
        // Exactly five is fine.
        expect((await post(report({ screenshots: six.slice(0, SCREENSHOTS_MAX) }))).status).toBe(201);
    });

    it('five screenshots of 6 MB together fit this route\'s cap (the relay\'s MAX_BODY); a body over it is a 413', async () => {
        const each = Math.floor((6 * 1024 * 1024) / 5);
        const five = Array.from({ length: 5 }, (_, i) => shot(`big${i}.png`, each));
        const body = JSON.stringify(report({ screenshots: five }));
        expect(body.length).toBeGreaterThan(8 * 1024 * 1024);   // over the old 4 MB cap, twice
        expect(body.length).toBeLessThan(MAX_BODY);
        const res = await post(body);
        expect(res.status).toBe(201);
        expect(prova.seen.reports.at(-1).screenshots).toHaveLength(5);
        const before = prova.seen.reports.length;
        const over = JSON.stringify(report({ what_happened: `Too big ${'x'.repeat(MAX_BODY)}` }));
        expect((await post(over)).status).toBe(413);
        expect(prova.seen.reports.length).toBe(before);
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

    it('a conversation: the signed-in user\'s, with seen passed on only when asked', async () => {
        const res = await fetch(`${server.baseUrl}/api/reports/AR-1/messages?seen=1&user=admin`, { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain(KEY);
        expect(JSON.parse(text)).toMatchObject({ id: 'AR-1', can_reply: true, messages: [{ id: 7, kind: 'question' }] });
        const asked = new URL(prova.seen.threads.at(-1), 'http://x');
        expect(asked.pathname).toBe('/api/v1/intake/reports/AR-1/messages');
        expect(asked.searchParams.getAll('user')).toEqual(['beyza']);   // never the page's `user=admin`
        expect(asked.searchParams.get('seen')).toBe('1');
        await fetch(`${server.baseUrl}/api/reports/AR-1/messages`, { headers: { authorization: `Bearer ${token}` } });
        expect(new URL(prova.seen.threads.at(-1), 'http://x').searchParams.get('seen')).toBeNull();
    });

    it('a reply: `{ body, reply_to }` trimmed and forwarded with the signed-in username', async () => {
        const res = await postMessage('AR-1', { body: '  Chrome 140 on macOS  ', reply_to: 7 });
        expect(res.status).toBe(201);
        expect(await res.text()).not.toContain(KEY);
        expect(prova.seen.replies.at(-1)).toEqual({ id: 'AR-1', body: { body: 'Chrome 140 on macOS', reply_to: 7, reporter: { user: 'beyza' } } });
        expect((await postMessage('AR-1', { body: 'Thanks, it works now' })).status).toBe(201);
        expect(prova.seen.replies.at(-1).body).toEqual({ body: 'Thanks, it works now', reporter: { user: 'beyza' } });
    });

    it('refuses a reply that is not just `{ body, reply_to? }` before anything leaves; over 16 KiB is a 413', async () => {
        const before = prova.seen.replies.length;
        const cases = [
            [{}, 'missing_field'],
            [{ body: '   ' }, 'missing_field'],
            [{ body: 'hello', reporter: { user: 'admin' } }, 'unknown_field'],
            [{ body: 'hello', case: { id: 3 } }, 'unknown_field'],
            [{ body: 'x'.repeat(MESSAGE_MAX + 1) }, 'message_too_long'],
            [{ body: 'hello', reply_to: 'seven' }, 'invalid_field'],
            [['hello'], 'invalid_json'],
        ];
        for (const [body, code] of cases) {
            const res = await postMessage('AR-1', body);
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe(code);
        }
        const over = await postMessage('AR-1', { body: 'y'.repeat(MESSAGE_BODY_MAX) });
        expect(over.status).toBe(413);
        expect(prova.seen.replies.length).toBe(before);
    });

    it('an id that is not AR-<digits> is a 404 for a read and a reply, before Prova is called', async () => {
        const threads = prova.seen.threads.length;
        const replies = prova.seen.replies.length;
        for (const id of ['PRV-1', 'AR-', 'AR-1x', '12', `AR-${'9'.repeat(13)}`, '..%2Fmine']) {
            const read = await fetch(`${server.baseUrl}/api/reports/${id}/messages`, { headers: { authorization: `Bearer ${token}` } });
            expect(read.status).toBe(404);
            expect((await read.json()).code).toBe('not_found');
            const write = await postMessage(id, { body: 'hello' });
            expect(write.status).toBe(404);
        }
        expect(prova.seen.threads.length).toBe(threads);
        expect(prova.seen.replies.length).toBe(replies);
    });

    it('with a cookie sign-in, a reply needs the CSRF header exactly as a report does; a read does not', async () => {
        const { cookie, csrf } = await cookieLogin(server, 'beyza');
        const replies = prova.seen.replies.length;
        const reports = prova.seen.reports.length;
        const viaCookie = (url, body, headers = {}) => fetch(`${server.baseUrl}${url}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
        expect((await viaCookie('/api/report', report())).status).toBe(403);
        expect((await viaCookie('/api/reports/AR-1/messages', { body: 'hello' })).status).toBe(403);
        expect(prova.seen.replies.length).toBe(replies);
        expect(prova.seen.reports.length).toBe(reports);
        expect((await viaCookie('/api/reports/AR-1/messages', { body: 'hello from the cookie' }, { 'x-csrf-token': csrf })).status).toBe(201);
        expect(prova.seen.replies.at(-1).body.reporter).toEqual({ user: 'beyza' });
        expect((await fetch(`${server.baseUrl}/api/reports/AR-1/messages`, { headers: { cookie } })).status).toBe(200);
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

    it('a conversation, read or reply, is a 404 with the same reason; signed out is still a 401', async () => {
        const read = await fetch(`${server.baseUrl}/api/reports/AR-1/messages?seen=1`, { headers: { authorization: `Bearer ${token}` } });
        expect(read.status).toBe(404);
        expect((await read.json()).code).toBe('report_not_configured');
        const write = await fetch(`${server.baseUrl}/api/reports/AR-1/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hello' }) });
        expect(write.status).toBe(404);
        expect((await write.json()).code).toBe('report_not_configured');
        expect((await fetch(`${server.baseUrl}/api/reports/AR-1/messages`)).status).toBe(401);
    });
});
