// Plugin-shipped translations — layer 2 of the i18n resolution order.
//
//   1. src/locales/<lang>/<ns>.json          rohy's catalogue — reviewed, locked, WINS
//   2. src/plugins/<id>/locales/<lang>.json  what the plugin shipped
//   3. t(key, 'English') in the code         the inline fallback
//
// The registry half (namespace declaration, cross-plugin collisions) is pure
// and tested directly; the file-level checks run the real gate script against
// a throwaway plugin tree.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    localeNamespaceOf, resolveLocaleLayers, validatePluginLocales, validateManifest
} from '../../server/shared/pluginRegistry.js';
import { assertNoVendoredI18n } from '../../scripts/vendor-plugins.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifest = (over = {}) => ({
    id: 'ecg',
    room: { key: 'ecg', labelKey: 'room_ecg' },
    vocabulary: { verbs: {}, objectTypes: {}, components: {} },
    ...over
});

describe('manifest.locales declaration', () => {
    it('defaults the namespace to the plugin id', () => {
        expect(localeNamespaceOf(manifest())).toBe('ecg');
        expect(localeNamespaceOf(manifest({ locales: { namespace: 'cardiology' } }))).toBe('cardiology');
    });

    it('accepts an absent declaration and a lower_snake_case namespace', () => {
        expect(() => validatePluginLocales(manifest())).not.toThrow();
        expect(() => validatePluginLocales(manifest({ locales: { namespace: 'ecg_room' } }))).not.toThrow();
    });

    it('rejects a namespace that is not lower_snake_case', () => {
        expect(() => validatePluginLocales(manifest({ locales: { namespace: 'ECG Room' } })))
            .toThrow(/must be lower_snake_case/);
    });

    // Regression lock: strings in the manifest would be inlined into
    // manifests.generated.js, which the SERVER imports — thousands of
    // translations in a bundle that renders none of them.
    it('refuses catalogues embedded in the manifest, naming where they belong', () => {
        expect(() => validatePluginLocales(manifest({ locales: { catalogues: { en: { a: 'A' } } } })))
            .toThrow(/src\/plugins\/ecg\/locales\/<lang>\.json/);
    });

    it('is enforced through validateManifest, not only when called directly', () => {
        expect(() => validateManifest(manifest({ locales: { namespace: 'Nope' } }))).toThrow(/lower_snake_case/);
    });
});

describe('resolveLocaleLayers', () => {
    it('collapses several plugins into namespace → key → string', () => {
        const out = resolveLocaleLayers([
            { id: 'ecg', namespace: 'ecg', table: { lead: 'Lead', paper: 'Paper' } },
            { id: 'pathology', namespace: 'pathology', table: { slide: 'Slide' } }
        ]);
        expect(out).toEqual({ ecg: { lead: 'Lead', paper: 'Paper' }, pathology: { slide: 'Slide' } });
    });

    it('ignores a plugin that ships nothing for the language', () => {
        expect(resolveLocaleLayers([{ id: 'ecg', namespace: 'ecg', table: undefined }])).toEqual({});
    });

    // Unlike mergeNamespace, rohy-over-plugin is NOT a collision — that is the
    // layering. Two plugins over each other has no principled winner.
    it('throws when two plugins ship the same string, naming both', () => {
        expect(() => resolveLocaleLayers([
            { id: 'ecg', namespace: 'shared', table: { save: 'Save' } },
            { id: 'pathology', namespace: 'shared', table: { save: 'Store' } }
        ])).toThrow(/'ecg' and 'pathology' both ship string 'shared.save'/);
    });

    it('lets one plugin restate its own key without complaining', () => {
        expect(() => resolveLocaleLayers([
            { id: 'ecg', namespace: 'ecg', table: { save: 'Save' } },
            { id: 'ecg', namespace: 'ecg', table: { save: 'Save' } }
        ])).not.toThrow();
    });
});

describe('vendor i18n boundary', () => {
    const entry = { id: 'ecg', package: 'cardoyon' };
    let dir;
    const make = (files) => {
        dir = mkdtempSync(join(tmpdir(), 'rohy-vendor-'));
        for (const [rel, body] of Object.entries(files)) {
            const full = join(dir, rel);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, body);
        }
        return dir;
    };

    it('passes a package that takes t as an injected prop', () => {
        const src = make({ 'ui/Panel.jsx': "export function Panel({ t = (k, f) => f ?? k }) { return t('a', 'A'); }" });
        expect(() => assertNoVendoredI18n(src, entry)).not.toThrow();
        rmSync(src, { recursive: true, force: true });
    });

    // Regression lock: a catalogue under the vendored tree lands inside rohy as
    // a second source of truth for the same string, with no review state.
    it('refuses a catalogue inside the vendored tree', () => {
        const src = make({ 'locales/fr.json': '{"a":"A"}', 'index.js': 'export const x = 1;' });
        expect(() => assertNoVendoredI18n(src, entry)).toThrow(/a catalogue inside the vendored tree/);
        rmSync(src, { recursive: true, force: true });
    });

    it('refuses a package that binds to rohy\'s i18next instance', () => {
        const src = make({ 'ui/Panel.jsx': "import { useTranslation } from 'react-i18next';\nexport const P = () => null;" });
        expect(() => assertNoVendoredI18n(src, entry)).toThrow(/imports react-i18next/);
        rmSync(src, { recursive: true, force: true });
    });

    it('names every offender at once and points at the supported shape', () => {
        const src = make({
            'locales/en.json': '{}',
            'a.jsx': "import x from 'react-i18next';",
            'b.jsx': "import y from 'react-i18next';"
        });
        let message = '';
        try { assertNoVendoredI18n(src, entry); } catch (err) { message = err.message; }
        expect(message).toContain('locales/en.json');
        expect(message).toContain('a.jsx');
        expect(message).toContain('b.jsx');
        expect(message).toContain('src/plugins/ecg/locales/<lang>.json');
        rmSync(src, { recursive: true, force: true });
    });
});

describe('check-plugin-locales gate', () => {
    /** Run the real gate against the repo (no plugin ships locales yet). */
    const run = (args = []) => {
        try {
            return { code: 0, out: execFileSync(process.execPath, [join(REPO, 'scripts', 'check-plugin-locales.mjs'), ...args], { encoding: 'utf8' }) };
        } catch (err) { return { code: err.status, out: (err.stdout ?? '') + (err.stderr ?? '') }; }
    };

    it('passes on the current tree', () => {
        const res = run(['--check']);
        expect(res.code).toBe(0);
        expect(res.out).toContain('Plugin locales OK');
    });
});
