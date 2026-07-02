// Packaging contract: every subpath in the exports map must resolve to a
// real file with real types, every export target must ship in the tarball
// (files allowlist), and every source target must actually parse/import.
// Catches the classic publish-time breakages: renamed file, forgotten
// `files` entry, types pointing at nothing.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// npm always ships these regardless of the files allowlist.
const ALWAYS_PACKED = new Set(['package.json', 'README.md', 'LICENSE']);

const isAllowlisted = (relPath) =>
  ALWAYS_PACKED.has(relPath) ||
  pkg.files.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`));

// Built artifacts are produced by prepublishOnly, not committed — existence
// is only asserted when the build output is present locally.
const BUILT_PREFIXES = ['dist/', 'standalone/app/dist-element/'];
const isBuiltArtifact = (relPath) => BUILT_PREFIXES.some((p) => relPath.startsWith(p));

let checked = 0;
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const entries = typeof target === 'string' ? { default: target } : target;
  for (const [condition, relTarget] of Object.entries(entries)) {
    const rel = relTarget.replace(/^\.\//, '');
    assert.ok(isAllowlisted(rel),
      `${subpath} (${condition}) → ${rel} is not covered by the files allowlist — it would be missing from the npm tarball`);
    if (isBuiltArtifact(rel)) {
      if (existsSync(resolve(ROOT, rel))) checked += 1;
      continue;
    }
    assert.ok(existsSync(resolve(ROOT, rel)),
      `${subpath} (${condition}) → ${rel} does not exist`);
    checked += 1;
  }
}
assert.ok(checked >= 20, `suspiciously few export targets verified (${checked})`);

// Every source export target must be importable (catches syntax errors and
// broken internal imports that `node --check` per-file can miss).
const importTargets = [...new Set(
  Object.values(pkg.exports)
    .map((t) => (typeof t === 'string' ? t : t.import ?? t.default))
    .filter((t) => t && t.endsWith('.js') && t.startsWith('./src/')),
)];
for (const target of importTargets) {
  // React subpaths import 'react' (optional peer): importable only when the
  // dev tree has react installed; skip gracefully when it doesn't.
  try {
    await import(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url).href);
  } catch (err) {
    const missing = /Cannot find package '(react|react-dom)'/.exec(String(err?.message ?? err));
    if (!missing) throw new Error(`exports target ${target} failed to import: ${err?.message ?? err}`);
  }
}

// The bin entry must exist, be executable source, and stay allowlisted.
for (const [name, rel] of Object.entries(pkg.bin)) {
  const clean = rel.replace(/^\.\//, '');
  assert.ok(existsSync(resolve(ROOT, clean)), `bin ${name} → ${clean} missing`);
  assert.ok(isAllowlisted(clean), `bin ${name} → ${clean} not in files allowlist`);
}

// Types referenced by export conditions must exist.
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (typeof target === 'string') continue;
  if (!target.types) continue;
  const rel = target.types.replace(/^\.\//, '');
  assert.ok(existsSync(resolve(ROOT, rel)), `${subpath} types → ${rel} missing`);
}

console.log(`exports-map.test.js passed (${checked} targets verified)`);
