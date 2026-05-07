import { describe, expect, it } from 'vitest';
import { isDiagBarRoleAllowed } from './DiagnosticBar';

// Audit #22: the diagnostic bar exposes operational metadata (LLM endpoint,
// TTS wire payloads, voice resolver tier) that must not be visible to
// learners. The role check below is the structural gate; tests pin the
// policy so a "let everyone see it" tweak fails CI.

describe('DiagnosticBar role gate', () => {
    it('allows admin', () => {
        expect(isDiagBarRoleAllowed({ role: 'admin' })).toBe(true);
    });

    it('allows educator', () => {
        expect(isDiagBarRoleAllowed({ role: 'educator' })).toBe(true);
    });

    it('blocks reviewer', () => {
        expect(isDiagBarRoleAllowed({ role: 'reviewer' })).toBe(false);
    });

    it('blocks student', () => {
        expect(isDiagBarRoleAllowed({ role: 'student' })).toBe(false);
    });

    it('blocks legacy "user" role (treated as student)', () => {
        expect(isDiagBarRoleAllowed({ role: 'user' })).toBe(false);
    });

    it('blocks guest', () => {
        expect(isDiagBarRoleAllowed({ role: 'guest' })).toBe(false);
    });

    it('blocks unauthenticated (no user)', () => {
        expect(isDiagBarRoleAllowed(null)).toBe(false);
        expect(isDiagBarRoleAllowed(undefined)).toBe(false);
    });

    it('blocks an unknown role string (defaults to deny)', () => {
        expect(isDiagBarRoleAllowed({ role: 'wizard' })).toBe(false);
    });
});
