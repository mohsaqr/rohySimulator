#!/usr/bin/env node
// =============================================================================
// gen-config.mjs — deterministic, re-runnable generator for the
// CONFIG & ENVIRONMENT reference page (docs/reference/config/index.md).
//
// WHAT IT DOES
//   1. Statically scans server/**, bin/**, scripts/** for `process.env.<NAME>`
//      (and `process.env['NAME']` bracket form). It NEVER imports or executes
//      any scanned source — pure text scanning only.
//   2. Parses server/config/validateEnv.js to learn which vars are REQUIRED
//      (pushed onto `errors[]` when unset) vs optional, plus any inline hints.
//   3. Extracts defaults from `process.env.X || 'default'` /
//      `process.env.X ?? N` / `process.env.X || N` patterns at usage sites.
//   4. Classifies each var into a documentation group, flags secrets, and
//      writes a VitePress-safe Markdown page.
//
// DETERMINISM
//   - File walk is sorted; var ordering within a group is alphabetical.
//   - No timestamps, no randomness, no network, no DB. Re-running on an
//     unchanged tree yields a byte-identical file.
//
// HONESTY
//   - Required-ness is ONLY asserted when validateEnv.js demonstrably treats
//     the var as fatal-when-unset. Anything else is "No" (optional). If a
//     default cannot be statically determined it is rendered as "—".
//   - Purposes are inferred from the var name + the validateEnv.js commentary
//     and kept terse. We do not invent runtime behavior we cannot see.
//
// Usage:  node scripts/docs-gen/gen-config.mjs
//         (wired as `npm run docs:gen:config`)
// =============================================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Directories to scan (relative to repo root). Spec: server/**, bin/**, scripts/**.
const SCAN_DIRS = ['server', 'bin', 'scripts'];

// Only these extensions are treated as JS-ish source for process.env scanning.
// (bin/rohy-update is a shell script — no `process.env` — so it is naturally
//  skipped; we still walk bin/ in case a .mjs/.js helper is added later.)
const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);

// Directories we never descend into.
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'frontend', 'coverage',
    'test-results', '__snapshots__'
]);

const OUTPUT_REL = path.join('docs', 'reference', 'config', 'index.md');
const VALIDATE_ENV_REL = path.join('server', 'config', 'validateEnv.js');
const REGEN_CMD = 'npm run docs:gen:config';

// --- Var name → group classification -----------------------------------------
// Order matters: first matching rule wins. Each rule is [test, group].
// Tests are run against the UPPER-CASE var name.
const GROUP_ORDER = [
    'Core server',
    'Auth/security',
    'Database',
    'Observability',
    'Frontend/CORS',
    'LLM/TTS',
    'Oyon',
    'Retention',
    'Update/deploy',
    'Testing/dev',
    'Uncategorized',
];

function classify(name) {
    const n = name.toUpperCase();

    // Update/deploy — rohy-update / migration-time knobs.
    if (n === 'ROHY_BACKUP_BEFORE_MIGRATE' || n === 'ROHY_NO_AUTO_SEED') {
        return 'Update/deploy';
    }

    // Retention sweep.
    if (n.includes('RETENTION')) return 'Retention';

    // Oyon emotion-capture addon.
    if (n.startsWith('OYON')) return 'Oyon';

    // LLM / TTS providers.
    if (
        n.includes('OPENAI') || n.includes('ANTHROPIC') ||
        n.includes('GOOGLE') || n.includes('TTS') || n.includes('PIPER') ||
        n.includes('TRANSFORMERS')
    ) {
        return 'LLM/TTS';
    }

    // Auth / security / TLS.
    if (
        n.includes('JWT') || n.includes('TLS') ||
        n.endsWith('_KEY') || n.endsWith('_SECRET') || n.endsWith('_TOKEN') ||
        n === 'ALLOW_DEFAULT_USERS' || n === 'ROHY_DISABLE_AUTH_RATE_LIMIT' ||
        n === 'ROHY_TRUST_PROXY' || n.startsWith('ROHY_ADMIN_')
    ) {
        return 'Auth/security';
    }

    // Database.
    if (n.includes('_DB') || n.endsWith('DB') || n === 'ROHY_DB') {
        return 'Database';
    }

    // Frontend / CORS.
    if (n.includes('FRONTEND') || n.includes('CORS') || n.includes('ORIGIN')) {
        return 'Frontend/CORS';
    }

    // Observability — logging / slow query / request timing.
    if (
        n.includes('LOG') || n.includes('SLOW_QUERY') ||
        n.includes('ROUTE_TIMEOUT') || n.includes('SHUTDOWN_GRACE') ||
        n === 'VERBOSE'
    ) {
        return 'Observability';
    }

    // Testing / dev fakes.
    if (n.includes('TEST') || n.includes('FAKE')) return 'Testing/dev';

    // Core server.
    if (
        n === 'NODE_ENV' || n === 'PORT' || n === 'HTTPS_PORT'
    ) {
        return 'Core server';
    }

    return 'Uncategorized';
}

