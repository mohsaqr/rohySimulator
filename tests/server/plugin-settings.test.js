// RPS-1 1.4 — the settings slot.
//
// The host stores and validates plugin settings generically from the schema a
// manifest declares (server/shared/pluginSettings.js, migration 0048), closing
// the standard's §14.4 gap ("no per-tenant enable/disable") in a way the SECOND
// plugin also benefits from: a plugin gets an admin page by declaring fields,
// not by shipping a screen.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import {
    validateSettingsSchema, settingsDefaults, readSettings,
    mergeSettings, nestSettings, normalizeOrigin, visibleSettingKeys,
} from '../../server/shared/pluginSettings.js';
import { roleAllows } from '../../server/shared/pluginRegistry.js';
import { manifest as pathology } from '../../src/plugins/pathology/manifest.js';

/** A minimal well-formed schema, so each defect test changes exactly one thing. */
const ok = () => ({
    groups: [{ key: 'imports', labelKey: 'g' }],
    fields: {
        'imports.enabled': { type: 'boolean', default: false, labelKey: 'l' },
        'imports.maxBytes': { type: 'bytes', default: 1024, min: 512, max: 4096, labelKey: 'l' },
    },
});

describe('settings schema validation (gen time)', () => {
    it('accepts a well-formed schema and the real pathology manifest', () => {
        expect(() => validateSettingsSchema(ok(), 'test')).not.toThrow();
        expect(() => validateSettingsSchema(pathology.settings, 'pathology')).not.toThrow();
        expect(validateSettingsSchema(undefined, 'test')).toBeUndefined();
    });

    // The load-bearing one. A schema whose default violates its own constraint
    // fails OPEN: every tenant that never opens the settings page runs on a
    // value the page itself would refuse to save.
    it('rejects a default its own field rejects — the fail-open case', () => {
        const s = ok();
        s.fields['imports.maxBytes'].default = 999_999;
        expect(() => validateSettingsSchema(s, 'test'))
            .toThrow(/default its own constraints reject.*at most 4096/s);
    });

    it.each([
        ['an unknown type', (s) => { s.fields['imports.enabled'].type = 'colour'; }, /known types are/],
        ['no default', (s) => { delete s.fields['imports.enabled'].default; }, /has no default/],
        ['no labelKey', (s) => { delete s.fields['imports.enabled'].labelKey; }, /no labelKey/],
        ['a field naming an undeclared group', (s) => { s.fields['nope.x'] = { type: 'boolean', default: true, labelKey: 'l' }; }, /does not declare/],
        ['a numeric field with no range', (s) => { delete s.fields['imports.maxBytes'].min; }, /integer min and max/],
        ['min above max', (s) => { s.fields['imports.maxBytes'].min = 9000; }, /min 9000 above max/],
        ['an enum with no options', (s) => { s.fields['imports.enabled'] = { type: 'enum', default: 'a', labelKey: 'l' }; }, /declares no options/],
        ['ceilingEnv on a boolean', (s) => { s.fields['imports.enabled'].ceilingEnv = 'ROHY_X'; }, /not numeric/],
        ['allowlistEnv on a number', (s) => { s.fields['imports.maxBytes'].allowlistEnv = 'ROHY_PLUGIN_IMPORT_ORIGINS'; }, /not an 'origins' field/],
        ['an allowlistEnv the host does not define', (s) => { s.fields['imports.origins'] = { type: 'origins', default: [], labelKey: 'l', allowlistEnv: 'ROHY_MADE_UP' }; }, /host does not define/],
        ['a ceilingEnv the host does not define', (s) => { s.fields['imports.maxBytes'].ceilingEnv = 'ROHY_MADE_UP'; }, /host does not define/],
        ['no groups', (s) => { s.groups = []; }, /declares no groups/],
        ['an unknown top-level key', (s) => { s.extra = 1; }, /unknown key 'extra'/],
    ])('rejects %s', (_label, mutate, pattern) => {
        const s = ok();
        mutate(s);
        expect(() => validateSettingsSchema(s, 'test')).toThrow(pattern);
    });
});

