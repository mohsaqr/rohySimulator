import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

describe('platform monitor visibility settings', () => {
    let server;
    let adminToken;
    let studentToken;
    const flags = ['showTimer', 'showECG', 'showSpO2', 'showBP', 'showRR', 'showTemp', 'showCO2', 'showPleth', 'showNumerics'];
    const get = async () => {
        const response = await fetch(`${server.baseUrl}/api/platform-settings/monitor`);
        expect(response.status).toBe(200);
        return response.json();
    };
    const save = (body, token = adminToken) => fetch(`${server.baseUrl}/api/platform-settings/monitor`, {
        method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });

    beforeAll(async () => {
        server = await startTestServer();
        const login = async username => {
            const response = await fetch(`${server.baseUrl}/api/auth/login`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username, password: `${username}123` }),
            });
            expect(response.status).toBe(200);
            return (await response.json()).token;
        };
        adminToken = await login('admin');
        studentToken = await login('student');
    });
    afterAll(async () => { await server?.close(); });

    it('round-trips every visibility flag and preserves flags omitted from a later save', async () => {
        const disabled = Object.fromEntries(flags.map(key => [key, false]));
        expect((await save(disabled)).status).toBe(200);
        expect(await get()).toEqual(disabled);
        expect((await save({ showECG: true })).status).toBe(200);
        expect(await get()).toEqual({ ...disabled, showECG: true });
        const enabled = Object.fromEntries(flags.map(key => [key, true]));
        expect((await save(enabled)).status).toBe(200);
        expect(await get()).toEqual(enabled);
    });

    it.each(['false', 0, null, {}, []])('rejects invalid flag %j before any valid sibling flag is saved', async value => {
        const before = await get();
        const response = await save({ showECG: !before.showECG, showTimer: value });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'invalid_monitor_setting', field: 'showTimer' });
        expect(await get()).toEqual(before);
    });

    it('rejects learner writes without changing monitor settings', async () => {
        const before = await get();
        expect((await save({ showECG: !before.showECG }, studentToken)).status).toBe(403);
        expect(await get()).toEqual(before);
    });
});
