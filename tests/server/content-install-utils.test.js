import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installArchiveAtomically, sha256File } from '../../scripts/content-install-utils.mjs';

const roots = [];
afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function tempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'rohy-content-install-'));
    roots.push(root);
    return root;
}

function makeArchive(root, manifest, marker = 'new content') {
    const source = join(root, `source-${Math.random().toString(16).slice(2)}`);
    const archive = join(root, `bundle-${Math.random().toString(16).slice(2)}.tar.gz`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'content.json'), JSON.stringify(manifest));
    writeFileSync(join(source, 'marker.txt'), marker);
    const tar = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' });
    expect(tar.status, tar.stderr).toBe(0);
    return archive;
}

describe('content installer utilities', () => {
    it('hashes an archive through a stream and returns the normal SHA-256', async () => {
        const root = tempRoot();
        const file = join(root, 'large-enough-to-chunk.bin');
        const bytes = Buffer.alloc(4 * 1024 * 1024 + 17, 0x5a);
        writeFileSync(file, bytes);

        expect(await sha256File(file)).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('validates the staged bundle before replacing the working directory', () => {
        const root = tempRoot();
        const target = join(root, 'pacs');
        mkdirSync(target);
        writeFileSync(join(target, 'marker.txt'), 'working content');
        const wrong = makeArchive(root, { plugin: 'pathology', version: 'v2' });

        expect(() => installArchiveAtomically({
            archiveFile: wrong,
            target,
            plugin: 'pacs',
            contentVersion: 'v2',
        })).toThrow(/names plugin 'pathology'/);
        expect(readFileSync(join(target, 'marker.txt'), 'utf8')).toBe('working content');
    });

    it('swaps a fully validated bundle into place and leaves no staging directory', () => {
        const root = tempRoot();
        const target = join(root, 'pacs');
        mkdirSync(target);
        writeFileSync(join(target, 'marker.txt'), 'old content');
        const archive = makeArchive(root, { plugin: 'pacs', version: 'v2' });

        installArchiveAtomically({ archiveFile: archive, target, plugin: 'pacs', contentVersion: 'v2' });

        expect(readFileSync(join(target, 'marker.txt'), 'utf8')).toBe('new content');
        expect(existsSync(join(target, 'content.json'))).toBe(true);
        expect(readdirSync(root).filter((name) => name.startsWith('.pacs-'))).toEqual([]);
    });
});
