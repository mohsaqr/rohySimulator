// Contract tests for deploy/docker/compose.yml + entrypoint.sh.
//
// Regression lock: reported 2026-08-06 against v2.9.12. `docker compose up`
// failed outright with
//
//   invalid interpolation format for services.rohy.environment.FRONTEND_URL.
//   You may need to escape any $ with another $.
//
// because the file wrote a default that contained another interpolation:
//
//   FRONTEND_URL: "${FRONTEND_URL:-https://${ROHY_HOSTNAME:-localhost}/rohy}"
//
// Compose has no nested interpolation. Nothing in the repo executed this
// file, so the deploy path was broken for every Docker operator while every
// test, lint and CI job stayed green — the only detector was a human typing
// `docker compose up`. These tests are that detector.
//
// The tempting "fix" of escaping to `$${ROHY_HOSTNAME:-localhost}` is worse
// than the error: `$$` is Compose's literal-dollar escape, so the file
// parses and the container receives the *unexpanded text* as its public
// origin. That is checked here too, because a passing parse would otherwise
// look like success.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), '..', '..');
const COMPOSE = path.join(REPO, 'deploy', 'docker', 'compose.yml');
const ENTRYPOINT = path.join(REPO, 'deploy', 'docker', 'entrypoint.sh');

const composeSrc = fs.readFileSync(COMPOSE, 'utf8');

/**
 * Blank out YAML comments, preserving line/column positions.
 *
 * compose.yml documents the broken pattern in a comment so the next reader
 * knows why the fallback moved to the entrypoint. A scanner that reads
 * comments as content would flag that explanation as the defect — reporting
 * a failure exactly where someone wrote down the hazard. Quote state is
 * tracked so a `#` inside a value is not mistaken for a comment.
 */
function stripComments(src) {
    let out = '';
    let quote = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\n') { quote = null; out += c; continue; }
        if (quote) {
            out += c;
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; out += c; continue; }
        if (c === '#') {
            // Blank to end of line rather than delete, so offsets still map
            // back to the real file.
            while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
            out += '\n';
            continue;
        }
        out += c;
    }
    return out;
}

const composeCode = stripComments(composeSrc);

/**
 * Every `${…}` interpolation in the file, with its raw body.
 *
 * Compose's grammar is ${VAR}, ${VAR:-default}, ${VAR-default},
 * ${VAR:?err}, ${VAR?err}; `$$` escapes a literal dollar. A body that
 * itself contains `${` is the failure this file exists to catch.
 */
function interpolations(src) {
    const out = [];
    for (let i = 0; i < src.length - 1; i++) {
        if (src[i] !== '$') continue;
        if (src[i + 1] === '$') { i++; continue; }   // $$ — escaped literal
        if (src[i + 1] !== '{') continue;
        // Scan to the matching close brace, tracking nesting so the body of
        // a malformed nested expression is reported whole.
        let depth = 0;
        let j = i + 1;
        for (; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') { depth--; if (depth === 0) break; }
        }
        out.push({ raw: src.slice(i, j + 1), body: src.slice(i + 2, j) });
        i = j;
    }
    return out;
}

