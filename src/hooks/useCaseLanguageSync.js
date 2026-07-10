import { useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

// Voice 2.0 follow-up: cases can carry their own dialogue language
// (config.case_language, set in the case wizard). While such a case is
// active, it OVERRIDES the user's UI language as the session language —
// which is what the LLM output directive, the STT locale, the
// voice-language mismatch warnings, and the per-language fallback voice
// all key on (caseLanguage in LanguageContext). A German case therefore
// speaks German to an English-UI student, and falls back to the GERMAN
// default voice — without this, "case language" silently meant "whatever
// the student's UI happened to be".
//
// setCaseLanguage was built for exactly this override in the i18n phase
// but had no caller until now. Cases without the field (or with an
// unknown code — setCaseLanguage validates) keep following the user's
// language, which is the pre-existing behaviour.
export function useCaseLanguageSync(activeCase) {
    const { setCaseLanguage } = useLanguage();
    const caseLang = activeCase?.config?.case_language || null;
    useEffect(() => {
        setCaseLanguage(caseLang);
        // Leaving the session (or switching cases) must not leak the old
        // case's language into the next context.
        return () => setCaseLanguage(null);
    }, [caseLang, setCaseLanguage]);
}
