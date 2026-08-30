// The time contract — RPS-1 §17.
//
// Regression lock: `learning_events.timestamp` once held two shapes at the
// same time — the browser's `2026-08-29T12:34:56.789Z` and sqlite's
// `DEFAULT CURRENT_TIMESTAMP` fallback `2026-08-29 12:34:56`. Both are UTC and
// sqlite reads them identically, so the aggregation was fine; ordering and
// browser parsing were not. On the development database 2169 of 3119 rows sat
// in the wrong position under `ORDER BY timestamp`, and every server-stamped
// row rendered at the viewer's UTC offset.
//
// These tests hold the three properties that keep that from coming back:
// the parser normalises, the write paths stamp explicitly, and the migration
// leaves nothing behind.

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ISO_Z_RE, SQL_NOW, sqlIsoZ, nowIso, timeMs, toIsoZ, isIsoZ, compareTime, anchorToServer,
} from '../../server/shared/time.js';
import { createTestDb } from '../utils/seedDb.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the contract shape', () => {
    it('nowIso() produces UTC ISO-8601 with Z and milliseconds', () => {
        const t = nowIso();
        expect(t).toMatch(ISO_Z_RE);
        expect(isIsoZ(t)).toBe(true);
    });

    it('reads the legacy sqlite shape as UTC, not local', () => {
        // The defect in one line: without the Z, V8 parses this as local time.
        expect(timeMs('2026-08-29 23:59:59')).toBe(Date.parse('2026-08-29T23:59:59.000Z'));
        expect(toIsoZ('2026-08-29 23:59:59')).toBe('2026-08-29T23:59:59.000Z');
    });

    it('agrees on the two shapes of the same instant', () => {
        expect(timeMs('2026-06-01 10:00:00')).toBe(timeMs('2026-06-01T10:00:00.000Z'));
        expect(toIsoZ('2026-06-01 10:00:00')).toBe(toIsoZ('2026-06-01T10:00:00.000Z'));
    });

    it('keeps sub-second precision from the legacy shape', () => {
        expect(timeMs('2026-06-01 10:00:00.5')).toBe(Date.parse('2026-06-01T10:00:00.000Z') + 500);
    });

    it('accepts Date and epoch input, and refuses everything else', () => {
        const ms = Date.parse('2026-06-01T10:00:00.000Z');
        expect(timeMs(new Date(ms))).toBe(ms);
        expect(timeMs(ms)).toBe(ms);
        // null rather than NaN, so a bad value cannot become a plausible number
        expect(timeMs('not a date')).toBeNull();
        expect(timeMs(null)).toBeNull();
        expect(timeMs('')).toBeNull();
        expect(timeMs(NaN)).toBeNull();
        expect(toIsoZ('not a date')).toBeNull();
    });

    it('isIsoZ is stricter than parseability', () => {
        // Parseable but NOT conforming — this is what the migration hunts.
        expect(timeMs('2026-08-29 12:00:00')).not.toBeNull();
        expect(isIsoZ('2026-08-29 12:00:00')).toBe(false);
        expect(isIsoZ('2026-08-29T12:00:00Z')).toBe(false);   // no milliseconds
        expect(isIsoZ('2026-08-29T12:00:00.000Z')).toBe(true);
    });

    it('orders mixed shapes chronologically where a string sort does not', () => {
        const later = { timestamp: '2026-08-29 23:59:59', id: 1 };
        const earlier = { timestamp: '2026-08-29T00:00:01.000Z', id: 2 };
        // The bug, stated: a naive string sort puts the LATER row first.
        expect([later.timestamp, earlier.timestamp].sort()[0]).toBe(later.timestamp);
        // The comparator does not.
        expect([later, earlier].sort(compareTime).map((r) => r.id)).toEqual([2, 1]);
    });

    it('sorts unparseable rows last and breaks ties on id', () => {
        const rows = [
            { timestamp: 'nonsense', id: 0 },
            { timestamp: '2026-06-01T10:00:00.000Z', id: 2 },
            { timestamp: '2026-06-01T10:00:00.000Z', id: 1 },
        ];
        expect([...rows].sort(compareTime).map((r) => r.id)).toEqual([1, 2, 0]);
    });
});

