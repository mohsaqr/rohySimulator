// Case packages: one `.rohycase` file that moves a whole case — its document
// AND its media — from one Rohy server to another.
//
// A package is a tar (lib/tarStream.js) of exactly:
//   case.json      the case document (services/caseTransfer.js)
//   manifest.json  what media the case uses and where each file belongs
//   course.json    the case's course and its lessons, when it has one
//                  (services/caseCourseTransfer.js; the manifest says so)
//   media/<sha256> each carried file once, named by its own hash
//
// What travels, by where the file lives on the source:
//   - /uploads (radiology images and videos, exam audio): carried.
//   - a plugin's managed library (pathology slides an educator imported):
//     carried — tiles, preview and the plugin_assets row (its calibration) —
//     never the scanner original under source/.
//   - remote content (`remote:` paths served from the starter bundle or a
//     content origin): REFERENCED by path + SHA-256 of every file, so the
//     import can tell whether the target has the very same files. Content Rohy
//     ships is never carried. Content a deployment's own origin serves is
//     carried for plugins that have a library to receive it (pathology); for
//     the rest (PACS) there is nowhere on a target to put it, so it is
//     referenced and the import says what is missing.
//   - inline media (ECG traces, embedded photos) is part of case.json already.
//
// Import never trusts the package: names are an allowlist, every file must be
// one the manifest declares and must hash to its name, uploads must be a type
// the upload route accepts AND look like one, every library path matches a
// fixed pattern, and nothing is written until the whole package has been read
// and checked. Then files are placed, the database is written in one short
// transaction, and the placed files are removed again if that fails.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import dbAdapter from '../dbAdapter.js';
import { dbPath } from '../db.js';
import { logger } from '../logger.js';
import { createTarWriter, readTar, tarArchiveBytes, TarError } from '../lib/tarStream.js';
import { libraryDirs } from '../lib/pluginServerSlot.js';
import { pluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { originRequestHeaders } from '../lib/pluginOriginTokens.js';
import { starterContentDir } from '../routes/plugins-routes.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { nowIso } from '../shared/time.js';
import { caseCodeFor } from '../shared/caseCode.js';
import { attachStandingSpecialists } from './standingSpecialists.js';
import { buildCourseDocument, courseUploadNames, insertCourse, readCourseDocument, rewriteCourseUploads } from './caseCourseTransfer.js';
import { auditSuccess, createCaseVersion, logAudit } from '../routes/_helpers.js';
import { normaliseCaseForStorage, pinCaseLanguage } from '../routes/cases-routes.js';
import {
    APP_VERSION,
    buildCaseDocument,
    insertCaseRelated,
    prepareCaseRelated,
    readCaseDocument,
} from './caseTransfer.js';

const log = logger('case-packages');

export const PACKAGE_FORMAT = 'rohy.case-package';
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = '.rohycase';
export const CHUNK_BYTES = 16 * 1024 * 1024;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const JSON_ENTRY_MAX_BYTES = 64 * MIB;
// A Deep Zoom descriptor is a few hundred bytes of XML. It is the one carried
// file the import reads whole (dziSize), so a "descriptor" the size of the
// package would be read into memory at once.
const DZI_MAX_BYTES = 64 * 1024;
const JOB_TTL_MS = 60 * 60 * 1000;
const ORIGIN_TIMEOUT_MS = 30_000;
const SHA_RE = /^[0-9a-f]{64}$/;

export const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads');

// The extensions POST /api/upload accepts (routes/uploads-routes.js). A
// package may place nothing in the public uploads directory that the upload
// route itself would refuse — in particular no SVG or HTML, which a browser
// would run as script on this origin.
const UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp3', '.wav', '.ogg', '.webm', '.m4a',
    '.mp4', '.mov', '.avi', '.ogv', '.mpeg', '.mpg'];
// The documents POST /api/uploads/file accepts for lessons. They travel with
// a case's course, and each must start like the document its name says.
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.csv', '.zip'];
const UPLOAD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
// A reference to THIS server's uploads is a whole string value, relative —
// `./uploads/x.png` or `/uploads/x.png`. A URL on another host that happens
// to contain /uploads/ is not ours: never collected, never rewritten.
const UPLOAD_REF_RE = /^(\.?\/uploads\/)([A-Za-z0-9][A-Za-z0-9._-]*)$/;

// The only shape a library asset's files may take on a target. Pathology's
// importer writes exactly this (server/plugins/pathology/importSlide.js
// assetPaths); `gross.*` is a specimen photo carried from a content origin.
const LIBRARY_FILE_RE = /^(slide\.dzi|preview\.jpg|gross\.(jpe?g|png|webp)|slide_files\/\d{1,2}\/\d{1,6}_\d{1,6}\.(jpe?g|png|webp))$/;
const ASSET_ID_RE = /^asset-[0-9a-f]{24}$/;

