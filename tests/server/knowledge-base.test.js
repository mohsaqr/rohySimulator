// The knowledge base's parsers.
//
// These read files humans wrote for humans, so the thing that breaks is never
// a crash — it is a parser that quietly stops matching and returns fewer rows
// than the source contains. That already happened once during construction:
// migrations/MANIFEST.md spaces its rows out with blank lines, strict markdown
// ends a table at the first blank line, and the parser read 32 of 50 rows
// while reporting perfect success.
//
// So these tests assert two different things: that each parser handles the
// awkward shapes in the real sources, and that the real sources still yield
// roughly what they should. The second kind is what catches format drift.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, moduleOf, modulesOf, modulesOfRefs, buildBasenameIndex, extractRefs, MODULES } from '../../scripts/knowledge/lib.mjs';
import { tables, statusOf, changelog, learnings, migrations, bugs, commits, docs } from '../../scripts/knowledge/ingest.mjs';

describe('module classification', () => {
    it('picks the most specific prefix, not the first plausible one', () => {
        // src/components/ would also match, and 'client:ui' would be wrong.
        expect(moduleOf('src/components/pathology/CaseStudio.jsx')).toBe('plugin:pathology');
        expect(moduleOf('src/components/analytics/tna/activityTime.js')).toBe('client:analytics');
        expect(moduleOf('src/components/Monitor.jsx')).toBe('client:ui');
        // server/shared is shared, not server — it ships to both sides.
        expect(moduleOf('server/shared/time.js')).toBe('shared');
        expect(moduleOf('server/routes/auth-routes.js')).toBe('server:routes');
    });

    it('gives root-level repo files a home of their own', () => {
        // These were 'other' until the module view showed 182 commits sitting
        // there — every version bump touches package.json, so 'unclassified'
        // was the biggest bucket in the repo and told nobody anything.
        expect(moduleOf('package.json')).toBe('repo:meta');
        expect(moduleOf('CHANGELOG.md')).toBe('repo:meta');
        expect(moduleOf('README.md')).toBe('repo:meta');
    });

    it('still sends a genuinely unmatched path to other rather than guessing', () => {
        expect(moduleOf('vitest.config.js')).toBe('other');
        expect(moduleOf('somewhere/unknown/file.js')).toBe('other');
    });

    it('MODULES is ordered specific-first', () => {
        // A prefix that is a prefix of an earlier entry can never be reached.
        MODULES.forEach(([prefix], i) => {
            const shadowed = MODULES.slice(0, i).find(([earlier]) => prefix.startsWith(earlier));
            expect(shadowed, `'${prefix}' is unreachable, shadowed by '${shadowed?.[0]}'`).toBeUndefined();
        });
    });

    it('deduplicates and sorts', () => {
        expect(modulesOf(['server/routes/a.js', 'server/routes/b.js', 'docs/x.md']))
            .toEqual(['docs', 'server:routes']);
        expect(modulesOf([])).toEqual([]);
    });
});

describe('basename resolution', () => {
    const index = buildBasenameIndex([
        'server/routes/orders-routes.js',
        'src/components/TreatmentPanel.jsx',
        'server/routes/index.js',
        'server/routes/index.js',
        'src/components/index.js',
    ]);

    it('resolves a bare basename to the module its full path belongs to', () => {
        // Regression lock: prose cites `orders-routes.js:1745`, never the full
        // path. Classifying the citation directly put 17 of 41 bugs and 99 of
        // 318 learnings in 'other' while the modules they were about read zero.
        expect(modulesOfRefs(['orders-routes.js:1745'], index)).toEqual(['server:routes']);
        expect(modulesOfRefs(['TreatmentPanel.jsx:565'], index)).toEqual(['client:ui']);
    });

    it('breaks an ambiguous basename by frequency, deterministically', () => {
        // 'index.js' exists in two modules; the more common one wins, and the
        // same input must give the same answer on every rebuild.
        expect(modulesOfRefs(['index.js'], index)).toEqual(['server:routes']);
        expect(modulesOfRefs(['index.js'], index)).toEqual(modulesOfRefs(['index.js'], index));
    });

    it('prefers a full path over the index when it has one', () => {
        expect(modulesOfRefs(['src/components/analytics/x.js'], index)).toEqual(['client:analytics']);
    });

    it('falls back to other for a name nothing knows, and works with no index', () => {
        expect(modulesOfRefs(['nonexistent-thing.js'], index)).toEqual(['other']);
        expect(modulesOfRefs(['orders-routes.js'], undefined)).toEqual(['other']);
    });
});

describe('code references in prose', () => {
    it('pulls file:line citations out of a sentence', () => {
        expect(extractRefs('see orders-routes.js:1745-1756 and TreatmentPanel.jsx:565'))
            .toEqual(['TreatmentPanel.jsx:565', 'orders-routes.js:1745-1756']);
    });

    it('does not mistake a version number for a file', () => {
        expect(extractRefs('fixed in 2.9.15, see also v2.9.37')).toEqual([]);
    });

    it('is idempotent on repeats', () => {
        expect(extractRefs('a.js:1 and a.js:1 and a.js:2')).toEqual(['a.js:1', 'a.js:2']);
    });
});