// --- Secret detection ---------------------------------------------------------
function isSecret(name) {
    const n = name.toUpperCase();
    return (
        n === 'JWT_SECRET' ||
        n.endsWith('_KEY') ||
        n.endsWith('_SECRET') ||
        n.endsWith('_TOKEN') ||
        n.endsWith('_PASSWORD') ||
        n.includes('API_KEY')
    );
}

// --- Purpose inference --------------------------------------------------------
// Curated, terse, name-derived purposes. Anything not curated falls back to a
// generic "see source" so we never fabricate behavior.
const PURPOSES = {
    NODE_ENV: 'Runtime mode; `production` tightens defaults and enables prod-only validation.',
    PORT: 'HTTP listen port.',
    HTTPS_PORT: 'HTTPS listen port (used when TLS cert/key are set).',
    JWT_SECRET: 'Secret used to sign/verify auth + audit tokens. Fatal if unset.',
    JWT_EXPIRY: 'Lifetime of issued JWTs.',
    TLS_CERT_PATH: 'Path to TLS certificate; must be paired with `TLS_KEY_PATH`.',
    TLS_KEY_PATH: 'Path to TLS private key; must be paired with `TLS_CERT_PATH`.',
    ALLOW_DEFAULT_USERS: 'Bootstrap-only flag to seed default users on first boot.',
    ROHY_ADMIN_USERNAME: 'Provisions the first admin on first boot (with ROHY_ADMIN_PASSWORD). Applied only while the users table is empty.',
    ROHY_ADMIN_PASSWORD: 'Password for the provisioned first admin. Must satisfy the normal password policy or the seeder refuses it.',
    ROHY_ADMIN_EMAIL: 'Email for the provisioned first admin. Defaults to <username>@rohy.local.',
    ROHY_ADMIN_NAME: 'Display name for the provisioned first admin. Defaults to "System Administrator".',
    ROHY_TRUST_PROXY: 'Express `trust proxy` setting (proxy hop count / IP / preset).',
    ROHY_DISABLE_AUTH_RATE_LIMIT: 'Disables the auth-endpoint rate limiter (dev/test).',
    ROHY_DB: 'Absolute path to the SQLite database file.',
    FRONTEND_URL: 'Public frontend origin; drives CORS allow-list.',
    LOG_LEVEL: 'Server log verbosity.',
    ROHY_LOG_LEVEL: 'Server log verbosity (Rohy-prefixed alias).',
    LOG_FORMAT: 'Access-log output format.',
    ROHY_LOG_SKIP_PATHS: 'Comma-separated request paths excluded from access logging.',
    VERBOSE: 'Extra console diagnostics when truthy.',
    ROHY_SLOW_QUERY_MS: 'Threshold (ms) above which a DB query is logged as slow.',
    ROHY_ROUTE_TIMEOUT_MS: 'Per-route request timeout (ms).',
    ROHY_SHUTDOWN_GRACE_MS: 'Graceful-shutdown drain window (ms).',
    OYON_ENABLED: 'Mounts the Oyon emotion-capture addon as a live router (vs 503 stub).',
    RETENTION_DAYS: 'Data-retention window in days for the retention sweep.',
    RETENTION_SECONDS: 'Data-retention window in seconds (overrides days when set).',
    ROHY_RETENTION_DAYS: 'Data-retention window in days (Rohy-prefixed alias).',
    ROHY_RETENTION_SECONDS: 'Data-retention window in seconds (Rohy-prefixed alias).',
    ROHY_BACKUP_BEFORE_MIGRATE: 'Toggles the pre-migration DB snapshot.',
    ROHY_NO_AUTO_SEED: 'Skips automatic seeders on boot.',
    OPENAI_API_KEY: 'OpenAI API credential (LLM / TTS).',
    ANTHROPIC_API_KEY: 'Anthropic API credential (LLM).',
    GOOGLE_API_KEY: 'Google API credential.',
    GOOGLE_TTS_API_KEY: 'Google Text-to-Speech API credential.',
    PIPER_BIN: 'Path to the Piper TTS binary.',
    TRANSFORMERS_CACHE: 'Persistent cache dir for the Kokoro/transformers model bundle.',
    ROHY_TEST_FAKE_GOOGLE_TTS: 'Test hook: stub Google TTS instead of calling the API.',
    ROHY_TEST_FAKE_OPENAI_TTS: 'Test hook: stub OpenAI TTS instead of calling the API.',
};

