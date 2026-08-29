#!/usr/bin/env node
// Query the knowledge base.
//
//   npm run kb -- search "tenant scoping"     ranked full-text across everything
//   npm run kb -- file server/routes/orders-routes.js
//   npm run kb -- bugs --status open
//   npm run kb -- learn --since 2026-08
//   npm run kb -- commits --scope auth
//   npm run kb -- release 2.9.93
//   npm run kb -- stats
//
// Read-only by construction: the database is a derived artifact, so the only
// way to change what it says is to change the source and rebuild.

import { existsSync } from 'node:fs';
import { DB_PATH, open, MODULES } from './lib.mjs';

const KINDS = ['commit', 'release', 'change', 'bug', 'learning', 'insight', 'migration', 'doc'];

// --- tiny terminal helpers -------------------------------------------------
const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);
const cyan = (s) => c(36, s);
const yellow = (s) => c(33, s);
const green = (s) => c(32, s);
const red = (s) => c(31, s);

const STATUS_COLOUR = { open: red, fixed: green, invalid: dim, deferred: yellow, unknown: dim };

/** Collapse whitespace and clip, so a multi-paragraph body fits one row. */
function oneLine(s, n = 100) {
    const t = String(s ?? '').replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Print rows as an aligned table. Columns are [header, accessor] pairs. */
function table(rows, columns) {
    if (!rows.length) { console.log(dim('  (nothing)')); return; }
    const cells = rows.map((r) => columns.map(([, get]) => String(get(r) ?? '')));
    const widths = columns.map(([h], i) =>
        Math.max(h.length, ...cells.map((row) => stripAnsi(row[i]).length)));
    console.log('  ' + columns.map(([h], i) => dim(h.padEnd(widths[i]))).join('  '));
    for (const row of cells) {
        console.log('  ' + row.map((v, i) => v + ' '.repeat(widths[i] - stripAnsi(v).length)).join('  '));
    }
}
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** `--flag value` and `--flag` from argv. */
function flags(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        out[key] = (next && !next.startsWith('--')) ? (i++, next) : true;
    }
    return out;
}
const positional = (argv) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue; }
        out.push(argv[i]);
    }
    return out;
};

// --- commands --------------------------------------------------------------

async function cmdSearch(kb, argv) {
    const f = flags(argv);
    const query = positional(argv).join(' ');
    if (!query) return fail('search needs a query: npm run kb -- search "audit chain"');
    const limit = Number(f.limit ?? 20);
    const kindFilter = f.kind ? ` AND entity_kind = '${String(f.kind).replace(/'/g, '')}'` : '';
    // bm25() weights the columns: a hit in the title outranks one in the body.
    const rows = await kb.all(
        `SELECT entity_kind, entity_id, title,
                snippet(knowledge_fts, 3, '«', '»', '…', 14) AS snip,
                bm25(knowledge_fts, 0.0, 0.0, 4.0, 1.0) AS score
           FROM knowledge_fts
          WHERE knowledge_fts MATCH ?${kindFilter}
          ORDER BY score
          LIMIT ?`, [query, limit]);
    if (!rows.length) {
        console.log(dim(`  no match for ${JSON.stringify(query)}`));
        console.log(dim('  FTS5 syntax: "exact phrase", term*, a OR b, a NOT b'));
        return;
    }
    const total = await kb.get('SELECT COUNT(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?', [query]);
    console.log(bold(`\n  ${total.n} match${total.n === 1 ? '' : 'es'} for ${JSON.stringify(query)}` +
        (total.n > rows.length ? dim(`  (showing ${rows.length})`) : '')) + '\n');
    for (const r of rows) {
        console.log(`  ${cyan(r.entity_kind.padEnd(9))} ${bold(oneLine(r.title, 76))}`);
        console.log(`  ${' '.repeat(9)} ${dim(oneLine(r.snip, 92))}`);
        console.log(`  ${' '.repeat(9)} ${dim(String(r.entity_id).slice(0, 60))}\n`);
    }
}