describe('reading and merging', () => {
    it('a tenant with no row runs on the manifest defaults', () => {
        expect(readSettings(ok(), null)).toEqual({ 'imports.enabled': false, 'imports.maxBytes': 1024 });
        expect(settingsDefaults(pathology.settings)['imports.enabled']).toBe(false);
        expect(settingsDefaults(pathology.settings)['imports.allowedOrigins']).toEqual([]);
    });

    // What a plugin UPGRADE looks like from the database's point of view.
    it('drops a stored key the schema no longer declares, and falls back for a value it now rejects', () => {
        const stored = JSON.stringify({ 'imports.enabled': true, 'imports.maxBytes': 999_999, 'imports.gone': 7 });
        expect(readSettings(ok(), stored)).toEqual({ 'imports.enabled': true, 'imports.maxBytes': 1024 });
    });

    it('unparseable stored JSON reads as defaults rather than throwing', () => {
        expect(readSettings(ok(), '{not json')).toEqual(settingsDefaults(ok()));
    });

    // Regression lock: PUT is a key-presence MERGE, not the full replace that
    // /addons/oyon/settings is — an absent key must keep its stored value.
    it('merges by key presence: an absent key keeps its stored value', () => {
        const stored = { 'imports.enabled': true, 'imports.maxBytes': 2048 };
        const merged = mergeSettings(ok(), stored, { 'imports.enabled': false });
        expect(merged).toEqual({ ok: true, value: { 'imports.enabled': false, 'imports.maxBytes': 2048 } });
    });

    it('refuses an undeclared key instead of ignoring it', () => {
        expect(mergeSettings(ok(), {}, { 'imports.typo': 1 }))
            .toEqual({ ok: false, field: 'imports.typo', message: expect.stringMatching(/not a setting/) });
    });

    it('applies a host ceiling that the field max cannot widen', () => {
        expect(mergeSettings(ok(), {}, { 'imports.maxBytes': 4096 }, { 'imports.maxBytes': { ceiling: 2048 } }))
            .toMatchObject({ ok: false, field: 'imports.maxBytes', message: expect.stringMatching(/deployment's limit of 2048/) });
        expect(mergeSettings(ok(), {}, { 'imports.maxBytes': 2048 }, { 'imports.maxBytes': { ceiling: 2048 } }).ok).toBe(true);
    });

    // A tenant admin narrows the operator's list and can never widen it. The
    // reverse would be the SSRF hole proxy-routes.js already closed once: a
    // role inside one tenant choosing a host the SERVER will fetch from.
    it('an origins field is bounded by the operator allowlist, and an empty one means nowhere', () => {
        const schema = { groups: [{ key: 'imports', labelKey: 'g' }], fields: { 'imports.allowedOrigins': { type: 'origins', default: [], labelKey: 'l' } } };
        const bounded = { 'imports.allowedOrigins': { allowedOrigins: ['https://a.edu'] } };
        expect(mergeSettings(schema, {}, { 'imports.allowedOrigins': ['https://a.edu'] }, bounded).ok).toBe(true);
        expect(mergeSettings(schema, {}, { 'imports.allowedOrigins': ['https://evil.example'] }, bounded))
            .toMatchObject({ ok: false, field: 'imports.allowedOrigins', message: expect.stringMatching(/not among the origins this deployment allows/) });
        expect(mergeSettings(schema, {}, { 'imports.allowedOrigins': ['https://a.edu'] }, { 'imports.allowedOrigins': { allowedOrigins: [] } }))
            .toMatchObject({ ok: false, message: expect.stringMatching(/permits no import origins/) });
    });

    it('nests for a plugin that would rather read settings.imports.enabled', () => {
        expect(nestSettings({ 'imports.enabled': true, 'tiling.overlap': 1 }))
            .toEqual({ imports: { enabled: true }, tiling: { overlap: 1 } });
    });

    it('a field with no stated minRole is admin-only — the strictest reading of an omission', () => {
        expect(visibleSettingKeys(ok(), 'educator', roleAllows)).toEqual([]);
        expect(visibleSettingKeys(ok(), 'admin', roleAllows)).toHaveLength(2);
    });
});

describe('the origins type shares one rule with ROHY_PLUGIN_ORIGINS', () => {
    it.each([
        ['https://slides.example.edu/path', /no path, query or fragment/],
        ['https://u:p@slides.example.edu', /credentials in the URL/],
        ['ftp://slides.example.edu', /must be http or https/],
        ['not a url', /is not a URL/],
    ])('rejects %s', (value, pattern) => {
        expect(() => normalizeOrigin(value, 'origin')).toThrow(pattern);
    });

    it('normalises to scheme://host[:port] and refuses a duplicate', () => {
        expect(mergeSettings(
            { groups: [{ key: 'imports', labelKey: 'g' }], fields: { 'imports.allowedOrigins': { type: 'origins', default: [], labelKey: 'l' } } },
            {}, { 'imports.allowedOrigins': ['https://a.example.edu/'] },
        )).toEqual({ ok: true, value: { 'imports.allowedOrigins': ['https://a.example.edu'] } });
    });
});

// ---------------------------------------------------------------------------

function dbRun(dbPath, sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (e) => {
            if (e) return reject(e);
            db.run(sql, params, function done(err) { db.close(() => (err ? reject(err) : resolve(this))); });
        });
    });
}
async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}
const authed = (baseUrl, token) => (path, init = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
});

