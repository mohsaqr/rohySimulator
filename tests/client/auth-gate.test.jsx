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
const previewInvite = vi.fn();

vi.mock('../../src/services/registrationService', async () => {
    const actual = await vi.importActual('../../src/services/registrationService');
    return {
        ...actual,
        getRegistrationPolicy: (...args) => getRegistrationPolicy(...args),
        previewInvite: (...args) => previewInvite(...args),
    };
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
    default: ({ invite, inviteToken }) => (
        <div>
            <span>register-screen</span>
            {inviteToken && <span>token:{inviteToken}</span>}
            {invite?.valid && <span>invited-to:{invite.cohort_name}</span>}
            {invite && !invite.valid && <span>invite-bad:{invite.reason}</span>}
        </div>
    ),
}));

const { default: AuthGate } = await import('../../src/components/auth/AuthGate.jsx');

beforeEach(() => {
    getRegistrationPolicy.mockReset();
    previewInvite.mockReset();
    window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

// Arriving on an invite link. The token is read from the QUERY STRING (not the
// pathname) so /register?invite=X and /?invite=X both work — which matters
// because /register only reaches the app at all thanks to an explicit Express
// route; a proxy that misroutes it must not take the feature down with it.
describe('AuthGate with an invite link', () => {
    it('goes straight to register and names the course you were invited to', async () => {
        window.history.replaceState({}, '', '/register?invite=ABCD1234EFGH');
        getRegistrationPolicy.mockResolvedValue({ mode: 'invite', self_registration: true });
        previewInvite.mockResolvedValue({ valid: true, role: 'student', cohort_name: 'Cardiology 101' });

        render(<AuthGate />);

        // No "click Create Account" step — you followed a link, you are registering.
        await waitFor(() => expect(screen.getByText('register-screen')).toBeTruthy());
        expect(screen.getByText('token:ABCD1234EFGH')).toBeTruthy();
        expect(screen.getByText('invited-to:Cardiology 101')).toBeTruthy();
    });

    it('still lets you register when the invite is dead, so you can paste a fresh code', async () => {
        window.history.replaceState({}, '', '/register?invite=DEADDEADDEAD');
        getRegistrationPolicy.mockResolvedValue({ mode: 'invite', self_registration: true });
        previewInvite.mockResolvedValue({ valid: false, reason: 'expired' });

        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('register-screen')).toBeTruthy());
        expect(screen.getByText('invite-bad:expired')).toBeTruthy();
    });

    // A valid invite is a named exception, issued by an admin, to the rule on the
    // front door — so it outranks a closed platform.
    it('a valid invite gets you in even when self-registration is closed', async () => {
        window.history.replaceState({}, '', '/?invite=ABCD1234EFGH');
        getRegistrationPolicy.mockResolvedValue({ mode: 'closed', self_registration: false });
        previewInvite.mockResolvedValue({ valid: true, role: 'student', cohort_name: 'Sepsis' });

        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('register-screen')).toBeTruthy());
        expect(screen.getByText('invited-to:Sepsis')).toBeTruthy();
    });

    it('waits for the invite preview before rendering anything', () => {
        window.history.replaceState({}, '', '/register?invite=SLOWSLOWSLOW');
        getRegistrationPolicy.mockResolvedValue({ mode: 'invite', self_registration: true });
        previewInvite.mockReturnValue(new Promise(() => {}));   // never settles

        render(<AuthGate />);

        expect(screen.queryByText('register-screen')).toBeNull();
        expect(screen.queryByText('login-screen')).toBeNull();
    });
});

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