async function cmdFile(kb, argv) {
    const path = positional(argv)[0];
    if (!path) return fail('file needs a path: npm run kb -- file server/routes/auth-routes.js');
    const base = path.split('/').pop();

    const commits = await kb.all(
        `SELECT short_sha, authored_at, version, subject FROM commit_log
          WHERE files LIKE '%' || ? || '%' ORDER BY authored_at DESC LIMIT 15`, [path]);
    const total = await kb.get(
        `SELECT COUNT(*) AS n FROM commit_log WHERE files LIKE '%' || ? || '%'`, [path]);
    // Prose cites a file by basename far more often than by full path, so the
    // bug and learning lookups match on that — a citation of
    // `orders-routes.js:1745` should find the file it names.
    const bugs = await kb.all(
        `SELECT id, status, verdict, title FROM bug WHERE refs LIKE '%' || ? || '%'`, [base]);
    const learns = await kb.all(
        `SELECT id, recorded_on, COALESCE(headline, substr(body,1,90)) AS headline
           FROM learning WHERE refs LIKE '%' || ? || '%' ORDER BY recorded_on DESC`, [base]);

    console.log(bold(`\n  ${path}`));
    console.log(dim(`  ${total.n} commits · ${bugs.length} bugs · ${learns.length} learnings\n`));

    if (commits.length) {
        console.log(bold(`  Commits`) + dim(total.n > commits.length ? ` (latest ${commits.length} of ${total.n})` : ''));
        table(commits, [
            ['sha', (r) => cyan(r.short_sha)],
            ['date', (r) => r.authored_at.slice(0, 10)],
            ['ver', (r) => r.version ?? ''],
            ['subject', (r) => oneLine(r.subject, 82)],
        ]);
        console.log('');
    }
    if (bugs.length) {
        console.log(bold('  Bugs citing it'));
        table(bugs, [
            ['status', (r) => (STATUS_COLOUR[r.status] ?? dim)(r.status)],
            ['verdict', (r) => oneLine(r.verdict, 26)],
            ['title', (r) => oneLine(r.title, 76)],
        ]);
        console.log('');
    }
    if (learns.length) {
        console.log(bold('  Learnings citing it'));
        table(learns, [
            ['date', (r) => r.recorded_on ?? ''],
            ['learning', (r) => oneLine(r.headline, 100)],
        ]);
        console.log('');
    }
    if (!commits.length && !bugs.length && !learns.length) {
        console.log(dim('  nothing recorded — check the path is repo-relative\n'));
    }
}

async function cmdBugs(kb, argv) {
    const f = flags(argv);
    const where = [];
    const params = [];
    if (f.status) { where.push('status = ?'); params.push(f.status); }
    if (f.report) { where.push('report LIKE ?'); params.push(`%${f.report}%`); }
    if (f.module) { where.push('modules LIKE ?'); params.push(`%${f.module}%`); }
    const rows = await kb.all(
        `SELECT id, number, report, status, verdict, title FROM bug
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY report, CAST(number AS INTEGER)`, params);
    const byStatus = await kb.all('SELECT status, COUNT(*) AS n FROM bug GROUP BY status ORDER BY n DESC');
    console.log(bold(`\n  ${rows.length} bug${rows.length === 1 ? '' : 's'}`) +
        dim('   all: ' + byStatus.map((s) => `${s.status} ${s.n}`).join(' · ')) + '\n');
    table(rows, [
        ['report', (r) => dim(r.report.replace(/^bug-triage-|\.md$/g, '').replace(/pilot-feedback-triage-/, 'pilot '))],
        ['#', (r) => r.number],
        ['status', (r) => (STATUS_COLOUR[r.status] ?? dim)(r.status)],
        ['verdict', (r) => oneLine(r.verdict, 30)],
        ['title', (r) => oneLine(r.title, 68)],
    ]);
    console.log('');
}

async function cmdLearn(kb, argv) {
    const f = flags(argv);
    const where = [];
    const params = [];
    if (f.since) { where.push('recorded_on >= ?'); params.push(String(f.since)); }
    if (f.module) { where.push('modules LIKE ?'); params.push(`%${f.module}%`); }
    const rows = await kb.all(
        `SELECT id, recorded_on, topic, COALESCE(headline, substr(body,1,110)) AS headline
           FROM learning ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY recorded_on DESC, id LIMIT ?`, [...params, Number(f.limit ?? 30)]);
    console.log(bold(`\n  ${rows.length} learning${rows.length === 1 ? '' : 's'}\n`));
    table(rows, [
        ['date', (r) => r.recorded_on ?? ''],
        ['id', (r) => dim(r.id)],
        ['learning', (r) => oneLine(r.headline, 104)],
    ]);
    console.log('');
}

