#!/usr/bin/env node
/*
 * Post-build guard for the <oyon-app> element bundle.
 *
 * The element is ONE inlined ES module, so anything any dynamic import
 * resolved to runs at the bundle's top level the moment a host loads it.
 * This check fails the build when the bundle carries either of the two
 * WebGazer failure modes that vite.element.config.ts exists to prevent:
 *
 *   1. Vite's missing-optional-peer stub — a top-level
 *      `throw new Error('Could not resolve "…" imported by "…"')`. Oyon
 *      3.3.2's element shipped with this for `webgazer` and died on load in
 *      any host that did not install webgazer (Rohy hand-patched it out).
 *   2. The WebGazer library itself inlined (GPL-3.0, executed on load in
 *      every host whether or not the webgazer engine is selected).
 *
 * The generic "Could not resolve" check covers every optional peer, not just
 * webgazer — any of them would kill the element the same way.
 *
 *   node scripts/verify-element-bundle.mjs [distDir]   (default dist-element)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] || 'dist-element';
const bundlePath = resolve(here, '..', distDir, 'oyon-app.element.js');

let source;
try {
  source = readFileSync(bundlePath, 'utf8');
} catch (err) {
  console.error(`verify-element-bundle: cannot read ${bundlePath}: ${err.message}`);
  process.exit(1);
}

// Identifiers that only exist inside WebGazer's own source (its TF face-mesh
// tracker class and its video-feed element id) — never in Oyon's adapter.
const WEBGAZER_LIBRARY_MARKERS = ['TFFaceMesh', 'webgazerVideoFeed'];

const failures = [];
const unresolved = source.match(/Could not resolve \\?["'][^"'\\]+\\?["'] imported by/g);
if (unresolved) {
  failures.push(
    `top-level unresolved-import stub(s) in the bundle: ${[...new Set(unresolved)].join(', ')}`,
  );
}
const inlined = WEBGAZER_LIBRARY_MARKERS.filter((m) => source.includes(m));
if (inlined.length > 0) {
  failures.push(`WebGazer library code is inlined (markers: ${inlined.join(', ')})`);
}

if (failures.length > 0) {
  console.error(`verify-element-bundle: ${bundlePath}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `verify-element-bundle: ok — no unresolved-import stub, WebGazer not inlined ` +
    `(${(source.length / 1e6).toFixed(2)} MB)`,
);
