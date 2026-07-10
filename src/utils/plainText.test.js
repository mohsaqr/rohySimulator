// Tests for the client-side markdown safety net (plainText.js). The server
// bans markdown in the response contract, but models leak it — chat bubbles
// render msg.content verbatim and TTS speaks the same string, so residue
// must be stripped without losing the spoken words themselves.

import { describe, expect, it } from 'vitest';
import { stripMarkdown, sanitizeResponseText } from './plainText.js';

describe('stripMarkdown', () => {
    it('unwraps bold, keeping the text', () => {
        expect(stripMarkdown('The pain is **crushing** and __constant__.'))
            .toBe('The pain is crushing and constant.');
    });

    it('removes headings but keeps the heading text', () => {
        expect(stripMarkdown('## Current symptoms\nChest pain.'))
            .toBe('Current symptoms\nChest pain.');
    });

    it('removes bullet and numbered list markers', () => {
        expect(stripMarkdown('- chest pain\n* sweating\n+ nausea\n1. dizziness\n2) fatigue'))
            .toBe('chest pain\nsweating\nnausea\ndizziness\nfatigue');
    });

    it('drops code fences and inline backticks, keeping the content', () => {
        expect(stripMarkdown('```\naspirin 300 mg\n```\ntake `aspirin` now'))
            .toBe('aspirin 300 mg\n\ntake aspirin now');
    });

    it('replaces links and images with their text', () => {
        expect(stripMarkdown('See [my chart](https://x.example) and ![ecg](img.png).'))
            .toBe('See my chart and ecg.');
    });

    it('removes horizontal rules and blockquote markers', () => {
        expect(stripMarkdown('before\n---\n> quoted words'))
            .toBe('before\nquoted words');
    });

    it('leaves plain sentences untouched', () => {
        const plain = 'It started an hour ago. On a scale of 1-10, maybe an 8.';
        expect(stripMarkdown(plain)).toBe(plain);
    });

    it('leaves an unfinished bold marker alone mid-stream', () => {
        // Mirrors stageDirections.js: only fully-closed pairs are handled.
        expect(stripMarkdown('the pain is **crush')).toBe('the pain is **crush');
    });

    it('leaves names_with_underscores and non-strings alone', () => {
        expect(stripMarkdown('my file blood_test_results arrived')).toBe('my file blood_test_results arrived');
        expect(stripMarkdown(null)).toBeNull();
        expect(stripMarkdown(undefined)).toBeUndefined();
    });

    it('handles non-English text safely', () => {
        expect(stripMarkdown('**Il dolore** è forte. Mi fa male *qui*.'))
            .toBe('Il dolore è forte. Mi fa male *qui*.');
    });
});

describe('sanitizeResponseText', () => {
    it('unwraps markdown AND deletes stage directions, in the right order', () => {
        // Markdown first: running stage directions first would mangle
        // `**bold**` into a stray `**`.
        expect(sanitizeResponseText('*clutches chest* The pain is **crushing**.'))
            .toBe('The pain is crushing.');
    });

    it('cleans a full markdown-heavy reply into speakable prose', () => {
        // Heading TEXT stays (it's speech content) — only the markup goes.
        const raw = '## Assessment\n- **Pain**: severe\n- **Onset**: `45 min` ago\n*groans*';
        expect(sanitizeResponseText(raw)).toBe('Assessment\nPain: severe\nOnset: 45 min ago');
    });

    it('passes plain conversational replies through unchanged', () => {
        const plain = 'Doctor, it hurts right here in the middle of my chest.';
        expect(sanitizeResponseText(plain)).toBe(plain);
    });
});
