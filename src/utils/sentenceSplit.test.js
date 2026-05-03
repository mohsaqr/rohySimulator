// Run with:  node --test src/utils/sentenceSplit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCompleteSentences } from './sentenceSplit.js';

test('empty buffer', () => {
    const r = extractCompleteSentences('');
    assert.deepEqual(r.sentences, []);
    assert.equal(r.remainder, '');
});

test('one complete sentence with trailing space', () => {
    const r = extractCompleteSentences('Hello world. ');
    assert.deepEqual(r.sentences, ['Hello world.']);
    assert.equal(r.remainder, '');
});

test('terminal at end-of-buffer is held back (next delta might be a space or more abbrev)', () => {
    const r = extractCompleteSentences('Hello world.');
    assert.deepEqual(r.sentences, []);
    assert.equal(r.remainder, 'Hello world.');
});

test('two complete sentences plus partial remainder', () => {
    const r = extractCompleteSentences('First. Second! And the third');
    assert.deepEqual(r.sentences, ['First.', 'Second!']);
    assert.equal(r.remainder, 'And the third');
});

test('decimal point does not split', () => {
    const r = extractCompleteSentences('Pi is 3.14 and tau is 6.28. Done. ');
    assert.deepEqual(r.sentences, ['Pi is 3.14 and tau is 6.28.', 'Done.']);
    assert.equal(r.remainder, '');
});

test('common abbreviations do not split', () => {
    const r = extractCompleteSentences('Dr. Smith and Mr. Jones met. Then they left. ');
    assert.deepEqual(r.sentences, ['Dr. Smith and Mr. Jones met.', 'Then they left.']);
    assert.equal(r.remainder, '');
});

test('e.g. and i.e. do not split', () => {
    const r = extractCompleteSentences('Many fruits, e.g. apples and pears. Done. ');
    assert.deepEqual(r.sentences, ['Many fruits, e.g. apples and pears.', 'Done.']);
    assert.equal(r.remainder, '');
});

test('ellipsis treated as one boundary', () => {
    const r = extractCompleteSentences('Hmm... yes. Okay. ');
    assert.deepEqual(r.sentences, ['Hmm...', 'yes.', 'Okay.']);
    assert.equal(r.remainder, '');
});

test('?! interrobang treated as one boundary', () => {
    const r = extractCompleteSentences('Really?! Yes. ');
    assert.deepEqual(r.sentences, ['Really?!', 'Yes.']);
    assert.equal(r.remainder, '');
});

test('newline counts as boundary whitespace', () => {
    const r = extractCompleteSentences('First line.\nSecond line. ');
    assert.deepEqual(r.sentences, ['First line.', 'Second line.']);
    assert.equal(r.remainder, '');
});

test('stage directions remain part of the sentence (caller strips later)', () => {
    const r = extractCompleteSentences('I feel sick *coughs*. Help me. ');
    assert.deepEqual(r.sentences, ['I feel sick *coughs*.', 'Help me.']);
});

test('single capital letter abbreviation (initial) does not split', () => {
    const r = extractCompleteSentences('John F. Kennedy spoke. Done. ');
    assert.deepEqual(r.sentences, ['John F. Kennedy spoke.', 'Done.']);
});

test('streaming reassembly: feed deltas one chunk at a time', () => {
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
    assert.deepEqual(out, ['Hello Dr. Jones.', 'How are you?', 'I am fine.']);
});

test('whitespace-only buffer produces nothing', () => {
    const r = extractCompleteSentences('   \n  ');
    assert.deepEqual(r.sentences, []);
    assert.equal(r.remainder.trim(), '');
});
