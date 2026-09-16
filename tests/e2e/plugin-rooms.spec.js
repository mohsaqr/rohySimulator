// Plugin content — the server side of the PLUGIN.* cases in prova/rohy-cases.yaml.
//
// A machine can judge whether content is reachable, whether an absent deployment
// says something actionable, and whether the content route leaks the plugin
// inventory. Whether the image is diagnostic or the slide is sharp is a person's
// job, and stays manual in the catalogue.
//
// Verified route behaviour (probed against a real server, 2026-09-16):
//   GET /api/plugins/pacs/catalog        200 {plugin, catalog{version, name, …}}
//   GET /api/plugins/pacs/catalog.json   403 plugin_remote_undeclared_path
//   GET /api/plugins/nosuchplugin/x      404 plugin_remote_unknown
//   GET (unauthenticated)                401 Access token required
// There is deliberately NO `GET /api/plugins` listing route.
//
// The room GATES themselves (does the ECG tab appear for this case?) live in the
// client plugin registry and are covered by the client unit suite; what is
// pinned here is the server contract those rooms depend on.

import { test, expect } from './fixtures/index.js';
import { apiAsAdmin, waitForSeed } from './fixtures/seed.js';

test.describe('plugin content', () => {
    test.beforeAll(async ({ baseURL }) => {
        await waitForSeed(baseURL);
    });

    test('an installed plugin serves its catalogue, or explains how to install it', async ({ baseURL }) => {
        const api = await apiAsAdmin(baseURL);
        const res = await api.get('/api/plugins/pacs/catalog');

        if (res.status() === 503) {
            // server/plugin-content/ is gitignored and built by `npm run setup:content`,
            // which the Dockerfile never runs — a container deployment legitimately
            // has no content. What it must never do is refuse without saying why.
            const body = await res.json();
            expect(body.code).toBe('plugin_remote_not_configured');
            expect(body.error).toMatch(/setup:content/);
            expect(body.error).toMatch(/ROHY_PLUGIN_ORIGINS/);
            return;
        }

        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.plugin).toBe('pacs');
        expect(body.catalog).toBeTruthy();
        expect(typeof body.catalog.name).toBe('string');
    });

    test('a 12-lead ECG is not carried in the imaging archive', async ({ baseURL }) => {
        // Regression lock (beta.37): `ecg_12lead` has modality "Cardiac", so it
        // counted as an imaging order and opened PACS — a reading room with
        // nothing to read. The ECG room reads an authored recording instead and
        // ignores orders entirely.
        const api = await apiAsAdmin(baseURL);
        const res = await api.get('/api/plugins/pacs/catalog');
        test.skip(res.status() === 503, 'no PACS content installed on this deployment');

        const body = await res.json();
        expect(JSON.stringify(body.catalog)).not.toMatch(/ecg_12lead/);
    });

    test('the content route serves only the paths a plugin declared', async ({ baseURL }) => {
        // The proxy is an allowlist, not a pass-through: a plugin exposes the
        // paths it declared and nothing else, so a compromised or careless
        // plugin cannot turn the host into an open file proxy.
        const api = await apiAsAdmin(baseURL);
        const res = await api.get('/api/plugins/pacs/catalog.json');

        expect(res.status()).toBe(403);
        expect((await res.json()).code).toBe('plugin_remote_undeclared_path');
    });

    test('the catalogue route does not reveal which plugins are installed', async ({ baseURL }) => {
        // An INSTALLED plugin that ships no catalogue and a plugin that does not
        // exist must be byte-for-byte the same answer, or this route becomes an
        // inventory oracle for anyone holding a student account.
        // `ecg` is installed here and ships no catalogue (it reads an authored
        // recording from the case instead); `nosuchplugin` has never existed.
        const api = await apiAsAdmin(baseURL);
        const installedWithoutCatalogue = await api.get('/api/plugins/ecg/catalog');
        const neverExisted = await api.get('/api/plugins/nosuchplugin/catalog');

        expect(installedWithoutCatalogue.status()).toBe(404);
        expect(neverExisted.status()).toBe(installedWithoutCatalogue.status());
        expect(await neverExisted.json()).toEqual(await installedWithoutCatalogue.json());
        expect((await neverExisted.json()).code).toBe('plugin_catalog_unknown');
    });

    test('plugin content is refused to an unauthenticated caller', async ({ request }) => {
        const res = await request.get('/api/plugins/pacs/catalog');
        expect(res.ok()).toBe(false);
        expect([401, 403]).toContain(res.status());
    });
});
