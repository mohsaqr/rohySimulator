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

// Pre-login the user has no server preference yet, so the language they pick
// from the login dropdown is remembered here and reapplied on the next visit.
// Once authenticated, the stored server preference (user_preferences.language)
// takes over; setUiLanguage keeps this key in sync so the two never disagree.
const LS_KEY = 'rohy_ui_language';
const storedLang = () => {
    try {
        const v = localStorage.getItem(LS_KEY);
        return isKnownLanguage(v) ? v : null;
    } catch {
        return null;
    }
};

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
    const [uiLanguage, setUiLanguageState] = useState(storedLang() || DEFAULT_LANGUAGE);
    // null = follow uiLanguage; a code = explicit per-session override.
    const [caseOverride, setCaseOverride] = useState(null);
    // Gates the first authenticated render until the stored preference has
    // been fetched (success OR failure — never blocks indefinitely). Without
    // this, a message sent while /users/preferences is in flight would carry
    // caseLanguage 'en' and skip the LLM directive for an it/fi/sv user.
    const [hydrated, setHydrated] = useState(false);

    // Hydrate from the users API at login; reset on logout/user switch so a
    // shared workstation never leaks user A's language to user B.
    useEffect(() => {
        let cancelled = false;
        setCaseOverride(null);
        if (!user) {
            // Logged out: honour the login-screen choice parked in localStorage.
            setUiLanguageState(storedLang() || DEFAULT_LANGUAGE);
            setHydrated(true);
            return undefined;
        }
        setHydrated(false);
        apiFetch('/users/preferences')
            .then(prefs => {
                if (cancelled) return;
                // Server preference wins; if none stored yet, keep the language
                // the user picked pre-login rather than snapping back to English.
                const next = isKnownLanguage(prefs?.language) ? prefs.language : (storedLang() || DEFAULT_LANGUAGE);
                setUiLanguageState(next);
                try { localStorage.setItem(LS_KEY, next); } catch { /* private mode */ }
            })
            .catch(err => {
                console.error('[Language] Failed to load preference, staying on default:', err);
            })
            .finally(() => {
                if (!cancelled) setHydrated(true);
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
        try { localStorage.setItem(LS_KEY, code); } catch { /* private mode */ }
        // Pre-login there is no account to persist against — the localStorage
        // entry above is the whole story until the user signs in.
        if (!user) return Promise.resolve();
        return apiPut('/users/preferences', { language: code }).catch(err => {
            setUiLanguageState(previous);
            try { localStorage.setItem(LS_KEY, previous); } catch { /* private mode */ }
            throw err;
        });
    }, [uiLanguage, user]);

    const setCaseLanguage = useCallback((code) => {
        setCaseOverride(code && isKnownLanguage(code) ? code : null);
    }, []);

    const value = {
        uiLanguage,
        caseLanguage: caseOverride ?? uiLanguage,
        setUiLanguage,
        setCaseLanguage
    };

    // One brief gate per login, mirroring AuthProvider's own loading gate —
    // children never render with a stale default language for a user whose
    // stored preference is non-English.
    if (user && !hydrated) return null;

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}
