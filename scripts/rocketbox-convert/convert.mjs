// Microsoft RocketBox → viseme-rigged GLB pipeline.
//
// For each avatar listed in avatars.json, this script:
//   1. Downloads <Name>_facial.fbx from the public Microsoft-Rocketbox repo.
//   2. Runs FBX2glTF (the binary shipped by the `fbx2gltf` npm package) to
//      produce a raw GLB. The raw GLB has ~175 morph targets and white
//      placeholder PNGs (FBX2glTF can't read TGA) plus one material per
//      mesh region named like "f005_body" / "m002_head" / "<prefix>_opacity".
//   3. For every material, downloads the matching TGA from the avatar's
//      Textures/ dir (file name = "<materialName>_<slot>.tga", where slot
//      is "color" or "normal"), decodes it with the `tga` package, and
//      hands the raw RGBA pixels to sharp for resize-to-1024px + PNG encode.
//      The resulting PNG is injected into the GLB via @gltf-transform.
//   4. Walks every PrimitiveTarget on every mesh primitive, identifies the
//      original RocketBox blendshape from the POSITION accessor's name
//      (the format FBX2glTF leaves them in is `blendShapeN.AA_VI_NN_xx`
//      and `blendShapeN.AK_NN_<OculusName>`), maps it to the canonical
//      Oculus name (15 visemes + eyeBlinkLeft/Right), drops everything
//      else, and reorders the keepers into the canonical order so the
//      lipsync system can rely on a stable index→name mapping.
//   5. Runs @gltf-transform's prune() + dedup() to garbage-collect unused
//      accessors / bufferViews and shrink the file to the 3–7 MB range
//      already established for the previously-shipped avatars.
//   6. Writes the result to `public/avatars/heads/<dstName>.glb`.
//
// Idempotency: if the destination GLB already exists, the avatar is
// skipped (the 10 already-shipped GLBs are protected this way). Pass
// `--force` to override. Pass `--only=<dstName>[,<dstName>...]` to
// process only a subset.
//
// Background reading:
//  - Microsoft-Rocketbox: https://github.com/microsoft/Microsoft-Rocketbox
//  - FBX2glTF v0.9.7 flags: ./node_modules/fbx2gltf/bin/Darwin/FBX2glTF --help
//  - Oculus visemes: viseme_sil, viseme_PP, viseme_FF, viseme_TH, viseme_DD,
//    viseme_kk, viseme_CH, viseme_SS, viseme_nn, viseme_RR, viseme_aa,
//    viseme_E, viseme_I, viseme_O, viseme_U.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import TGA from 'tga';

import { VISEME_KEYS } from '../../src/utils/visemes.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HEADS_DIR = path.join(REPO_ROOT, 'public', 'avatars', 'heads');
const WORK_DIR  = path.join(__dirname, 'work');
const FBX_BIN   = path.join(__dirname, 'node_modules', 'fbx2gltf', 'bin', 'Darwin', 'FBX2glTF');
const MIME_PNG  = 'image/png';

// 15 Oculus visemes (shared with the runtime — see src/utils/visemes.js)
// followed by the two blink shapes. Every emitted GLB carries its 17 morph
// targets in this exact order so PatientAvatar.jsx can index positionally.
const TARGET_ORDER = new Map();
VISEME_KEYS.forEach((n, i) => TARGET_ORDER.set(n, i));
TARGET_ORDER.set('eyeBlinkLeft', 15);
TARGET_ORDER.set('eyeBlinkRight', 16);
const KEEP_NAMES = new Set(TARGET_ORDER.keys());

// `blendShapeN.AA_VI_NN_xx` → viseme_xx (positional, since the suffix on
// AA_VI_08 and AA_VI_10 is empty in the source).
function mapAccessorNameToOculus(rawName) {
    let m = rawName.match(/AA_VI_(\d{2})/);
    if (m) {
        const idx = parseInt(m[1], 10);
        if (idx >= 0 && idx < VISEME_KEYS.length) return VISEME_KEYS[idx];
    }
    m = rawName.match(/AK_(\d{2})/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n === 9)  return 'eyeBlinkLeft';
        if (n === 10) return 'eyeBlinkRight';
    }
    return null;
}

const RB_BASE = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars';

async function fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

