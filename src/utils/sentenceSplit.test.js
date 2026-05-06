// Run with:  npm test
// Migrated from node:test to vitest as part of Phase 0. Test cases are
// untouched — only the runner imports changed.

import { describe, it, expect } from 'vitest';
import { extractCompleteSentences } from './sentenceSplit.js';

describe('extractCompleteSentences', () => {
    it('empty buffer', () => {
        const r = extractCompleteSentences('');
        expect(r.sentences).toEqual([]);
        expect(r.remainder).toBe('');
    });

    it('one complete sentence with trailing space', () => {
        const r = extractCompleteSentences('Hello world. ');
        expect(r.sentences).toEqual(['Hello world.']);
        expect(r.remainder).toBe('');
    });

    it('terminal at end-of-buffer is held back (next delta might be a space or more abbrev)', () => {
        const r = extractCompleteSentences('Hello world.');
        expect(r.sentences).toEqual([]);
        expect(r.remainder).toBe('Hello world.');
    });

    it('two complete sentences plus partial remainder', () => {
        const r = extractCompleteSentences('First. Second! And the third');
        expect(r.sentences).toEqual(['First.', 'Second!']);
        expect(r.remainder).toBe('And the third');
    });

    it('decimal point does not split', () => {
        const r = extractCompleteSentences('Pi is 3.14 and tau is 6.28. Done. ');
        expect(r.sentences).toEqual(['Pi is 3.14 and tau is 6.28.', 'Done.']);
        expect(r.remainder).toBe('');
    });

    it('common abbreviations do not split', () => {
        const r = extractCompleteSentences('Dr. Smith and Mr. Jones met. Then they left. ');
        expect(r.sentences).toEqual(['Dr. Smith and Mr. Jones met.', 'Then they left.']);
        expect(r.remainder).toBe('');
    });

    it('e.g. and i.e. do not split', () => {
        const r = extractCompleteSentences('Many fruits, e.g. apples and pears. Done. ');
        expect(r.sentences).toEqual(['Many fruits, e.g. apples and pears.', 'Done.']);
        expect(r.remainder).toBe('');
    });

    it('ellipsis treated as one boundary', () => {
        const r = extractCompleteSentences('Hmm... yes. Okay. ');
        expect(r.sentences).toEqual(['Hmm...', 'yes.', 'Okay.']);
        expect(r.remainder).toBe('');
    });

    it('?! interrobang treated as one boundary', () => {
        const r = extractCompleteSentences('Really?! Yes. ');
        expect(r.sentences).toEqual(['Really?!', 'Yes.']);
        expect(r.remainder).toBe('');
    });

    it('newline counts as boundary whitespace', () => {
        const r = extractCompleteSentences('First line.\nSecond line. ');
        expect(r.sentences).toEqual(['First line.', 'Second line.']);
        expect(r.remainder).toBe('');
    });

    it('stage directions remain part of the sentence (caller strips later)', () => {
        const r = extractCompleteSentences('I feel sick *coughs*. Help me. ');
        expect(r.sentences).toEqual(['I feel sick *coughs*.', 'Help me.']);
    });

    it('single capital letter abbreviation (initial) does not split', () => {
        const r = extractCompleteSentences('John F. Kennedy spoke. Done. ');
        expect(r.sentences).toEqual(['John F. Kennedy spoke.', 'Done.']);
    });

    it('streaming reassembly: feed deltas one chunk at a time', () => {
        // Simulate the runtime use: append a delta, extract sentences, keep remainder.
        const deltas = ['Hel', 'lo Dr. Jo', 'nes. How ', 'are you', '? I am fine.'];
        let buf = '';
        const out = [];
        for (const d of deltas) {
            buf += d;
            const r = extractCompleteSentences(buf);
            out.push(...r.sentences);
            buf = r.remainder;
        }
        // Final flush of the remainder (in real code, on stream end; here, trailing terminal already in last delta with space)
        if (buf.trim()) out.push(buf.trim());
        expect(out).toEqual(['Hello Dr. Jones.', 'How are you?', 'I am fine.']);
    });

    it('whitespace-only buffer produces nothing', () => {
        const r = extractCompleteSentences('   \n  ');
        expect(r.sentences).toEqual([]);
        expect(r.remainder.trim()).toBe('');
    });
});
