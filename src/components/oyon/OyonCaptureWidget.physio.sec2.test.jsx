// Regression lock: the browser runs the heart-rate and respiration estimators only when the learner turned on the switch under the camera consent (oyon_consent_physio, terms 1.2), whatever the tenant switch says.
//
// rc.89 made ingest DROP those blocks without the learner's switch, but the
// <oyon-app> element still estimated them whenever the tenant switch was on —
// and its own defaults turn both on when the key is missing. The widget now
// writes both as explicit `false` into the element's `settings` unless the
// learner's record says `true`, and updates the attribute when the choice changes.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import OyonCaptureWidget from './OyonCaptureWidget.jsx';
import { maskPhysiological } from './captureBridge';
import { announceOyonConsentChanged } from '../../utils/oyonConsent';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), loadOyonElement: vi.fn(), prefs: null, runtime: null }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k) => k, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => mocks.apiFetch(...a) }));
vi.mock('./loadOyonElement', () => ({ loadOyonElement: (...a) => mocks.loadOyonElement(...a) }));
vi.mock('./screenAois', () => ({ getAois: () => [], onAois: () => () => {} }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const TENANT_ON = { heart_rate_enabled: true, respiration_enabled: true, gaze_tracking_enabled: true };

const settingsOf = (container) => JSON.parse(container.querySelector('oyon-app').getAttribute('settings'));
const elementCreated = async (container) => {
    await waitFor(() => expect(container.querySelector('oyon-app')).not.toBeNull());
};

describe('maskPhysiological', () => {
    it('writes both estimators off unless the learner allowed them', () => {
        expect(maskPhysiological(TENANT_ON, false)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false, gaze_tracking_enabled: true });
        expect(maskPhysiological(TENANT_ON, undefined)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false });
        expect(maskPhysiological(null, false)).toEqual({ heart_rate_enabled: false, respiration_enabled: false });
    });

    it('keeps the tenant switch on top of the learner\'s yes, and reads a missing tenant flag as off', () => {
        expect(maskPhysiological(TENANT_ON, true)).toMatchObject({ heart_rate_enabled: true, respiration_enabled: true });
        expect(maskPhysiological({ heart_rate_enabled: false, respiration_enabled: true }, true))
            .toMatchObject({ heart_rate_enabled: false, respiration_enabled: true });
        expect(maskPhysiological({}, true)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false });
    });
});

describe('OyonCaptureWidget heart-rate and respiration estimators', () => {
    beforeEach(() => {
        mocks.loadOyonElement.mockResolvedValue(undefined);
        mocks.runtime = TENANT_ON;
        mocks.apiFetch.mockImplementation((url) => {
            if (url === '/users/preferences') return mocks.prefs;
            if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, runtime: mocks.runtime });
            return Promise.resolve({});
        });
    });
    afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

    it('are off with the tenant switch on when the learner never turned the switch on', async () => {
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: true } });
        const { container } = render(<OyonCaptureWidget sessionId="p-1" caseId="c" room="chat" />);
        await elementCreated(container);
        await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/users/preferences'));
        await act(async () => { await mocks.prefs; });
        expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false, gaze_tracking_enabled: true });
    });

    it('are off when the switch is on but the camera consent is not', async () => {
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: false, oyon_consent_physio: true } });
        const { container } = render(<OyonCaptureWidget sessionId="p-2" caseId="c" room="chat" />);
        await elementCreated(container);
        await act(async () => { await mocks.prefs; });
        expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false });
    });

    it('stay off until the lookup lands, then follow the learner\'s yes', async () => {
        let resolvePrefs;
        mocks.prefs = new Promise((r) => { resolvePrefs = r; });
        const { container } = render(<OyonCaptureWidget sessionId="p-3" caseId="c" room="chat" />);
        await elementCreated(container);
        expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false });
        await act(async () => { resolvePrefs({ onboarding_settings: { oyon_consent: true, oyon_consent_physio: true } }); });
        await waitFor(() => expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: true, respiration_enabled: true }));
    });

    it('cannot be turned on by the learner where the tenant switch is off', async () => {
        mocks.runtime = { heart_rate_enabled: false, respiration_enabled: false };
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: true, oyon_consent_physio: true } });
        const { container } = render(<OyonCaptureWidget sessionId="p-4" caseId="c" room="chat" />);
        await elementCreated(container);
        await act(async () => { await mocks.prefs; });
        expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false });
    });

    it('switch off again when the learner turns the switch off while the widget is mounted', async () => {
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: true, oyon_consent_physio: true } });
        const { container } = render(<OyonCaptureWidget sessionId="p-5" caseId="c" room="chat" />);
        await elementCreated(container);
        await waitFor(() => expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: true }));
        mocks.prefs = Promise.resolve({ onboarding_settings: { oyon_consent: true, oyon_consent_physio: false } });
        await act(async () => { announceOyonConsentChanged(); });
        await waitFor(() => expect(settingsOf(container)).toMatchObject({ heart_rate_enabled: false, respiration_enabled: false }));
    });
});
