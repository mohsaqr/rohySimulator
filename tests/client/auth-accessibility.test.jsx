// Accessibility of the two auth cards.
//
// Regression lock: three findings from the 2.9.108 review, all on the sign-up
// card.
//   1. The password checklist rendered the SAME filled tick for "met" and
//      "not met" and differed only by colour — invisible to a colour-blind
//      user, and silent to a screen reader.
//   2. The error banners were plain divs: an assistive-tech user submitted the
//      form and was told nothing at all.
//   3. The register form had no autocomplete attributes (so password managers
//      could not fill or save it) and no reveal toggle, even though the sign-in
//      card next door has one.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import en from '../../src/locales/en/auth.json';

const login = vi.fn();
const register = vi.fn();
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ login, register }) }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, vars) => {
            const value = key in en ? en[key] : key;
            return String(value).replace(/\{(\w+)\}/g, (whole, name) => (name in (vars || {}) ? String(vars[name]) : whole));
        },
    }),
}));

const { default: LoginPage } = await import('../../src/components/auth/LoginPage.jsx');
const { default: RegisterPage } = await import('../../src/components/auth/RegisterPage.jsx');

const OPEN = { mode: 'open', self_registration: true, invite_required: false };

const field = (placeholder) => screen.getByPlaceholderText(placeholder);
const requirementRow = (label) => screen.getByText(label).closest('li');

beforeEach(() => { login.mockReset(); register.mockReset(); });
afterEach(cleanup);

describe('error banners are announced', () => {
    it('sign-in failure lands in a live region', async () => {
        login.mockRejectedValue(new Error('Invalid username or password'));
        render(<LoginPage policy={OPEN} />);

        fireEvent.change(field(en.enter_username), { target: { value: 'nurse' } });
        fireEvent.change(field(en.enter_password), { target: { value: 'Passw0rdX' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(en.sign_in, 'i') }));

        const alert = await waitFor(() => screen.getByRole('alert'));
        expect(alert.getAttribute('aria-live')).toBe('assertive');
    });

    it('sign-up validation failure lands in a live region', async () => {
        render(<RegisterPage policy={OPEN} />);

        fireEvent.change(field(en.choose_username), { target: { value: 'ab' } });   // too short
        fireEvent.change(field(en.email_placeholder), { target: { value: 'a@b.com' } });
        fireEvent.change(field(en.create_password_placeholder), { target: { value: 'Passw0rdX' } });
        fireEvent.change(field(en.reenter_password_placeholder), { target: { value: 'Passw0rdX' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(en.create_account, 'i') }));

        const alert = await waitFor(() => screen.getByRole('alert'));
        expect(alert.getAttribute('aria-live')).toBe('assertive');
        expect(alert.textContent).toContain(en.username_too_short);
        expect(register).not.toHaveBeenCalled();
    });
});

describe('the password checklist does not speak in colour alone', () => {
    it('marks each requirement met/unmet in words and in shape', () => {
        render(<RegisterPage policy={OPEN} />);

        const lengthRow = requirementRow(en.password_req_length);
        expect(lengthRow.getAttribute('data-state')).toBe('unmet');
        expect(lengthRow.textContent).toContain(en.password_req_unmet);
        // The two states must not render the same glyph.
        const unmetIcon = lengthRow.querySelector('svg').getAttribute('class');

        fireEvent.change(field(en.create_password_placeholder), { target: { value: 'Passw0rdX' } });

        const metRow = requirementRow(en.password_req_length);
        expect(metRow.getAttribute('data-state')).toBe('met');
        expect(metRow.textContent).toContain(en.password_req_met);
        expect(metRow.querySelector('svg').getAttribute('class')).not.toBe(unmetIcon);
    });

    // #32's rule, seen from the UI side: the 128-char ceiling is a visible row,
    // and it goes red before the server does.
    it('shows the 128-character ceiling as its own row and trips on 129', () => {
        render(<RegisterPage policy={OPEN} />);

        expect(requirementRow(en.password_req_max).getAttribute('data-state')).toBe('met');
        fireEvent.change(field(en.create_password_placeholder), { target: { value: `Aa1${'x'.repeat(126)}` } });
        expect(requirementRow(en.password_req_max).getAttribute('data-state')).toBe('unmet');
    });
});

describe('the sign-up form is fillable by a password manager', () => {
    it('names every field for autofill', () => {
        render(<RegisterPage policy={OPEN} />);

        expect(field(en.choose_username).getAttribute('autocomplete')).toBe('username');
        expect(field(en.email_placeholder).getAttribute('autocomplete')).toBe('email');
        expect(field(en.create_password_placeholder).getAttribute('autocomplete')).toBe('new-password');
        expect(field(en.reenter_password_placeholder).getAttribute('autocomplete')).toBe('new-password');
    });

    it('lets you read back what you typed, like the sign-in card does', () => {
        render(<RegisterPage policy={OPEN} />);

        expect(field(en.create_password_placeholder).type).toBe('password');
        const toggles = screen.getAllByLabelText(en.show_password);
        expect(toggles).toHaveLength(2);            // password AND confirm

        fireEvent.click(toggles[0]);
        expect(field(en.create_password_placeholder).type).toBe('text');
        expect(field(en.reenter_password_placeholder).type).toBe('password');   // independent

        fireEvent.click(screen.getByLabelText(en.hide_password));
        expect(field(en.create_password_placeholder).type).toBe('password');
    });
});
