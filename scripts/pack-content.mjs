#!/usr/bin/env node
/**
 * Pack the built content bundles into release archives.
 *
 *   npm run pack:content
 *
 * Produces, in `dist-content-release/`:
 *
 *   rohy-content-pacs-<version>.tar.gz
 *   rohy-content-pathology-<version>.tar.gz
 *   content-manifest.json      what setup:content verifies against
 *
 * One archive per plugin, so a deployment that wants slides is not made to
 * pull the imaging archive as well. Attach them to a GitHub release, put them
 * on a mirror, or hand them over on a stick — `setup:content` takes any of
 * those, because what it trusts is the checksum in the manifest rather than
 * the place the bytes came from.
 *
 * GitHub caps a single release asset at 2 GB. The imaging archive is the one
 * to watch; this prints each size so the ceiling is visible before it is hit
 * rather than after a failed upload.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'server', 'plugin-content');
const OUT = join(ROOT, 'dist-content-release');
const GITHUB_ASSET_LIMIT = 2 * 1024 ** 3;

const version = process.argv[2] ?? `v${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}`;

if (!existsSync(SRC)) {
    console.error('pack-content: nothing to pack. Run `npm run starter-content` first.');
    process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const plugins = readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(SRC, e.name, 'content.json')))
    .map((e) => e.name);

if (plugins.length === 0) {
    console.error('pack-content: no bundle under server/plugin-content/ carries a content.json');
    process.exit(1);
}

const archives = [];
for (const plugin of plugins) {
    const name = `rohy-content-${plugin}-${version}.tar.gz`;
    const dest = join(OUT, name);
    // -C so the archive contains the plugin directory's CONTENTS, not the
    // absolute path it happened to be built at.
    const tar = spawnSync('tar', ['-czf', dest, '-C', join(SRC, plugin), '.'], { encoding: 'utf8' });
    if (tar.status !== 0) {
        console.error(`pack-content: tar failed for ${plugin}: ${tar.stderr}`);
        process.exit(1);
    }
    const bytes = statSync(dest).size;
    const sha256 = createHash('sha256').update(readFileSync(dest)).digest('hex');
    const content = JSON.parse(readFileSync(join(SRC, plugin, 'content.json'), 'utf8'));

    archives.push({ plugin, file: name, bytes, sha256, files: content.fileCount, contentVersion: content.version });
    const over = bytes > GITHUB_ASSET_LIMIT;
    console.log(`  ${plugin.padEnd(10)} ${(bytes / 1048576).toFixed(0).padStart(5)} MB  ${content.fileCount} files  ${sha256.slice(0, 12)}…`
        + (over ? '  ⚠ OVER GitHub\'s 2 GB asset limit' : ''));
}

writeFileSync(join(OUT, 'content-manifest.json'), `${JSON.stringify({
    schemaVersion: '1.0.0',
    version,
    builtAt: new Date().toISOString(),
    archives,
}, null, 2)}\n`);

console.log(`\npack-content: ${archives.length} archive(s) in dist-content-release/ as ${version}`);
console.log('Publish them, then record the URLs and checksums in scripts/content-sources.json.');