describe('anchorToServer — the learner clock is kept, not trusted', () => {
    const received = Date.parse('2026-08-29T12:00:00.000Z');

    it('subtracts the event age from the server receipt', () => {
        expect(anchorToServer(received, 5_000)).toBe('2026-08-29T11:59:55.000Z');
    });

    it('preserves the SPACING between events in one flush', () => {
        // Three events 10s apart, flushed together. Whatever the device clock
        // said, the gaps must survive — that is what time-on-task reads.
        const [a, b, c] = [25_000, 15_000, 5_000].map((o) => timeMs(anchorToServer(received, o)));
        expect(b - a).toBe(10_000);
        expect(c - b).toBe(10_000);
    });

    it('degrades to receipt time rather than throwing on a bad offset', () => {
        const receipt = '2026-08-29T12:00:00.000Z';
        expect(anchorToServer(received, undefined)).toBe(receipt);
        expect(anchorToServer(received, -1)).toBe(receipt);          // clock ran backwards
        expect(anchorToServer(received, 'nonsense')).toBe(receipt);
        expect(anchorToServer(received, 999_999_999)).toBe(receipt); // beyond the cap
    });

    it('always returns the contract shape', () => {
        for (const offset of [0, 1, 5_000, undefined, -1, 'x']) {
            expect(anchorToServer(received, offset)).toMatch(ISO_Z_RE);
        }
    });
});

