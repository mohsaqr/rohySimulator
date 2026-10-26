import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import OyonCaptureWidget, { readConsentPref } from './OyonCaptureWidget.jsx';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    loadOyonElement: vi.fn(),
    language: 'en',
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key) => key,
        i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    }),
}));

vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => mocks.apiFetch(...args),
}));

vi.mock('./loadOyonElement', () => ({
    loadOyonElement: (...args) => mocks.loadOyonElement(...args),
}));

vi.mock('./screenAois', () => ({
    getAois: () => [],
    onAois: () => () => {},
}));

vi.mock('./clientLogger', () => ({
    oyonClientLog: vi.fn(),
}));

function apiCalls(path) {
    return mocks.apiFetch.mock.calls.filter(([url]) => url === path);
}

describe('OyonCaptureWidget persistence gate', () => {
    beforeEach(() => {
        mocks.loadOyonElement.mockResolvedValue(undefined);
        mocks.apiFetch.mockImplementation((url) => {
            if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, runtime: {} });
            if (url === '/addons/oyon/consent') return Promise.resolve({});
            if (url === '/addons/oyon/emotion-records') return Promise.resolve({});
            // The server holds the learner's choice: with no stored choice the
            // widget now clears a local '1' (it may be the previous person's,
            // L5-03 — OyonCaptureWidget.sec2.test.jsx), so the persisting
            // cases below say "consented" where the truth lives.
            if (url === '/users/preferences') return Promise.resolve({ onboarding_settings: { oyon_consent: true } });
            return Promise.resolve({});
        });
        localStorage.setItem('oyon.defaultConsent', '1');
    });

    afterEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('opens persistence when a session id appears after capture is already running', async () => {
        const { container, rerender } = render(
            <OyonCaptureWidget sessionId={null} caseId="case-1" room="chat" />,
        );

        await waitFor(() => expect(mocks.loadOyonElement).toHaveBeenCalled());
        const el = container.querySelector('oyon-app');
        expect(el).toBeTruthy();

        await act(async () => {
            el.dispatchEvent(new CustomEvent('oyon:status', { detail: { state: 'running' } }));
        });
        expect(apiCalls('/addons/oyon/consent')).toHaveLength(0);

        rerender(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="consultant" />);
        await waitFor(() => expect(apiCalls('/addons/oyon/consent')).toHaveLength(1));

        await act(async () => {
            el.dispatchEvent(new CustomEvent('oyon:window', {
                detail: { windows: [{ record_id: 'w-1', dominant_emotion: 'neutral' }] },
            }));
        });

        await waitFor(() => expect(apiCalls('/addons/oyon/emotion-records')).toHaveLength(1));
        const [, request] = apiCalls('/addons/oyon/emotion-records')[0];
        expect(request.json.session_id).toBe('s-1');
        expect(request.json.events[0].room).toBe('consultant');
    });

    // Regression lock: the capture pill spoke English in every UI language (Oyon had no lang input); rohy now passes the UI language at creation and live, without tearing the camera element down (Oyon 3.3.3, 2026-10-04)
    it('passes the UI language to the element, and follows a switch without replacing it', async () => {
        mocks.language = 'de';
        const { container, rerender } = render(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="chat" />);
        await waitFor(() => expect(container.querySelector('oyon-app')).toBeTruthy());
        const el = container.querySelector('oyon-app');
        expect(el.getAttribute('lang')).toBe('de');

        mocks.language = 'fi';
        rerender(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="chat" />);
        await waitFor(() => expect(el.getAttribute('lang')).toBe('fi'));
        expect(container.querySelector('oyon-app')).toBe(el);
        expect(mocks.loadOyonElement).toHaveBeenCalledTimes(1);
        mocks.language = 'en';
    });

    // Regression lock: readConsentPref treated "nothing stored" (and unreadable storage) as consent, and a failed preference fetch fell back to it, so affect windows were persisted for learners who never chose
    describe('consent is only an explicit choice', () => {
        async function runAndEmitWindow(container) {
            await waitFor(() => expect(container.querySelector('oyon-app')).toBeTruthy());
            const el = container.querySelector('oyon-app');
            await act(async () => {
                el.dispatchEvent(new CustomEvent('oyon:status', { detail: { state: 'running' } }));
            });
            await act(async () => {
                el.dispatchEvent(new CustomEvent('oyon:window', {
                    detail: { windows: [{ record_id: 'w-1', dominant_emotion: 'neutral' }] },
                }));
            });
            // Let any (wrong) persistence call settle before asserting its absence.
            await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        }

        it('reads missing, \'0\', garbage and unreadable storage as NOT consented', () => {
            localStorage.removeItem('oyon.defaultConsent');
            expect(readConsentPref()).toBe(false);
            localStorage.setItem('oyon.defaultConsent', '0');
            expect(readConsentPref()).toBe(false);
            localStorage.setItem('oyon.defaultConsent', 'true');
            expect(readConsentPref()).toBe(false);
            localStorage.setItem('oyon.defaultConsent', '1');
            expect(readConsentPref()).toBe(true);
            const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
            try { expect(readConsentPref()).toBe(false); } finally { spy.mockRestore(); }
        });

        it('persists nothing when no choice was ever stored', async () => {
            localStorage.removeItem('oyon.defaultConsent');
            const base = mocks.apiFetch.getMockImplementation();
            mocks.apiFetch.mockImplementation((url, ...rest) => (url === '/users/preferences'
                ? Promise.resolve({}) : base(url, ...rest)));
            const { container } = render(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="chat" />);
            await runAndEmitWindow(container);
            expect(apiCalls('/addons/oyon/consent')).toHaveLength(0);
            expect(apiCalls('/addons/oyon/emotion-records')).toHaveLength(0);
        });

        it('persists nothing when the server preference cannot be read, even with a local \'1\'', async () => {
            localStorage.setItem('oyon.defaultConsent', '1');
            mocks.apiFetch.mockImplementation((url) => {
                if (url === '/users/preferences') return Promise.reject(new Error('503'));
                if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, runtime: {} });
                return Promise.resolve({});
            });
            const { container } = render(<OyonCaptureWidget sessionId="s-1" caseId="case-1" room="chat" />);
            await waitFor(() => expect(apiCalls('/users/preferences')).toHaveLength(1));
            await runAndEmitWindow(container);
            expect(apiCalls('/addons/oyon/consent')).toHaveLength(0);
            expect(apiCalls('/addons/oyon/emotion-records')).toHaveLength(0);
        });
    });
});
