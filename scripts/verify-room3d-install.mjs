#!/usr/bin/env node
/**
 * Refuse to build without the Bedside package.
 *
 * `rohy-3d-patient-room` is declared `file:../3D`. Plugin discovery is an
 * eager Vite glob, so a missing or empty sibling is not a caught plugin
 * load failure — it is a build that dies inside Rollup on an unresolvable
 * import, somewhere far from the cause. Same reason the dynajs sibling is
 * the first line of the install docs: say it here, first, in plain words.
 *
 *   npm run verify:room3d        (also runs from `prebuild`)
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const contract = JSON.parse(readFileSync(resolve(root, 'scripts', 'room3d-version.json'), 'utf8'));
const spec = pkg.dependencies?.['rohy-3d-patient-room'] ?? pkg.devDependencies?.['rohy-3d-patient-room'];

if (!spec) {
    console.log('verify:room3d — rohy-3d-patient-room is not a dependency; nothing to check.');
    process.exit(0);
}
if (!spec.startsWith('file:')) {
    console.log(`verify:room3d — rohy-3d-patient-room comes from ${spec}; npm resolves it.`);
    process.exit(0);
}

const sibling = resolve(root, spec.slice('file:'.length));
const installed = resolve(root, 'node_modules', 'rohy-3d-patient-room');
const problems = [];
if (!existsSync(resolve(sibling, 'src', 'main.js'))) {
    problems.push(
        `${sibling}/src/main.js is missing — run \`bash scripts/clone-room3d.sh ../3D\` `
        + 'from this checkout (see docs/INSTALL.md).',
    );
} else {
    const siblingVersion = JSON.parse(readFileSync(resolve(sibling, 'package.json'), 'utf8')).version;
    if (siblingVersion !== contract.version) {
        problems.push(
            `${sibling} is rohy-3d-patient-room ${siblingVersion}; this Rohy checkout requires ${contract.version} (${contract.ref}). `
            + `Remove the sibling and run \`bash scripts/clone-room3d.sh ../3D\`.`,
        );
    }
}
if (!existsSync(installed)) {
    problems.push(`node_modules/rohy-3d-patient-room is missing — run \`npm install\` after cloning the sibling.`);
} else {
    let target;
    try { target = realpathSync(installed); } catch { target = null; }
    if (!target || !existsSync(resolve(target, 'src', 'main.js'))) {
        problems.push(`node_modules/rohy-3d-patient-room does not resolve to a package with src/main.js (got ${target ?? 'unreadable'}) — re-run \`npm install\`.`);
    } else {
        const installedVersion = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8')).version;
        if (installedVersion !== contract.version) {
            problems.push(`node_modules/rohy-3d-patient-room is ${installedVersion}; expected ${contract.version} (${contract.ref}) — re-run \`npm install\` after installing the pinned sibling.`);
        }
    }
}
if (problems.length) {
    console.error('verify:room3d FAILED — Bedside cannot be bundled:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
}
const version = JSON.parse(readFileSync(resolve(sibling, 'package.json'), 'utf8')).version;
console.log(`verify:room3d OK — rohy-3d-patient-room ${version} (${contract.ref}) at ${sibling}`);
