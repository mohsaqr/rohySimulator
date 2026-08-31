#!/usr/bin/env node
/**
 * Build the starter content bundles under `server/plugin-content/`.
 *
 *   npm run starter-content
 *
 * ## What this is
 *
 * `ROHY_PLUGIN_ORIGINS` names where a deployment's own imaging lives. Until it
 * is set, every plugin room is empty and says so by naming an environment
 * variable at an educator who cannot set one — and there is no public host to
 * point that variable at either, because an origin is something you BUILD from
 * a licence-audited archive. So rohy ships a small one.
 *
 * It is a SUBSET of the plugins' real content origins, selected by entry id:
 * real imaging, already licence-audited, already passing the redistribution
 * gates the archives enforce. Nothing here is synthetic and nothing here is
 * relicensed — the archives were audited precisely so that a subset could
 * lawfully ship, and every attribution notice travels with the pixels.
 *
 * ## Why it is generated and not committed
 *
 * The bundles are ~210 MB. Committed, they would be in git history forever and
 * every clone would pay for them. So `server/plugin-content/` is gitignored and
 * rebuilt from the sibling content origins:
 *
 *   ../Radoyon/radoyon/dist-content   (pacs)
 *   ../Pathoyon/dist-content          (pathology)
 *
 * Override with ROHY_PACS_CONTENT / ROHY_PATHOLOGY_CONTENT.
 *
 * CONSEQUENCE, stated plainly: a clone WITHOUT those siblings produces no
 * starter content, and such a deployment is back to the honest 503. The
 * bundles must therefore be built into the artefacts that ship — the Docker
 * image and the air-gap tarball — on a machine that has the archives. A
 * stranger's bare `git clone` does not get them.
 */

