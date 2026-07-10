// useCaseLanguageSync — the bridge that makes config.case_language real:
// while a case carrying the field is active, the session dialogue language
// (LLM directive, STT locale, per-language fallback voice) follows the
// CASE, not the student's UI language. setCaseLanguage existed since the
// i18n phase but had no caller before this hook.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const setCaseLanguage = vi.fn();
vi.mock('../contexts/LanguageContext', () => ({
    useLanguage: () => ({ setCaseLanguage }),
}));

import { useCaseLanguageSync } from './useCaseLanguageSync.js';

describe('useCaseLanguageSync', () => {
    beforeEach(() => setCaseLanguage.mockClear());

    it('pushes the case language into the session while the case is active', () => {
        renderHook(() => useCaseLanguageSync({ id: 1, config: { case_language: 'de' } }));
        expect(setCaseLanguage).toHaveBeenCalledWith('de');
    });

    it('a case without the field follows the user language (explicit null)', () => {
        renderHook(() => useCaseLanguageSync({ id: 1, config: {} }));
        expect(setCaseLanguage).toHaveBeenCalledWith(null);
    });

    it('no active case → null (never a stale carry-over)', () => {
        renderHook(() => useCaseLanguageSync(null));
        expect(setCaseLanguage).toHaveBeenCalledWith(null);
    });

    it('resets on unmount so the next context never inherits the case language', () => {
        const { unmount } = renderHook(() => useCaseLanguageSync({ id: 1, config: { case_language: 'fi' } }));
        setCaseLanguage.mockClear();
        unmount();
        expect(setCaseLanguage).toHaveBeenCalledWith(null);
    });

    it('switching cases switches the language', () => {
        const { rerender } = renderHook(({ c }) => useCaseLanguageSync(c), {
            initialProps: { c: { id: 1, config: { case_language: 'de' } } },
        });
        setCaseLanguage.mockClear();
        rerender({ c: { id: 2, config: { case_language: 'sv' } } });
        expect(setCaseLanguage).toHaveBeenCalledWith(null);   // cleanup of the old case
        expect(setCaseLanguage).toHaveBeenLastCalledWith('sv');
    });
});
