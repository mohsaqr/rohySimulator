#!/usr/bin/env node
/**
 * Install the imaging and slide content a deployment serves.
 *
 *   npm run setup:content                              # from the published release
 *   npm run setup:content -- --from ~/Downloads        # from files already on disk
 *   npm run setup:content -- --from https://mirror/... # from anywhere else
 *   npm run setup:content -- --only pathology          # just the slides
 *
 * ## Why a download and not a stream
 *
 * The PACS and Pathology rooms need gigabytes of pixels. A deployment could
 * fetch each tile from a central origin as a learner pans — `ROHY_PLUGIN_ORIGINS`
 * still does exactly that, and it is the right answer for a university serving
 * its own archive — but as the DEFAULT it makes every installation depend on
 * one host's bandwidth and uptime forever, and locks out anyone behind a
 * firewall. Downloading once at install costs one transfer per deployment
 * instead of one per tile per learner, and nothing breaks afterwards if the
 * publisher is offline.
 *
 * This mirrors what rohy already does for the Oyon models
 * (`OyonR/scripts/download-models.sh`): checksum-verified, idempotent, and
 * safe to re-run.
 *
 * ## Why the source is a flag and not a constant
 *
 * What this trusts is the SHA-256 in `content-sources.json`, not the place the
 * bytes came from. So the transport is interchangeable — a GitHub release, a
 * university mirror, a shared drive a colleague downloaded by hand, a stick
 * carried into an air-gapped hospital — and the same verification catches the
 * same three failures in all of them: a truncated transfer, the wrong archive,
 * and the HTML interstitial that large-file services hand out instead of a
 * file. Without the checksum that last one is saved as a .tar.gz and fails
 * much later, somewhere unrelated.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEST = join(ROOT, 'server', 'plugin-content');
const CACHE = join(ROOT, '.content-cache');
const SOURCES = join(ROOT, 'scripts', 'content-sources.json');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    }
    return args;
}
const say = (m) => console.log(`  ${m}`);
const fail = (m) => { console.error(`setup-content: ${m}`); process.exit(1); };

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Where this archive's bytes come from: a local file, a directory of them, or a URL. */
function resolveSource(from, archive, baseUrl) {
    if (!from) {
        if (!baseUrl) {
            fail(`no --from given and content-sources.json declares no baseUrl.\n`
                + '  Publish the archives and record the URL, or pass --from with a downloaded file.');
        }
        return { kind: 'url', at: `${baseUrl.replace(/\/+$/, '')}/${archive.file}` };
    }
    if (/^https?:\/\//i.test(from)) {
        // A directory-ish URL gets the filename appended; a direct file URL is
        // used as given, so a signed or renamed link still works.
        return { kind: 'url', at: from.endsWith('.tar.gz') ? from : `${from.replace(/\/+$/, '')}/${archive.file}` };
    }
    const asFile = resolve(from);
    if (existsSync(asFile) && statSync(asFile).isDirectory()) return { kind: 'file', at: join(asFile, archive.file) };
    return { kind: 'file', at: asFile };
}

async function fetchTo(url, dest) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    // Streamed, because these are hundreds of megabytes and buffering the lot
    // to compute a hash afterwards is a needless copy in memory.
    mkdirSync(CACHE, { recursive: true });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(SOURCES)) fail(`${SOURCES} is missing`);
const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
const wanted = typeof args.only === 'string' ? [args.only] : null;
const archives = (sources.archives ?? []).filter((a) => !wanted || wanted.includes(a.plugin));
if (archives.length === 0) fail(wanted ? `no archive for plugin "${wanted.join(', ')}"` : 'content-sources.json declares no archives');

let installed = 0;
let skipped = 0;

for (const archive of archives) {
    const target = join(DEST, archive.plugin);
    const stamp = join(target, 'content.json');

    // Idempotent. The installed bundle names the content version it came from,
    // so a re-run after `npm install` is a no-op rather than a re-download.
    if (!args.force && existsSync(stamp)) {
        const have = JSON.parse(readFileSync(stamp, 'utf8')).version;
        if (have === archive.contentVersion) {
            say(`${archive.plugin}: already installed (${have})`);
            skipped++;
            continue;
        }
        say(`${archive.plugin}: installed version ${have} differs from ${archive.contentVersion}; replacing`);
    }

    const source = resolveSource(typeof args.from === 'string' ? args.from : null, archive, sources.baseUrl);
    const cached = join(CACHE, archive.file);

    let file;
    if (source.kind === 'file') {
        if (!existsSync(source.at)) {
            fail(`${archive.plugin}: ${source.at} does not exist.\n`
                + `  Expected the archive named "${archive.file}", or pass --from pointing straight at it.`);
        }
        file = source.at;
        say(`${archive.plugin} ← ${file}`);
    } else if (!args.force && existsSync(cached) && sha256Of(cached) === archive.sha256) {
        file = cached;
        say(`${archive.plugin}: using verified download already in .content-cache`);
    } else {
        say(`${archive.plugin} ← ${source.at}`);
        say(`  ${(archive.bytes / 1048576).toFixed(0)} MB, this takes a while`);
        try {
            await fetchTo(source.at, cached);
        } catch (err) {
            fail(`${archive.plugin}: download failed — ${err.message}`);
        }
        file = cached;
    }

    // BEFORE extracting, always. A truncated transfer, the wrong archive and
    // the HTML "confirm this large download" page that some services return
    // instead of a file are all the same failure here — a clear one — rather
    // than three different confusing ones after extraction.
    const actual = sha256Of(file);
    if (actual !== archive.sha256) {
        const size = statSync(file).size;
        fail(`${archive.plugin}: checksum mismatch on ${basename(file)}\n`
            + `    expected ${archive.sha256}\n`
            + `    got      ${actual}  (${size} bytes, expected ${archive.bytes})\n`
            + '  The file is not the archive this build expects. If it is much smaller than\n'
            + '  expected it is probably an error page saved with the right name.');
    }

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', file, '-C', target], { encoding: 'utf8' });
    if (tar.status !== 0) fail(`${archive.plugin}: tar failed — ${tar.stderr}`);
    if (!existsSync(stamp)) fail(`${archive.plugin}: the archive extracted without a content.json — it is not a content bundle`);

    say(`  installed ${archive.files} files to server/plugin-content/${archive.plugin}/`);
    installed++;
    if (source.kind === 'url' && !args.keep) unlinkSync(cached);
}

console.log(`\nsetup-content: ${installed} installed, ${skipped} already present.`);
if (installed > 0) {
    console.log('rohy serves these from disk when ROHY_PLUGIN_ORIGINS names no origin for the plugin.');
}
