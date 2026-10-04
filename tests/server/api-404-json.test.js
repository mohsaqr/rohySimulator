// Regression lock: an unknown /api path returned Express's HTML 404 instead of the { error } shape every API caller reads (QA 2026-10-04, PRV-38)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

describe('unknown /api paths', () => {
    let server;
    beforeAll(async () => { server = await startTestServer({ seed: false }); }, 60_000);
    afterAll(async () => { await server?.close(); });

    it.each(['GET', 'POST'])('%s answers 404 with a JSON { error }', async (method) => {
        const res = await fetch(`${server.baseUrl}/api/definitely-not-a-route`, { method });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toMatch(/application\/json/);
        const body = await res.json();
        expect(typeof body.error).toBe('string');
        expect(body.code).toBe('not_found');
    });

    it('leaves real routes alone', async () => {
        const res = await fetch(`${server.baseUrl}/api/platform-settings/language`);
        expect(res.status).toBe(200);
    });
});
