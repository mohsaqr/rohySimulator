// Regression locks: security audit 2026-10-26
//   F-40 / L8-07 — the general /api limiter was keyed by IP, so one NAT'd
//     classroom shared one bucket; now per verified user, per IP when
//     anonymous (and a forged token buys no fresh bucket);
//   F-06 / L8-02 — /proxy/llm and /tts were skipped by routeTimeout entirely;
//     they now get a long but finite backstop.
// In-process express apps; limits are lowered through the env before import.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// requestPrincipal → middleware/auth.js → dbAdapter → db.js opens ROHY_DB at
// import time: point it at a throw-away file, NEVER the developer's
// server/database.sqlite (which it opens, migrates and seeds by default).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2c-limiters-'));
process.env.ROHY_DB = path.join(tmpDir, 'limiters.sqlite');
process.env.ROHY_NO_AUTO_SEED = '1';
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sec2-c-limiters-secret';
process.env.ROHY_GENERAL_USER_RATE_PER_MIN = '5';
process.env.ROHY_GENERAL_ANON_RATE_PER_MIN = '3';
delete process.env.ROHY_DISABLE_GENERAL_RATE_LIMIT;

const { createGeneralLimiter } = await import('../../server/lib/routeLimiters.js');
const { requireSignedToken } = await import('../../server/lib/requestPrincipal.js');
const { routeTimeout } = await import('../../server/middleware/routeTimeout.js');

const listen = (app) => new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
});
const tokenFor = (id, secret = process.env.JWT_SECRET) => jwt.sign({ id, tenant_id: 1, role: 'student' }, secret, { expiresIn: '1h' });

describe('general limiter keyed by user (F-40)', () => {
    let srv; let base;
    beforeAll(async () => {
        const app = express();
        app.use(createGeneralLimiter({ skip: () => false }));
        app.get('/x', (req, res) => res.json({ ok: true }));
        ({ srv, base } = await listen(app));
    });
    afterAll(() => new Promise((r) => srv.close(r)));

    const hit = (headers = {}) => fetch(`${base}/x`, { headers }).then((r) => r.status);
    const many = async (n, headers) => { const out = []; for (let i = 0; i < n; i += 1) out.push(await hit(headers)); return out; };

    // Regression lock: every signed-in user behind one IP shared one bucket (F-40 / L8-07)
    it('gives each signed-in user their own bucket behind one IP', async () => {
        const a = { authorization: `Bearer ${tokenFor(101)}` };
        const b = { authorization: `Bearer ${tokenFor(102)}` };
        expect(await many(5, a)).toEqual([200, 200, 200, 200, 200]);
        expect(await hit(a)).toBe(429);
        expect(await hit(b)).toBe(200);                 // same IP, other user: unaffected
        expect(await hit({ cookie: `rohy_auth=${tokenFor(103)}` })).toBe(200);
    });

    it('keeps an IP bucket for anonymous requests, which a forged token cannot escape', async () => {
        const forged = { authorization: `Bearer ${tokenFor(999, 'not-the-secret')}` };
        expect(await many(3, {})).toEqual([200, 200, 200]);
        expect(await hit(forged)).toBe(429);
        expect(await hit({})).toBe(429);
    });
});

describe('requireSignedToken (for large body parsers, L8-08)', () => {
    let srv; let base;
    beforeAll(async () => {
        const app = express();
        app.post('/big', requireSignedToken, express.json({ limit: '9mb' }), (req, res) => res.json({ size: JSON.stringify(req.body).length }));
        ({ srv, base } = await listen(app));
    });
    afterAll(() => new Promise((r) => srv.close(r)));

    it('refuses an unsigned request before its body is parsed', async () => {
        const body = JSON.stringify({ x: 'y'.repeat(1024) });
        expect((await fetch(`${base}/big`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
        const ok = await fetch(`${base}/big`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(5)}` }, body });
        expect(ok.status).toBe(200);
    });
});

describe('route timeout backstop for streaming paths (F-06)', () => {
    let srv; let base;
    beforeAll(async () => {
        const app = express();
        app.use(routeTimeout({ ms: 50, streamMs: 150 }));
        app.post('/proxy/llm', () => { /* never answers */ });
        app.post('/tts', (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.write('a'); /* then hangs */ });
        app.get('/plain', (req, res) => setTimeout(() => res.json({ late: true }), 100));
        ({ srv, base } = await listen(app));
    });
    afterAll(() => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); });

    // Regression lock: /proxy/llm and /tts were exempt from every route timeout (F-06 / L8-02)
    it('answers 504 on a stalled /proxy/llm after the stream backstop, not the short timeout', async () => {
        const started = Date.now();
        const res = await fetch(`${base}/proxy/llm`, { method: 'POST' });
        expect(res.status).toBe(504);
        expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    });

    it('cuts a stream that is still open past the backstop', async () => {
        const res = await fetch(`${base}/tts`, { method: 'POST' });
        expect(res.status).toBe(200);
        await expect(res.text()).rejects.toThrow();     // the socket is destroyed mid-body
    });

    it('keeps the short timeout for ordinary routes', async () => {
        expect((await fetch(`${base}/plain`)).status).toBe(504);
    });
});
