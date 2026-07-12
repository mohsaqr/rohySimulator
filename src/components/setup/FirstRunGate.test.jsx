// FirstRunGate routing: which surface each role sees, driven by
// /setup/status (admins) or user_preferences.onboarding_settings (everyone
// else), and the fail-open posture (a broken probe must never lock the app).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FirstRunGate from './FirstRunGate';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../services/apiClient', () => ({
    apiFetch: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: vi.fn(),
}));
vi.mock('./AdminSetupWizard', () => ({
    default: () => <div data-testid="admin-wizard" />,
}));
vi.mock('./StudentFirstRun', () => ({
    default: () => <div data-testid="student-first-run" />,
    FIRST_RUN_VERSION: 1,
}));

const asUser = (role) => {
    useAuth.mockReturnValue({
        user: { id: 7, role },
        isAdmin: () => role === 'admin',
    });
};

const renderGate = () =>
    render(
        <FirstRunGate>
            <div data-testid="main-app" />
        </FirstRunGate>
    );

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FirstRunGate', () => {
    it('shows the wizard to an admin when setup is not completed', async () => {
        asUser('admin');
        apiFetch.mockResolvedValueOnce({ setup_completed: false });
        renderGate();
        await waitFor(() => expect(screen.getByTestId('admin-wizard')).toBeInTheDocument());
        expect(apiFetch).toHaveBeenCalledWith('/setup/status');
        expect(screen.queryByTestId('main-app')).toBeNull();
    });

    it('passes an admin straight through once setup is completed', async () => {
        asUser('admin');
        apiFetch.mockResolvedValueOnce({ setup_completed: true });
        renderGate();
        await waitFor(() => expect(screen.getByTestId('main-app')).toBeInTheDocument());
    });

    it('shows the first-run screen to a student without the server flag', async () => {
        asUser('student');
        apiFetch.mockResolvedValueOnce({ onboarding_settings: null });
        renderGate();
        await waitFor(() => expect(screen.getByTestId('student-first-run')).toBeInTheDocument());
        expect(apiFetch).toHaveBeenCalledWith('/users/preferences');
    });

    it('passes a student through when first_run_done meets the version', async () => {
        asUser('student');
        apiFetch.mockResolvedValueOnce({ onboarding_settings: '{"first_run_done":1}' });
        renderGate();
        await waitFor(() => expect(screen.getByTestId('main-app')).toBeInTheDocument());
    });

    it('shows the first-run screen to an educator too (teacher variant)', async () => {
        asUser('educator');
        apiFetch.mockResolvedValueOnce({ onboarding_settings: '{}' });
        renderGate();
        await waitFor(() => expect(screen.getByTestId('student-first-run')).toBeInTheDocument());
    });

    it('fails open: a broken probe renders the app, never a lockout', async () => {
        asUser('admin');
        apiFetch.mockRejectedValueOnce(new Error('boom'));
        renderGate();
        await waitFor(() => expect(screen.getByTestId('main-app')).toBeInTheDocument());
    });
});
