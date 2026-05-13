// Tests the small module-level cache that lets DiagnosticBar inspect the
// most recently assembled patient system prompt without prop-drilling.
//
// Behavior we lock in:
//   - getter returns null before any setter call
//   - setter snapshots the prompt + metadata
//   - setter rejects payloads without a string prompt (returns to null)
//   - clear resets to null

import { afterEach, describe, expect, it } from 'vitest';
import {
    clearLastPatientPrompt,
    getLastPatientPrompt,
    setLastPatientPrompt,
} from './lastPatientPrompt.js';

afterEach(() => clearLastPatientPrompt());

describe('lastPatientPrompt cache', () => {
    it('returns null before any prompt is captured', () => {
        expect(getLastPatientPrompt()).toBeNull();
    });

    it('captures prompt + metadata and stamps a timestamp', () => {
        setLastPatientPrompt({
            prompt: '## PERSONA\nRole: Patient\n',
            caseId: 42,
            caseName: 'Test Case',
            sessionId: 'sess-1',
        });
        const snap = getLastPatientPrompt();
        expect(snap.prompt).toBe('## PERSONA\nRole: Patient\n');
        expect(snap.caseId).toBe(42);
        expect(snap.caseName).toBe('Test Case');
        expect(snap.sessionId).toBe('sess-1');
        expect(typeof snap.timestamp).toBe('string');
        expect(snap.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('resets to null when payload lacks a string prompt', () => {
        setLastPatientPrompt({ prompt: 'first capture' });
        expect(getLastPatientPrompt()).not.toBeNull();
        setLastPatientPrompt({ prompt: null });
        expect(getLastPatientPrompt()).toBeNull();
        setLastPatientPrompt({ caseId: 1 });
        expect(getLastPatientPrompt()).toBeNull();
        setLastPatientPrompt(null);
        expect(getLastPatientPrompt()).toBeNull();
    });

    it('clear wipes the snapshot', () => {
        setLastPatientPrompt({ prompt: 'x' });
        clearLastPatientPrompt();
        expect(getLastPatientPrompt()).toBeNull();
    });

    it('latest set wins (single-slot cache)', () => {
        setLastPatientPrompt({ prompt: 'first', caseId: 1 });
        setLastPatientPrompt({ prompt: 'second', caseId: 2 });
        expect(getLastPatientPrompt().prompt).toBe('second');
        expect(getLastPatientPrompt().caseId).toBe(2);
    });
});
