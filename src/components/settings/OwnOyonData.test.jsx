// The learner's "Your stored Oyon data" panel in Settings → Oyon: shows how
// much is stored, and deletes it only after a second, explicit click (no
// browser confirm() dialog). Owner request 2026-10-25.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../services/apiClient';
import OyonSettingsTab, { OwnOyonData } from './OyonSettingsTab';

vi.mock('../../services/apiClient', () => {
    class ApiError extends Error {}
    return { apiFetch: vi.fn(), ApiError };
});
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, isAdmin: () => false }) }));

beforeEach(() => vi.clearAllMocks());

describe('OwnOyonData', () => {
    it('shows the stored count and deletes only after the second click', async () => {
        let total = 7;
        apiFetch.mockImplementation((url, opts) => {
            if (opts?.method === 'DELETE') { const n = total; total = 0; return Promise.resolve({ total: n }); }
            return Promise.resolve({ total });
        });
        render(<OwnOyonData />);
        expect(await screen.findByText(/7 records stored under your account/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete my Oyon data' }));
        expect(apiFetch).not.toHaveBeenCalledWith('/addons/oyon/student/me/data', expect.objectContaining({ method: 'DELETE' }));
        expect(screen.getByText(/Delete all 7 records permanently/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/addons/oyon/student/me/data', { method: 'DELETE', json: { confirm: true } }));
        expect(await screen.findByText('Deleted 7 stored records.')).toBeInTheDocument();
        expect(await screen.findByText(/0 records stored under your account/)).toBeInTheDocument();
    });

    it('cancel leaves the data alone, and the button is disabled when nothing is stored', async () => {
        apiFetch.mockResolvedValue({ total: 0 });
        render(<OwnOyonData />);
        expect(await screen.findByText(/0 records stored/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete my Oyon data' })).toBeDisabled();
    });
});

// Sensing is per course (server/lib/oyonSensingGate.js). Regression lock: a
// learner none of whose courses enables Oyon is told so beside the consent
// checkbox, and the checkbox stays usable (it records their choice for later).
describe('Settings → Oyon learner note when no course enables sensing', () => {
    const routeApi = (config) => apiFetch.mockImplementation((url) => (
        url === '/addons/oyon/config' ? Promise.resolve(config) : Promise.resolve({ total: 0 })
    ));

    it('shows the note and keeps the consent checkbox enabled', async () => {
        routeApi({ enabled: false, course_sensing_required: true, course_sensing_enabled: false, consent_version: 'oyon-consent-v3' });
        render(<OyonSettingsTab />);
        expect(await screen.findByText('Optional learning measures are not enabled for any of your courses.')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /Capture emotions during my simulation sessions/ })).not.toBeDisabled();
    });

    it('shows no note once a course enables sensing, or for staff', async () => {
        routeApi({ enabled: true, course_sensing_required: true, course_sensing_enabled: true });
        const { unmount } = render(<OyonSettingsTab />);
        await screen.findByText(/Capture emotions during my simulation sessions/);
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/addons/oyon/config'));
        expect(screen.queryByTestId('oyon-no-course-note')).toBeNull();
        unmount();
        routeApi({ enabled: true, course_sensing_required: false, course_sensing_enabled: null });
        render(<OyonSettingsTab />);
        await screen.findByText(/Capture emotions during my simulation sessions/);
        expect(screen.queryByTestId('oyon-no-course-note')).toBeNull();
    });
});
