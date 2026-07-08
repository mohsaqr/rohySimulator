// Locks in the ordering invariant for the LLM proxy's system-prompt
// assembly: case content (system_prompt) leads, platform-wide
// systemPromptTemplate trails as a reminder. Prior to this change the
// platform template was *prepended* and shadowed every case persona.

import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt } from '../../server/services/systemPromptAssembly.js';

describe('assembleSystemPrompt', () => {
    it('case-built system_prompt leads, platform template trails', () => {
        const out = assembleSystemPrompt({
            system_prompt: 'CASE: John Q. Patient, 55yo male, chest pain',
            systemPromptTemplate: 'Behavioral reminder: speak naturally.',
        });
        const caseIdx = out.indexOf('CASE:');
        const reminderIdx = out.indexOf('Behavioral reminder');
        expect(caseIdx).toBeGreaterThanOrEqual(0);
        expect(reminderIdx).toBeGreaterThan(caseIdx);
        expect(out).toContain('\n\n---\n\n');
    });

    it('returns just the case prompt when no platform template is set', () => {
        expect(assembleSystemPrompt({ system_prompt: 'CASE only' })).toBe('CASE only');
    });

    it('returns just the platform template when no case prompt is provided', () => {
        expect(assembleSystemPrompt({ systemPromptTemplate: 'PLATFORM only' })).toBe('PLATFORM only');
    });

    it('trims whitespace and omits separator for one-sided input', () => {
        expect(assembleSystemPrompt({ system_prompt: '   CASE   ', systemPromptTemplate: '' })).toBe('CASE');
        expect(assembleSystemPrompt({ system_prompt: '', systemPromptTemplate: '  TEMPLATE  ' })).toBe('TEMPLATE');
    });

    it('returns empty string when both inputs are blank or missing', () => {
        expect(assembleSystemPrompt()).toBe('');
        expect(assembleSystemPrompt({})).toBe('');
        expect(assembleSystemPrompt({ system_prompt: '', systemPromptTemplate: '' })).toBe('');
        expect(assembleSystemPrompt({ system_prompt: '   ', systemPromptTemplate: '\n\n' })).toBe('');
    });

    it('coerces non-string inputs without throwing', () => {
        expect(assembleSystemPrompt({ system_prompt: {}, systemPromptTemplate: '' })).toBe('[object Object]');
        expect(assembleSystemPrompt({ system_prompt: 42, systemPromptTemplate: undefined })).toBe('42');
        expect(assembleSystemPrompt({ system_prompt: null, systemPromptTemplate: null })).toBe('');
        // The point: a malformed client payload should not 500 the route. We
        // intentionally accept the coerced string (even if odd) rather than
        // crash inside the proxy handler.
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

// I18N (2026-07-08): the output-language directive from the registry trails
// EVERYTHING — recency keeps it dominant over long English case prompts
// (drift risk, I18N_PLAN.md §10). English requests must be byte-identical
// to pre-i18n output (success criterion: zero behaviour change for English).
describe('assembleSystemPrompt — caseLanguage directive', () => {
    it('appends the registry directive as the final block', () => {
        const out = assembleSystemPrompt({
            system_prompt: 'CASE: chest pain',
            systemPromptTemplate: 'Behavioral reminder.',
            caseLanguage: 'it'
        });
        const italianIdx = out.indexOf('italiano');
        expect(italianIdx).toBeGreaterThan(out.indexOf('CASE:'));
        expect(italianIdx).toBeGreaterThan(out.indexOf('Behavioral reminder.'));
        expect(out.endsWith('Rispondi sempre in italiano.')).toBe(true);
    });

    it('English (the model default) appends nothing', () => {
        expect(assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: 'en' })).toBe('CASE');
    });

    it('unknown or malformed codes are ignored, never crash the assembly', () => {
        expect(assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: 'xx' })).toBe('CASE');
        expect(assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: undefined })).toBe('CASE');
        expect(assembleSystemPrompt({ system_prompt: 'CASE', caseLanguage: { evil: 1 } })).toBe('CASE');
    });

    it('directive stands alone when no prompts are provided', () => {
        const out = assembleSystemPrompt({ caseLanguage: 'fi' });
        expect(out).toContain('Finnish');
        expect(out).not.toContain('---');
    });

    it('English-only requests are byte-identical to the pre-i18n behaviour', () => {
        const legacy = assembleSystemPrompt({ system_prompt: 'CASE', systemPromptTemplate: 'T' });
        expect(assembleSystemPrompt({ system_prompt: 'CASE', systemPromptTemplate: 'T', caseLanguage: 'en' })).toBe(legacy);
        expect(assembleSystemPrompt({ system_prompt: 'CASE', systemPromptTemplate: 'T', caseLanguage: '' })).toBe(legacy);
    });
});
