// Functional language-switch test (I18N_PLAN.md success criterion 1):
// switching the app language must actually re-render components in the
// target language — this exercises the real chain (setAppLanguage → lazy
// locale chunk import → i18next.changeLanguage → useTranslation re-render),
// not just catalogue file integrity (tests/server/locales-integrity.test.js
// covers that).

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import i18n, { setAppLanguage, PSEUDO_LOCALE } from '../../src/i18n/index.js';

function Probe() {
    const { t } = useTranslation('common');
    return <span>{t('loading')}</span>;
}

afterEach(async () => {
    await setAppLanguage('en');
    cleanup();
});

describe('setAppLanguage', () => {
    it('starts in English', () => {
        render(<Probe />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('re-renders live components in Italian after the switch', async () => {
        render(<Probe />);
        await setAppLanguage('it');
        await waitFor(() => expect(screen.getByText('Caricamento…')).toBeInTheDocument());
    });

    it('renders Finnish and Swedish', async () => {
        await setAppLanguage('fi');
        expect(i18n.t('common:loading')).toBe('Ladataan…');
        await setAppLanguage('sv');
        expect(i18n.t('common:loading')).toBe('Laddar…');
    });

    it('renders the generated pseudo-locale (accented, padded)', async () => {
        await setAppLanguage(PSEUDO_LOCALE);
        const value = i18n.t('common:loading');
        expect(value).not.toBe('Loading…');
        expect(value).toMatch(/Ĺóáðíñğ/);
    });

    it('falls back to English for a key missing from a translated locale', async () => {
        // Inject an English-only key at runtime (the integrity test forbids
        // real gaps in the repo, and i18next-icu memoizes already-rendered
        // keys, so removing an existing key can't simulate a gap): a key
        // absent from the active locale must render English, never the raw
        // key.
        i18n.addResourceBundle('en', 'common', { __fallback_probe: 'English only' }, true, true);
        await setAppLanguage('it');
        expect(i18n.t('common:__fallback_probe')).toBe('English only');
    });
});
