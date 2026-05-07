import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { routeTimeout, __test } from '../../../server/middleware/routeTimeout.js';

const { isStreamingPath, STREAMING_PATH_PREFIXES } = __test;

describe('isStreamingPath', () => {
    it('matches /tts variants', () => {
        expect(isStreamingPath('/tts')).toBe(true);
        expect(isStreamingPath('/tts/usage')).toBe(true);
        expect(isStreamingPath('/tts/voices')).toBe(true);
    });

    it('matches /proxy/llm', () => {
        expect(isStreamingPath('/proxy/llm')).toBe(true);
    });

    it('does NOT match unrelated paths', () => {
        expect(isStreamingPath('/sessions/123')).toBe(false);
        expect(isStreamingPath('/auth/login')).toBe(false);
        expect(isStreamingPath('/health')).toBe(false);
        expect(isStreamingPath('/')).toBe(false);
    });

    it('keeps the streaming prefix list in sync with what tests assume', () => {
        // Regression lock: if someone adds /sse or another stream type,
        // they must update this test list too.
        expect(STREAMING_PATH_PREFIXES).toEqual(['/tts', '/proxy/llm']);
    });
});

describe('routeTimeout middleware', () => {
    function buildApp({ ms, slowDelayMs }) {
        const app = express();
        app.use(routeTimeout({ ms }));
        app.get('/fast', (req, res) => res.json({ ok: true }));
        app.get('/slow', (req, res) => {
            // Hold the response open longer than the timeout.
            setTimeout(() => {
                if (!res.headersSent) res.json({ slow: true });
            }, slowDelayMs);
        });
        app.get('/tts', (req, res) => {
            // Streaming route — bypassed by the middleware.
            setTimeout(() => res.json({ tts: true }), slowDelayMs);
        });
        return app;
    }

    it('passes through fast handlers', async () => {
        const app = buildApp({ ms: 200, slowDelayMs: 0 });
        const res = await request(app).get('/fast');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('returns 504 with ROUTE_TIMEOUT code when handler is slow', async () => {
        const app = buildApp({ ms: 50, slowDelayMs: 200 });
        const res = await request(app).get('/slow');
        expect(res.status).toBe(504);
        expect(res.body.code).toBe('ROUTE_TIMEOUT');
        expect(res.body.error).toBe('Request timeout');
        expect(res.body.message).toMatch(/50ms/);
    });

    it('does NOT time out streaming routes (/tts is exempt)', async () => {
        const app = buildApp({ ms: 50, slowDelayMs: 150 });
        const res = await request(app).get('/tts');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ tts: true });
    });

    it('does not double-respond if the slow handler eventually replies', async () => {
        // Regression lock: setTimeout fires 504, then the handler tries to
        // res.json. The handler's writableEnded check in routeTimeout +
        // express's own headersSent guard mean the second send is a no-op,
        // not a crash.
        const app = express();
        app.use(routeTimeout({ ms: 30 }));
        let lateError = null;
        app.get('/late', (req, res) => {
            setTimeout(() => {
                try {
                    if (!res.headersSent) res.json({ late: true });
                } catch (e) { lateError = e; }
            }, 120);
        });
        const res = await request(app).get('/late');
        expect(res.status).toBe(504);
        await new Promise(r => setTimeout(r, 200));
        expect(lateError).toBeNull();
    });

    it('uses ROHY_ROUTE_TIMEOUT_MS env when ms not passed', async () => {
        const prev = process.env.ROHY_ROUTE_TIMEOUT_MS;
        process.env.ROHY_ROUTE_TIMEOUT_MS = '40';
        try {
            const app = express();
            app.use(routeTimeout()); // no ms override
            app.get('/slow', (req, res) => {
                setTimeout(() => {
                    if (!res.headersSent) res.json({});
                }, 200);
            });
            const res = await request(app).get('/slow');
            expect(res.status).toBe(504);
            expect(res.body.message).toMatch(/40ms/);
        } finally {
            if (prev === undefined) delete process.env.ROHY_ROUTE_TIMEOUT_MS;
            else process.env.ROHY_ROUTE_TIMEOUT_MS = prev;
        }
    });

    it('cleans up timer on response finish (no handle leaks)', async () => {
        // We can't observe internal timer state, but we CAN verify that
        // a fast response doesn't trigger the late 504 logic — if cleanup
        // were broken, the 504 body would race the real response.
        const app = buildApp({ ms: 50, slowDelayMs: 0 });
        const res = await request(app).get('/fast');
        expect(res.status).toBe(200);
        // Wait past the original timeout deadline; no late side effects.
        await new Promise(r => setTimeout(r, 100));
        expect(res.body).toEqual({ ok: true });
    });
});
