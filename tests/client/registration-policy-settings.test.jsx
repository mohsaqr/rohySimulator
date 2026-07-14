// The admin control for the registration policy (Platform → Users).
//
// This exists because of a cautionary tale in this very codebase: the
// cohort-case enforcement flag shipped with a server route, a client service
// function, and NO UI — so no admin could ever turn it on, and it sat dead for
// months. A setting without a control is not a feature. These tests assert the
// control exists, shows the consequence of each choice, and actually writes.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const getRegistrationSettings = vi.fn();
const saveRegistrationSettings = vi.fn();

vi.mock('../../src/services/registrationService', () => ({
    getRegistrationSettings: (...a) => getRegistrationSettings(...a),
    saveRegistrationSettings: (...a) => saveRegistrationSettings(...a),
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../src/contexts/ToastContext', () => ({ useToast: () => toast }));

// Render the English strings rather than key names, so a broken/missing key is
// visible as a broken assertion instead of passing silently.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, vars) => {
            const en = {
                registration_title: 'Registration & sign-up',
                registration_mode_open: 'Open',
                registration_mode_open_hint: 'Anyone who can reach this page can create an account.',
                registration_mode_closed: 'Closed',
                registration_mode_closed_hint: 'No self-registration. Administrators create every account.',
                registration_mode_approval: 'Approval required',
                registration_mode_invite: 'Invite only',
                registration_save: 'Save registration policy',
                registration_unsaved: 'Unsaved changes',
                registration_domain_add: 'Add',
                registration_toast_saved: 'Registration policy saved',
            };
            return en[key] || key + (vars ? JSON.stringify(vars) : '');
        },
    }),
}));

const { default: RegistrationPolicySettings } = await import(
    '../../src/components/settings/RegistrationPolicySettings.jsx'
);

beforeEach(() => {
    getRegistrationSettings.mockReset();
    saveRegistrationSettings.mockReset();
    toast.success.mockReset();
    getRegistrationSettings.mockResolvedValue({ mode: 'open', email_domains: [], message: null });
});
afterEach(cleanup);

describe('RegistrationPolicySettings', () => {
    it('renders every mode with the consequence of choosing it', async () => {
        render(<RegistrationPolicySettings />);
        await waitFor(() => expect(screen.getByText('Registration & sign-up')).toBeTruthy());

        expect(screen.getByText('Open')).toBeTruthy();
        expect(screen.getByText('Closed')).toBeTruthy();
        // The consequence line is the whole reason these are cards and not a
        // <select> — an admin must see what a mode DOES before picking it.
        expect(screen.getByText('Anyone who can reach this page can create an account.')).toBeTruthy();
        expect(screen.getByText('No self-registration. Administrators create every account.')).toBeTruthy();
    });

    it('reflects the stored mode as the selected card', async () => {
        getRegistrationSettings.mockResolvedValue({ mode: 'closed', email_domains: ['uef.fi'], message: null });
        render(<RegistrationPolicySettings />);

        await waitFor(() => expect(screen.getByText('Closed')).toBeTruthy());
        expect(screen.getByText('Closed').closest('button').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('Open').closest('button').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByText('@uef.fi')).toBeTruthy();
    });

    // Explicit save, not live-save: a live-saving radio would close the whole
    // platform on a mis-click, and mode+domains are one coupled decision.
    it('does not write on click — only on Save', async () => {
        render(<RegistrationPolicySettings />);
        await waitFor(() => expect(screen.getByText('Closed')).toBeTruthy());

        fireEvent.click(screen.getByText('Closed').closest('button'));
        expect(saveRegistrationSettings).not.toHaveBeenCalled();
        expect(screen.getByText('Unsaved changes')).toBeTruthy();

        saveRegistrationSettings.mockResolvedValue({ mode: 'closed', email_domains: [], message: null });
        fireEvent.click(screen.getByText('Save registration policy'));

        await waitFor(() => expect(saveRegistrationSettings).toHaveBeenCalledWith(
            expect.objectContaining({ mode: 'closed' })
        ));
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('Save is disabled until something changes', async () => {
        render(<RegistrationPolicySettings />);
        await waitFor(() => expect(screen.getByText('Save registration policy')).toBeTruthy());
        expect(screen.getByText('Save registration policy').disabled).toBe(true);
    });
});
