// The portability gate the package's index.js promises.
//
// This folder is the pathology package itself (its former upstream checkout is
// gone; the tree is canonical). What keeps it a PACKAGE rather than a rohy
// component is one property: nothing under it imports anything only rohy can
// satisfy. Rohy's services arrive as props — eventLogger, t, the persistence
// callback — never via import. The test reads every source file and fails on
// the first import that is not (a) a sibling file or (b) one of the three
// declared peer dependencies.
//
// Regression lock: PathologyScreen once called useTranslation() from
// react-i18next, which compiled everywhere and threw at render outside an
// I18nextProvider — the package could only ever be a rohy component.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_DIR = __dirname;
const PEER_DEPENDENCIES = new Set(['react', 'openseadragon', 'lucide-react']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceFiles() {
    return readdirSync(PACKAGE_DIR)
        .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f))
        .sort();
}

function importsOf(file) {
    const text = readFileSync(join(PACKAGE_DIR, file), 'utf8');
    const out = [];
    for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2]);
    return out;
}

describe('pathology package portability', () => {
    it('has source files to check', () => {
        expect(sourceFiles().length).toBeGreaterThan(10);
    });

    it('imports only sibling files and its three peer dependencies', () => {
        const offenders = [];
        for (const file of sourceFiles()) {
            for (const spec of importsOf(file)) {
                const sibling = spec.startsWith('./');
                const bare = spec.split('/')[0];
                if (!sibling && !PEER_DEPENDENCIES.has(bare)) offenders.push(`${file}: ${spec}`);
            }
        }
        expect(offenders, 'a host-only import makes this folder a rohy component, not a package').toEqual([]);
    });

    it('never reaches a parent directory', () => {
        const escapes = sourceFiles().flatMap((file) =>
            importsOf(file).filter((s) => s.startsWith('../')).map((s) => `${file}: ${s}`));
        expect(escapes).toEqual([]);
    });

    it('does not import react-i18next (translation is injected as `t`)', () => {
        for (const file of sourceFiles()) {
            expect(importsOf(file), file).not.toContain('react-i18next');
        }
    });
});
