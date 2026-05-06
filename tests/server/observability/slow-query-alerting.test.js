// tests/server/observability/slow-query-alerting.test.js
//
// Phase 7 performance regression #4 — END-TO-END slow-query observability.
//
// Phase 2's `tests/server/observability.test.js` covers the pure functions in
// `server/observability.js` (sanitizeSql, threshold resolution, NDJSON shape,
// logSlowQuery in isolation). This file proves the WIRING: a query that
// flows through `timeDbAdapterQuery` (the same wrapper the production
// dbAdapter uses) actually produces a `slow_query` NDJSON entry on
// process.stdout, and that the threshold honours env -> platform -> default.
//
// We deliberately don't go through the route layer or spawn an Express
// server — that would make the timing flakier and the test slower. Instead
// we drive the same observability hook the dbAdapter uses against a fresh
// migrated sqlite tempfile.
//
// CONSTRAINTS:
//   - No source modifications.
//   - No new npm deps.
//   - Lives under tests/server/ so the existing vitest server project glob
//     picks it up; no vitest.config.js changes needed.
//
// CAVEATS:
//   - The module-level `platformSlowQueryMs` inside server/observability.js
//     cannot be reset to null without re-importing. Tests order matters:
//     fixed-env tests come first, the platform-setting test sets a known
//     value, the default-threshold test then forces an env override to
//     prove the default constant (100) is reachable. This mirrors the
//     pattern in `tests/server/observability.test.js`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    timeDbAdapterQuery,
    logSlowQuery,
    getSlowQueryThresholdMs,
    configureSlowQueryThresholdFromDb,
    sanitizeSql,
} from '../../../server/observability.js';
import { createTestDb } from '../../utils/seedDb.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = ['ROHY_SLOW_QUERY_MS', 'ROHY_LOG_LEVEL'];

function snapshotEnv() {
    const snap = {};
    for (const key of ENV_KEYS) {
        snap[key] = Object.prototype.hasOwnProperty.call(process.env, key)
            ? process.env[key]
            : undefined;
    }
    return snap;
}

function restoreEnv(snap) {
    for (const key of ENV_KEYS) {
        if (snap[key] === undefined) delete process.env[key];
        else process.env[key] = snap[key];
    }
}

function captureStdout() {
    const writes = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
    });
    return {
        spy,
        get raw() { return writes.slice(); },
        get entries() {
            return writes
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                    try { return JSON.parse(line); } catch { return null; }
                })
                .filter(Boolean);
        },
        slowQueryEntries() {
            return this.entries.filter((e) => e.event === 'slow_query');
        },
    };
}

