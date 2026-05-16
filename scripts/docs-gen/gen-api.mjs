#!/usr/bin/env node
// =============================================================================
// gen-api.mjs — deterministic, re-runnable API reference generator
// -----------------------------------------------------------------------------
// Single-sourcing rule: the API reference is generated FROM SOURCE. There is no
// hand-written endpoint list anywhere. Stage 7 CI re-runs this and diffs the
// output to detect drift, so the generator must be:
//   * deterministic   — same source in, byte-identical artifacts out
//                        (stable ordering, no timestamps, sorted keys)
//   * side-effect free — never starts the server, never touches the DB
//   * static-only      — pure text/regex scanning of server/routes/*.js
//
// It emits:
//   docs/reference/api/openapi.json   — OpenAPI 3.1 document
//   docs/reference/api/index.md       — overview / auth model / how-to-regen
//   docs/reference/api/<area>.md      — one table page per router area
//
// ESM only. No external deps.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ROUTES_DIR = join(REPO_ROOT, 'server', 'routes');
const ROUTES_COMPOSER = join(REPO_ROOT, 'server', 'routes.js');
const OUT_DIR = join(REPO_ROOT, 'docs', 'reference', 'api');

// The whole route group is mounted under /api by server/server.js. Routers are
// then composed in server/routes.js: most via `router.use(xRoutes)` (no prefix,
// so the path literals already carry their area segment), a few via
// `router.use('/prefix', xRoutes)`.
const API_BASE = '/api';

// Auth middleware identifiers we recognise when they appear as arguments on a
// route registration line. authenticateToken is the JWT-extracting middleware;
// requireAuth/requireRole/requireX are the authorization gates.
const AUTH_TOKENS = [
  'authenticateToken',
  'requireAuth',
  'requireAdmin',
  'requireEducator',
  'requireReviewer',
  'requireStudent',
  'requireRole',
  'requireSameTenant',
];

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

