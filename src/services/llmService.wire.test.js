import { describe, it, expect } from 'vitest';
import { wireMessages } from './llmService.js';

// The client's message objects carry bookkeeping the model must never see.
describe('wireMessages', () => {
    it('sends role and content only', () => {
        const wire = wireMessages([
            { role: 'user', content: 'Hi', source: 'room3d' },
            { role: 'assistant', content: 'Hello', error: false, source: 'room3d' },
        ]);
        expect(wire).toEqual([
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
        ]);
        expect(Object.keys(wire[0])).toEqual(['role', 'content']);
    });

    it('tolerates nothing to send', () => {
        expect(wireMessages(undefined)).toEqual([]);
        expect(wireMessages([])).toEqual([]);
    });
});
