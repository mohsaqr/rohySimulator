#!/usr/bin/env node
// =============================================================================
// scripts/docs-gen/gen-data.mjs
// -----------------------------------------------------------------------------
// DETERMINISTIC, RE-RUNNABLE data-model reference generator.
//
// Stage 7 CI re-runs this on every build, so it MUST be:
//   * deterministic   — same source in => byte-identical markdown out
//                        (tables/columns/migrations sorted by stable keys)
//   * side-effect free — pure static text scan. We NEVER open the sqlite DB,
//                        never `import` server code, never boot the server.
//   * ESM only         — `node scripts/docs-gen/gen-data.mjs`
//
// What it reads (all read-only):
//   - server/db.js                  — scanned for CREATE TABLE (see note below)
//   - migrations/0001_initial.sql   — the *base* schema. NOTE: server/db.js no
//                                     longer holds inline CREATE TABLE strings;
//                                     it delegates to the migration runner, and
//                                     the canonical bootstrap schema is
//                                     0001_initial.sql. So that file is treated
//                                     as the db.js-equivalent "base schema".
//   - migrations/*.sql              — CREATE TABLE + ALTER TABLE ADD COLUMN
//                                     introduced after the base schema, each
//                                     attributed to its migration file.
//   - migrations/MANIFEST.md        — per-migration additive/destructive class.
//
// What it writes:
//   - docs/reference/data/index.md  — overview, conventions, grouping
//   - docs/reference/data/tables.md — one section per table
//
// VitePress safety: every emitted identifier is backtick-fenced; every table
// cell escapes `|`; raw `<`/`>` in type/constraint text is HTML-escaped so the
// Vue/markdown compiler does not try to parse it as a tag.
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DB_JS = path.join(REPO_ROOT, 'server', 'db.js');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const MANIFEST = path.join(MIGRATIONS_DIR, 'MANIFEST.md');
const BASE_MIGRATION = '0001_initial.sql';
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'reference', 'data');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** HTML-escape angle brackets so VitePress/Vue does not parse them as tags. */
function escAngle(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value for safe inclusion inside a markdown table cell. */
function cell(s) {
  return escAngle(String(s)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Backtick-fence an identifier (table/column name). */
function code(s) {
  return '`' + String(s).replace(/`/g, '') + '`';
}

/**
 * Split a CREATE TABLE column-list body into top-level, comma-separated
 * definition fragments. Commas inside parentheses (CHECK(...), DEFAULT(...),
 * numeric(10,2)) must NOT split. Hand-rolled depth scanner — deterministic.
 */
function splitDefs(body) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// Definition fragments that are table constraints, not columns.
const TABLE_CONSTRAINT_RE =
  /^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT)\b/i;

/**
 * Parse one column definition fragment into { name, type, constraints }.
 * Returns null if the fragment is a table-level constraint, not a column.
 */
function parseColumn(frag) {
  if (TABLE_CONSTRAINT_RE.test(frag)) return null;
  // First token = column name (may be quoted/backticked/bracketed).
  const m = frag.match(/^\s*([`"[]?)([A-Za-z_][A-Za-z0-9_]*)\1\]?\s*(.*)$/s);
  if (!m) return null;
  const name = m[2];
  const rest = (m[3] || '').trim();
  // Type = leading word(s) up to the first known constraint keyword.
  const typeMatch = rest.match(
    /^([A-Za-z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/,
  );
  const type = typeMatch ? typeMatch[1].replace(/\s+/g, '') : '';
  let constraints = rest.slice(type.length).trim();
  // Normalise whitespace.
  constraints = constraints.replace(/\s+/g, ' ').trim();
  return { name, type: type || '(untyped)', constraints };
}

/**
 * Scan a SQL text for `CREATE TABLE [IF NOT EXISTS] <name> ( ... );`.
 * Returns array of { name, columns: [{name,type,constraints}] }.
 * Rebuild-scaffold names (SQLite rename-dance temporaries ending in
 * `_new` / `_old` / `_retention_new`) are skipped — they are not part of the
 * durable data model.
 */
function scanCreateTables(sql) {
  const tables = [];
  // Match the keyword + name + opening paren; then balance parens manually so
  // nested CHECK(...) / FK clauses do not terminate the body early.
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?)([A-Za-z_][A-Za-z0-9_]*)\1\]?\s*\(/gi;
  let mm;
  while ((mm = re.exec(sql)) !== null) {
    const name = mm[2];
    // Balance from the '(' that the regex just consumed.
    let depth = 1;
    let i = re.lastIndex;
    let body = '';
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    if (depth !== 0) continue; // unbalanced — skip defensively
    if (/(_new|_old)$/i.test(name)) continue; // rebuild scaffold, not real
    const columns = [];
    for (const frag of splitDefs(body)) {
      const c = parseColumn(frag);
      if (c) columns.push(c);
    }
    tables.push({ name, columns });
  }
  return tables;
}

/**
 * Scan a SQL text for `ALTER TABLE <name> ADD COLUMN <coldef>;`.
 * Returns array of { table, column: {name,type,constraints} }.
 */
function scanAddColumns(sql) {
  const out = [];
  const re =
    /ALTER\s+TABLE\s+([`"[]?)([A-Za-z_][A-Za-z0-9_]*)\1\]?\s+ADD\s+COLUMN\s+([^;]+);/gi;
  let mm;
  while ((mm = re.exec(sql)) !== null) {
    const table = mm[2];
    if (/(_new|_old)$/i.test(table)) continue;
    const c = parseColumn(mm[3].trim());
    if (c) out.push({ table, column: c });
  }
  return out;
}

/** Parse MANIFEST.md per-migration rows: `| 0001 | \`file.sql\` | additive | … |`. */
function parseManifest(text) {
  const map = new Map(); // file -> { class, note }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\|\s*\d+\s*\|\s*`([^`]+\.sql)`\s*\|\s*(additive|destructive)\s*\|\s*(.*?)\s*\|\s*$/i,
    );
    if (m) map.set(m[1], { class: m[2].toLowerCase(), note: m[3] });
  }
  return map;
}

// Cross-cutting column flags (see CLAUDE.md conventions).
function crossCuttingFlags(columns) {
  const names = new Set(columns.map((c) => c.name.toLowerCase()));
  const flags = [];
  if (names.has('deleted_at')) flags.push('soft-delete');
  if (names.has('tenant_id')) flags.push('tenant-scoped');
  const auditBits = ['created_by', 'created_at', 'updated_at'].filter((n) =>
    names.has(n),
  );
  if (auditBits.length) flags.push(`audit (${auditBits.join(', ')})`);
  const snaps = columns
    .map((c) => c.name)
    .filter((n) => /_snapshot$/i.test(n));
  if (snaps.length) flags.push(`snapshot (${snaps.join(', ')})`);
  return flags;
}

/**
 * Concern grouping. Order is deterministic; a table lands in the FIRST group
 * whose matcher hits, else "other". Matching is by exact name or regex.
 */
const GROUPS = [
  ['Auth & users', /^(users|login_logs|user_preferences|active_sessions)$/],
  ['Tenants', /^(tenants)$/],
  ['Cases & scenarios', /^(cases|case_versions|scenarios|scenario_events|scenario_templates|scenario_timeline_points|patient_information|patient_record_events|patient_record_documents|clinical_pathways|diagnoses)$/],
  ['Sessions', /^(sessions|session_settings|session_notes|session_vitals|interactions|active_sessions|clinical_notes)$/],
  ['Investigations & labs', /^(case_investigations|investigation_orders|investigation_templates|investigation_parameters|investigation_views|lab_definitions|lab_tests|lab_panels|panel_tests|lab_reference_ranges|lab_reference_ranges_.*|custom_lab_groups|custom_lab_group_items|vital_sign_history|vital_sign_definitions|physical_exam_findings|exam_techniques|body_regions|region_.*|body_map_coordinates)$/],
  ['Treatments & medications', /^(treatment_orders|treatment_effects|active_treatments|case_treatments|medications|medication_doses|custom_drug_groups|custom_drug_group_items|data_sources|search_aliases)$/],
  ['Agents', /^(agent_templates|case_agents|agent_conversations|agent_session_state|team_communications_log)$/],
  ['Cohorts', /^(cohorts|cohort_members|cohort_cases)$/],
  ['Analytics & events', /^(learning_events|event_log|emotion_logs|questionnaire_responses|export_records)$/],
  ['LLM & TTS usage', /^(llm_usage|llm_request_log|llm_model_pricing|tts_usage|usage_budget)$/],
  ['Oyon (emotion add-on)', /^(oyon_.*)$/],
  ['Alarms', /^(alarm_events|alarm_config)$/],
  ['Observability & audit', /^(system_audit_log|settings_logs|client_logs)$/],
  ['Platform & retention', /^(platform_settings|.*_retention)$/],
];

function groupFor(name) {
  for (const [label, re] of GROUPS) {
    if (re.test(name)) return label;
  }
  return 'Other';
}

// -----------------------------------------------------------------------------
// Build the model
// -----------------------------------------------------------------------------

const REGEN_CMD = 'npm run docs:gen:data';

function build() {
  // 1. server/db.js — spec asks to scan it. In the current codebase db.js holds
  //    NO inline CREATE TABLE (it delegates to the migration runner). We scan
  //    anyway so the generator stays correct if inline DDL is ever reintroduced.
  const dbJsSql = existsSync(DB_JS) ? readFileSync(DB_JS, 'utf8') : '';
  const dbJsTables = scanCreateTables(dbJsSql);

  // 2. Base schema: migrations/0001_initial.sql is the canonical bootstrap.
  const basePath = path.join(MIGRATIONS_DIR, BASE_MIGRATION);
  const baseSql = existsSync(basePath) ? readFileSync(basePath, 'utf8') : '';
  const baseTables = scanCreateTables(baseSql);

  // 3. Manifest classifications.
  const manifest = existsSync(MANIFEST)
    ? parseManifest(readFileSync(MANIFEST, 'utf8'))
    : new Map();

  // tables: name -> { name, source, columns: Map(name->col), migrationCols: [] }
  const tables = new Map();

  function ensure(name, source) {
    if (!tables.has(name)) {
      tables.set(name, {
        name,
        source, // 'db.js' | '0001_initial.sql' | migration file
        columns: new Map(),
        addedColumns: [], // { name, col, migration }
      });
    }
    return tables.get(name);
  }

  // db.js base tables first (highest authority if both define it).
  for (const t of dbJsTables) {
    const rec = ensure(t.name, 'server/db.js');
    for (const c of t.columns) rec.columns.set(c.name, c);
  }
  // Then the 0001 base schema.
  for (const t of baseTables) {
    const rec = ensure(t.name, tables.has(t.name) ? tables.get(t.name).source : BASE_MIGRATION);
    for (const c of t.columns) if (!rec.columns.has(c.name)) rec.columns.set(c.name, c);
  }

  // 4. All migrations (sorted by filename for determinism), excluding the base.
  const migFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let parsedMigrations = 0;
  for (const f of migFiles) {
    if (f === BASE_MIGRATION) continue;
    parsedMigrations++;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');

    // New tables introduced by this migration.
    for (const t of scanCreateTables(sql)) {
      const isNew = !tables.has(t.name);
      const rec = ensure(t.name, isNew ? f : tables.get(t.name).source);
      for (const c of t.columns) {
        if (!rec.columns.has(c.name)) {
          rec.columns.set(c.name, c);
          if (!isNew) rec.addedColumns.push({ name: c.name, col: c, migration: f });
        }
      }
    }
    // Columns added to existing tables.
    for (const a of scanAddColumns(sql)) {
      const rec = ensure(a.table, tables.has(a.table) ? tables.get(a.table).source : f);
      if (!rec.columns.has(a.column.name)) {
        rec.columns.set(a.column.name, a.column);
        rec.addedColumns.push({ name: a.column.name, col: a.column, migration: f });
      }
    }
  }

  return { tables, manifest, parsedMigrations, dbJsTables };
}

// -----------------------------------------------------------------------------
// Render markdown
// -----------------------------------------------------------------------------

function render({ tables, manifest, parsedMigrations, dbJsTables }) {
  const all = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Group tables (deterministic group order from GROUPS, then "Other").
  const groupOrder = [...GROUPS.map(([l]) => l), 'Other'];
  const grouped = new Map(groupOrder.map((g) => [g, []]));
  for (const t of all) grouped.get(groupFor(t.name)).push(t.name);

  // ---- index.md ----
  const idx = [];
  idx.push('# Data model reference');
  idx.push('');
  idx.push(
    '> **Generated file — do not edit by hand.** Produced by `scripts/docs-gen/gen-data.mjs` ' +
      `from \`server/db.js\`, \`migrations/${BASE_MIGRATION}\` (the bootstrap schema) and ` +
      'all `migrations/*.sql`. Regenerate with `' + REGEN_CMD + '`.',
  );
  idx.push('');
  idx.push(`**${all.length} tables** in the durable data model.`);
  idx.push('');
  if (dbJsTables.length === 0) {
    idx.push(
      '> Note: `server/db.js` no longer holds inline `CREATE TABLE` DDL — it ' +
        'delegates to the migration runner. The canonical bootstrap schema is ' +
        '`migrations/' + BASE_MIGRATION + '`, treated here as the base schema. ' +
        'SQLite rebuild-scaffold tables (`*_new`/`*_old`) are intentionally excluded.',
    );
    idx.push('');
  }
  idx.push('See [tables.md](./tables.md) for the per-table column reference.');
  idx.push('');

  idx.push('## Cross-cutting conventions');
  idx.push('');
  idx.push(
    'These columns recur across many tables and carry platform-wide semantics ' +
      '(see `CLAUDE.md`):',
  );
  idx.push('');
  idx.push('| Convention | Column(s) | Meaning |');
  idx.push('| --- | --- | --- |');
  idx.push(
    '| Soft-delete | `deleted_at` | Row is logically deleted when non-NULL. ' +
      'Most reads imply `deleted_at IS NULL`; physical purge is done by the ' +
      'retention sweep cron. |',
  );
  idx.push(
    '| Tenant scoping | `tenant_id` | Multi-tenant isolation. Enforced by ' +
      '`requireSameTenant()` middleware, not ad-hoc `WHERE` clauses. |',
  );
  idx.push(
    '| Audit / ownership | `created_by`, `created_at`, `updated_at` | Who ' +
      'authored the row and when; basis for ownership-based authz. |',
  );
  idx.push(
    '| Snapshot binding | `*_snapshot` | Frozen copy taken at session start so ' +
      'later admin edits do not bleed into a live session. |',
  );
  idx.push('');

  idx.push('## Migration policy');
  idx.push('');
  idx.push(
    'Schema evolves only through versioned `migrations/*.sql`. Each migration ' +
      'is classified **additive** (previous-version code still runs) or ' +
      '**destructive** in `migrations/MANIFEST.md`, ' +
      'which `bin/rohy-update` reads to decide whether to auto-apply. Default ' +
      'is additive-only; destructive changes follow a multi-release dance.',
  );
  idx.push('');
  idx.push(
    `Parsed **${parsedMigrations} migration files** beyond the base schema ` +
      `(\`${BASE_MIGRATION}\`).`,
  );
  idx.push('');
  // Manifest classification table (deterministic: sorted by file).
  if (manifest.size) {
    idx.push('| Migration | Class | Note |');
    idx.push('| --- | --- | --- |');
    for (const f of [...manifest.keys()].sort()) {
      const m = manifest.get(f);
      idx.push(`| ${code(f)} | ${m.class} | ${cell(m.note)} |`);
    }
    idx.push('');
  }

  idx.push('## Tables by concern');
  idx.push('');
  for (const g of groupOrder) {
    const list = grouped.get(g);
    if (!list || !list.length) continue;
    idx.push(`### ${g}`);
    idx.push('');
    idx.push(list.map((n) => code(n)).join(', '));
    idx.push('');
  }
  idx.push('---');
  idx.push('');
  idx.push(`_Regenerate: \`${REGEN_CMD}\`_`);
  idx.push('');

  // ---- tables.md ----
  // Cheap purpose one-liner inferred from the table name (humanised).
  function purpose(name) {
    const words = name.replace(/_/g, ' ');
    return `Stores ${words} records.`;
  }

  const tbl = [];
  tbl.push('# Tables');
  tbl.push('');
  tbl.push(
    '> **Generated file — do not edit by hand.** Regenerate with `' +
      REGEN_CMD +
      '`. One section per table; columns in declaration order.',
  );
  tbl.push('');
  tbl.push(`**${all.length} tables.**`);
  tbl.push('');

  for (const t of all) {
    const cols = [...t.columns.values()];
    tbl.push(`## ${code(t.name)}`);
    tbl.push('');
    tbl.push(purpose(t.name));
    tbl.push('');
    const introduced =
      t.source === 'server/db.js'
        ? '`server/db.js`'
        : t.source === BASE_MIGRATION
          ? `base schema (\`migrations/${BASE_MIGRATION}\`)`
          : `migration \`${t.source}\``;
    tbl.push(`**Introduced by:** ${introduced}`);
    const flags = crossCuttingFlags(cols);
    if (flags.length) {
      tbl.push('');
      tbl.push(`**Cross-cutting:** ${flags.map((f) => `\`${f}\``).join(' · ')}`);
    }
    tbl.push('');
    tbl.push('| Column | Type | Constraints | Added by |');
    tbl.push('| --- | --- | --- | --- |');
    // Map column -> migration that added it (post-base).
    const addedBy = new Map(t.addedColumns.map((a) => [a.name, a.migration]));
    for (const c of cols) {
      const by = addedBy.has(c.name) ? code(addedBy.get(c.name)) : '—';
      tbl.push(
        `| ${code(c.name)} | ${cell(c.type)} | ${cell(c.constraints || '—')} | ${by} |`,
      );
    }
    tbl.push('');
  }
  tbl.push('---');
  tbl.push('');
  tbl.push(`_Regenerate: \`${REGEN_CMD}\`_`);
  tbl.push('');

  return { index: idx.join('\n'), tables: tbl.join('\n') };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main() {
  const model = build();
  const { index, tables } = render(model);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'index.md'), index, 'utf8');
  writeFileSync(path.join(OUT_DIR, 'tables.md'), tables, 'utf8');

  const tableCount = model.tables.size;
  // eslint-disable-next-line no-console
  console.log(
    `[docs:gen:data] wrote ${tableCount} tables, ` +
      `${model.parsedMigrations} migrations parsed -> docs/reference/data/`,
  );
  if (tableCount < 40 || tableCount > 100) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docs:gen:data] WARNING: table count ${tableCount} outside expected ~50-80 band — ` +
        'check the CREATE TABLE scanner against source.',
    );
  }
}

main();
