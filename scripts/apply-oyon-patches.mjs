#!/usr/bin/env node
/*
 * Re-apply Rohy-specific overlays on top of vendored OyonR/.
 *
 * Why this exists:
 *   `npm run oyon:update` runs `rsync --delete` from upstream Oyon, which
 *   wipes anything we've added or modified in OyonR/. The integration depends
 *   on a handful of small but load-bearing patches (Rohy mode in the
 *   standalone, an importmap, a GPU delegate option). Storing the patched
 *   files as overlays in scripts/oyon-overlay/ and copying them back after
 *   every sync is the simplest contract that survives upstream churn:
 *
 *     - Idempotent: running it twice is a no-op.
 *     - Self-documenting: anyone wondering "what did Rohy add?" can list
 *       scripts/oyon-overlay/.
 *     - Fail-loud: if upstream restructures and an overlay's destination
 *       directory disappears, we exit non-zero so CI catches it.
 *
 * Vendor bundles (mediapipe, onnxruntime-web) are NOT overlaid here — they
 * survive the sync via rsync's --exclude /standalone/vendor flag in
 * scripts/update-oyonr.sh. They're third-party assets, never modified, and
 * keeping them out of git overlay tree avoids dragging ~64MB of binaries
 * around in this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const overlayRoot = path.join(repoRoot, 'scripts', 'oyon-overlay');
const oyonRoot = path.join(repoRoot, 'OyonR');

if (!fs.existsSync(oyonRoot)) {
  console.error('OyonR/ does not exist. Run scripts/update-oyonr.sh first.');
  process.exit(1);
}
if (!fs.existsSync(overlayRoot)) {
  console.error(`Overlay tree missing: ${overlayRoot}`);
  process.exit(1);
}

let copied = 0;
let unchanged = 0;
let missingParent = 0;

function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const sourcePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(sourcePath, childRel);
      continue;
    }
    if (!entry.isFile()) continue;
    const targetPath = path.join(oyonRoot, childRel);
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      console.error(`[overlay] missing target dir for ${childRel} — upstream may have restructured: ${targetDir}`);
      missingParent += 1;
      continue;
    }
    if (fs.existsSync(targetPath)) {
      const a = fs.readFileSync(sourcePath);
      const b = fs.readFileSync(targetPath);
      if (a.equals(b)) {
        unchanged += 1;
        continue;
      }
    }
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[overlay] applied ${childRel}`);
    copied += 1;
  }
}

walk(overlayRoot);

console.log(`[overlay] ${copied} copied, ${unchanged} unchanged, ${missingParent} missing-parent`);
if (missingParent > 0) process.exit(2);
