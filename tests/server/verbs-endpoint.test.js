// GET /api/learning-events/verbs — authenticated, and carrying the facets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { REQUIRED_FACETS } from '../../server/shared/learningVerbFacets.js';

const PASSWORD = 'VerbsEndp0int!';

describe('GET /learning-events/verbs', () => {
    let server, token;
    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const sqlite = sqlite3.verbose();
        const db = await new Promise((resolve, reject) => {
            const d = new sqlite.Database(server.dbPath, (err) => err ? reject(err) : resolve(d));
        });
        const hash = await bcrypt.hash(PASSWORD, 4);
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES ('verbs-user', 'v', 'v@example.com', ?, 'student', 1, 'active')`,
            [hash], (err) => err ? reject(err) : resolve()));
        await new Promise((r) => db.close(() => r()));
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'verbs-user', password: PASSWORD }),
        });
        token = (await res.json()).token;
    }, 90_000);
    afterAll(async () => { if (server) await server.close(); });

    it('refuses an anonymous caller', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/verbs`);
        expect(res.status).toBe(401);
    });

    it('returns verbs, metadata with every facet, and aliases', async () => {
        const res = await fetch(`${server.baseUrl}/api/learning-events/verbs`, { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.verbs)).toBe(true);
        expect(body.verbs).toContain('ORDERED_LAB');
        for (const verb of body.verbs) {
            const m = body.metadata[verb];
            expect(m, verb).toBeTruthy();
            for (const field of REQUIRED_FACETS) expect(m[field], `${verb}.${field}`).toBeDefined();
            expect(m).toHaveProperty('tnaMerge');
            expect(m).toHaveProperty('pulseBucket');
            expect(m).toHaveProperty('domain');
        }
        expect(body.aliases.ORDERED_MEDICATION.to).toBe('ORDERED_TREATMENT');
    });
});
