// Language preference context (I18N_PLAN.md §3).
//
// Two fields, deliberately distinct:
//   uiLanguage   — interface chrome. Per-user, persisted in
//                  user_preferences.language via PUT /users/preferences
//                  (a merge PUT — sending { language } alone is safe).
//   caseLanguage — patient dialogue + TTS/STT. Defaults to uiLanguage until
//                  explicitly overridden (a Finnish UI can host an
//                  English-speaking patient scenario, and vice versa).
//                  Session-scoped state for now; per-session persistence is
//                  a later layer.
//
// The context carries a usable English default so components render
// unchanged outside the provider (unit tests, storybook-style harnesses).

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { apiFetch, apiPut } from '../services/apiClient';
import { LANGUAGES, DEFAULT_LANGUAGE, isKnownLanguage } from '../i18n/languages';
import { setAppLanguage, PSEUDO_LOCALE } from '../i18n/index.js';

// QA escape hatch: ?pseudo=1 renders the en-XA pseudo-locale (accented,
// lengthened English) to expose hardcoded strings and layout truncation.
// Query-param only — never persisted, never user-visible in settings.
const pseudoRequested = () => {
    try {
        return new URLSearchParams(window.location.search).get('pseudo') === '1';
    } catch {
        return false;
    }
};

const noop = () => {};

const DEFAULT_CONTEXT = {
    uiLanguage: DEFAULT_LANGUAGE,
    caseLanguage: DEFAULT_LANGUAGE,
    setUiLanguage: noop,
    setCaseLanguage: noop
};

const LanguageContext = createContext(DEFAULT_CONTEXT);

export const useLanguage = () => useContext(LanguageContext);

export function LanguageProvider({ children }) {
    const { user } = useAuth();
    const [uiLanguage, setUiLanguageState] = useState(DEFAULT_LANGUAGE);
    // null = follow uiLanguage; a code = explicit per-session override.
    const [caseOverride, setCaseOverride] = useState(null);

    // Hydrate from the users API at login; reset on logout/user switch so a
    // shared workstation never leaks user A's language to user B.
    useEffect(() => {
        let cancelled = false;
        setCaseOverride(null);
        if (!user) {
            setUiLanguageState(DEFAULT_LANGUAGE);
            return undefined;
        }
        apiFetch('/users/preferences')
            .then(prefs => {
                if (cancelled) return;
                setUiLanguageState(isKnownLanguage(prefs?.language) ? prefs.language : DEFAULT_LANGUAGE);
            })
            .catch(err => {
                console.error('[Language] Failed to load preference, staying on default:', err);
            });
        return () => { cancelled = true; };
    }, [user?.id]);

    // <html lang dir> follow the UI language — screen readers, hyphenation,
    // and Intl-aware CSS all key off these attributes — and i18next switches
    // to the same language (lazy-loading its locale chunks on first use).
    useEffect(() => {
        const lang = LANGUAGES[uiLanguage] || LANGUAGES[DEFAULT_LANGUAGE];
        document.documentElement.lang = uiLanguage;
        document.documentElement.dir = lang.dir;
        setAppLanguage(pseudoRequested() ? PSEUDO_LOCALE : uiLanguage);
    }, [uiLanguage]);

    // Optimistic update; persists via the merge PUT. Returns the request
    // promise so callers (settings panel) can await + toast; on failure the
    // state reverts so the UI never lies about what is stored.
    const setUiLanguage = useCallback((code) => {
        if (!isKnownLanguage(code)) {
            return Promise.reject(new Error(`Unknown language code: ${code}`));
        }
        const previous = uiLanguage;
        setUiLanguageState(code);
        return apiPut('/users/preferences', { language: code }).catch(err => {
            setUiLanguageState(previous);
            throw err;
        });
    }, [uiLanguage]);

    const setCaseLanguage = useCallback((code) => {
        setCaseOverride(code && isKnownLanguage(code) ? code : null);
    }, []);

    const value = {
        uiLanguage,
        caseLanguage: caseOverride ?? uiLanguage,
        setUiLanguage,
        setCaseLanguage
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}