async function cmdCommits(kb, argv) {
    const f = flags(argv);
    const where = [];
    const params = [];
    if (f.version) { where.push('version = ?'); params.push(f.version); }
    if (f.scope) { where.push('scope = ?'); params.push(f.scope); }
    if (f.type) { where.push('type = ?'); params.push(f.type); }
    if (f.since) { where.push('authored_at >= ?'); params.push(String(f.since)); }
    if (f.module) { where.push('modules LIKE ?'); params.push(`%${f.module}%`); }
    const rows = await kb.all(
        `SELECT short_sha, authored_at, version, type, scope, subject, files_changed, insertions, deletions
           FROM commit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY authored_at DESC LIMIT ?`, [...params, Number(f.limit ?? 30)]);
    console.log(bold(`\n  ${rows.length} commit${rows.length === 1 ? '' : 's'}\n`));
    table(rows, [
        ['sha', (r) => cyan(r.short_sha)],
        ['date', (r) => r.authored_at.slice(0, 10)],
        ['ver', (r) => r.version ?? ''],
        ['files', (r) => String(r.files_changed)],
        ['±', (r) => `${green('+' + r.insertions)}/${red('-' + r.deletions)}`],
        ['subject', (r) => oneLine(r.subject, 72)],
    ]);
    console.log('');
}

async function cmdRelease(kb, argv) {
    const version = positional(argv)[0];
    if (!version) {
        const rows = await kb.all(`SELECT r.version, r.released_on,
                (SELECT COUNT(*) FROM change WHERE version = r.version) AS changes,
                (SELECT COUNT(*) FROM commit_log WHERE version = r.version) AS commits
            FROM release r ORDER BY r.released_on DESC, r.version DESC LIMIT ?`,
        [Number(flags(argv).limit ?? 25)]);
        console.log(bold('\n  Releases\n'));
        table(rows, [
            ['version', (r) => bold(r.version)],
            ['date', (r) => r.released_on ?? dim('—')],
            ['changes', (r) => String(r.changes)],
            ['commits', (r) => String(r.commits)],
        ]);
        console.log('');
        return;
    }
    const rel = await kb.get('SELECT * FROM release WHERE version = ?', [version]);
    if (!rel) return fail(`no release ${version}`);
    const changes = await kb.all('SELECT kind, headline FROM change WHERE version = ? ORDER BY id', [version]);
    const commits = await kb.all(
        'SELECT short_sha, subject FROM commit_log WHERE version = ? ORDER BY authored_at', [version]);
    console.log(bold(`\n  v${rel.version}`) + dim(`   ${rel.released_on ?? 'undated'}\n`));
    let kind = null;
    for (const ch of changes) {
        if (ch.kind !== kind) { kind = ch.kind; console.log(`  ${yellow(kind)}`); }
        console.log(`    · ${oneLine(ch.headline, 104)}`);
    }
    if (commits.length) {
        console.log(`\n  ${yellow('Commits')}`);
        for (const c2 of commits) console.log(`    ${cyan(c2.short_sha)}  ${oneLine(c2.subject, 92)}`);
    }
    console.log('');
}

async function cmdModules(kb) {
    const rows = await kb.all(`SELECT m.id, m.kind, m.label,
            (SELECT COUNT(*) FROM commit_log c WHERE c.modules LIKE '%"' || m.id || '"%') AS commits,
            (SELECT COUNT(*) FROM bug b      WHERE b.modules LIKE '%"' || m.id || '"%') AS bugs,
            (SELECT COUNT(*) FROM learning l WHERE l.modules LIKE '%"' || m.id || '"%') AS learnings
        FROM module m ORDER BY commits DESC`);
    console.log(bold('\n  Modules\n'));
    table(rows, [
        ['module', (r) => bold(r.id)],
        ['kind', (r) => dim(r.kind)],
        ['commits', (r) => String(r.commits)],
        ['bugs', (r) => String(r.bugs)],
        ['learnings', (r) => String(r.learnings)],
        ['label', (r) => dim(r.label)],
    ]);
    console.log(dim('\n  A large "other" means this map needs a row — see MODULES in scripts/knowledge/lib.mjs\n'));
}

