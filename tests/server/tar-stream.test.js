// server/lib/tarStream.js — the case-package container.
//
// Locks: what it writes is a tar the system `tar` reads byte-for-byte; what
// the system `tar` writes, it reads; and it REFUSES what a general extractor
// would follow — symlinks, hardlinks, directories, truncation, a forged
// header, data after the end marker.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, createWriteStream, createReadStream, symlinkSync, linkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { createTarWriter, readTar, tarArchiveBytes, TarError } from '../../server/lib/tarStream.js';

const hasTar = (() => { try { execFileSync('tar', ['--version']); return true; } catch { return false; } })();

/** Read every entry into memory: [{name, data}]. */
async function readAll(readable) {
    const out = [];
    await readTar(readable, ({ name }) => {
        const chunks = [];
        return {
            write: (c) => { chunks.push(Buffer.from(c)); },
            end: () => { out.push({ name, data: Buffer.concat(chunks) }); },
        };
    });
    return out;
}

/** Feed a buffer in awkward chunk sizes so header/data boundaries split. */
function chunked(buffer, size = 333) {
    const parts = [];
    for (let i = 0; i < buffer.length; i += size) parts.push(buffer.subarray(i, i + size));
    return Readable.from(parts);
}

describe('tarStream', () => {
    let dir;
    beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rohy-tar-')); });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('round-trips buffers and streams through its own reader, across odd chunk boundaries', async () => {
        const big = randomBytes(70_001);
        const file = join(dir, 'own.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('case.json', Buffer.from('{"a":1}'));
        await writer.addBuffer('empty', Buffer.alloc(0));
        await writer.addStream('media/big', big.length, Readable.from([big.subarray(0, 1000), big.subarray(1000)]));
        await writer.finish();

        const entries = await readAll(chunked(readFileSync(file)));
        expect(entries.map((e) => e.name)).toEqual(['case.json', 'empty', 'media/big']);
        expect(entries[0].data.toString()).toBe('{"a":1}');
        expect(entries[1].data.length).toBe(0);
        expect(entries[2].data.equals(big)).toBe(true);
    });

    it.skipIf(!hasTar)('writes a tar the system tar extracts byte-for-byte', async () => {
        const payload = randomBytes(5000);
        const file = join(dir, 'for-system.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('manifest.json', Buffer.from('{"ok":true}'));
        await writer.addStream('media/abc', payload.length, Readable.from([payload]));
        await writer.finish();

        const out = join(dir, 'extracted');
        mkdirSync(out);
        execFileSync('tar', ['-xf', file, '-C', out]);
        expect(readFileSync(join(out, 'manifest.json'), 'utf8')).toBe('{"ok":true}');
        expect(readFileSync(join(out, 'media', 'abc')).equals(payload)).toBe(true);
    });

    it.skipIf(!hasTar)('reads a ustar archive written by the system tar', async () => {
        const src = join(dir, 'sys-src');
        mkdirSync(src);
        writeFileSync(join(src, 'case.json'), '{"from":"system"}');
        const file = join(dir, 'sys.tar');
        execFileSync('tar', ['--format', 'ustar', '-cf', file, '-C', src, 'case.json']);
        const entries = await readAll(createReadStream(file));
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ name: 'case.json' });
        expect(entries[0].data.toString()).toBe('{"from":"system"}');
    });

    it.skipIf(!hasTar)('refuses a symlink entry', async () => {
        const src = join(dir, 'sym-src');
        mkdirSync(src);
        symlinkSync('/etc/passwd', join(src, 'evil'));
        const file = join(dir, 'sym.tar');
        execFileSync('tar', ['--format', 'ustar', '-cf', file, '-C', src, 'evil']);
        await expect(readAll(createReadStream(file))).rejects.toMatchObject({ code: 'tar_entry_type' });
    });

    it.skipIf(!hasTar)('refuses a hardlink entry', async () => {
        const src = join(dir, 'hard-src');
        mkdirSync(src);
        writeFileSync(join(src, 'a'), 'x');
        linkSync(join(src, 'a'), join(src, 'b'));
        const file = join(dir, 'hard.tar');
        execFileSync('tar', ['--format', 'ustar', '-cf', file, '-C', src, 'a', 'b']);
        await expect(readAll(createReadStream(file))).rejects.toMatchObject({ code: 'tar_entry_type' });
    });

    it.skipIf(!hasTar)('refuses a directory entry', async () => {
        const src = join(dir, 'dir-src');
        mkdirSync(join(src, 'sub'), { recursive: true });
        const file = join(dir, 'dir.tar');
        execFileSync('tar', ['--format', 'ustar', '-cf', file, '-C', src, 'sub']);
        await expect(readAll(createReadStream(file))).rejects.toMatchObject({ code: 'tar_entry_type' });
    });

    it('refuses a truncated archive', async () => {
        const file = join(dir, 'trunc.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('case.json', Buffer.from('x'.repeat(2000)));
        await writer.finish();
        const cut = readFileSync(file).subarray(0, 1200);
        await expect(readAll(chunked(cut))).rejects.toMatchObject({ code: 'tar_truncated' });
    });

    it('refuses a header whose checksum does not match', async () => {
        const file = join(dir, 'forged.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('case.json', Buffer.from('{}'));
        await writer.finish();
        const bytes = Buffer.from(readFileSync(file));
        bytes[0] = 'X'.charCodeAt(0); // rename without fixing the checksum
        await expect(readAll(chunked(bytes))).rejects.toBeInstanceOf(TarError);
    });

    it('refuses data after the end-of-archive marker', async () => {
        const file = join(dir, 'trailing.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('case.json', Buffer.from('{}'));
        await writer.finish();
        const bytes = Buffer.concat([readFileSync(file), Buffer.from('smuggled')]);
        await expect(readAll(chunked(bytes))).rejects.toBeInstanceOf(TarError);
    });

    it('refuses to write a name longer than the header holds', async () => {
        const writer = createTarWriter(createWriteStream(join(dir, 'long.tar')));
        await expect(writer.addBuffer('x'.repeat(101), Buffer.from(''))).rejects.toMatchObject({ code: 'tar_name_too_long' });
    });

    it('refuses a stream that yields a different length than declared', async () => {
        const writer = createTarWriter(createWriteStream(join(dir, 'len.tar')));
        await expect(writer.addStream('media/x', 10, Readable.from([Buffer.alloc(4)]))).rejects.toMatchObject({ code: 'tar_size' });
    });

    it('rejects instead of hanging when the output failed between two writes', async () => {
        // Regression lock: an ENOSPC emitted between writes reached no listener; the next write waited for a 'drain' a destroyed stream never emits, and the package job queue stalled behind it (Codex review, 2026-10-10)
        const disk = new Writable({ write(_chunk, _enc, cb) { cb(); } });
        disk.on('error', () => {}); // the process must not crash on it either way
        const writer = createTarWriter(disk);
        await writer.addBuffer('case.json', Buffer.from('{}'));
        disk.destroy(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
        await new Promise((resolve) => setImmediate(resolve)); // the 'error' event has fired, unobserved by any write
        const next = writer.addStream('media/x', 4096, Readable.from([Buffer.alloc(4096)]));
        const hung = new Promise((resolve) => setTimeout(() => resolve('hung'), 1500));
        await expect(Promise.race([next, hung])).rejects.toMatchObject({ code: 'ENOSPC' });
    }, 5000);

    it('rejects instead of hanging when the output was closed without an error', async () => {
        // Regression lock: a writable destroyed WITHOUT an error never emits 'error' or 'drain', so a write waited forever — on an already-closed output and on one closed mid-wait (review F12, 2026-10-10)
        const hung = () => new Promise((resolve) => setTimeout(() => resolve('hung'), 1500));

        const gone = new Writable({ write(_chunk, _enc, cb) { cb(); } });
        gone.destroy();
        await expect(Promise.race([createTarWriter(gone).addBuffer('case.json', Buffer.from('{}')), hung()]))
            .rejects.toMatchObject({ code: 'tar_output_closed' });

        // A stalled sink: write() returns false and the writer waits for 'drain'.
        const stalled = new Writable({ highWaterMark: 16, write() {} });
        const waiting = createTarWriter(stalled).addBuffer('case.json', Buffer.from('{}'));
        await new Promise((resolve) => setImmediate(resolve));
        stalled.destroy();
        await expect(Promise.race([waiting, hung()])).rejects.toMatchObject({ code: 'tar_output_closed' });
    }, 5000);

    it('abort() resolves only once the output has closed', async () => {
        const out = createWriteStream(join(dir, 'aborted.tar'));
        const writer = createTarWriter(out);
        await writer.addBuffer('case.json', Buffer.from('{}'));
        await writer.abort();
        expect(out.destroyed).toBe(true);
        expect(out.closed).toBe(true);
        await writer.abort(); // a second abort on a closed output is a no-op
    });

    it('tarArchiveBytes predicts the written size exactly', async () => {
        const sizes = [0, 1, 511, 512, 513, 5000];
        const file = join(dir, 'sized.tar');
        const writer = createTarWriter(createWriteStream(file));
        for (const [i, size] of sizes.entries()) await writer.addBuffer(`e${i}`, Buffer.alloc(size, 7));
        await writer.finish();
        expect(readFileSync(file).length).toBe(tarArchiveBytes(sizes));
        expect(tarArchiveBytes([])).toBe(1024);
    });

    it('releases the open entry when the archive is cut off mid-entry', async () => {
        // Regression lock: a truncated media entry left its file stream open — a descriptor and the disk of an unlinked file held per malformed import (Codex review, 2026-10-10)
        const file = join(dir, 'cut-entry.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('media/a', Buffer.alloc(3000, 1));
        await writer.finish();
        const cut = readFileSync(file).subarray(0, 512 + 1000);
        const events = [];
        await expect(readTar(chunked(cut), () => ({
            write: () => {},
            end: () => events.push('end'),
            abort: () => events.push('abort'),
        }))).rejects.toMatchObject({ code: 'tar_truncated' });
        expect(events).toEqual(['abort']);
    });

    it('lets the caller refuse an entry by name', async () => {
        const file = join(dir, 'named.tar');
        const writer = createTarWriter(createWriteStream(file));
        await writer.addBuffer('../escape', Buffer.from('x'));
        await writer.finish();
        await expect(readTar(createReadStream(file), ({ name }) => {
            throw new TarError(`unexpected entry ${name}`, 'tar_name');
        })).rejects.toMatchObject({ code: 'tar_name' });
    });
});
