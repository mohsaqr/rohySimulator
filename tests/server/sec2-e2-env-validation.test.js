// Boot-time env validation, security audit 2026-10-26 (F-28, L6-15).
//
// validateEnv.js imports modules that open server/db.js at import time, so
// ROHY_DB is pointed at a throwaway file BEFORE the import (vi.hoisted):
// otherwise importing it opens — and migrates — the developer's own database.

import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDb = vi.hoisted(() => {
    const p = `${process.env.TMPDIR || '/tmp'}/rohy-sec2-e2-env-${process.pid}.sqlite`;
    process.env.ROHY_DB = p;
    return p;
});

const { validateEnv } = await import('../../server/config/validateEnv.js');
const { jwtSecretWeakness } = await import('../../server/lib/jwtSecretPolicy.js');
const { resolveBindHost } = await import('../../server/lib/bindHost.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The throwaway DB (TMPDIR/rohy-sec2-e2-env-<pid>.sqlite) is left to the OS
// temp cleaner: db.js keeps seeding in the background after import, and
// deleting the file under it surfaces as an unhandled SQLITE_READONLY.
void tmpDb;

const prod = (extra = {}) => ({
    NODE_ENV: 'production',
    JWT_SECRET: 'q7R2vX9mKp4LwZ8sT1nB6yH3cF5dJ0gUeA',
    FRONTEND_URL: 'https://rohy.example.org/rohy',
    ROHY_DB: '/opt/data/rohy/database.sqlite',
    TRANSFORMERS_CACHE: '/var/cache/rohy-hf',
    ROHY_TRUST_PROXY: '172.18.0.0/16',
    ...extra,
});

const jwtErrors = (env) => validateEnv(env).errors.filter((e) => e.includes('JWT_SECRET'));

describe('JWT_SECRET placeholders and low-entropy secrets (F-28)', () => {
    // Regression lock: the shipped 36-char placeholder passed the >=32 rule and booted production.
    it('refuses the deploy/env.example placeholder in production', () => {
        const example = fs.readFileSync(path.join(repoRoot, 'deploy', 'env.example'), 'utf8');
        const shipped = example.match(/^JWT_SECRET=(.*)$/m)?.[1];
        expect(shipped).toBeTruthy();
        expect(shipped.length).toBeGreaterThanOrEqual(32);
        expect(jwtErrors(prod({ JWT_SECRET: shipped }))).toEqual([expect.stringMatching(/not a usable secret.*placeholder/)]);
    });

    it.each([
        ['change-me-change-me-change-me-change-me'],
        ['your_super_secret_jwt_key_goes_here_please'],
        ['this-is-an-example-secret-for-local-dev-only'],
        ['a'.repeat(64)],
        ['abcabcabcabcabcabcabcabcabcabcabcabc'],
        ['0123456780123456780123456780123456'],
    ])('refuses %s in production', (secret) => {
        expect(secret.length).toBeGreaterThanOrEqual(32);
        expect(jwtErrors(prod({ JWT_SECRET: secret }))).toHaveLength(1);
    });

    it('accepts real random secrets (hex and base64), every time', () => {
        // 200 draws: the distinct-character floor must never refuse
        // `openssl rand -hex 32`, which uses only 16 symbols.
        for (let i = 0; i < 200; i += 1) {
            const hex = execFileSync('node', ['-e', "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"], { encoding: 'utf8' });
            expect(jwtSecretWeakness(hex)).toBeNull();
        }
        const b64 = execFileSync('node', ['-e', "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"], { encoding: 'utf8' });
        expect(jwtErrors(prod({ JWT_SECRET: b64 }))).toEqual([]);
        // The secrets other suites boot production with.
        expect(jwtSecretWeakness('rohy-tests-production-secret-0123456789')).toBeNull();
        expect(jwtSecretWeakness('fuzz-only-secret-do-not-reuse-anywhere')).toBeNull();
    });

    it('does not refuse a throwaway secret outside production', () => {
        expect(jwtErrors({ NODE_ENV: 'development', JWT_SECRET: 'a'.repeat(64) })).toEqual([]);
        expect(validateEnv({ NODE_ENV: 'test', JWT_SECRET: 'REPLACE_ME_WITH_A_LONG_RANDOM_STRING' }).errors).toEqual([]);
    });

    it('never echoes the secret it refuses', () => {
        const secret = 'replace-me-ZZQ9-unique-marker-value-xyz';
        expect(validateEnv(prod({ JWT_SECRET: secret })).errors.join(' ')).not.toContain('ZZQ9');
    });
});

describe('deploy/preflight.sh applies the same rule', () => {
    function preflightJwtLine(secret) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2-e2-preflight-'));
        const envFile = path.join(dir, 'env');
        fs.writeFileSync(envFile, `JWT_SECRET=${secret}\nNODE_ENV=production\nPORT=59111\nHTTPS_PORT=59112\n`, { mode: 0o600 });
        let out = '';
        try {
            // 2>&1 inside the shell: preflight prints ✗/! lines on stderr, and
            // the [4/9] block must be read in the order it was printed.
            out = execFileSync('bash', ['-c', '"$0" 2>&1', path.join(repoRoot, 'deploy', 'preflight.sh')], {
                env: { ...process.env, ROHY_ENV_FILE: envFile, ROHY_REPO_DIR: repoRoot },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            out = `${err.stdout || ''}${err.stderr || ''}`;
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        const block = out.split('[4/9]')[1]?.split('[5/9]')[0] ?? '';
        return block;
    }

    // Regression lock: preflight printed `ok "JWT_SECRET set (36 chars)"` for the placeholder.
    it('fails the placeholder', () => {
        expect(preflightJwtLine('REPLACE_ME_WITH_A_LONG_RANDOM_STRING')).toMatch(/✗.*not a usable secret/);
    });

    it('passes a random secret', () => {
        const hex = execFileSync('node', ['-e', "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"], { encoding: 'utf8' });
        expect(preflightJwtLine(hex)).toMatch(/✓.*JWT_SECRET set \(64 chars\)/);
    });
});

describe('production posture warnings (L6-15)', () => {
    it('warns when a rate limiter is switched off in production', () => {
        for (const key of ['ROHY_DISABLE_AUTH_RATE_LIMIT', 'ROHY_DISABLE_GENERAL_RATE_LIMIT']) {
            const { errors, warnings } = validateEnv(prod({ [key]: '1' }));
            expect(errors).toEqual([]);
            expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining(key)]));
        }
        expect(validateEnv(prod({ ROHY_DISABLE_AUTH_RATE_LIMIT: '0' })).warnings.join(' ')).not.toContain('ROHY_DISABLE_AUTH_RATE_LIMIT');
        expect(validateEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), ROHY_DISABLE_AUTH_RATE_LIMIT: '1' }).warnings.join(' '))
            .not.toContain('ROHY_DISABLE_AUTH_RATE_LIMIT');
    });

    it('warns on ROHY_TRUST_PROXY=true in production', () => {
        expect(validateEnv(prod({ ROHY_TRUST_PROXY: 'true' })).warnings).toEqual(
            expect.arrayContaining([expect.stringMatching(/ROHY_TRUST_PROXY=true.*X-Forwarded-For/)]),
        );
    });

    it('strips URL credentials from messages', () => {
        const { warnings } = validateEnv(prod({ FRONTEND_URL: 'http://ops:hunter2pw@rohy.example.org/rohy' }));
        const all = warnings.join(' ');
        expect(all).toContain('rohy.example.org');
        expect(all).not.toContain('hunter2pw');
        const bad = validateEnv(prod({ ROHY_KOKORO_URL: 'ftp://u:kokoropw@h/v1' })).errors.join(' ');
        expect(bad).toContain('ROHY_KOKORO_URL');
        expect(bad).not.toContain('kokoropw');
    });
});

