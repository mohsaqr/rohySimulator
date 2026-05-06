import { describe, it, expect } from 'vitest';
import { buildPersonaBlocks } from './personaBlocks.js';

describe('buildPersonaBlocks', () => {
    it('returns empty string when source is null', () => {
        expect(buildPersonaBlocks(null)).toBe('');
    });

    it('returns empty string when source is undefined', () => {
        expect(buildPersonaBlocks(undefined)).toBe('');
    });

    it('returns empty string when source is not an object (string/number)', () => {
        expect(buildPersonaBlocks('hello')).toBe('');
        expect(buildPersonaBlocks(42)).toBe('');
        expect(buildPersonaBlocks(true)).toBe('');
    });

    it('returns empty string when both dos and donts are missing', () => {
        expect(buildPersonaBlocks({})).toBe('');
    });

    it('returns empty string when dos and donts are empty arrays', () => {
        expect(buildPersonaBlocks({ dos: [], donts: [] })).toBe('');
    });

    it('returns empty string when arrays only contain whitespace/empty entries', () => {
        expect(buildPersonaBlocks({ dos: ['', '   ', '\t'], donts: ['  '] })).toBe('');
    });

    it('formats a single-item dos list correctly (locks literal output)', () => {
        const out = buildPersonaBlocks({ dos: ['Be empathetic'] });
        expect(out).toBe('\n\nYou should:\n- Be empathetic\n');
    });

    it('formats a single-item donts list correctly (locks literal output)', () => {
        const out = buildPersonaBlocks({ donts: ['Give medical advice'] });
        expect(out).toBe('\n\nYou must not:\n- Give medical advice\n');
    });

    it('formats both dos and donts together with literal expected output (canonical case)', () => {
        const out = buildPersonaBlocks({
            dos: ['Listen carefully', 'Ask follow-up questions'],
            donts: ['Interrupt the user', 'Make assumptions'],
        });
        expect(out).toBe(
            '\n\nYou should:\n- Listen carefully\n- Ask follow-up questions\n\n' +
            'You must not:\n- Interrupt the user\n- Make assumptions\n'
        );
    });

    it('preserves order of multi-item lists', () => {
        const out = buildPersonaBlocks({ dos: ['first', 'second', 'third', 'fourth'] });
        const idxFirst = out.indexOf('first');
        const idxSecond = out.indexOf('second');
        const idxThird = out.indexOf('third');
        const idxFourth = out.indexOf('fourth');
        expect(idxFirst).toBeGreaterThan(-1);
        expect(idxFirst).toBeLessThan(idxSecond);
        expect(idxSecond).toBeLessThan(idxThird);
        expect(idxThird).toBeLessThan(idxFourth);
    });

    it('renders all items with bullet prefix "- "', () => {
        const out = buildPersonaBlocks({
            dos: ['alpha', 'beta', 'gamma'],
        });
        expect(out).toContain('- alpha');
        expect(out).toContain('- beta');
        expect(out).toContain('- gamma');
        // Three bullet markers for three items
        expect(out.match(/- /g)).toHaveLength(3);
    });

    it('trims leading/trailing whitespace from each item', () => {
        const out = buildPersonaBlocks({
            dos: ['  spaced out  ', '\ttabbed\t'],
        });
        expect(out).toContain('- spaced out');
        expect(out).toContain('- tabbed');
        expect(out).not.toContain('-   spaced');
        expect(out).not.toContain('- \tspaced');
    });

    it('filters out empty/whitespace-only entries from arrays', () => {
        const out = buildPersonaBlocks({
            dos: ['real one', '', '   ', 'another real'],
        });
        expect(out).toContain('- real one');
        expect(out).toContain('- another real');
        // Only two bullets — empties dropped
        expect(out.match(/- /g)).toHaveLength(2);
    });

    it('skips non-string array entries (numbers, objects, null) by treating them as empty', () => {
        const out = buildPersonaBlocks({
            dos: ['valid', 123, null, { foo: 'bar' }, 'also valid'],
        });
        expect(out).toContain('- valid');
        expect(out).toContain('- also valid');
        expect(out.match(/- /g)).toHaveLength(2);
    });

    it('accepts a string for dos and splits on newlines', () => {
        const out = buildPersonaBlocks({ dos: 'line one\nline two\r\nline three' });
        expect(out).toContain('- line one');
        expect(out).toContain('- line two');
        expect(out).toContain('- line three');
        expect(out.match(/- /g)).toHaveLength(3);
    });

    it('accepts a string with blank lines and drops them', () => {
        const out = buildPersonaBlocks({ dos: 'first\n\n  \nsecond' });
        expect(out).toContain('- first');
        expect(out).toContain('- second');
        expect(out.match(/- /g)).toHaveLength(2);
    });

    it('handles only-dos (no donts header appears)', () => {
        const out = buildPersonaBlocks({ dos: ['only this'] });
        expect(out).toContain('You should:');
        expect(out).not.toContain('You must not:');
    });

    it('handles only-donts (no dos header appears)', () => {
        const out = buildPersonaBlocks({ donts: ['only this'] });
        expect(out).toContain('You must not:');
        expect(out).not.toContain('You should:');
    });

    it('is deterministic — same input yields same output across calls', () => {
        const input = { dos: ['a', 'b'], donts: ['x', 'y'] };
        const a = buildPersonaBlocks(input);
        const b = buildPersonaBlocks(input);
        const c = buildPersonaBlocks({ dos: ['a', 'b'], donts: ['x', 'y'] });
        expect(a).toBe(b);
        expect(a).toBe(c);
    });

    it('starts with double newline and ends with single newline when content is present', () => {
        const out = buildPersonaBlocks({ dos: ['x'] });
        expect(out.startsWith('\n\n')).toBe(true);
        expect(out.endsWith('\n')).toBe(true);
        // Final char is newline, but not double
        expect(out.endsWith('\n\n')).toBe(false);
    });

    it('separates the two blocks with a blank line', () => {
        const out = buildPersonaBlocks({ dos: ['d1'], donts: ['n1'] });
        // Between "- d1" and "You must not:" there should be \n\n
        expect(out).toContain('- d1\n\nYou must not:');
    });

    it('does not crash when a non-array, non-string value is passed for dos/donts', () => {
        expect(() => buildPersonaBlocks({ dos: 42, donts: { a: 1 } })).not.toThrow();
        expect(buildPersonaBlocks({ dos: 42, donts: { a: 1 } })).toBe('');
    });
});
