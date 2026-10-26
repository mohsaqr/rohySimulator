// Regression lock: one camera consent, with the heart-rate and breathing-rate estimates as a switch under it (owner decision 2026-10-26, terms 1.2).
//
// rc.89 made ingest store heart rate and respiration only when the learner's
// record holds `oyon_consent_physio === true`, and no surface wrote it.
// The welcome card now shows the switch under the camera consent: hidden until
// the consent is ticked, off by default, and reset when the consent is unticked.
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

const CONSENT = /Allow camera-based learning measures during my sessions/i;
const PHYSIO = /Also estimate my heart rate and breathing rate/i;

function routeFetches() {
    apiFetch.mockImplementation((path) => {
        if (path === '/cases') return Promise.resolve({ cases: [] });
        if (path === '/platform-settings/voice') return Promise.resolve({ voice_mode_enabled: false });
        if (path === '/addons/oyon/config') return Promise.resolve({ enabled: true, consent_version: 'oyon-consent-v2' });
        return Promise.resolve({});
    });
}

const savedOnboarding = async () => {
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    return apiPut.mock.calls.find(([path]) => path === '/users/preferences')[1].onboarding_settings;
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    routeFetches();
});

describe('StudentFirstRun — heart-rate and breathing switch under the camera consent', () => {
    it('names facial expression, gaze and the optional heart rate and breathing in the one consent', async () => {
        render(<StudentFirstRun onDone={() => {}} />);
        const box = await screen.findByLabelText(CONSENT);
        expect(box.closest('label').textContent).toMatch(/facial expression and gaze; optionally heart rate and breathing/);
    });

    it('hides the switch until the camera consent is ticked', async () => {
        render(<StudentFirstRun onDone={() => {}} />);
        await screen.findByLabelText(CONSENT);
        expect(screen.queryByLabelText(PHYSIO)).toBeNull();
        fireEvent.click(screen.getByLabelText(CONSENT));
        expect(screen.getByLabelText(PHYSIO)).not.toBeChecked();
    });

    it('records the switch as off when the student consents without turning it on', async () => {
        render(<StudentFirstRun onDone={() => {}} />);
        fireEvent.click(await screen.findByLabelText(CONSENT));
        fireEvent.click(screen.getByRole('button', { name: /Start/i }));
        expect(await savedOnboarding()).toMatchObject({ oyon_consent: true, oyon_consent_physio: false });
    });

    it('records oyon_consent_physio: true when the student turns the switch on', async () => {
        render(<StudentFirstRun onDone={() => {}} />);
        fireEvent.click(await screen.findByLabelText(CONSENT));
        fireEvent.click(screen.getByLabelText(PHYSIO));
        fireEvent.click(screen.getByRole('button', { name: /Start/i }));
        expect(await savedOnboarding()).toMatchObject({
            oyon_consent: true,
            oyon_consent_version: 'oyon-consent-v1',
            oyon_consent_physio: true,
        });
    });

    it('unticking the camera consent turns the switch off too', async () => {
        render(<StudentFirstRun onDone={() => {}} />);
        fireEvent.click(await screen.findByLabelText(CONSENT));
        fireEvent.click(screen.getByLabelText(PHYSIO));
        fireEvent.click(screen.getByLabelText(CONSENT));
        expect(screen.queryByLabelText(PHYSIO)).toBeNull();
        fireEvent.click(screen.getByLabelText(CONSENT));
        expect(screen.getByLabelText(PHYSIO)).not.toBeChecked();
        fireEvent.click(screen.getByLabelText(CONSENT));
        fireEvent.click(screen.getByRole('button', { name: /Start/i }));
        expect(await savedOnboarding()).toMatchObject({ oyon_consent: false, oyon_consent_physio: false });
    });
});
