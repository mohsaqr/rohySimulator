// Release / CI / backup supply-chain contracts, security audit 2026-10-26
// (L6-11 release tagging, L6-14 pins + vendor:check, F-29 air-gap bundle,
// L6-13 backup permissions). Text-level contracts on the workflow and shell
// files, plus one real run of scripts/rohy-backup.sh against a temp DB.

import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('dynajs is pinned in CI to the commit the image builds (L6-14)', () => {
    const dockerRef = read('deploy/docker/Dockerfile').match(/^ARG DYNAJS_GIT_REF=([0-9a-f]{40})$/m)?.[1];

    it('the Dockerfile pin exists', () => {
        expect(dockerRef).toMatch(/^[0-9a-f]{40}$/);
    });

    // Regression lock: CI and nightly cloned dynajs at an unpinned main.
    it.each(['.github/workflows/ci.yml', '.github/workflows/nightly.yml'])('%s uses the same ref and never clones main', (wf) => {
        const text = read(wf);
        expect(text).toMatch(new RegExp(`^  DYNAJS_GIT_REF: ${dockerRef}$`, 'm'));
        expect(text).not.toMatch(/git clone --depth 1 https:\/\/github\.com\/mohsaqr\/dynajs\.git/);
        const fetches = text.match(/fetch -q --depth 1 https:\/\/github\.com\/mohsaqr\/dynajs\.git "\$DYNAJS_GIT_REF"/g) ?? [];
        const clones = text.match(/name: Clone dynajs sibling/g) ?? [];
        expect(fetches.length).toBe(clones.length);
        expect(clones.length).toBeGreaterThan(0);
    });

    it('compose.yml defaults to the same ref', () => {
        expect(read('deploy/docker/compose.yml')).toContain(`DYNAJS_GIT_REF:-${dockerRef}`);
    });

    it('ci.yml verifies vendored plugin stamps', () => {
        expect(read('.github/workflows/ci.yml')).toMatch(/run: npm run vendor:check/);
    });
});

describe('release.yml publishes only a validated tag (L6-11)', () => {
    const text = read('.github/workflows/release.yml');

    // Regression lock: `echo "ref=${{ inputs.tag }}"` ran inside four `run:` blocks.
    it('inputs.tag reaches a shell only through env', () => {
        const uses = text.split('\n').filter((l) => l.includes('inputs.tag') && !l.trim().startsWith('#'));
        expect(uses).toEqual(['          INPUT_TAG: ${{ inputs.tag }}']);
    });

    it('no run step interpolates the resolved tag either', () => {
        // Every `${{ needs.resolve.outputs.ref }}` is in a with:/env: value.
        const bad = text.split('\n').filter((l) => l.includes('needs.resolve.outputs.ref')
            && !/^\s+(TAG|ref|tag_name):|^\s+\$\{\{ env\.IMAGE \}\}:/.test(l));
        expect(bad).toEqual([]);
    });

    it('every build job checks out the tag itself and waits for validation', () => {
        for (const job of ['docker-image', 'airgap-bundle', 'verify-published-image', 'docker-tarball']) {
            const start = text.indexOf(`\n  ${job}:\n`);
            expect(start, job).toBeGreaterThan(0);
            const rest = text.slice(start + 1);
            const end = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
            const body = end > 0 ? rest.slice(0, end + 1) : rest;
            expect(body, job).toMatch(/needs: (resolve|\[resolve, docker-image\])/);
            expect(body, job).toContain('ref: refs/tags/${{ needs.resolve.outputs.ref }}');
        }
    });

    it('validates format, existence and version match, and gates :latest on main', () => {
        expect(text).toContain("grep -Eq '^v[0-9]+\\.[0-9]+(\\.[0-9]+(-[0-9A-Za-z.]+)?|\\.RC[0-9]+)$'");
        expect(text).toMatch(/refs\/tags\/\$TAG\^\{commit\}/);
        expect(text).toMatch(/if \[ "\$VERSION" != "\$EXPECTED" \]/);
        expect(text).toMatch(/git merge-base --is-ancestor "refs\/tags\/\$TAG\^\{commit\}" origin\/main/);
        expect(text).toContain("${{ needs.resolve.outputs.latest == 'true' && format('{0}:latest', env.IMAGE) || '' }}");
        expect(text).not.toMatch(/^\s+\$\{\{ env\.IMAGE \}\}:latest$/m);
    });

    it('the RC tag mapping matches every released RC tag convention', () => {
        const map = (tag) => execFileSync('bash', ['-c', `printf '%s' "$0" | sed -E 's/^v([0-9]+)\\.([0-9]+)\\.RC0*([0-9]+)$/\\1.\\2.0-rc.\\3/'`, tag], { encoding: 'utf8' });
        expect(map('v3.0.RC41')).toBe('3.0.0-rc.41');
        expect(map('v3.0.RC01')).toBe('3.0.0-rc.1');
        expect(map('v3.0.RC0')).toBe('3.0.0-rc.0');
    });
});

