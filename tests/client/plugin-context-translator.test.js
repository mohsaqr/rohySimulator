// Regression lock: ctx.t must reach the plugin's OWN locale namespace.
//
// Plugin-shipped catalogues (src/plugins/<id>/locales/<lang>.json) are loaded
// into the namespace localeNamespaceOf(manifest) gives them, but the host used
// to hand every plugin the bare default-namespace `t`. A package asking for a
// PLAIN key (`slide_label`) therefore looked up `common:slide_label`, missed,
// and rendered its inline English — the shipped catalogue was unreachable, and
// nothing failed. createPluginContext now binds [pluginNs, 'common'], so plain
// keys resolve from the plugin's catalogue and prefixed keys a plugin keeps in
// rohy's common catalogue (radoyon_*) still resolve.
import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { setAppLanguage } from '../../src/i18n/index.js';
import { createPluginContext } from '../../src/plugins/context.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import pathologyEn from '../../src/plugins/pathology/locales/en.json';
import ecgEn from '../../src/plugins/ecg/locales/en.json';
import pathologyDe from '../../src/plugins/pathology/locales/de.json';
import ecgKk from '../../src/plugins/ecg/locales/kk.json';

const ctxFor = (id) => createPluginContext({
    manifest: PLUGIN_MANIFESTS.find((m) => m.id === id),
    session: { examMode: false },
    caseConfig: {},
    eventLogger: {},
    t: i18n.t.bind(i18n),
    navigate: () => {},
});

// A key the plugin ships and rohy's common catalogue does NOT shadow, so the
// only place it can come from is the plugin namespace.
const unshadowedKey = (table) =>
    Object.keys(table).find((k) => !(k in i18n.getResourceBundle('en', 'common')));

describe('createPluginContext binds t to the plugin namespace', () => {
    beforeAll(async () => {
        await i18n.changeLanguage('en');
        // English plugin bundles are applied asynchronously at module load.
        await new Promise((resolve) => setTimeout(resolve, 300));
    });

    it('pathology: a plain key resolves from the shipped catalogue', () => {
        const key = unshadowedKey(pathologyEn);
        expect(ctxFor('pathology').t(key, 'FALLBACK')).toBe(pathologyEn[key]);
    });

    it('ecg: a plain key resolves from the shipped catalogue', () => {
        const key = unshadowedKey(ecgEn);
        expect(ctxFor('ecg').t(key, 'FALLBACK')).toBe(ecgEn[key]);
    });

    it('pacs: prefixed keys kept in rohy\'s common catalogue still resolve', () => {
        expect(ctxFor('pacs').t('radoyon_accession', 'FALLBACK')).toBe(i18n.t('radoyon_accession'));
    });

    it('an unknown key falls through to the inline English', () => {
        expect(ctxFor('ecg').t('no_such_key_zz', 'Inline')).toBe('Inline');
    });

    it('values reach the message (i18next third-argument shape)', () => {
        const key = Object.keys(ecgEn).find((k) => /\{[a-z_]+\}/.test(ecgEn[k]) && !/plural/.test(ecgEn[k]));
        const arg = ecgEn[key].match(/\{([a-z_]+)\}/)[1];
        expect(ctxFor('ecg').t(key, 'FALLBACK', { [arg]: 'XYZ' })).toContain('XYZ');
    });
    it('a shipped non-English catalogue resolves once that language is loaded', async () => {
        await setAppLanguage('de');
        const key = unshadowedKey(pathologyDe);
        expect(ctxFor('pathology').t(key, 'FALLBACK')).toBe(pathologyDe[key]);
        await setAppLanguage('kk');
        const kkKey = unshadowedKey(ecgKk);
        expect(ctxFor('ecg').t(kkKey, 'FALLBACK')).toBe(ecgKk[kkKey]);
        await setAppLanguage('en');
    });
});
