#!/usr/bin/env node
/*
 * Release check for the built <oyon-app> element
 * (standalone/app/dist-element/oyon-app.element.js). Run after
 * `npm run app:build:element`.
 *
 * Fails when the bundle would throw as it loads in a host page: a dependency
 * the build could not resolve is compiled in as a module that throws
 * `Could not resolve "<name>" imported by "<importer>"`, and the element
 * build inlines dynamic imports, so that throw runs at load. It also fails
 * when the optional, separately licensed webgazer peer was compiled in, or
 * left behind as a bare import a host's bundler cannot resolve.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = resolve(root, 'standalone/app/dist-element/oyon-app.element.js');

if (!existsSync(bundlePath)) {
  console.error(`check-element-bundle: ${bundlePath} does not exist — run \`npm run app:build:element\` first.`);
  process.exit(1);
}

const source = readFileSync(bundlePath, 'utf8');
const problems = [];

const unresolved = [...new Set(
  [...source.matchAll(/Could not resolve \\?"([^"\\]+)\\?" imported by/g)].map((match) => match[1]),
)];
if (unresolved.length > 0) {
  problems.push(`unresolved imports compiled in as throwing modules: ${unresolved.join(', ')}`);
}

// webgazer is an optional, separately licensed peer: the element build
// aliases it to an inert stand-in (standalone/app/src/stubs/
// webgazerNotBundled.ts). The stand-in's marker must be there, and no bare
// `import("webgazer")` may remain — a host that runs this bundle through its
// own bundler or dev server would fail to resolve a package it never asked for.
if (!source.includes('oyon:webgazer-not-bundled')) {
  problems.push('the webgazer stand-in is missing — the optional peer was compiled into the bundle');
}
if (/import\(\s*["'`]webgazer["'`]\s*\)/.test(source)) {
  problems.push('a bare `import("webgazer")` is left in the bundle — host bundlers cannot resolve it');
}

for (const token of ['oyon-app', 'setWindows', 'setRecords', 'setGazeAois']) {
  if (!source.includes(token)) problems.push(`host API token missing: ${token}`);
}

if (problems.length > 0) {
  console.error('check-element-bundle: FAILED');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-element-bundle: OK (${source.length.toLocaleString()} bytes, no unresolved imports)`);
