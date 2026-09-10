/**
 * Regression lock (QA-0019, external pilot v2.9.140): "the typing monitor does
 * not start even if typing monitoring is enabled in Settings → Oyon → Signals →
 * Typing dynamics".
 *
 * The setting was on; the consent RECORD was unusable. Settings → Oyon wrote
 * `oyon_consent: true` with no `oyon_consent_version`, and every reader treats a
 * missing version as v1 — the camera-only contract. So `useOyonSignalGate`
 * refused the widened signal scope, `useSignalCapture` never imported the
 * capture chunk, the chat composer was never attached, and `oyon_signal_windows`
 * stayed empty forever.
 *
 * This test fails against the un-fixed writer: the PUT body carried no version.
 *
 * The version recorded is the CAMERA-ONLY contract, not the tenant's current
 * one: this checkbox describes camera capture and nothing else. Typing rhythm,
 * interaction and discourse are named only by the re-consent prompt, so that is
 * the only surface allowed to record agreement to them. Recording v2 here would
 * be consenting on the learner's behalf to a scope they were never shown — and
 * it also made the written version depend on an async config fetch that has not
 * necessarily landed when the box is clicked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import renderWithProviders from '../../utils/renderWithProviders.jsx';

const apiFetch = vi.fn(async (path) => {
    if (path === '/addons/oyon/config') {
        return { enabled: true, consent_version: 'oyon-consent-v2', runtime: {} };
    }
    return {};
});

vi.mock('../../../src/services/apiClient', () => ({
    apiFetch: (...args) => apiFetch(...args),
    apiGet: (...args) => apiFetch(...args),
    apiPost: (...args) => apiFetch(...args),
    ApiError: class ApiError extends Error {},
}));

import OyonSettingsTab from '../../../src/components/settings/OyonSettingsTab.jsx';
import { OYON_CONSENT_VERSION_LS_KEY } from '../../../src/utils/oyonConsent.js';

const consentPut = () => apiFetch.mock.calls.find(
    ([path, opts]) => path === '/users/preferences'
        && opts?.json?.onboarding_settings
        && 'oyon_consent' in opts.json.onboarding_settings,
);

beforeEach(() => { apiFetch.mockClear(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('Settings → Oyon consent toggle records WHICH contract was accepted', () => {
    it('sends the accepted version alongside the grant', async () => {
        const { findByRole } = renderWithProviders(<OyonSettingsTab />);
        const box = await findByRole('checkbox', { name: /Capture emotions during my simulation sessions/i });

        // It defaults to ticked, so untick then re-tick to record a grant.
        fireEvent.click(box);
        await waitFor(() => expect(consentPut()).toBeTruthy());
        apiFetch.mockClear();
        fireEvent.click(box);

        await waitFor(() => expect(consentPut()).toBeTruthy());
        const [, opts] = consentPut();
        expect(opts.json.onboarding_settings).toEqual({
            oyon_consent: true,
            oyon_consent_version: 'oyon-consent-v1',
        });
        expect(localStorage.getItem(OYON_CONSENT_VERSION_LS_KEY)).toBe('oyon-consent-v1');
    });

    // The recorded version must not depend on a fetch that may not have landed:
    // clicking the instant the tab opens has to write the same contract as
    // clicking a minute later.
    it('records the same contract whether or not the config fetch has landed', async () => {
        apiFetch.mockImplementation(async (path) => {
            if (path === '/addons/oyon/config') return new Promise(() => {}); // never resolves
            return {};
        });
        const { findByRole } = renderWithProviders(<OyonSettingsTab />);
        const box = await findByRole('checkbox', { name: /Capture emotions during my simulation sessions/i });
        fireEvent.click(box);
        fireEvent.click(box);
        await waitFor(() => expect(consentPut()).toBeTruthy());
        const grant = apiFetch.mock.calls.filter(
            ([path, opts]) => path === '/users/preferences' && opts?.json?.onboarding_settings?.oyon_consent === true,
        ).pop();
        expect(grant[1].json.onboarding_settings.oyon_consent_version).toBe('oyon-consent-v1');
    });

    it('clears the recorded version when consent is withdrawn', async () => {
        localStorage.setItem(OYON_CONSENT_VERSION_LS_KEY, 'oyon-consent-v2');
        const { findByRole } = renderWithProviders(<OyonSettingsTab />);
        const box = await findByRole('checkbox', { name: /Capture emotions during my simulation sessions/i });

        fireEvent.click(box);
        await waitFor(() => expect(consentPut()).toBeTruthy());
        const [, opts] = consentPut();
        expect(opts.json.onboarding_settings.oyon_consent).toBe(false);
        expect(opts.json.onboarding_settings.oyon_consent_version).toBeNull();
        expect(localStorage.getItem(OYON_CONSENT_VERSION_LS_KEY)).toBeNull();
    });
});
