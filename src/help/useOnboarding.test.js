import { describe, it, expect } from 'vitest';
import {
  onboardingKey,
  isTourDone,
  markTourDone,
  tourStepsForRole,
  TOUR_VERSION,
} from './useOnboarding.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

describe('onboarding storage helpers', () => {
  it('keys are per-role and versioned', () => {
    expect(onboardingKey('student')).toBe(`rohy.onboarding.student.v${TOUR_VERSION}`);
    expect(onboardingKey('educator')).toBe(`rohy.onboarding.educator.v${TOUR_VERSION}`);
    expect(onboardingKey()).toBe(`rohy.onboarding.student.v${TOUR_VERSION}`);
  });

  it('round-trips done state per role', () => {
    const s = fakeStorage();
    expect(isTourDone(s, 'student')).toBe(false);
    markTourDone(s, 'student');
    expect(isTourDone(s, 'student')).toBe(true);
    // a different role is unaffected
    expect(isTourDone(s, 'educator')).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    expect(() => markTourDone(null, 'student')).not.toThrow();
    expect(isTourDone(null, 'student')).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(isTourDone(throwing, 'student')).toBe(false);
    expect(() => markTourDone(throwing, 'student')).not.toThrow();
  });
});

describe('tourStepsForRole', () => {
  it('returns role-specific steps and falls back to student', () => {
    expect(tourStepsForRole('educator')[0].title).toMatch(/Teacher/i);
    expect(tourStepsForRole('student').length).toBeGreaterThan(0);
    expect(tourStepsForRole('admin')).toEqual(tourStepsForRole('student'));
  });
});