/** A refused package or a failed step. `status` is the HTTP status a route should answer with. */
export class PackageError extends Error {
    constructor(message, code, status = 400) {
        super(message);
        this.name = 'PackageError';
        this.code = code;
        this.status = status;
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// How many files are read, hashed or copied at once. A deep-zoom slide is
// tens of thousands of small tiles; one at a time, each open/read/close pays
// the disk's full latency (FI-0010: 71,200 files, minutes per phase).
const IO_CONCURRENCY = 8;
// A carried file up to this size is held in memory while it is checked and
// written in one call; larger ones stream. At IO_CONCURRENCY pending writes
// that is at most 32 MB in flight.
const SMALL_FILE_BYTES = 4 * MIB;
// How often a job's progress is published. Progress is counted per file;
// publishing every one would be 71,200 updates for one slide library.
const PROGRESS_INTERVAL_MS = 500;

// What an operating system leaves in a folder it has shown — never part of
// a slide. Finder writes .DS_Store (and ._* AppleDouble files on foreign
// disks), Windows Thumbs.db / desktop.ini. A slide's identity is its layout
// files, so these are skipped wherever a library folder is listed — export
// and the "is this slide already here?" comparison (FI-0010 F12: a .DS_Store
// made every re-import copy 3 GB again). An import never places one: only
// names matching LIBRARY_FILE_RE / UPLOAD_NAME_RE are placed.
const HOUSEKEEPING_NAMES = new Set([
    '.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini',
    '.spotlight-v100', '.trashes', '.fseventsd', '.temporaryitems', '__macosx',
]);
/** Is `name` (one path segment) a file or folder an operating system left behind? */
export const isHousekeeping = (name) => name.startsWith('._') || HOUSEKEEPING_NAMES.has(name.toLowerCase());

/**
 * Run `work` over `items`, at most `limit` at a time. Stops taking new items
 * at the first failure, waits for the ones already running — so a caller's
 * cleanup never races a write still in flight — then throws that failure.
 */
async function eachLimit(items, limit, work) {
    let next = 0;
    let failure = null;
    const worker = async () => {
        while (failure === null && next < items.length) {
            const index = next;
            next += 1;
            try {
                await work(items[index], index);
            } catch (err) {
                failure ??= err;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (failure !== null) throw failure;
}

/**
 * Writes started without waiting for them, at most `limit` at a time. `add`
 * waits only for a free slot; `settle` waits for every write and then throws
 * the first failure, if any.
 */
function writePool(limit) {
    const pending = new Set();
    let failure = null;
    return {
        async add(task) {
            while (pending.size >= limit) await Promise.race(pending);
            if (failure !== null) throw failure;
            const running = task()
                .catch((err) => { failure ??= err; })
                .finally(() => pending.delete(running));
            pending.add(running);
        },
        async settle() {
            await Promise.all(pending);
            if (failure !== null) throw failure;
        },
    };
}

/**
 * Within-phase progress: files and bytes done of a total, published at most
 * every PROGRESS_INTERVAL_MS (and always at a phase's start, its first file
 * and its end).
 * `onProgress` receives `{phase, done, total, bytes_done, bytes_total}`;
 * totals are null while unknown.
 */
function progressReporter(onProgress) {
    let current = { phase: null, done: 0, total: null, bytes_done: 0, bytes_total: null };
    let lastPublished = 0;
    const publish = (force) => {
        const now = Date.now();
        if (!force && now - lastPublished < PROGRESS_INTERVAL_MS) return;
        lastPublished = now;
        onProgress({ ...current });
    };
    return {
        phase(phase, { files = null, bytes = null } = {}) {
            current = { phase, done: 0, total: files, bytes_done: 0, bytes_total: bytes };
            publish(true);
        },
        totals({ files = current.total, bytes = current.bytes_total }) {
            current.total = files;
            current.bytes_total = bytes;
            publish(true);
        },
        advance(files, bytes = 0) {
            const first = current.done === 0;
            current.done += files;
            current.bytes_done += bytes;
            // The first file is always published — the count visibly starts —
            // and so is the last.
            publish(first || (current.total !== null && current.done >= current.total));
        },
    };
}

/**
 * Advance `progress` by at most `files`/`bytes` in total, however often
 * `tick` is called — a slide compared against two candidates on disk still
 * counts once. `finish` makes up the rest.
 */
function boundedTicker(progress, files, bytes) {
    let filesLeft = files;
    let bytesLeft = bytes;
    const tick = (f, b) => {
        const df = Math.min(f, filesLeft);
        const db = Math.min(b, bytesLeft);
        filesLeft -= df;
        bytesLeft -= db;
        if (df > 0 || db > 0) progress.advance(df, db);
    };
    return { tick, finish: () => tick(filesLeft, bytesLeft) };
}

/** A cancellation that never fires: what a caller without a job gets. */
const NOT_CANCELLABLE = Object.freeze({ check() {}, commit() {} });

/** The import or export was cancelled before anything was kept. */
const cancelledError = () => new PackageError('Cancelled; nothing was created', 'case_package_cancelled', 409);

// ---- Settings and places -----------------------------------------------------

/** Where packages are staged: beside the database, on persistent disk — not /tmp, which may be RAM. */
export function workDir() {
    return process.env.ROHY_CASE_PACKAGE_DIR
        ? path.resolve(process.env.ROHY_CASE_PACKAGE_DIR)
        : path.join(path.dirname(path.resolve(dbPath)), 'case-packages');
}

export function maxPackageBytes() {
    const configured = Number(process.env.ROHY_CASE_PACKAGE_MAX_BYTES);
    return Number.isFinite(configured) && configured > 0 ? configured : 4 * GIB;
}

/** Disk that must stay free after any package write, so a package can never fill the server's disk. */
function freeSpaceMargin() {
    const configured = Number(process.env.ROHY_CASE_PACKAGE_MIN_FREE_BYTES);
    return Number.isFinite(configured) && configured >= 0 ? configured : 1 * GIB;
}

export async function casePackagesEnabled() {
    const row = await dbAdapter.get(
        "SELECT setting_value FROM platform_settings WHERE setting_key = 'case_packages_enabled'",
        []
    );
    return row?.setting_value === 'true';
}

// Disk promised to work already admitted but not yet written — an upload in
// flight and the unpacked copy it will need. Every free-space check subtracts
// it, so two uploads that each fit cannot together fill the disk.
const reservations = new Map();
const reservedBytes = () => [...reservations.values()].reduce((sum, bytes) => sum + bytes, 0);

/** The bytes free on `dir`'s filesystem, before any reservation. */
async function diskFree(dir) {
    await fsp.mkdir(dir, { recursive: true });
    const stats = await fsp.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
}

/** Synchronous: refuse when `bytes` more, after what is reserved, would leave less than the margin of `diskBytes` free. */
function checkFreeSpace(diskBytes, bytes, what) {
    const free = diskBytes - reservedBytes();
    if (free - bytes < freeSpaceMargin()) {
        throw new PackageError(
            `Not enough disk space for ${what}: needs ${Math.ceil(bytes / MIB)} MB plus ${Math.ceil(freeSpaceMargin() / MIB)} MB kept free, ${Math.floor(free / MIB)} MB available`,
            'case_package_no_space',
            507
        );
    }
}

/** Refuse when writing `bytes` into `dir` would leave less than the margin free. */
async function assertFreeSpace(dir, bytes, what) {
    checkFreeSpace(await diskFree(dir), bytes, what);
}

/**
 * Check for `bytes` and reserve them under `key` as ONE step. The disk query
 * is the only await; the check and the reservation run in the same tick
 * after it, so a concurrent request cannot pass the check before this one's
 * reservation is counted. The caller must delete `key` on every exit path.
 */
async function reserveFreeSpace(dir, key, bytes, what) {
    const diskBytes = await diskFree(dir);
    checkFreeSpace(diskBytes, bytes, what);
    reservations.set(key, bytes);
}

/**
 * Check several destinations at once. Bytes going to the same filesystem are
 * SUMMED first: two slides that each fit can together cross the margin.
 *
 * @param {Array<{dir: string, bytes: number}>} writes
 */
async function assertFreeSpaceFor(writes, what) {
    const byDevice = new Map();
    for (const { dir, bytes } of writes) {
        if (!bytes) continue;
        await fsp.mkdir(dir, { recursive: true });
        const { dev } = await fsp.stat(dir);
        const entry = byDevice.get(dev) ?? { dir, bytes: 0 };
        entry.bytes += bytes;
        byDevice.set(dev, entry);
    }
    for (const { dir, bytes } of byDevice.values()) await assertFreeSpace(dir, bytes, what);
}

let workDirSweep = null;
/**
 * The work directory, emptied once per process: jobs live in memory, so
 * anything left by a previous process is an orphan. The sweep is a promise
 * every caller awaits: a flag set before the sweep finished let a second
 * upload starting at the same moment write into the directory while it was
 * still being removed (EINVAL on open — the first two concurrent uploads
 * after a boot).
 */
async function ensureWorkDir() {
    const dir = workDir();
    workDirSweep ??= fsp.rm(dir, { recursive: true, force: true });
    await workDirSweep;
    await fsp.mkdir(dir, { recursive: true });
    return dir;
}

// ---- Collecting what a case uses ------------------------------------------------

function walkStrings(value, visit) {
    if (typeof value === 'string') visit(value);
    else if (Array.isArray(value)) value.forEach((item) => walkStrings(item, visit));
    else if (isPlainObject(value)) Object.values(value).forEach((item) => walkStrings(item, visit));
}

function walkObjects(value, visit) {
    if (Array.isArray(value)) value.forEach((item) => walkObjects(item, visit));
    else if (isPlainObject(value)) {
        visit(value);
        Object.values(value).forEach((item) => walkObjects(item, visit));
    }
}

/** Every /uploads file name the case points at. */
function uploadNames(doc) {
    const names = new Set();
    walkStrings([doc.case.config, doc.case.scenario, doc.related], (s) => {
        const match = UPLOAD_REF_RE.exec(s);
        if (match) names.add(match[2]);
    });
    return [...names].sort();
}

async function hashFile(file) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(file)) {
        hash.update(chunk);
        bytes += chunk.length;
    }
    return { sha256: hash.digest('hex'), bytes };
}

/**
 * Regular files under `root`, as POSIX relative paths, skipping `source/`
 * (scanner originals) and anything an operating system left behind.
 */
async function listAssetFiles(root) {
    const out = [];
    async function walk(relative) {
        const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true });
        for (const entry of entries) {
            if (isHousekeeping(entry.name)) continue;
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (rel !== 'source') await walk(rel);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    }
    await walk('');
    return out.sort();
}

/**
 * The files that ARE the slide: the library layout (LIBRARY_FILE_RE). What
 * export carries and what a re-import compares — the same set on both sides,
 * so scanner metadata (vips-properties.xml) and housekeeping never decide
 * whether two slides are the same.
 */
async function layoutFiles(root) {
    return (await listAssetFiles(root)).filter((rel) => LIBRARY_FILE_RE.test(rel));
}

function digestOf(files) {
    return sha256(files.map((f) => `${f.path}\u0000${f.sha256}\n`).sort().join(''));
}

/** Hash `rels` under `root`, IO_CONCURRENCY at a time, in `rels` order. */
async function hashFiles(root, rels) {
    const files = new Array(rels.length);
    await eachLimit(rels, IO_CONCURRENCY, async (rel, index) => {
        files[index] = { path: rel, ...await hashFile(path.join(root, rel)) };
    });
    return files;
}

/**
 * Does the library folder `root` hold exactly `files` (path + sha256)?
 * Paths and sizes are compared first — free next to hashing tens of
 * thousands of tiles — and hashing stops at the first difference.
 * `tick(files, bytes)` is called for every file hashed.
 */
async function sameAssetFiles(root, files, tick = () => {}) {
    const onDisk = await layoutFiles(root);
    if (onDisk.length !== files.length) return false;
    const wanted = new Map(files.map((f) => [f.path, f]));
    if (onDisk.some((rel) => !wanted.has(rel))) return false;
    let same = true;
    await eachLimit(onDisk, IO_CONCURRENCY, async (rel) => {
        if (!same) return;
        const { size } = await fsp.stat(path.join(root, rel));
        if (size !== wanted.get(rel).bytes) same = false;
    });
    if (!same) return false;
    await eachLimit(onDisk, IO_CONCURRENCY, async (rel) => {
        if (!same) return;
        const hashed = await hashFile(path.join(root, rel));
        tick(1, hashed.bytes);
        if (hashed.sha256 !== wanted.get(rel).sha256) same = false;
    });
    return same;
}

/** Plugins whose remote content includes a managed library. */
const libraryPlugins = () => PLUGIN_MANIFESTS.filter((m) => m.remote?.paths?.includes('/library')).map((m) => m.id);
const remotePlugins = () => PLUGIN_MANIFESTS.filter((m) => m.remote).map((m) => m.id);

/**
 * What a plugin's remote content is served from on THIS server, with the
 * per-file SHA-256 list (`content.json`) that both the starter bundle and a
 * content origin publish.
 */
async function contentListing(pluginId) {
    const origin = pluginOrigins().get(pluginId);
    let raw = null;
    let source = 'none';
    if (origin) {
        source = 'origin';
        try {
            const res = await fetch(`${origin}/content.json`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
                headers: originRequestHeaders(pluginId, { accept: 'application/json' }),
            });
            if (res.ok) raw = await res.json();
            else log.warn('content origin listing unavailable', { pluginId, status: res.status });
        } catch (err) {
            log.warn('content origin listing failed', { pluginId, error: err.message });
        }
    } else {
        const dir = starterContentDir(pluginId);
        if (dir) {
            source = 'starter';
            raw = JSON.parse(await fsp.readFile(path.join(dir, 'content.json'), 'utf8'));
        }
    }
    const files = new Map();
    for (const file of Array.isArray(raw?.files) ? raw.files : []) {
        if (typeof file?.path === 'string' && SHA_RE.test(file.sha256 ?? '')) {
            files.set(file.path.replace(/^\/+/, ''), { sha256: file.sha256, bytes: Number(file.bytes) || 0 });
        }
    }
    return { pluginId, source, origin: origin ?? null, starterDir: source === 'starter' ? starterContentDir(pluginId) : null, files, available: raw !== null };
}

/** The files a `remote:` path stands for: a directory, a deep-zoom pyramid, or one file. */
function expandRemotePath(contentPath, listing) {
    if (contentPath.endsWith('/')) {
        return [...listing.files.keys()].filter((p) => p.startsWith(contentPath)).sort();
    }
    if (contentPath.endsWith('.dzi')) {
        const tiles = `${contentPath.slice(0, -4)}_files/`;
        return [contentPath, ...[...listing.files.keys()].filter((p) => p.startsWith(tiles)).sort()];
    }
    return [contentPath];
}

/** `remote:` paths in a plugin's document, plus PACS-style archive entries resolved through the catalogue. */
async function remotePathsFor(pluginId, pluginDoc, listing) {
    const paths = new Set();
    walkStrings(pluginDoc, (s) => {
        if (s.startsWith('remote:') && !s.startsWith('remote:library/')) paths.add(s.slice('remote:'.length).replace(/^\/+/, ''));
    });
    const archiveIds = new Set();
    walkObjects(pluginDoc, (obj) => {
        if (obj.kind === 'archive' && typeof obj.ref === 'string') archiveIds.add(obj.ref);
    });
    if (archiveIds.size > 0) {
        const catalog = await readCatalog(pluginId, listing);
        const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
        for (const id of archiveIds) {
            const entry = entries.find((e) => e?.id === id);
            walkStrings(entry, (s) => {
                if (s.startsWith('remote:')) paths.add(s.slice('remote:'.length).replace(/^\/+/, ''));
            });
        }
    }
    return [...paths].sort();
}

async function readCatalog(pluginId, listing) {
    try {
        if (listing.source === 'starter') {
            return JSON.parse(await fsp.readFile(path.join(listing.starterDir, 'catalog.json'), 'utf8'));
        }
        if (listing.source === 'origin') {
            const res = await fetch(`${listing.origin}/catalog.json`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
                headers: originRequestHeaders(pluginId, { accept: 'application/json' }),
            });
            return res.ok ? await res.json() : null;
        }
    } catch (err) {
        log.warn('plugin catalogue unreadable while packaging', { pluginId, error: err.message });
    }
    return null;
}

