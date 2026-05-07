import { describe, expect, it, beforeEach, vi } from 'vitest';

// Audit #25: lock the URL-resolution behaviour of src/config/api.js across
// the build configs that ship rohy. The module reads import.meta.env.BASE_URL
// at import time, so each test re-imports the module with a different
// env to exercise the dev / prod / Tauri-style sub-path matrix.

async function loadApiWith(baseUrl) {
    vi.resetModules();
    if (baseUrl === undefined) {
        delete import.meta.env.BASE_URL;
    } else {
        import.meta.env.BASE_URL = baseUrl;
    }
    // Re-import via static path; resetModules() gives us a fresh
    // module instance that reads the just-mutated env.
    return await import('./api.js');
}

describe('config/api — apiUrl', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('default BASE_URL ("/"): apiUrl prefixes /api', async () => {
        const { apiUrl } = await loadApiWith('/');
        expect(apiUrl('/sessions')).toBe('/api/sessions');
        expect(apiUrl('sessions')).toBe('/api/sessions'); // missing leading slash gets one
    });

    it('Vite default BASE_URL ("/"): apiUrl strips trailing slash', async () => {
        const { apiUrl } = await loadApiWith('/');
        expect(apiUrl('/cases')).toBe('/api/cases');
    });

    it('sub-path BASE_URL ("/rohy/"): apiUrl mounts /api under the prefix', async () => {
        // Production deploy path: the app is served from /rohy/ on a host
        // that also serves other apps. /api needs to live under that prefix
        // so the same-origin assumption in cors-config.js holds.
        const { apiUrl } = await loadApiWith('/rohy/');
        expect(apiUrl('/sessions')).toBe('/rohy/api/sessions');
        expect(apiUrl('cases')).toBe('/rohy/api/cases');
    });

    it('sub-path without trailing slash ("/rohy") works the same', async () => {
        const { apiUrl } = await loadApiWith('/rohy');
        expect(apiUrl('/sessions')).toBe('/rohy/api/sessions');
    });
});

describe('config/api — baseUrl', () => {
    beforeEach(() => { vi.unstubAllGlobals(); });

    it('default BASE_URL: baseUrl returns root-relative paths', async () => {
        const { baseUrl } = await loadApiWith('/');
        expect(baseUrl('/avatars/heads/manifest.json')).toBe('/avatars/heads/manifest.json');
    });

    it('sub-path BASE_URL: baseUrl prepends the prefix', async () => {
        const { baseUrl } = await loadApiWith('/rohy/');
        expect(baseUrl('/avatars/heads/manifest.json')).toBe('/rohy/avatars/heads/manifest.json');
    });
});

describe('config/api — default export', () => {
    beforeEach(() => { vi.unstubAllGlobals(); });

    it('default export aliases apiUrl as both .url and .apiUrl', async () => {
        const mod = await loadApiWith('/');
        expect(mod.default.apiUrl).toBe(mod.apiUrl);
        expect(mod.default.url).toBe(mod.apiUrl);
        expect(mod.default.baseUrl).toBe(mod.baseUrl);
    });
});