import { createHash } from 'node:crypto';
import {
    copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_ROOT = join(ROOT, 'server', 'plugin-content');

/**
 * The starter selection: ABNORMAL CHEST.
 *
 * Selected from the archive's OWN metadata rather than a list of ids typed
 * here. A hardcoded list goes stale silently — it was one, chosen for breadth
 * of modality before the default case was filled with anterior-STEMI content,
 * and the result was a starter kit with no cardiac MRI on a platform whose
 * flagship case is an acute myocardial infarction. A predicate cannot drift
 * from the archive that way: add a chest study upstream and it ships.
 *
 * "Chest" is the archive's region, not a guess, and in this catalogue that
 * includes echocardiography — an echo IS a chest study — so the cardiac
 * material the default case orders comes with it.
 */
const wantsPacsEntry = (entry) => (
    String(entry.id).startsWith('abnormal/') && /chest/i.test(entry.bodyRegion ?? '')
);

/** Pathology ships the cardiac teaching set; `cardiac-` is its id prefix. */
const PATHOLOGY_PREFIX = 'cardiac-';

const say = (m) => console.log(`  ${m}`);
const fail = (m) => { console.error(`build-starter-content: ${m}`); process.exit(1); };

function copyTree(src, dst, seen) {
    if (!existsSync(src)) return;
    for (const e of readdirSync(src, { withFileTypes: true })) {
        const s = join(src, e.name); const d = join(dst, e.name);
        if (e.isDirectory()) { copyTree(s, d, seen); continue; }
        mkdirSync(dirname(d), { recursive: true });
        copyFileSync(s, d);
        seen.push(d);
    }
}
function copyOne(srcRoot, dstRoot, rel, seen) {
    const s = join(srcRoot, rel); if (!existsSync(s)) return false;
    const d = join(dstRoot, rel);
    mkdirSync(dirname(d), { recursive: true });
    copyFileSync(s, d); seen.push(d); return true;
}

/** The self-description every origin serves, and what marks a directory a bundle. */
function stamp(pluginId, dir, paths) {
    const walk = (d) => readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(dir)
        .filter((f) => !f.endsWith('content.json'))
        .map((f) => ({
            path: relative(dir, f).split(/[\\/]/).join('/'),
            bytes: statSync(f).size,
            sha256: createHash('sha256').update(readFileSync(f)).digest('hex'),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const total = files.reduce((n, f) => n + f.bytes, 0);
    writeFileSync(join(dir, 'content.json'), `${JSON.stringify({
        schemaVersion: '1.0.0',
        plugin: pluginId,
        version: `starter-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`,
        paths,
        builtAt: new Date().toISOString(),
        starter: true,
        fileCount: files.length,
        kilobytes: Math.round(total / 1024),
        files,
    }, null, 2)}\n`);
    say(`${pluginId}: ${files.length} files, ${(total / 1048576).toFixed(1)} MB`);
}

// --- pacs -------------------------------------------------------------------

function buildPacs(src) {
    const out = join(OUT_ROOT, 'pacs');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    const raw = JSON.parse(readFileSync(join(src, 'catalog.json'), 'utf8'));
    const all = Array.isArray(raw) ? raw : raw.entries;
    const keep = all.filter(wantsPacsEntry);
    if (keep.length === 0) fail('the pacs origin has no abnormal chest entries');

    const seen = [];
    keep.forEach((e) => (e.series ?? []).forEach((s) => (
        copyTree(join(src, s.ref.replace('remote:', '')), join(out, s.ref.replace('remote:', '')), seen)
    )));

    // Thumbnails, keyed by series ref, so the rail has previews before any
    // instance is fetched.
    const thumbIndex = join(src, 'thumbs', 'index.json');
    if (existsSync(thumbIndex)) {
        const refs = new Set(keep.flatMap((e) => (e.series ?? []).map((s) => s.ref)));
        const kept = {};
        Object.entries(JSON.parse(readFileSync(thumbIndex, 'utf8')).thumbs ?? {}).forEach(([ref, v]) => {
            if (!refs.has(ref)) return;
            kept[ref] = v;
            copyOne(src, out, `thumbs/${typeof v === 'string' ? v : v.path}`, seen);
        });
        mkdirSync(join(out, 'thumbs'), { recursive: true });
        writeFileSync(join(out, 'thumbs', 'index.json'), `${JSON.stringify({ version: 1, thumbs: kept }, null, 2)}\n`);
    }

    // CC BY permits shipping the pixels only while the notice ships with them,
    // so the notices are carried, not left behind in a repo nobody deploys.
    const attribution = [...new Set(keep.map((e) => e.provenance?.attribution).filter(Boolean))].sort();
    writeFileSync(join(out, 'catalog.json'), `${JSON.stringify({
        version: 1, name: 'Starter imaging archive', attribution, entries: keep,
    }, null, 2)}\n`);

    stamp('pacs', out, ['/dicom', '/thumbs']);
    say(`pacs: ${keep.length} entries, ${attribution.length} attribution notices`);
}

// --- pathology --------------------------------------------------------------

function buildPathology(src) {
    const out = join(OUT_ROOT, 'pathology');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'tiles', 'previews'), { recursive: true });

    const cat = JSON.parse(readFileSync(join(src, 'catalog.json'), 'utf8'));
    const keep = (cat.assets ?? []).filter((a) => a.id.startsWith(PATHOLOGY_PREFIX));
    if (keep.length === 0) fail(`the pathology origin has no "${PATHOLOGY_PREFIX}" assets`);

    const seen = [];
    keep.forEach((a) => {
        const name = a.revisions[0].derivatives.dzi.url.replace('remote:tiles/', '').replace(/\.dzi$/, '');
        copyOne(src, out, `tiles/${name}.dzi`, seen);
        copyTree(join(src, 'tiles', `${name}_files`), join(out, 'tiles', `${name}_files`), seen);
        copyOne(src, out, a.preview.url.replace('remote:', ''), seen);
    });

    writeFileSync(join(out, 'catalog.json'), `${JSON.stringify({
        schemaVersion: cat.schemaVersion ?? '1.0.0',
        version: 1,
        title: 'Cardiac pathology — starter set',
        assets: keep,
    }, null, 2)}\n`);

    stamp('pathology', out, ['/tiles']);
    const needing = keep.filter((a) => a.provenance?.redistribution === 'attribution_only').length;
    say(`pathology: ${keep.length} slides, ${needing} requiring attribution`);
}

// ----------------------------------------------------------------------------

const sources = {
    pacs: process.env.ROHY_PACS_CONTENT ?? join(ROOT, '..', 'Radoyon', 'radoyon', 'dist-content'),
    pathology: process.env.ROHY_PATHOLOGY_CONTENT ?? join(ROOT, '..', 'Pathoyon', 'dist-content'),
};

const only = process.argv[2];
let built = 0;
for (const [pluginId, src] of Object.entries(sources)) {
    if (only && only !== pluginId) continue;
    if (!existsSync(join(src, 'catalog.json'))) {
        say(`${pluginId}: SKIPPED — no content origin at ${src}`);
        continue;
    }
    say(`${pluginId} ← ${src}`);
    if (pluginId === 'pacs') buildPacs(src); else buildPathology(src);
    built++;
}

if (built === 0) {
    console.error('\nbuild-starter-content: nothing built. Set ROHY_PACS_CONTENT / ROHY_PATHOLOGY_CONTENT,');
    console.error('or build the sibling origins first. A deployment without starter content is not broken —');
    console.error('it reports the honest 503 until ROHY_PLUGIN_ORIGINS names an origin.');
    process.exit(1);
}
console.log(`\nbuild-starter-content: ${built} bundle(s) in server/plugin-content/`);
