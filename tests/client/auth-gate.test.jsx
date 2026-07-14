// AuthGate decides what the LOGGED-OUT surface offers: sign-in only, or
// sign-in + "Create an account".
//
// This is a high-blast-radius component — it is the only thing rendered when
// there is no user, so a crash here locks everyone out of the platform. The
// probe-failure case is the one that matters most: it must FAIL OPEN. A fresh
// install's only path to a first admin is self-registration (production refuses
// to seed default users), so hiding the register link because a probe 404'd
// against an older backend would brick the install to protect a hint the server
// re-checks anyway.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const getRegistrationPolicy = vi.fn();

vi.mock('../../src/services/registrationService', async () => {
    const actual = await vi.importActual('../../src/services/registrationService');
    return { ...actual, getRegistrationPolicy: (...args) => getRegistrationPolicy(...args) };
});

// The auth screens pull in AuthContext (network) and LanguageContext. Stub them
// down to what the gate actually branches on: whether a register affordance and
// a policy message are handed through.
vi.mock('../../src/components/auth/LoginPage', () => ({
    default: ({ onSwitchToRegister, policy }) => (
        <div>
            <span>login-screen</span>
            {onSwitchToRegister ? <button>Create Account</button> : <span>no-register-link</span>}
            {policy?.message && <span>{policy.message}</span>}
        </div>
    ),
}));
vi.mock('../../src/components/auth/RegisterPage', () => ({
    default: () => <div>register-screen</div>,
}));

const { default: AuthGate } = await import('../../src/components/auth/AuthGate.jsx');

beforeEach(() => {
    getRegistrationPolicy.mockReset();
});
afterEach(cleanup);

describe('AuthGate', () => {
    it('offers registration when the platform is open', async () => {
        getRegistrationPolicy.mockResolvedValue({ mode: 'open', self_registration: true });
        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('login-screen')).toBeTruthy());
        expect(screen.getByText('Create Account')).toBeTruthy();
    });

    it('hides the register link when the platform is closed, and explains why', async () => {
        getRegistrationPolicy.mockResolvedValue({
            mode: 'closed',
            self_registration: false,
            message: 'Ask your course lead.',
        });
        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('login-screen')).toBeTruthy());
        expect(screen.getByText('no-register-link')).toBeTruthy();
        // A blank gap reads as a broken page; the admin's message fills it.
        expect(screen.getByText('Ask your course lead.')).toBeTruthy();
    });

    // The invariant: a broken probe must not lock a fresh install out of its own
    // bootstrap. Fail OPEN — the server still refuses anything the policy forbids.
    it('falls back to OPEN when the policy probe fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        getRegistrationPolicy.mockRejectedValue(new Error('404 Not Found'));

        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('login-screen')).toBeTruthy());
        expect(screen.getByText('Create Account')).toBeTruthy();
        expect(warn).toHaveBeenCalled();  // noted in the console, not shouted at the user
        warn.mockRestore();
    });

    it('shows nothing but a spinner until the policy is known', () => {
        getRegistrationPolicy.mockReturnValue(new Promise(() => {}));  // never settles
        render(<AuthGate />);

        // Flashing a login card without the register link and then popping it in
        // reads as a bug, so the whole card waits.
        expect(screen.queryByText('login-screen')).toBeNull();
        expect(screen.queryByText('register-screen')).toBeNull();
    });
});
