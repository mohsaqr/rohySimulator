// Shared plumbing for the knowledge base: the sqlite handle, and the one rule
// that turns a file path into a module.
//
// `sqlite3` rather than `node:sqlite` on purpose: it is already a dependency of
// this repo, and `node:sqlite` is still experimental on the Node 22 that CI
// pins — a build tool that prints an ExperimentalWarning on every run trains
// people to ignore warnings.

import sqlite3 from 'sqlite3';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Overridable so a test — or a scratch build — never clobbers the real file.
export const DB_PATH = process.env.ROHY_KB_DB || join(REPO_ROOT, 'data', 'knowledge.db');
export const SCHEMA_PATH = join(REPO_ROOT, 'scripts', 'knowledge', 'schema.sql');

/**
 * Path prefix → module. **Order matters**: the first match wins, so the most
 * specific prefixes come first.
 *
 * Derived from prefixes rather than declared per-file so that adding a route
 * or a component needs no edit here. Anything unmatched becomes 'other', and
 * `npm run kb -- modules` reports how much lands there — a growing 'other' is
 * the signal that this list needs a row, not that the classifier is broken.
 */
export const MODULES = [
    ['server/plugins/',            'plugin:server',    'plugin',     'Plugin server slots'],
    ['src/plugins/',               'plugin:adapter',   'plugin',     'Plugin adapters (RPS-1)'],
    ['src/components/pathology/',  'plugin:pathology', 'plugin',     'Pathology (vendored)'],
    ['src/components/pacs/',       'plugin:pacs',      'plugin',     'PACS (vendored)'],
    ['server/shared/',             'shared',           'shared',     'Shared client+server code'],
    ['server/routes/',             'server:routes',    'server',     'API routes'],
    ['server/services/',           'server:services',  'server',     'Providers (LLM, TTS, catalogues)'],
    ['server/lib/',                'server:lib',       'server',     'Server libraries'],
    ['server/middleware/',         'server:auth',      'server',     'Auth and middleware'],
    ['server/seeders/',            'server:seeders',   'server',     'Seed data'],
    ['server/',                    'server:core',      'server',     'Server core (boot, db, logging)'],
    ['migrations/',                'migrations',       'migrations', 'Database migrations'],
    ['src/components/analytics/',  'client:analytics', 'client',     'Analytics and TNA'],
    ['src/components/lessons/',    'client:lessons',   'client',     'Lessons (vendored)'],
    ['src/components/oyon/',       'client:oyon',      'client',     'Affect capture (Oyon)'],
    ['src/components/settings/',   'client:settings',  'client',     'Settings and admin'],
    ['src/components/chat/',       'client:chat',      'client',     'Chat and voice'],
    ['src/components/',            'client:ui',        'client',     'Rooms and UI'],
    ['src/notifications/',         'client:notify',    'client',     'Notification center'],
    ['src/services/',              'client:services',  'client',     'Client services'],
    ['src/locales/',               'i18n',             'client',     'Translation catalogues'],
    ['src/',                       'client:core',      'client',     'Client core (App, contexts)'],
    ['tests/',                     'tests',            'tests',      'Test suites'],
    ['docs/',                      'docs',             'docs',       'Documentation'],
    ['scripts/',                   'build:scripts',    'build',      'Tooling and generators'],
    ['bin/',                       'build:cli',        'build',      'Operator CLI'],
    ['.github/',                   'build:ci',         'build',      'CI workflows'],
    ['Dockerfile',                 'repo:meta',        'other',      'Repo metadata (package, Docker, changelog)'],
    ['package',                    'repo:meta',        'other',      'Repo metadata (package, Docker, changelog)'],
    ['CHANGELOG',                  'repo:meta',        'other',      'Repo metadata (package, Docker, changelog)'],
    ['README',                     'repo:meta',        'other',      'Repo metadata (package, Docker, changelog)'],
];

