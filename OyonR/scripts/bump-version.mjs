#!/usr/bin/env node
/*
 * Bump the patch version in BOTH places that carry it.
 *
 * package.json and src/version.js must agree — `OYON_VERSION` mirrors the
 * manifest and the release tests assert they are equal, so bumping one alone
 * turns a green suite red. That coupling is the whole reason this is a script
 * and not a `npm version` call: npm only knows about the manifest.
 *
 * Usage:
 *   node scripts/bump-version.mjs           # patch bump
 *   node scripts/bump-version.mjs minor     # minor bump, patch reset
 *   node scripts/bump-version.mjs --check   # print, change nothing
 *
 * Installed as a pre-commit hook by scripts/install-hooks.sh, which re-stages
 * both files so the bump lands in the commit that triggered it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'package.json');
const versionPath = join(root, 'src/version.js');

const manifestRaw = readFileSync(manifestPath, 'utf8');
const versionRaw = readFileSync(versionPath, 'utf8');

const current = JSON.parse(manifestRaw).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  console.error(`bump-version: package.json version is not x.y.z — got "${current}"`);
  process.exit(1);
}

// The constant must already agree, or we would be bumping past a real
// inconsistency and hiding it.
const declared = /OYON_VERSION\s*=\s*'([^']+)'/.exec(versionRaw)?.[1];
if (declared !== current) {
  console.error(
    `bump-version: package.json (${current}) and src/version.js (${declared}) disagree. `
    + 'Fix that first — bumping would paper over it.',
  );
  process.exit(1);
}

const arg = process.argv[2];
if (arg === '--check') {
  console.log(current);
  process.exit(0);
}

const [, major, minor, patch] = match.map(Number);
const next = arg === 'major'
  ? `${major + 1}.0.0`
  : arg === 'minor'
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

// Replace only the top-level "version" field — a naive global replace would
// also rewrite any dependency pinned at the same string.
writeFileSync(
  manifestPath,
  manifestRaw.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`),
  'utf8',
);
writeFileSync(
  versionPath,
  versionRaw.replace(/(OYON_VERSION\s*=\s*)'[^']+'/, `$1'${next}'`),
  'utf8',
);

console.log(`${current} → ${next}`);
