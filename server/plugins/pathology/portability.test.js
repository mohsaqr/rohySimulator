// The portability gate on rohy's VENDORED copy of Pathoyon's SERVER module.
//
// Upstream is ~/Documents/Github/Pathoyon/pathoyon/server. This folder is a
// byte-identical copy plus this file and README.md; re-vendor with
// `npm run pathology:vendor`.
//
// The client half's gate (src/components/pathology/portability.test.js) allows
// a short list of peer dependencies — react, openseadragon and friends. This
// half allows NONE. A server module's whole claim is that the host hands it
// every capability through `ctx` (RPS-1 §11b.2): the moment it imports express,
// or rohy's dbAdapter, or `node:child_process`, it has stopped being a plugin
// and become part of the host.
//
// `node:` builtins that are pure data handling (path, crypto, fs promises) are
// allowed because they are the language, not the host. `node:child_process` and
// `node:http` are NOT: those are exactly the two powers ctx.runBinary and
// ctx.download exist to mediate, and a module reaching for them directly has
// bypassed the allowlist and the byte cap.
//
// Regression lock: the job handler once read its context from `this`, which
// worked only because the host happened to call it as a method — destructuring
// the handler out of the exported object silently produced `undefined`.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACKAGE_DIR = __dirname;

/** Node builtins this module may use: data handling only, never a capability. */
const ALLOWED_BUILTINS = new Set([
    'node:crypto', 'node:path', 'node:fs/promises', 'node:url', 'node:buffer',
]);

/** Builtins that ARE capabilities, and must arrive through ctx instead. */
const FORBIDDEN_BUILTINS = new Map([
    ['node:child_process', 'ctx.runBinary — the allow-listed, shell-free spawner'],
    ['node:http', 'ctx.download — the allow-listed, byte-capped downloader'],
    ['node:https', 'ctx.download'],
    ['node:net', 'ctx.download'],
    ['node:dns', 'ctx.download'],
]);

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

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
            : (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [relative(PACKAGE_DIR, join(dir, e.name))] : [])))
        .sort();
}

function importsOf(file) {
    const source = code(readFileSync(join(PACKAGE_DIR, file), 'utf8'));
    const found = [];
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(source)) !== null) found.push(m[1] ?? m[2] ?? m[3]);
    return found;
}

describe('the vendored pathology server module is a package, not a rohy component', () => {
    const files = sourceFiles();

    it('ships the module the host mounts', () => {
        expect(files).toContain('index.js');
        expect(files.length).toBeGreaterThan(1);   // never vacuous — see below
    });

    // The client gate could pass on ZERO files if a bad re-vendor emptied the
    // folder. That is the exact accident v2.9.83 fixed, so this half asserts it
    // found something before asserting anything about what it found.
    it.each(sourceFiles())('%s imports nothing only rohy can satisfy', (file) => {
        importsOf(file).forEach((spec) => {
            if (spec.startsWith('.')) return;                    // its own files
            const forbidden = FORBIDDEN_BUILTINS.get(spec);
            expect(forbidden ? `${file} imports ${spec}; use ${forbidden}` : null).toBeNull();
            expect(ALLOWED_BUILTINS.has(spec) ? null : `${file} imports '${spec}', which is neither a local file nor an allowed node builtin`)
                .toBeNull();
        });
    });

    it('reads its context from an argument, never from `this`', () => {
        // `this` in a module-level export is undefined under ESM strict mode, so
        // a handler relying on it works only while the host calls it as a
        // method — and breaks the moment anyone destructures it.
        sourceFiles().forEach((file) => {
            const source = code(readFileSync(join(PACKAGE_DIR, file), 'utf8'));
            expect({ file, thisUse: /\bconst\s+ctx\s*=\s*this\b/.test(source) })
                .toEqual({ file, thisUse: false });
        });
    });
});
