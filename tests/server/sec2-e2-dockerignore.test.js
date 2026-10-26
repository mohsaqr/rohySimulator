// Contract test for the repo-root .dockerignore (security audit 2026-10-26, F-27).
//
// Docker matches .dockerignore patterns from the build-context root and `*`
// never crosses `/`. The old root-only `*.sqlite`, `*.sqlite.bak.*`, `*.log`
// (and no `*.db` at all) let server/database.sqlite, its -wal/-shm, a dozen
// pre-migration backups and server/rohy.db into any image built from a
// working checkout. This file evaluates the real .dockerignore with Docker's
// rules (last match wins, `!` re-includes, a match on a directory excludes
// everything under it) and pins both halves of the two-gates trap
// (CLAUDE.md): local state OUT, runtime files IN.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');

function patternToRegex(pattern) {
    const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
    let out = '';
    for (let i = 0; i < body.length; i += 1) {
        const c = body[i];
        if (c === '*' && body[i + 1] === '*') {
            if (body[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
        } else if (c === '*') out += '[^/]*';
        else if (c === '?') out += '[^/]';
        else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
}

const rules = dockerignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.startsWith('!')
        ? { negate: true, re: patternToRegex(l.slice(1)) }
        : { negate: false, re: patternToRegex(l) }));

/** Docker's verdict for one context-relative path. */
function isExcluded(relPath) {
    const parts = relPath.split('/');
    const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    let excluded = false;
    for (const rule of rules) {
        if (candidates.some((c) => rule.re.test(c))) excluded = !rule.negate;
    }
    return excluded;
}

describe('.dockerignore keeps local state out of every image', () => {
    // Regression lock: root-only sqlite/backup/log patterns shipped the dev database.
    it.each([
        'server/database.sqlite',
        'server/database.sqlite-wal',
        'server/database.sqlite-shm',
        'server/database.sqlite-journal',
        'server/database.sqlite.bak.2026-10-24T11-17-39-134Z.0071',
        'server/database.sqlite.backup-20260502-102313',
        'server/rohy.db',
        'data/knowledge.db',
        'data/knowledge.db-wal',
        'server/logs/server.log',
        'server/.env',
        'server/.env.local',
        'OyonR/.env.production',
        'AGENT-NOTE-PROVA-CATALOGUE-LIVE.md',
        'OyonR/AGENT-NOTE-OYON.md',
        'audit/2026-10-26/lane-6-infra.md',
        'sec.md',
        'sec-2026-10-26.md',
        'tests/e2e/.auth/tokens.json',
        '.local-backups/rohy-pre-purge-2026-10-25.bundle',
        'public/uploads/bodymap/x.png',
    ])('excludes %s', (p) => {
        expect(isExcluded(p), `${p} must not reach the build context`).toBe(true);
    });

    it('states the patterns themselves (they are the reviewed contract)', () => {
        const lines = new Set(dockerignore.split('\n').map((l) => l.trim()));
        for (const p of ['**/*.sqlite', '**/*.sqlite-*', '**/*.sqlite.bak.*', '**/*.db', '**/*.log', '**/.env', '**/.env.*', 'audit', 'sec*.md', '**/AGENT-NOTE-*.md', 'tests/e2e/.auth', '.local-backups']) {
            expect(lines.has(p), `.dockerignore must carry "${p}"`).toBe(true);
        }
    });
});

describe('.dockerignore does not strip what the runtime image needs (gate one of two)', () => {
    it.each([
        'CHANGELOG.md',
        'NOTICE.md',
        'LICENSE',
        'licenses/README.md',
        'server/.env.example',
        'server/data/lab_database.json',
        'server/data/lab_cardiac_tests.txt',
        'server/data/radiology_database.json',
        'migrations/0071_oncall_specialists_colleague_voice.sql',
        'package.json',
        'package-lock.json',
    ])('keeps %s', (p) => {
        expect(isExcluded(p), `${p} is read at runtime and must stay in the build context`).toBe(false);
    });

    it('keeps every tracked file under the directories the runtime stage copies', () => {
        let tracked;
        try {
            tracked = execFileSync('git', ['ls-files', 'server', 'migrations', 'scripts', 'src', 'OyonR/src', 'OyonR/standalone', 'licenses'], { cwd: repoRoot, encoding: 'utf8' })
                .split('\n').filter(Boolean);
        } catch {
            tracked = null;
        }
        if (!tracked) return; // CONTRACT: no git here; the explicit list above still runs.
        // server/rohy.db is a tracked EMPTY file nothing reads; it is the one
        // deliberate casualty of `**/*.db`.
        const lost = tracked.filter((f) => f !== 'server/rohy.db' && isExcluded(f) && !/\.(md|png)$/i.test(f) && !/(^|\/)\.DS_Store$/.test(f));
        expect(lost).toEqual([]);
    });
});
