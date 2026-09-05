// Plugin attribution on learning_events rows (migration 0055, RPS-1 §14.3).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDb } from '../utils/seedDb.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { resolvePluginAttribution, HOST_DELEGABLE_VERBS } from '../../server/shared/pluginRegistry.js';

const MIGRATION = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'migrations', '0055_learning_events_plugin_attribution.sql'), 'utf8',
);

let testDb;
let ingest;
let db;          // the app's dbAdapter, bound to the temp file
let sessionId;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'plugin-attr' });
    // Seed through the helper's own connection BEFORE the app singleton opens
    // a second one on the same file: two writers on one sqlite file under a
    // loaded suite is how this test hit SQLITE_BUSY. Every read and write
    // after this point goes through the singleton the ingest core uses.
    const c = await testDb.run(`INSERT INTO cases (name, description, system_prompt, config, tenant_id) VALUES ('A', '', 'p', '{}', 1)`);
    const u = await testDb.get(`SELECT id FROM users ORDER BY id LIMIT 1`);
    sessionId = (await testDb.run(`INSERT INTO sessions (case_id, user_id, status, tenant_id) VALUES (?, ?, 'active', 1)`, [c.lastID, u.id])).lastID;
    await new Promise((r) => testDb.db.close(() => r()));
    process.env.ROHY_DB = testDb.dbPath;
    ingest = await import('../../server/lib/learningEventIngest.js');
    db = (await import('../../server/dbAdapter.js')).default;
}, 60_000);
afterAll(async () => { await testDb?.cleanup?.(); });

describe('schema', () => {
    it('adds plugin_id and plugin_version and the partial index', async () => {
        const cols = (await db.all(`PRAGMA table_info(learning_events)`)).map((c) => c.name);
        expect(cols).toContain('plugin_id');
        expect(cols).toContain('plugin_version');
        const idx = (await db.all(`PRAGMA index_list(learning_events)`)).map((i) => i.name);
        expect(idx).toContain('idx_learning_events_plugin');
        expect(idx).toContain('idx_learning_events_tenant_time');
        expect(idx).toContain('idx_learning_events_tenant_verb');
    });

    it('the backfill names every installed plugin id (a newer plugin needs no backfill)', () => {
        const listed = MIGRATION.match(/room IN \(([^)]+)\)/)[1].match(/'([a-z0-9_]+)'/g).map((s) => s.replace(/'/g, ''));
        for (const m of PLUGIN_MANIFESTS) expect(listed, m.id).toContain(m.id);
    });

    it('the backfill is idempotent and fills plugin_id from room', async () => {
        await db.run(`INSERT INTO learning_events (session_id, user_id, verb, object_type, tenant_id, room, timestamp)
                          SELECT ?, user_id, 'OPENED_STUDY', 'imaging_study', 1, 'pacs', '2026-05-01T09:00:00.000Z' FROM sessions WHERE id = ?`, [sessionId, sessionId]);
        const update = MIGRATION.split('UPDATE learning_events')[1];
        await db.run('UPDATE learning_events' + update.split(';')[0]);
        await db.run('UPDATE learning_events' + update.split(';')[0]);
        const row = await db.get(`SELECT plugin_id, plugin_version FROM learning_events WHERE session_id = ? AND room = 'pacs'`, [sessionId]);
        expect(row.plugin_id).toBe('pacs');
        expect(row.plugin_version).toBeNull();
    });
});

describe('resolvePluginAttribution', () => {
    const pacs = PLUGIN_MANIFESTS.find((m) => m.id === 'pacs');

    it('accepts a declared verb and the shipped version', () => {
        const verb = Object.keys(pacs.vocabulary.verbs)[0];
        expect(resolvePluginAttribution('pacs', pacs.version, verb)).toEqual({ ok: true, pluginId: 'pacs', pluginVersion: String(pacs.version), versionMismatch: false });
    });
    it('stores NULL for a version the host does not ship, and says so', () => {
        const verb = Object.keys(pacs.vocabulary.verbs)[0];
        expect(resolvePluginAttribution('pacs', '99.0.0', verb)).toEqual({ ok: true, pluginId: 'pacs', pluginVersion: null, versionMismatch: true });
    });
    it('accepts a host-delegable verb for any plugin', () => {
        expect(HOST_DELEGABLE_VERBS).toContain('RAISED_ERROR');
        expect(resolvePluginAttribution('pacs', null, 'RAISED_ERROR').ok).toBe(true);
    });
    it('reports a stripping reason for an unknown plugin or a foreign verb', () => {
        expect(resolvePluginAttribution('nope', null, 'VIEWED')).toEqual({ ok: false, reason: 'unknown_plugin' });
        expect(resolvePluginAttribution('Bad Id', null, 'VIEWED')).toEqual({ ok: false, reason: 'unknown_plugin' });
        expect(resolvePluginAttribution('pacs', null, 'OPENED_SLIDE')).toEqual({ ok: false, reason: 'plugin_verb_mismatch' });
    });
});

describe('ingest', () => {
    it('writes plugin_id/plugin_version for a plugin row and defaults room to the plugin', async () => {
        const pacs = PLUGIN_MANIFESTS.find((m) => m.id === 'pacs');
        const verb = Object.keys(pacs.vocabulary.verbs)[0];
        const out = await ingest.ingestEvents({
            tenantId: 1, principal: null, source: 'batch',
            events: [{ session_id: sessionId, verb, object_type: 'imaging_study', plugin_id: 'pacs', plugin_version: pacs.version }],
        });
        expect(out.inserted).toBe(1);
        const row = await db.get(`SELECT * FROM learning_events WHERE id = ?`, [out.rowIds[0]]);
        expect(row.plugin_id).toBe('pacs');
        expect(row.plugin_version).toBe(String(pacs.version));
        expect(row.room).toBe('pacs');
    });

    it('a mismatched plugin/verb pair STRIPS the attribution and still inserts the row', async () => {
        const out = await ingest.ingestEvents({
            tenantId: 1, principal: null, source: 'batch',
            events: [{ session_id: sessionId, verb: 'OPENED_SLIDE', object_type: 'slide', plugin_id: 'pacs' }],
        });
        expect(out.inserted).toBe(1);
        expect(out.stripped_reasons.plugin_verb_mismatch).toBe(1);
        const row = await db.get(`SELECT * FROM learning_events WHERE id = ?`, [out.rowIds[0]]);
        expect(row.plugin_id).toBeNull();
        expect(row.verb).toBe('OPENED_SLIDE');
    });
});
