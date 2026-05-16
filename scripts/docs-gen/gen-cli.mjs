#!/usr/bin/env node
/**
 * scripts/docs-gen/gen-cli.mjs
 *
 * Deterministic, re-runnable generator for the CLI & OPS reference.
 *
 * Documents the operator tooling by PARSING SOURCE — it never executes any of
 * the tools it documents. Re-running on an unchanged tree produces a
 * byte-identical docs/reference/cli/index.md.
 *
 * Sources parsed:
 *   - bin/rohy-update            -> subcommands, exit codes, ROHY_* env config
 *   - scripts/*.{js,cjs} (db/data/seed/import) -> one-line purpose + invocation
 *   - scripts/audit-*.sh, scripts/tech-test.sh, ... -> one-line purpose
 *   - package.json scripts       -> relevant operator npm scripts (read, not hardcoded)
 *
 * Output is VitePress-safe: every shell command is fenced or wrapped in
 * backticks, and table cells escape `|`, `<` and `>` so the markdown table
 * (and rohy-update's `<placeholder>` help tokens) render literally.
 *
 * Regenerate:  npm run docs:gen:cli
 *
 * Constraints honoured: ESM only; no execution of documented tools; no edits
 * to any source file; does not commit.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const r = (...p) => path.join(REPO_ROOT, ...p);
const readMaybe = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Escape a string for safe rendering inside a markdown (VitePress) table cell.
 * Pipes break the table; angle brackets are interpreted as HTML/Vue tags by
 * VitePress (rohy-update help text is full of `<placeholder>` tokens). We wrap
 * the whole cell in backticks where it is command-like, but for free text we
 * escape the dangerous glyphs instead.
 */
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ')
    .trim();

/** Wrap command-like text in an inline code span (pipes inside code still
 *  need escaping for the surrounding table, so escape after fencing). */
