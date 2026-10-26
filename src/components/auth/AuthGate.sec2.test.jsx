// Lane A handoffs on the logged-out surface (security audit 2026-10-26):
//   - the invite token leaves the address bar the moment it is read (L1-05)
//   - the new first-admin bootstrap refusals read as sentences (F-30)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translateRegisterError } from './RegisterPage.jsx';
import en from '../../locales/en/auth.json';

const getRegistrationPolicy = vi.fn();
const previewInvite = vi.fn();
const seenSearch = [];

vi.mock('../../services/registrationService', async () => {
    const actual = await vi.importActual('../../services/registrationService');
    return {
        ...actual,
        getRegistrationPolicy: (...args) => getRegistrationPolicy(...args),
        previewInvite: (...args) => { seenSearch.push(window.location.search); return previewInvite(...args); },
    };
});
vi.mock('./LoginPage', () => ({ default: () => <span>login-screen</span> }));
vi.mock('./RegisterPage', async () => {
    const actual = await vi.importActual('./RegisterPage');
    return { ...actual, default: ({ inviteToken }) => <span>register-screen token:{inviteToken}</span> };
});

const { default: AuthGate } = await import('./AuthGate.jsx');

beforeEach(() => {
    getRegistrationPolicy.mockReset();
    previewInvite.mockReset();
    seenSearch.length = 0;
    window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

describe('invite token in the address bar', () => {
    // Regression lock: the token stayed in the URL (and every request's Referer) until the preview resolved.
    it('is gone before the preview request is even sent', () => {
        window.history.replaceState({}, '', '/register?invite=SLOWSLOWSLOW');
        getRegistrationPolicy.mockReturnValue(new Promise(() => {}));
        previewInvite.mockReturnValue(new Promise(() => {}));   // never settles
        render(<AuthGate />);
        expect(window.location.search).toBe('');
        expect(seenSearch).toEqual(['']);
        expect(previewInvite).toHaveBeenCalledWith('SLOWSLOWSLOW');
        expect(screen.queryByText(/register-screen/)).toBeNull();
    });
});

describe('bootstrap refusals', () => {
    const t = (key) => en[key] ?? `MISSING:${key}`;

    it.each([
        ['setup_token_required', 'error_setup_token_required'],
        ['bootstrap_claimed', 'error_bootstrap_claimed'],
    ])('%s has its own English sentence', (code, key) => {
        const out = translateRegisterError({ code, message: code }, t);
        expect(out).toBe(en[key]);
        expect(out).not.toMatch(/MISSING|_/);
    });
});