async function cmdStats(kb) {
    const meta = Object.fromEntries((await kb.all('SELECT key, value FROM kb_meta')).map((r) => [r.key, r.value]));
    const counts = {};
    for (const [label, sql] of Object.entries({
        commits: 'SELECT COUNT(*) AS n FROM commit_log',
        releases: 'SELECT COUNT(*) AS n FROM release',
        changes: 'SELECT COUNT(*) AS n FROM change',
        bugs: 'SELECT COUNT(*) AS n FROM bug',
        learnings: 'SELECT COUNT(*) AS n FROM learning',
        insights: 'SELECT COUNT(*) AS n FROM insight',
        migrations: 'SELECT COUNT(*) AS n FROM migration',
        docs: 'SELECT COUNT(*) AS n FROM doc',
        searchable: 'SELECT COUNT(*) AS n FROM knowledge_fts',
    })) counts[label] = (await kb.get(sql)).n;

    const span = await kb.get('SELECT MIN(authored_at) AS a, MAX(authored_at) AS b FROM commit_log');
    const top = await kb.all(`SELECT scope, COUNT(*) AS n FROM commit_log
        WHERE scope IS NOT NULL GROUP BY scope ORDER BY n DESC LIMIT 8`);
    const busiest = await kb.all(`SELECT substr(authored_at,1,7) AS month, COUNT(*) AS n
        FROM commit_log GROUP BY month ORDER BY month`);

    console.log(bold('\n  rohy knowledge base\n'));
    console.log(`  built      ${meta.built_at}`);
    console.log(`  head       ${meta.head_sha?.slice(0, 8)}  v${meta.head_version}`);
    console.log(`  history    ${span.a?.slice(0, 10)} → ${span.b?.slice(0, 10)}\n`);
    const w = Math.max(...Object.keys(counts).map((k) => k.length));
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(w)}  ${String(v).padStart(6)}`);

    console.log(bold('\n  Commits by month'));
    const max = Math.max(...busiest.map((m) => m.n));
    for (const m of busiest) {
        console.log(`  ${m.month}  ${cyan('█'.repeat(Math.max(1, Math.round((m.n / max) * 44))))} ${m.n}`);
    }
    console.log(bold('\n  Busiest scopes'));
    for (const s of top) console.log(`  ${String(s.scope).padEnd(16)} ${s.n}`);
    console.log('');
}

async function cmdMigrations(kb, argv) {
    const f = flags(argv);
    const rows = await kb.all(
        `SELECT id, file, type, substr(notes,1,110) AS notes FROM migration
         ${f.type ? 'WHERE type = ?' : ''} ORDER BY id`, f.type ? [f.type] : []);
    console.log(bold(`\n  ${rows.length} migrations\n`));
    table(rows, [
        ['id', (r) => bold(r.id)],
        ['type', (r) => (r.type === 'destructive' ? red : green)(r.type)],
        ['file', (r) => oneLine(r.file, 42)],
        ['notes', (r) => dim(oneLine(r.notes, 70))],
    ]);
    console.log('');
}

async function cmdShow(kb, argv) {
    const [kind, ...rest] = positional(argv);
    const id = rest.join(' ');
    if (!kind || !id) return fail('show needs a kind and an id: npm run kb -- show learning L-0007');
    const TABLES = {
        learning: ['learning', 'id'], bug: ['bug', 'id'], insight: ['insight', 'id'],
        migration: ['migration', 'id'], release: ['release', 'version'],
        commit: ['commit_log', 'sha'], doc: ['doc', 'path'], change: ['change', 'id'],
    };
    const entry = TABLES[kind];
    if (!entry) return fail(`unknown kind '${kind}' — one of ${Object.keys(TABLES).join(', ')}`);
    const [tbl, key] = entry;
    const row = await kb.get(`SELECT * FROM ${tbl} WHERE ${key} = ? OR ${key} LIKE ? LIMIT 1`, [id, `${id}%`]);
    if (!row) return fail(`no ${kind} '${id}'`);
    console.log('');
    for (const [k, v] of Object.entries(row)) {
        if (v == null || v === '' || v === '[]') continue;
        const text = String(v);
        if (text.includes('\n') || text.length > 90) {
            console.log(`  ${yellow(k)}`);
            for (const line of text.split('\n')) console.log(`    ${line}`);
        } else console.log(`  ${yellow(k.padEnd(16))} ${text}`);
    }
    console.log('');
}

/**
 * Open bugs whose cited files were touched after the report was written.
 *
 * A triage report is a snapshot: it records what was true on the day it was
 * written and is almost never edited when the fix ships. So `bugs --status
 * open` over-reports, and the only way to know was to read a report and a
 * changelog side by side.
 *
 * This does not claim a bug is fixed — it cannot, and pretending otherwise
 * would replace a stale record with a confident wrong one. It says: here is a
 * bug still marked open, and here is the later work that touched exactly the
 * files it blamed. A human decides.
 */
async function cmdStale(kb, argv) {
    const f = flags(argv);
    const open = await kb.all(
        `SELECT id, number, report, title, verdict, refs, reported_on
           FROM bug WHERE status = 'open' AND reported_on IS NOT NULL ORDER BY report, CAST(number AS INTEGER)`);

    const suspects = [];
    for (const bug of open) {
        const files = [...new Set(JSON.parse(bug.refs).map((r) => r.split(':')[0]))].filter(Boolean);
        if (!files.length) continue;
        const seen = new Map();
        for (const file of files) {
            const rows = await kb.all(
                `SELECT short_sha, authored_at, version, subject FROM commit_log
                  WHERE files LIKE '%' || ? || '%' AND date(authored_at) > date(?)
                  ORDER BY authored_at DESC LIMIT 5`, [file, bug.reported_on]);
            for (const r of rows) if (!seen.has(r.short_sha)) seen.set(r.short_sha, r);
        }
        if (seen.size) suspects.push({ bug, commits: [...seen.values()].slice(0, Number(f.commits ?? 3)) });
    }

    console.log(bold(`\n  ${suspects.length} of ${open.length} open bugs have later work on the files they blamed\n`));
    console.log(dim('  This is a prompt to re-triage, not a claim that anything is fixed.\n'));
    for (const { bug, commits } of suspects) {
        console.log(`  ${red('open')}  ${dim(bug.report.replace(/^bug-triage-|\.md$/g, ''))} #${bug.number}  ${bold(oneLine(bug.title, 78))}`);
        console.log(`        ${dim('reported ' + bug.reported_on + ' · ' + oneLine(bug.verdict, 40))}`);
        for (const cm of commits) {
            console.log(`        ${cyan(cm.short_sha)} ${cm.authored_at.slice(0, 10)} ${cm.version ? dim('v' + cm.version + ' ') : ''}${oneLine(cm.subject, 74)}`);
        }
        console.log('');
    }
}

