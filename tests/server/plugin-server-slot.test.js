// RPS-1 1.4 — the server slot: discovery, the narrowed context, and R24.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../utils/seedDb.js';

const SLOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'plugins');

let slot;
let testDb;

beforeAll(async () => {
    testDb = await createTestDb({ seed: true, label: 'plugin-slot' });
    process.env.ROHY_DB = testDb.dbPath;
    slot = await import('../../server/lib/pluginServerSlot.js');
}, 60_000);
afterAll(async () => { await testDb?.cleanup?.(); });
beforeEach(() => { slot.resetLibraryDirs(); });

describe('ROHY_PLUGIN_LIBRARY_DIRS', () => {
    it('parses one absolute directory per plugin', () => {
        expect([...slot.parseLibraryDirs('pathology=/srv/lib/pathology,ecg=/srv/lib/ecg')])
            .toEqual([['pathology', '/srv/lib/pathology'], ['ecg', '/srv/lib/ecg']]);
        expect(slot.parseLibraryDirs('').size).toBe(0);
        expect(slot.parseLibraryDirs(undefined).size).toBe(0);
    });

    // A relative path resolves against the process working directory, which
    // differs between a dev shell, a systemd unit and a Docker image — three
    // different directories for one config line.
    it.each([
        ['a relative path', 'pathology=srv/lib', /must be absolute/],
        ['no equals sign', '/srv/lib', /is not '<pluginId>=<absolute path>'/],
        ['a non-snake_case id', 'Pathology=/srv/lib', /lower_snake_case/],
        ['a duplicate plugin', 'pathology=/a,pathology=/b', /twice/],
    ])('refuses %s', (_label, raw, pattern) => {
        expect(() => slot.parseLibraryDirs(raw)).toThrow(pattern);
    });
});

describe('the narrowed context', () => {
    const manifest = { id: 'pathology', settings: undefined };

    it('reports no library directory when the operator configured none', () => {
        delete process.env.ROHY_PLUGIN_LIBRARY_DIRS;
        expect(slot.buildServerContext(manifest).libraryDir).toBeNull();
    });

    // Not an error, a refusal with a reason: a deployment that has not
    // provisioned disk for slides is a deployment that does not import slides.
    it('refuses to download when there is no library directory to write into', async () => {
        delete process.env.ROHY_PLUGIN_LIBRARY_DIRS;
        await expect(slot.buildServerContext(manifest).download({ tenantId: 1, url: 'https://a.edu/x.tif' }))
            .rejects.toThrow(/no library directory configured/);
    });

    it('namespaces job kinds by plugin id, so two plugins cannot collide on "import"', async () => {
        process.env.ROHY_PLUGIN_LIBRARY_DIRS = 'pathology=/srv/lib/pathology';
        slot.resetLibraryDirs();
        const jobs = await import('../../server/lib/pluginJobs.js');
        jobs.resetJobHandlers();
        const ctx = slot.buildServerContext(manifest);
        ctx.registerJob('import', async () => 'ok');
        // Registering the same bare kind for a second plugin must not collide.
        slot.buildServerContext({ id: 'ecg', settings: undefined }).registerJob('import', async () => 'ok');
        // ...but the same plugin twice still does.
        expect(() => ctx.registerJob('import', async () => 'ok')).toThrow(/Duplicate job handler/);
        jobs.resetJobHandlers();
    });
});