describe('deploy/docker/compose.yml', () => {
    it('is valid YAML and defines the rohy service', () => {
        const doc = yaml.load(composeSrc);
        expect(doc?.services?.rohy).toBeTruthy();
        expect(doc?.services?.caddy).toBeTruthy();
    });

    it('has no nested interpolation — Compose rejects the whole file', () => {
        const nested = interpolations(composeCode).filter(x => x.body.includes('${'));
        expect(
            nested.map(x => x.raw),
            'Compose cannot expand an interpolation inside another\'s default. ' +
            'Move the fallback into deploy/docker/entrypoint.sh, where a shell can express it.'
        ).toEqual([]);
    });

    it('never escapes an interpolation into a literal $ in an env value', () => {
        // `$${VAR}` parses fine and passes the text "${VAR}" to the container.
        // For a value like FRONTEND_URL that is silent breakage, not an error.
        const doc = yaml.load(composeSrc);
        const offenders = [];
        for (const [svcName, svc] of Object.entries(doc.services || {})) {
            for (const [key, value] of Object.entries(svc.environment || {})) {
                if (typeof value === 'string' && /\$\$\{/.test(value)) {
                    offenders.push(`${svcName}.environment.${key} = ${value}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('passes ROHY_HOSTNAME to the rohy service so the entrypoint can derive FRONTEND_URL', () => {
        const env = yaml.load(composeSrc).services.rohy.environment;
        expect(Object.keys(env)).toContain('ROHY_HOSTNAME');
        // Both must be pass-through-empty: an empty FRONTEND_URL is the
        // signal to derive, and an empty ROHY_HOSTNAME is the signal that the
        // operator set no hostname at all (fatal in production). Defaulting
        // either one to a literal here would defeat the entrypoint's guard.
        expect(env.FRONTEND_URL).toBe('${FRONTEND_URL:-}');
        expect(env.ROHY_HOSTNAME).toBe('${ROHY_HOSTNAME:-}');
    });
});

// The derivation compose can no longer express now lives in shell, so test
// the shell. These run the real entrypoint with a stub CMD that prints the
// resolved value.
describe('deploy/docker/entrypoint.sh — FRONTEND_URL derivation', () => {
    function runEntrypoint(env) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-ep-'));
        try {
            const stdout = execFileSync('sh', [
                ENTRYPOINT, '/bin/sh', '-c', 'printf "RESOLVED=%s" "$FRONTEND_URL"',
            ], {
                env: {
                    PATH: process.env.PATH,
                    ROHY_SECRETS_DIR: path.join(tmp, 'secrets'),
                    ROHY_DB: path.join(tmp, 'db', 'database.sqlite'),
                    TRANSFORMERS_CACHE: path.join(tmp, 'hf'),
                    ...env,
                },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            return { ok: true, resolved: (stdout.match(/RESOLVED=(.*)$/) || [])[1] ?? '' };
        } catch (err) {
            return { ok: false, stderr: String(err.stderr || ''), status: err.status };
        }
    }

    it('derives https://$ROHY_HOSTNAME/rohy when FRONTEND_URL is unset', () => {
        const r = runEntrypoint({ ROHY_HOSTNAME: 'rohy.example.com' });
        expect(r.ok).toBe(true);
        expect(r.resolved).toBe('https://rohy.example.com/rohy');
    });

    it('honours the localhost hostname that .env.example ships', () => {
        const r = runEntrypoint({ ROHY_HOSTNAME: 'localhost' });
        expect(r.ok).toBe(true);
        expect(r.resolved).toBe('https://localhost/rohy');
    });

    it('lets an explicit FRONTEND_URL win over the hostname', () => {
        const r = runEntrypoint({
            ROHY_HOSTNAME: 'rohy.example.com',
            FRONTEND_URL: 'https://elsewhere.test/app',
        });
        expect(r.ok).toBe(true);
        expect(r.resolved).toBe('https://elsewhere.test/app');
    });

    it('never resolves to unexpanded text', () => {
        const r = runEntrypoint({ ROHY_HOSTNAME: 'rohy.example.com' });
        expect(r.resolved).not.toContain('${');
    });

    it('still refuses to boot in production with neither variable set', () => {
        const r = runEntrypoint({ NODE_ENV: 'production' });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/FRONTEND_URL is not set/);
        // The message must name the derivation path, or an operator who set
        // only ROHY_HOSTNAME in .env has no idea why it did not take.
        expect(r.stderr).toMatch(/ROHY_HOSTNAME/);
    });
});

// Regression lock: the image and compose defaulted ROHY_TRUST_PROXY=loopback while Caddy runs in a SEPARATE container, so Express ignored X-Forwarded-For — every user shared one login rate-limit bucket and every audit row carried Caddy's bridge IP (security audit 2026-10-24)
describe('trust proxy on the Docker path', () => {
    const DOCKERFILE = fs.readFileSync(path.join(REPO, 'deploy', 'docker', 'Dockerfile'), 'utf8');
    const CADDYFILE = fs.readFileSync(path.join(REPO, 'deploy', 'docker', 'Caddyfile'), 'utf8');

    it('compose defaults ROHY_TRUST_PROXY to uniquelocal, never loopback', () => {
        const env = yaml.load(composeSrc).services.rohy.environment;
        expect(env.ROHY_TRUST_PROXY).toBe('${ROHY_TRUST_PROXY:-uniquelocal}');
        expect(env.ROHY_TRUST_PROXY).not.toMatch(/loopback/);
    });

    it('the image default agrees', () => {
        expect(DOCKERFILE).toMatch(/ROHY_TRUST_PROXY=uniquelocal/);
        expect(DOCKERFILE).not.toMatch(/ROHY_TRUST_PROXY=loopback/);
    });

    it('is safe only because rohy:4000 is unpublished and Caddy overwrites X-Forwarded-For', () => {
        const rohy = yaml.load(composeSrc).services.rohy;
        expect(rohy.ports).toBeUndefined();
        // Every header_up X-Forwarded-For REPLACES the value with the peer address.
        const xff = CADDYFILE.split('\n').filter((l) => /header_up\s+X-Forwarded-For/.test(l) && !/^\s*#/.test(l));
        expect(xff.length).toBeGreaterThan(0);
        for (const line of xff) expect(line).toMatch(/X-Forwarded-For\s+\{remote_host\}\s*$/);
    });
});

// Regression lock: the rohy container ran with Docker's default capability set and could gain privileges via setuid, and the generated JWT secret lived inside the database volume, so any copy of the DB volume carried the signing key (security audit 2026-10-24)
describe('container hardening', () => {
    const doc = yaml.load(composeSrc);
    const DOCKERFILE = fs.readFileSync(path.join(REPO, 'deploy', 'docker', 'Dockerfile'), 'utf8');

    it('drops every capability and forbids new privileges', () => {
        expect(doc.services.rohy.cap_drop).toEqual(['ALL']);
        expect(doc.services.rohy.security_opt).toContain('no-new-privileges:true');
    });

    it('keeps the JWT secret on its own named volume, declared in compose and the image', () => {
        expect(doc.services.rohy.volumes).toContain('rohy-secrets:/var/lib/rohy-secrets');
        expect(Object.keys(doc.volumes)).toContain('rohy-secrets');
        expect(DOCKERFILE).toMatch(/VOLUME \[[^\]]*"\/var\/lib\/rohy-secrets"/);
        expect(DOCKERFILE).toMatch(/ROHY_SECRETS_DIR=\/var\/lib\/rohy-secrets/);
    });

    it('pins dynajs to a commit, not a branch', () => {
        const args = doc.services.rohy.build.args;
        expect(args.DYNAJS_GIT_REF).toMatch(/^\$\{DYNAJS_GIT_REF:-[0-9a-f]{40}\}$/);
        expect(DOCKERFILE).toMatch(/^ARG DYNAJS_GIT_REF=[0-9a-f]{40}$/m);
        // The same pin in both places, or the compose build and a bare
        // `docker build` produce different images.
        const composeSha = args.DYNAJS_GIT_REF.match(/[0-9a-f]{40}/)[0];
        expect(DOCKERFILE).toContain(`ARG DYNAJS_GIT_REF=${composeSha}`);
    });

    it('no longer passes ALLOW_DEFAULT_USERS through compose (refused in production)', () => {
        expect(Object.keys(doc.services.rohy.environment)).not.toContain('ALLOW_DEFAULT_USERS');
        expect(Object.keys(doc.services.rohy.environment)).toEqual(
            expect.arrayContaining(['ROHY_ADMIN_USERNAME', 'ROHY_ADMIN_PASSWORD'])
        );
    });
});

describe('deploy/docker/entrypoint.sh — JWT secret location', () => {
    function run(env, tmp) {
        return execFileSync('sh', [ENTRYPOINT, '/bin/sh', '-c', 'printf "JWT=%s" "$JWT_SECRET"'], {
            env: {
                PATH: process.env.PATH,
                ROHY_HOSTNAME: 'localhost',
                ROHY_DB: path.join(tmp, 'db', 'database.sqlite'),
                TRANSFORMERS_CACHE: path.join(tmp, 'hf'),
                ...env,
            },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }

    it('generates the secret into ROHY_SECRETS_DIR and reuses it on the next start', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-ep-secret-'));
        try {
            const env = { ROHY_SECRETS_DIR: path.join(tmp, 'secrets'), ROHY_LEGACY_SECRETS_DIR: path.join(tmp, 'db', '.secrets') };
            const first = run(env, tmp).match(/JWT=(.*)$/)[1];
            expect(first.length).toBeGreaterThanOrEqual(32);
            expect(fs.readFileSync(path.join(tmp, 'secrets', 'jwt_secret'), 'utf8')).toBe(first);
            expect(fs.statSync(path.join(tmp, 'secrets', 'jwt_secret')).mode & 0o077).toBe(0);
            expect(run(env, tmp).match(/JWT=(.*)$/)[1]).toBe(first);
            // Nothing written into the database volume.
            expect(fs.existsSync(path.join(tmp, 'db', '.secrets'))).toBe(false);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    it('moves a secret from the old in-DB-volume location so existing sessions survive the upgrade', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-ep-legacy-'));
        try {
            const legacyDir = path.join(tmp, 'db', '.secrets');
            fs.mkdirSync(legacyDir, { recursive: true });
            fs.writeFileSync(path.join(legacyDir, 'jwt_secret'), 'legacy-secret-0123456789abcdef0123456789');
            const env = { ROHY_SECRETS_DIR: path.join(tmp, 'secrets'), ROHY_LEGACY_SECRETS_DIR: legacyDir };
            expect(run(env, tmp)).toContain('JWT=legacy-secret-0123456789abcdef0123456789');
            expect(fs.existsSync(path.join(legacyDir, 'jwt_secret'))).toBe(false);
            expect(fs.readFileSync(path.join(tmp, 'secrets', 'jwt_secret'), 'utf8')).toBe('legacy-secret-0123456789abcdef0123456789');
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});
