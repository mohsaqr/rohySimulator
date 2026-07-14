// The register form's invite-code affordance.
//
// The bug this pins: the code field used to render ONLY in invite-only mode or
// when you arrived on a ?invite= link. But an invite is one artifact with two
// deliveries — a link, and a code you can read down the phone — and the SERVER
// honours a code in open and approval mode too, because that is how an invite
// carries a role and a course. So an admin who minted an educator invite and
// pasted the CODE into a group chat handed people something with no box to type
// it into: they signed up as plain students, and the invite went unused with no
// error anywhere. The code must be reachable in every mode that lets you
// register at all.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const register = vi.fn();
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ register }) }));

// Render English strings, not key names, so a missing key fails loudly rather
// than passing as its own key.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, vars) => {
            const en = {
                invite_code: 'Invite code',
                invite_code_optional: "Optional — leave blank if you weren't given one.",
                invite_have_code: 'Have an invite code?',
                invite_use_different_code: 'Use a different code',
                invite_valid_with_course: `You've been invited to join ${vars?.course}.`,
                create_account: 'Create Account',
                username: 'Username',
                email: 'Email',
                password: 'Password',
                confirm_password: 'Confirm Password',
            };
            return en[key] ?? key;
        },
    }),
}));

const { default: RegisterPage } = await import('../../src/components/auth/RegisterPage.jsx');

const OPEN = { mode: 'open', self_registration: true, invite_required: false };
const INVITE_ONLY = { mode: 'invite', self_registration: true, invite_required: true };

const codeField = () => screen.queryByPlaceholderText('invite_code_placeholder');

beforeEach(() => register.mockReset());
afterEach(cleanup);

describe('RegisterPage invite code', () => {
    // The regression. Collapsed is fine — hidden is not.
    it('is reachable in open mode, behind a prompt rather than in your face', async () => {
        render(<RegisterPage policy={OPEN} />);

        expect(codeField()).toBeNull();                    // not cluttering a plain signup…
        fireEvent.click(screen.getByText('Have an invite code?'));
        expect(codeField()).toBeTruthy();                  // …but one click away
        // And it must not read as a new hurdle for the people who have no code.
        expect(screen.getByText("Optional — leave blank if you weren't given one.")).toBeTruthy();
    });

    it('sends the typed code with the registration', async () => {
        register.mockResolvedValue({ user: { id: 1 } });
        render(<RegisterPage policy={OPEN} />);

        fireEvent.click(screen.getByText('Have an invite code?'));
        fireEvent.change(codeField(), { target: { value: 'ABCD2345EFGH' } });
        fireEvent.change(screen.getByPlaceholderText('choose_username'), { target: { value: 'newbie' } });
        fireEvent.change(screen.getByPlaceholderText('email_placeholder'), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByPlaceholderText('create_password_placeholder'), { target: { value: 'Passw0rd!' } });
        fireEvent.change(screen.getByPlaceholderText('reenter_password_placeholder'), { target: { value: 'Passw0rd!' } });
        fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

        await waitFor(() => expect(register).toHaveBeenCalledWith(
            'newbie', 'a@b.com', 'Passw0rd!', { invite: 'ABCD2345EFGH' },
        ));
    });

    it('omits the invite entirely when no code was given', async () => {
        register.mockResolvedValue({ user: { id: 1 } });
        render(<RegisterPage policy={OPEN} />);

        fireEvent.change(screen.getByPlaceholderText('choose_username'), { target: { value: 'newbie' } });
        fireEvent.change(screen.getByPlaceholderText('email_placeholder'), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByPlaceholderText('create_password_placeholder'), { target: { value: 'Passw0rd!' } });
        fireEvent.change(screen.getByPlaceholderText('reenter_password_placeholder'), { target: { value: 'Passw0rd!' } });
        fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

        // undefined, not '' — the server treats a supplied-but-invalid token as a
        // hard 400, so an empty string must never reach it.
        await waitFor(() => expect(register).toHaveBeenCalledWith(
            'newbie', 'a@b.com', 'Passw0rd!', { invite: undefined },
        ));
    });

    it('is expanded and required in invite-only mode — no prompt to click', () => {
        render(<RegisterPage policy={INVITE_ONLY} />);

        expect(screen.queryByText('Have an invite code?')).toBeNull();
        expect(codeField().required).toBe(true);
        // "Optional" would be a lie here.
        expect(screen.queryByText("Optional — leave blank if you weren't given one.")).toBeNull();
    });

    it('prefills and locks the code when you arrived on a working link', () => {
        render(
            <RegisterPage
                policy={OPEN}
                inviteToken="ABCD2345EFGH"
                invite={{ valid: true, role: 'student', cohort_name: 'Cardiology 101' }}
            />
        );

        expect(codeField().value).toBe('ABCD2345EFGH');
        expect(codeField().disabled).toBe(true);
        expect(screen.getByText("You've been invited to join Cardiology 101.")).toBeTruthy();

        // The escape hatch: someone forwarded you their link but you have your own code.
        fireEvent.click(screen.getByText('Use a different code'));
        expect(codeField().disabled).toBe(false);
        expect(codeField().value).toBe('');
    });

    it('leaves the field editable when the link was dead, so a fresh code can be pasted', () => {
        render(
            <RegisterPage
                policy={OPEN}
                inviteToken="DEADDEADDEAD"
                invite={{ valid: false, reason: 'expired' }}
            />
        );

        expect(codeField()).toBeTruthy();
        expect(codeField().disabled).toBe(false);
        expect(codeField().value).toBe('');
    });
});
