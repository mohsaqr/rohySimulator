// The parsers. One function per source, each returning plain rows.
//
// Every one of these reads a file that a human wrote for other humans, so the
// parsers are deliberately forgiving about shape and strict about provenance:
// a row that cannot be placed is skipped and counted, never guessed at. The
// build prints those counts, because a parser that silently matches nothing is
// the failure mode that makes a knowledge base quietly useless.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT, modulesOf, modulesOfRefs, extractRefs } from './lib.mjs';

const read = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');
const RS = '\x1e';
const US = '\x1f';

/** Trailing `(v2.9.93)` in a commit subject or heading. */
const VERSION_RE = /\(v(\d+\.\d+\.\d+)\)\s*$/;
/** `type(scope): rest` — this repo's commit convention. */
const CONVENTIONAL_RE = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*/;

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

/**
 * Every commit reachable from HEAD, with its file list and line counts.
 *
 * Two `git log` passes rather than one: `--numstat` and a custom `--format`
 * interleave in a way that has to be re-derived every time it is read, and the
 * second pass over 536 commits costs milliseconds.
 *
 * @returns {object[]}
 */
export function commits() {
    const meta = execFileSync('git', ['log',
        `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%aI${US}%s${US}%b`,
    ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

    const stat = execFileSync('git', ['log', '--numstat', `--format=${RS}%H`],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

    const files = new Map();
    for (const block of stat.split(RS)) {
        if (!block.trim()) continue;
        const [sha, ...lines] = block.split('\n');
        const paths = [];
        let ins = 0;
        let del = 0;
        for (const line of lines) {
            const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
            if (!m) continue;
            // '-' is git's marker for a binary file: countable as a change,
            // not as lines.
            if (m[1] !== '-') ins += Number(m[1]);
            if (m[2] !== '-') del += Number(m[2]);
            // A rename arrives as `old => new` (or with a brace form); the new
            // path is what a reader will look for.
            paths.push(m[3].includes(' => ') ? m[3].split(' => ').pop().replace(/[{}]/g, '') : m[3]);
        }
        files.set(sha.trim(), { paths, ins, del });
    }

    const out = [];
    for (const block of meta.split(RS)) {
        if (!block.trim()) continue;
        const [sha, parents, name, email, iso, subject, body = ''] = block.split(US);
        const f = files.get(sha) ?? { paths: [], ins: 0, del: 0 };
        const conv = CONVENTIONAL_RE.exec(subject);
        out.push({
            sha,
            short_sha: sha.slice(0, 8),
            parent_sha: (parents || '').trim().split(' ')[0] || null,
            subject,
            body: body.trim(),
            author_name: name,
            author_email: email,
            // %aI carries the author's local offset; the contract is UTC.
            authored_at: new Date(iso).toISOString(),
            version: VERSION_RE.exec(subject)?.[1] ?? null,
            type: conv?.[1] ?? null,
            scope: conv?.[2] ?? null,
            files_changed: f.paths.length,
            insertions: f.ins,
            deletions: f.del,
            files: JSON.stringify(f.paths),
            modules: JSON.stringify(modulesOf(f.paths)),
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// CHANGELOG — releases and the individual changes inside them
// ---------------------------------------------------------------------------

/**
 * `## [2.9.92] — 2026-08-29` sections, and the bullets beneath their
 * `### Fixed` / `### Added` headings.
 *
 * A bullet may run over many lines and contain nested sub-bullets; a new
 * bullet starts only at a top-level `- ` at the section's own indent, so a
 * multi-paragraph entry survives intact.
 *
 * @returns {{releases: object[], changes: object[], skipped: number}}
 */
export function changelog(path = 'CHANGELOG.md') {
    const lines = read(path).split('\n');
    const releases = [];
    const changes = [];
    let skipped = 0;

    let cur = null;
    let kind = null;
    let buf = null;
    let bufLine = 0;

    const flushBullet = () => {
        if (!cur || !buf) { buf = null; return; }
        const body = buf.join('\n').trim();
        buf = null;
        if (!body) return;
        // `- **The headline.** the rest` is this changelog's house style.
        const m = /^\*\*(.+?)\*\*/s.exec(body);
        changes.push({
            version: cur.version,
            kind: kind ?? 'Notes',
            headline: (m?.[1] ?? body.split('\n')[0]).replace(/\s+/g, ' ').slice(0, 300),
            body,
            source_path: path,
            source_line: bufLine,
        });
    };

    lines.forEach((line, i) => {
        const rel = /^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+)\]?\s*[—–-]?\s*(\d{4}-\d{2}-\d{2})?/.exec(line);
        if (rel) {
            flushBullet();
            cur = { version: rel[1], released_on: rel[2] ?? null, body: [], source_line: i + 1 };
            releases.push(cur);
            kind = null;
            return;
        }
        if (!cur) return;
        cur.body.push(line);

        const sec = /^###\s+(.+?)\s*$/.exec(line);
        if (sec) { flushBullet(); kind = sec[1]; return; }

        const bullet = /^-\s+(.*)$/.exec(line);
        if (bullet) { flushBullet(); buf = [bullet[1]]; bufLine = i + 1; return; }
        if (buf) {
            // Continuation: an indented line, or a blank line inside a bullet.
            if (/^\s+\S/.test(line) || line.trim() === '') buf.push(line.trim());
            else { flushBullet(); }
        }
    });
    flushBullet();

    for (const r of releases) {
        r.body = r.body.join('\n').trim();
        r.source_path = path;
        if (!r.released_on) skipped++;
    }
    return { releases, changes, skipped };
}

// ---------------------------------------------------------------------------
// Markdown tables — the shape every triage report and the migration manifest
// share, read by HEADER NAME rather than by column position.
// ---------------------------------------------------------------------------

/**
 * Parse the pipe tables in a markdown document.
 *
 * Column position is not stable across this repo's reports — one triage has
 * `# | title | Verdict | Root cause`, another inserts `Their rating` in the
 * middle, a third uses `Item` and `Effort`. Reading by header name is what
 * lets one parser handle all three and the next one nobody has written yet.
 *
 * @param {string} md
 * @returns {{headers: string[], rows: string[][], line: number}[]}
 */
export function tables(md) {
    const lines = md.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        if (/^\|/.test(lines[i]) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
            const headers = splitRow(lines[i]);
            const rows = [];
            let j = i + 2;
            // Blank lines are tolerated INSIDE a table. Strict markdown ends a
            // table at the first blank line, but migrations/MANIFEST.md spaces
            // its rows out for readability — and stopping there silently read
            // 32 of its 50 rows, which is exactly the kind of quiet
            // undercount a knowledge base must not make.
            while (j < lines.length) {
                if (/^\|/.test(lines[j])) { rows.push(splitRow(lines[j])); j++; continue; }
                if (lines[j].trim() === '') {
                    let k = j;
                    while (k < lines.length && lines[k].trim() === '') k++;
                    if (k < lines.length && /^\|/.test(lines[k])) { j = k; continue; }
                }
                break;
            }
            out.push({ headers, rows, line: i + 1 });
            i = j;
        } else i++;
    }
    return out;
}

/** One `| a | b |` row → its cells, with the outer pipes discarded. */
function splitRow(line) {
    const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    // A cell can contain an escaped pipe or one inside code — split on pipes
    // that are not preceded by a backslash.
    return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Index of the first header matching any of `names` (case-insensitive). */
function col(headers, ...names) {
    return headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
}

/** Markdown emphasis and code ticks stripped, for a value used as an enum. */
const plain = (s) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();

// ---------------------------------------------------------------------------
// Bugs — the triage reports
// ---------------------------------------------------------------------------

/**
 * A verdict string → the status the base stores.
 *
 * The verdict itself is kept verbatim; this is only the coarse bucket used for
 * filtering. MISUNDERSTANDING and INVALID map to 'invalid' — a finding, not an
 * absence, and one worth being able to list so the same wrong claim is not
 * re-filed a third time.
 */
export function statusOf(verdict) {
    const v = plain(verdict).toUpperCase();
    if (!v) return 'unknown';
    // ORDERED rules, not a bag of substrings. Order is the whole design here:
    // these verdicts are prose, and several classifying words appear inside
    // each other. 'CONFIRMED (design gap)' is an open defect, while
    // 'DESIGN/GAP — …' is an undecided question — a DESIGN rule that ran first
    // would swallow both, and an ALREADY rule swallowed 'the data model
    // already allows it' when it was tried.
    //
    // 1. Fixed wins over everything: 'FIXED in v2.9.15 …; import path
    //    CONFIRMED' is fixed, and a bug marked fixed must not resurface.
    if (/\bFIXED\b|\bDONE\b|\bSHIPPED\b|\bRESOLVED\b/.test(v)) return 'fixed';
    // 2. Nothing to build: the premise was wrong, or the thing already ships.
    if (/INVALID|MISUNDERSTANDING|\bEXISTS\b|NOT REPRODUCIBLE|BY DESIGN|WORKS AS/.test(v)) return 'invalid';
    // 3. A real defect — checked BEFORE the design rule for the reason above.
    if (/CONFIRMED|GENUINE|^BUG\b/.test(v)) return 'open';
    // 4. A decision still to be taken, or a claim that could not be checked.
    if (/CANNOT VERIFY|\bNEEDS\b|\bDEFER|\bLATER\b|QUESTION|\bANSWER\b|\bDESIGN\b|PROPOSAL/.test(v)) return 'deferred';
    if (/\bGAP\b/.test(v)) return 'open';
    return 'unknown';
}


/**
 * Bugs from every triage table under `reports/`.
 *
 * @returns {{bugs: object[], skipped: number}}
 */
export function bugs(dir = 'reports', basenameIndex) {
    const bugsOut = [];
    let skipped = 0;
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) return { bugs: bugsOut, skipped };

    for (const file of readdirSync(root).filter((f) => /triage|feedback|review/i.test(f) && f.endsWith('.md'))) {
        const path = `${dir}/${file}`;
        const md = read(path);
        const reportDate = /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] ?? null;
        const reportVersion = /(\d+\.\d+\.\d+)/.exec(file)?.[1] ?? null;

        for (const { headers, rows, line } of tables(md)) {
            const iNum = col(headers, '#');
            const iVerdict = col(headers, 'verdict');
            if (iNum === -1 || iVerdict === -1) continue;   // not a triage table
            const iTitle = headers.findIndex((h, k) => k !== iNum && k !== iVerdict
                && /title|item|report|issue|finding/i.test(h));
            const titleIdx = iTitle === -1 ? (iNum === 0 ? 1 : 0) : iTitle;

            rows.forEach((cells, r) => {
                const number = plain(cells[iNum]);
                const title = plain(cells[titleIdx]);
                if (!number || !title) { skipped++; return; }
                // Everything that is not #, title or verdict is detail — which
                // is how 'Root cause', 'One-line reason' and 'Effort' all land
                // without the parser needing to know their names.
                const detail = headers
                    .map((h, k) => (k === iNum || k === titleIdx || k === iVerdict) ? null : `${h}: ${cells[k] ?? ''}`)
                    .filter((x) => x && !/: *$/.test(x))
                    .join('\n');
                const verdict = plain(cells[iVerdict]);
                // The VERDICT is scanned too, not just the title and detail
                // columns. In the pilot report the reasoning — and every file
                // it names — lives in the verdict, while the remaining column
                // is only 'Effort: ½ day'. Skipping it left all 13 of that
                // report's findings with no refs at all, which in turn made
                // `kb stale` silently skip them.
                const refs = extractRefs(`${title} ${verdict} ${detail}`);
                bugsOut.push({
                    id: `${file.replace(/\.md$/, '')}#${number}`,
                    report: file,
                    number,
                    report_version: reportVersion,
                    title,
                    verdict,
                    status: statusOf(verdict),
                    root_cause: detail || null,
                    refs: JSON.stringify(refs),
                    modules: JSON.stringify(modulesOfRefs(refs, basenameIndex)),
                    fixed_in_version: /FIXED in v?(\d+\.\d+\.\d+)/i.exec(verdict)?.[1] ?? null,
                    reported_on: reportDate,
                    source_path: path,
                    source_line: line + 2 + r,
                });
            });
        }
    }
    return { bugs: bugsOut, skipped };
}

// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------

/**
 * One row per bullet under a dated `### YYYY-MM-DD (topic)` heading.
 *
 * @returns {{learnings: object[], skipped: number}}
 */
export function learnings(path = 'LEARNINGS.md', basenameIndex) {
    const out = [];
    let skipped = 0;
    if (!existsSync(join(REPO_ROOT, path))) return { learnings: out, skipped };
    const lines = read(path).split('\n');

    let date = null;
    let topic = null;
    let buf = null;
    let bufLine = 0;
    let n = 0;

    const flush = () => {
        if (!buf) return;
        const body = buf.join('\n').trim();
        buf = null;
        if (!body) return;
        if (!date) { skipped++; return; }
        const headline = /^\*\*(.+?)\*\*/s.exec(body)?.[1]?.replace(/\s+/g, ' ') ?? null;
        const refs = extractRefs(body);
        out.push({
            id: `L-${String(++n).padStart(4, '0')}`,
            recorded_on: date,
            topic,
            headline: headline ? headline.slice(0, 300) : null,
            body,
            refs: JSON.stringify(refs),
            modules: JSON.stringify(modulesOfRefs(refs, basenameIndex)),
            source_path: path,
            source_line: bufLine,
        });
    };

    lines.forEach((line, i) => {
        const h = /^#{2,3}\s+(\d{4}-\d{2}-\d{2})\s*(?:\((.+)\))?\s*$/.exec(line);
        if (h) { flush(); date = h[1]; topic = h[2] ?? null; return; }
        const bullet = /^-\s+(.*)$/.exec(line);
        if (bullet) { flush(); buf = [bullet[1]]; bufLine = i + 1; return; }
        if (buf) {
            if (/^\s+\S/.test(line) || line.trim() === '') buf.push(line.trim());
            else flush();
        }
    });
    flush();
    return { learnings: out, skipped };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * The migration manifest's rows — the ones whose first cell is a 4-digit id.
 *
 * MANIFEST.md holds more than one table (there is a `Release | Change` table
 * too), so the id shape is the filter rather than "the first table".
 *
 * @returns {object[]}
 */
export function migrations(path = 'migrations/MANIFEST.md') {
    if (!existsSync(join(REPO_ROOT, path))) return [];
    const out = [];
    for (const { headers, rows } of tables(read(path))) {
        const iType = col(headers, 'type');
        for (const cells of rows) {
            const id = plain(cells[0]);
            if (!/^\d{4}$/.test(id)) continue;
            out.push({
                id,
                file: plain(cells[1]),
                type: iType === -1 ? plain(cells[2]) : plain(cells[iType]),
                notes: cells[cells.length - 1] ?? '',
                source_path: path,
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Insights — agent notes, memory files, the handoff
// ---------------------------------------------------------------------------

/**
 * Durable notes that are neither release notes nor learnings.
 *
 * The memory directory lives outside the repo (it is the assistant's own
 * per-project store), so it is included only when present — a fresh clone on
 * another machine simply has fewer insights, not a failing build.
 *
 * @param {string} [memoryDir] absolute path
 * @returns {object[]}
 */
export function insights(memoryDir, basenameIndex) {
    const out = [];
    const push = (kind, path, absolute) => {
        const body = readFileSync(absolute, 'utf8');
        const title = /^#\s+(.+)$/m.exec(body)?.[1]
            ?? /^name:\s*(.+)$/m.exec(body)?.[1]
            ?? path.split('/').pop().replace(/\.md$/, '');
        const refs = extractRefs(body);
        out.push({
            id: `${kind}:${path.split('/').pop().replace(/\.md$/, '')}`,
            kind,
            title: title.trim().slice(0, 300),
            body,
            recorded_on: /(\d{4}-\d{2}-\d{2})/.exec(body)?.[1] ?? null,
            modules: JSON.stringify(modulesOfRefs(refs, basenameIndex)),
            source_path: path,
        });
    };

    for (const f of readdirSync(REPO_ROOT).filter((x) => /^AGENT-NOTE-.*\.md$/.test(x))) {
        push('agent-note', f, join(REPO_ROOT, f));
    }
    for (const f of ['HANDOFF.md']) {
        if (existsSync(join(REPO_ROOT, f))) push('handoff', f, join(REPO_ROOT, f));
    }
    if (memoryDir && existsSync(memoryDir)) {
        for (const f of readdirSync(memoryDir).filter((x) => x.endsWith('.md'))) {
            push('memory', `memory/${f}`, join(memoryDir, f));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Every markdown document under `docs/` and `reports/`, indexed whole.
 *
 * @returns {object[]}
 */
export function docs() {
    const out = [];
    const walk = (absolute, kindOf) => {
        if (!existsSync(absolute)) return;
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
            const child = join(absolute, entry.name);
            // .vitepress/dist is a BUILD of the very files being indexed;
            // including it would double every doc and drown search in HTML.
            if (entry.isDirectory()) {
                if (entry.name === '.vitepress' || entry.name === 'node_modules') continue;
                walk(child, kindOf);
            } else if (entry.name.endsWith('.md')) {
                const path = relative(REPO_ROOT, child);
                const body = readFileSync(child, 'utf8');
                out.push({
                    path,
                    title: /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? entry.name,
                    kind: kindOf(path),
                    headings: JSON.stringify([...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim())),
                    words: body.split(/\s+/).length,
                    body,
                });
            }
        }
    };
    walk(join(REPO_ROOT, 'docs'), (p) => p.split('/')[1] ?? 'docs');
    walk(join(REPO_ROOT, 'reports'), () => 'report');
    return out;
}
