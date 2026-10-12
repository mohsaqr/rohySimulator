// A route that answers after its 504 has gone out must not throw. It used to
// raise "Cannot set headers after they are sent" from inside the handler's
// callback — an uncaught exception per late request under load (rc.47).
import { describe, it, expect } from 'vitest';
import express from 'express';
import { routeTimeout } from '../../server/middleware/routeTimeout.js';

describe('a route that answers after its timeout', () => {
    it('gets a 504, and its late answer is dropped without throwing', async () => {
        // Regression lock: the late res.json() threw ERR_HTTP_HEADERS_SENT after the 504
        const thrown = [];
        const app = express();
        app.use(routeTimeout({ ms: 50 }));
        let lateDone;
        const late = new Promise((resolve) => { lateDone = resolve; });
        app.get('/slow', (req, res) => {
            setTimeout(() => {
                try {
                    res.status(200).json({ ok: true });
                    res.set('x-late', '1').send('again');
                } catch (err) {
                    thrown.push(err.code || err.message);
                }
                lateDone();
            }, 150);
        });
        const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        try {
            const res = await fetch(`http://127.0.0.1:${server.address().port}/slow`);
            expect(res.status).toBe(504);
            expect((await res.json()).code).toBe('ROUTE_TIMEOUT');
            await late;
            expect(thrown).toEqual([]);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
