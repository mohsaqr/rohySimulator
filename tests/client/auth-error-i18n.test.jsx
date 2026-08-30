// Sign-in and sign-up failures, in the user's own language.
//
// Regression lock: the auth cards rendered `err.message` — the raw English
// string the server put in `{ error: … }` — and only fell back to the
// translated key when the message was empty. Since the server ALWAYS sends a
// message, the translated `login_failed` / `registration_failed` strings were
// unreachable in all five non-English locales, and a Finnish user typing the
// wrong password got "Invalid username or password".
//
// These tests render with a `t` backed by the REAL en/auth.json catalogue, so
// a key that does not exist fails loudly instead of passing as its own name,
// and the assertions are on the catalogue's text — the raw server string must
// not appear anywhere on screen.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import en from '../../src/locales/en/auth.json';

const login = vi.fn();
const register = vi.fn();
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ login, register }) }));

// Minimal ICU renderer: enough for `{var}` and `{n, plural, one {…} other {…}}`,
// which is all the auth catalogue uses.
function renderIcu(message, vars = {}) {
    let out = String(message).replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_, name, one, other) => {
            const n = Number(vars[name]);
            return (n === 1 ? one : other).replace(/#/g, String(n));
        },
    );
    out = out.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
    return out;
}

const tCalls = [];
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, vars) => {
            tCalls.push([key, vars]);
            // Missing key -> return the key, so an assertion on real text fails.
            return key in en ? renderIcu(en[key], vars) : key;
        },
    }),
}));

const { default: LoginPage } = await import('../../src/components/auth/LoginPage.jsx');
const { translateLoginError } = await import('../../src/components/auth/LoginPage.jsx');
const { default: RegisterPage, translateRegisterError } = await import('../../src/components/auth/RegisterPage.jsx');

const t = (key, vars) => (key in en ? renderIcu(en[key], vars) : key);

const OPEN = { mode: 'open', self_registration: true, invite_required: false };

const signIn = () => {
    fireEvent.change(screen.getByPlaceholderText(en.enter_username), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByPlaceholderText(en.enter_password), { target: { value: 'Passw0rdX' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.sign_in, 'i') }));
};

const fillSignUp = () => {
    fireEvent.change(screen.getByPlaceholderText(en.choose_username), { target: { value: 'newbie' } });
    fireEvent.change(screen.getByPlaceholderText(en.email_placeholder), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText(en.create_password_placeholder), { target: { value: 'Passw0rdX' } });
    fireEvent.change(screen.getByPlaceholderText(en.reenter_password_placeholder), { target: { value: 'Passw0rdX' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.create_account, 'i') }));
};

beforeEach(() => { login.mockReset(); register.mockReset(); tCalls.length = 0; });
afterEach(cleanup);