// -----------------------------------------------------------------------------
// Step 1 — resolve mount prefixes from server/routes.js
// -----------------------------------------------------------------------------
// We map an imported router *variable name* to its source file via the import
// statements, then read the router.use(...) lines to learn each router's mount
// prefix. A bare `router.use(varName)` means no prefix (path literals are
// already fully-qualified within /api). `router.use('/p', varName)` prefixes
// every path in that router with `/p`.
function resolveMounts() {
  const src = readFileSync(ROUTES_COMPOSER, 'utf8');

  // import xRoutes from './routes/x-routes.js';
  const importRe = /import\s+(\w+)\s+from\s+['"]\.\/routes\/([\w.-]+\.js)['"]/g;
  const varToFile = new Map();
  for (const m of src.matchAll(importRe)) {
    varToFile.set(m[1], m[2]);
  }

  // Dynamic import for Oyon: (await import('./routes/oyon-routes.js')).default
  const dynRe = /import\(['"]\.\/routes\/([\w.-]+\.js)['"]\)/g;
  for (const m of src.matchAll(dynRe)) {
    varToFile.set('oyonRoutes', m[1]);
  }

  // router.use('/prefix', varName)  OR  router.use(varName)
  const useRe = /router\.use\(\s*(?:(['"])([^'"]+)\1\s*,\s*)?(\w+)\s*\)/g;
  const fileToPrefix = new Map();
  for (const m of src.matchAll(useRe)) {
    const prefix = m[2] || '';
    const varName = m[3];
    const file = varToFile.get(varName);
    if (file) fileToPrefix.set(file, prefix);
  }

  return { varToFile, fileToPrefix };
}

// -----------------------------------------------------------------------------
// Step 2 — scan each route file for route registrations
// -----------------------------------------------------------------------------
// Line-oriented regex. Express route calls in this codebase always have the
// method and path literal on the same physical line, e.g.:
//   router.post('/cohorts/:id/members', authenticateToken, requireEducator, ...
// We capture the method, the path, and the remainder of the line (the argument
// list) to detect auth middleware. Lines that are commented out (the legacy
// allowlist manifest block in routes.js, or any `// router.get(...)`) are
// skipped because we only scan server/routes/*.js, never routes.js itself, and
// we still guard against a leading `//` for safety.
function scanRouteFile(filePath, prefix) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const routeRe = new RegExp(
    `^\\s*router\\.(${HTTP_METHODS.join('|')})\\(\\s*(['"\`])([^'"\`]+)\\2\\s*(.*)$`,
  );
  const endpoints = [];

  lines.forEach((rawLine, idx) => {
    // Strip nothing — but bail on commented-out registrations.
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    const m = rawLine.match(routeRe);
    if (!m) return;

    const method = m[1].toUpperCase();
    const routePath = m[3];
    const rest = m[4] || '';

    // Auth detection: look for known middleware tokens in the remainder of the
    // registration line (the arguments before the handler). requireRole(...) is
    // captured with its argument so the docs show e.g. requireRole(3).
    const auth = [];
    for (const tok of AUTH_TOKENS) {
      if (tok === 'requireRole') {
        const rr = rest.match(/requireRole\(([^)]*)\)/);
        if (rr) auth.push(`requireRole(${rr[1].trim()})`);
      } else if (tok === 'requireSameTenant') {
        if (/\brequireSameTenant\s*\(/.test(rest)) auth.push('requireSameTenant');
      } else {
        // word-boundary match so requireAuth doesn't match requireAuthFoo
        if (new RegExp(`\\b${tok}\\b`).test(rest)) auth.push(tok);
      }
    }

    const fullPath = `${API_BASE}${prefix}${routePath}`.replace(/\/{2,}/g, '/');

    endpoints.push({
      method,
      path: fullPath,
      routePath, // path within the router (used for summaries)
      sourceFile: `server/routes/${basename(filePath)}`,
      sourceLine: idx + 1,
      auth, // array; empty means public / no middleware on the line
    });
  });

  return endpoints;
}

// -----------------------------------------------------------------------------
// Step 3 — helpers for naming / summaries / VitePress-safe markdown
// -----------------------------------------------------------------------------

// Area name from a route file: 'cohorts-routes.js' -> 'cohorts',
// 'catalogue.js' -> 'catalogue'.
function areaName(file) {
  return basename(file).replace(/-routes\.js$/, '').replace(/\.js$/, '');
}

// Mechanical operation summary derived from method + path. Not prose-rich by
// design — the goal is a stable, generated label, not documentation copy.
function summarize(method, fullPath) {
  const verbMap = {
    GET: 'Get', POST: 'Create', PUT: 'Replace',
    PATCH: 'Update', DELETE: 'Delete', ALL: 'Any-method',
  };
  const verb = verbMap[method] || method;
  // strip /api, collapse params to readable nouns
  const tail = fullPath.replace(/^\/api/, '') || '/';
  return `${verb} ${tail}`;
}

// VitePress compiles markdown through the Vue SFC compiler, so any literal
// `<word>` is parsed as an HTML/Vue tag and a raw `|` inside a table cell
// breaks the row. Wrap the cell content in backticks (inline code is left
// verbatim by the compiler) and HTML-escape the angle brackets / pipe as a
// belt-and-braces measure for code that some renderers still parse.
function mdCell(text) {
  const escaped = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;');
  return `\`${escaped}\``;
}

// Plain (non-code) inline text that may still contain angle brackets/pipes.
function mdText(text) {
  return String(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;');
}

// -----------------------------------------------------------------------------
// Step 4 — build artifacts
// -----------------------------------------------------------------------------

function buildOpenApi(byArea) {
  const paths = {};

  // Stable iteration: areas sorted, endpoints sorted by path then method.
  const areas = [...byArea.keys()].sort();
  for (const area of areas) {
    const eps = [...byArea.get(area)].sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
    for (const ep of eps) {
      // OpenAPI path templating: Express ':id' -> '{id}'.
      const oaPath = ep.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      if (!paths[oaPath]) paths[oaPath] = {};

      const op = {
        summary: summarize(ep.method, ep.path),
        tags: [area],
        responses: {
          200: { description: 'Success' },
          400: { description: 'Validation error (envelope via server/redaction.js)' },
          401: { description: 'Authentication required' },
          403: { description: 'Insufficient role' },
        },
        'x-rohy-source': `${ep.sourceFile}:${ep.sourceLine}`,
        'x-rohy-auth': ep.auth.length ? ep.auth : ['public'],
      };

      // A route with any auth middleware requires either bearer or cookie auth.
      if (ep.auth.length) {
        op.security = [{ bearerAuth: [] }, { cookieAuth: [] }];
      } else {
        op.security = [];
      }

      // 'all' is not a valid OpenAPI operation key; expand to the common verbs.
      const methodKey = ep.method.toLowerCase();
      if (methodKey === 'all') {
        for (const mk of ['get', 'post', 'put', 'patch', 'delete']) {
          paths[oaPath][mk] = { ...op, summary: `${op.summary} (any method)` };
        }
      } else {
        paths[oaPath][methodKey] = op;
      }
    }
  }

  // Sort the top-level paths object for deterministic output.
  const sortedPaths = {};
  for (const k of Object.keys(paths).sort()) sortedPaths[k] = paths[k];

  return {
    openapi: '3.1.0',
    info: {
      title: 'Rohy API',
      version: '1.0.0',
      description:
        'Auto-generated from server/routes/*.js by scripts/docs-gen/gen-api.mjs. ' +
        'Do not hand-edit. Regenerate with `npm run docs:gen:api`.',
    },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT in Authorization: Bearer <token>.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
          description:
            'HttpOnly JWT cookie. State-changing cookie-authenticated ' +
            'requests also require the X-CSRF-Token header.',
        },
      },
    },
    paths: sortedPaths,
  };
}

function buildIndexMd(byArea, totalEndpoints, unresolved) {
  const areas = [...byArea.keys()].sort();
  const rows = areas
    .map((a) => `| [${mdText(a)}](./${a}.md) | ${byArea.get(a).length} |`)
    .join('\n');

  return `# API Reference

> **Generated file — do not hand-edit.** This page and its sibling
> \`<area>.md\` pages plus \`openapi.json\` are produced from
> \`server/routes/*.js\` by \`scripts/docs-gen/gen-api.mjs\` (single-sourcing
> rule: there is no hand-written endpoint list). Regenerate with:
>
> \`\`\`bash
> npm run docs:gen:api
> \`\`\`

## Overview

- **Routers:** ${areas.length}
- **Endpoints:** ${totalEndpoints}
- **Base path:** all endpoints are mounted under \`/api\`.
- **Machine-readable spec:** [\`openapi.json\`](./openapi.json) (OpenAPI 3.1).
  Each operation carries an \`x-rohy-source\` extension pointing at the exact
  \`file:line\` it was scanned from.

## Router areas

| Area | Endpoints |
|------|-----------|
${rows}

## Authentication & authorization model

Roles are **rank-ordered**; routes gate on a minimum rank, never on string
equality:

| Role | Rank |
|------|------|
| ${mdText('guest')} | 0 |
| ${mdText('student')} | 1 |
| ${mdText('reviewer')} | 2 |
| ${mdText('educator')} | 3 |
| ${mdText('admin')} | 4 |

(\`user\` is a legacy alias normalised to \`student\`. Source of truth:
\`server/middleware/auth.js\` — \`ROLE_RANKS\`.)

- **Token transport:** a JWT is accepted either via the
  \`Authorization: Bearer <token>\` header **or** an HttpOnly cookie.
- **CSRF:** cookie-authenticated, state-changing requests
  (\`POST\`/\`PUT\`/\`PATCH\`/\`DELETE\`) must additionally send the
  \`X-CSRF-Token\` header. Bearer-header requests are exempt.
- **Immediate revocation:** the \`active_sessions\` table backs logout and
  password-change so a revoked token stops working immediately rather than at
  natural JWT expiry.
- **Middleware vocabulary** (what the *Auth* column in each area page shows):
  - \`authenticateToken\` — extracts/validates the JWT, populates \`req.user\`.
  - \`requireAuth\` — any authenticated user.
  - \`requireStudent\` / \`requireReviewer\` / \`requireEducator\` /
    \`requireAdmin\` — minimum-rank gates (rank 1 / 2 / 3 / 4).
  - \`requireRole(n)\` — explicit minimum rank.
  - \`requireSameTenant\` — tenant-isolation gate.
  - *(empty)* — no auth middleware on the registration line (public, or auth
    applied at router level).

## Error envelope & PII

Error responses and personally-identifiable fields are normalised centrally by
\`server/redaction.js\` before any response leaves the server. See the
[security / redaction policy](../../security/) for the field allowlist; do not
infer the wire shape from individual handlers.
${
  unresolved.length
    ? `\n## Unresolved mounts\n\nThe following route files could not have their mount prefix resolved from ` +
      `\`server/routes.js\`; their endpoints fall back to the file's area name ` +
      `and may be missing a prefix segment:\n\n` +
      unresolved.map((u) => `- \`${mdText(u)}\``).join('\n') +
      '\n'
    : ''
}`;
}

function buildAreaMd(area, endpoints) {
  const sorted = [...endpoints].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  const rows = sorted
    .map((ep) => {
      const auth = ep.auth.length ? ep.auth.join(', ') : '(none)';
      const src = `${ep.sourceFile}:${ep.sourceLine}`;
      return `| ${mdCell(ep.method)} | ${mdCell(ep.path)} | ${mdCell(auth)} | ${mdCell(src)} |`;
    })
    .join('\n');

  return `# ${mdText(area)} API

> **Generated file — do not hand-edit.** Produced from \`server/routes/*.js\`
> by \`scripts/docs-gen/gen-api.mjs\`. Regenerate with \`npm run docs:gen:api\`.

${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}. All paths are
relative to the \`/api\` base. See the [API index](./index.md) for the auth
model.

| Method | Path | Auth | Source |
|--------|------|------|--------|
${rows}
`;
}

// -----------------------------------------------------------------------------
// Step 5 — orchestrate
// -----------------------------------------------------------------------------

function main() {
  const { fileToPrefix } = resolveMounts();

  const routeFiles = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();

  const byArea = new Map();
  const unresolved = [];
  let total = 0;

  for (const file of routeFiles) {
    const full = join(ROUTES_DIR, file);
    const resolved = fileToPrefix.has(file);
    // Not mounted from routes.js (or could not be resolved). Fall back to no
    // prefix. oyon-routes.js IS resolved (dynamic import). Helper modules in
    // server/routes/ that register no routes are silently ignored.
    const prefix = resolved ? fileToPrefix.get(file) : '';

    const eps = scanRouteFile(full, prefix);
    if (eps.length === 0) continue;

    // Only flag a mount as unresolved if the file actually has endpoints whose
    // prefix we therefore had to guess.
    if (!resolved) unresolved.push(file);

    const area = areaName(file);
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(...eps);
    total += eps.length;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // OpenAPI — pretty-printed with a trailing newline for stable diffs.
  const openapi = buildOpenApi(byArea);
  writeFileSync(
    join(OUT_DIR, 'openapi.json'),
    JSON.stringify(openapi, null, 2) + '\n',
  );

  // index.md
  writeFileSync(
    join(OUT_DIR, 'index.md'),
    buildIndexMd(byArea, total, unresolved),
  );

  // one page per area
  for (const [area, eps] of byArea) {
    writeFileSync(join(OUT_DIR, `${area}.md`), buildAreaMd(area, eps));
  }

  // stdout summary
  const areaCount = byArea.size;
  console.log(`[gen-api] routers: ${areaCount}`);
  console.log(`[gen-api] endpoints: ${total}`);
  if (unresolved.length) {
    console.log(
      `[gen-api] unresolved mounts (fell back to file area): ${unresolved.join(', ')}`,
    );
  } else {
    console.log('[gen-api] all mounts resolved');
  }
  console.log(`[gen-api] output: docs/reference/api/ (openapi.json + ${areaCount + 1} md pages)`);
}

main();
