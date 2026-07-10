// Locks in the ordering invariant for the LLM proxy's system-prompt
// assembly (2026-07-10 shape):
//
//   [language lead] → case system_prompt → platform template → RESPONSE
//   CONTRACT (full language directive + always-on plain-speech rules).
//
// The platform template must never be *prepended* (it used to shadow every
// case persona). The language directive appears twice — a one-line lead for
// primacy and the full directive in the trailing contract for recency — and
// the plain-speech rules trail EVERY request (replies render verbatim in
// chat bubbles and feed TTS, so markdown is banned at the source).

import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt, PLAIN_SPEECH_RULES } from '../../server/services/systemPromptAssembly.js';

describe('assembleSystemPrompt', () => {
    it('case-built system_prompt leads, platform template trails, contract last', () => {
        const out = assembleSystemPrompt({
            system_prompt: 'CASE: John Q. Patient, 55yo male, chest pain',
            systemPromptTemplate: 'Behavioral reminder: speak naturally.',
        });
        const caseIdx = out.indexOf('CASE:');
        const reminderIdx = out.indexOf('Behavioral reminder');
        expect(caseIdx).toBeGreaterThanOrEqual(0);
        expect(reminderIdx).toBeGreaterThan(caseIdx);
        expect(out.indexOf(PLAIN_SPEECH_RULES)).toBeGreaterThan(reminderIdx);
        expect(out).toContain('\n\n---\n\n');
    });

    it('the plain-speech rules trail EVERY request, even with no case language', () => {
        const out = assembleSystemPrompt({ system_prompt: 'CASE only' });
        expect(out.startsWith('CASE only')).toBe(true);
        expect(out.endsWith(PLAIN_SPEECH_RULES)).toBe(true);
    });

    it('assembles the contract alone when both prompts are blank or missing', () => {
        expect(assembleSystemPrompt()).toBe(PLAIN_SPEECH_RULES);
        expect(assembleSystemPrompt({})).toBe(PLAIN_SPEECH_RULES);
        expect(assembleSystemPrompt({ system_prompt: '   ', systemPromptTemplate: '\n\n' })).toBe(PLAIN_SPEECH_RULES);
    });

    it('trims whitespace on prompt inputs', () => {
        const out = assembleSystemPrompt({ system_prompt: '   CASE   ', systemPromptTemplate: '' });
        expect(out.startsWith('CASE')).toBe(true);
        expect(out).not.toContain('   CASE');
    });

    it('coerces non-string inputs without throwing', () => {
        // The point: a malformed client payload should not 500 the route. We
        // intentionally accept the coerced string (even if odd) rather than
        // crash inside the proxy handler.
        expect(assembleSystemPrompt({ system_prompt: {}, systemPromptTemplate: '' }).startsWith('[object Object]')).toBe(true);
        expect(assembleSystemPrompt({ system_prompt: 42, systemPromptTemplate: undefined }).startsWith('42')).toBe(true);
        expect(assembleSystemPrompt({ system_prompt: null, systemPromptTemplate: null })).toBe(PLAIN_SPEECH_RULES);
    });

    it('regression: platform template is never prepended in front of the case prompt', () => {
        const out = assembleSystemPrompt({
            system_prompt: '## PERSONA\nname: X',
            systemPromptTemplate: 'You are a simulated patient.',
        });
        expect(out.startsWith('## PERSONA')).toBe(true);
        expect(out.startsWith('You are a simulated patient.')).toBe(false);
    });
});

// The case language is immutable and independent of the student's UI
// language, so the directive must dominate: primacy (one-line lead before
// the long English persona) AND recency (full directive inside the trailing
// response contract).
describe('assembleSystemPrompt — caseLanguage directive', () => {
    it('a known case language leads the prompt and recurs in the trailing contract', () => {
        const out = assembleSystemPrompt({
            system_prompt: 'CASE: chest pain',
            systemPromptTemplate: 'Behavioral reminder.',
            caseLanguage: 'it'
        });
        expect(out.startsWith('Respond only in Italian (Italiano).')).toBe(true);
        const directiveIdx = out.indexOf('Rispondi sempre in italiano.');
        expect(directiveIdx).toBeGreaterThan(out.indexOf('CASE:'));
        expect(directiveIdx).toBeGreaterThan(out.indexOf('Behavioral reminder.'));
        expect(out.endsWith(PLAIN_SPEECH_RULES)).toBe(true);
    });

    it('English gets its own directive too — an EN case stays English for a non-English student', () => {
        const out = assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: 'en' });
        expect(out.startsWith('Respond only in English.')).toBe(true);
        expect(out).toContain('Always respond in English');
    });

    it('unknown or malformed codes add no language blocks, never crash the assembly', () => {
        for (const junk of ['xx', undefined, { evil: 1 }, '']) {
            const out = assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: junk });
            expect(out.startsWith('CASE')).toBe(true);
            expect(out).not.toContain('Respond only in');
            expect(out.endsWith(PLAIN_SPEECH_RULES)).toBe(true);
        }
    });

    it('language lead + contract stand alone when no prompts are provided', () => {
        const out = assembleSystemPrompt({ caseLanguage: 'fi' });
        expect(out.startsWith('Respond only in Finnish (Suomi).')).toBe(true);
        expect(out).toContain('Vastaa aina suomeksi.');
        expect(out.endsWith(PLAIN_SPEECH_RULES)).toBe(true);
    });
});
