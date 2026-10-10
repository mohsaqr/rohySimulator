// A minimal, strict tar (ustar) writer and reader for case packages.
//
// Why not a library: a case package needs four things from its container —
// stream (packages run to gigabytes), plain files only, short fixed names, and
// a reader that REFUSES anything else. A general tar library is built to do
// the opposite: extract whatever an archive holds, symlinks, hardlinks,
// devices, absolute and `../` paths included — the decades-old archive
// extraction bug class. This reader never extracts a path at all: every entry
// is handed to the caller by name, and the caller decides where (if anywhere)
// its bytes go. Anything that is not a regular file is an error, not a skip.
//
// Format: POSIX ustar, 512-byte header + data padded to 512, ended by two zero
// blocks. Names are at most 100 bytes (the package's names are fixed and
// short); sizes up to 8 GiB - 1 (11 octal digits), above any single file a
// package carries.

import { once } from 'node:events';

const BLOCK = 512;
const MAX_SIZE = 8 * 1024 ** 3 - 1;

/** A malformed or refused archive. `code` is machine-readable. */
export class TarError extends Error {
    constructor(message, code = 'tar_invalid') {
        super(message);
        this.name = 'TarError';
        this.code = code;
    }
}

function writeString(header, offset, length, value) {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > length) throw new TarError(`tar field too long: ${value}`, 'tar_name_too_long');
    bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
    // length - 1 digits, then NUL.
    writeString(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function headerChecksum(header) {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
        // The checksum field itself counts as eight spaces.
        sum += i >= 148 && i < 156 ? 0x20 : header[i];
    }
    return sum;
}

function buildHeader(name, size, mtimeSeconds) {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SIZE) {
        throw new TarError(`tar entry size out of range: ${size}`, 'tar_size');
    }
    const header = Buffer.alloc(BLOCK, 0);
    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, size);
    writeOctal(header, 136, 12, mtimeSeconds);
    header[156] = 0x30; // '0' — regular file
    writeString(header, 257, 6, 'ustar\0');
    writeString(header, 263, 2, '00');
    writeString(header, 148, 8, `${headerChecksum(header).toString(8).padStart(6, '0')}\0 `);
    return header;
}

/**
 * Watch a writable for errors for its whole life. An error emitted while
 * write() returned true would otherwise reach nobody: a later write waits for
 * a 'drain' a destroyed stream never emits, and whatever awaits the writer —
 * a job queue — waits forever.
 */
function guard(writable) {
    let failure = null;
    let fail;
    const failed = new Promise((_, reject) => { fail = reject; });
    failed.catch(() => {});
    writable.on('error', (err) => {
        failure = failure ?? err;
        fail(failure);
    });
    return {
        check() { if (failure) throw failure; },
        race(promise) { return Promise.race([promise, failed]); },
    };
}

async function writeChunk(writable, chunk, watch) {
    watch.check();
    if (!writable.write(chunk)) await watch.race(once(writable, 'drain'));
    watch.check();
}

/**
 * A tar writer over a Node writable stream. Entries are written in call order;
 * await each call before the next.
 *
 * @param {import('node:stream').Writable} writable
 * @param {{mtime?: Date}} [opts]  one timestamp for every entry (deterministic output)
 */
export function createTarWriter(writable, { mtime = new Date(0) } = {}) {
    const mtimeSeconds = Math.floor(mtime.getTime() / 1000);
    const watch = guard(writable);
    const write = (chunk) => writeChunk(writable, chunk, watch);
    const pad = async (size) => {
        const rest = size % BLOCK;
        if (rest) await write(Buffer.alloc(BLOCK - rest, 0));
    };
    return {
        /** Add an entry from memory. */
        async addBuffer(name, buffer) {
            await write(buildHeader(name, buffer.length, mtimeSeconds));
            if (buffer.length) await write(buffer);
            await pad(buffer.length);
        },
        /**
         * Add an entry from a readable stream of exactly `size` bytes. A
         * stream that yields more or fewer bytes is an error: the header is
         * already written, and a wrong length would corrupt every later entry.
         */
        async addStream(name, size, readable) {
            await write(buildHeader(name, size, mtimeSeconds));
            let written = 0;
            for await (const chunk of readable) {
                written += chunk.length;
                if (written > size) throw new TarError(`entry ${name} is longer than declared`, 'tar_size');
                await write(chunk);
            }
            if (written !== size) throw new TarError(`entry ${name} is shorter than declared`, 'tar_size');
            await pad(size);
        },
        /** Write the end-of-archive marker and end the stream. */
        async finish() {
            await write(Buffer.alloc(BLOCK * 2, 0));
            const finished = once(writable, 'finish');
            writable.end();
            await watch.race(finished);
        },
        /** Stop writing and release the stream after a failure. */
        abort(err) {
            writable.destroy(err);
        },
    };
}