async function cmdSql(kb, argv) {
    const sql = positional(argv).join(' ');
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return fail('sql accepts SELECT/WITH only — the base is derived, rebuild to change it');
    const rows = await kb.all(sql);
    if (!rows.length) { console.log(dim('  (no rows)')); return; }
    console.log('');
    table(rows, Object.keys(rows[0]).map((k) => [k, (r) => oneLine(r[k], 60)]));
    console.log('');
}

function fail(msg) { console.error(`  ${red('error')}  ${msg}`); process.exitCode = 1; }

const USAGE = `
  ${bold('rohy knowledge base')}   ${dim('one queryable record of what this repo knows about itself')}

  ${yellow('npm run kb --')} ${bold('search')} <query>        ranked full-text over everything
                              ${dim('--kind ' + KINDS.join('|'))}
  ${yellow('npm run kb --')} ${bold('file')} <path>           every commit, bug and learning about one file
  ${yellow('npm run kb --')} ${bold('bugs')}                  ${dim('--status open|fixed|invalid|deferred  --report x  --module x')}
  ${yellow('npm run kb --')} ${bold('learn')}                 ${dim('--since 2026-08  --module server:routes')}
  ${yellow('npm run kb --')} ${bold('commits')}               ${dim('--scope auth  --type fix  --version x  --since x  --module x')}
  ${yellow('npm run kb --')} ${bold('release')} [version]     the release list, or one release in full
  ${yellow('npm run kb --')} ${bold('migrations')}            ${dim('--type additive|destructive')}
  ${yellow('npm run kb --')} ${bold('stale')}                 open bugs with later work on the files they blamed
  ${yellow('npm run kb --')} ${bold('modules')}               where the work has gone
  ${yellow('npm run kb --')} ${bold('show')} <kind> <id>      one record in full
  ${yellow('npm run kb --')} ${bold('stats')}                 overview and shape of the history
  ${yellow('npm run kb --')} ${bold('sql')} "SELECT …"        read-only escape hatch

  ${dim('Rebuild after any change to git history or the source markdown:')}  ${yellow('npm run kb:build')}
`;

async function main() {
    const [cmd, ...argv] = process.argv.slice(2);
    if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); return; }
    if (!existsSync(DB_PATH)) {
        console.error(`  ${red('error')}  no knowledge base yet — run ${yellow('npm run kb:build')}`);
        process.exitCode = 1;
        return;
    }
    const kb = open();
    const COMMANDS = {
        search: cmdSearch, file: cmdFile, bugs: cmdBugs, learn: cmdLearn, learnings: cmdLearn,
        commits: cmdCommits, release: cmdRelease, releases: cmdRelease, modules: cmdModules,
        migrations: cmdMigrations, show: cmdShow, stats: cmdStats, sql: cmdSql, stale: cmdStale,
    };
    const fn = COMMANDS[cmd];
    try {
        if (!fn) fail(`unknown command '${cmd}'\n${USAGE}`);
        else await fn(kb, argv);
    } finally { await kb.close(); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
void MODULES;
