// Case packages: one `.rohycase` file that moves a whole case — its document
// AND its media — from one Rohy server to another.
//
// A package is a tar (lib/tarStream.js) of exactly:
//   case.json      the case document (services/caseTransfer.js)
//   manifest.json  what media the case uses and where each file belongs
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
import { createTarWriter, readTar, TarError } from '../lib/tarStream.js';
import { libraryDirs } from '../lib/pluginServerSlot.js';
import { pluginOrigins } from '../lib/pluginRemoteOrigins.js';
import { originRequestHeaders } from '../lib/pluginOriginTokens.js';
import { starterContentDir } from '../routes/plugins-routes.js';
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { nowIso } from '../shared/time.js';
import { caseCodeFor } from '../shared/caseCode.js';
import { attachStandingSpecialists } from './standingSpecialists.js';
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

/** Refuse when writing `bytes` into `dir` would leave less than the margin free. */
async function assertFreeSpace(dir, bytes, what) {
    await fsp.mkdir(dir, { recursive: true });
    const stats = await fsp.statfs(dir);
    const free = Number(stats.bavail) * Number(stats.bsize) - reservedBytes();
    if (free - bytes < freeSpaceMargin()) {
        throw new PackageError(
            `Not enough disk space for ${what}: needs ${Math.ceil(bytes / MIB)} MB plus ${Math.ceil(freeSpaceMargin() / MIB)} MB kept free, ${Math.floor(free / MIB)} MB available`,
            'case_package_no_space',
            507
        );
    }
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

let workDirSwept = false;
/** The work directory, emptied once per process: jobs live in memory, so anything left by a previous process is an orphan. */
async function ensureWorkDir() {
    const dir = workDir();
    if (!workDirSwept) {
        workDirSwept = true;
        await fsp.rm(dir, { recursive: true, force: true });
    }
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

/** Regular files under `root`, as POSIX relative paths, skipping `source/` (scanner originals). */
async function listAssetFiles(root) {
    const out = [];
    async function walk(relative) {
        const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true });
        for (const entry of entries) {
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

function digestOf(files) {
    return sha256(files.map((f) => `${f.path}\u0000${f.sha256}\n`).sort().join(''));
}

async function hashAssetDir(root) {
    const files = [];
    for (const rel of await listAssetFiles(root)) {
        files.push({ path: rel, ...await hashFile(path.join(root, rel)) });
    }
    return files;
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
async function collectMedia({ doc, tenant, scratch }) {
    const notes = [];
    const sources = new Map();

    const uploads = [];
    for (const name of uploadNames(doc)) {
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
            const files = (await hashAssetDir(root)).filter((f) => LIBRARY_FILE_RE.test(f.path));
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
export async function buildCasePackage({ caseId, tenant, outFile, onProgress = () => {} }) {
    const doc = await buildCaseDocument({ caseId, tenant });
    if (!doc) throw new PackageError('Case not found', 'case_not_found', 404);
    const scratch = `${outFile}.scratch`;
    await fsp.mkdir(scratch, { recursive: true });
    try {
        onProgress({ phase: 'collecting' });
        const { manifest, sources, notes } = await collectMedia({ doc, tenant, scratch });
        const unique = [...sources.entries()];
        const mediaBytes = (await Promise.all(unique.map(([, s]) => fsp.stat(s.file)))).reduce((sum, s) => sum + s.size, 0);
        if (mediaBytes > maxPackageBytes()) {
            throw new PackageError(`This case's media is ${Math.ceil(mediaBytes / MIB)} MB, above the ${Math.floor(maxPackageBytes() / MIB)} MB package limit`, 'case_package_too_large', 413);
        }
        await assertFreeSpace(path.dirname(outFile), mediaBytes, 'the package');

        const writer = createTarWriter(fs.createWriteStream(outFile));
        await writer.addBuffer('case.json', Buffer.from(JSON.stringify(doc)));
        await writer.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest)));
        let done = 0;
        for (const [sha, source] of unique) {
            const { size } = await fsp.stat(source.file);
            await writer.addStream(`media/${sha}`, size, fs.createReadStream(source.file));
            done += 1;
            onProgress({ phase: 'writing', done, total: unique.length });
        }
        await writer.finish();
        const { size } = await fsp.stat(outFile);
        return {
            name: doc.case.name,
            caseCode: doc.rohy_export.source_case_code ?? null,
            bytes: size,
            notes,
            counts: {
                uploads: manifest.uploads.length,
                slides: manifest.library.length + manifest.remote.filter((r) => r.carried).length,
                referenced: manifest.remote.filter((r) => !r.carried).length,
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
    return { uploads, library, remote };
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

function fileSink(dest, expectedSha, expectedBytes) {
    const hash = createHash('sha256');
    const out = fs.createWriteStream(dest, { flags: 'wx' });
    let bytes = 0;
    const failed = new Promise((_, reject) => out.once('error', reject));
    failed.catch(() => {});
    return {
        async write(chunk) {
            bytes += chunk.length;
            if (bytes > expectedBytes) throw new PackageError('A media file is longer than the manifest says', 'invalid_case_package');
            hash.update(chunk);
            if (!out.write(chunk)) await Promise.race([new Promise((r) => out.once('drain', r)), failed]);
        },
        async end() {
            await Promise.race([new Promise((r) => out.end(r)), failed]);
            if (bytes !== expectedBytes || hash.digest('hex') !== expectedSha) {
                throw new PackageError('A media file does not match its checksum', 'case_package_checksum');
            }
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
 * @returns {Promise<{doc: object, manifest: object}>}
 */
async function readPackage(packageFile, staging) {
    let doc = null;
    let manifest = null;
    let expected = null;
    const seen = new Set();
    try {
        await readTar(fs.createReadStream(packageFile), ({ name, size }) => {
            if (doc === null) {
                if (name !== 'case.json') throw new PackageError('A case package must start with case.json', 'invalid_case_package');
                return jsonSink(name, (value) => { doc = value; });
            }
            if (manifest === null) {
                if (name !== 'manifest.json') throw new PackageError('manifest.json must follow case.json', 'invalid_case_package');
                return jsonSink(name, (value) => {
                    manifest = readManifest(value);
                    expected = expectedMedia(manifest);
                });
            }
            const match = /^media\/([0-9a-f]{64})$/.exec(name);
            if (!match) throw new PackageError(`Unexpected entry in package: ${name}`, 'invalid_case_package');
            const sha = match[1];
            if (!expected.has(sha)) throw new PackageError('The package carries a file its manifest does not declare', 'invalid_case_package');
            if (seen.has(sha)) throw new PackageError('The package carries a file twice', 'invalid_case_package');
            if (expected.get(sha) !== size) throw new PackageError('A media file\'s size differs from the manifest', 'invalid_case_package');
            seen.add(sha);
            return fileSink(path.join(staging, sha), sha, size);
        });
    } catch (err) {
        if (err instanceof TarError) throw new PackageError(`The package is not a valid archive: ${err.message}`, 'invalid_case_package');
        throw err;
    }
    if (!doc || !manifest) throw new PackageError('The package is empty', 'invalid_case_package');
    const missing = [...expected.keys()].filter((sha) => !seen.has(sha));
    if (missing.length > 0) throw new PackageError(`The package is incomplete: ${missing.length} declared file(s) missing`, 'case_package_incomplete');
    return { doc, manifest };
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

async function readHead(file) {
    const handle = await fsp.open(file, 'r');
    try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(32), 0, 32, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
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

/** Is a library directory actually served for this plugin on THIS server? */
async function libraryServed(pluginId, libDir, probeRel) {
    const origin = pluginOrigins().get(pluginId);
    if (origin) {
        try {
            const res = await fetch(`${origin}/${probeRel}`, {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
                headers: originRequestHeaders(pluginId),
            });
            return res.ok;
        } catch {
            return false;
        }
    }
    const starter = starterContentDir(pluginId);
    if (!starter) return false;
    const real = (p) => fsp.realpath(p).catch(() => path.resolve(p));
    return (await real(libDir)) === (await real(path.join(starter, 'library')));
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
async function placeAssetId({ libDir, preferredId, digest, tenant, plugin, row }) {
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
        if (sameOwner && digestOf(await hashAssetDir(root)) === digest) return { id, reuse: true };
    }
    return { id: `asset-${randomBytes(12).toString('hex')}`, reuse: false };
}

/**
 * Import a package as a NEW case.
 *
 * @param {object} opts
 * @param {string} opts.packageFile  the uploaded package
 * @param {object} opts.actor  a snapshot of the request: {user, ip, headers, log}
 * @param {Function} [opts.onProgress]
 * @returns {Promise<object>} the import report
 * @throws {PackageError} on a refused package (nothing written)
 */
export async function importCasePackage({ packageFile, actor, onProgress = () => {} }) {
    const tenant = actor.user?.tenant_id || 1;
    const staging = `${packageFile}.staging`;
    await fsp.mkdir(staging, { recursive: true });
    const placed = { files: [], dirs: [] };
    try {
        const { size: packageBytes } = await fsp.stat(packageFile);
        await assertFreeSpace(staging, packageBytes, 'unpacking the package');
        onProgress({ phase: 'reading' });
        const { doc, manifest } = await readPackage(packageFile, staging);

        const parsed = readCaseDocument(doc);
        if (parsed.problem) throw new PackageError(parsed.problem.error, parsed.problem.code);

        onProgress({ phase: 'checking' });
        const warnings = [];
        const replacements = [];

        // What the case can show once imported — placed now OR already here.
        // The report counts these, not copies: "0 slides" after a re-import
        // would read as a missing slide when it is simply reused.
        const available = { uploads: 0, slides: 0 };

        // Uploads: same bytes already here → reuse; else a new name.
        const uploadMoves = [];
        for (const u of manifest.uploads) {
            const ext = path.extname(u.name).toLowerCase();
            const staged = path.join(staging, u.sha256);
            if (!UPLOAD_EXTENSIONS.includes(ext) || !looksLikeAnyMedia(await readHead(staged))) {
                warnings.push({ field: 'media', received: `/uploads/${u.name}`, hint: 'Not a media type uploads accept; left out.' });
                continue;
            }
            let target = u.name;
            const existing = path.join(UPLOADS_DIR, target);
            if (await fsp.stat(existing).catch(() => null)) {
                if ((await hashFile(existing)).sha256 === u.sha256) {
                    available.uploads += 1;
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
                    continue;
                }
                replacements.push([`/uploads/${u.name}`, `/uploads/${target}`]);
            }
            uploadMoves.push({ from: staged, to: path.join(UPLOADS_DIR, target), bytes: u.bytes });
            available.uploads += 1;
        }

        // Library assets, from a library or from a content origin.
        const assetPlans = [];
        const plannedIds = new Set();
        const planAsset = async ({ plugin, preferredId, files, row, fromRef, toRefs, label }) => {
            const libDir = libraryDirs().get(plugin);
            if (!libDir) {
                warnings.push({ field: `config.${plugin}`, received: fromRef, hint: 'This server has no slide library (ROHY_PLUGIN_LIBRARY_DIRS); the slide was not imported.' });
                return;
            }
            for (const f of files) {
                const rel = f.target ?? f.path;
                if (!libraryFileLooksRight(rel, await readHead(path.join(staging, f.sha256)))) {
                    throw new PackageError(`A slide file is not what its name says: ${rel}`, 'invalid_case_package');
                }
            }
            const placedFiles = files.map((f) => ({ path: f.target ?? f.path, sha256: f.sha256, bytes: f.bytes }));
            const digest = digestOf(placedFiles);
            const { id, reuse } = await placeAssetId({
                libDir, digest, tenant, plugin, row,
                preferredId: preferredId ?? `asset-${sha256(`package\u0000${digest}`).slice(0, 24)}`,
            });
            toRefs(id).forEach(([from, to]) => { if (from !== to) replacements.push([from, to]); });
            if (row) available.slides += 1;
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
            if (here) continue;
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

        // Rewrite the case to this server's references, then run every check
        // the database write depends on — all BEFORE a single file is placed.
        const rewritten = rewriteRefs({ case: parsed.caseFields, related: parsed.related }, replacements);
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
        onProgress({ phase: 'placing' });
        for (const move of uploadMoves) {
            await placeFile(move.from, move.to);
            placed.files.push(move.to);
        }
        for (const asset of assetPlans) {
            const tmp = path.join(asset.libDir, `.${asset.id}.importing-${randomBytes(4).toString('hex')}`);
            placed.dirs.push(tmp);
            for (const f of asset.files) {
                const dest = path.join(tmp, f.path);
                await fsp.mkdir(path.dirname(dest), { recursive: true });
                // A slide's tiles can share bytes; copy, so one staged file can land twice.
                await fsp.copyFile(path.join(staging, f.sha256), dest);
            }
            const final = path.join(asset.libDir, asset.id);
            await fsp.rename(tmp, final);
            placed.dirs[placed.dirs.length - 1] = final;
        }

        onProgress({ phase: 'saving' });
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
            return { caseId, caseCode, ...written };
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
        };
        auditSuccess(actor, {
            action: 'import_case_package',
            resourceType: 'case',
            resourceId: String(result.caseId),
            resourceName: name,
            metadata: { source_case_code: doc.rohy_export?.source_case_code ?? null, counts, created_templates: result.createdTemplates },
        });
        await createCaseVersion(result.caseId, actor.user.id, 'created', 'Imported from a case package', {
            name, description, system_prompt, config: safeConfig, scenario: scenarioWithSource, tenant_id: tenant,
        });
        // Whatever standing specialist the package did not bring is attached
        // here, exactly as on POST /cases. Only ever adds.
        await attachStandingSpecialists({ caseId: result.caseId }).catch((err) => {
            log.warn('standing specialist attach failed', { caseId: result.caseId, error: err.message });
        });

        for (const asset of assetPlans) {
            const probe = asset.files.find((f) => f.path === 'slide.dzi') ?? asset.files[0];
            if (!await libraryServed(asset.plugin, asset.libDir, `library/${asset.id}/${probe.path}`)) {
                warnings.push({
                    field: `config.${asset.plugin}`,
                    received: `remote:library/${asset.id}/`,
                    hint: 'Imported into the slide library, but this server does not serve its library, so it will not display. The library directory must sit inside the content this plugin serves.',
                });
            }
        }

        return {
            case: { id: result.caseId, case_code: result.caseCode, name },
            imported: counts,
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

function publicJob(job) {
    return {
        id: job.id,
        kind: job.kind,
        state: job.state,
        phase: job.phase,
        progress: job.progress,
        result: job.result,
        error: job.error,
    };
}

function startJob({ kind, actor, work }) {
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
        finishedAt: null,
    };
    jobs.set(job.id, job);
    queue = queue.then(async () => {
        job.state = 'running';
        try {
            job.result = await work(job, (progress) => {
                job.phase = progress.phase;
                job.progress = progress.total ? { done: progress.done, total: progress.total } : null;
            });
            job.state = 'done';
        } catch (err) {
            job.state = 'failed';
            job.error = err instanceof PackageError
                ? { error: err.message, code: err.code, status: err.status }
                : { error: 'The package job failed', code: 'case_package_failed', status: 500 };
            if (!(err instanceof PackageError)) log.error('case package job failed', { kind, jobId: job.id, error: err.message });
            if (job.file) await fsp.rm(job.file, { force: true }).catch(() => {});
            job.file = null;
        } finally {
            job.finishedAt = Date.now();
        }
    });
    return publicJob(job);
}

/** The job, if `actor` started it. */
export function getJob(id, actor) {
    const job = jobs.get(id);
    if (!job || job.userId !== actor.user?.id || job.tenant !== (actor.user?.tenant_id || 1)) return null;
    return { view: publicJob(job), file: job.state === 'done' ? job.file : null, result: job.result };
}

export async function startExport({ caseId, actor }) {
    const dir = await ensureWorkDir();
    return startJob({
        kind: 'export',
        actor,
        work: async (job, onProgress) => {
            job.file = path.join(dir, `export-${job.id}${PACKAGE_EXTENSION}`);
            const built = await buildCasePackage({ caseId, tenant: job.tenant, outFile: job.file, onProgress });
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
    // The upload, then the unpacked copy beside it — checked against what
    // other uploads have already been promised, then promised to this one.
    await assertFreeSpace(dir, bytes * 2, 'the upload');
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
    await fsp.writeFile(upload.file, Buffer.alloc(0), { flag: 'wx' });
    reservations.set(upload.reservation, bytes * 2);
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
        return startJob({
            kind: 'import',
            actor,
            work: async (job, onProgress) => {
                // Held while queued; released as the import starts, because the
                // import checks the space it needs itself.
                reservations.delete(upload.reservation);
                try {
                    return await importCasePackage({ packageFile: upload.file, actor, onProgress });
                } finally {
                    await fsp.rm(upload.file, { force: true });
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
export const __test = { rewriteRefs };

/** Test hook: forget every job and upload. */
export function __resetForTests() {
    jobs.clear();
    uploads.clear();
    reservations.clear();
    workDirSwept = false;
}