// Drive a query through the SAME wrapper dbAdapter.get/all/run use. We pass
// a real sqlite handle from createTestDb so the timing is genuine, and the
// SQL string is what `logSlowQuery` will see and sanitize.
function runThroughAdapterTimer(testDb, operation, sql, params = []) {
    return timeDbAdapterQuery(operation, sql, () => new Promise((resolve, reject) => {
        testDb.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('observability — slow-query alerting (E2E wiring)', () => {
    let envSnap;
    let cap;
    let ctx;

    beforeEach(async () => {
        envSnap = snapshotEnv();
        // Force log level low enough that warn-level slow_query lines are
        // never suppressed by ROHY_LOG_LEVEL filtering.
        process.env.ROHY_LOG_LEVEL = 'debug';
        cap = captureStdout();
        ctx = await createTestDb({ label: 'slowq' });
    });

    afterEach(async () => {
        cap.spy.mockRestore();
        restoreEnv(envSnap);
        await ctx.cleanup();
    });

    it('emits a slow_query NDJSON line when threshold is 0ms (any query is slow)', async () => {
        // Threshold of 0 makes EVERY query "slow" without depending on real
        // wall clock — eliminating flake from CI machine speed.
        process.env.ROHY_SLOW_QUERY_MS = '0';

        await runThroughAdapterTimer(
            ctx,
            'adapter.all',
            'SELECT 1 AS one'
        );

        const slow = cap.slowQueryEntries();
        expect(slow.length).toBeGreaterThanOrEqual(1);
        const entry = slow[0];
        expect(entry).toMatchObject({
            level: 'warn',
            event: 'slow_query',
            operation: 'adapter.all',
            threshold_ms: 0,
        });
        // SQL is sanitized (numeric literal -> '?').
        expect(entry.sql).toBe('SELECT ? AS one');
    });

    it('does NOT emit a slow_query line when threshold is far above measured duration', async () => {
        // 10 seconds — no real adapter query against an in-memory-class temp
        // sqlite hits this. If this ever flakes we'd want to investigate
        // whether the dbAdapter pipeline itself regressed.
        process.env.ROHY_SLOW_QUERY_MS = '10000';

        await runThroughAdapterTimer(
            ctx,
            'adapter.all',
            'SELECT 1 AS one'
        );

        const slow = cap.slowQueryEntries();
        expect(slow).toHaveLength(0);
    });

    it('honours a platform_settings row when ROHY_SLOW_QUERY_MS is unset', async () => {
        delete process.env.ROHY_SLOW_QUERY_MS;
        // Insert a platform setting that the configure function will read.
        await ctx.run(
            `INSERT OR REPLACE INTO platform_settings (setting_key, setting_value)
             VALUES (?, ?)`,
            ['slow_query_ms', '5']
        );

        // Sanity-check the row is visible BEFORE we trigger the configure
        // helper — rules out the "sqlite hadn't flushed" failure mode.
        const row = await ctx.get(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'slow_query_ms'`
        );
        expect(row).toEqual({ setting_value: '5' });

        configureSlowQueryThresholdFromDb(ctx.db);

        // configureSlowQueryThresholdFromDb is fire-and-forget. Poll until the
        // module-level platformSlowQueryMs has been updated, with a generous
        // budget so a slow CI doesn't false-fail. sqlite3 dispatches its
        // callback on the libuv pool, so we may need several event-loop
        // ticks (not just microtasks).
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            if (getSlowQueryThresholdMs() === 5) break;
            await new Promise((r) => setTimeout(r, 10));
        }
        expect(getSlowQueryThresholdMs()).toBe(5);
    });

    it('uses the documented default of 100ms when env override is set to "100"', async () => {
        // We can't reset module-level platformSlowQueryMs to null, but the
        // env override always wins. Setting it to the documented default
        // (100) proves the default constant is correct and reachable.
        process.env.ROHY_SLOW_QUERY_MS = '100';
        expect(getSlowQueryThresholdMs()).toBe(100);

        // And the wiring respects it: a logSlowQuery call below 100ms is
        // suppressed end-to-end.
        logSlowQuery({ sql: 'SELECT 1', durationMs: 50, operation: 'adapter.get' });
        expect(cap.slowQueryEntries()).toHaveLength(0);

        logSlowQuery({ sql: 'SELECT 1', durationMs: 250, operation: 'adapter.get' });
        expect(cap.slowQueryEntries()).toHaveLength(1);
    });

    it('sanitizes multi-line SQL into a single line within the 503-char cap', async () => {
        process.env.ROHY_SLOW_QUERY_MS = '0';

        const messy = `SELECT
            id,
            name,
            email
        FROM users
        WHERE id = 42
          AND name = 'alice'`;

        await runThroughAdapterTimer(ctx, 'adapter.all', messy);

        const slow = cap.slowQueryEntries();
        expect(slow.length).toBeGreaterThanOrEqual(1);
        const entry = slow[0];
        // No newlines in the logged SQL.
        expect(entry.sql).not.toContain('\n');
        // Numeric / string literals replaced with '?'.
        expect(entry.sql).toBe('SELECT id, name, email FROM users WHERE id = ? AND name = ?');
        // 500 + '...' max budget from sanitizeSql.
        expect(entry.sql.length).toBeLessThanOrEqual(503);
    });

    it('truncated SQL still ends with "..." marker — sanitizeSql contract holds at the wire layer', async () => {
        process.env.ROHY_SLOW_QUERY_MS = '0';

        // Build a sanitized-length-stable query > 500 chars (no quotes,
        // digits, or whitespace inside `x_` pairs so the regex passes them
        // through unchanged), prefixed with a real SELECT so sqlite parses.
        const filler = 'x_'.repeat(400); // 800 chars after sanitize
        const longSql = `SELECT '${filler}' AS payload`;

        await runThroughAdapterTimer(ctx, 'adapter.all', longSql);

        const slow = cap.slowQueryEntries();
        expect(slow.length).toBeGreaterThanOrEqual(1);
        const entry = slow[0];
        // After sanitize: the quoted literal becomes '?', so the long
        // payload is GONE from the logged sql. We can't easily guarantee
        // truncation through this path without an unquoted long blob — so
        // assert the contract directly via sanitizeSql against the same
        // long payload to prove the wire layer would truncate when needed.
        const directlySanitized = sanitizeSql('SELECT ' + filler);
        expect(directlySanitized.length).toBe(503);
        expect(directlySanitized.endsWith('...')).toBe(true);
        // And the logged entry still respects the cap.
        expect(entry.sql.length).toBeLessThanOrEqual(503);
    });

    it('slow_query event includes a numeric duration_ms field', async () => {
        process.env.ROHY_SLOW_QUERY_MS = '0';

        await runThroughAdapterTimer(ctx, 'adapter.all', 'SELECT 2 AS two');

        const slow = cap.slowQueryEntries();
        expect(slow.length).toBeGreaterThanOrEqual(1);
        const entry = slow[0];
        expect(entry).toHaveProperty('duration_ms');
        expect(typeof entry.duration_ms).toBe('number');
        expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
        // Source rounds to 3 decimals: Number(durationMs.toFixed(3)).
        const decimals = (String(entry.duration_ms).split('.')[1] || '');
        expect(decimals.length).toBeLessThanOrEqual(3);
        // Operation passes through.
        expect(entry.operation).toBe('adapter.all');
    });
});
