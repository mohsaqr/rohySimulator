#!/usr/bin/env node
/**
 * Vendor a plugin package into rohy, and stamp what was installed.
 *
 *   npm run vendor            # every registered package
 *   npm run vendor -- pacs    # one of them
 *   npm run vendor:check      # verify the stamps; no writes
 *
 * WHY VENDOR AT ALL, RATHER THAN DEPEND
 *
 * rohy ships a Docker image and an air-gap source bundle. A
 * `file:../Radoyon/radoyon` dependency resolves on a developer's laptop and
 * nowhere else — not in CI, not in the image, not in the offline tarball. The
 * JStats siblings in this workspace use `file:` deps happily because they never
 * ship offline. Vendoring was never the mistake; UNTRACKED vendoring was.
 *
 * WHY A STAMP
 *
 * Byte-identity checked at the moment of copying is not the same as knowing,
 * later, what you have. rohy's `src/components/pacs/` sat frozen at one commit
 * while both repos moved on, and nothing in rohy said so or could have:
 * `portability.test.js` checks imports, not currency, and the room's own tests
 * stay green against stale code. `.vendor.json` records the package, version,
 * upstream commit and a content hash, so provenance is a file rather than
 * archaeology — and `vendor:check` turns an EDITED copy into a red test.
 *
 * A stamp cannot detect staleness on its own: a copy frozen three commits back
 * hashes perfectly against its own stamp. Staleness needs upstream, so
 * `--check` reports it only when the upstream checkout is present.
 *
 * WHY ONE TOOL WHEN A PACKAGE MAY SHIP ITS OWN
 *
 * Radoyon ships `scripts/vendor.mjs`, on the principle that a package knows how
 * to install itself. That is a good principle and this does not override it:
 * where a package declares an `installer`, this DELEGATES to it. What the host
 * owns is the part only the host can own — one registry of what is vendored,
 * one stamp shape, and one gate that fails the build. See RPS-1 §16.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `~` is not expanded by the shell when it arrives in a config string. */
const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());

/**
 * Every vendored plugin package.
 *
 * `upstreamEnv` lets a machine that keeps its checkouts elsewhere say so
 * without editing this file — the default is the layout this workspace uses.
 */
export const VENDORED = [
    {
        id: 'pathology',
        package: 'pathoyon',
        upstream: '~/Documents/Github/Pathoyon/pathoyon',
        upstreamEnv: 'ROHY_VENDOR_PATHOYON',
        from: 'src',
        into: 'src/components/pathology',
        sentinel: 'index.js',
        hostOwned: ['README.md', 'portability.test.js'],
    },
    {
        id: 'pathology-server',
        package: 'pathoyon',
        upstream: '~/Documents/Github/Pathoyon/pathoyon',
        upstreamEnv: 'ROHY_VENDOR_PATHOYON',
        from: 'server',
        into: 'server/plugins/pathology',
        sentinel: 'index.js',
        hostOwned: ['README.md', 'portability.test.js'],
    },
    {
        id: 'pacs',
        package: 'radoyon',
        upstream: '~/Documents/Github/Radoyon/radoyon',
        upstreamEnv: 'ROHY_VENDOR_RADOYON',
        from: 'src',
        into: 'src/components/pacs',
        sentinel: 'index.js',
        hostOwned: ['README.md', 'portability.test.js'],
        // The package ships its own installer; the host defers to it and then
        // verifies the stamp it wrote like any other.
        installer: 'scripts/vendor.mjs',
    },
    {
        id: 'ecg',
        package: 'cardoyon',
        upstream: '~/Documents/Github/ECG',
        upstreamEnv: 'ROHY_VENDOR_CARDOYON',
        from: 'src',
        into: 'src/components/ecg',
        sentinel: 'index.js',
        hostOwned: ['README.md', 'portability.test.js'],
    },
    // The package stylesheet lives outside upstream's src/ (the standalone
    // app imports its own globals separately), so it is its own entry —
    // scoped selectors only, verified before the split was vendored.
    {
        id: 'ecg-styles',
        package: 'cardoyon',
        upstream: '~/Documents/Github/ECG',
        upstreamEnv: 'ROHY_VENDOR_CARDOYON',
        from: 'styles',
        into: 'src/components/ecg-styles',
        sentinel: 'package.css',
        hostOwned: ['README.md'],
    },
];

export const STAMP_FILE = '.vendor.json';

/** The upstream checkout for an entry, honouring its env override. */
export function upstreamOf(entry) {
    return expand(process.env[entry.upstreamEnv] || entry.upstream);
}

/** Every file under `dir`, as sorted repo-relative paths. */
function walk(dir, base = dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))]))
        .sort();
}

/**
 * The content hash of a vendored tree.
 *
 * Path AND contents, so a rename is a change. Host-owned files and the stamp
 * itself are excluded — they are the host's, and including them would make
 * every stamp disagree with the source it came from.
 *
 * @param {string} dir
 * @param {string[]} hostOwned
 * @returns {{files: string[], sha256: string}}
 */
export function hashTree(dir, hostOwned = []) {
    const skip = new Set([...hostOwned, STAMP_FILE]);
    const files = walk(dir).filter((f) => !skip.has(f));
    const digest = createHash('sha256');
    files.forEach((f) => { digest.update(f); digest.update(readFileSync(join(dir, f))); });
    return { files, sha256: digest.digest('hex') };
}