/**
 * The module a path belongs to.
 *
 * @param {string} path repo-relative
 * @returns {string} a module id, or 'other'
 */
export function moduleOf(path) {
    const hit = MODULES.find(([prefix]) => path.startsWith(prefix));
    return hit ? hit[1] : 'other';
}

/**
 * Every distinct module a set of paths touches, sorted for stable output.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export function modulesOf(paths) {
    return [...new Set((paths ?? []).map(moduleOf))].sort();
}

/**
 * basename → module, learned from every path git has ever seen.
 *
 * Prose does not cite full paths. A triage report says `orders-routes.js:1745`
 * and a learning says `TreatmentPanel.jsx`, so classifying those strings
 * directly sends almost every citation to 'other' — which is exactly what
 * happened: 17 of 41 bugs and 99 of 318 learnings landed there while the
 * modules they were plainly about showed zero.
 *
 * A basename can be ambiguous (several `index.js`). When it is, the most
 * frequently seen module wins, and ties break alphabetically so the result is
 * deterministic across rebuilds.
 *
 * @param {string[]} paths every repo-relative path known to history
 * @returns {Map<string, string>} basename → module id
 */
export function buildBasenameIndex(paths) {
    const tally = new Map();
    for (const path of paths) {
        const base = path.split('/').pop();
        if (!base) continue;
        const mod = moduleOf(path);
        if (mod === 'other') continue;
        let counts = tally.get(base);
        if (!counts) { counts = new Map(); tally.set(base, counts); }
        counts.set(mod, (counts.get(mod) ?? 0) + 1);
    }
    const out = new Map();
    for (const [base, counts] of tally) {
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        out.set(base, best[0]);
    }
    return out;
}

/**
 * Modules for a set of prose citations, resolving bare basenames through the
 * index when one is supplied.
 *
 * @param {string[]} refs  `path[:line]` strings from extractRefs()
 * @param {Map<string,string>} [index] from buildBasenameIndex()
 * @returns {string[]}
 */
export function modulesOfRefs(refs, index) {
    const mods = (refs ?? []).map((ref) => {
        const path = ref.split(':')[0];
        const direct = moduleOf(path);
        if (direct !== 'other') return direct;
        return index?.get(path.split('/').pop()) ?? 'other';
    });
    return [...new Set(mods)].sort();
}

/**
 * `file.js:123` references inside a body of prose.
 *
 * Triage reports and learnings cite code this way constantly, and pulling the
 * citations out is what lets "what do we know about orders-routes.js" be a
 * query rather than a full-text guess.
 *
 * @param {string} text
 * @returns {string[]} unique `path:line` strings, sorted
 */
export function extractRefs(text) {
    const re = /\b([A-Za-z0-9_./-]+\.(?:js|jsx|mjs|sql|json|md|sh|yml))(?::(\d+(?:-\d+)?))?\b/g;
    const out = new Set();
    for (const m of text.matchAll(re)) {
        // A bare word ending in .md inside prose ("see CHANGELOG.md") is a
        // reference too, but a version like "2.9.15" is not — the extension
        // list above already excludes it.
        out.add(m[2] ? `${m[1]}:${m[2]}` : m[1]);
    }
    return [...out].sort();
}

/** Open the knowledge DB with promise-shaped helpers. */
export function open(dbPath = DB_PATH) {
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(dbPath);
    const run = (sql, params = []) => new Promise((res, rej) =>
        db.run(sql, params, function done(err) { err ? rej(err) : res(this); }));
    const all = (sql, params = []) => new Promise((res, rej) =>
        db.all(sql, params, (err, rows) => err ? rej(err) : res(rows ?? [])));
    const get = (sql, params = []) => new Promise((res, rej) =>
        db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
    const exec = (sql) => new Promise((res, rej) =>
        db.exec(sql, (err) => err ? rej(err) : res()));
    const close = () => new Promise((res) => db.close(() => res()));
    return { db, run, all, get, exec, close };
}