describe('markdown tables', () => {
    it('tolerates blank lines inside a table', () => {
        // Regression lock: strict markdown ends a table here, and doing so read
        // 32 of MANIFEST.md's 50 rows while reporting success.
        const md = ['| a | b |', '|---|---|', '| 1 | x |', '', '| 2 | y |', '', '| 3 | z |'].join('\n');
        expect(tables(md)[0].rows).toEqual([['1', 'x'], ['2', 'y'], ['3', 'z']]);
    });

    it('stops at real prose rather than swallowing the document', () => {
        const md = ['| a | b |', '|---|---|', '| 1 | x |', '', 'Some prose.', '', '| 2 | y |'].join('\n');
        expect(tables(md)[0].rows).toEqual([['1', 'x']]);
    });

    it('keeps an escaped pipe inside a cell', () => {
        const md = ['| a | b |', '|---|---|', String.raw`| x \| y | z |`].join('\n');
        expect(tables(md)[0].rows).toEqual([['x | y', 'z']]);
    });

    it('finds several tables in one document', () => {
        const md = ['| a |', '|---|', '| 1 |', '', 'text', '', '| b |', '|---|', '| 2 |'].join('\n');
        expect(tables(md).map((t) => t.headers)).toEqual([['a'], ['b']]);
    });
});

describe('verdict → status', () => {
    it('maps the vocabularies the three triage reports actually use', () => {
        expect(statusOf('CONFIRMED')).toBe('open');
        expect(statusOf('CONFIRMED (design gap)')).toBe('open');
        expect(statusOf('**INVALID**')).toBe('invalid');
        expect(statusOf('MISUNDERSTANDING')).toBe('invalid');
        expect(statusOf('**CLOSED — not reproducible**')).toBe('invalid');
        expect(statusOf('FIXED in v2.9.15 for the editor')).toBe('fixed');
        expect(statusOf('CANNOT VERIFY as described')).toBe('deferred');
        expect(statusOf('ANSWER — no; language is a case property')).toBe('deferred');
    });

    it('says unknown rather than guessing', () => {
        expect(statusOf('')).toBe('unknown');
        expect(statusOf(null)).toBe('unknown');
        expect(statusOf('¯\\_(ツ)_/¯')).toBe('unknown');
    });

    it('reads FIXED before CONFIRMED when a verdict carries both senses', () => {
        // 'FIXED in v2.9.15 ... import path still CONFIRMED' — the leading
        // verdict wins, and a bug marked fixed must not resurface as open.
        expect(statusOf('FIXED in v2.9.15 for the editor; import path CONFIRMED')).toBe('fixed');
    });
});

// ---------------------------------------------------------------------------
// Against the real sources. These are the drift alarms: they assert shape and
// a floor, never an exact count, so ordinary growth does not fail them.
// ---------------------------------------------------------------------------
describe('the real sources still parse', () => {
    it('reads every migration the manifest lists', () => {
        const listed = readFileSync(join(REPO_ROOT, 'migrations/MANIFEST.md'), 'utf8')
            .split('\n').filter((l) => /^\|\s*\d{4}\s*\|/.test(l)).length;
        const parsed = migrations();
        expect(parsed.length).toBe(listed);
        expect(parsed.every((m) => /^\d{4}$/.test(m.id))).toBe(true);
        expect(parsed.every((m) => m.file.endsWith('.sql'))).toBe(true);
        expect(new Set(parsed.map((m) => m.type)).size).toBeGreaterThan(0);
    });

    it('reads every changelog release, each with changes attached', () => {
        const headings = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
            .split('\n').filter((l) => /^##\s+\[?\d+\.\d+\.\d+/.test(l)).length;
        const { releases, changes } = changelog();
        expect(releases.length).toBe(headings);
        expect(changes.length).toBeGreaterThan(releases.length);
        // Every change belongs to a release that exists.
        const known = new Set(releases.map((r) => r.version));
        expect(changes.filter((c) => !known.has(c.version))).toEqual([]);
        // The newest release is the current package version.
        const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
        expect(releases.map((r) => r.version)).toContain(pkg.version);
    });

    it('reads learnings at bullet granularity, each dated', () => {
        if (!existsSync(join(REPO_ROOT, 'LEARNINGS.md'))) return;   // gitignored; absent on a fresh clone
        const { learnings: rows, skipped } = learnings();
        expect(rows.length).toBeGreaterThan(50);
        expect(skipped).toBe(0);
        expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.recorded_on))).toBe(true);
        expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });

    it('reads every numbered row of every triage report', () => {
        const { bugs: rows, skipped } = bugs();
        expect(skipped).toBe(0);
        expect(rows.length).toBeGreaterThan(20);
        expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
        // Every status is one the schema's CHECK constraint accepts.
        const allowed = new Set(['open', 'fixed', 'invalid', 'deferred', 'unknown']);
        expect(rows.filter((r) => !allowed.has(r.status))).toEqual([]);
    });

    // Two full `git log` walks over 500+ commits. ~1.5s alone, but this file
    // runs alongside 300 others competing for the same cores, where it has
    // been measured at 7.3s — past the 5s default. The work is genuinely this
    // size; the timeout is the honest fix, not a smaller assertion.
    it('reads the whole commit history with contract-shaped timestamps', () => {
        const rows = commits();
        expect(rows.length).toBeGreaterThan(400);
        // RPS-1 §17: every instant this repo records is UTC ISO-8601 with a Z.
        expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.authored_at))).toBe(true);
        expect(new Set(rows.map((r) => r.sha)).size).toBe(rows.length);
        // The convention this repo commits by is actually being parsed.
        expect(rows.filter((r) => r.version).length).toBeGreaterThan(50);
        expect(rows.filter((r) => r.scope).length).toBeGreaterThan(50);
    }, 60_000);

    it('indexes documents without swallowing the built site', () => {
        const rows = docs();
        expect(rows.length).toBeGreaterThan(20);
        // docs/.vitepress/dist is a BUILD of these same files; including it
        // would double every document and drown search in rendered HTML.
        expect(rows.filter((d) => d.path.includes('.vitepress'))).toEqual([]);
        expect(rows.every((d) => d.path.endsWith('.md'))).toBe(true);
    }, 30_000);
});