function readString(header, offset, length) {
    const end = header.indexOf(0, offset);
    return header.toString('utf8', offset, end === -1 || end > offset + length ? offset + length : end);
}

function readOctal(header, offset, length) {
    const text = readString(header, offset, length).trim();
    if (!/^[0-7]+$/.test(text)) throw new TarError('tar header has a non-octal number field');
    return parseInt(text, 8);
}

function parseHeader(header) {
    const stored = readOctal(header, 148, 8);
    if (stored !== headerChecksum(header)) throw new TarError('tar header checksum mismatch');
    const type = header[156];
    // '0' and the pre-POSIX NUL both mean a regular file; everything else —
    // links, directories, devices, FIFOs, pax/GNU extension headers — is refused.
    if (type !== 0x30 && type !== 0) {
        throw new TarError(`tar entry type '${String.fromCharCode(type) || 'NUL'}' is not a regular file`, 'tar_entry_type');
    }
    // A ustar prefix field would let a name exceed what this reader checks.
    if (readString(header, 345, 155) !== '') throw new TarError('tar entry uses a name prefix', 'tar_name');
    const size = readOctal(header, 124, 12);
    if (size > MAX_SIZE) throw new TarError('tar entry is too large', 'tar_size');
    return { name: readString(header, 0, 100), size };
}

/**
 * Read a tar stream entry by entry.
 *
 * `onEntry({name, size})` must return a sink `{ write(chunk): Promise|void,
 * end(): Promise|void, abort?(): Promise|void }` that receives exactly that
 * entry's bytes, or throw to
 * refuse the entry (which aborts the read). The reader stops at the
 * end-of-archive marker; data after it, or a stream that ends before it, is an
 * error.
 *
 * @param {AsyncIterable<Buffer>} readable
 * @param {(entry: {name: string, size: number}) => Promise<{write: Function, end: Function}>|{write: Function, end: Function}} onEntry
 * @returns {Promise<number>} the number of entries read
 */
export async function readTar(readable, onEntry) {
    const state = { buffered: Buffer.alloc(0), entry: null, entries: 0, zeroBlocks: 0, ended: false };
    try {
        for await (const chunk of readable) await consume(state, chunk, onEntry);
    } catch (err) {
        // An entry cut off mid-way — by truncation, a refused name, a sink that
        // threw — must release what its sink holds open (a file descriptor,
        // and the disk an unlinked file still occupies).
        if (state.entry && !state.entry.closed) await state.entry.sink.abort?.();
        throw err;
    }
    if (!state.ended) {
        if (state.entry && !state.entry.closed) await state.entry.sink.abort?.();
        throw new TarError('tar archive ended early', 'tar_truncated');
    }
    return state.entries;
}

/** Feed one chunk through the header/data/padding state machine. */
async function consume(state, chunk, onEntry) {
    if (state.ended) {
        if (chunk.some((byte) => byte !== 0)) throw new TarError('data after the end of the archive');
        return;
    }
    let buffered = state.buffered.length ? Buffer.concat([state.buffered, chunk]) : chunk;
    let offset = 0;
    while (!state.ended) {
        const { entry } = state;
        if (entry) {
            if (entry.remaining > 0) {
                const take = Math.min(entry.remaining, buffered.length - offset);
                if (take === 0) break;
                await entry.sink.write(buffered.subarray(offset, offset + take));
                offset += take;
                entry.remaining -= take;
                if (entry.remaining > 0) break;
            }
            if (!entry.closed) {
                entry.closed = true;
                await entry.sink.end();
            }
            const skip = Math.min(entry.padding, buffered.length - offset);
            offset += skip;
            entry.padding -= skip;
            if (entry.padding > 0) break;
            state.entry = null;
            continue;
        }
        if (buffered.length - offset < BLOCK) break;
        const header = buffered.subarray(offset, offset + BLOCK);
        offset += BLOCK;
        if (header.every((byte) => byte === 0)) {
            state.zeroBlocks += 1;
            if (state.zeroBlocks === 2) state.ended = true;
            continue;
        }
        if (state.zeroBlocks) throw new TarError('tar archive has a lone zero block');
        const parsed = parseHeader(header);
        state.entries += 1;
        const sink = await onEntry(parsed);
        state.entry = { sink, remaining: parsed.size, padding: (BLOCK - (parsed.size % BLOCK)) % BLOCK, closed: false };
    }
    buffered = buffered.subarray(offset);
    if (state.ended && buffered.some((byte) => byte !== 0)) throw new TarError('data after the end of the archive');
    state.buffered = state.ended ? Buffer.alloc(0) : buffered;
}
