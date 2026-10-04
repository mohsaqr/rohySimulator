// Regression lock: case versions were numbered by a SELECT MAX then a separate INSERT, fire-and-forget after the response — quick saves could share a number and a History read right after a save could miss it (CI flake in case-gender-i18n.test.js, 2026-10-04)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

describe('case versions', () => {
    let server;
    let admin;
    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const token = await login(server.baseUrl, 'admin', 'admin123');
        admin = (path, init = {}) => fetch(`${server.baseUrl}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
        });
    }, 90_000);
    afterAll(async () => { if (server) await server.close(); });

    const save = (id, n) => admin(`/api/cases/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: `versions-${n}`, system_prompt: 'p', config: { patient_name: `P${n}` } }),
    });
    const versions = async (id) => (await (await admin(`/api/cases/${id}/versions`)).json()).versions;

    it('the version a save creates is listed as soon as the save answers', async () => {
        const created = await (await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({ name: 'versions-0', system_prompt: 'p', config: { patient_name: 'P0' } }),
        })).json();
        expect((await versions(created.id)).map((v) => v.version_number)).toEqual([1]);

        expect((await save(created.id, 1)).status).toBe(200);
        expect((await versions(created.id)).map((v) => v.version_number).sort((a, b) => a - b)).toEqual([1, 2]);
    });

    it('concurrent saves get distinct, consecutive version numbers', async () => {
        const created = await (await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({ name: 'versions-burst', system_prompt: 'p', config: { patient_name: 'B' } }),
        })).json();
        const results = await Promise.all([1, 2, 3, 4, 5].map((n) => save(created.id, n)));
        results.forEach((r) => expect(r.status).toBe(200));
        const numbers = (await versions(created.id)).map((v) => v.version_number).sort((a, b) => a - b);
        expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });
});
