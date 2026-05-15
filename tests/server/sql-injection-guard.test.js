// Static guard against SQL string concatenation in server/.
//
// The audit ("Things the audit itself missed") flagged that there's no
// regression test for "future SQL written as `'... WHERE id = ' + req.params.id`".
// All current SQL is parameterised, but as `routes.js` grows, a slip
// can land silently. This test greps the server tree for the dangerous
// shapes and fails CI when one appears.
//
// What we look for:
//   1. Template literals with `${...}` interpolation inside SQL strings.
//   2. String concatenation with `+` in lines that look like SQL.
//
// What we tolerate:
//   - SQL fragments interpolated WITHOUT user-controlled data
//     (e.g. table names, fixed column lists). Those false-positives
//     get an explicit allowlist below.
//
// The contract: when this test fails, READ THE NEW LINE. If the
// interpolated value is genuinely server-controlled (a constant table
// name, a known column from a fixed enum), add the file:line to the
// allowlist with a one-line justification. If it touches req.body /
// req.params / req.query / a function parameter, rewrite to use ?
// placeholders.

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Files / directories where SQL is composed with interpolation safely
// (table-name varies based on platform_settings, fixed enum, etc.).
// Each entry: { file, lineSubstring, why }
const ALLOWLIST = [
    {
        file: 'server/migrationRunner.js',
        why: 'Migration runner builds DDL from versioned files on disk; no user input touches these paths.',
    },
    {
        file: 'server/db.js',
        why: 'Schema bootstrap + first-boot seed SQL; values come from DEFAULT_AGENTS / migration files.',
    },
    {
        file: 'server/dbAdapter.js',
        why: 'Promisified wrapper — interpolation is only for SQL passed in by callers; callers must parameterise their own values.',
    },
    {
        file: 'server/migrations/',
        why: 'Pure SQL files; no JS interpolation.',
    },
    {
        file: 'migrations/',
        why: 'Pure SQL files.',
    },
    {
        file: 'server/services/labDatabase.js',
        why: 'Reads CSV-derived constant lab definitions; SQL composed from in-memory enum, not user input.',
    },
    {
        file: 'server/routes/catalogue.js',
        why: 'Drug/lab catalogue routes share one handler factory; the interpolated table/FK names are constant strings selected from a hardcoded { drug, lab } map at line ~510, never from req.*. Reviewer: confirm `config` is built from a constant before adding any new interpolation here.',
    },
    // Route modules — line-specific allowlist (NOT a blanket pass).
    // Each entry pins a substring; the substring must literally appear on
    // the flagged line. NEW interpolation in route files will fail until
    // it's audited and either rewritten or added here with a `why`.
    {
        file: 'server/routes/_helpers.js',
        lineSubstring: 'FROM ${table} WHERE tenant_id = ? AND user_id = ?',
        why: 'Iterates HARD_DELETE_ON_PURGE_TABLES (module-level constant); user_id/tenant_id parameterised.',
    },
    {
        file: 'server/routes/_helpers.js',
        lineSubstring: 'FROM ${retention.table} WHERE tenant_id = ?',
        why: 'Iterates RETENTION_TABLES (module-level constant); ${retention.userColumn} also from constant.',
    },
    {
        file: 'server/routes/_helpers.js',
        lineSubstring: 'DELETE FROM ${table} WHERE tenant_id = ?',
        why: 'Same HARD_DELETE_ON_PURGE_TABLES iteration as above.',
    },
    {
        file: 'server/route',
        lineSubstring: "user_id ${user_id ? '= ?' : 'IS NULL'}",
        why: 'Boolean ternary picks SQL fragment from two literals — no user value interpolated.',
    },
    {
        file: 'server/route',
        lineSubstring: 'SET ${updates.join',
        why: 'updates[] is built from a hardcoded { allowed: column-name } whitelist earlier in the handler; values still go through `?` placeholders.',
    },
    {
        file: 'server/route',
        lineSubstring: "configuredIds.map(() => '?').join(',')",
        why: 'Injects only "?" placeholder markers, never values.',
    },
    {
        file: 'server/route',
        lineSubstring: 'FROM ${table}',
        why: 'admin/database-stats iterates a hardcoded `tables` list of known table names.',
    },
    {
        file: 'server/route',
        lineSubstring: 'IN (${templateIds.join',
        why: 'templateIds = templates.map(t => t.id) — integer IDs from a prior parameterised SELECT, never req.* values.',
    },
    {
        file: 'server/route',
        lineSubstring: 'FROM learning_events ${where}',
        why: '`where` is built earlier in the function with `where += " AND col = ?"` shapes; values go through the params array.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'FROM learning_events le WHERE ${whereClause}',
        why: 'whereClause = filters.join(" AND ") where each filter is a hardcoded "le.col = ?" string; all values flow through params[]. Pre-flight count for /export/learning-events.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'WHERE ${where.join(\' AND \')}',
        why: '/export/system-log/:source — where[] is built from a fixed list of conditions ("tenant_id = ?", "${cfg.dateCol} >= ?"); cfg.dateCol comes from EXPORT_SOURCES (constant map). Values parameterised.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'FROM "${cfg.table}" ${whereClause} ORDER BY "${cfg.dateCol}"',
        why: '/export/system-log/:source — cfg.table and cfg.dateCol come from EXPORT_SOURCES, a server-controlled constant map keyed by req.params.source which is validated against the map keys before this line.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'FROM "${t.name}"',
        why: '/system-log/tables — t.name is enumerated from sqlite_master, never from a request.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'FROM "${name}" ${where}',
        why: '/system-log/table/:name — name is validated against sqlite_master existence on the line above (404 otherwise) before any SQL is built; orderClause comes from a hardcoded { id | timestamp | created_at } selection.',
    },
    {
        file: 'server/routes/analytics-routes.js',
        lineSubstring: 'WHERE ${clauses.join(\' AND \')}',
        why: 'TNA filter helper — clauses[] entries are hardcoded SQL fragments with ? placeholders; values go through params[].',
    },
    {
        file: 'server/routes/cohorts-routes.js',
        lineSubstring: 'SET deleted_at = ${dbAdapter.now()} WHERE id = ?',
        why: 'dbAdapter.now() returns the constant literal "datetime(\'now\')" (dbAdapter.js:200) — no user input; cohort id parameterised via ?.',
    },
    {
        file: 'server/routes/cohorts-routes.js',
        lineSubstring: 'SET deleted_at = ${dbAdapter.now()} WHERE cohort_id = ?',
        why: 'dbAdapter.now() is the constant literal "datetime(\'now\')"; cohort_id parameterised via ?.',
    },
    {
        file: 'server/routes/cohorts-routes.js',
        lineSubstring: 'SET deleted_at = NULL, joined_at = ${dbAdapter.now()} WHERE id = ?',
        why: 'dbAdapter.now() is the constant literal "datetime(\'now\')"; membership id parameterised via ?.',
    },
];

function isAllowlisted(filePath, line) {
    return ALLOWLIST.some((entry) => {
        if (!filePath.includes(entry.file)) return false;
        if (entry.lineSubstring && !line.includes(entry.lineSubstring)) return false;
        return true;
    });
}

// Heuristic: a line "looks like SQL" if it contains an SQL keyword in
// uppercase. We're matching at line granularity, so the keyword should
// literally appear on the same line as the interpolation.
const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|VALUES|RETURNING|ON CONFLICT)\b/;

// Interpolation patterns we treat as risky:
//   - `... ${expr} ...` inside backtick strings on a SQL-looking line
//   - 'string' + variable + 'string' on a SQL-looking line
const TEMPLATE_INTERP = /`[^`]*\$\{[^}]+\}[^`]*`/;
const PLUS_CONCAT = /['"][^'"]*\b(?:SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)[^'"]*['"]\s*\+\s*\w/;

function findRiskyLines() {
    // grep for files; we walk JS only (server/ tree minus tests).
    let raw;
    try {
        raw = execSync(
            // Wrap the regex in single quotes for bash so we can use a bare
            // double-quote inside it; backtick is still backslash-escaped to
            // keep it out of JS template-literal interpolation.
            `grep -rn --include='*.js' -E '(\\\`|'\\''|")(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)' ${path.join(REPO_ROOT, 'server')} 2>/dev/null || true`,
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
        );
    } catch {
        return [];
    }

    const findings = [];
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) continue;
        const [, filePath, lineNum, content] = m;
        if (!SQL_KEYWORDS.test(content)) continue;
        if (filePath.includes('/tests/')) continue;
        if (filePath.endsWith('.test.js')) continue;

        const hasTemplate = TEMPLATE_INTERP.test(content);
        const hasPlus = PLUS_CONCAT.test(content);
        if (!hasTemplate && !hasPlus) continue;

        // Allowlist short-circuit.
        if (isAllowlisted(filePath, content)) continue;

        findings.push({ filePath: path.relative(REPO_ROOT, filePath), line: lineNum, content: content.trim() });
    }
    return findings;
}

describe('SQL injection static guard', () => {
    it('rejects ${interpolation} or string + concat in SQL strings under server/', () => {
        const risky = findRiskyLines();
        if (risky.length > 0) {
            const report = risky.map(r => `  ${r.filePath}:${r.line}\n    ${r.content}`).join('\n');
            // Failure message tells the author exactly what to do.
            throw new Error(
                `Found ${risky.length} likely SQL-injection risk(s):\n${report}\n\n` +
                `If the interpolated value is genuinely server-controlled (constant table name, fixed enum), ` +
                `add the file path to the ALLOWLIST in this test with a one-line justification. ` +
                `Otherwise, rewrite to use ? placeholders.`
            );
        }
        expect(risky).toEqual([]);
    });
});
