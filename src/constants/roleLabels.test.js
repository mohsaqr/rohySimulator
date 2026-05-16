// roleLabels is the single source of truth for human-readable role names.
// The product decision is that `educator` surfaces as "Teacher" while the
// stored value stays `educator` — these tests lock that mapping.

import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, roleLabel } from './roleLabels.js';

describe('ROLE_LABELS map', () => {
    it('surfaces educator as "Teacher" (the product relabel)', () => {
        expect(ROLE_LABELS.educator).toBe('Teacher');
    });

    it('keeps every other role at its capitalised label', () => {
        expect(ROLE_LABELS).toMatchObject({
            guest: 'Guest',
            student: 'Student',
            user: 'User',
            reviewer: 'Reviewer',
            admin: 'Admin',
        });
    });
});

describe('roleLabel()', () => {
    it('maps a known role to its label', () => {
        expect(roleLabel('educator')).toBe('Teacher');
        expect(roleLabel('admin')).toBe('Admin');
    });

    it('returns empty string for null / undefined / empty', () => {
        expect(roleLabel(null)).toBe('');
        expect(roleLabel(undefined)).toBe('');
        expect(roleLabel('')).toBe('');
    });

    it('falls back to the raw value for an unknown role', () => {
        expect(roleLabel('superuser')).toBe('superuser');
    });
});