function purposeFor(name) {
    return PURPOSES[name.toUpperCase()] || '_see source_';
}

// --- Filesystem walk (sorted, deterministic) ---------------------------------
async function walk(dir) {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    // Sort for deterministic output.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const files = [];
    for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            files.push(...await walk(full));
        } else if (e.isFile()) {
            files.push(full);
        }
    }
    return files;
}

// --- Static scan of one file --------------------------------------------------
// Captures:
//   process.env.NAME
//   process.env['NAME'] / process.env["NAME"]
// and, on the same logical expression, an immediate default via
//   || 'x' | || "x" | || `x` | || 123 | ?? 'x' | ?? 123
const ENV_RE =
    /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g;

// Default-extractor applied to the slice of source starting at the match.
// Non-greedy, single line — only trusts a default that sits right after the
// access on the same line.
function extractDefault(lineText, accessEndCol) {
    const tail = lineText.slice(accessEndCol);
    // Allow optional whitespace, then || or ??, then a literal.
    const m = tail.match(
        /^\s*(?:\|\||\?\?)\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|(-?\d+(?:\.\d+)?)|(true|false))/
    );
    if (!m) return null;
    const val = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    return val === '' ? "'' (empty string)" : val;
}

async function scanFile(file, results) {
    const ext = path.extname(file);
    if (!JS_EXTS.has(ext)) return; // skip shell scripts, JSON, etc.
    // Skip the docs-gen tooling itself: these files contain `process.env.X`
    // shaped strings inside regexes/comments that document the patterns we
    // detect — they are NOT real env usage and would be false positives.
    const relForSkip = path.relative(REPO_ROOT, file);
    if (relForSkip.startsWith(path.join('scripts', 'docs-gen'))) return;
    let text;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch {
        return;
    }
    const rel = path.relative(REPO_ROOT, file);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        ENV_RE.lastIndex = 0;
        let m;
        while ((m = ENV_RE.exec(line)) !== null) {
            const name = m[1] || m[2];
            if (!name) continue;
            const accessEnd = m.index + m[0].length;
            const def = extractDefault(line, accessEnd);
            if (!results.has(name)) {
                results.set(name, { name, sites: [], defaults: new Set() });
            }
            const entry = results.get(name);
            entry.sites.push(`${rel}:${i + 1}`);
            if (def != null) entry.defaults.add(def);
        }
    }
}