const codeCell = (s) => '`' + String(s ?? '').trim().replace(/`/g, '') + '`';
const codeCellInTable = (s) => codeCell(s).replace(/\|/g, '\\|');

// ──────────────────────────────────────────────────────────────────────────
// 1. Parse bin/rohy-update
// ──────────────────────────────────────────────────────────────────────────

function parseRohyUpdate() {
  const src = readMaybe(r('bin', 'rohy-update'));
  if (src === null) {
    return { found: false, subcommands: [], exitCodes: [], envVars: [] };
  }
  const lines = src.split(/\r?\n/);

  // Header comment block: everything from the top while lines start with `#`
  // (after the shebang). Strip the leading `# ` so we can read prose.
  const header = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (/^#/.test(ln)) header.push(ln.replace(/^#\s?/, ''));
    else if (ln.trim() === '') header.push('');
    else break;
  }

  // ── Subcommands ──
  // Primary source of truth: the dispatch `case "${1:-}" in` block at the
  // bottom. Each non-help/non-wildcard arm is a real subcommand. We then
  // enrich each with the matching `# Usage:` line from the header.
  const subcommands = [];
  const dispatchStart = lines.findIndex((l) => /case\s+"\$\{1:-\}"\s+in/.test(l));
  if (dispatchStart !== -1) {
    for (let i = dispatchStart + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*esac\b/.test(ln)) break;
      // arm pattern:  name|alias)   ...   ;;
      const m = ln.match(/^\s*([a-z][\w-]*(?:\|[a-z][\w-]*)*)\)\s/);
      if (!m) continue;
      const labels = m[1].split('|');
      // Skip the help / empty-string / wildcard arms.
      if (labels.some((x) => ['-h', '--help', 'help', ''].includes(x))) continue;
      const name = labels[0];
      const aliases = labels.slice(1);
      // Find the header Usage line that mentions this subcommand.
      const usageLine =
        header.find((h) => new RegExp(`rohy-update\\s+${name}\\b`).test(h)) || '';
      subcommands.push({
        name,
        aliases,
        usage: usageLine.replace(/^\s*sudo\s+/, '').trim(),
      });
    }
  }

  // ── Exit codes ──
  // Parsed from the header "Exit codes:" section: lines like `  0   success`.
  const exitCodes = [];
  const ecIdx = header.findIndex((h) => /^Exit codes:/i.test(h.trim()));
  if (ecIdx !== -1) {
    for (let i = ecIdx + 1; i < header.length; i++) {
      const h = header[i];
      if (h.trim() === '') break;
      const m = h.match(/^\s*(\d+)\s+(.*\S)\s*$/);
      if (m) exitCodes.push({ code: m[1], meaning: m[2].trim() });
      else break;
    }
  }

  // ── ROHY_* config env vars ──
  // Two corroborating sources: the header "Configuration" block (carries the
  // human description) and the actual `${ROHY_...:-default}` defaulting lines
  // in the body (authoritative for name + default). We merge by name.
  const envMap = new Map();

  // (a) header Configuration block: `ROHY_X=default   description`
  const cfgIdx = header.findIndex((h) => /^Configuration\b/i.test(h.trim()));
  if (cfgIdx !== -1) {
    // `lastName` tracks the most recently seen ROHY_* entry so a wrapped
    // description (its own header line, no NAME= prefix — e.g. ROHY_VERIFY_URL
    // whose description spills onto the next line) attaches to the right var,
    // not to whichever var last happened to carry an inline description.
    let lastName = null;
    for (let i = cfgIdx + 1; i < header.length; i++) {
      const h = header[i];
      if (h.trim() === '') break;
      // NAME=value [optional inline description]
      const m = h.match(/^\s*(ROHY_[A-Z0-9_]+)=(\S*)\s*(.*)$/);
      if (m) {
        lastName = m[1];
        envMap.set(m[1], {
          name: m[1],
          example: m[2],
          desc: (m[3] || '').trim(),
        });
      } else if (lastName) {
        // Continuation: wrapped description for the last ROHY_* entry.
        const cont = h.trim();
        const last = envMap.get(lastName);
        if (last && cont) last.desc = (last.desc + ' ' + cont).trim();
      }
    }
  }

  // (b) body defaulting lines — authoritative names + defaults.
  const defRe = /^\s*(ROHY_[A-Z0-9_]+)="\$\{\1:-([^}]*)\}"/gm;
  let dm;
  while ((dm = defRe.exec(src)) !== null) {
    const name = dm[1];
    const def = dm[2];
    const existing = envMap.get(name);
    if (existing) existing.default = def;
    else envMap.set(name, { name, example: '', desc: '', default: def });
  }

  const envVars = [...envMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { found: true, subcommands, exitCodes, envVars, header };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Parse data / db / seed / import scripts
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull a one-line purpose from a script's leading comment. Handles both the
 * `// ...` line-comment style and the `/** ... *\/` block style. Falls back to
 * a conservative filename-derived guess marked "(inferred)".
 */
function extractPurpose(relPath) {
  const abs = r(relPath);
  const src = readMaybe(abs);
  const base = path.basename(relPath);
  if (src === null) return { purpose: `(file not found: ${base})`, inferred: true };

  const lines = src.split(/\r?\n/);
  let i = 0;
  if (/^#!/.test(lines[0])) i = 1; // skip shebang

  // Block comment /** ... */ — first non-empty content line is the purpose.
  if (lines[i] && /^\s*\/\*\*?/.test(lines[i])) {
    for (let j = i; j < lines.length; j++) {
      let t = lines[j]
        .replace(/^\s*\/\*\*?/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*\*\s?/, '')
        .trim();
      if (t === '' || /^\/\*/.test(lines[j].trim()) === false && t === '') continue;
      if (t && !/^(Usage|Strategy|Why|Match|Idempotent)\b/i.test(t)) {
        return { purpose: t.replace(/[.]$/, ''), inferred: false };
      }
      if (/\*\//.test(lines[j])) break;
    }
  }

  // Line comments `// ...` — concatenate the first sentence-ish line.
  if (lines[i] && /^\s*\/\//.test(lines[i])) {
    const t = lines[i].replace(/^\s*\/\/\s?/, '').trim();
    if (t) return { purpose: t.replace(/[.]$/, ''), inferred: false };
  }

  // Conservative inference from filename. We only expand a small, safe set
  // of well-known verbs; everything else stays a literal de-slugged name.
  // The "(inferred)" suffix is mandatory so readers know it is not sourced.
  const stem = base.replace(/\.(c?js)$/, '');
  const hints = {
    migrate: 'Apply pending SQL migrations from migrations/',
    'retention-sweep': 'Delete time-bounded log rows past the retention horizon',
  };
  const guessed =
    hints[stem] ||
    stem
      .replace(/[-_]/g, ' ')
      .replace(/\bjson\b/i, 'JSON')
      .trim();
  return { purpose: `${guessed} (inferred)`, inferred: true };
}

/** Discover the db/data/seed/import script set from disk (deterministic sort). */
function discoverDataScripts() {
  const out = [];
  const scriptsDir = r('scripts');
  const serverScriptsDir = r('server', 'scripts');

  const explicit = ['migrate.js', 'seed.js', 'retention-sweep.js'];
  for (const f of explicit) {
    if (readMaybe(path.join(scriptsDir, f)) !== null) out.push(`scripts/${f}`);
  }

  const scriptFiles = readdirSync(scriptsDir)
    .filter((f) => /^(seed|import)-.*\.(c?js)$/.test(f))
    .sort();
  for (const f of scriptFiles) out.push(`scripts/${f}`);

  let serverFiles = [];
  try {
    serverFiles = readdirSync(serverScriptsDir)
      .filter((f) => /^(seed|import)-.*\.(c?js)$/.test(f))
      .sort();
  } catch {
    /* server/scripts may not exist */
  }
  for (const f of serverFiles) out.push(`server/scripts/${f}`);

  // De-dup while preserving discovery order.
  return [...new Set(out)];
}

function buildDataScriptRows() {
  return discoverDataScripts().map((rel) => {
    const { purpose } = extractPurpose(rel);
    const runner = rel.endsWith('.cjs') ? 'node' : 'node';
    return {
      command: path.basename(rel),
      purpose,
      invocation: `${runner} ${rel}`,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Parse audit / verification shell scripts
// ──────────────────────────────────────────────────────────────────────────

/** First prose line of a shell script's `#` header (after the shebang). */
function shellHeaderPurpose(relPath) {
  const src = readMaybe(r(relPath));
  const base = path.basename(relPath);
  if (src === null) return `(file not found: ${base})`;
  const lines = src.split(/\r?\n/);
  const buf = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!/^#/.test(ln)) break;
    const t = ln.replace(/^#\s?/, '').trim();
    if (t === '') {
      if (buf.length) break; // blank line ends the first paragraph
      continue;
    }
    // Skip a leading "scripts/foo.sh — " / "foo.sh — " filename echo.
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    buf.push(
      t
        .replace(new RegExp(`^${esc(relPath)}\\s*[—-]\\s*`), '')
        .replace(new RegExp(`^${esc(base)}\\s*[—-]\\s*`), ''),
    );
    // Stop once we have a full sentence (wrapped headers continue otherwise).
    if (/[.]$/.test(t) || buf.length >= 3) break;
  }
  const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) {
    const guessed = base.replace(/\.sh$/, '').replace(/[-_]/g, ' ');
    return `${guessed} (inferred)`;
  }
  return joined.replace(/[.]$/, '');
}

function discoverAuditScripts() {
  const scriptsDir = r('scripts');
  const audits = readdirSync(scriptsDir)
    .filter((f) => /^audit-.*\.sh$/.test(f))
    .sort()
    .map((f) => `scripts/${f}`);

  // Verification companions that ship in the same family.
  const extras = ['tech-test.sh', 'post-verify-rohy.sh', 'smoke.sh'].filter(
    (f) => readMaybe(path.join(scriptsDir, f)) !== null,
  );

  // server/scripts/*.sh audits, if any.
  let serverAudits = [];
  try {
    serverAudits = readdirSync(r('server', 'scripts'))
      .filter((f) => /^audit-.*\.sh$/.test(f))
      .sort()
      .map((f) => `server/scripts/${f}`);
  } catch {
    /* none */
  }

  return {
    audits: [...audits, ...serverAudits],
    verification: extras.map((f) => `scripts/${f}`),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Relevant npm scripts (read from package.json, not hardcoded)
// ──────────────────────────────────────────────────────────────────────────

function relevantNpmScripts() {
  const pkg = JSON.parse(readMaybe(r('package.json')) || '{}');
  const scripts = pkg.scripts || {};
  // Operator/ops-relevant names: anything that drives setup, oyon, piper,
  // migrate, seed, or production — but not dev/test/lint/build noise.
  const opsRe = /(oyon|piper|migrate|seed|production|setup|docs:gen)/i;
  return Object.entries(scripts)
    .filter(([name]) => opsRe.test(name))
    .map(([name, cmd]) => ({ name, cmd }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Emit docs/reference/cli/index.md
// ──────────────────────────────────────────────────────────────────────────

function render() {
  const ru = parseRohyUpdate();
  const dataRows = buildDataScriptRows();
  const { audits, verification } = discoverAuditScripts();
  const npm = relevantNpmScripts();

  const out = [];
  out.push('# CLI & Ops Reference');
  out.push('');
  out.push(
    '> Generated from source by `scripts/docs-gen/gen-cli.mjs`. Do not edit by hand — regenerate with `npm run docs:gen:cli`.',
  );
  out.push('');

  // ── Update tool ──
  out.push('## Update tool (`bin/rohy-update`)');
  out.push('');
  if (!ru.found) {
    out.push('_`bin/rohy-update` not found in the tree._');
  } else {
    out.push(
      'Operator-driven, backup-first upgrade path. One CLI, ' +
        `${ru.subcommands.length} subcommands. Never executed by this generator — parsed from source.`,
    );
    out.push('');
    out.push('### Subcommands');
    out.push('');
    out.push('| Subcommand | Aliases | Usage |');
    out.push('| --- | --- | --- |');
    for (const s of ru.subcommands) {
      out.push(
        `| ${codeCellInTable(s.name)} | ${
          s.aliases.length ? s.aliases.map(codeCellInTable).join(', ') : '—'
        } | ${s.usage ? cell(s.usage) : '—'} |`,
      );
    }
    out.push('');
    out.push('### Exit codes');
    out.push('');
    out.push('| Code | Meaning |');
    out.push('| --- | --- |');
    for (const e of ru.exitCodes) {
      out.push(`| \`${e.code}\` | ${cell(e.meaning)} |`);
    }
    out.push('');
    out.push('### Configuration (env vars or `/etc/rohy/update.conf`)');
    out.push('');
    out.push('| Variable | Default | Description |');
    out.push('| --- | --- | --- |');
    for (const v of ru.envVars) {
      const def =
        v.default !== undefined && v.default !== ''
          ? codeCellInTable(v.default)
          : v.example
            ? codeCellInTable(v.example)
            : '_(none)_';
      out.push(`| ${codeCellInTable(v.name)} | ${def} | ${cell(v.desc) || '—'} |`);
    }
  }
  out.push('');

  // ── Database & data scripts ──
  out.push('## Database & data scripts');
  out.push('');
  out.push('| Command | Purpose | Invocation |');
  out.push('| --- | --- | --- |');
  for (const row of dataRows) {
    out.push(
      `| ${codeCellInTable(row.command)} | ${cell(row.purpose)} | ${codeCellInTable(
        row.invocation,
      )} |`,
    );
  }
  out.push('');

  // ── Audit & verification scripts ──
  out.push('## Audit & verification scripts');
  out.push('');
  out.push(
    `Each boots/probes a running server and asserts a subsystem contract. ${audits.length} audit scripts discovered.`,
  );
  out.push('');
  out.push('| Script | Purpose |');
  out.push('| --- | --- |');
  for (const rel of audits) {
    out.push(`| ${codeCellInTable(rel)} | ${cell(shellHeaderPurpose(rel))} |`);
  }
  out.push('');
  out.push('### Deploy verification');
  out.push('');
  out.push('| Script | Purpose |');
  out.push('| --- | --- |');
  for (const rel of verification) {
    out.push(`| ${codeCellInTable(rel)} | ${cell(shellHeaderPurpose(rel))} |`);
  }
  out.push('');

  // ── npm scripts ──
  out.push('## Relevant npm scripts');
  out.push('');
  out.push('| Script | Command |');
  out.push('| --- | --- |');
  for (const s of npm) {
    out.push(`| ${codeCellInTable('npm run ' + s.name)} | ${codeCellInTable(s.cmd)} |`);
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('Regenerate this page: `npm run docs:gen:cli`');
  out.push('');

  return { text: out.join('\n'), ru, dataRows, audits, verification };
}

// ──────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────

const { text, ru, dataRows, audits, verification } = render();
const outPath = r('docs', 'reference', 'cli', 'index.md');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, text, 'utf8');

// Console summary (deterministic; safe to capture in CI logs).
console.log(`[docs:gen:cli] wrote ${path.relative(REPO_ROOT, outPath)}`);
console.log(
  `[docs:gen:cli] rohy-update: ${ru.subcommands.length} subcommands ` +
    `[${ru.subcommands.map((s) => s.name).join(', ')}], ` +
    `${ru.exitCodes.length} exit codes, ${ru.envVars.length} env vars`,
);
console.log(
  `[docs:gen:cli] ${dataRows.length} data scripts, ` +
    `${audits.length} audit scripts, ${verification.length} verification scripts`,
);
