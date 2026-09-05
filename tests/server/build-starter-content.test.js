// The starter-content builder (scripts/build-starter-content.mjs) ships what
// a deployment serves before anyone configures an origin. These tests hold
// the one property a bundle cannot be checked for after the fact: every
// picture its indexes name is inside it.
//
// Regression lock: the PACS thumbnail loop prefixed the index value
// (`remote:thumbs/<path>.png`) with `thumbs/` again, named a file that does
// not exist, and copyOne() returned false without a word. Every starter
// bundle built before 2026-09-05 — the published content-v1 included — shipped
// thumbs/index.json with no pictures behind it, and the imaging case editor
// rendered a broken image on all 74 cards.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPacs } from '../../scripts/build-starter-content.mjs';

const SERIES_REF = 'remote:dicom/normal/head/s1/';
const THUMB_REF = 'remote:thumbs/normal/head/s1.png';

function writeOrigin(src, { withThumbFile = true } = {}) {
    mkdirSync(join(src, 'dicom', 'normal', 'head', 's1'), { recursive: true });
    writeFileSync(join(src, 'dicom', 'normal', 'head', 's1', 'index.json'), '{"instances":[]}\n');
    writeFileSync(join(src, 'catalog.json'), JSON.stringify({
        version: 1,
        entries: [{ id: 'head', label: 'Head', series: [{ key: 's1', ref: SERIES_REF }] }],
    }));
    mkdirSync(join(src, 'thumbs', 'normal', 'head'), { recursive: true });
    writeFileSync(join(src, 'thumbs', 'index.json'), JSON.stringify({ version: 1, thumbs: { [SERIES_REF]: THUMB_REF } }));
    if (withThumbFile) writeFileSync(join(src, 'thumbs', 'normal', 'head', 's1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe('build-starter-content: pacs thumbnails', () => {
    let root;
    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rohy-starter-')); });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    it('copies every thumbnail the index names and lists it in the bundle manifest', () => {
        const src = join(root, 'origin'); const out = join(root, 'out');
        writeOrigin(src);
        buildPacs(src, out);
        expect(existsSync(join(out, 'thumbs', 'normal', 'head', 's1.png'))).toBe(true);
        const index = JSON.parse(readFileSync(join(out, 'thumbs', 'index.json'), 'utf8'));
        expect(index.thumbs[SERIES_REF]).toBe(THUMB_REF);
        const manifest = JSON.parse(readFileSync(join(out, 'content.json'), 'utf8'));
        expect(manifest.files.map((f) => f.path)).toContain('thumbs/normal/head/s1.png');
        expect(manifest.paths).toEqual(['/dicom', '/thumbs']);
    });

    it('refuses to build a bundle whose index names a thumbnail the origin does not have', () => {
        const src = join(root, 'origin'); const out = join(root, 'out');
        writeOrigin(src, { withThumbFile: false });
        expect(() => buildPacs(src, out)).toThrow(/thumbs\/normal\/head\/s1\.png/);
    });
});
