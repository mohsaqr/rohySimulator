import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    ensureStudentPresenceListener,
    getStudentGaze,
    requestAvatarGlance,
    getGlanceOverride,
    faceGazeAngles,
    _resetStudentPresenceForTests,
} from './studentPresence.js';

let nowMs;
function emitAt(t, cx, cy) {
    nowMs = t;
    document.dispatchEvent(new CustomEvent('oyon:sample', {
        detail: { face: { x: cx - 0.1, y: cy - 0.1, width: 0.2, height: 0.2 } },
        bubbles: true,
    }));
}

describe('studentPresence', () => {
    beforeEach(() => {
        nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        _resetStudentPresenceForTests();
        ensureStudentPresenceListener();
    });
    afterEach(() => {
        _resetStudentPresenceForTests();
        vi.restoreAllMocks();
    });

    // CONTRACT: the FIRST tracked position becomes the eye-contact baseline,
    // so a student sitting anywhere in the frame (webcam above the screen →
    // face center low in the image) starts at ZERO deviation — no permanent
    // look-down (bug 03.07.2026).
    it('treats the first tracked position as eye contact (zero deviation)', () => {
        emitAt(1000, 0.5, 0.7);
        const gaze = getStudentGaze();
        expect(gaze).not.toBeNull();
        expect(gaze.dx).toBeCloseTo(0);
        expect(gaze.dy).toBeCloseTo(0);
    });

    // CONTRACT: a quick movement is reported as deviation from the baseline
    // (the baseline barely moves over a fraction of a second).
    it('reports quick movement as deviation from the baseline', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(1200, 0.3, 0.7);
        const gaze = getStudentGaze();
        expect(gaze.dx).toBeLessThan(-0.15);
        expect(Math.abs(gaze.dy)).toBeLessThan(0.02);
    });

    // CONTRACT: holding a new position re-establishes eye contact there —
    // the baseline converges (EMA, ~45s time constant) and deviation decays.
    it('re-establishes eye contact after the student settles', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(1200, 0.3, 0.7);
        // Hold the new spot for ~4 time constants of 1 Hz samples.
        for (let t = 2000; t <= 182_000; t += 1000) emitAt(t, 0.3, 0.7);
        const gaze = getStudentGaze();
        expect(Math.abs(gaze.dx)).toBeLessThan(0.005);
    });

    // CONTRACT (anti-stuck, operator feedback 04.07.2026): the avatar
    // follows MOVEMENT, not position. Holding a lean without moving lets
    // attention decay — within ~10s of stillness the gaze has released back
    // to eye contact. He can never stay pinned to one side.
    it('releases back to eye contact within seconds after movement stops', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(1200, 0.3, 0.7);              // the move
        for (let t = 1700; t <= 11_200; t += 500) emitAt(t, 0.3, 0.7); // then dead still
        const gaze = getStudentGaze();
        expect(Math.abs(gaze.dx)).toBeLessThan(0.02);
    });

    // CONTRACT: ongoing movement keeps refreshing attention — as long as the
    // student is actually moving, the deviation keeps being reported.
    it('keeps following while the student keeps moving', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(1500, 0.3, 0.7);
        emitAt(2000, 0.33, 0.7);
        emitAt(2500, 0.3, 0.7);
        emitAt(3000, 0.33, 0.7);
        const gaze = getStudentGaze();
        expect(gaze.dx).toBeLessThan(-0.1);
    });

    // CONTRACT: a tracking gap longer than the re-acquire window resets the
    // baseline at the next sample — a fresh sit-down is instant eye contact,
    // not a huge stale deviation.
    it('re-acquires the baseline after a tracking gap', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(20_000, 0.2, 0.4); // 19s gap ≫ REACQUIRE_MS
        const gaze = getStudentGaze();
        expect(gaze.dx).toBeCloseTo(0);
        expect(gaze.dy).toBeCloseTo(0);
    });

    // CONTRACT: no face seen yet → null (avatar stays neutral).
    it('returns null before any face has been seen', () => {
        expect(getStudentGaze()).toBeNull();
    });

    // CONTRACT: samples without a usable face (face null, or non-finite
    // fields) do not clobber the last good snapshot.
    it('ignores samples without a usable face bbox', () => {
        emitAt(1000, 0.5, 0.7);
        emitAt(1100, 0.3, 0.7);
        nowMs = 1200;
        document.dispatchEvent(new CustomEvent('oyon:sample', { detail: { face: null }, bubbles: true }));
        document.dispatchEvent(new CustomEvent('oyon:sample', { detail: { face: { x: NaN, y: 0, width: 0.1, height: 0.1 } }, bubbles: true }));
        document.dispatchEvent(new CustomEvent('oyon:sample', { detail: {}, bubbles: true }));
        const gaze = getStudentGaze();
        expect(gaze).not.toBeNull();
        expect(gaze.dx).toBeLessThan(-0.15);
    });

    // CONTRACT: the snapshot goes stale after maxAgeMs so a stopped camera
    // eases the avatar back to neutral rather than freezing the last gaze.
    it('goes stale after maxAgeMs', () => {
        emitAt(1000, 0.4, 0.6);
        nowMs = 1500;
        expect(getStudentGaze(10_000)).not.toBeNull();
        expect(getStudentGaze(100)).toBeNull();
    });

    // CONTRACT: listener installation is idempotent.
    it('is idempotent about listener installation', () => {
        ensureStudentPresenceListener();
        ensureStudentPresenceListener();
        emitAt(1000, 0.5, 0.5);
        expect(getStudentGaze()).not.toBeNull();
    });
});