/** Fetch one origin file into `dest`, verifying its hash. */
async function fetchOriginFile({ pluginId, origin, contentPath, expectedSha, dest }) {
    const res = await fetch(`${origin}/${contentPath}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
        headers: originRequestHeaders(pluginId),
    });
    if (!res.ok || !res.body) throw new PackageError(`Content origin answered ${res.status} for ${contentPath}`, 'case_package_origin_failed', 502);
    const hash = createHash('sha256');
    await pipeline(Readable.fromWeb(res.body), async function* tee(source) {
        for await (const chunk of source) {
            hash.update(chunk);
            yield chunk;
        }
    }, fs.createWriteStream(dest));
    const got = hash.digest('hex');
    if (got !== expectedSha) {
        throw new PackageError(`Content origin served ${contentPath} with a different checksum than it lists`, 'case_package_origin_checksum', 502);
    }
}

/**
 * Work out everything a case's package must carry or reference.
 *
 * @returns {Promise<{manifest: object, sources: Map<string, {file: string}>, notes: object[]}>}
 *   `sources` maps a SHA-256 to the local file holding those bytes.
 */
async function collectMedia({ doc, course, tenant, scratch }) {
    const notes = [];
    const sources = new Map();

    const uploads = [];
    for (const name of [...new Set([...uploadNames(doc), ...courseUploadNames(course)])].sort()) {
        const file = path.join(UPLOADS_DIR, name);
        const stat = await fsp.stat(file).catch(() => null);
        if (!stat?.isFile()) {
            notes.push({ field: 'media', received: `/uploads/${name}`, hint: 'Referenced by the case but missing on this server; not carried.' });
            continue;
        }
        const hashed = await hashFile(file);
        uploads.push({ name, ...hashed });
        sources.set(hashed.sha256, { file });
    }

    const library = [];
    for (const pluginId of libraryPlugins()) {
        const ids = new Set();
        walkStrings(doc.case.config?.[pluginId], (s) => {
            const match = /^remote:library\/([^/]+)\//.exec(s);
            if (match) ids.add(match[1]);
        });
        const libDir = libraryDirs().get(pluginId);
        for (const assetId of [...ids].sort()) {
            const row = await dbAdapter.get(
                `SELECT label, state, native_objective, native_mpp_x, native_mpp_y, tiled_objective, width, height
                   FROM plugin_assets WHERE id = ? AND plugin_id = ? AND tenant_id = ?`,
                [assetId, pluginId, tenant]
            );
            const root = libDir && ASSET_ID_RE.test(assetId) ? path.join(libDir, assetId) : null;
            const exists = root ? (await fsp.stat(root).catch(() => null))?.isDirectory() : false;
            if (!row || !exists) {
                notes.push({ field: `config.${pluginId}`, received: `remote:library/${assetId}/`, hint: 'This slide is not in this server\'s library; not carried.' });
                continue;
            }
            const files = await hashFiles(root, await layoutFiles(root));
            files.forEach((f) => sources.set(f.sha256, { file: path.join(root, f.path) }));
            library.push({ plugin: pluginId, asset_id: assetId, row, files, digest: digestOf(files) });
        }
    }

    const remote = [];
    for (const pluginId of remotePlugins()) {
        const pluginDoc = doc.case.config?.[pluginId];
        if (!pluginDoc) continue;
        const listing = await contentListing(pluginId);
        const contentPaths = await remotePathsFor(pluginId, pluginDoc, listing);
        if (contentPaths.length === 0) continue;
        if (!listing.available) {
            contentPaths.forEach((p) => notes.push({ field: `config.${pluginId}`, received: `remote:${p}`, hint: 'This server has no listing of its content for this plugin; referenced without checksums.' }));
        }
        // Content Rohy ships (the starter bundle) is on every install that has
        // the content; a deployment's own origin may hold more. Only the latter
        // is carried, and only where a target has a library to receive it.
        const carry = listing.source === 'origin' && libraryPlugins().includes(pluginId);
        for (const contentPath of contentPaths) {
            const files = [];
            for (const p of expandRemotePath(contentPath, listing)) {
                const known = listing.files.get(p);
                if (known) files.push({ path: p, sha256: known.sha256, bytes: known.bytes });
            }
            if (listing.available && files.length === 0) {
                notes.push({ field: `config.${pluginId}`, received: `remote:${contentPath}`, hint: 'Not found in this server\'s content; referenced as is.' });
            }
            let carried = false;
            if (carry && files.length > 0 && (contentPath.endsWith('.dzi') || /\.(jpe?g|png|webp)$/.test(contentPath))) {
                await assertFreeSpace(scratch, files.reduce((sum, f) => sum + f.bytes, 0), 'fetching slides from the content origin');
                for (const f of files) {
                    if (sources.has(f.sha256)) continue;
                    const dest = path.join(scratch, f.sha256);
                    await fetchOriginFile({ pluginId, origin: listing.origin, contentPath: f.path, expectedSha: f.sha256, dest });
                    sources.set(f.sha256, { file: dest });
                }
                carried = true;
            } else if (listing.source === 'origin' && files.length > 0) {
                notes.push({ field: `config.${pluginId}`, received: `remote:${contentPath}`, hint: 'Served by this server\'s own content origin and not carried; the receiving server needs the same content.' });
            }
            remote.push({ plugin: pluginId, path: contentPath, source: listing.source, carried, files, digest: files.length ? digestOf(files) : null });
        }
    }

    const manifest = {
        format: PACKAGE_FORMAT,
        format_version: PACKAGE_VERSION,
        created_at: nowIso(),
        app_version: APP_VERSION,
        uploads,
        library,
        remote,
        ...(course ? { course: { lessons: course.lessons.length } } : {}),
    };
    return { manifest, sources, notes };
}

// ---- Export -------------------------------------------------------------------

/**
 * Build the package for one case into `outFile`.
 *
 * @returns {Promise<{name: string, caseCode: string|null, bytes: number, notes: object[], counts: object}>}
 * @throws {PackageError} 404 when the case is not this tenant's; 507 when the disk is short
 */
export async function buildCasePackage({ caseId, tenant, outFile, onProgress = () => {}, cancellation = NOT_CANCELLABLE }) {
    const doc = await buildCaseDocument({ caseId, tenant });
    if (!doc) throw new PackageError('Case not found', 'case_not_found', 404);
    const scratch = `${outFile}.scratch`;
    await fsp.mkdir(scratch, { recursive: true });
    const progress = progressReporter(onProgress);
    try {
        progress.phase('collecting');
        const { course, notes: courseNotes } = await buildCourseDocument({ caseId, tenant });
        const { manifest, sources, notes: mediaNotes } = await collectMedia({ doc, course, tenant, scratch });
        cancellation.check();
        const notes = [...courseNotes, ...mediaNotes];
        const unique = [...sources.entries()];
        // Each file's size is taken ONCE and written into its header; a file
        // that changes afterwards is a length mismatch the writer refuses,
        // so the archive is exactly `archiveBytes`.
        const sizes = (await Promise.all(unique.map(([, s]) => fsp.stat(s.file)))).map((s) => s.size);
        const caseJson = Buffer.from(JSON.stringify(doc));
        const manifestJson = Buffer.from(JSON.stringify(manifest));
        const courseJson = course ? Buffer.from(JSON.stringify(course)) : null;
        // The limit an upload is held to is the WHOLE archive (createUpload),
        // so export holds itself to the same: headers, padding and the JSON
        // count, not only the media — anything exported can be imported.
        const archiveBytes = tarArchiveBytes([caseJson.length, manifestJson.length, ...(courseJson ? [courseJson.length] : []), ...sizes]);
        if (archiveBytes > maxPackageBytes()) {
            throw new PackageError(`This case's package would be ${Math.ceil(archiveBytes / MIB)} MB, above the ${Math.floor(maxPackageBytes() / MIB)} MB package limit`, 'case_package_too_large', 413);
        }
        await assertFreeSpace(path.dirname(outFile), archiveBytes, 'the package');

        const writer = createTarWriter(fs.createWriteStream(outFile));
        try {
            await writer.addBuffer('case.json', caseJson);
            await writer.addBuffer('manifest.json', manifestJson);
            if (courseJson) await writer.addBuffer('course.json', courseJson);
            progress.phase('writing', { files: unique.length, bytes: sizes.reduce((sum, size) => sum + size, 0) });
            // Sequential by nature: one archive, written in order.
            for (const [index, [sha, source]] of unique.entries()) {
                cancellation.check();
                await writer.addStream(`media/${sha}`, sizes[index], fs.createReadStream(source.file));
                progress.advance(1, sizes[index]);
            }
            await writer.finish();
        } catch (err) {
            // A source that vanished, errored or changed length: close the
            // output before the job unlinks it, or the open descriptor keeps
            // the half-written package's disk allocated.
            await writer.abort();
            throw err;
        }
        const { size } = await fsp.stat(outFile);
        if (size !== archiveBytes) {
            throw new Error(`case package is ${size} bytes, expected ${archiveBytes}`);
        }
        return {
            name: doc.case.name,
            caseCode: doc.rohy_export.source_case_code ?? null,
            bytes: size,
            notes,
            counts: {
                uploads: manifest.uploads.length,
                slides: manifest.library.length + manifest.remote.filter((r) => r.carried).length,
                referenced: manifest.remote.filter((r) => !r.carried).length,
                lessons: course?.lessons.length ?? 0,
            },
        };
    } finally {
        await fsp.rm(scratch, { recursive: true, force: true });
    }
}