describe('default bind host (L9)', () => {
    // Regression lock: production listened on 0.0.0.0 unless ROHY_BIND was set.
    it('binds loopback in production unless ROHY_BIND says otherwise', () => {
        expect(resolveBindHost({ NODE_ENV: 'production' })).toBe('127.0.0.1');
        expect(resolveBindHost({ NODE_ENV: 'production', ROHY_BIND: '0.0.0.0' })).toBe('0.0.0.0');
        expect(resolveBindHost({ NODE_ENV: 'development' })).toBe('0.0.0.0');
        expect(resolveBindHost({})).toBe('0.0.0.0');
        expect(resolveBindHost({ NODE_ENV: 'production', ROHY_BIND: '  ' })).toBe('127.0.0.1');
    });

    it('server.js uses the resolver, and the Docker image + compose opt back in to 0.0.0.0', () => {
        const server = fs.readFileSync(path.join(repoRoot, 'server', 'server.js'), 'utf8');
        expect(server).toMatch(/const BIND_HOST = resolveBindHost\(process\.env\);/);
        expect(server).not.toMatch(/process\.env\.ROHY_BIND \|\| '0\.0\.0\.0'/);
        const dockerfile = fs.readFileSync(path.join(repoRoot, 'deploy', 'docker', 'Dockerfile'), 'utf8');
        expect(dockerfile).toMatch(/^\s+ROHY_BIND=0\.0\.0\.0 \\$/m);
        const compose = fs.readFileSync(path.join(repoRoot, 'deploy', 'docker', 'compose.yml'), 'utf8');
        expect(compose).toMatch(/^\s+ROHY_BIND: "0\.0\.0\.0"$/m);
    });
});
