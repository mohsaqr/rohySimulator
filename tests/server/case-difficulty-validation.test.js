// A stale client/import must receive a field error, not a leaked SQLite CHECK.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

describe('case difficulty validation', () => {
    let server;
    let admin;
    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const login = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' }),
        });
        expect(login.status).toBe(200);
        const { token } = await login.json();
        admin = (path, init = {}) => fetch(`${server.baseUrl}${path}`, {
            ...init,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        });
    }, 90_000);
    afterAll(async () => { if (server) await server.close(); });

    const body = (difficulty) => ({
        name: 'Difficulty regression patient',
        system_prompt: 'You are a patient.',
        config: { demographics: { gender: 'Female', age: 40 }, difficulty_level: difficulty },
    });
    const create = (difficulty) => admin('/api/cases', { method: 'POST', body: JSON.stringify(body(difficulty)) });

    it.each(['beginner', 'intermediate', 'advanced', null, undefined, ''])('accepts supported or absent difficulty %s', async (difficulty) => {
        const response = await create(difficulty);
        expect(response.status).toBe(200);
        const { id } = await response.json();
        const saved = await (await admin(`/api/cases/${id}`)).json();
        expect(saved.difficulty_level).toBe(difficulty || null);
    });

    it.each(['medium', 'easy', 'INTERMEDIATE', 1, false, {}, []])('rejects invalid difficulty %j without a database error', async (difficulty) => {
        const response = await create(difficulty);
        expect(response.status).toBe(400);
        const error = await response.json();
        expect(error.code).toBe('invalid_difficulty_level');
        expect(error.error).not.toMatch(/SQLITE|CHECK constraint/);
    });

    it('rejects an invalid update without changing the stored case or difficulty', async () => {
        const { id } = await (await create('beginner')).json();
        const invalid = body('medium');
        invalid.name = 'Must not persist';
        const response = await admin(`/api/cases/${id}`, { method: 'PUT', body: JSON.stringify(invalid) });
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe('invalid_difficulty_level');
        const saved = await (await admin(`/api/cases/${id}`)).json();
        expect(saved.name).toBe('Difficulty regression patient');
        expect(saved.difficulty_level).toBe('beginner');
        expect(saved.config.difficulty_level).toBe('beginner');
    });
});