// ---- Import: reading and checking ----------------------------------------------------

function readManifest(raw) {
    if (!isPlainObject(raw) || raw.format !== PACKAGE_FORMAT) {
        throw new PackageError('Not a Rohy case package', 'invalid_case_package');
    }
    if (raw.format_version !== PACKAGE_VERSION) {
        throw new PackageError(
            raw.format_version > PACKAGE_VERSION
                ? `This package was made by a newer Rohy (package format ${raw.format_version}); this server reads ${PACKAGE_VERSION}`
                : `Unsupported package format ${raw.format_version}`,
            'unsupported_case_package'
        );
    }
    const list = (key) => {
        if (!Array.isArray(raw[key] ?? [])) throw new PackageError(`manifest.${key} must be an array`, 'invalid_case_package');
        return raw[key] ?? [];
    };
    const fileList = (files, where) => {
        if (!Array.isArray(files)) throw new PackageError(`${where}.files must be an array`, 'invalid_case_package');
        files.forEach((f) => {
            if (!isPlainObject(f) || typeof f.path !== 'string' || !SHA_RE.test(f.sha256 ?? '') || !Number.isSafeInteger(f.bytes) || f.bytes < 0) {
                throw new PackageError(`${where} has a malformed file entry`, 'invalid_case_package');
            }
            if (f.path.endsWith('.dzi') && f.bytes > DZI_MAX_BYTES) {
                throw new PackageError(`${where} has a slide descriptor larger than ${DZI_MAX_BYTES} bytes`, 'invalid_case_package');
            }
        });
        return files;
    };
    const uploads = list('uploads').map((u, i) => {
        if (!isPlainObject(u) || !UPLOAD_NAME_RE.test(u.name ?? '') || !SHA_RE.test(u.sha256 ?? '') || !Number.isSafeInteger(u.bytes)) {
            throw new PackageError(`manifest.uploads[${i}] is malformed`, 'invalid_case_package');
        }
        return u;
    });
    const assetIds = new Set();
    const library = list('library').map((a, i) => {
        const where = `manifest.library[${i}]`;
        if (!isPlainObject(a) || !libraryPlugins().includes(a.plugin) || !ASSET_ID_RE.test(a.asset_id ?? '') || !isPlainObject(a.row)) {
            throw new PackageError(`${where} is malformed`, 'invalid_case_package');
        }
        if (assetIds.has(a.asset_id)) throw new PackageError(`${where} repeats slide ${a.asset_id}`, 'invalid_case_package');
        assetIds.add(a.asset_id);
        fileList(a.files, where).forEach((f) => {
            if (!LIBRARY_FILE_RE.test(f.path)) throw new PackageError(`${where} names a file outside the library layout: ${f.path}`, 'invalid_case_package');
        });
        return a;
    });
    const remote = list('remote').map((r, i) => {
        const where = `manifest.remote[${i}]`;
        if (!isPlainObject(r) || !remotePlugins().includes(r.plugin) || typeof r.path !== 'string') {
            throw new PackageError(`${where} is malformed`, 'invalid_case_package');
        }
        fileList(r.files ?? [], where);
        return r;
    });
    if (raw.course !== undefined && (!isPlainObject(raw.course) || !Number.isSafeInteger(raw.course.lessons) || raw.course.lessons < 0)) {
        throw new PackageError('manifest.course is malformed', 'invalid_case_package');
    }
    return { uploads, library, remote, course: raw.course ?? null };
}

/** The bytes the manifest says the package carries: sha256 → size. */
function expectedMedia(manifest) {
    const expected = new Map();
    const add = (sha, bytes) => {
        if (expected.has(sha) && expected.get(sha) !== bytes) {
            throw new PackageError('The manifest gives one file two sizes', 'invalid_case_package');
        }
        expected.set(sha, bytes);
    };
    manifest.uploads.forEach((u) => add(u.sha256, u.bytes));
    manifest.library.forEach((a) => a.files.forEach((f) => add(f.sha256, f.bytes)));
    manifest.remote.filter((r) => r.carried).forEach((r) => r.files.forEach((f) => add(f.sha256, f.bytes)));
    return expected;
}

