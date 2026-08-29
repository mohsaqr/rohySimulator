// The portability gate on rohy's VENDORED copy of the Radoyon package.
//
// Upstream is ~/Documents/Github/Radoyon/radoyon (its own repo, its own
// tests/). This folder is a byte-identical copy of its src/, plus this file
// and README.md. What keeps it a PACKAGE rather than a rohy component is one
// property: nothing under it imports anything only rohy can satisfy. Rohy's
// services arrive as props — eventLogger, t, loadSeries, the persistence
// callback — never via import. The test walks every source file and fails on
// the first import that is not (a) a file inside this folder or (b) a declared
// peer dependency.
//
// Radoyon has NO openseadragon and no DICOM library: the parser, the modality
// LUT and the VOI transform are its own, which is why the peer list here is
// shorter than pathology's. Any new bare import is therefore a decision to add
// a dependency to rohy's bundle, and this test is where that decision surfaces.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const PACKAGE_DIR = __dirname;
const PEER_DEPENDENCIES = new Set(['react', 'react-dom', 'lucide-react']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceFiles(dir = PACKAGE_DIR) {
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory()
            ? sourceFiles(join(dir, e.name))
            : (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [relative(PACKAGE_DIR, join(dir, e.name))] : [])))
        .sort();
}

function importsOf(file) {
    const text = readFileSync(join(PACKAGE_DIR, file), 'utf8');
    const out = [];
    for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2]);
    return out;
}

describe('radoyon package portability', () => {
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

    it('pulls in no DICOM or imaging library — the pixel pipeline is its own', () => {
        // Not a style preference. A DICOM stack that decodes JPEG 2000 in the
        // browser carries a WASM codec, and this package deliberately pushes
        // that work to ingest instead so a learner's tab stays small. If this
        // ever fails, that trade has been reversed and should be reviewed.
        const imaging = ['cornerstone', 'dicom-parser', 'dcmjs', 'itk-wasm', 'openseadragon'];
        for (const file of sourceFiles()) {
            for (const spec of importsOf(file)) {
                const bare = spec.split('/')[0];
                expect(imaging, `${file} imports ${spec}`).not.toContain(bare);
            }
        }
    });
});
