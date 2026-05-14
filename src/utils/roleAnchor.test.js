import { describe, it, expect } from 'vitest';
import { roleAnchor } from './roleAnchor';

describe('roleAnchor', () => {
    it('produces a block that starts with ## ROLE and names the role', () => {
        const block = roleAnchor({ role: 'the patient', name: 'Alice' });
        expect(block.startsWith('## ROLE\n')).toBe(true);
        expect(block).toMatch(/You are: the patient\./);
    });

    it('includes the name line when name is provided', () => {
        const block = roleAnchor({ role: 'the patient', name: 'Alice Carter' });
        expect(block).toMatch(/Your name: Alice Carter\./);
    });

    it('omits the name line when name is missing or empty', () => {
        const a = roleAnchor({ role: 'the patient', name: '' });
        const b = roleAnchor({ role: 'the patient' });
        expect(a).not.toMatch(/Your name:/);
        expect(b).not.toMatch(/Your name:/);
    });

    it('falls back to a generic role label when role is missing', () => {
        const block = roleAnchor({});
        expect(block).toMatch(/You are: this character\./);
    });

    it('forbids speaking as any of the named other roles', () => {
        const block = roleAnchor({ role: 'the patient' });
        for (const banned of ['doctor', 'clinician', 'learner', 'student', 'educator', 'tutor', 'nurse', 'consultant', 'family member']) {
            expect(block).toContain(banned);
        }
    });

    it('explicitly states the user is the OTHER party', () => {
        const block = roleAnchor({ role: 'case debrief tutor', name: 'Dr. Reed' });
        expect(block).toMatch(/user is always the OTHER party/);
    });

    it('trims role and name', () => {
        const block = roleAnchor({ role: '  the patient  ', name: '  Alice  ' });
        expect(block).toMatch(/You are: the patient\./);
        expect(block).toMatch(/Your name: Alice\./);
    });
});