function jsonSink(name, onDone) {
    const chunks = [];
    let size = 0;
    return {
        write(chunk) {
            size += chunk.length;
            if (size > JSON_ENTRY_MAX_BYTES) throw new PackageError(`${name} is too large`, 'invalid_case_package');
            chunks.push(Buffer.from(chunk));
        },
        end() {
            try { onDone(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (err) {
                if (err instanceof PackageError) throw err;
                throw new PackageError(`${name} is not valid JSON`, 'invalid_case_package');
            }
        },
    };
}

const HEAD_BYTES = 32;
const checksumError = () => new PackageError('A media file does not match its checksum', 'case_package_checksum');

/**
 * A carried file's sink: hashes as it goes, keeps the first HEAD_BYTES (the
 * type checks read them later without reopening the file), and calls
 * `onDone(head)` once the bytes are verified.
 *
 * A small file is held in memory and handed to `pool` as one write, so the
 * archive keeps reading while up to IO_CONCURRENCY files are written; a
 * large one streams to disk. Either way the file exists, verified, once
 * `pool.settle()` has resolved.
 */
function fileSink({ dest, expectedSha, expectedBytes, pool, cancellation, onDone }) {
    const hash = createHash('sha256');
    let bytes = 0;
    let head = Buffer.alloc(0);
    const take = (chunk) => {
        bytes += chunk.length;
        if (bytes > expectedBytes) throw new PackageError('A media file is longer than the manifest says', 'invalid_case_package');
        hash.update(chunk);
        if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
    };
    const verify = () => {
        if (bytes !== expectedBytes || hash.digest('hex') !== expectedSha) throw checksumError();
    };

    if (expectedBytes <= SMALL_FILE_BYTES) {
        const chunks = [];
        return {
            write(chunk) {
                take(chunk);
                chunks.push(Buffer.from(chunk));
            },
            async end() {
                verify();
                const data = Buffer.concat(chunks);
                await pool.add(() => fsp.writeFile(dest, data, { flag: 'wx' }));
                onDone(head);
            },
            abort() {},
        };
    }

    const out = fs.createWriteStream(dest, { flags: 'wx' });
    const failed = new Promise((_, reject) => out.once('error', reject));
    failed.catch(() => {});
    return {
        async write(chunk) {
            cancellation.check();
            take(chunk);
            if (!out.write(chunk)) await Promise.race([new Promise((r) => out.once('drain', r)), failed]);
        },
        async end() {
            await Promise.race([new Promise((r) => out.end(r)), failed]);
            verify();
            onDone(head);
        },
        /** The read failed mid-file: release the descriptor now, not at GC. */
        abort() {
            out.destroy();
        },
    };
}

/**
 * Read a package into `staging`, checking everything. Nothing outside
 * `staging` is touched.
 *
 * @returns {Promise<{doc: object, manifest: object, course: object|null, heads: Map<string, Buffer>}>}
 *   `heads` holds each carried file's first bytes, by SHA-256.
 */
async function readPackage(packageFile, staging, { progress, cancellation }) {
    let doc = null;
    let manifest = null;
    let course = null;
    let expected = null;
    const seen = new Set();
    const heads = new Map();
    const pool = writePool(IO_CONCURRENCY);
    try {
        await readTar(fs.createReadStream(packageFile, { highWaterMark: MIB }), ({ name, size }) => {
            cancellation.check();
            if (doc === null) {
                if (name !== 'case.json') throw new PackageError('A case package must start with case.json', 'invalid_case_package');
                return jsonSink(name, (value) => { doc = value; });
            }
            if (manifest === null) {
                if (name !== 'manifest.json') throw new PackageError('manifest.json must follow case.json', 'invalid_case_package');
                return jsonSink(name, (value) => {
                    manifest = readManifest(value);
                    expected = expectedMedia(manifest);
                    progress.totals({ files: expected.size, bytes: [...expected.values()].reduce((sum, bytes) => sum + bytes, 0) });
                });
            }
            if (manifest.course && course === null) {
                if (name !== 'course.json') throw new PackageError('course.json must follow manifest.json', 'invalid_case_package');
                return jsonSink(name, (value) => { course = value; });
            }
            const match = /^media\/([0-9a-f]{64})$/.exec(name);
            if (!match) throw new PackageError(`Unexpected entry in package: ${name}`, 'invalid_case_package');
            const sha = match[1];
            if (!expected.has(sha)) throw new PackageError('The package carries a file its manifest does not declare', 'invalid_case_package');
            if (seen.has(sha)) throw new PackageError('The package carries a file twice', 'invalid_case_package');
            if (expected.get(sha) !== size) throw new PackageError('A media file\'s size differs from the manifest', 'invalid_case_package');
            seen.add(sha);
            return fileSink({
                dest: path.join(staging, sha), expectedSha: sha, expectedBytes: size, pool, cancellation,
                onDone: (head) => {
                    heads.set(sha, head);
                    progress.advance(1, size);
                },
            });
        });
    } catch (err) {
        // Every write already started must finish before the caller removes
        // the staging directory, or a write lands in a directory just removed.
        // A write's own failure is not reported here: `err` is what stopped
        // the read, and it is what the job reports.
        await pool.settle().catch((writeErr) => log.debug('staged write failed after the read stopped', { error: writeErr.message }));
        if (err instanceof TarError) throw new PackageError(`The package is not a valid archive: ${err.message}`, 'invalid_case_package');
        throw err;
    }
    await pool.settle();
    if (!doc || !manifest) throw new PackageError('The package is empty', 'invalid_case_package');
    if (manifest.course && course === null) throw new PackageError('The package is incomplete: course.json is missing', 'case_package_incomplete');
    const missing = [...expected.keys()].filter((sha) => !seen.has(sha));
    if (missing.length > 0) throw new PackageError(`The package is incomplete: ${missing.length} declared file(s) missing`, 'case_package_incomplete');
    return { doc, manifest, course, heads };
}

// Leading bytes per media type. The point is to keep anything a browser would
// RUN (HTML, SVG, script) out of the public uploads directory, so a file is
// accepted when its bytes are SOME allowed image, audio or video type — not
// necessarily the one its extension names. POST /api/upload checks only the
// declared type and extension, so mislabelled media exists in the wild (rohy
// itself ships a JPEG named .png) and must keep travelling.
function looksLike(ext, head) {
    const at = (offset, text) => head.subarray(offset, offset + text.length).toString('latin1') === text;
    const ftyp = at(4, 'ftyp') || at(4, 'moov') || at(4, 'mdat') || at(4, 'wide') || at(4, 'free');
    switch (ext) {
    case '.jpg': case '.jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case '.png': return at(0, '\x89PNG\r\n\x1a\n');
    case '.gif': return at(0, 'GIF87a') || at(0, 'GIF89a');
    case '.webp': return at(0, 'RIFF') && at(8, 'WEBP');
    case '.wav': return at(0, 'RIFF') && at(8, 'WAVE');
    case '.avi': return at(0, 'RIFF') && at(8, 'AVI ');
    case '.mp3': return at(0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case '.ogg': case '.ogv': return at(0, 'OggS');
    case '.webm': return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case '.m4a': case '.mp4': case '.mov': return ftyp;
    case '.mpeg': case '.mpg': return head[0] === 0 && head[1] === 0 && head[2] === 1 && (head[3] === 0xba || head[3] === 0xb3);
    default: return false;
    }
}

/** Do these bytes start like the document its extension names? */
function looksLikeDocument(ext, head) {
    const at = (text) => head.subarray(0, text.length).toString('latin1') === text;
    switch (ext) {
    case '.pdf': return at('%PDF-');
    case '.docx': case '.pptx': case '.xlsx': case '.zip': return at('PK\x03\x04');
    case '.doc': case '.ppt': case '.xls': return at('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1');
    // Plain text: no NUL and not markup, so a browser has nothing to run.
    case '.txt': case '.csv': return !head.includes(0) && !/^\s*</.test(head.toString('latin1'));
    default: return false;
    }
}

/** Do these bytes start like any media type the upload route accepts? */
function looksLikeAnyMedia(head) {
    return UPLOAD_EXTENSIONS.some((ext) => looksLike(ext, head));
}

function libraryFileLooksRight(rel, head) {
    if (rel.endsWith('.dzi')) return /^\s*(<\?xml|<Image)/.test(head.toString('utf8'));
    if (/\.jpe?g$/.test(rel)) return looksLike('.jpg', head);
    if (rel.endsWith('.png')) return looksLike('.png', head);
    if (rel.endsWith('.webp')) return looksLike('.webp', head);
    return false;
}

// ---- Import: placing and writing ------------------------------------------------------

// The import's database write runs on a connection of its own
// (dbAdapter.isolatedTransaction): a failed import must not roll back other
// requests' writes that happened to land while it was open.
const withWriteConnection = (work) => dbAdapter.isolatedTransaction(work);

/**
 * Rewrite this server's references in the case, value by value — never as text,
 * so a URL on another host or a sentence that mentions a path is untouched.
 *
 * Each [from, to] pair is one of:
 *   - an upload, `/uploads/<name>`: replaces a whole value `/uploads/<name>` or
 *     `./uploads/<name>`, keeping the value's own prefix;
 *   - a directory, ending in `/` (a library asset): replaces a value's prefix;
 *   - anything else (a `remote:` reference): replaces a whole value.
 */
function rewriteRefs(doc, replacements) {
    if (replacements.length === 0) return doc;
    const rewrite = (value) => {
        for (const [from, to] of replacements) {
            if (from.startsWith('/uploads/')) {
                const match = UPLOAD_REF_RE.exec(value);
                if (match && `/uploads/${match[2]}` === from) return `${match[1]}${to.slice('/uploads/'.length)}`;
            } else if (from.endsWith('/')) {
                if (value.startsWith(from)) return to + value.slice(from.length);
            } else if (value === from) {
                return to;
            }
        }
        return value;
    };
    const walk = (value) => {
        if (typeof value === 'string') return rewrite(value);
        if (Array.isArray(value)) return value.map(walk);
        if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
        return value;
    };
    return walk(doc);
}

/**
 * Place a staged file. A COPY, so one staged file can land under several names
 * (the package stores identical bytes once), and EXCLUSIVE, so a file that
 * appeared since the check is never overwritten — the import fails instead.
 */
async function placeFile(from, to) {
    try {
        await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    } catch (err) {
        if (err.code === 'EEXIST') {
            throw new PackageError(`${path.basename(to)} appeared on this server during the import; nothing was overwritten`, 'case_package_conflict', 409);
        }
        throw err;
    }
}

/** Slide optics and label as the case document records them for one reference. */
function slideFacts(pluginDoc, ref) {
    let facts = null;
    walkObjects(pluginDoc, (obj) => {
        if (facts) return;
        if (Object.values(obj).includes(ref)) {
            facts = {
                label: typeof obj.label === 'string' ? obj.label : null,
                nativeObjective: Number.isFinite(obj.nativeObjective) ? obj.nativeObjective : null,
                nativeMpp: Number.isFinite(obj.nativeMpp) ? obj.nativeMpp : null,
            };
        }
    });
    return facts ?? { label: null, nativeObjective: null, nativeMpp: null };
}

async function dziSize(file) {
    const xml = await fsp.readFile(file, 'utf8').catch(() => '');
    const width = Number(/Width="(\d+)"/.exec(xml)?.[1]);
    const height = Number(/Height="(\d+)"/.exec(xml)?.[1]);
    return { width: Number.isFinite(width) ? width : null, height: Number.isFinite(height) ? height : null };
}

/**
 * Decide where a library asset lands on this server, reusing an identical one.
 * Never overwrites: an id in use by different content gets a new id.
 */
const sameNumber = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9);

/**
 * Decide where a library asset lands on this server. An existing asset is
 * reused only when it is the SAME one for this tenant: same plugin, same
 * files, same calibration. plugin_assets.id is global, so another tenant's
 * identical slide is not this tenant's — reusing it would leave this tenant
 * with no row (absent from its slide picker, and from its own exports).
 * Never overwrites: an occupied id moves the import to a new one.
 */
async function placeAssetId({ libDir, preferredId, digest, files, tenant, plugin, row, tick, cancellation }) {
    const candidates = [
        preferredId,
        `asset-${sha256(`package\u0000${digest}`).slice(0, 24)}`,
        `asset-${sha256(`package\u0000${digest}\u0000${tenant}`).slice(0, 24)}`,
    ];
    for (const id of candidates) {
        const root = path.join(libDir, id);
        const existing = await dbAdapter.get(
            'SELECT tenant_id, plugin_id, native_objective, native_mpp_x, native_mpp_y FROM plugin_assets WHERE id = ?',
            [id]
        );
        const exists = (await fsp.stat(root).catch(() => null))?.isDirectory();
        if (!existing && !exists) return { id, reuse: false };
        if (!exists) continue;
        const sameOwner = row
            ? existing && existing.tenant_id === tenant && existing.plugin_id === plugin
                && sameNumber(existing.native_objective, row.native_objective)
                && sameNumber(existing.native_mpp_x, row.native_mpp_x)
                && sameNumber(existing.native_mpp_y, row.native_mpp_y)
            // A specimen photo has no row on either side; identical bytes are the same photo.
            : !existing;
        if (sameOwner && await sameAssetFiles(root, files, (f, b) => { cancellation.check(); tick(f, b); })) return { id, reuse: true };
    }
    return { id: `asset-${randomBytes(12).toString('hex')}`, reuse: false };
}

/**
 * Refuse the package, naming the folder, when the slide library cannot be
 * written. Checked while planning, so a library the server cannot write to
 * (a path that does not exist inside a container, a root-owned directory)
 * is reported with its path instead of failing as "The package job failed"
 * after the upload was unpacked. Creating the directory is the same step the
 * placement takes, done early.
 */
async function assertLibraryWritable(plugin, libDir) {
    try {
        await fsp.mkdir(libDir, { recursive: true });
        await fsp.access(libDir, fs.constants.W_OK);
    } catch (err) {
        throw new PackageError(
            `Rohy cannot write to the ${plugin} slide library ${libDir} (${err.code || err.message}). Check ROHY_PLUGIN_LIBRARY_DIRS and the folder's owner. Nothing was imported.`,
            'case_package_library_unwritable', 500);
    }
}

/**
 * The name an imported course gets on this server. A course whose name
 * carries the case code it was exported with (`… (FI-0010)`) names the NEW
 * case code instead; any other name that a live course in this tenant
 * already has gets the new code appended. Re-importing a package therefore
 * never makes two courses with one name (FI-0010 F22: FI-0011's course was
 * called "… (FI-0010)", indistinguishable from the first import's).
 */
export function importedCourseName({ name, sourceCaseCode, caseCode, nameTaken }) {
    if (sourceCaseCode && sourceCaseCode !== caseCode && name.includes(sourceCaseCode)) {
        return name.split(sourceCaseCode).join(caseCode);
    }
    return nameTaken ? `${name} (${caseCode})` : name;
}

/**
 * Create the imported case's course, named for this server (importedCourseName),
 * remembering where it came from in its settings (`imported_from`) — a key the
 * course editor keeps when it saves its own.
 *
 * @returns {Promise<{id: number, name: string, source_name: string, lessons: number, locked: number, published: number, members: number}>}
 */
async function insertImportedCourse({ tx, courseDoc, caseId, caseCode, sourceCaseCode, tenant, userId }) {
    const sourceName = courseDoc.course.name;
    const taken = await tx.get(
        'SELECT 1 AS taken FROM cohorts WHERE tenant_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1',
        [tenant, sourceName]
    );
    const name = importedCourseName({ name: sourceName, sourceCaseCode, caseCode, nameTaken: Boolean(taken) });
    const created = await insertCourse({ tx, course: { ...courseDoc, course: { ...courseDoc.course, name } }, caseId, tenant, userId });
    await tx.run('UPDATE cohorts SET settings = ? WHERE id = ? AND tenant_id = ?', [
        JSON.stringify({ imported_from: { case_code: sourceCaseCode, course_name: sourceName } }), created.id, tenant,
    ]);
    const members = await tx.get('SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND deleted_at IS NULL', [created.id]);
    return {
        ...created,
        source_name: sourceName,
        published: courseDoc.lessons.filter((lesson) => lesson.is_published).length,
        members: members?.n ?? 0,
    };
}

/**
 * Import a package as a NEW case.
 *
 * @param {object} opts
 * @param {string} opts.packageFile  the uploaded package
 * @param {object} opts.actor  a snapshot of the request: {user, ip, headers, log}
 * @param {Function} [opts.onProgress]  receives `{phase, done, total, bytes_done, bytes_total}`
 *   — files and bytes done within the phase, published at most every PROGRESS_INTERVAL_MS
 * @param {{check: Function, commit: Function}} [opts.cancellation]  `check()` throws when the
 *   import has been cancelled; `commit()` is called at the one moment after which it cannot be
 * @returns {Promise<object>} the import report
 * @throws {PackageError} on a refused package (nothing written); `case_package_cancelled`
 *   when cancelled before the commit point (nothing kept)
 */
export async function importCasePackage({ packageFile, actor, onProgress = () => {}, cancellation = NOT_CANCELLABLE }) {
    const tenant = actor.user?.tenant_id || 1;
    const staging = `${packageFile}.staging`;
    await fsp.mkdir(staging, { recursive: true });
    const placed = { files: [], dirs: [] };
    const progress = progressReporter(onProgress);
    try {
        cancellation.check();
        const { size: packageBytes } = await fsp.stat(packageFile);
        await assertFreeSpace(staging, packageBytes, 'unpacking the package');
        progress.phase('reading');
        const { doc, manifest, course, heads } = await readPackage(packageFile, staging, { progress, cancellation });

        const parsed = readCaseDocument(doc);
        if (parsed.problem) throw new PackageError(parsed.problem.error, parsed.problem.code);
        const parsedCourse = course ? readCourseDocument(course) : null;
        if (parsedCourse?.problem) throw new PackageError(parsedCourse.problem, 'invalid_case_package');

        // Checking counts every carried file once: its type, and — for a
        // slide that may already be here — the comparison with the copy on disk.
        const toCheck = [
            ...manifest.uploads,
            ...manifest.library.flatMap((a) => a.files),
            ...manifest.remote.filter((r) => r.carried).flatMap((r) => r.files),
        ];
        progress.phase('checking', { files: toCheck.length, bytes: toCheck.reduce((sum, f) => sum + f.bytes, 0) });
        const warnings = [];
        const replacements = [];

        // What the case can show once imported — placed now OR already here.
        // The report counts these, not copies: "0 slides" after a re-import
        // would read as a missing slide when it is simply reused. `media`
        // says which were reused and which copied.
        const available = { uploads: 0, slides: 0 };
        const media = { uploads_reused: 0, uploads_copied: 0, slides_reused: 0, slides_copied: 0, files_copied: 0, bytes_copied: 0 };

        // Uploads: same bytes already here → reuse; else a new name.
        const uploadMoves = [];
        for (const u of manifest.uploads) {
            cancellation.check();
            progress.advance(1, u.bytes);
            const ext = path.extname(u.name).toLowerCase();
            const staged = path.join(staging, u.sha256);
            const head = heads.get(u.sha256);
            const accepted = UPLOAD_EXTENSIONS.includes(ext)
                ? looksLikeAnyMedia(head)
                : DOCUMENT_EXTENSIONS.includes(ext) && looksLikeDocument(ext, head);
            if (!accepted) {
                warnings.push({ field: 'media', received: `/uploads/${u.name}`, hint: 'Not a media type uploads accept; left out.' });
                continue;
            }
            let target = u.name;
            const existing = path.join(UPLOADS_DIR, target);
            if (await fsp.stat(existing).catch(() => null)) {
                if ((await hashFile(existing)).sha256 === u.sha256) {
                    available.uploads += 1;
                    media.uploads_reused += 1;
                    continue;
                }
                target = `pkg-${u.sha256.slice(0, 16)}-${u.name}`.slice(0, 200);
                const again = path.join(UPLOADS_DIR, target);
                if (await fsp.stat(again).catch(() => null)) {
                    if ((await hashFile(again)).sha256 !== u.sha256) {
                        throw new PackageError(`Could not find a free name for ${u.name}`, 'case_package_conflict', 409);
                    }
                    replacements.push([`/uploads/${u.name}`, `/uploads/${target}`]);
                    available.uploads += 1;
                    media.uploads_reused += 1;
                    continue;
                }
                replacements.push([`/uploads/${u.name}`, `/uploads/${target}`]);
            }
            uploadMoves.push({ from: staged, to: path.join(UPLOADS_DIR, target), bytes: u.bytes });
            available.uploads += 1;
            media.uploads_copied += 1;
        }

        // Library assets, from a library or from a content origin.
        const assetPlans = [];
        const plannedIds = new Set();
        const reusedSlides = new Set();
        // Carried slides and photos this server has nowhere to put. They
        // refuse the whole package below: a pathology case without its slides
        // is not the case that was exported, so it is never created.
        const withoutLibrary = [];
        const planAsset = async ({ plugin, preferredId, files, row, fromRef, toRefs, label }) => {
            const libDir = libraryDirs().get(plugin);
            if (!libDir) {
                withoutLibrary.push({ plugin, ref: fromRef });
                return;
            }
            await assertLibraryWritable(plugin, libDir);
            // The type check reads the first bytes kept while reading the
            // package — no file is reopened.
            for (const f of files) {
                const rel = f.target ?? f.path;
                if (!libraryFileLooksRight(rel, heads.get(f.sha256))) {
                    throw new PackageError(`A slide file is not what its name says: ${rel}`, 'invalid_case_package');
                }
            }
            const placedFiles = files.map((f) => ({ path: f.target ?? f.path, sha256: f.sha256, bytes: f.bytes }));
            const digest = digestOf(placedFiles);
            const ticker = boundedTicker(progress, placedFiles.length, placedFiles.reduce((sum, f) => sum + f.bytes, 0));
            const { id, reuse } = await placeAssetId({
                libDir, digest, files: placedFiles, tenant, plugin, row, tick: ticker.tick, cancellation,
                preferredId: preferredId ?? `asset-${sha256(`package\u0000${digest}`).slice(0, 24)}`,
            });
            ticker.finish();
            toRefs(id).forEach(([from, to]) => { if (from !== to) replacements.push([from, to]); });
            if (row) available.slides += 1;
            if (row && reuse) reusedSlides.add(id);
            // Two references to the same bytes in one package land once.
            if (!reuse && !plannedIds.has(id)) {
                plannedIds.add(id);
                assetPlans.push({ plugin, libDir, id, files: placedFiles, row: row ? { ...row, label: row.label ?? label } : null, label });
            }
        };
        for (const a of manifest.library) {
            await planAsset({
                plugin: a.plugin, preferredId: a.asset_id, files: a.files, row: a.row,
                fromRef: `remote:library/${a.asset_id}/`,
                toRefs: (id) => [[`remote:library/${a.asset_id}/`, `remote:library/${id}/`]],
                label: a.row?.label ?? a.asset_id,
            });
        }

        // Remote content: present here already → keep; carried → place; else say so.
        const listings = new Map();
        for (const r of manifest.remote) {
            if (!listings.has(r.plugin)) listings.set(r.plugin, await contentListing(r.plugin));
            const listing = listings.get(r.plugin);
            const here = r.files.length > 0 && r.files.every((f) => listing.files.get(f.path)?.sha256 === f.sha256);
            if (here) {
                if (r.carried) progress.advance(r.files.length, r.files.reduce((sum, f) => sum + f.bytes, 0));
                continue;
            }
            const ref = `remote:${r.path}`;
            if (!r.carried) {
                const hint = r.plugin === 'pacs'
                    ? 'This study is not on this server. Install the shipped content (npm run setup:content) or configure the same PACS content origin.'
                    : 'This content is not on this server. Install the shipped content (npm run setup:content) or configure the same content origin.';
                warnings.push({ field: `config.${r.plugin}`, received: ref, hint });
                continue;
            }
            if (r.path.endsWith('.dzi')) {
                const tiles = `${r.path.slice(0, -4)}_files/`;
                const files = r.files.map((f) => ({ ...f, target: f.path === r.path ? 'slide.dzi' : `slide_files/${f.path.slice(tiles.length)}` }));
                if (files.some((f) => !LIBRARY_FILE_RE.test(f.target))) {
                    throw new PackageError(`Carried slide ${r.path} does not have a deep-zoom layout`, 'invalid_case_package');
                }
                const facts = slideFacts(parsed.caseFields.config?.[r.plugin], ref);
                const dzi = files.find((f) => f.target === 'slide.dzi');
                const size = await dziSize(path.join(staging, dzi.sha256));
                await planAsset({
                    plugin: r.plugin, files,
                    row: {
                        label: facts.label ?? path.basename(r.path, '.dzi'),
                        state: facts.nativeObjective && facts.nativeMpp ? 'ready' : 'needs_calibration',
                        native_objective: facts.nativeObjective, native_mpp_x: facts.nativeMpp, native_mpp_y: facts.nativeMpp,
                        tiled_objective: null, width: size.width, height: size.height,
                    },
                    fromRef: ref,
                    toRefs: (id) => [[ref, `remote:library/${id}/slide.dzi`]],
                    label: facts.label ?? path.basename(r.path, '.dzi'),
                });
            } else {
                // A specimen photo: placed beside the slides, addressed only by
                // the case. No plugin_assets row — that table lists SLIDES, and
                // a photo there would appear in the slide picker.
                const ext = path.extname(r.path).toLowerCase();
                const files = r.files.map((f) => ({ ...f, target: `gross${ext}` }));
                await planAsset({
                    plugin: r.plugin, files, row: null, fromRef: ref,
                    toRefs: (id) => [[ref, `remote:library/${id}/gross${ext}`]],
                    label: path.basename(r.path),
                });
            }
        }

        if (withoutLibrary.length > 0) {
            const plugins = [...new Set(withoutLibrary.map((m) => m.plugin))].join(', ');
            throw new PackageError(
                `This package carries ${withoutLibrary.length} slide or specimen file(s) for ${plugins}, and this server has no slide library (ROHY_PLUGIN_LIBRARY_DIRS). Nothing was imported.`,
                'case_package_no_library', 422);
        }

        // Rewrite the case to this server's references, then run every check
        // the database write depends on — all BEFORE a single file is placed.
        const rewritten = rewriteRefs({ case: parsed.caseFields, related: parsed.related }, replacements);
        const courseDoc = parsedCourse ? rewriteCourseUploads(parsedCourse.course, replacements) : null;
        const caseBody = rewritten.case;
        const captured = { status: 200, body: null };
        const shim = { status(code) { captured.status = code; return shim; }, json(body) { captured.body = body; return shim; } };
        const normalised = normaliseCaseForStorage({ log: actor.log, user: actor.user }, shim, caseBody);
        if (!normalised) throw new PackageError(captured.body?.error || 'The case is not valid', captured.body?.code || 'invalid_case_file');
        const { safeConfig, scenarioWithSource } = normalised;
        pinCaseLanguage(safeConfig, null);
        const plan = await prepareCaseRelated({ tenant, related: rewritten.related });

        await assertFreeSpaceFor([
            ...uploadMoves.map((m) => ({ dir: UPLOADS_DIR, bytes: m.bytes })),
            ...assetPlans.map((a) => ({ dir: a.libDir, bytes: a.files.reduce((sum, f) => sum + f.bytes, 0) })),
        ], 'the case media and slides');

        // Place files. Each asset is assembled in a hidden directory and
        // renamed into place whole, so a reader never sees half a slide.
        cancellation.check();
        const toPlace = [...uploadMoves.map((m) => m.bytes), ...assetPlans.flatMap((a) => a.files.map((f) => f.bytes))];
        progress.phase('placing', { files: toPlace.length, bytes: toPlace.reduce((sum, bytes) => sum + bytes, 0) });
        for (const move of uploadMoves) {
            cancellation.check();
            await placeFile(move.from, move.to);
            placed.files.push(move.to);
            progress.advance(1, move.bytes);
        }
        // A staged file that lands exactly once is MOVED (a rename: no bytes
        // copied when staging and library share a disk); one whose bytes land
        // under several names — identical tiles — is copied, so every copy has
        // its source. A library on another disk falls back to copying.
        const uses = new Map();
        [...uploadMoves.map((m) => path.basename(m.from)), ...assetPlans.flatMap((a) => a.files.map((f) => f.sha256))]
            .forEach((sha) => uses.set(sha, (uses.get(sha) ?? 0) + 1));
        let canRename = true;
        const land = async (sha, dest) => {
            const from = path.join(staging, sha);
            if (canRename && uses.get(sha) === 1) {
                try {
                    await fsp.rename(from, dest);
                    return;
                } catch (err) {
                    if (err.code !== 'EXDEV') throw err;
                    canRename = false;
                }
            }
            await fsp.copyFile(from, dest);
        };
        for (const asset of assetPlans) {
            const tmp = path.join(asset.libDir, `.${asset.id}.importing-${randomBytes(4).toString('hex')}`);
            placed.dirs.push(tmp);
            const dirs = [...new Set(asset.files.map((f) => path.dirname(path.join(tmp, f.path))))].sort();
            for (const dir of dirs) await fsp.mkdir(dir, { recursive: true });
            await eachLimit(asset.files, IO_CONCURRENCY, async (f) => {
                cancellation.check();
                await land(f.sha256, path.join(tmp, f.path));
                progress.advance(1, f.bytes);
            });
            const final = path.join(asset.libDir, asset.id);
            await fsp.rename(tmp, final);
            placed.dirs[placed.dirs.length - 1] = final;
            if (asset.row) media.slides_copied += 1;
            media.files_copied += asset.files.length;
            media.bytes_copied += asset.files.reduce((sum, f) => sum + f.bytes, 0);
        }
        media.slides_reused = reusedSlides.size;
        media.files_copied += uploadMoves.length;
        media.bytes_copied += uploadMoves.reduce((sum, m) => sum + m.bytes, 0);

        cancellation.check();
        progress.phase('saving');
        const { name, description, system_prompt } = caseBody;
        const { patientName, patientGender, patientAge, chiefComplaint, difficultyLevel } = normalised.columns;
        const result = await withWriteConnection(async (tx) => {
            const inserted = await tx.run(
                `INSERT INTO cases (name, description, system_prompt, config, scenario,
                 patient_name, patient_gender, patient_age, chief_complaint, difficulty_level,
                 created_by, last_modified_by, version, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
                [
                    name, description ?? null, system_prompt ?? null, JSON.stringify(safeConfig),
                    scenarioWithSource ? JSON.stringify(scenarioWithSource) : null,
                    patientName, patientGender, patientAge, chiefComplaint, difficultyLevel,
                    actor.user.id, actor.user.id, tenant,
                ]
            );
            const caseId = inserted.lastID;
            const caseCode = caseCodeFor(safeConfig, caseId);
            await tx.run('UPDATE cases SET case_code = ? WHERE id = ? AND tenant_id = ?', [caseCode, caseId, tenant]);
            const written = await insertCaseRelated({ tx, caseId, tenant, userId: actor.user.id, plan });
            const createdCourse = courseDoc
                ? await insertImportedCourse({ tx, courseDoc, caseId, caseCode, sourceCaseCode: doc.rohy_export?.source_case_code ?? null, tenant, userId: actor.user.id })
                : null;
            const now = nowIso();
            for (const asset of assetPlans.filter((a) => a.row)) {
                const state = ['ready', 'needs_calibration'].includes(asset.row.state) ? asset.row.state : 'needs_calibration';
                await tx.run(
                    `INSERT INTO plugin_assets
                     (id, tenant_id, plugin_id, label, state, source_url, native_objective, native_mpp_x, native_mpp_y,
                      tiled_objective, width, height, disk_bytes, created_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        asset.id, tenant, asset.plugin, asset.row.label ?? asset.label, state,
                        `package:${doc.rohy_export?.source_case_code ?? 'case'}`,
                        asset.row.native_objective ?? null, asset.row.native_mpp_x ?? null, asset.row.native_mpp_y ?? null,
                        asset.row.tiled_objective ?? null, asset.row.width ?? null, asset.row.height ?? null,
                        asset.files.reduce((sum, f) => sum + f.bytes, 0), actor.user.id, now, now,
                    ]
                );
            }
            const shown = await tx.get('SELECT is_available FROM cases WHERE id = ?', [caseId]);
            // The commit point. A cancel that arrived before here rolls the
            // transaction back and the placed files are removed below. The
            // check and `commit()` run in one synchronous step — no request
            // can be handled between them — so a cancel arriving after it is
            // refused (the import is kept), never half-honoured.
            cancellation.check();
            cancellation.commit();
            return { caseId, caseCode, course: createdCourse, isAvailable: Boolean(shown?.is_available), ...written };
        });
        placed.files = [];
        placed.dirs = [];

        // After the commit: the audit chain writes on its own connection and
        // would wait on the transaction's write lock.
        logAudit({
            userId: actor.user.id,
            username: actor.user.username,
            action: 'CREATE_CASE',
            resourceType: 'case',
            resourceId: String(result.caseId),
            resourceName: name,
            newValue: { name, description, config: safeConfig, tenant_id: tenant },
            tenantId: tenant,
            ipAddress: actor.ip,
            userAgent: actor.headers?.['user-agent'],
            status: 'success',
        });
        const counts = {
            ...result.imported,
            uploads: available.uploads,
            slides: available.slides,
            lessons: result.course?.lessons ?? 0,
        };
        auditSuccess(actor, {
            action: 'import_case_package',
            resourceType: 'case',
            resourceId: String(result.caseId),
            resourceName: name,
            metadata: { source_case_code: doc.rohy_export?.source_case_code ?? null, counts, media, created_templates: result.createdTemplates, course_id: result.course?.id ?? null },
        });
        await createCaseVersion(result.caseId, actor.user.id, 'created', 'Imported from a case package', {
            name, description, system_prompt, config: safeConfig, scenario: scenarioWithSource, tenant_id: tenant,
        });
        // Whatever standing specialist the package did not bring is attached
        // here, exactly as on POST /cases. Only ever adds.
        await attachStandingSpecialists({ caseId: result.caseId }).catch((err) => {
            log.warn('standing specialist attach failed', { caseId: result.caseId, error: err.message });
        });

        return {
            // A new case starts hidden from learners (`is_available`); the
            // admin's dialog offers to show it.
            case: { id: result.caseId, case_code: result.caseCode, name, is_available: result.isAvailable },
            // The course made for the case: a new one, with no learners yet.
            course: result.course,
            imported: counts,
            // Which media was already on this server and which was copied.
            media,
            created_templates: result.createdTemplates,
            warnings: [...warnings, ...normalised.warnings, ...plan.warnings, ...result.warnings],
        };
    } catch (err) {
        // Undo whatever was placed: the case does not exist, so neither may its files.
        await Promise.all([
            ...placed.files.map((f) => fsp.rm(f, { force: true })),
            ...placed.dirs.map((d) => fsp.rm(d, { recursive: true, force: true })),
        ]);
        throw err;
    } finally {
        await fsp.rm(staging, { recursive: true, force: true });
    }
}

// ---- Jobs and chunked uploads ------------------------------------------------------------
//
// One package job runs at a time. Jobs live in memory: a restart forgets them,
// and the work directory is emptied on the next use, so nothing is left half
// done on disk. A job is visible only to the person who started it.

const jobs = new Map();
const uploads = new Map();
let queue = Promise.resolve();

function sweep() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) {
        if (job.finishedAt && job.finishedAt < cutoff) {
            if (job.file) fsp.rm(job.file, { force: true }).catch(() => {});
            jobs.delete(id);
        }
    }
    for (const [id, upload] of uploads) {
        if (upload.touchedAt < cutoff) {
            fsp.rm(upload.file, { force: true }).catch(() => {});
            uploads.delete(id);
            reservations.delete(upload.reservation);
        }
    }
}
setInterval(sweep, 10 * 60 * 1000).unref();

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const finished = (job) => ['done', 'failed', 'cancelled'].includes(job.state);

