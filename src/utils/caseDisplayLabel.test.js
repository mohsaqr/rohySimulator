// Regression lock for Bug 9 (16.5.2026 report): the authoring case title
// (e.g. "Acute Stroke – Left MCA") leaked the diagnosis to students in
// every room header. Educators+ keep the title; students/reviewers/guests
// only ever see the patient identity.

import { describe, it, expect } from 'vitest';
import { caseDisplayLabel, canSeeCaseTitle, roleRank } from './caseDisplayLabel.js';

const STROKE = {
    name: 'Acute Stroke – Left MCA',
    patient_name: 'Richard Thompson',
};
const STROKE_CFG = {
    name: 'Acute Stroke – Left MCA',
    config: { patient_name: 'Richard Thompson' },
};

describe('caseDisplayLabel — student diagnosis-leak guard', () => {
    it.each(['student', 'user', 'reviewer', 'guest', undefined, null])(
        'never returns the authoring title for role=%s',
        (role) => {
            const label = caseDisplayLabel(STROKE, role ? { role } : role);
            expect(label).toBe('Richard Thompson');
            expect(label).not.toContain('Stroke');
        },
    );

    it.each(['educator', 'admin'])('shows the authoring title to %s', (role) => {
        expect(caseDisplayLabel(STROKE, { role })).toBe('Acute Stroke – Left MCA');
    });

    it('reads patient_name from the config-wrapped shape too', () => {
        expect(caseDisplayLabel(STROKE_CFG, { role: 'student' })).toBe('Richard Thompson');
        expect(caseDisplayLabel(STROKE_CFG, { role: 'educator' })).toBe('Acute Stroke – Left MCA');
    });

    it('falls back to "Patient" for a student when no patient name exists', () => {
        expect(caseDisplayLabel({ name: 'Sepsis' }, { role: 'student' })).toBe('Patient');
        // ...and never the title, even as a last resort.
        expect(caseDisplayLabel({ name: 'Sepsis' }, { role: 'student' })).not.toBe('Sepsis');
    });

    it('honours a custom fallback', () => {
        expect(caseDisplayLabel(null, { role: 'student' }, 'ICU MONITOR')).toBe('ICU MONITOR');
    });

    it('rank ladder + canSeeCaseTitle match the server contract', () => {
        expect(roleRank('admin')).toBeGreaterThan(roleRank('educator'));
        expect(roleRank('educator')).toBeGreaterThan(roleRank('reviewer'));
        expect(roleRank('reviewer')).toBeGreaterThan(roleRank('student'));
        expect(roleRank('bogus')).toBe(0);
        expect(canSeeCaseTitle({ role: 'educator' })).toBe(true);
        expect(canSeeCaseTitle({ role: 'reviewer' })).toBe(false);
    });
});