// RPS-1 §17 — the clock and the event API. Until these existed, a plugin's
// server work was invisible: a slide import that ran for four minutes wrote
// plugin_jobs rows and not one learning event, and plugin_jobs is not one of
// the Activity view's sources. Work nobody clicked through could not be seen.
describe('the clock and the event API', () => {
    // pathology's real manifest, so the vocabulary check is tested against the
    // verbs the plugin actually declares rather than a convenient fake.
    let manifests;
    beforeAll(async () => {
        ({ PLUGIN_MANIFESTS: manifests } = await import('../../server/shared/plugins/manifests.generated.js'));
    });

    const pathology = () => manifests.find((m) => m.id === 'pathology');

    it('ctx.now() returns the one contract shape', () => {
        const t = slot.buildServerContext({ id: 'pathology', settings: undefined }).now();
        expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('refuses a verb the plugin did not declare', async () => {
        const ctx = slot.buildServerContext(pathology());
        await expect(ctx.emit({ tenantId: 1, verb: 'LOGGED_IN', objectType: 'auth' }))
            .rejects.toThrow(/cannot emit 'LOGGED_IN': not in its manifest vocabulary/);
    });

    it('refuses every verb when the plugin declares no vocabulary at all', async () => {
        const ctx = slot.buildServerContext({ id: 'ecg', settings: undefined });
        await expect(ctx.emit({ tenantId: 1, verb: 'VIEWED', objectType: 'x' }))
            .rejects.toThrow(/declares no verbs/);
    });

    it('writes a learning event with the server clock and a plugin: component', async () => {
        const ctx = slot.buildServerContext(pathology());
        const verb = Object.keys(pathology().vocabulary.verbs)[0];
        await ctx.emit({ tenantId: 1, verb, objectType: 'slide', objectName: 'case 7' });

        const row = await testDb.get(
            'SELECT * FROM learning_events WHERE verb = ? ORDER BY id DESC LIMIT 1', [verb]
        );
        expect(row.object_name).toBe('case 7');
        expect(row.component).toBe('plugin:pathology');
        expect(row.room).toBe('pathology');
        // Server-stamped, in the contract shape — not the legacy default.
        expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        // Severity and category come from the plugin's own declared metadata,
        // the same resolution the browser ingest route uses.
        expect(row.severity).toBeTruthy();
        expect(row.category).toBeTruthy();
    });

    // The trinity rule the ingest route follows: user and case are DERIVED
    // from the session, never accepted from the caller. A plugin is not more
    // trusted than a browser here.
    it('refuses a session that is not in the given tenant', async () => {
        const ctx = slot.buildServerContext(pathology());
        const verb = Object.keys(pathology().vocabulary.verbs)[0];
        await expect(ctx.emit({ tenantId: 999, verb, objectType: 'slide', sessionId: 1 }))
            .rejects.toThrow(/not in tenant 999/);
    });
});

// R24 — a plugin's own tables are prefixed plugin_<id>_. Enforced here rather
// than by a runtime SQL guard: see pluginServerSlot.js's header.
describe('R24 — plugin tables are namespaced', () => {
    // Deliberately non-vacuous. There may be no server-slot plugins yet, and a
    // scan over zero files passing proves nothing — so the detector itself is
    // tested against fixtures first.
    it('detects a plugin reaching into a host table', () => {
        expect(slot.disallowedTables("db.get('SELECT * FROM users WHERE id = ?')", 'pathology')).toEqual(['users']);
        expect(slot.disallowedTables("db.run('UPDATE cases SET x = 1')", 'pathology')).toEqual(['cases']);
        expect(slot.disallowedTables("db.run('INSERT INTO plugin_pathology_slides VALUES (?)')", 'pathology')).toEqual([]);
        expect(slot.disallowedTables("db.get('SELECT * FROM plugin_assets')", 'pathology')).toEqual([]);
        expect(slot.disallowedTables("db.all('SELECT a FROM plugin_pathology_x JOIN sessions ON 1')", 'pathology')).toEqual(['sessions']);
        // Prose is not SQL: a comment saying "imported from a link" or "update
        // the row" must not be reported as tables called 'a' and 'the'.
        expect(slot.disallowedTables('// imported from a link, then update the row', 'pathology')).toEqual([]);
        expect(slot.disallowedTables('/** Select rows from a catalogue. */', 'pathology')).toEqual([]);
        // An upsert ends 'ON CONFLICT (id) DO UPDATE SET …', so a naive scan
        // reports a table called 'set'.
        expect(slot.disallowedTables("db.run('INSERT INTO plugin_assets (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET state = 1')", 'pathology')).toEqual([]);
    });

    it('every shipped plugin server module obeys it', async () => {
        if (!existsSync(SLOT_DIR)) return;
        const dirs = (await readdir(SLOT_DIR, { withFileTypes: true })).filter((e) => e.isDirectory());
        for (const dir of dirs) {
            const file = join(SLOT_DIR, dir.name, 'index.js');
            if (!existsSync(file)) continue;
            const source = await readFile(file, 'utf8');
            expect({ plugin: dir.name, tables: slot.disallowedTables(source, dir.name) })
                .toEqual({ plugin: dir.name, tables: [] });
        }
    });
});

describe('discovery is peaceful', () => {
    // The client registry's property, preserved on the server: deleting a
    // plugin directory leaves a bootable app. A plugin that can take the server
    // down at boot is not a plugin, it is a dependency.
    it('an empty or absent server/plugins directory mounts nothing and throws nothing', async () => {
        const express = (await import('express')).default;
        const report = await slot.mountPluginServerSlots(express.Router());
        // No server-slot plugins ship yet; every entry present must at least
        // have been REPORTED rather than thrown.
        expect(Array.isArray(report)).toBe(true);
        report.forEach((r) => expect(r).toMatchObject({ id: expect.any(String), ok: expect.any(Boolean), reason: expect.any(String) }));
    });
});
