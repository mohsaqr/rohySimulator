import { describe, expect, it } from 'vitest';
import { toSqliteUtc, sqliteTsToIso } from '../../server/sqliteTime.js';

// The whole point of these helpers is that the strings produced /
// consumed have to be *bit-for-bit* compatible with SQLite's
// CURRENT_TIMESTAMP rendering. The tests below pin that contract.

describe('toSqliteUtc', () => {
    it('renders millis in the exact format SQLite uses for CURRENT_TIMESTAMP', () => {
        // 2026-05-13T19:20:00.000Z → '2026-05-13 19:20:00'
        const ms = Date.UTC(2026, 4, 13, 19, 20, 0);
        expect(toSqliteUtc(ms)).toBe('2026-05-13 19:20:00');
    });

    it('strips fractional seconds and replaces T with a space', () => {
        const ms = Date.UTC(2026, 0, 1, 0, 0, 0, 123);
        expect(toSqliteUtc(ms)).toBe('2026-01-01 00:00:00');
    });
});

describe('sqliteTsToIso', () => {
    it('converts a SQLite UTC timestamp string to ISO `…Z`', () => {
        expect(sqliteTsToIso('2026-05-13 19:20:00'))
            .toBe('2026-05-13T19:20:00.000Z');
    });

    it('passes through values already in ISO `Z` form', () => {
        const iso = '2026-05-13T19:20:00.000Z';
        expect(sqliteTsToIso(iso)).toBe(iso);
    });

    it('returns null for empty / null / undefined', () => {
        expect(sqliteTsToIso(null)).toBeNull();
        expect(sqliteTsToIso(undefined)).toBeNull();
        expect(sqliteTsToIso('')).toBeNull();
    });

    it('normalises numeric millis via toISOString', () => {
        const ms = Date.UTC(2026, 4, 13, 19, 20, 0);
        expect(sqliteTsToIso(ms)).toBe('2026-05-13T19:20:00.000Z');
    });
});

describe('round-trip: store → compare → emit', () => {
    it('toSqliteUtc output lexicographically compares correctly against CURRENT_TIMESTAMP shape', () => {
        // This is the actual scenario the P1 fix targets: an ETA in
        // the near future must sort AFTER the present moment, and an
        // ETA in the past must sort BEFORE it. The bug was that
        // toISOString() output (with `T`) broke same-day ordering.
        const now = Date.UTC(2026, 4, 13, 19, 20, 0);
        const future = toSqliteUtc(now + 90_000);     // 90 s later
        const past = toSqliteUtc(now - 90_000);       // 90 s earlier
        const nowSqlite = toSqliteUtc(now);
        expect(past < nowSqlite).toBe(true);
        expect(future > nowSqlite).toBe(true);
        // And the symptom check: same-instant, no `T` in either side.
        expect(nowSqlite.includes('T')).toBe(false);
        expect(future.includes('T')).toBe(false);
    });

    it('client receives a value `new Date()` parses as UTC', () => {
        const stored = '2026-05-13 19:20:00';        // what SQLite returns
        const iso = sqliteTsToIso(stored);
        // new Date('YYYY-MM-DDTHH:MM:SS.000Z') parses unambiguously
        // as UTC in every JS engine — that's the whole point.
        expect(new Date(iso).getTime()).toBe(Date.UTC(2026, 4, 13, 19, 20, 0));
    });
});
