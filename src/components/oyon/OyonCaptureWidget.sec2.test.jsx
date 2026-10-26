// Oyon consent carry-over on a shared browser (security audit 2026-10-26, L5-03).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import OyonCaptureWidget from './OyonCaptureWidget.jsx';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), loadOyonElement: vi.fn(), prefs: null }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k) => k, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => mocks.apiFetch(...a) }));
vi.mock('./loadOyonElement', () => ({ loadOyonElement: (...a) => mocks.loadOyonElement(...a) }));
vi.mock('./screenAois', () => ({ getAois: () => [], onAois: () => () => {} }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const calls = (p) => mocks.apiFetch.mock.calls.filter(([u]) => u === p);

async function runAndEmit(container) {
    await waitFor(() => expect(mocks.loadOyonElement).toHaveBeenCalled());
    const el = container.querySelector('oyon-app');
    await act(async () => {
        el.dispatchEvent(new CustomEvent('oyon:status', { detail: { state: 'running' } }));
    });
    await act(async () => {
        el.dispatchEvent(new CustomEvent('oyon:window', { detail: { windows: [{ record_id: 'w', dominant_emotion: 'neutral' }] } }));
    });
}

describe('a previous person\'s local consent flag', () => {
    beforeEach(() => {
        mocks.loadOyonElement.mockResolvedValue(undefined);
        mocks.apiFetch.mockImplementation((url) => {
            if (url === '/users/preferences') return mocks.prefs;
            if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, runtime: {} });
            return Promise.resolve({});
        });
        // Student A consented on this browser and signed out (or simply left).
        localStorage.setItem('oyon.defaultConsent', '1');
        localStorage.setItem('oyon.consentVersion', 'v2');
    });
    afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

    // Regression lock: with no stored server choice the previous person's '1' stood and windows persisted.
    it('is cleared when the signed-in person has no stored choice, and nothing persists', async () => {
        mocks.prefs = Promise.resolve({});
        const { container } = render(<OyonCaptureWidget sessionId="s-1" caseId="c" room="chat" />);
        await waitFor(() => expect(calls('/users/preferences')).toHaveLength(1));
        await waitFor(() => expect(localStorage.getItem('oyon.defaultConsent')).toBeNull());
        expect(localStorage.getItem('oyon.consentVersion')).toBeNull();
        await runAndEmit(container);
        expect(calls('/addons/oyon/consent')).toHaveLength(0);
        expect(calls('/addons/oyon/emotion-records')).toHaveLength(0);
    });

    // Regression lock: capture starting before the preference lookup read the stale flag.
    it('is not trusted while the lookup is still in flight', async () => {
        let resolvePrefs;
        mocks.prefs = new Promise((r) => { resolvePrefs = r; });
        const { container } = render(<OyonCaptureWidget sessionId="s-2" caseId="c" room="chat" />);
        await runAndEmit(container);
        expect(calls('/addons/oyon/consent')).toHaveLength(0);
        await act(async () => { resolvePrefs({ onboarding_settings: { oyon_consent: false } }); });
        await waitFor(() => expect(localStorage.getItem('oyon.defaultConsent')).toBe('0'));
        expect(calls('/addons/oyon/consent')).toHaveLength(0);
    });

    it('a person whose own stored choice is yes still persists', async () => {
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: true } });
        // Own session id: ensureSessionConsent remembers sessions it already recorded.
        const { container } = render(<OyonCaptureWidget sessionId="s-3" caseId="c" room="chat" />);
        await runAndEmit(container);
        await waitFor(() => expect(calls('/addons/oyon/consent')).toHaveLength(1));
    });
});
