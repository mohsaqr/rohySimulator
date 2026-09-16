// Regression lock: the student welcome screen's "Your first case" card.
//
// GET /cases answers `{ cases: [...] }`, never a bare array, but the card
// guarded on `Array.isArray(list)` — so it showed "No case is published for
// you yet" on every install, however many cases were published, and the bare
// `.catch(() => {})` made a real failure look identical to an empty catalogue
// (2026-08-30 UI review, #13).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../services/apiClient', () => ({
    apiFetch: vi.fn(),
    apiPut: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: vi.fn(() => ({ user: { id: 7, role: 'student' } })),
}));
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: vi.fn(() => ({ uiLanguage: 'en', setUiLanguage: vi.fn(() => Promise.resolve()) })),
}));

import StudentFirstRun from './StudentFirstRun.jsx';
import { apiFetch, apiPut } from '../../services/apiClient';

const CASE = {
    id: 3,
    case_code: 'EN-0003',
    name: 'Acute chest pain',
    is_published: 1,
    config: { case_language: 'en', patient_name: 'Alice' },
};

/** Route the component's three parallel mount fetches. */
function routeFetches({ cases = { cases: [CASE] }, casesRejects = null, oyon = { enabled: false } } = {}) {
    apiFetch.mockImplementation((path) => {
        if (path === '/cases') {
            return casesRejects ? Promise.reject(casesRejects) : Promise.resolve(cases);
        }
        if (path === '/platform-settings/voice') return Promise.resolve({ voice_mode_enabled: false });
        if (path === '/addons/oyon/config') return Promise.resolve(oyon);
        return Promise.resolve({});
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('StudentFirstRun — first case card', () => {
    // Regression lock: the card reads `cases` off the response envelope.
    it('renders the landing case from a { cases: [...] } response', async () => {
        routeFetches();
        render(<StudentFirstRun onDone={() => {}} />);

        await waitFor(() => expect(screen.getByText('EN-0003')).toBeInTheDocument());
        expect(screen.queryByText(/No case is published for you yet/i)).toBeNull();
    });

    it('says nothing is published only when the catalogue really is empty', async () => {
        routeFetches({ cases: { cases: [] } });
        render(<StudentFirstRun onDone={() => {}} />);

        await waitFor(() =>
            expect(screen.getByText(/No case is published for you yet/i)).toBeInTheDocument()
        );
    });

    // Regression lock: a failed load is its own message, not a silent
    // "nothing published" lie, and it is logged rather than swallowed.
    it('distinguishes a failed load from an empty catalogue', async () => {
        routeFetches({ casesRejects: new Error('boom') });
        render(<StudentFirstRun onDone={() => {}} />);

        await waitFor(() =>
            expect(screen.getByText(/couldn't load your cases/i)).toBeInTheDocument()
        );
        expect(screen.queryByText(/No case is published for you yet/i)).toBeNull();
        expect(console.error).toHaveBeenCalled();
    });
});

// Regression lock: the emotion-capture card records the contract it SHOWS.
//
// Its checkbox says "Allow camera-based emotion capture during my sessions" and
// it is pre-checked. It used to record the tenant's ADVERTISED version, so a
// student who clicked Start without unticking it was stored as accepting v2 —
// typing, interaction and discourse — and, on a tenant with voice on, v3:
// microphone capture, from a card that never mentions a microphone. The
// advertised version is set to v3 here because that is the worst case.
describe('StudentFirstRun — emotion-capture consent', () => {
    it('records camera-only consent, whatever version the tenant advertises', async () => {
        routeFetches({ oyon: { enabled: true, consent_version: 'oyon-consent-v3' } });
        render(<StudentFirstRun onDone={() => {}} />);

        const box = await screen.findByLabelText(/Allow camera-based emotion capture/i);
        expect(box).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: /Start/i }));

        await waitFor(() => expect(apiPut).toHaveBeenCalled());
        const [, body] = apiPut.mock.calls.find(([path]) => path === '/users/preferences');
        expect(body.onboarding_settings.oyon_consent).toBe(true);
        expect(body.onboarding_settings.oyon_consent_version).toBe('oyon-consent-v1');
    });

    it('records no version when the learner unticks the box', async () => {
        routeFetches({ oyon: { enabled: true, consent_version: 'oyon-consent-v3' } });
        render(<StudentFirstRun onDone={() => {}} />);

        fireEvent.click(await screen.findByLabelText(/Allow camera-based emotion capture/i));
        fireEvent.click(screen.getByRole('button', { name: /Start/i }));

        await waitFor(() => expect(apiPut).toHaveBeenCalled());
        const [, body] = apiPut.mock.calls.find(([path]) => path === '/users/preferences');
        expect(body.onboarding_settings.oyon_consent).toBe(false);
        expect(body.onboarding_settings.oyon_consent_version).toBeNull();
    });
});
