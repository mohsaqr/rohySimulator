// Re-consent prompt contract.
//
// The prompt exists because the first-run consent card is gated behind
// `first_run_done`, so every EXISTING learner — precisely those whose consent
// predates the widened contract — would otherwise never be asked.
//
// The properties that matter: it asks the right people, it does not nag the
// wrong ones, it records the version actually SHOWN, and it never blocks the app.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k) => k }),
}));

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('./OyonCaptureWidget', () => ({ CONSENT_PREF_KEY: 'oyon.defaultConsent' }));

const OyonConsentUpdate = (await import('./OyonConsentUpdate')).default;

function mockApi({ enabled = true, consentVersion = 'oyon-consent-v2', onboarding = {} } = {}) {
    apiFetch.mockImplementation((url, opts) => {
        if (url === '/addons/oyon/config') {
            return Promise.resolve({ enabled, consent_version: consentVersion });
        }
        if (url === '/users/preferences' && !opts) {
            return Promise.resolve({ onboarding_settings: onboarding });
        }
        return Promise.resolve({});
    });
}

beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
});

describe('OyonConsentUpdate', () => {
    it('asks a learner who accepted only the older contract', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_title')).toBeInTheDocument());
        // The added data classes are named, not summarised away.
        expect(screen.getByText('reconsent_item_typing')).toBeInTheDocument();
        expect(screen.getByText('reconsent_item_interaction')).toBeInTheDocument();
        expect(screen.getByText('reconsent_item_discourse')).toBeInTheDocument();
    });

    it('stays silent once the learner is on the current contract', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
    });

    // Declining is an answer, not an absence of one.
    it('does not nag a learner who previously declined', async () => {
        mockApi({ onboarding: { oyon_consent: false, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
    });

    // Anyone who has not finished the welcome page is asked there, not here.
    it('stays out of the way of a student still due the welcome page', async () => {
        mockApi({ onboarding: {} });
        render(<OyonConsentUpdate role="student" />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
        expect(screen.queryByText('consent_ask_title')).not.toBeInTheDocument();
    });

    // Regression lock: admins and educators never see the student welcome page,
    // so a never-answered account was asked nowhere and capture never ran on it.
    it('asks an admin who has never answered, naming the camera and every signal, and records the version shown', async () => {
        mockApi({ consentVersion: 'oyon-consent-v3', onboarding: {} });
        render(<OyonConsentUpdate role="admin" />);
        await waitFor(() => expect(screen.getByText('consent_ask_title')).toBeInTheDocument());
        expect(screen.queryByText('reconsent_body')).not.toBeInTheDocument();
        for (const item of ['consent_item_camera', 'reconsent_item_typing', 'reconsent_item_voice']) {
            expect(screen.getByText(item)).toBeInTheDocument();
        }
        // No "keeps your existing choice" note: there is no existing choice.
        expect(screen.getByText('consent_ask_note_voice')).toBeInTheDocument();
        expect(screen.queryByText('reconsent_note_voice')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('consent_ask_accept'));
        await waitFor(() => expect(screen.queryByText('consent_ask_title')).not.toBeInTheDocument());
        const put = apiFetch.mock.calls.find(([url, opts]) => url === '/users/preferences' && opts?.method === 'PUT');
        expect(put[1].json.onboarding_settings).toEqual({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' });
    });

    it('asks a student who finished the welcome page without answering', async () => {
        mockApi({ onboarding: { first_run_done: 99 } });
        render(<OyonConsentUpdate role="student" />);
        await waitFor(() => expect(screen.getByText('consent_ask_title')).toBeInTheDocument());
    });

    it('says nothing when the tenant runs no Oyon', async () => {
        mockApi({ enabled: false, onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
    });

    it('records the version it displayed, and dismisses', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_title')).toBeInTheDocument());

        fireEvent.click(screen.getByText('reconsent_accept'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());

        const put = apiFetch.mock.calls.find(([url, opts]) => url === '/users/preferences' && opts?.method === 'PUT');
        expect(put[1].json.onboarding_settings).toEqual({
            oyon_consent: true,
            oyon_consent_version: 'oyon-consent-v2',
        });
        expect(localStorage.getItem('oyon.consentVersion')).toBe('oyon-consent-v2');
    });

    it('records a refusal so the prompt does not return', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_title')).toBeInTheDocument());

        fireEvent.click(screen.getByText('reconsent_decline'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());

        const put = apiFetch.mock.calls.find(([url, opts]) => url === '/users/preferences' && opts?.method === 'PUT');
        expect(put[1].json.onboarding_settings.oyon_consent).toBe(false);
        expect(put[1].json.onboarding_settings.oyon_consent_version).toBeNull();
        expect(localStorage.getItem('oyon.consentVersion')).toBeNull();
    });

    // A consent probe must never be able to take the app down.
    it('renders nothing when the probe fails', async () => {
        apiFetch.mockRejectedValue(new Error('offline'));
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
    });

    // Regression lock (consent v3). The card records the version it displays,
    // so asking for v3 without naming the microphone would repeat the exact
    // mistake v2 made: accepting a contract whose card never mentions audio.
    it('names the microphone and AI assistance when it asks for v3', async () => {
        mockApi({
            consentVersion: 'oyon-consent-v3',
            onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' },
        });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_title')).toBeInTheDocument());
        expect(screen.getByText('reconsent_item_voice')).toBeInTheDocument();
        expect(screen.getByText('reconsent_item_ai_assist')).toBeInTheDocument();
        // Voice keeps a per-frame series, so "only summaries are stored" is untrue.
        expect(screen.getByText('reconsent_note_voice')).toBeInTheDocument();
        expect(screen.queryByText('reconsent_note')).not.toBeInTheDocument();
    });

    it('does not mention the microphone when it asks only for v2', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_title')).toBeInTheDocument());
        expect(screen.queryByText('reconsent_item_voice')).not.toBeInTheDocument();
        expect(screen.queryByText('reconsent_item_ai_assist')).not.toBeInTheDocument();
        expect(screen.getByText('reconsent_note')).toBeInTheDocument();
    });
});
