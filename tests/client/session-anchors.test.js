// Tests for src/utils/sessionAnchors.js — the wall-clock anchoring that
// keeps the session clock and scenario timeline alive across the remounts
// caused by room switching, and across page refreshes.
//
// Regression lock: the session clock and scenario time used to be plain
// useState counters inside PatientMonitor; every room switch unmounted the
// component and replayed the vitals trajectory from t=0 (bug report
// 2.9.15 #14). Anchors derive time from timestamps so a remount resumes at
// the true position.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    parseUtcTimestamp,
    readScenarioAnchor,
    writeScenarioAnchor,
    anchorSeconds,
    SCENARIO_ANCHOR_KEY,
    PAUSE_ANCHOR_KEY,
    readPauseAnchor,
    writePauseAnchor,
    isAnchorPaused,
    pausedMs,
    togglePauseAnchor,
} from '../../src/utils/sessionAnchors.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('parseUtcTimestamp', () => {
    it('parses a bare SQLite timestamp as UTC, not local time', () => {
        // SQLite CURRENT_TIMESTAMP emits 'YYYY-MM-DD HH:MM:SS' with no zone.
        expect(parseUtcTimestamp('2026-08-08 10:00:00')).toBe(Date.parse('2026-08-08T10:00:00Z'));
    });

    it('leaves already-zoned strings alone', () => {
        expect(parseUtcTimestamp('2026-08-08T10:00:00Z')).toBe(Date.parse('2026-08-08T10:00:00Z'));
        expect(parseUtcTimestamp('2026-08-08T12:00:00+02:00')).toBe(Date.parse('2026-08-08T10:00:00Z'));
    });

    it('returns null for empty or unparseable input', () => {
        expect(parseUtcTimestamp(null)).toBeNull();
        expect(parseUtcTimestamp('')).toBeNull();
        expect(parseUtcTimestamp('not a date')).toBeNull();
    });
});

describe('scenario anchor persistence', () => {
    const anchor = { sessionId: 42, scenarioId: 'case_7', startMs: 1000, offsetSec: 0, playing: true };

    it('round-trips an anchor for the owning session', () => {
        writeScenarioAnchor(anchor);
        expect(readScenarioAnchor(42)).toEqual(anchor);
    });

    it('refuses an anchor that belongs to a different session', () => {
        writeScenarioAnchor(anchor);
        expect(readScenarioAnchor(43)).toBeNull();
        expect(readScenarioAnchor(null)).toBeNull();
    });

    it('clears the stored anchor when passed null', () => {
        writeScenarioAnchor(anchor);
        writeScenarioAnchor(null);
        expect(readScenarioAnchor(42)).toBeNull();
    });

    it('survives a corrupt stored value', () => {
        localStorage.setItem(SCENARIO_ANCHOR_KEY, '{not json');
        expect(readScenarioAnchor(42)).toBeNull();
    });
});

describe('anchorSeconds', () => {
    it('flows with wall-clock time while playing', () => {
        vi.spyOn(Date, 'now').mockReturnValue(90_000);
        expect(anchorSeconds({ startMs: 60_000, offsetSec: 5, playing: true })).toBe(35);
    });

    it('holds at offsetSec while paused', () => {
        vi.spyOn(Date, 'now').mockReturnValue(999_999_999);
        expect(anchorSeconds({ startMs: 60_000, offsetSec: 17, playing: false })).toBe(17);
    });

    it('resumes from the pause position, not from zero', () => {
        // pause at 17s, resume 100s later: time should continue from 17.
        const resumed = { startMs: 200_000, offsetSec: 17, playing: true };
        vi.spyOn(Date, 'now').mockReturnValue(210_000);
        expect(anchorSeconds(resumed)).toBe(27);
    });
});

// Regression lock (QA-0021, external pilot, v2.9.140): "when pausing a
// simulation in the patient monitor, if you open another room and then go back
// to the patient room, the simulation is not in pause anymore and the timer
// shows the exact time". Pause was a bare useState inside PatientMonitor, which
// App.jsx unmounts on every room switch, and it gated only the waveform draw —
// the case clock counted real time straight through a pause.
describe('pause anchor', () => {
    it('holds the paused total steady while paused', () => {
        const paused = togglePauseAnchor(null, 7, 1_000);
        expect(isAnchorPaused(paused)).toBe(true);
        expect(pausedMs(paused, 3_000)).toBe(2_000);
        expect(pausedMs(paused, 5_000)).toBe(4_000);
    });

    it('banks each pause so the subtraction is cumulative', () => {
        let anchor = togglePauseAnchor(null, 7, 1_000);
        anchor = togglePauseAnchor(anchor, 7, 3_000);   // 2s banked
        expect(isAnchorPaused(anchor)).toBe(false);
        expect(pausedMs(anchor, 9_999)).toBe(2_000);    // running: total holds

        anchor = togglePauseAnchor(anchor, 7, 10_000);
        anchor = togglePauseAnchor(anchor, 7, 10_500);  // +0.5s
        expect(pausedMs(anchor, 99_999)).toBe(2_500);
    });

    it('survives the remount a room switch causes', () => {
        writePauseAnchor(togglePauseAnchor(null, 42, 1_000));
        // What a fresh mount of PatientMonitor sees.
        const restored = readPauseAnchor(42);
        expect(isAnchorPaused(restored)).toBe(true);
    });

    it('belongs to one session — a new session starts running', () => {
        writePauseAnchor(togglePauseAnchor(null, 42, 1_000));
        expect(readPauseAnchor(43)).toBeNull();
        expect(isAnchorPaused(readPauseAnchor(43))).toBe(false);
    });

    it('records that this pause is the one that froze the scenario', () => {
        const paused = togglePauseAnchor(null, 7, 1_000, true);
        expect(paused.resumeScenario).toBe(true);
        // Resuming clears it, so a trajectory the educator paused by hand is
        // not restarted by the next press of the header button.
        expect(togglePauseAnchor(paused, 7, 2_000).resumeScenario).toBe(false);
    });

    it('reads a malformed or absent anchor as running', () => {
        expect(pausedMs(null, 1_000)).toBe(0);
        expect(pausedMs({ sessionId: 1, pausedAtMs: null }, 1_000)).toBe(0);
        localStorage.setItem(PAUSE_ANCHOR_KEY, '{not json');
        expect(readPauseAnchor(1)).toBeNull();
    });
});
