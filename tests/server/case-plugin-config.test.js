// RPS-1 §11a.3(4) — the server guard on a plugin's case document.
//
// `config[<pluginId>]` is the plugin's slice of the case: opaque to rohy,
// written by its editor, read by its room. This file locks the write side in
// cases-routes.js normaliseCaseForStorage() — and, just as importantly, locks
// the round trip the whole design depends on: the ordinary case save is the
// ONLY write, and everything else (GET, the session snapshot a learner's room
// is pinned to) carries the document for free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { DEFAULT_DOCUMENT_MAX_BYTES } from '../../server/shared/pluginDocument.js';

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

// A minimal pathology document in the shape Case Studio hands back. Only the
// parts the guard looks at matter here; the guard never reads inside.
const pathologyDoc = (over = {}) => ({
    manifest: {
        schemaVersion: '1.0.0',
        id: 'case-1',
        title: 'Breast core',
        slides: [{ id: 'slide-1', label: 'A1 — H&E', assetId: 'asset-1' }],
        ...over,
    },
    rubric: { id: 'rubric-1', activities: [] },
});

describe('cases: config[pluginId] — the plugin document guard', () => {
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

    const post = (config, name = `plugin-case-${Math.random().toString(36).slice(2, 8)}`) => admin('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
            name,
            description: 'lock',
            system_prompt: 'You are a patient.',
            config: {
                demographics: { gender: 'Female', age: 40 },
                patient_name: 'Plugin Patient',
                ...config,
            },
        }),
    });

    it('accepts a document and round-trips it through GET /cases/:id', async () => {
        const res = await post({ pathology: pathologyDoc() });
        expect(res.status).toBe(200);
        const created = await res.json();

        const read = await admin(`/api/cases/${created.id}`);
        expect(read.status).toBe(200);
        const stored = await read.json();
        const config = typeof stored.config === 'string' ? JSON.parse(stored.config) : stored.config;
        // Stored as a unit: the server never reads inside, so what comes back
        // is what went in, both halves of it.
        expect(config.pathology.manifest.title).toBe('Breast core');
        expect(config.pathology.rubric).toBeTruthy();
    });

    it('carries the document into the session snapshot a learner is pinned to', async () => {
        // This is what buys export/import, versions and per-learner pinning
        // with zero plugin code — the reason persistence goes through the case
        // save and nowhere else.
        const created = await (await post({ pathology: pathologyDoc() })).json();
        const session = await admin('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ case_id: created.id }),
        });
        expect(session.status).toBeLessThan(300);
        const { id } = await session.json();

        // POST returns the id; the snapshot is what was PERSISTED, so read it
        // back rather than trusting the response.
        const read = await admin(`/api/sessions/${id}`);
        expect(read.status).toBe(200);
        const { session: row } = await read.json();
        const snapshot = typeof row.case_snapshot === 'string'
            ? JSON.parse(row.case_snapshot) : row.case_snapshot;
        expect(snapshot?.config?.pathology?.manifest?.title).toBe('Breast core');
    });

    it('rejects a document that is not an object, with 400 and a code', async () => {
        for (const bad of ['not a document', 42, ['a', 'b']]) {
            const res = await post({ pathology: bad });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.code).toBe('invalid_plugin_config');
            expect(typeof body.error).toBe('string');
        }
    });

    it('rejects a document over the cap — never a 500', async () => {
        // Not hypothetical: gross photographs embedded as data: URLs put a real
        // Pathoyon case over this. Two 438x320 photographs measure ~83 KB.
        const oversize = pathologyDoc({ filler: 'x'.repeat(DEFAULT_DOCUMENT_MAX_BYTES) });
        const res = await post({ pathology: oversize });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('invalid_plugin_config');
        // The message must name the usual cause and the actual fix, or the
        // author is left staring at a number.
        expect(body.error).toMatch(/remote:/);
    });

    it('rejects a remote reference outside the plugin\'s declared paths', async () => {
        // The proxy already 403s this at read time. Failing at authoring time
        // tells the AUTHOR which field is wrong; failing at read time tells a
        // LEARNER their slide is broken.
        const res = await post({
            pathology: pathologyDoc({
                slides: [{ id: 'slide-1', label: 'A1', dzi: 'remote:secrets/creds.dzi' }],
            }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('invalid_plugin_config');
        expect(body.error).toMatch(/remote/i);
    });

    it('accepts a remote reference inside the declared paths', async () => {
        const res = await post({
            pathology: pathologyDoc({
                slides: [{ id: 'slide-1', label: 'A1', dzi: 'remote:tiles/case42/slide1.dzi' }],
            }),
        });
        expect(res.status).toBe(200);
    });

    it('leaves an absent key absent, and does not invent one', async () => {
        // "The host does not invent the key" (§11a.1) — an invented empty
        // document is exactly what lights a room onto nothing.
        const created = await (await post({})).json();
        const stored = await (await admin(`/api/cases/${created.id}`)).json();
        const config = typeof stored.config === 'string' ? JSON.parse(stored.config) : stored.config;
        expect(config.pathology).toBeUndefined();
    });

    it('treats an explicit null as "no material" rather than a malformed document', async () => {
        // This is how the wizard's Remove button clears a plugin from a case.
        const res = await post({ pathology: null });
        expect(res.status).toBe(200);
    });

    it('leaves config keys no manifest claims alone', async () => {
        // Unknown top-level keys belong to rohy or to a future plugin. Policing
        // them would make this guard a gate on the whole case shape.
        const res = await post({ some_other_tool: { anything: 'at all' } });
        expect(res.status).toBe(200);
    });
});
