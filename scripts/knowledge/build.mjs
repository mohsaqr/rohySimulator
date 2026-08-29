#!/usr/bin/env node
// Rebuild the knowledge base from scratch.
//
//   npm run kb:build
//
// Drops data/knowledge.db and re-derives every row from git and the markdown
// already in the repo. Deterministic: the same tree produces the same
// database, which is what makes it safe to delete and cheap to distrust.
//
// It prints what each source contributed, and it FAILS if a source that should
// have produced rows produced none. A parser that silently matches nothing is
// the way a knowledge base rots without anyone noticing — the counts below are
// the alarm.

import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { REPO_ROOT, DB_PATH, SCHEMA_PATH, MODULES, open, buildBasenameIndex } from './lib.mjs';
import * as ingest from './ingest.mjs';

/** Sources that must never come back empty; the number is a floor, not a target. */
const FLOORS = { commits: 100, releases: 20, changes: 50, bugs: 10, learnings: 20, migrations: 10, docs: 20 };

/** The assistant's per-project memory directory, when this machine has one. */
function memoryDir() {
    const slug = REPO_ROOT.replace(/\//g, '-');
    const guess = join(homedir(), '.claude-claudef', 'projects', slug, 'memory');
    return existsSync(guess) ? guess : null;
}

async function main() {
    const t0 = Date.now();
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
    mkdirSync(dirname(DB_PATH), { recursive: true });

    const kb = open();
    await kb.exec(readFileSync(SCHEMA_PATH, 'utf8'));

    const counts = {};
    const insert = async (sql, rows, key) => {
        for (const r of rows) await kb.run(sql, Object.values(r));
        counts[key] = (counts[key] ?? 0) + rows.length;
    };

    // Modules first: everything else references them by id.
    // Several prefixes may name ONE module (repo:meta is reached from
    // package.json, CHANGELOG.md, README.md and Dockerfile), so the table is
    // keyed by module and records the first prefix that reaches it.
    const byId = new Map();
    for (const [path_prefix, id, kind, label] of MODULES) {
        if (!byId.has(id)) byId.set(id, { id, label, kind, path_prefix });
    }
    await insert('INSERT INTO module (id, label, kind, path_prefix) VALUES (?, ?, ?, ?)',
        [...byId.values()], 'modules');
    await kb.run(
        "INSERT INTO module (id, label, kind, path_prefix) VALUES ('other', 'Unclassified', 'other', '')"
    );

    const commits = ingest.commits();
    await insert(`INSERT INTO commit_log
        (sha, short_sha, parent_sha, subject, body, author_name, author_email, authored_at,
         version, type, scope, files_changed, insertions, deletions, files, modules)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, commits, 'commits');

    const { releases, changes } = ingest.changelog();
    await insert(
        'INSERT INTO release (version, released_on, body, source_line, source_path) VALUES (?,?,?,?,?)',
        releases.map(({ version, released_on, body, source_line, source_path }) =>
            ({ version, released_on, body, source_line, source_path })),
        'releases'
    );
    // The commit whose subject carries this version — the link between "what
    // the notes say shipped" and "what actually landed".
    await kb.run(`UPDATE release SET commit_sha = (
        SELECT sha FROM commit_log c WHERE c.version = release.version ORDER BY c.authored_at LIMIT 1)`);

    // A changelog can name a version the tree has no commit for (an entry
    // written before its release commit). Keep those rows — the note is real
    // even when the commit is not yet — but only after the release exists.
    const known = new Set(releases.map((r) => r.version));
    const keep = changes.filter((c) => known.has(c.version));
    await insert(
        'INSERT INTO change (version, kind, headline, body, source_path, source_line) VALUES (?,?,?,?,?,?)',
        keep, 'changes'
    );

    // Prose cites files by basename, so citations are resolved through an
    // index learned from every path git has ever seen.
    const basenames = buildBasenameIndex(commits.flatMap((c) => JSON.parse(c.files)));
    const { bugs, skipped: bugSkips } = ingest.bugs('reports', basenames);
    await insert(`INSERT INTO bug
        (id, report, number, report_version, title, verdict, status, root_cause, refs, modules,
         fixed_in_version, reported_on, source_path, source_line)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, bugs, 'bugs');
    // A report named for a version rather than a date borrows that release's
    // date. Without this, only the one date-named report had a `reported_on`
    // and `kb stale` could compare almost nothing against later work.
    await kb.run(`UPDATE bug SET reported_on = (
        SELECT released_on FROM release WHERE release.version = bug.report_version)
        WHERE reported_on IS NULL AND report_version IS NOT NULL`);

    const { learnings, skipped: learnSkips } = ingest.learnings('LEARNINGS.md', basenames);
    await insert(`INSERT INTO learning
        (id, recorded_on, topic, headline, body, refs, modules, source_path, source_line)
        VALUES (?,?,?,?,?,?,?,?,?)`, learnings, 'learnings');

    await insert(
        'INSERT INTO migration (id, file, type, notes, source_path) VALUES (?,?,?,?,?)',
        ingest.migrations(), 'migrations'
    );

    await insert(`INSERT INTO insight (id, kind, title, body, recorded_on, modules, source_path)
        VALUES (?,?,?,?,?,?,?)`, ingest.insights(memoryDir(), basenames), 'insights');

    await insert('INSERT INTO doc (path, title, kind, headings, words, body) VALUES (?,?,?,?,?,?)',
        ingest.docs(), 'docs');

    const now = new Date().toISOString();
    for (const [key, value] of Object.entries({
        built_at: now,
        head_sha: commits[0]?.sha ?? '',
        head_version: JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version,
        schema_version: '1',
        bug_rows_skipped: String(bugSkips),
        learning_rows_skipped: String(learnSkips),
    })) {
        await kb.run('INSERT INTO kb_meta (key, value) VALUES (?, ?)', [key, value]);
    }

    const fts = await kb.get('SELECT COUNT(*) AS n FROM knowledge_fts');
    await kb.close();

    const width = Math.max(...Object.keys(counts).map((k) => k.length));
    for (const [k, v] of Object.entries(counts)) {
        console.log(`  ${k.padEnd(width)}  ${String(v).padStart(6)}`);
    }
    console.log(`  ${'searchable'.padEnd(width)}  ${String(fts.n).padStart(6)}`);
    console.log(`\n  ${DB_PATH.replace(REPO_ROOT + '/', '')} rebuilt in ${Date.now() - t0} ms`);

    const starved = Object.entries(FLOORS).filter(([k, floor]) => (counts[k] ?? 0) < floor);
    if (starved.length) {
        console.error('\nERROR: a source produced far fewer rows than expected — a parser has probably');
        console.error('stopped matching. Check the source file\'s format before trusting this build:');
        for (const [k, floor] of starved) console.error(`  ${k}: ${counts[k] ?? 0} (expected at least ${floor})`);
        process.exit(1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
