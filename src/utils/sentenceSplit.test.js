// Run with:  npm test
// Migrated from node:test to vitest as part of Phase 0. Test cases are
// untouched — only the runner imports changed.

import { describe, it, expect } from 'vitest';
import { extractCompleteSentences, createSpeechChunker, FIRST_CHUNK_MIN_WORDS } from './sentenceSplit.js';

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

describe('extractCompleteSentences — first-chunk mode', () => {
    const first = (buf) => extractCompleteSentences(buf, { firstChunk: true });

    it('ends the first chunk at a comma once it holds the minimum words', () => {
        expect(FIRST_CHUNK_MIN_WORDS).toBe(6);
        const r = first('Well, doctor, it started this morning, and then it got worse. ');
        expect(r.sentences).toEqual(['Well, doctor, it started this morning,', 'and then it got worse.']);
        expect(r.remainder).toBe('');
    });

    it('does not split before the minimum words', () => {
        const r = first('Well, doctor, it started');
        expect(r.sentences).toEqual([]);
        expect(r.remainder).toBe('Well, doctor, it started');
    });

    it('splits only once: later commas wait for a sentence terminal', () => {
        const r = first('My chest hurts a lot right now, it spreads to my arm, and I feel sick, honestly');
        expect(r.sentences).toEqual(['My chest hurts a lot right now,']);
        expect(r.remainder).toBe('it spreads to my arm, and I feel sick, honestly');
    });

    it('a short list does not split', () => {
        const r = first('I take aspirin, metformin, and lisinopril every day');
        expect(r.sentences).toEqual([]);
    });

    it('never splits inside a number like 1,000', () => {
        const r = first('It cost me about 1,000 euros and 2,500 more for the scan');
        expect(r.sentences).toEqual([]);
    });

    it('accepts ; : and an em dash as clause breaks', () => {
        expect(first('I have had this pain for three days; it is worse now').sentences)
            .toEqual(['I have had this pain for three days;']);
        expect(first('Here is what happened to me this morning: I fell').sentences)
            .toEqual(['Here is what happened to me this morning:']);
        expect(first('It started in my chest after the run \u2014 then my arm').sentences)
            .toEqual(['It started in my chest after the run \u2014']);
    });

    it('waits for the whitespace after the clause break (the next token may continue it)', () => {
        expect(first('It started in my chest after the run,').sentences).toEqual([]);
    });

    it('keeps the decimal and abbreviation guards', () => {
        const r = first('Dr. Smith said my temperature was 38.5 today. ');
        expect(r.sentences).toEqual(['Dr. Smith said my temperature was 38.5 today.']);
    });

    it('a sentence that ends before the minimum is still a sentence', () => {
        expect(first('Yes. It hurts, doctor, it really hurts a lot, please').sentences).toEqual(['Yes.']);
    });

    it('is off by default', () => {
        expect(extractCompleteSentences('Well, doctor, it started this morning, and then').sentences).toEqual([]);
    });
});

describe('createSpeechChunker', () => {
    it('streams deltas: the first chunk ends early, the rest are whole sentences, flush returns the tail', () => {
        const chunker = createSpeechChunker();
        const deltas = ['Well, ', 'doctor, it ', 'started this ', 'morning, and ', 'then, later, it ', 'got worse. Okay, ', 'fine'];
        const spoken = deltas.flatMap((d) => chunker.push(d));
        expect(spoken).toEqual(['Well, doctor, it started this morning,', 'and then, later, it got worse.']);
        expect(chunker.flush()).toBe('Okay, fine');
        expect(chunker.flush()).toBe('');
    });

    it('earlyFirstChunk: false keeps sentence-only splitting', () => {
        const chunker = createSpeechChunker({ earlyFirstChunk: false });
        expect(chunker.push('Well, doctor, it started this morning, and then it got worse. ')).toEqual([
            'Well, doctor, it started this morning, and then it got worse.',
        ]);
    });

    it('returns every sentence completed by one delta', () => {
        const chunker = createSpeechChunker({ earlyFirstChunk: false });
        expect(chunker.push('One. Two. Three')).toEqual(['One.', 'Two.']);
        expect(chunker.flush()).toBe('Three');
    });
});