async function fetchToFile(url, dest) {
    if (fs.existsSync(dest)) return; // cache
    const buf = await fetchBuffer(url);
    await fsp.writeFile(dest, buf);
}

async function tgaToPng1024(tgaBuf) {
    const tga = new TGA(tgaBuf);
    return sharp(tga.pixels, {
        raw: { width: tga.width, height: tga.height, channels: 4 }
    })
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
}

async function downloadAndScaleTexture(srcGroup, srcName, fileName) {
    const url = `${RB_BASE}/${srcGroup}/${srcName}/Textures/${fileName}`;
    const tga = await fetchBuffer(url).catch(err => {
        console.warn(`    [tex] missing ${fileName}: ${err.message}`);
        return null;
    });
    if (!tga) return null;
    return tgaToPng1024(tga);
}

async function runFbx2gltf(fbxPath, outBase) {
    // --pbr-metallic-roughness: emit glTF 2.0 PBR materials.
    // --binary: emit .glb (single file).
    // --keep-attribute auto: let FBX2glTF prune unused vertex attribs.
    // (We do NOT pass --blend-shape-normals/tangents — the lipsync runtime
    // reads only the POSITION delta per viseme, and including normals/
    // tangents per target inflates the output 3-4x for no visual gain.)
    const { stdout, stderr } = await execFileP(FBX_BIN, [
        '--pbr-metallic-roughness',
        '--binary',
        '--keep-attribute', 'auto',
        '-o', outBase,
        fbxPath
    ]);
    if (process.env.VERBOSE) {
        if (stdout.trim()) console.log(stdout);
        if (stderr.trim()) console.log(stderr);
    }
}

async function processOne(avatar, opts) {
    const { srcGroup, srcName, dstName } = avatar;
    const dst = path.join(HEADS_DIR, `${dstName}.glb`);
    if (!opts.force && fs.existsSync(dst)) {
        console.log(`  [skip] ${dstName}.glb already exists`);
        return { skipped: true };
    }

    const work = path.join(WORK_DIR, srcName);
    await fsp.mkdir(work, { recursive: true });

    // 1. Download source FBX.
    const fbxPath = path.join(work, `${srcName}_facial.fbx`);
    console.log(`  [fbx] downloading ${srcName}_facial.fbx`);
    await fetchToFile(`${RB_BASE}/${srcGroup}/${srcName}/Export/${srcName}_facial.fbx`, fbxPath);

    // 2. Run FBX2glTF.
    const rawBase = path.join(work, 'raw');
    const rawGlb  = `${rawBase}.glb`;
    if (!fs.existsSync(rawGlb)) {
        console.log(`  [fbx2gltf] converting → raw.glb`);
        await runFbx2gltf(fbxPath, rawBase);
    }

    // 3. Load with @gltf-transform.
    const io = new NodeIO();
    const doc = await io.read(rawGlb);
    const root = doc.getRoot();

    // 4. Replace placeholder textures. Per-material slots fetch in parallel
    //    (5-7 TGAs at 12-16 MB each dominate per-avatar wall time when fetched
    //    serially). texCache stores the in-flight Promise so two materials
    //    requesting the same TGA share one fetch.
    const texCache = new Map();
    function loadTex(fileName) {
        let p = texCache.get(fileName);
        if (!p) {
            p = downloadAndScaleTexture(srcGroup, srcName, fileName);
            texCache.set(fileName, p);
        }
        return p;
    }

    const TEX_SLOTS = [
        ['getBaseColorTexture', 'color'],
        ['getNormalTexture',    'normal']
    ];
    await Promise.all(root.listMaterials().flatMap(mat => {
        const matName = mat.getName(); // e.g. "f005_body", "m002_opacity"
        if (!matName) return [];
        return TEX_SLOTS.flatMap(([getter, slot]) => {
            const tex = mat[getter]();
            if (!tex) return [];
            return [loadTex(`${matName}_${slot}.tga`).then(png => {
                if (png) {
                    tex.setImage(png);
                    tex.setMimeType(MIME_PNG);
                }
            })];
        });
    }));

    // 5. Walk PrimitiveTargets, name them, drop non-keepers, reorder.
    //
    // Each target object is per-primitive (the LOD primitives have parallel
    // target arrays). The rename + drop has to happen for EVERY primitive
    // in EVERY mesh; if even one primitive's targets disagree with the
    // mesh-level targetNames, the writer will use the first prim's order.
    let totalKept = 0, totalDropped = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const targets = prim.listTargets();

            for (const target of targets) {
                const pos = target.getAttribute('POSITION');
                const accessorName = pos?.getName() || '';
                const oculus = mapAccessorNameToOculus(accessorName);
                if (oculus && KEEP_NAMES.has(oculus)) {
                    target.setName(oculus);
                } else {
                    target.setName('__DROP__');
                }
            }

            // Drop unwanted.
            for (const target of [...prim.listTargets()]) {
                if (target.getName() === '__DROP__') {
                    prim.removeTarget(target);
                    target.dispose();
                    totalDropped++;
                }
            }

            // Reorder remaining into canonical Oculus order. removeTarget
            // followed by addTarget re-attaches; the underlying graph
            // preserves the target object so its attributes stay bound.
            const keepers = [...prim.listTargets()].sort(
                (a, b) => TARGET_ORDER.get(a.getName()) - TARGET_ORDER.get(b.getName())
            );
            for (const t of [...prim.listTargets()]) prim.removeTarget(t);
            for (const t of keepers) prim.addTarget(t);

            totalKept += keepers.length;
        }

        // mesh.weights mirrors primitive.targets.length per glTF spec.
        // @gltf-transform's removeTarget doesn't shrink the mesh-level
        // weights array, so if we leave it alone three.js will allocate
        // a 175-entry morphTargetInfluences and our index lookups land
        // on shader slots that don't exist. Resize to match the kept count.
        const keptCount = mesh.listPrimitives()[0]?.listTargets().length || 0;
        mesh.setWeights(new Array(keptCount).fill(0));
    }
    console.log(`  [morphs] kept=${totalKept} dropped=${totalDropped}`);

    // 6. Garbage-collect orphaned accessors / bufferViews / textures /
    //    samplers etc., and dedupe identical resources across primitives.
    await doc.transform(prune(), dedup());

    // 7. Write final GLB. The @gltf-transform writer pulls
    //    targetNames from `primitive.listTargets().map(t => t.getName())`
    //    on the FIRST primitive that has targets — which is exactly the
    //    Oculus names we set in step 5.
    await io.write(dst, doc);

    const sizeMB = (fs.statSync(dst).size / (1024 * 1024)).toFixed(2);
    console.log(`  [out] ${dstName}.glb (${sizeMB} MB)`);
    return { kept: totalKept, dropped: totalDropped, sizeMB };
}