describe('SQL helpers', () => {
    it('SQL_NOW and sqlIsoZ() emit the same shape sqlite-side', async () => {
        const { get, cleanup } = await createTestDb();
        try {
            const row = await get(`SELECT ${SQL_NOW} AS now, ${sqlIsoZ("'2026-08-29 12:00:00'")} AS norm`);
            expect(row.now).toMatch(ISO_Z_RE);
            expect(row.norm).toBe('2026-08-29T12:00:00.000Z');
        } finally {
            await cleanup();
        }
    });

    it('sqlIsoZ() returns NULL for an unparseable value rather than a wrong one', async () => {
        const { get, cleanup } = await createTestDb();
        try {
            const row = await get(`SELECT ${sqlIsoZ("'not a date'")} AS v`);
            expect(row.v).toBeNull();
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// The enforcement. A column default cannot be changed in sqlite without
// rebuilding the table, so the log tables still DEFAULT to the legacy shape —
// which means the guarantee rests entirely on every INSERT naming its time
// column. That is exactly the kind of rule that decays silently, so it is
// pinned here rather than left to review.
// ---------------------------------------------------------------------------
const TIME_COLUMN = {
    learning_events: 'timestamp',
    interactions: 'timestamp',
    login_logs: 'timestamp',
    settings_logs: 'timestamp',
    emotion_logs: 'timestamp',
    event_log: 'timestamp',
    session_vitals: 'timestamp',
    llm_request_log: 'request_timestamp',
    alarm_events: 'triggered_at',
    scenario_events: 'triggered_at',
    plugin_jobs: 'created_at',
    plugin_assets: 'created_at',
    // Domain tables whose instants reach a screen. Added in v2.9.104: the map
    // held only the LOG tables, so nothing checked the worklist or the MAR, and
    // three INSERTs quietly leaned on `DEFAULT CURRENT_TIMESTAMP` — which
    // writes the legacy shape, and which sqlite cannot be made to change
    // without rebuilding the table.
    investigation_orders: 'ordered_at',
    treatment_orders: 'ordered_at',
};

// (table, column) pairs an UPDATE may set. The INSERT scanner above cannot see
// these at all: `UPDATE users SET last_login = CURRENT_TIMESTAMP` names no
// column list, so it was structurally invisible to the v2.9.93 contract and
// survived it — which is how Last Active stayed wrong by the viewer's UTC
// offset for a further eleven releases.
//
// Curated on purpose rather than banning CURRENT_TIMESTAMP outright: ~40
// `updated_at` / `deleted_at` writes remain, and nothing renders or sorts
// them. A blanket rule would be noise, and noisy rules get disabled.
const UPDATED_TIME_COLUMNS = [
    ['users', 'last_login'],
    ['users', 'locked_until'],
    ['investigation_orders', 'viewed_at'],
    ['treatment_orders', 'administered_at'],
    ['treatment_orders', 'discontinued_at'],
];

/** Every legacy-stamped `UPDATE <table> SET … <col> = CURRENT_TIMESTAMP`. */
function legacyUpdateStamps() {
    const files = execSync(
        `grep -rl --include='*.js' -E "UPDATE[[:space:]]" ${path.join(REPO_ROOT, 'server')} || true`,
        { encoding: 'utf8' }
    ).split('\n').filter(Boolean);

    const found = [];
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const [table, column] of UPDATED_TIME_COLUMNS) {
            // Bounded by ; and ` so a match cannot run past the end of one
            // statement into the next.
            const re = new RegExp(
                `UPDATE\\s+${table}\\s+SET[^;\`]{0,400}?\\b${column}\\s*=\\s*(CURRENT_TIMESTAMP|datetime\\s*\\(\\s*'now')`,
                'gi'
            );
            let m;
            while ((m = re.exec(src)) !== null) {
                found.push({
                    file: path.relative(REPO_ROOT, file),
                    line: src.slice(0, m.index).split('\n').length,
                    table,
                    column,
                });
            }
        }
    }
    return found;
}

/** Every `INSERT INTO <table> ( … )` column list found in server source. */
function insertColumnLists() {
    const files = execSync(
        `grep -rl --include='*.js' -E "INSERT[[:space:]]+INTO" ${path.join(REPO_ROOT, 'server')} || true`,
        { encoding: 'utf8' }
    ).split('\n').filter(Boolean);

    const found = [];
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const [table, column] of Object.entries(TIME_COLUMN)) {
            const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(`, 'g');
            let m;
            while ((m = re.exec(src)) !== null) {
                let i = m.index + m[0].length;
                let depth = 1;
                while (i < src.length && depth > 0) {
                    if (src[i] === '(') depth++;
                    else if (src[i] === ')') depth--;
                    if (depth === 0) break;
                    i++;
                }
                found.push({
                    file: path.relative(REPO_ROOT, file),
                    line: src.slice(0, m.index).split('\n').length,
                    table,
                    column,
                    columns: src.slice(m.index + m[0].length, i),
                });
            }
        }
    }
    return found;
}

describe('write paths stamp explicitly', () => {
    it('finds the inserts it is meant to be checking', () => {
        // A scanner that silently matches nothing passes forever. This is the
        // canary: if the SQL is reshaped past the regex, this fails first.
        expect(insertColumnLists().length).toBeGreaterThan(15);
    });

    it('every INSERT into a log table names its time column', () => {
        const offenders = insertColumnLists()
            .filter(({ columns, column }) => !new RegExp(`\\b${column}\\b`).test(columns))
            .map(({ file, line, table, column }) => `${file}:${line} — INSERT INTO ${table} omits ${column}`);

        expect(offenders, [
            'These inserts fall through to DEFAULT CURRENT_TIMESTAMP, which writes the',
            'legacy shape and reintroduces the mixed-format ordering defect.',
            `Add the column and bind it to \${SQL_NOW} from server/shared/time.js.`,
            '', ...offenders,
        ].join('\n')).toEqual([]);
    });
});

describe('migration 0050 leaves nothing in the legacy shape', () => {
    it('normalises a legacy row and preserves the instant exactly', async () => {
        const { run, get, cleanup } = await createTestDb();
        try {
            // Migrations have already run. Write a legacy-shaped row the way
            // the DEFAULT used to, then prove the contract reads it correctly.
            await run(
                `INSERT INTO learning_events (user_id, verb, object_type, tenant_id, timestamp)
                 VALUES (NULL, 'VIEWED', 'test', 1, '2026-08-29 23:59:59')`
            );
            const row = await get(`SELECT timestamp, ${sqlIsoZ('timestamp')} AS norm FROM learning_events`);
            expect(row.norm).toBe('2026-08-29T23:59:59.000Z');
            // The reformat is not a reinterpretation: sqlite already read the
            // legacy value as this instant.
            const same = await get(
                `SELECT julianday('2026-08-29 23:59:59') = julianday('2026-08-29T23:59:59.000Z') AS eq`
            );
            expect(same.eq).toBe(1);
        } finally {
            await cleanup();
        }
    });

    it('adds client_time to learning_events', async () => {
        const { all, cleanup } = await createTestDb();
        try {
            const cols = await all(`SELECT name FROM pragma_table_info('learning_events')`);
            expect(cols.map((c) => c.name)).toContain('client_time');
        } finally {
            await cleanup();
        }
    });

    it('gives system_audit_log a generated sort key without touching the hashed column', async () => {
        const { run, get, cleanup } = await createTestDb();
        try {
            await run(
                `INSERT INTO system_audit_log (timestamp, action, tenant_id)
                 VALUES ('2026-08-29 23:59:59', 'test', 1)`
            );
            const row = await get(`SELECT timestamp, ts_utc FROM system_audit_log`);
            // The hashed column is byte-for-byte what was written — the audit
            // chain cannot tell a reformat from a forgery, so it is never
            // reformatted.
            expect(row.timestamp).toBe('2026-08-29 23:59:59');
            expect(row.ts_utc).toBe('2026-08-29T23:59:59.000Z');
        } finally {
            await cleanup();
        }
    });

    it('orders correctly by ts_utc where ORDER BY timestamp does not', async () => {
        const { run, all, cleanup } = await createTestDb();
        try {
            await run(`INSERT INTO system_audit_log (timestamp, action, tenant_id) VALUES ('2026-08-29 23:59:59', 'later', 1)`);
            await run(`INSERT INTO system_audit_log (timestamp, action, tenant_id) VALUES ('2026-08-29T00:00:01.000Z', 'earlier', 1)`);
            const byString = await all(`SELECT action FROM system_audit_log ORDER BY timestamp`);
            const byGenerated = await all(`SELECT action FROM system_audit_log ORDER BY ts_utc`);
            // The defect, reproduced...
            expect(byString.map((r) => r.action)).toEqual(['later', 'earlier']);
            // ...and the fix.
            expect(byGenerated.map((r) => r.action)).toEqual(['earlier', 'later']);
        } finally {
            await cleanup();
        }
    });
});


describe('UPDATE paths stamp explicitly too', () => {
    // Regression lock. The v2.9.93 contract scanned INSERT column lists, so an
    // UPDATE was invisible to it by construction — and `UPDATE users SET
    // last_login = CURRENT_TIMESTAMP` sat one line from a passing test suite
    // while the Users tab showed every learner as active hours ago.
    it('no rendered time column is set to a legacy stamp by an UPDATE', () => {
        const offenders = legacyUpdateStamps();
        expect(
            offenders.map((o) => `${o.file}:${o.line} ${o.table}.${o.column}`),
            'use ${SQL_NOW} / sqlNowPlus() — CURRENT_TIMESTAMP writes the legacy shape'
        ).toEqual([]);
    });

    it('the UPDATE scanner can actually see the statements it checks', () => {
        // Same self-check the INSERT scanner carries: a regex that matches
        // nothing passes forever and proves nothing. Feed it a known-bad
        // string and require a hit.
        const probe = "UPDATE users SET failed_login_attempts = 0, last_login = CURRENT_TIMESTAMP WHERE id = ?";
        const re = new RegExp(
            `UPDATE\\s+users\\s+SET[^;\`]{0,400}?\\blast_login\\s*=\\s*(CURRENT_TIMESTAMP|datetime\\s*\\(\\s*'now')`,
            'i'
        );
        expect(re.test(probe)).toBe(true);
    });

    it('leaves soft-delete and updated_at columns alone', () => {
        // Those are not in UPDATED_TIME_COLUMNS and must stay out: nothing
        // renders them, and a rule that fires on them would be turned off.
        const names = UPDATED_TIME_COLUMNS.map(([, c]) => c);
        expect(names).not.toContain('deleted_at');
        expect(names).not.toContain('updated_at');
    });
});

describe('the client reads both shapes while deployments catch up', () => {
    // A row can arrive from any deployment that has not yet run 0051, so every
    // renderer must still accept the legacy shape. `Date.parse` does not: it
    // reads "YYYY-MM-DD HH:MM:SS" as LOCAL although sqlite means UTC.
    it('timeMs reads the legacy shape as UTC, Date.parse does not', () => {
        const legacy = '2026-08-30 07:00:00';
        expect(timeMs(legacy)).toBe(Date.parse('2026-08-30T07:00:00.000Z'));
        // The bug, stated as a test: these differ by the runner's UTC offset.
        const offsetMs = new Date().getTimezoneOffset() * 60_000;
        expect(Date.parse(legacy)).toBe(timeMs(legacy) + offsetMs);
    });

    it('appending Z to an already-ISO value produces an invalid date', () => {
        // What OrdersDrawer did until v2.9.104, and why migration 0050 broke
        // the worklist countdown for every order that predated it.
        expect(Number.isNaN(new Date('2026-08-30T07:00:00.000Z' + 'Z').getTime())).toBe(true);
        expect(timeMs('2026-08-30T07:00:00.000Z')).toBe(Date.parse('2026-08-30T07:00:00.000Z'));
    });
});
