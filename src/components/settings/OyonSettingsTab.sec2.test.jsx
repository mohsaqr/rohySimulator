// Regression lock: Settings → Oyon shows the heart-rate and breathing-rate estimates as a switch under the one camera consent (owner decision 2026-10-26, terms 1.2).
//
// Ingest stores heart rate and respiration only when the learner's record
// holds `oyon_consent_physio === true` (rc.89). The switch is hidden while the
// camera consent is off, starts off, writes the key through the preferences
// PUT, and giving or withdrawing the camera consent writes it back to false.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../services/apiClient';
import OyonSettingsTab from './OyonSettingsTab';

vi.mock('../../services/apiClient', () => {
    class ApiError extends Error {}
    return { apiFetch: vi.fn(), ApiError };
});
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, isAdmin: () => false }) }));

const CONSENT = /Allow camera-based learning measures during my sessions/i;
const PHYSIO = /Also estimate my heart rate and breathing rate/i;

function routeApi(onboarding = {}) {
    apiFetch.mockImplementation((url, opts) => {
        if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, consent_version: 'oyon-consent-v2' });
        if (url === '/users/preferences' && !opts) return Promise.resolve({ onboarding_settings: JSON.stringify(onboarding) });
        return Promise.resolve({ total: 0 });
    });
}

const puts = () => apiFetch.mock.calls
    .filter(([url, opts]) => url === '/users/preferences' && opts?.method === 'PUT')
    .map(([, opts]) => opts.json.onboarding_settings);

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

describe('Settings → Oyon heart-rate and breathing switch', () => {
    it('is hidden while the camera consent is off', async () => {
        routeApi();
        render(<OyonSettingsTab />);
        expect(await screen.findByRole('checkbox', { name: CONSENT })).not.toBeChecked();
        expect(screen.queryByRole('checkbox', { name: PHYSIO })).toBeNull();
    });

    it('appears off when the consent is given, and the grant writes oyon_consent_physio: false', async () => {
        routeApi();
        render(<OyonSettingsTab />);
        fireEvent.click(await screen.findByRole('checkbox', { name: CONSENT }));
        expect(screen.getByRole('checkbox', { name: PHYSIO })).not.toBeChecked();
        await waitFor(() => expect(puts()).toContainEqual({
            oyon_consent: true, oyon_consent_version: 'oyon-consent-v1', oyon_consent_physio: false,
        }));
    });

    it('writes oyon_consent_physio: true and then false through the preferences PUT', async () => {
        localStorage.setItem('oyon.defaultConsent', '1');
        routeApi({ oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' });
        render(<OyonSettingsTab />);
        const physio = await screen.findByRole('checkbox', { name: PHYSIO });
        fireEvent.click(physio);
        await waitFor(() => expect(puts()).toContainEqual({ oyon_consent_physio: true }));
        expect(physio).toBeChecked();
        fireEvent.click(physio);
        await waitFor(() => expect(puts()).toContainEqual({ oyon_consent_physio: false }));
    });

    it('shows a stored "on" from the account record', async () => {
        localStorage.setItem('oyon.defaultConsent', '1');
        routeApi({ oyon_consent: true, oyon_consent_physio: true });
        render(<OyonSettingsTab />);
        const physio = await screen.findByRole('checkbox', { name: PHYSIO });
        await waitFor(() => expect(physio).toBeChecked());
    });

    it('withdrawing the camera consent turns the switch off and records it off', async () => {
        localStorage.setItem('oyon.defaultConsent', '1');
        routeApi({ oyon_consent: true, oyon_consent_physio: true });
        render(<OyonSettingsTab />);
        await waitFor(() => expect(screen.getByRole('checkbox', { name: PHYSIO })).toBeChecked());
        fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
        expect(screen.queryByRole('checkbox', { name: PHYSIO })).toBeNull();
        await waitFor(() => expect(puts()).toContainEqual({
            oyon_consent: false, oyon_consent_version: null, oyon_consent_physio: false,
        }));
        fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
        expect(screen.getByRole('checkbox', { name: PHYSIO })).not.toBeChecked();
    });
});
