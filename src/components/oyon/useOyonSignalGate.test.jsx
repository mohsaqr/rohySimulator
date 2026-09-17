// Gate contract: when host-driven signal capture may run, and when it must
// not. Both directions matter — a gate stuck closed loses data silently, a
// gate stuck open sends windows the server will drop as consent_blocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const { useOyonSignalGate } = await import('./useOyonSignalGate.js');
const { resetSessionConsentCache } = await import('./ensureSessionConsent.js');

const RUNTIME = { typing_enabled: true, interaction_enabled: false, discourse_enabled: false, ai_assist_enabled: false };

function mockApi({
    enabled = true,
    consentVersion = 'oyon-consent-v2',
    runtime = RUNTIME,
    onboarding = { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' },
    consentPost = () => Promise.resolve({}),
} = {}) {
    apiFetch.mockImplementation((url, opts) => {
        if (url === '/addons/oyon/config') return Promise.resolve({ enabled, consent_version: consentVersion, runtime });
        if (url === '/users/preferences') return Promise.resolve({ onboarding_settings: onboarding });
        if (url === '/addons/oyon/consent' && opts?.method === 'POST') return consentPost();
        return Promise.resolve({});
    });
}

const consentPosts = () => apiFetch.mock.calls.filter(([u, o]) => u === '/addons/oyon/consent' && o?.method === 'POST');

beforeEach(() => {
    apiFetch.mockReset();
    resetSessionConsentCache();
});

describe('useOyonSignalGate', () => {
    it('opens once the tenant, the consent and the session all agree', async () => {
        mockApi();
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(result.current.persist).toBe(true));
        expect(result.current.enabled).toBe(true);
        expect(result.current.runtimeConfig).toEqual(RUNTIME);
        expect(consentPosts()).toHaveLength(1);
    });

    // Regression lock (Prova PRV-5): the gate used to read consent once, at
    // mount. A learner who accepted the consent prompt on this page — every
    // new learner does, straight after the welcome page — got no typing or
    // voice capture until a reload.
    it('opens without a reload when consent is accepted on this page', async () => {
        let onboarding = { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' };
        apiFetch.mockImplementation((url, opts) => {
            if (url === '/addons/oyon/config') return Promise.resolve({ enabled: true, consent_version: 'oyon-consent-v3', runtime: RUNTIME });
            if (url === '/users/preferences') return Promise.resolve({ onboarding_settings: onboarding });
            if (url === '/addons/oyon/consent' && opts?.method === 'POST') return Promise.resolve({});
            return Promise.resolve({});
        });
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/preferences'));
        await act(async () => {});
        expect(result.current.enabled).toBe(false);

        onboarding = { oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' };
        const { announceOyonConsentChanged } = await import('../../utils/oyonConsent.js');
        await act(async () => { announceOyonConsentChanged(); });
        await waitFor(() => expect(result.current.persist).toBe(true));
        expect(result.current.runtimeConfig).toEqual(RUNTIME);
    });

    // v1 was camera-only. A learner still on it consented to affect capture,
    // not to keystroke dynamics.
    it('stays shut for a learner still on the camera-only contract', async () => {
        mockApi({ onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v1' } });
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        await act(async () => {});
        expect(result.current.enabled).toBe(false);
        expect(consentPosts()).toHaveLength(0);
    });

    it.each([
        ['the tenant runs no Oyon', { enabled: false }],
        ['the learner declined', { onboarding: { oyon_consent: false } }],
        ['no modality is enabled', { runtime: { typing_enabled: false } }],
    ])('stays shut when %s', async (_label, override) => {
        mockApi(override);
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        await act(async () => {});
        expect(result.current.enabled).toBe(false);
    });

    // Regression lock: the server gates ingest on the consent ROW. A failed
    // POST must read as "do not send", never as "fine" — otherwise every
    // window is silently dropped server-side with no client symptom.
    it('does not persist when the consent POST fails', async () => {
        mockApi({ consentPost: () => Promise.reject(new Error('offline')) });
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(result.current.enabled).toBe(true));
        await act(async () => {});
        expect(result.current.persist).toBe(false);
    });

    it('re-confirms the row for a new session', async () => {
        mockApi();
        const { result, rerender } = renderHook(sid => useOyonSignalGate(sid), { initialProps: 's1' });
        await waitFor(() => expect(result.current.persist).toBe(true));

        rerender('s2');
        // Not yet confirmed for s2 — the old session's row must not carry over.
        expect(result.current.persist).toBe(false);
        await waitFor(() => expect(result.current.persist).toBe(true));
        expect(consentPosts()).toHaveLength(2);
    });

    it('survives a config probe that fails', async () => {
        apiFetch.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(result.current.enabled).toBe(false);
        expect(result.current.runtimeConfig).toBeNull();
    });
});

describe('ensureSessionConsent', () => {
    // POST /addons/oyon/consent is a plain INSERT, so two callers racing on
    // mount would write two audit rows for one session.
    it('posts once per session however many callers ask', async () => {
        mockApi();
        const a = renderHook(() => useOyonSignalGate('s1'));
        const b = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(a.result.current.persist).toBe(true));
        await waitFor(() => expect(b.result.current.persist).toBe(true));
        expect(consentPosts()).toHaveLength(1);
    });

    // A cached rejection would strand the session with no row forever.
    it('lets a later caller retry after a failure', async () => {
        let attempt = 0;
        mockApi({ consentPost: () => (++attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({})) });

        const first = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(consentPosts()).toHaveLength(1));
        await act(async () => {});
        expect(first.result.current.persist).toBe(false);

        const second = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(second.result.current.persist).toBe(true));
        expect(consentPosts()).toHaveLength(2);
    });

    // Regression lock (consent v3). A tenant with voice on requires v3, the
    // NEWEST contract any enabled modality needs. An all-or-nothing gate against
    // that version stopped typing for every learner holding v2 — although v2
    // names typing and the server still accepts it. Coverage is per modality.
    it('keeps typing for a v2 learner when the tenant turns voice on', async () => {
        mockApi({
            consentVersion: 'oyon-consent-v3',
            runtime: { typing_enabled: true, interaction_enabled: false, discourse_enabled: false,
                ai_assist_enabled: false, voice_enabled: true },
            onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v2' },
        });
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(result.current.persist).toBe(true));
        expect(result.current.enabled).toBe(true);
        expect(result.current.runtimeConfig.typing_enabled).toBe(true);
        // …and never the modality v2 does not name.
        expect(result.current.runtimeConfig.voice_enabled).toBe(false);
    });

    it('lets voice through once the learner has accepted v3', async () => {
        mockApi({
            consentVersion: 'oyon-consent-v3',
            runtime: { typing_enabled: true, voice_enabled: true },
            onboarding: { oyon_consent: true, oyon_consent_version: 'oyon-consent-v3' },
        });
        const { result } = renderHook(() => useOyonSignalGate('s1'));
        await waitFor(() => expect(result.current.persist).toBe(true));
        expect(result.current.runtimeConfig.typing_enabled).toBe(true);
        expect(result.current.runtimeConfig.voice_enabled).toBe(true);
    });
});
