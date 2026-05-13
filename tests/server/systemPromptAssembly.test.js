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
