// Landing-case selection contract: a student opens the app on the case that
// speaks their interface language, falling back to the tenant default.
import { describe, it, expect } from 'vitest';
import { pickLandingCase } from './landingCase';

const CASES = [
    { id: 1, name: 'John Martinez',   is_default: true,  config: { case_language: 'en' } },
    { id: 2, name: 'Thomas Berger',   is_default: false, config: { case_language: 'de' } },
    { id: 3, name: 'Lucía Fernández', is_default: false, config: { case_language: 'es' } },
    { id: 4, name: 'Giuseppe Ferraro',is_default: false, config: { case_language: 'it' } },
];

describe('pickLandingCase', () => {
    it('lands a German UI on the German case, not the English default', () => {
        expect(pickLandingCase(CASES, 'de')).toMatchObject({ id: 2, config: { case_language: 'de' } });
    });

    it('lands a Spanish UI on the Spanish case', () => {
        expect(pickLandingCase(CASES, 'es')).toMatchObject({ id: 3 });
    });

    it('lands an English UI on the English default', () => {
        expect(pickLandingCase(CASES, 'en')).toMatchObject({ id: 1, is_default: true });
    });

    it('falls back to the tenant default when no case matches the UI language', () => {
        // Finnish UI, but the demo course has no Finnish case yet.
        expect(pickLandingCase(CASES, 'fi')).toMatchObject({ id: 1, is_default: true });
    });

    it('falls back to the default when case_language is absent (legacy cases)', () => {
        const legacy = [
            { id: 9, is_default: true, config: {} },
            { id: 10, is_default: false, config: {} },
        ];
        expect(pickLandingCase(legacy, 'de')).toMatchObject({ id: 9 });
    });

    it('returns null for an empty or missing list rather than throwing', () => {
        expect(pickLandingCase([], 'de')).toBeNull();
        expect(pickLandingCase(undefined, 'de')).toBeNull();
    });

    it('returns null when nothing matches and there is no default', () => {
        const noDefault = [{ id: 5, is_default: false, config: { case_language: 'it' } }];
        expect(pickLandingCase(noDefault, 'de')).toBeNull();
    });

    it('prefers the language match even when a different case is the default', () => {
        // The default is English (id 1) but a German user still gets German.
        const picked = pickLandingCase(CASES, 'de');
        expect(picked.is_default).toBe(false);
        expect(picked.config.case_language).toBe('de');
    });
});
