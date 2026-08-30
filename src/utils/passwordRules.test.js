// The client mirror of server/routes/_helpers.js validatePassword().
//
// Regression lock: the mirror was missing the server's `length > 128` rule, so
// the register form accepted a 129-character passphrase, ticked every box green
// and then took a 400 from the server — the exact "form accepts what the server
// rejects" bug this module was written to kill.
//
// If validatePassword() changes, this file is where the divergence shows up.

import { describe, expect, it } from 'vitest';
import { PASSWORD_RULES, PASSWORD_MAX_LENGTH, passwordMeetsRules } from './passwordRules.js';

// Meets every OTHER rule (upper, lower, digit) at any requested length, so the
// only thing under test is the length boundary.
const passwordOfLength = (n) => `Aa1${'x'.repeat(Math.max(0, n - 3))}`.slice(0, n);

describe('passwordMeetsRules', () => {
    it('mirrors the server bound: 128 passes, 129 fails', () => {
        expect(passwordOfLength(128)).toHaveLength(128);
        expect(passwordMeetsRules(passwordOfLength(128))).toBe(true);
        expect(passwordMeetsRules(passwordOfLength(129))).toBe(false);
        expect(PASSWORD_MAX_LENGTH).toBe(128);
    });

    it('still holds the lower bound and the character classes', () => {
        expect(passwordMeetsRules(passwordOfLength(8))).toBe(true);
        expect(passwordMeetsRules(passwordOfLength(7))).toBe(false);
        expect(passwordMeetsRules('alllowercase1')).toBe(false);
        expect(passwordMeetsRules('ALLUPPERCASE1')).toBe(false);
        expect(passwordMeetsRules('NoDigitsHere')).toBe(false);
        expect(passwordMeetsRules('')).toBe(false);
        expect(passwordMeetsRules(undefined)).toBe(false);
    });

    // The checklist renders one row per rule and keys `password_req_<key>` off
    // it, so a rule the user cannot see is a rule they cannot satisfy.
    it('exposes the max rule as its own checklist row', () => {
        const max = PASSWORD_RULES.find((rule) => rule.key === 'max');
        expect(max).toBeTruthy();
        expect(max.test('short')).toBe(true);
        expect(max.test('x'.repeat(129))).toBe(false);
    });
});
