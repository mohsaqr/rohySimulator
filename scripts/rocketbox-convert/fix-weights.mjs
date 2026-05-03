// One-shot patch: every GLB shipped from convert.mjs has mesh.weights
// holding the original 175-entry RocketBox count even though only 17
// morph targets survive prune(). Three.js sizes morphTargetInfluences
// from mesh.weights, so the 158-entry overshoot silently breaks lipsync
// and blink.
//
// This script walks every GLB under public/avatars/heads/, rewrites
// each mesh's weights array to match its first primitive's target count,
// and writes the GLB back in place. Idempotent — safe to re-run.
//
// Run with:  node scripts/rocketbox-convert/fix-weights.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEADS_DIR = path.resolve(__dirname, '..', '..', 'public', 'avatars', 'heads');

const io = new NodeIO();
const files = fs.readdirSync(HEADS_DIR).filter(f => f.startsWith('rb_') && f.endsWith('.glb'));

let fixed = 0, alreadyOk = 0;
for (const file of files) {
    const p = path.join(HEADS_DIR, file);
    const doc = await io.read(p);
    let touched = false;

    for (const mesh of doc.getRoot().listMeshes()) {
        const prim = mesh.listPrimitives()[0];
        const targetCount = prim ? prim.listTargets().length : 0;
        const weights = mesh.getWeights();
        if (weights.length !== targetCount) {
            mesh.setWeights(new Array(targetCount).fill(0));
            touched = true;
        }
    }

    if (touched) {
        await io.write(p, doc);
        fixed++;
        console.log(`  [fixed] ${file}`);
    } else {
        alreadyOk++;
    }
}

console.log(`\nDone. fixed=${fixed} already-ok=${alreadyOk}`);
