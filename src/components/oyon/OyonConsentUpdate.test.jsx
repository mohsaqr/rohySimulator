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

    // Someone who never answered belongs to the first-run card, not here.
    it('stays out of the way of a learner who has never answered', async () => {
        mockApi({ onboarding: {} });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
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
});