describe('the air-gap source bundle is built from git, not the working tree (F-29)', () => {
    const text = read('deploy/bundle-airgap.sh');

    // Regression lock: `rsync -a … "$REPO_SRC/" "$root/repo/"` packed tokens, backups and audits.
    it('stages from git archive HEAD and copies no whole-tree rsync', () => {
        expect(text).toContain('git -C "$REPO_SRC" archive --format=tar HEAD | tar -x -C "$root/repo"');
        expect(text).not.toMatch(/"\$REPO_SRC\/" "\$root\/repo\/"/);
    });

    it('adds untracked build artifacts only from an explicit list without local state', () => {
        const list = text.match(/BUILD_PAYLOAD=\(\n([\s\S]*?)\n\)/)?.[1].split('\n').map((l) => l.trim()).filter(Boolean);
        expect(list).toContain('node_modules');
        for (const forbidden of ['public/uploads', '.local-backups', 'audit', 'tests', 'server/database.sqlite', 'server/.env']) {
            expect(list.some((p) => p === forbidden || p.startsWith(`${forbidden}/`))).toBe(false);
        }
    });

    it('keeps its documented interface', () => {
        for (const flag of ['--mode=source|--mode=docker|--mode=both', '--output=*', '--with-hf-cache', '--with-dynajs', '--with-3d', '--with-piper', '--no-piper', '--skip-checksum', '--dry-run']) {
            expect(text).toContain(flag);
        }
        expect(spawnSync('bash', ['-n', path.join(repoRoot, 'deploy/bundle-airgap.sh')]).status).toBe(0);
    });
});

describe('scripts/rohy-backup.sh (L6-13)', () => {
    const text = read('scripts/rohy-backup.sh');

    it('sets umask 077 before writing anything and never stores the env beside the DB', () => {
        expect(text.indexOf('umask 077')).toBeGreaterThan(0);
        expect(text.indexOf('umask 077')).toBeLessThan(text.indexOf('sqlite3 "$ROHY_DB" "VACUUM INTO'));
        expect(text).not.toMatch(/"\$SUBDIR\/env"/);
        expect(read('bin/rohy-update')).toContain('snapshot_env_file');
    });

    const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;
    const bashMajor = Number(spawnSync('bash', ['-c', 'echo ${BASH_VERSINFO[0]}'], { encoding: 'utf8' }).stdout.trim());

    // Regression lock: snapshots were 0644 / 0755 and carried JWT_SECRET in <snapshot>/env.
    it.skipIf(!hasSqlite)('writes 0700 dirs and 0600 files, and the env file apart', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2-e2-backup-'));
        try {
            const db = path.join(dir, 'src.sqlite');
            execFileSync('sqlite3', [db, 'CREATE TABLE schema_migrations(name TEXT); INSERT INTO schema_migrations VALUES (\'0001_x.sql\');']);
            const envFile = path.join(dir, 'env');
            fs.writeFileSync(envFile, 'JWT_SECRET=not-for-the-backup-dir\n', { mode: 0o600 });
            const backups = path.join(dir, 'backups');
            const run = spawnSync('bash', [path.join(repoRoot, 'scripts/rohy-backup.sh'), '--label', 'sec2'], {
                env: { ...process.env, ROHY_DB: db, ROHY_ENV_FILE: envFile, ROHY_BACKUP_DIR: backups, REPO_DIR: dir },
                encoding: 'utf8',
            });
            // The retention pass needs bash >= 4 (mapfile, associative arrays):
            // on macOS's bash 3.2 it stops after the snapshot is written.
            if (bashMajor >= 4) expect(run.status, run.stderr).toBe(0);
            const snaps = fs.readdirSync(backups);
            expect(snaps).toHaveLength(1);
            const snap = path.join(backups, snaps[0]);
            const mode = (p) => fs.statSync(p).mode & 0o777;
            expect(mode(backups)).toBe(0o700);
            expect(mode(snap)).toBe(0o700);
            expect(mode(path.join(snap, 'database.sqlite'))).toBe(0o600);
            expect(mode(path.join(snap, 'manifest.json'))).toBe(0o600);
            expect(fs.existsSync(path.join(snap, 'env'))).toBe(false);
            const envSnap = path.join(`${backups}-env`, `${snaps[0]}.env`);
            expect(fs.readFileSync(envSnap, 'utf8')).toContain('not-for-the-backup-dir');
            expect(mode(envSnap)).toBe(0o600);
            expect(mode(`${backups}-env`)).toBe(0o700);
            for (const f of fs.readdirSync(snap)) {
                expect(fs.readFileSync(path.join(snap, f)).includes('not-for-the-backup-dir'), f).toBe(false);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