function publicJob(job) {
    return {
        id: job.id,
        kind: job.kind,
        state: job.state,
        phase: job.phase,
        // Within the phase: files and bytes done of a total (null while unknown).
        progress: job.progress,
        created_at: iso(job.createdAt),
        started_at: iso(job.startedAt),
        finished_at: iso(job.finishedAt),
        // Measured here, so a browser with a wrong clock still shows the truth.
        elapsed_ms: job.startedAt ? (job.finishedAt ?? Date.now()) - job.startedAt : 0,
        cancel_requested: job.cancelRequested,
        // False once an import has been saved: from then on it is kept.
        cancellable: !finished(job) && !job.committed,
        result: job.result,
        error: job.error,
    };
}

/**
 * Queue `work(job, onProgress, cancellation)`. `cleanup` runs when the job is
 * cancelled while still queued — the work never starts, so whatever was set
 * aside for it (an uploaded package) is released by the cancel itself.
 */
function startJob({ kind, actor, work, cleanup = async () => {} }) {
    const job = {
        id: randomUUID(),
        kind,
        tenant: actor.user?.tenant_id || 1,
        userId: actor.user?.id,
        state: 'queued',
        phase: null,
        progress: null,
        result: null,
        error: null,
        file: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        cancelRequested: false,
        committed: false,
        cleanup,
    };
    const cancellation = {
        check() {
            if (job.cancelRequested) throw cancelledError();
        },
        commit() {
            job.committed = true;
        },
    };
    jobs.set(job.id, job);
    queue = queue.then(async () => {
        if (job.state === 'cancelled') return;
        job.state = 'running';
        job.startedAt = Date.now();
        try {
            job.result = await work(job, (progress) => {
                job.phase = progress.phase;
                job.progress = progress.total === null || progress.total === undefined
                    ? null
                    : { done: progress.done, total: progress.total, bytes_done: progress.bytes_done ?? null, bytes_total: progress.bytes_total ?? null };
            }, cancellation);
            job.state = 'done';
        } catch (err) {
            const cancelled = err instanceof PackageError && err.code === 'case_package_cancelled';
            job.state = cancelled ? 'cancelled' : 'failed';
            job.error = err instanceof PackageError
                ? { error: err.message, code: err.code, status: err.status }
                : { error: 'The package job failed', code: 'case_package_failed', status: 500 };
            if (cancelled) log.info('case package job cancelled', { kind, jobId: job.id, phase: job.phase });
            else if (!(err instanceof PackageError)) log.error('case package job failed', { kind, jobId: job.id, error: err.message });
            if (job.file) await fsp.rm(job.file, { force: true }).catch(() => {});
            job.file = null;
        } finally {
            job.finishedAt = Date.now();
        }
    });
    return publicJob(job);
}