describe('requestAvatarGlance', () => {
    beforeEach(() => {
        nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        _resetStudentPresenceForTests();
    });
    afterEach(() => {
        _resetStudentPresenceForTests();
        vi.restoreAllMocks();
    });

    // CONTRACT: a scripted glance (alarm → look at the ECG) is active for
    // its duration, then expires so student-following resumes.
    it('is active for its duration and then expires', () => {
        nowMs = 1000;
        requestAvatarGlance(0.5, -0.06, 6000);
        expect(getGlanceOverride()).toEqual(expect.objectContaining({ yaw: 0.5, pitch: -0.06 }));
        nowMs = 6900;
        expect(getGlanceOverride()).not.toBeNull();
        nowMs = 7100;
        expect(getGlanceOverride()).toBeNull();
    });

    // CONTRACT: the never-look-down policy applies to scripted glances too —
    // a downward pitch request is clamped to level.
    it('clamps scripted downward pitch to level', () => {
        nowMs = 1000;
        requestAvatarGlance(0.3, 0.4, 1000);
        expect(getGlanceOverride().pitch).toBe(0);
    });
});

describe('faceGazeAngles', () => {
    // CONTRACT (sign convention, derived in studentPresence.js): the webcam
    // image is the avatar's own view of the student. Movement toward image
    // RIGHT (dx > 0) = student moving to the avatar's right = NEGATIVE yaw
    // about world Y for a +Z-facing head. Image y grows DOWN = positive
    // pitch looks down.
    it('zero deviation → zero angles (eye contact straight ahead)', () => {
        const a = faceGazeAngles(0, 0);
        expect(a.yaw).toBeCloseTo(0);
        expect(a.pitch).toBeCloseTo(0);
    });

    it('movement toward image right → negative yaw; left → positive yaw', () => {
        expect(faceGazeAngles(0.2, 0).yaw).toBeLessThan(0);
        expect(faceGazeAngles(-0.2, 0).yaw).toBeGreaterThan(0);
    });

    // CONTRACT (vertical policy, operator directive 04.07.2026): NEVER look
    // down — downward deviations (dy > 0) map to exactly zero pitch, however
    // large. Webcam-above geometry makes "lean toward the screen" read as a
    // face drop; that must not become a floor-stare.
    it('never looks down, no matter how far the face drops in the frame', () => {
        expect(faceGazeAngles(0, 0.05).pitch).toBe(0);
        expect(faceGazeAngles(0, 0.3).pitch).toBe(0);
        expect(faceGazeAngles(0, 5).pitch).toBe(0);
    });

    // CONTRACT: rarely up — small upward deviations sit in a deadzone (zero
    // pitch); only a clear upward move raises the gaze, and only slightly.
    it('ignores small upward moves and looks up only slightly for large ones', () => {
        expect(faceGazeAngles(0, -0.03).pitch).toBe(0);              // deadzone
        const clear = faceGazeAngles(0, -0.2).pitch;
        expect(clear).toBeLessThan(0);                                // up
        expect(clear).toBeGreaterThanOrEqual(-0.18);                  // capped small
        expect(faceGazeAngles(0, -5).pitch).toBeCloseTo(-0.18);      // hard cap
    });

    it('clamps large horizontal deviations to the yaw range', () => {
        expect(faceGazeAngles(5, 0).yaw).toBeCloseTo(faceGazeAngles(0.5, 0).yaw);
    });
});
