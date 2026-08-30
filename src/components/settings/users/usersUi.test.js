// Regression lock for the Users tab's "Last Active" column.
//
// `users.last_login` was written with CURRENT_TIMESTAMP, whose
// "YYYY-MM-DD HH:MM:SS" shape carries no timezone marker although sqlite means
// it as UTC. `Date.parse` reads that shape as LOCAL, so Last Active was stale
// by exactly the viewer's UTC offset — reported from the field as "3 hours
// behind", from a reporter in a UTC+2/+3 zone.
//
// The writer is fixed and migration 0051 normalises stored rows, but these
// renderers must keep reading both shapes: a row can arrive from any
// deployment that has not yet run 0051.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime, formatDate } from './usersUi';

const ISO = '2026-08-30T07:00:00.000Z';
const LEGACY = '2026-08-30 07:00:00';   // the same instant, sqlite's shape

afterEach(() => vi.useRealTimers());

/** Freeze the clock `minutes` after the reference instant. */
function atMinutesAfter(minutes) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(ISO) + minutes * 60_000));
}

describe('relativeTime reads both timestamp shapes as UTC', () => {
    it('gives the legacy shape and the ISO shape the same answer', () => {
        atMinutesAfter(30);
        expect(relativeTime(LEGACY)).toBe(relativeTime(ISO));
        expect(relativeTime(LEGACY)).toBe('30m ago');
    });

    it('does not drift by the viewer UTC offset', () => {
        // The bug, stated directly: a login one minute ago must read as
        // "just now" or "1m ago", never as hours — whatever zone the browser
        // is in. Date.parse(LEGACY) would be off by getTimezoneOffset().
        atMinutesAfter(1);
        expect(relativeTime(LEGACY)).toBe('1m ago');
    });

    it('never reports a future time for a stamp that just happened', () => {
        // West of UTC the naive parse lands in the FUTURE, and the old code
        // clamped negatives to 0 — so a stale login read "just now" instead.
        atMinutesAfter(0);
        expect(relativeTime(LEGACY)).toBe('just now');
    });

    it('returns the em dash for empty and unparseable values', () => {
        expect(relativeTime(null)).toBe('—');
        expect(relativeTime('')).toBe('—');
        expect(relativeTime('not a date')).toBe('—');
    });
});

describe('formatDate reads both shapes', () => {
    it('agrees between the legacy and ISO shapes', () => {
        expect(formatDate(LEGACY)).toBe(formatDate(ISO));
    });

    it('returns the em dash rather than "Invalid Date"', () => {
        expect(formatDate(null)).toBe('—');
        expect(formatDate('nonsense')).toBe('—');
    });
});