describe('LoginPage error messages', () => {
    // THE lock: a 401 must render the catalogue string, never the server's.
    it('renders the translated string for a 401, not the raw server message', async () => {
        // Exactly what AuthService.login throws today: a plain Error carrying
        // the server's English text, with no status and no code.
        login.mockRejectedValue(new Error('Invalid username or password'));
        render(<LoginPage policy={OPEN} />);
        signIn();

        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(screen.getByRole('alert').textContent).toContain(en.error_invalid_credentials);
        expect(screen.queryByText('Invalid username or password')).toBeNull();
        expect(tCalls.some(([key]) => key === 'error_invalid_credentials')).toBe(true);
    });

    it('keeps the lockout countdown while translating the sentence around it', () => {
        const message = translateLoginError(new Error('Account locked. Try again in 7 minutes.'), t);
        expect(message).toBe(renderIcu(en.error_account_locked, { minutes: 7 }));
        expect(message).toContain('7');
        expect(message).not.toContain('Account locked. Try again in');
        // ICU plural, not `count === 1` arithmetic — Finnish and Swedish need it.
        expect(translateLoginError(new Error('Account locked. Try again in 1 minute.'), t))
            .toBe(renderIcu(en.error_account_locked, { minutes: 1 }));
    });

    it('translates the disabled-account, rate-limit and offline shapes', () => {
        expect(translateLoginError(new Error('This account is not active. Contact an administrator.'), t))
            .toBe(en.error_account_disabled);
        // …and by code too, so the map survives a move onto apiClient's ApiError.
        expect(translateLoginError({ status: 403, body: { code: 'account_disabled' }, message: 'whatever' }, t))
            .toBe(en.error_account_disabled);
        expect(translateLoginError(new Error('Too many authentication attempts. Please try again in 15 minutes.'), t))
            .toBe(en.error_too_many_attempts);
        expect(translateLoginError(new Error('Cannot connect to server. Is the backend running?'), t))
            .toBe(en.error_cannot_connect);
        expect(translateLoginError(new Error('Username and password are required'), t))
            .toBe(en.error_credentials_required);
    });

    // An unknown detail is still worth showing — but inside a translated frame,
    // not as a bare English sentence.
    it('wraps an unrecognised server detail in a translated frame', () => {
        expect(translateLoginError(new Error('Kernel panic in the mainframe'), t))
            .toBe(renderIcu(en.login_failed_detail, { detail: 'Kernel panic in the mainframe' }));
        expect(translateLoginError(new Error(''), t)).toBe(en.login_failed);
        expect(translateLoginError(undefined, t)).toBe(en.login_failed);
    });
});

describe('RegisterPage error messages', () => {
    it('renders the translated string for a rejected signup, not the raw server message', async () => {
        register.mockRejectedValue(new Error('Username or email already exists'));
        render(<RegisterPage policy={OPEN} />);
        fillSignUp();

        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(screen.getByRole('alert').textContent).toContain(en.error_username_taken);
        expect(screen.queryByText('Username or email already exists')).toBeNull();
    });

    it('reuses the invite catalogue for every invite rejection, by code or by text', () => {
        expect(translateRegisterError({ body: { code: 'invite_expired' }, message: 'x' }, t))
            .toBe(en.invite_invalid_expired);
        expect(translateRegisterError(new Error('That invite has already been used the maximum number of times.'), t))
            .toBe(en.invite_invalid_exhausted);
        expect(translateRegisterError(new Error('That invite has been withdrawn. Ask whoever sent it for a new one.'), t))
            .toBe(en.invite_invalid_revoked);
    });

    it('carries the domain list — the actionable part — through the translation', () => {
        expect(translateRegisterError(new Error('Registration is limited to these email domains: uni.fi, uni.se.'), t))
            .toBe(renderIcu(en.error_email_domain_not_allowed, { domains: 'uni.fi, uni.se' }));
        expect(translateRegisterError(new Error('This invite is limited to @uni.fi addresses.'), t))
            .toBe(renderIcu(en.error_invite_email_domain, { domain: '@uni.fi' }));
    });

    it('translates the policy and password shapes', () => {
        expect(translateRegisterError(new Error('Registration is closed. Ask an administrator to create your account.'), t))
            .toBe(en.error_registration_closed);
        expect(translateRegisterError(new Error('You need an invite link or code to create an account here.'), t))
            .toBe(en.error_invite_required);
        expect(translateRegisterError(new Error('Password must be at least 8 characters long. Password must contain at least one number'), t))
            .toBe(en.password_policy_unmet);
        expect(translateRegisterError({ body: { code: 'approval_already_requested' }, message: 'x' }, t))
            .toBe(en.error_approval_already_requested);
    });

    // Admin-authored policy text is not a known shape and must not be swallowed:
    // a human wrote it for this platform, so it survives as the detail.
    it('passes an admin-authored policy message through as the detail', () => {
        expect(translateRegisterError(new Error('Ask your course lead, room 4.12.'), t))
            .toBe(renderIcu(en.registration_failed_detail, { detail: 'Ask your course lead, room 4.12.' }));
    });
});
