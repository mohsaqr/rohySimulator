// The production 5xx shield (middleware/dbErrorShield.js + errorHandler.js).
//
// Regression lock: errorHandler answered every status — 500 included — with err.message, and ~236 handlers did res.status(500).json({ error: err.message }), so internal error text (paths, table names, dependency messages) reached the client in production; multer's oversize / wrong-type rejections answered 500 (security audit 2026-10-24)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import multer from 'multer';
import os from 'node:os';
import { dbErrorShield, shieldErrorBody, GENERIC_SERVER_ERROR } from '../../server/middleware/dbErrorShield.js';
import { errorHandler } from '../../server/middleware/errorHandler.js';

const LEAK = 'ENOENT: no such file or directory, open /opt/repos/rohy/server/secret.json';

function quietReq(extra = {}) {
    return { path: '/x', request_id: 'req-123', log: { error: vi.fn(), warn: vi.fn() }, ...extra };
}

describe('shieldErrorBody', () => {
    const prod = { NODE_ENV: 'production' };

    it('replaces a 5xx message in production with the generic text and the request id', () => {
        const req = quietReq();
        const out = shieldErrorBody({ status: 500, body: { error: LEAK, stack: 'at x', details: { a: 1 } }, req, env: prod });
        expect(out).toEqual({ status: 500, body: { error: GENERIC_SERVER_ERROR, request_id: 'req-123' } });
        // The original is not lost — it goes to the log at error level.
        expect(req.log.error).toHaveBeenCalledWith('server error answered generically', expect.objectContaining({ error: LEAK, status: 500 }));
    });

    it('keeps a machine-readable code', () => {
        const out = shieldErrorBody({ status: 502, body: { error: LEAK, code: 'upstream_failed' }, req: quietReq(), env: prod });
        expect(out.body).toEqual({ error: GENERIC_SERVER_ERROR, code: 'upstream_failed', request_id: 'req-123' });
    });

    it('leaves a 4xx message alone in production', () => {
        const body = { error: 'Case name is required' };
        expect(shieldErrorBody({ status: 400, body, req: quietReq(), env: prod })).toEqual({ status: 400, body });
    });

    it('leaves a 5xx message alone outside production', () => {
        const body = { error: LEAK };
        for (const NODE_ENV of ['development', 'test', undefined]) {
            expect(shieldErrorBody({ status: 500, body, req: quietReq(), env: { NODE_ENV } })).toEqual({ status: 500, body });
        }
    });

    it('is idempotent: an already-generic body is returned unchanged and not logged twice', () => {
        const req = quietReq();
        const first = shieldErrorBody({ status: 500, body: { error: LEAK }, req, env: prod });
        const second = shieldErrorBody({ status: 500, body: first.body, req, env: prod });
        expect(second).toEqual(first);
        expect(req.log.error).toHaveBeenCalledTimes(1);
    });

    it('still answers a busy sqlite database 503 retryable in every environment', () => {
        for (const env of [prod, { NODE_ENV: 'development' }]) {
            const out = shieldErrorBody({ status: 500, body: { error: 'SQLITE_BUSY: database is locked' }, req: quietReq(), env });
            expect(out.status).toBe(503);
            expect(out.body).toMatchObject({ code: 'DB_BUSY', retryable: true });
        }
    });

    it('ignores bodies without a string error', () => {
        expect(shieldErrorBody({ status: 500, body: { ok: false }, req: quietReq(), env: prod }).body).toEqual({ ok: false });
        expect(shieldErrorBody({ status: 500, body: null, req: quietReq(), env: prod }).body).toBeNull();
    });
});

// The same rule through real Express: a route answering 500 directly, a
// thrown error reaching errorHandler, and multer's rejections.
describe('shield + errorHandler through Express', () => {
    let server;
    let base;

    beforeAll(async () => {
        const app = express();
        app.use((req, res, next) => { req.request_id = 'rid-1'; next(); });
        app.use(dbErrorShield);
        app.get('/direct', (req, res) => res.status(500).json({ error: LEAK }));
        app.get('/thrown', () => { throw new Error(LEAK); });
        app.get('/client', (req, res) => res.status(404).json({ error: 'Case not found' }));
        const small = multer({
            dest: os.tmpdir(),
            limits: { fileSize: 8 },
            fileFilter: (req, file, cb) => {
                if (file.mimetype === 'image/png') return cb(null, true);
                const err = new Error('Invalid file type. Allowed: .png');
                err.status = 415;
                return cb(err, false);
            },
        });
        app.post('/upload', small.single('file'), (req, res) => res.json({ ok: true }));
        app.post('/upload-plain-filter', multer({
            dest: os.tmpdir(),
            fileFilter: (req, file, cb) => cb(new Error('Invalid file type. Allowed: .png'), false),
        }).single('file'), (req, res) => res.json({ ok: true }));
        app.use(errorHandler);
        server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));
    afterEach(() => vi.unstubAllEnvs());

    const getJson = async (p, init) => { const r = await fetch(base + p, init); return { status: r.status, body: await r.json() }; };
    const upload = (p, { type, bytes }) => {
        const form = new FormData();
        form.append('file', new Blob([Buffer.alloc(bytes, 1)], { type }), 'f.png');
        return getJson(p, { method: 'POST', body: form });
    };

    it('production: a route\'s own 500 and a thrown error both answer generically with the request id', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        for (const p of ['/direct', '/thrown']) {
            const { status, body } = await getJson(p);
            expect(status).toBe(500);
            expect(body).toEqual({ error: GENERIC_SERVER_ERROR, request_id: 'rid-1' });
            expect(JSON.stringify(body)).not.toContain('/opt/repos');
        }
    });

    it('production: 4xx keeps its message', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(await getJson('/client')).toEqual({ status: 404, body: { error: 'Case not found' } });
    });

    it('development: the developer still sees the real message', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        expect((await getJson('/direct')).body.error).toBe(LEAK);
        expect((await getJson('/thrown')).body.error).toBe(LEAK);
    });

    it('multer LIMIT_FILE_SIZE answers 413, not 500', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { status, body } = await upload('/upload', { type: 'image/png', bytes: 64 });
        expect(status).toBe(413);
        expect(body.code).toBe('LIMIT_FILE_SIZE');
    });

    it('a fileFilter type rejection answers 415 and keeps its explanation', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        for (const p of ['/upload', '/upload-plain-filter']) {
            const { status, body } = await upload(p, { type: 'text/html', bytes: 4 });
            expect(status).toBe(415);
            expect(body.error).toMatch(/Invalid file type/);
        }
    });
});
