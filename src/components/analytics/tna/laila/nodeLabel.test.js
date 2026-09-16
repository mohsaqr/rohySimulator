import { describe, expect, it } from 'vitest';
import { nodeLabelLines } from './nodeLabel.js';

describe('nodeLabelLines', () => {
    it('keeps short names on one line, smaller as they grow', () => {
        expect(nodeLabelLines('Pause')).toEqual({ lines: ['Pause'], fontSize: 11 });
        expect(nodeLabelLines('Turn start')).toEqual({ lines: ['Turn start'], fontSize: 9 });
    });

    it('breaks a long name at the balancing space instead of truncating it', () => {
        expect(nodeLabelLines('Patient speaking')).toEqual({ lines: ['Patient', 'speaking'], fontSize: 9 });
        // A tie keeps the earlier break.
        expect(nodeLabelLines('Order lab tests')).toEqual({ lines: ['Order', 'lab tests'], fontSize: 9 });
    });

    it('shortens only what still does not fit, and says so with an ellipsis', () => {
        expect(nodeLabelLines('Pharmacotherapy')).toEqual({ lines: ['Pharmacot…'], fontSize: 8 });
        const { lines } = nodeLabelLines('Radiology interpretation');
        expect(lines[0]).toBe('Radiology');
        expect(lines[1]).toBe('interpret\u2026');
    });

    it('never returns a line longer than ten characters (invariant)', () => {
        ['a', 'History taking with patient', 'x'.repeat(40), 'ab cd'].forEach((label) => {
            nodeLabelLines(label).lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(10));
        });
    });
});
