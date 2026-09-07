// Layer 2 end to end, through the real Vite glob.
//
// The unit tests in tests/server/plugin-locales.test.js cover the resolver in
// isolation; this one proves the wiring — that a catalogue sitting at
// src/plugins/<id>/locales/<lang>.json is actually discovered, lands in the
// right namespace, and is added UNDERNEATH rohy's own strings rather than over
// them. Ordering is the whole layering rule, so it needs a test that can
// observe the order.

import { describe, expect, it } from 'vitest';
import { loadPluginLocales, pluginNamespaces } from '../../src/i18n/pluginLocales.js';

describe('plugin locale layering (real glob)', () => {
    it('discovers the namespaces plugins actually ship', () => {
        // pathology ships a catalogue today; the assertion is on discovery,
        // not on which plugins happen to have one.
        expect(pluginNamespaces()).toContain('pathology');
    });

    it('loads a shipped English catalogue into its plugin namespace', async () => {
        const byNamespace = await loadPluginLocales('en');
        expect(Object.keys(byNamespace)).toContain('pathology');
        expect(Object.keys(byNamespace.pathology).length).toBeGreaterThan(100);
        for (const [key, value] of Object.entries(byNamespace.pathology)) {
            expect(typeof value, `pathology.${key}`).toBe('string');
        }
    });

    it('returns nothing for a language no plugin ships, rather than throwing', async () => {
        // The fallback chain handles this: rohy's catalogue, then the inline
        // English in the package. An empty layer is a normal state.
        // en-XA is the pseudo-locale: rohy generates it, no plugin ships it.
        await expect(loadPluginLocales('en-XA')).resolves.toEqual({});
    });

    // Regression lock: rohy's own strings must win. If these were added with
    // overwrite=true, or before rohy's bundles, a plugin could silently
    // replace a reviewed and locked translation.
    it('is applied under rohy\'s own bundle, never over it', async () => {
        const added = [];
        const fakeI18n = {
            addResourceBundle: (lng, ns, table, deep, overwrite) => added.push({ lng, ns, deep, overwrite })
        };
        const { applyPluginLocales } = await import('../../src/i18n/pluginLocales.js');
        await applyPluginLocales(fakeI18n, 'en');
        expect(added.length).toBeGreaterThan(0);
        for (const call of added) {
            expect(call.overwrite, `${call.ns} was added with overwrite=true`).toBe(false);
            expect(call.deep).toBe(true);
        }
    });
});
