#!/usr/bin/env node
// Is production serving the release the `current` tag names?
//
//   npm run check:prod
//   node scripts/check-prod-version.mjs --url https://rohy.lacarm.com --tag current
//
// Reads the live /api/health, reads package.json at the tag's commit, and
// compares the two versions. A mismatch is expected for a while after the tag
// moves — the server's cron pulls the tag, rebuilds and restarts — so a
// mismatch is only a failure once the tag is older than GRACE_MS. The tag is
// lightweight, so its COMMIT time stands in for when it moved (a tag moved onto
// an old commit therefore gets no grace; that errs towards alerting).
//
// The tag is fetched into FETCH_HEAD, never into refs/tags: this reads the
// remote's release tag without moving the local one.
//
// Exit: 0 ok or within grace · 1 production is on the wrong version · 2 could
// not check (health unreachable, tag unreadable, bad usage).
//
// Used by .github/workflows/prod-check.yml every ten minutes.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRACE_MS = 15 * 60 * 1000;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : 'unknown');

/**
 * The verdict on a live version against the tag's.
 *
 * @param {object} facts
 * @param {string|null|undefined} facts.liveVersion  /api/health → version
 * @param {string} facts.tagVersion                  package.json at the tag
 * @param {number} facts.tagTimeMs                   when the tag moved (its commit time)
 * @param {number} facts.nowMs
 * @param {number|null} [facts.startedAtMs]          /api/health → started_at, for the message
 * @param {number} [facts.graceMs]
 * @returns {{ verdict: 'ok'|'grace'|'fail', message: string }}
 */
export function decideProdVersion({ liveVersion, tagVersion, tagTimeMs, nowMs, startedAtMs = null, graceMs = GRACE_MS }) {
    if (typeof liveVersion !== 'string' || liveVersion === '' || liveVersion === 'unknown') {
        return { verdict: 'fail', message: `production reports no usable version (got ${JSON.stringify(liveVersion ?? null)})` };
    }
    if (liveVersion === tagVersion) {
        return { verdict: 'ok', message: `production serves ${liveVersion}, the tagged release` };
    }
    const tagAgeMs = nowMs - tagTimeMs;
    const minutes = Math.floor(tagAgeMs / 60_000);
    if (tagAgeMs < graceMs) {
        return {
            verdict: 'grace',
            message: `production serves ${liveVersion}, the tag names ${tagVersion}; the tag moved ${minutes} min ago `
                + `(grace ${graceMs / 60_000} min) — a deploy is presumably in flight`,
        };
    }
    const restarted = Number.isFinite(startedAtMs)
        ? (startedAtMs < tagTimeMs
            ? `the server has not restarted since the tag moved (started ${iso(startedAtMs)}, tag ${iso(tagTimeMs)})`
            : `the server restarted at ${iso(startedAtMs)}, after the tag moved, and still serves the old version`)
        : 'the server did not report when it started';
    return {
        verdict: 'fail',
        message: `production serves ${liveVersion} but the tag names ${tagVersion}, and the tag moved ${minutes} min ago; ${restarted}`,
    };
}

function parseArgs(argv) {
    const args = { url: 'https://rohy.lacarm.com', tag: 'current', remote: 'origin', fetch: true };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--url') args.url = argv[++i];
        else if (a === '--tag') args.tag = argv[++i];
        else if (a === '--remote') args.remote = argv[++i];
        else if (a === '--no-fetch') args.fetch = false;
        else throw new Error(`unknown argument: ${a}`);
    }
    return args;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`${err.message}\nusage: check-prod-version.mjs [--url URL] [--tag TAG] [--remote NAME] [--no-fetch]`);
        return 2;
    }

    let health;
    try {
        const res = await fetch(`${args.url.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        health = await res.json();
    } catch (err) {
        console.error(`✗ ${args.url}/api/health is unreachable: ${err.message}`);
        return 2;
    }

    let ref = args.tag;
    let tagVersion;
    let tagTimeMs;
    try {
        if (args.fetch) {
            git('fetch', '--quiet', args.remote, `refs/tags/${args.tag}`);
            ref = 'FETCH_HEAD';
        }
        tagVersion = JSON.parse(git('show', `${ref}:package.json`)).version;
        tagTimeMs = Number(git('log', '-1', '--format=%ct', ref)) * 1000;
    } catch (err) {
        console.error(`✗ could not read the ${args.tag} tag: ${err.stderr?.toString().trim() || err.message}`);
        return 2;
    }

    const startedAtMs = Date.parse(health.started_at);
    const { verdict, message } = decideProdVersion({
        liveVersion: health.version,
        tagVersion,
        tagTimeMs,
        nowMs: Date.now(),
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
    });
    const mark = { ok: '✓', grace: '…', fail: '✗' }[verdict];
    console.log(`${mark} ${message}`);
    if (verdict === 'fail' && process.env.GITHUB_ACTIONS) console.log(`::error title=prod version::${message}`);
    return verdict === 'fail' ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then((code) => process.exit(code));
}
