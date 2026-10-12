// last_activity_at is written at most once a minute per session. It was a
// write on every authenticated request, which under load multiplied the
// write-lock contention (stability run, rc.47).
import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'activity-throttle-tests';
const { shouldTouchActivity, ACTIVITY_TOUCH_INTERVAL_MS } = await import('../../server/middleware/auth.js');

describe('session activity touch', () => {
    it('touches a session once per interval, and each session on its own', () => {
        // Regression lock: every authenticated request wrote active_sessions
        const t0 = 1_000_000;
        expect(shouldTouchActivity('a', t0)).toBe(true);
        expect(shouldTouchActivity('a', t0 + 1)).toBe(false);
        expect(shouldTouchActivity('a', t0 + ACTIVITY_TOUCH_INTERVAL_MS - 1)).toBe(false);
        expect(shouldTouchActivity('b', t0 + 1), 'another session is not held back').toBe(true);
        expect(shouldTouchActivity('a', t0 + ACTIVITY_TOUCH_INTERVAL_MS)).toBe(true);
    });
});