const ownJob = (job, actor) => Boolean(job) && job.userId === actor.user?.id && job.tenant === (actor.user?.tenant_id || 1);

/** The job, if `actor` started it. */
export function getJob(id, actor) {
    const job = jobs.get(id);
    if (!ownJob(job, actor)) return null;
    return { view: publicJob(job), file: job.state === 'done' ? job.file : null, result: job.result };
}

/**
 * The jobs `actor` started that are still remembered — running, queued, or
 * finished within the last JOB_TTL_MS — newest first. An admin who closed
 * the dialog finds a running import here instead of starting another.
 */
export function listJobs({ actor, kind = null }) {
    return [...jobs.values()]
        .filter((job) => ownJob(job, actor) && (kind === null || job.kind === kind))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(publicJob);
}

/**
 * Cancel a job `actor` started. A queued job never starts; a running one
 * stops at its next file and undoes what it placed. Refused once the job
 * has finished, and once an import has been saved (its commit point).
 *
 * @returns {Promise<object>} the job's view
 * @throws {PackageError} 404 `job_not_found`; 409 `job_finished` or `case_package_committed`
 */
export async function cancelJob({ id, actor }) {
    const job = jobs.get(id);
    if (!ownJob(job, actor)) throw new PackageError('No such job', 'job_not_found', 404);
    if (finished(job)) throw new PackageError(`The job has already ${job.state === 'done' ? 'finished' : job.state}`, 'job_finished', 409);
    if (job.committed) {
        throw new PackageError('The case has already been saved; the import can no longer be cancelled', 'case_package_committed', 409);
    }
    job.cancelRequested = true;
    if (job.state === 'queued') {
        job.state = 'cancelled';
        job.error = { error: 'Cancelled; nothing was created', code: 'case_package_cancelled', status: 409 };
        job.finishedAt = Date.now();
        await job.cleanup();
    }
    return publicJob(job);
}