describe('GET/PUT /api/plugins/:pluginId/settings', () => {
    let server; let admin; let educator;

    beforeAll(async () => {
        server = await startTestServer({
            seed: false,
            env: {
                ROHY_PLUGIN_IMPORT_MAX_BYTES: String(8 * 1024 * 1024 * 1024),
                ROHY_PLUGIN_IMPORT_ORIGINS: 'pathology=https://openslide.cs.cmu.edu',
            },
        });
        const hash = await bcrypt.hash('Educator1!', 4);
        await dbRun(server.dbPath, `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, 'educator', 1, 'active')`,
            ['set-educator', 'set-educator', 'set-educator@example.com', hash]);
        admin = authed(server.baseUrl, await login(server.baseUrl, 'admin', 'admin123'));
        educator = authed(server.baseUrl, await login(server.baseUrl, 'set-educator', 'Educator1!'));
    }, 90_000);
    afterAll(async () => { await server?.close(); });

    it('returns the schema and the effective settings for a tenant that has never saved', async () => {
        const res = await admin('/api/plugins/pathology/settings');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.plugin).toBe('pathology');
        expect(body.schema.groups.map((g) => g.key)).toEqual(['imports', 'tiling', 'jobs']);
        expect(body.settings['imports.enabled']).toBe(false);
        expect(body.settings['imports.allowedOrigins']).toEqual([]);
        expect(body.settings['tiling.tileSize']).toBe(512);
    });

    it('persists a merge and leaves untouched keys alone', async () => {
        expect((await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'imports.enabled': true, 'imports.allowedOrigins': ['https://openslide.cs.cmu.edu'] }),
        })).status).toBe(200);
        const after = await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'tiling.jpegQuality': 90 }),
        });
        const body = await after.json();
        expect(body.settings['imports.enabled']).toBe(true);
        expect(body.settings['imports.allowedOrigins']).toEqual(['https://openslide.cs.cmu.edu']);
        expect(body.settings['tiling.jpegQuality']).toBe(90);
        // and it survives a re-read
        expect((await (await admin('/api/plugins/pathology/settings')).json()).settings['tiling.jpegQuality']).toBe(90);
    });

    // The plan's own worked examples, pinned.
    it.each([
        ['an origin with a path', { 'imports.allowedOrigins': ['https://a.edu/slides'] }, 'imports.allowedOrigins', /no path/],
        ['a tileSize off the enum', { 'tiling.tileSize': 300 }, 'tiling.tileSize', /must be one of/],
        ['an overlap out of range', { 'tiling.overlap': 5 }, 'tiling.overlap', /at most 2/],
        ['a non-integer quality', { 'tiling.jpegQuality': 85.5 }, 'tiling.jpegQuality', /must be an integer/],
        ['an unknown format', { 'imports.acceptedFormats': ['svs', 'exe'] }, 'imports.acceptedFormats', /not one of/],
        ['an origin the operator has not allowed', { 'imports.allowedOrigins': ['https://evil.example'] }, 'imports.allowedOrigins', /not among the origins this deployment allows/],
    ])('400s on %s, naming the field', async (_label, patch, field, pattern) => {
        const res = await admin('/api/plugins/pathology/settings', { method: 'PUT', body: JSON.stringify(patch) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toMatchObject({ code: 'plugin_setting_invalid', field });
        expect(body.error).toMatch(pattern);
    });

    // Regression lock: ROHY_PLUGIN_IMPORT_MAX_BYTES is the deployment's roof.
    // The manifest's own max is 16 GiB; this server is configured for 8.
    it('refuses a maxBytes above the deployment ceiling even though the manifest allows it', async () => {
        const res = await admin('/api/plugins/pathology/settings', {
            method: 'PUT', body: JSON.stringify({ 'imports.maxBytes': 12 * 1024 * 1024 * 1024 }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/deployment's limit/);
    });

    it('is admin-only: an educator sees 403, and an anonymous caller 401', async () => {
        expect((await educator('/api/plugins/pathology/settings')).status).toBe(403);
        expect((await educator('/api/plugins/pathology/settings', { method: 'PUT', body: JSON.stringify({ 'imports.enabled': true }) })).status).toBe(403);
        expect((await fetch(`${server.baseUrl}/api/plugins/pathology/settings`)).status).toBe(401);
    });

    it('an unknown plugin and a plugin with no settings slot answer the same 404', async () => {
        const res = await admin('/api/plugins/nope/settings');
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe('plugin_settings_unknown');
    });
});