// --- Parse validateEnv.js for required-ness ----------------------------------
// We detect a var as REQUIRED when, within validateEnv(), there is a guard of
// the shape `if (!env.NAME) { ... errors.push(...) }`. We also pick up the
// paired-requirement pattern used for TLS_CERT_PATH / TLS_KEY_PATH (both must
// be set together → conditionally required, surfaced as a note).
async function parseValidateEnv() {
    const file = path.join(REPO_ROOT, VALIDATE_ENV_REL);
    const required = new Map(); // NAME -> note string
    const notes = new Map();    // NAME -> array of advisory notes
    let text;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch {
        return { required, notes, found: false };
    }

    // Hard-required: `if (!env.NAME) { errors.push(` (allow whitespace/newlines).
    const hardRe =
        /if\s*\(\s*!\s*env\.([A-Z_][A-Z0-9_]*)\s*\)\s*\{[\s\S]{0,400}?errors\.push/g;
    let m;
    while ((m = hardRe.exec(text)) !== null) {
        required.set(m[1], 'Fatal if unset (validateEnv pushes an error).');
    }

    // Paired requirement: TLS_CERT_PATH + TLS_KEY_PATH must both be set.
    if (/TLS_CERT_PATH[\s\S]{0,200}TLS_KEY_PATH[\s\S]{0,400}errors\.push/.test(text)) {
        for (const k of ['TLS_CERT_PATH', 'TLS_KEY_PATH']) {
            addNote(notes, k, 'Conditionally required: if either of TLS_CERT_PATH / TLS_KEY_PATH is set, both must be.');
        }
    }

    // Prod-warning vars → advisory note (NOT marked required).
    const prodWarnRe =
        /warnings\.push\(\s*\n?\s*['"`]([A-Z_][A-Z0-9_]*) is not set in production/g;
    while ((m = prodWarnRe.exec(text)) !== null) {
        addNote(notes, m[1], 'Recommended in production (validateEnv warns when unset).');
    }
    // FRONTEND_URL / ROHY_DB / TRANSFORMERS_CACHE prod warnings phrased differently.
    if (/FRONTEND_URL is not set in production/.test(text)) {
        addNote(notes, 'FRONTEND_URL', 'Recommended in production (CORS rejects non-localhost origins when unset).');
    }
    if (/ROHY_DB is not set in production/.test(text)) {
        addNote(notes, 'ROHY_DB', 'Recommended in production (DB otherwise lives inside the repo tree).');
    }
    if (/TRANSFORMERS_CACHE is not set/.test(text)) {
        addNote(notes, 'TRANSFORMERS_CACHE', 'Recommended in production (Kokoro model cache otherwise wiped by npm ci).');
    }

    return { required, notes, found: true };
}

function addNote(map, key, note) {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(note)) map.get(key).push(note);
}

// --- VitePress-safe cell escaping --------------------------------------------
// Markdown table cells: escape pipes, and escape angle brackets so VitePress
// (Vue-powered) does not try to parse them as components.
function esc(s) {
    if (s == null) return '—';
    return String(s)
        .replace(/\|/g, '\\|')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r?\n/g, ' ');
}

// Wrap a value as inline code, escaping backticks inside.
function code(s) {
    return '`' + String(s).replace(/`/g, '`') + '`';
}

// --- Main ---------------------------------------------------------------------
async function main() {
    // 1. Collect source files (sorted) across scan dirs.
    const allFiles = [];
    for (const d of SCAN_DIRS) {
        allFiles.push(...await walk(path.join(REPO_ROOT, d)));
    }
    allFiles.sort();

    // 2. Static scan.
    const results = new Map();
    for (const f of allFiles) {
        await scanFile(f, results);
    }

    // 3. Required-ness + notes from validateEnv.js.
    const { required, notes, found } = await parseValidateEnv();

    // Ensure vars only referenced inside validateEnv.js (e.g. via env.X, not
    // process.env.X) still appear if they are required there.
    for (const name of required.keys()) {
        if (!results.has(name)) {
            results.set(name, {
                name,
                sites: [`${VALIDATE_ENV_REL} (validation only)`],
                defaults: new Set(),
            });
        }
    }

    // 4. Build grouped, sorted model.
    const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
    const secrets = [];
    const names = [...results.keys()].sort();
    for (const name of names) {
        const entry = results.get(name);
        const group = classify(name);
        const isReq = required.has(name);
        const secret = isSecret(name);
        if (secret) secrets.push(name);

        // Default: prefer a statically-extracted literal; if multiple distinct
        // defaults were seen, list them; else "—".
        let def = '—';
        const defs = [...entry.defaults].sort();
        if (defs.length === 1) def = code(defs[0]);
        else if (defs.length > 1) def = defs.map(code).join(' / ');

        const sites = [...new Set(entry.sites)].sort();
        const noteList = notes.get(name) || [];

        groups.get(group).push({
            name,
            required: isReq ? 'Yes' : 'No',
            requiredNote: required.get(name) || '',
            def,
            secret,
            purpose: purposeFor(name),
            notes: noteList,
            sites,
        });
    }

    // 5. Emit Markdown.
    const out = [];
    out.push('# Config &amp; environment reference');
    out.push('');
    out.push(
        'Every environment variable Rohy reads, scanned **from source** across ' +
        '`server/**`, `bin/**`, and `scripts/**`, cross-referenced against ' +
        `\`${VALIDATE_ENV_REL}\` for required-ness and recommended-in-production hints.`
    );
    out.push('');
    out.push('::: tip Regenerate');
    out.push(
        `This page is generated. Do not hand-edit. Re-run \`${REGEN_CMD}\` ` +
        'after changing env usage or the validator.'
    );
    out.push(':::');
    out.push('');
    if (!found) {
        out.push('::: warning');
        out.push(
            `Could not read \`${VALIDATE_ENV_REL}\`; required-ness columns may ` +
            'be incomplete.'
        );
        out.push(':::');
        out.push('');
    }

    // Secret warning container.
    if (secrets.length) {
        const uniqSecrets = [...new Set(secrets)].sort();
        out.push('::: warning Security-sensitive variables');
        out.push(
            'The following variables carry credentials or signing material. ' +
            'Never commit them, log them, or expose them to the browser. ' +
            'Store them in the operator env file with restricted permissions:'
        );
        out.push('');
        for (const s of uniqSecrets) out.push(`- \`${s}\``);
        out.push(':::');
        out.push('');
    }

    // One table per non-empty group, in GROUP_ORDER.
    for (const g of GROUP_ORDER) {
        const rows = groups.get(g);
        if (!rows.length) continue;
        out.push(`## ${g}`);
        out.push('');
        out.push('| Variable | Required | Default | Purpose | Source |');
        out.push('| --- | --- | --- | --- | --- |');
        for (const r of rows) {
            // Compose purpose cell: base purpose + any advisory/required notes.
            const purposeParts = [r.purpose];
            if (r.requiredNote) purposeParts.push(`_${r.requiredNote}_`);
            for (const n of r.notes) purposeParts.push(`_${n}_`);
            if (r.secret) {
                purposeParts.push('**⚠ secret — see security note above.**');
            }
            const purposeCell = esc(purposeParts.join(' '));

            // Source cell: up to 3 sites, then a count.
            const shown = r.sites.slice(0, 3).map((s) => code(s));
            let srcCell = shown.join('<br>');
            if (r.sites.length > 3) {
                srcCell += `<br>_+${r.sites.length - 3} more_`;
            }
            srcCell = srcCell || '—';

            out.push(
                `| ${code(r.name)} | ${r.required} | ${r.def} | ` +
                `${purposeCell} | ${srcCell} |`
            );
        }
        out.push('');
    }

    out.push('---');
    out.push('');
    out.push(
        `_${names.length} variables discovered. ` +
        `Generated by \`scripts/docs-gen/gen-config.mjs\` — ` +
        `regenerate with \`${REGEN_CMD}\`._`
    );
    out.push('');

    const outPath = path.join(REPO_ROOT, OUTPUT_REL);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, out.join('\n'), 'utf8');

    // Console summary (deterministic).
    const requiredNames = names.filter((n) => required.has(n)).sort();
    process.stdout.write(
        `[gen-config] ${names.length} env vars → ${OUTPUT_REL}\n` +
        `[gen-config] required: ${requiredNames.join(', ') || '(none)'}\n` +
        `[gen-config] secrets:  ${[...new Set(secrets)].sort().join(', ') || '(none)'}\n`
    );
}

main().catch((err) => {
    process.stderr.write(`[gen-config] failed: ${err?.stack || err}\n`);
    process.exit(1);
});