export async function startExport({ caseId, actor }) {
    const dir = await ensureWorkDir();
    return startJob({
        kind: 'export',
        actor,
        work: async (job, onProgress, cancellation) => {
            job.file = path.join(dir, `export-${job.id}${PACKAGE_EXTENSION}`);
            const built = await buildCasePackage({ caseId, tenant: job.tenant, outFile: job.file, onProgress, cancellation });
            auditSuccess(actor, {
                action: 'export_case_package',
                resourceType: 'case',
                resourceId: String(caseId),
                resourceName: built.name,
                metadata: { bytes: built.bytes, counts: built.counts },
            });
            return { name: built.name, case_code: built.caseCode, bytes: built.bytes, counts: built.counts, warnings: built.notes };
        },
    });
}

export async function createUpload({ bytes, actor }) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new PackageError('bytes must be the package size', 'invalid_upload');
    if (bytes > maxPackageBytes()) {
        throw new PackageError(`The package is ${Math.ceil(bytes / MIB)} MB, above the ${Math.floor(maxPackageBytes() / MIB)} MB limit`, 'case_package_too_large', 413);
    }
    const dir = await ensureWorkDir();
    const id = randomUUID();
    const upload = {
        id, bytes, received: 0, nextIndex: 0, lastChunkSha: null,
        file: path.join(dir, `upload-${id}${PACKAGE_EXTENSION}`),
        userId: actor.user?.id, tenant: actor.user?.tenant_id || 1, touchedAt: Date.now(),
        reservation: `upload:${id}`,
        // One operation at a time per upload: two requests for the same chunk
        // must not both pass the checks before either has appended.
        lock: Promise.resolve(),
    };
    // The upload, then the unpacked copy beside it — checked against what
    // other uploads have already been promised AND promised to this one in
    // the same step, so two concurrent uploads cannot both take the last room.
    await reserveFreeSpace(dir, upload.reservation, bytes * 2, 'the upload');
    try {
        await fsp.writeFile(upload.file, Buffer.alloc(0), { flag: 'wx' });
    } catch (err) {
        reservations.delete(upload.reservation);
        throw err;
    }
    uploads.set(id, upload);
    return { id, chunk_bytes: CHUNK_BYTES };
}

function ownUpload(id, actor) {
    const upload = uploads.get(id);
    if (!upload || upload.userId !== actor.user?.id || upload.tenant !== (actor.user?.tenant_id || 1)) {
        throw new PackageError('No such upload', 'upload_not_found', 404);
    }
    return upload;
}

/** Run `work` after every earlier operation on this upload has settled. */
function serialised(upload, work) {
    const run = upload.lock.then(work, work);
    upload.lock = run.catch(() => {});
    return run;
}

/**
 * Append chunk `index`. Chunks arrive in order. Resending the last chunk — a
 * retried request — is recognised by its index AND its bytes and ignored;
 * different bytes under that index are a conflict, not a retry.
 */
export async function appendChunk({ id, index, data, actor }) {
    const upload = ownUpload(id, actor);
    return serialised(upload, async () => {
        if (!uploads.has(id)) throw new PackageError('No such upload', 'upload_not_found', 404);
        const digest = createHash('sha256').update(data).digest('hex');
        if (index === upload.nextIndex - 1) {
            if (digest === upload.lastChunkSha) return { received: upload.received };
            throw new PackageError(`Chunk ${index} was already received with different bytes`, 'upload_chunk_conflict', 409);
        }
        if (index !== upload.nextIndex) throw new PackageError(`Expected chunk ${upload.nextIndex}, got ${index}`, 'upload_out_of_order', 409);
        if (data.length === 0 || data.length > CHUNK_BYTES) throw new PackageError('Chunk size out of range', 'invalid_upload');
        if (upload.received + data.length > upload.bytes) throw new PackageError('More data than the declared size', 'invalid_upload');
        // The reservation assumed the disk stays as it was; something else may
        // have filled it since. Checked raw: this upload's own reservation
        // covers these bytes and must not count against them.
        const stats = await fsp.statfs(path.dirname(upload.file));
        if (Number(stats.bavail) * Number(stats.bsize) - data.length < freeSpaceMargin()) {
            throw new PackageError('The server\'s disk filled up during the upload', 'case_package_no_space', 507);
        }
        await fsp.appendFile(upload.file, data);
        upload.received += data.length;
        upload.nextIndex += 1;
        upload.lastChunkSha = digest;
        upload.touchedAt = Date.now();
        return { received: upload.received };
    });
}

export async function completeUpload({ id, actor }) {
    const upload = ownUpload(id, actor);
    return serialised(upload, async () => {
        if (!uploads.has(id)) throw new PackageError('No such upload', 'upload_not_found', 404);
        if (upload.received !== upload.bytes) {
            throw new PackageError(`Upload incomplete: ${upload.received} of ${upload.bytes} bytes`, 'upload_incomplete', 409);
        }
        uploads.delete(id);
        const release = async () => {
            reservations.delete(upload.reservation);
            await fsp.rm(upload.file, { force: true });
        };
        return startJob({
            kind: 'import',
            actor,
            cleanup: release,
            work: async (job, onProgress, cancellation) => {
                // Held while queued; released as the import starts, because the
                // import checks the space it needs itself.
                reservations.delete(upload.reservation);
                try {
                    return await importCasePackage({ packageFile: upload.file, actor, onProgress, cancellation });
                } finally {
                    await release();
                }
            },
        });
    });
}

export async function cancelUpload({ id, actor }) {
    const upload = ownUpload(id, actor);
    return serialised(upload, async () => {
        uploads.delete(id);
        reservations.delete(upload.reservation);
        await fsp.rm(upload.file, { force: true });
    });
}

// Exported for tests: a guarantee easiest to break without an integration
// test noticing.
export const __test = { rewriteRefs, ensureWorkDir };

/** Test hook: forget every job and upload. */
export function __resetForTests() {
    jobs.clear();
    uploads.clear();
    reservations.clear();
    workDirSweep = null;
}
