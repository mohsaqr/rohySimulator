// Regression lock: a learner who consented to the camera before the card offered the heart-rate and breathing-rate switch sees the camera consent again ONCE, with the switch under it, and only while the tenant runs heart rate or respiration (owner decision 2026-10-26, terms 1.2).
//
// The switch is a preference within the one consent, not a new contract: when
// no contract upgrade is due the card writes only `oyon_consent_physio` and
// leaves the camera consent and its version alone; any answer writes that key,
// so the card does not return. Declining an upgrade turns the switch off too.
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

// The tenant runs heart rate unless a test says otherwise: the card is only
// ever due while a heart-rate or respiration switch is on.
const HR_ON = { heart_rate_enabled: true, respiration_enabled: false };

function mockApi({ consentVersion = 'oyon-consent-v2', onboarding = {}, runtime = HR_ON } = {}) {
    apiFetch.mockImplementation((url, opts) => {
        if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, consent_version: consentVersion, runtime });
        if (url === '/users/preferences' && !opts) return Promise.resolve({ onboarding_settings: onboarding });
        return Promise.resolve({});
    });
}

const physioBox = () => screen.getByRole('checkbox', { name: /card_physio_toggle/ });
const lastPut = () => apiFetch.mock.calls.filter(([url, opts]) => url === '/users/preferences' && opts?.method === 'PUT').pop()?.[1].json.onboarding_settings;

beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
});

describe('OyonConsentUpdate — heart-rate and breathing switch', () => {
    it('shows a current consenter with no recorded switch the camera consent once, switch off', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_physio_body')).toBeInTheDocument());
        expect(screen.getByText('card_toggle')).toBeInTheDocument();
        expect(physioBox()).not.toBeChecked();
        // No contract upgrade is due, so the added data classes are not listed.
        expect(screen.queryByText('reconsent_item_typing')).not.toBeInTheDocument();
    });

    it('stays silent once the switch is on record, whichever way', async () => {
        for (const physio of [true, false]) {
            apiFetch.mockReset();
            mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2', oyon_consent_physio: physio } });
            const { unmount } = render(<OyonConsentUpdate />);
            await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/preferences'));
            expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
            unmount();
        }
    });

    it('writes only oyon_consent_physio when no upgrade is due, leaving the consent and its version', async () => {
        localStorage.setItem('oyon.consentVersion', 'oyon-consent-v3');
        mockApi({ consentVersion: 'oyon-consent-v1', onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(physioBox()).toBeInTheDocument());
        fireEvent.click(physioBox());
        fireEvent.click(screen.getByText('reconsent_physio_save'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());
        expect(lastPut()).toEqual({ oyon_consent_physio: true });
        expect(localStorage.getItem('oyon.consentVersion')).toBe('oyon-consent-v3');
    });

    it('"keep it as it is" records the switch off and keeps the camera consent', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(physioBox()).toBeInTheDocument());
        fireEvent.click(physioBox());
        fireEvent.click(screen.getByText('reconsent_decline'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());
        expect(lastPut()).toEqual({ oyon_consent_physio: false });
    });

    it('carries the switch with an upgrade, and declining the upgrade turns it off', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        const { unmount } = render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_item_typing')).toBeInTheDocument());
        fireEvent.click(physioBox());
        fireEvent.click(screen.getByText('reconsent_accept'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());
        expect(lastPut()).toEqual({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v2', oyon_consent_physio: true });
        unmount();

        apiFetch.mockReset();
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1', oyon_consent_physio: true } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(physioBox()).toBeChecked());
        fireEvent.click(screen.getByText('reconsent_decline'));
        await waitFor(() => expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument());
        expect(lastPut()).toEqual({ oyon_consent: false, oyon_consent_version: null, oyon_consent_physio: false });
    });

    // Regression lock: no nagging. With both tenant switches off (the default since rc.89) nobody is asked.
    it('stays silent while the tenant runs neither heart rate nor respiration', async () => {
        for (const runtime of [{ heart_rate_enabled: false, respiration_enabled: false }, {}, null]) {
            apiFetch.mockReset();
            mockApi({ runtime, onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' } });
            const { unmount } = render(<OyonConsentUpdate />);
            await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/preferences'));
            await Promise.resolve();
            expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
            unmount();
        }
    });

    it('asks once an admin turns respiration on, for a consenter with no stored choice', async () => {
        mockApi({
            runtime: { heart_rate_enabled: false, respiration_enabled: true },
            onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' },
        });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_physio_body')).toBeInTheDocument());
    });

    it('still shows a due contract upgrade with both switches off, switch included', async () => {
        mockApi({
            runtime: { heart_rate_enabled: false, respiration_enabled: false },
            onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' },
        });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(screen.getByText('reconsent_item_typing')).toBeInTheDocument());
    });

    it('does not offer the switch to a learner who declined the camera', async () => {
        mockApi({ onboarding: { oyon_consent: false } });
        render(<OyonConsentUpdate />);
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/preferences'));
        expect(screen.queryByText('reconsent_title')).not.toBeInTheDocument();
    });
});
