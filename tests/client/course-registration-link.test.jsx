// A course's registration link (PRV-67): /register?invite=<course join code>.
//
// Three arrivals, one link:
//   * a newcomer lands on the register form with the code already filled in
//     and locked, and is told which course it is for;
//   * on a platform that does not let strangers register, the link does NOT
//     open the register form (a course code is not an admin's invite) — the
//     sign-in card says "sign in to join <course>" and the code is handed to
//     the signed-in app;
//   * someone already signed in (or who just signed in) is joined to the
//     course by CourseLinkJoin, and the code leaves the address bar.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const getRegistrationPolicy = vi.fn();
const previewInvite = vi.fn();
const joinCohort = vi.fn();
const notify = vi.fn();

vi.mock('../../src/services/registrationService', async () => {
    const actual = await vi.importActual('../../src/services/registrationService');
    return {
        ...actual,
        getRegistrationPolicy: (...args) => getRegistrationPolicy(...args),
        previewInvite: (...args) => previewInvite(...args),
    };
});
vi.mock('../../src/services/cohortsService', () => ({
    joinCohort: (...args) => joinCohort(...args),
}));
vi.mock('../../src/notifications/useNotifications', () => ({
    useNotifications: () => ({ notify }),
}));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ register: vi.fn() }) }));

// English strings (keys fall through), so a missing key shows as its name.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, vars) => {
            const en = {
                invite_code: 'Invite or course code',
                invite_valid_with_course: `You've been invited to join ${vars?.course}.`,
                course_link_sign_in: `Already have an account? Sign in to join ${vars?.course}.`,
                course_link_joined: `You have joined ${vars?.course}.`,
                course_link_not_found: 'That course link is not valid. Ask your teacher for a new one.',
                course_link_closed: 'That course has been closed. Ask your teacher for a new link.',
                course_link_invite_signed_in: 'You are already signed in. That invite is for creating a new account.',
            };
            return en[key] ?? key;
        },
    }),
}));

// The login card pulls in the language switcher and auth context; the gate
// only hands it callbacks, so a stub is enough here.
vi.mock('../../src/components/auth/LoginPage', () => ({
    default: ({ onSwitchToRegister }) => (
        <div>
            <span>login-screen</span>
            {onSwitchToRegister ? <button>Create Account</button> : <span>no-register-link</span>}
        </div>
    ),
}));

const { default: AuthGate } = await import('../../src/components/auth/AuthGate.jsx');
const { default: CourseLinkJoin } = await import('../../src/components/auth/CourseLinkJoin.jsx');
const courseLink = await import('../../src/services/courseLink.js');

const COURSE_PREVIEW = {
    valid: true, kind: 'course', role: 'student', cohort_name: 'Suomi',
    expires_at: null, email_domain: null, uses_left: null,
};

beforeEach(() => {
    getRegistrationPolicy.mockReset();
    previewInvite.mockReset();
    joinCohort.mockReset();
    notify.mockReset();
    courseLink.forgetCourseCode();
    window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

describe('opening a course registration link while signed out', () => {
    // Regression lock: the teacher's link pre-fills the code on the register form (PRV-67).
    it('opens the register form with the course code filled in and locked', async () => {
        window.history.replaceState({}, '', '/register?invite=FNKRS2QZ');
        getRegistrationPolicy.mockResolvedValue({ mode: 'open', self_registration: true });
        previewInvite.mockResolvedValue(COURSE_PREVIEW);

        render(<AuthGate />);

        const field = await screen.findByLabelText('Invite or course code');
        expect(field.value).toBe('FNKRS2QZ');
        expect(field.readOnly || field.disabled).toBe(true);
        expect(screen.getByText("You've been invited to join Suomi.")).toBeTruthy();
        expect(previewInvite).toHaveBeenCalledWith('FNKRS2QZ');
        // The code is a credential: it leaves the address bar once read.
        expect(window.location.search).toBe('');
    });

    it('does not open a closed platform, but offers sign-in to join and hands the code on', async () => {
        window.history.replaceState({}, '', '/register?invite=FNKRS2QZ');
        getRegistrationPolicy.mockResolvedValue({ mode: 'closed', self_registration: false });
        previewInvite.mockResolvedValue(COURSE_PREVIEW);

        render(<AuthGate />);

        await waitFor(() => expect(screen.getByText('login-screen')).toBeTruthy());
        expect(screen.getByText('no-register-link')).toBeTruthy();
        expect(screen.getByTestId('course-link-sign-in').textContent)
            .toBe('Already have an account? Sign in to join Suomi.');
        expect(courseLink.takeCourseCode()).toBe('FNKRS2QZ');
    });

    it('does not hand a registration invite to the signed-in app', async () => {
        window.history.replaceState({}, '', '/register?invite=ABCD1234EFGH');
        getRegistrationPolicy.mockResolvedValue({ mode: 'open', self_registration: true });
        previewInvite.mockResolvedValue({ valid: true, role: 'student', cohort_name: null });

        render(<AuthGate />);

        await screen.findByLabelText('Invite or course code');
        expect(courseLink.takeCourseCode()).toBe('');
    });
});

describe('CourseLinkJoin (signed in)', () => {
    // Regression lock: the same link works for a student who is already signed in (PRV-67).
    it('joins the course named by the link and clears the address bar', async () => {
        window.history.replaceState({}, '', '/register?invite=FNKRS2QZ');
        previewInvite.mockResolvedValue(COURSE_PREVIEW);
        joinCohort.mockResolvedValue({ cohort: { id: 7, name: 'Suomi' } });

        render(<CourseLinkJoin />);

        await waitFor(() => expect(joinCohort).toHaveBeenCalledWith('FNKRS2QZ'));
        await waitFor(() => expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({ severity: 'success', message: 'You have joined Suomi.' })
        ));
        expect(window.location.search).toBe('');
    });

    it('joins with the code AuthGate handed over at sign-in', async () => {
        courseLink.rememberCourseCode('FNKRS2QZ');
        previewInvite.mockResolvedValue(COURSE_PREVIEW);
        joinCohort.mockResolvedValue({ cohort: { id: 7, name: 'Suomi' } });

        render(<CourseLinkJoin />);

        await waitFor(() => expect(joinCohort).toHaveBeenCalledWith('FNKRS2QZ'));
        // Handed over once only.
        expect(courseLink.takeCourseCode()).toBe('');
    });

    it('says so when the course is closed', async () => {
        window.history.replaceState({}, '', '/?invite=CSDCRS34');
        previewInvite.mockResolvedValue({ valid: false, reason: 'revoked' });
        joinCohort.mockRejectedValue(Object.assign(new Error('That class has been closed'), { code: 'COHORT_DELETED' }));

        render(<CourseLinkJoin />);

        await waitFor(() => expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({ severity: 'error', message: 'That course has been closed. Ask your teacher for a new link.' })
        ));
    });

    it('does not try to join with a registration invite', async () => {
        window.history.replaceState({}, '', '/register?invite=ABCD1234EFGH');
        previewInvite.mockResolvedValue({ valid: true, role: 'student', cohort_name: null });

        render(<CourseLinkJoin />);

        await waitFor(() => expect(notify).toHaveBeenCalledWith(
            expect.objectContaining({ severity: 'info', message: 'You are already signed in. That invite is for creating a new account.' })
        ));
        expect(joinCohort).not.toHaveBeenCalled();
    });

    it('does nothing without a link', async () => {
        render(<CourseLinkJoin />);
        await new Promise((r) => setTimeout(r, 20));
        expect(previewInvite).not.toHaveBeenCalled();
        expect(joinCohort).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });
});
