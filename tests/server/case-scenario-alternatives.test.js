// QA ISSUE-0012 — a case may carry ALTERNATIVE evolutions
// (`scenario.alternatives[]`): other ways the patient can evolve, which the
// instructor picks from the monitor's Scenarios tab. They live inside the
// scenario JSON so the session snapshot / export / versions carry them for
// free. This file locks the write-side contract in cases-routes.js
// normaliseScenarioAlternatives().
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

const frame = (time, hr, rhythm) => ({ time, label: `t=${time}`, params: { hr, spo2: 96, rr: 18, bpSys: 120, bpDia: 80 }, rhythm });
const primary = { enabled: true, autoStart: false, timeline: [frame(0, 80), frame(600, 110)] };

describe('cases: scenario.alternatives (ISSUE-0012)', () => {
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

    const post = (scenario, name = 'alt-case') => admin('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
            name, description: 'lock', system_prompt: 'You are a patient.',
            config: { demographics: { gender: 'Female', age: 40 }, patient_name: 'Alt Patient' },
            scenario,
        }),
    });
    const stored = async (id) => { const j = await (await admin(`/api/cases/${id}`)).json(); return j.case ?? j; };

    it('stores alternatives fully resolved, assigns ids, canonicalises rhythms and drops unknown fields', async () => {
        const res = await post({
            ...primary,
            alternatives: [
                { name: 'Deteriorates', description: 'goes into shock', timeline: [frame(0, 80), frame(300, 130, 'nsr')], junk: true },
                { id: 'improves', name: 'Responds to treatment', timeline: [frame(0, 110), frame(300, 85)], source: { kind: 'template', id: 'x', extra: 1 } },
            ],
        });
        expect(res.status).toBe(200);
        const { id } = await res.json();
        const c = await stored(id);
        expect(c.scenario.timeline).toHaveLength(2);           // primary intact
        expect(c.scenario.alternatives).toHaveLength(2);
        const [a, b] = c.scenario.alternatives;
        expect(a.id).toBe('alt_1');                            // id assigned
        expect(a.name).toBe('Deteriorates');
        expect(a.description).toBe('goes into shock');
        expect(a.junk).toBeUndefined();                        // unknown fields dropped
        expect(a.timeline[1].rhythm).toBe('NSR');              // rhythm canonicalised, same path as the primary
        expect(b.id).toBe('improves');                         // caller id kept
        expect(b.source).toEqual({ kind: 'template', id: 'x' });
    });

    it('accepts alternatives with NO primary timeline (an instructor-triggered case)', async () => {
        const res = await post({ enabled: true, autoStart: false, timeline: [], alternatives: [{ name: 'Only path', timeline: [frame(0, 70)] }] });
        expect(res.status).toBe(200);
        const c = await stored((await res.json()).id);
        expect(c.scenario.timeline).toEqual([]);
        expect(c.scenario.alternatives.map(a => a.name)).toEqual(['Only path']);
    });

    it('makes duplicate ids unique instead of letting one shadow the other', async () => {
        const res = await post({ ...primary, alternatives: [
            { id: 'same', name: 'A', timeline: [frame(0, 70)] },
            { id: 'same', name: 'B', timeline: [frame(0, 90)] },
        ] });
        expect(res.status).toBe(200);
        const c = await stored((await res.json()).id);
        const ids = c.scenario.alternatives.map(a => a.id);
        expect(new Set(ids).size).toBe(2);
        expect(ids[0]).toBe('same');
    });

    it.each([
        ['not an array', { ...primary, alternatives: { name: 'x' } }],
        ['missing name', { ...primary, alternatives: [{ timeline: [frame(0, 70)] }] }],
        ['empty timeline', { ...primary, alternatives: [{ name: 'x', timeline: [] }] }],
        ['malformed frame', { ...primary, alternatives: [{ name: 'x', timeline: [{ time: -1 }] }] }],
        ['non-numeric param', { ...primary, alternatives: [{ name: 'x', timeline: [{ time: 0, params: { hr: 'fast' } }] }] }],
        ['too many', { ...primary, alternatives: Array.from({ length: 9 }, (_, i) => ({ name: `a${i}`, timeline: [frame(0, 70)] })) }],
    ])('rejects %s with 400 + code invalid_scenario_alternatives, never 500', async (_label, scenario) => {
        const res = await post(scenario);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('invalid_scenario_alternatives');
        expect(typeof body.error).toBe('string');
    });

    it('a case without alternatives is untouched (no key invented)', async () => {
        const res = await post(primary);
        expect(res.status).toBe(200);
        const c = await stored((await res.json()).id);
        expect(c.scenario).not.toHaveProperty('alternatives');
    });

    it('PUT round-trips alternatives and the session snapshot carries them', async () => {
        const created = await (await post({ ...primary, alternatives: [{ name: 'v1', timeline: [frame(0, 70)] }] })).json();
        const before = await stored(created.id);
        const put = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: before.name, description: before.description, system_prompt: before.system_prompt,
                config: before.config,
                scenario: { ...before.scenario, alternatives: [...before.scenario.alternatives, { name: 'v2', timeline: [frame(0, 95)] }] },
            }),
        });
        expect(put.status).toBe(200);
        expect((await stored(created.id)).scenario.alternatives.map(a => a.name)).toEqual(['v1', 'v2']);

        const start = await admin('/api/sessions', { method: 'POST', body: JSON.stringify({ case_id: created.id }) });
        expect(start.status).toBe(200);
        const { id: sessionId } = await start.json();
        const sess = await (await admin(`/api/sessions/${sessionId}`)).json();
        const snap = typeof sess.session.case_snapshot === 'string' ? JSON.parse(sess.session.case_snapshot) : sess.session.case_snapshot;
        expect(snap.scenario.alternatives.map(a => a.name)).toEqual(['v1', 'v2']);
    });
});