async function main() {
    const args = process.argv.slice(2);
    const opts = {
        force: args.includes('--force'),
        only: null
    };
    const onlyArg = args.find(a => a.startsWith('--only='));
    if (onlyArg) {
        opts.only = new Set(onlyArg.slice('--only='.length).split(','));
    }

    if (!fs.existsSync(FBX_BIN)) {
        throw new Error(
            `FBX2glTF not found at ${FBX_BIN}.\n` +
            `Run \`npm install\` from ${__dirname} first.`
        );
    }

    const avatars = JSON.parse(fs.readFileSync(path.join(__dirname, 'avatars.json'), 'utf8'));
    const todo = opts.only ? avatars.filter(a => opts.only.has(a.dstName)) : avatars;

    await fsp.mkdir(HEADS_DIR, { recursive: true });
    await fsp.mkdir(WORK_DIR, { recursive: true });

    const results = [];
    for (const avatar of todo) {
        console.log(`\n→ ${avatar.srcName} → ${avatar.dstName}.glb`);
        try {
            const r = await processOne(avatar, opts);
            results.push({ avatar, ...r });
        } catch (err) {
            console.error(`  [FAIL] ${err.stack || err.message}`);
            results.push({ avatar, error: err.message });
        }
    }

    console.log('\n=== Summary ===');
    for (const r of results) {
        if (r.skipped) console.log(`  ${r.avatar.dstName}.glb  [skipped]`);
        else if (r.error) console.log(`  ${r.avatar.dstName}.glb  [FAIL] ${r.error}`);
        else console.log(`  ${r.avatar.dstName}.glb  ${r.sizeMB} MB  morphs=${r.kept}`);
    }
}

main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});
