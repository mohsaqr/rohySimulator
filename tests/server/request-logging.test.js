import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import requestIdMiddleware from '../../server/middleware/requestId.js';
import requestLoggerMiddleware from '../../server/middleware/requestLogger.js';

let stdoutSpy;
let stderrSpy;
let originalEnv;

function captureStdout() {
    const writes = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return {
        entries() {
            return writes
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        }
    };
}

function makeApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(requestLoggerMiddleware());
    app.use(express.json());
    app.post('/api/unit', (req, res) => {
        req.user = { id: 42, tenant_id: 7 };
        req.log.info('route log', { component_hint: 'unit' });
        res.status(201).json({ ok: true });
    });
    app.get('/health', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('request logging middleware', () => {
    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.LOG_FORMAT = 'json';
        process.env.LOG_LEVEL = 'debug';
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        stdoutSpy?.mockRestore();
        stderrSpy?.mockRestore();
        process.env = originalEnv;
    });

    it('emits one structured access log with correlation and byte counts', async () => {
        const cap = captureStdout();
        const response = await request(makeApp())
            .post('/api/unit?x=1')
            .set('X-Request-Id', 'client_req_123')
            .send({ hello: 'world' });

        expect(response.status).toBe(201);
        expect(response.headers['x-request-id']).toBe('client_req_123');

        const access = cap.entries().filter((entry) => entry.component === 'access');
        expect(access).toHaveLength(1);
        expect(access[0]).toEqual(expect.objectContaining({
            msg: 'request completed',
            request_id: 'client_req_123',
            method: 'POST',
            path: '/api/unit?x=1',
            status: 201,
            user_id: 42,
            tenant_id: 7,
        }));
        expect(access[0].duration_ms).toEqual(expect.any(Number));
        expect(access[0].bytes_in).toBeGreaterThan(0);
        expect(access[0].bytes_out).toBeGreaterThan(0);
        expect(access[0]).not.toHaveProperty('body');
    });

    it('attaches req.log with the same request id for nested route logs', async () => {
        const cap = captureStdout();
        await request(makeApp())
            .post('/api/unit')
            .set('X-Request-Id', 'nested_req_123')
            .send({ hello: 'world' });

        const routeLog = cap.entries().find((entry) => entry.msg === 'route log');
        expect(routeLog).toEqual(expect.objectContaining({
            component: 'request',
            request_id: 'nested_req_123',
            component_hint: 'unit',
        }));
    });

    it('skips configured health paths', async () => {
        const cap = captureStdout();
        await request(makeApp()).get('/health');
        expect(cap.entries().filter((entry) => entry.component === 'access')).toHaveLength(0);
    });
});
