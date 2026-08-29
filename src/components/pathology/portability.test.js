// The portability gate on rohy's VENDORED copy of the pathology package.
//
// Upstream is ~/Documents/Github/Pathoyon/rohy-pathology (its own repo, its own
// tests/portability.test.js). This folder is a byte-identical copy of its
// src/ — INTEGRATION.md §"Copy the package" — plus this file and README.md.
// What keeps it a PACKAGE rather than a rohy component is one property:
// nothing under it imports anything only rohy can satisfy. Rohy's services
// arrive as props — eventLogger, t, the persistence callback — never via
// import. The test walks every source file (subfolders included) and fails on
// the first import that is not (a) a file inside this folder or (b) one of the
// declared peer dependencies — the same ALLOWED list upstream enforces.
//
// Regression lock: PathologyScreen once called useTranslation() from
// react-i18next, which compiled everywhere and threw at render outside an
// I18nextProvider — the package could only ever be a rohy component.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const PACKAGE_DIR = __dirname;
const PEER_DEPENDENCIES = new Set(['react', 'react-dom', 'openseadragon', 'lucide-react']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Source with comments removed.
 *
 * Without this the scan matches a JSDoc type annotation — `@param
 * {import('express').Router} router` is a TYPE reference, not a dependency, and
 * flagging it would force a package to stop documenting the shape of what the
 * host hands it. It also stops a commented-out import from failing the gate.
 */
function code(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir = PACKAGE_DIR) {
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory()
            ? sourceFiles(join(dir, e.name))
            : (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [relative(PACKAGE_DIR, join(dir, e.name))] : [])))
        .sort();
}

function importsOf(file) {
    const text = code(readFileSync(join(PACKAGE_DIR, file), 'utf8'));
    const out = [];
    for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2]);
    return out;
}

describe('pathology package portability', () => {
    it('has source files to check', () => {
        expect(sourceFiles().length).toBeGreaterThan(10);
    });

    it('imports only files inside the package and its declared peer dependencies', () => {
        const offenders = [];
        for (const file of sourceFiles()) {
            for (const spec of importsOf(file)) {
                const relativeImport = spec.startsWith('./') || spec.startsWith('../');
                const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
                if (!relativeImport && !PEER_DEPENDENCIES.has(bare)) offenders.push(`${file}: ${spec}`);
            }
        }
        expect(offenders, 'a host-only import makes this folder a rohy component, not a package').toEqual([]);
    });

    it('never resolves an import outside the package folder', () => {
        const escapes = [];
        for (const file of sourceFiles()) {
            for (const spec of importsOf(file)) {
                if (!spec.startsWith('.')) continue;
                const target = resolve(PACKAGE_DIR, dirname(file), spec);
                const rel = relative(PACKAGE_DIR, target);
                if (rel.startsWith('..') || rel.startsWith(sep)) escapes.push(`${file}: ${spec}`);
            }
        }
        expect(escapes).toEqual([]);
    });

    it('does not import react-i18next (translation is injected as `t`)', () => {
        for (const file of sourceFiles()) {
            expect(importsOf(file), file).not.toContain('react-i18next');
        }
    });
});