/** Read a vendored folder's stamp, or null. */
export function readStamp(entry) {
    const path = join(REPO_ROOT, entry.into, STAMP_FILE);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Verify one vendored copy against its stamp.
 *
 * @returns {{id: string, ok: boolean, reason: string, stamp: object|null, stale: string|null}}
 */
export function verify(entry) {
    const dest = join(REPO_ROOT, entry.into);
    if (!existsSync(dest)) return { id: entry.id, ok: false, reason: 'vendored folder is missing', stamp: null, stale: null };
    const stamp = readStamp(entry);
    if (!stamp) {
        return { id: entry.id, ok: false, reason: `no ${STAMP_FILE} — run \`npm run vendor -- ${entry.id}\``, stamp: null, stale: null };
    }
    const { files, sha256 } = hashTree(dest, entry.hostOwned);
    if (sha256 !== stamp.sha256) {
        return {
            id: entry.id,
            ok: false,
            stamp,
            stale: null,
            reason: `contents do not match the stamp (${files.length} files here, ${stamp.files} stamped). `
                + 'The vendored copy has been edited in place; edit upstream and re-vendor.',
        };
    }
    // Staleness needs upstream, which CI does not have. Reported, never failed.
    let stale = null;
    const src = join(upstreamOf(entry), entry.from);
    if (existsSync(src)) {
        const upstream = hashTree(src, entry.hostOwned);
        if (upstream.sha256 !== stamp.sha256) stale = 'upstream has moved since this was vendored';
    }
    return { id: entry.id, ok: true, reason: 'matches its stamp', stamp, stale };
}

// ---------------------------------------------------------------------------

function install(entry, { force = false } = {}) {
    const upstream = upstreamOf(entry);
    const src = join(upstream, entry.from);
    const dest = join(REPO_ROOT, entry.into);

    if (!existsSync(src)) throw new Error(`upstream not found: ${src}\n    Clone it, or set ${entry.upstreamEnv}.`);
    // The guard, and the reason this is a script rather than a documented rsync.
    // `rsync --delete` from a source that EXISTS but holds no package is a valid
    // instruction to empty the destination, and that has already happened once
    // in this workspace.
    if (!existsSync(join(src, entry.sentinel))) {
        throw new Error(`${src} has no ${entry.sentinel} — that is not the package.\n    Refusing to rsync --delete from it.`);
    }

    let commit = null;
    let dirty = false;
    try {
        commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        dirty = execFileSync('git', ['-C', upstream, 'status', '--porcelain', entry.from], { encoding: 'utf8' }).trim().length > 0;
    } catch { /* not a git checkout; the stamp records no commit */ }
    if (dirty && !force) {
        throw new Error(`${entry.from}/ has uncommitted changes upstream.\n    A stamp naming a commit that does not contain them is a lie. Commit first, or pass --force.`);
    }

    // A package that ships its own installer owns the copy; the host still owns
    // the verification below.
    if (entry.installer && existsSync(join(upstream, entry.installer))) {
        execFileSync('node', [join(upstream, entry.installer), '--host', REPO_ROOT, '--into', entry.into,
            ...(force ? ['--force'] : [])], { stdio: 'inherit' });
    } else {
        const excludes = entry.hostOwned.flatMap((f) => ['--exclude', f]);
        execFileSync('rsync', ['-rc', '--delete', '--exclude', STAMP_FILE, ...excludes, `${src}/`, `${dest}/`], { stdio: 'inherit' });
    }

    const version = existsSync(join(upstream, 'package.json'))
        ? JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8')).version
        : null;
    const { files, sha256 } = hashTree(src, entry.hostOwned);
    writeFileSync(join(dest, STAMP_FILE), `${JSON.stringify({
        package: entry.package,
        version,
        commit,
        vendoredAt: new Date().toISOString().slice(0, 10),
        from: entry.from,
        files: files.length,
        sha256,
        hostOwned: entry.hostOwned,
        note: `Generated by scripts/vendor-plugins.mjs (RPS-1 §16). Do not edit this folder; edit ${entry.package} upstream and re-run \`npm run vendor -- ${entry.id}\`.`,
    }, null, 2)}\n`);

    const check = verify(entry);
    if (!check.ok) throw new Error(`installed but does not verify: ${check.reason}`);
    return { version, commit, files: files.length, sha256 };
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
    const checkOnly = argv.includes('--check');
    const force = argv.includes('--force');
    const wanted = argv.filter((a) => !a.startsWith('--'));
    const targets = wanted.length > 0
        ? VENDORED.filter((e) => wanted.includes(e.id))
        : VENDORED;

    const unknown = wanted.filter((w) => !VENDORED.some((e) => e.id === w));
    if (unknown.length > 0) {
        console.error(`vendor: unknown package(s): ${unknown.join(', ')}\n  known: ${VENDORED.map((e) => e.id).join(', ')}`);
        process.exit(1);
    }

    let failed = 0;
    for (const entry of targets) {
        if (checkOnly) {
            const result = verify(entry);
            const where = result.stamp ? `${result.stamp.package} ${result.stamp.version ?? '?'} (${result.stamp.commit?.slice(0, 8) ?? 'no commit'})` : '';
            if (!result.ok) { console.error(`  ✗ ${entry.id}: ${result.reason}`); failed += 1; }
            else if (result.stale) console.warn(`  ⚠ ${entry.id}: ${where} — ${result.stale}; re-vendor to pick it up`);
            else console.log(`  ✓ ${entry.id}: ${where}`);
            continue;
        }
        try {
            const out = install(entry, { force });
            console.log(`  ✓ ${entry.id}: ${entry.package} ${out.version ?? '?'} (${out.commit?.slice(0, 8) ?? 'no commit'}) → ${entry.into}`);
            console.log(`    ${out.files} files, sha256 ${out.sha256.slice(0, 12)}`);
        } catch (err) {
            console.error(`  ✗ ${entry.id}: ${err.message}`);
            failed += 1;
        }
    }
    if (failed > 0) process.exit(1);
    if (!checkOnly) console.log('\n  Now run:  npm run plugins:gen && npx vitest run && npm run build');
}
