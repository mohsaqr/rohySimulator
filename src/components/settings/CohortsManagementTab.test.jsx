import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import { ApiError } from '../../services/apiClient';
import CohortsManagementTab from './CohortsManagementTab.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

// The Reports + Pickers children do their own fetching — stub them so this
// suite stays focused on the management/roster/settings-wiring behaviour.
vi.mock('./CohortReports', () => ({
    default: ({ cohortId }) => <div data-testid="reports-stub">reports:{cohortId}</div>,
}));
vi.mock('./CohortPickers', () => ({
    CasePicker: () => <div data-testid="case-picker" />,
    PeoplePicker: () => <div data-testid="people-picker" />,
}));

const svc = {
    listCohorts: vi.fn(),
    getCohort: vi.fn(),
    createCohort: vi.fn(),
    deleteCohort: vi.fn(),
    addCohortMember: vi.fn(),
    removeCohortMember: vi.fn(),
    rotateJoinCode: vi.fn(),
    disableJoinCode: vi.fn(),
    updateCohort: vi.fn(),
    assignCohortCases: vi.fn(),
    unassignCohortCase: vi.fn(),
    addCohortTeacher: vi.fn(),
    removeCohortTeacher: vi.fn(),
};
const userSvc = {
    getEnforcementFlag: vi.fn(),
    setEnforcementFlag: vi.fn(),
};

vi.mock('../../services/cohortsService', () => {
    const proxy = {};
    for (const k of [
        'listCohorts', 'getCohort', 'createCohort',
        'deleteCohort', 'addCohortMember', 'removeCohortMember',
        'rotateJoinCode', 'disableJoinCode', 'updateCohort',
        'assignCohortCases', 'unassignCohortCase', 'addCohortTeacher',
        'removeCohortTeacher',
    ]) proxy[k] = (...a) => svc[k](...a);
    return proxy;
});
vi.mock('../../services/userService', () => ({
    getEnforcementFlag: (...a) => userSvc.getEnforcementFlag(...a),
    setEnforcementFlag: (...a) => userSvc.setEnforcementFlag(...a),
}));

beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockReset());
    Object.values(svc).forEach((f) => f.mockReset());
    Object.values(userSvc).forEach((f) => f.mockReset());
    toast.confirm.mockResolvedValue(true);
    svc.listCohorts.mockResolvedValue({ cohorts: [] });
    userSvc.getEnforcementFlag.mockRejectedValue(new ApiError('forbidden', { status: 403 }));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('CohortsManagementTab — list view', () => {
    it('shows the empty state when there are no courses', async () => {
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() =>
            expect(screen.getByText(/No courses yet/i)).toBeTruthy());
    });

    it('surfaces a load error via toast', async () => {
        svc.listCohorts.mockRejectedValue(new ApiError('boom', 500));
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    });

    it('renders courses with student-count pluralisation and registration-code state', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [
                { id: 1, name: 'Cardio', member_count: 1, join_code: 'ABC123' },
                { id: 2, name: 'Neuro', member_count: 0, join_code: null },
            ],
        });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
        expect(screen.getByText(/1 enrolled student ·/)).toBeTruthy();
        expect(screen.getByText(/registration code active/)).toBeTruthy();
        expect(screen.getByText(/0 enrolled students ·/)).toBeTruthy();
        expect(screen.getByText(/no registration code/)).toBeTruthy();
    });

    // Regression lock: the default course's seeded English name ("Basic
    // course") rendered raw in every UI language, and nothing marked it as
    // the default. GET /cohorts now carries `is_default`; while the default
    // still bears the seeded literal it renders the translated
    // `default_course_name` entry plus a "Default" badge; a renamed default
    // keeps its custom name (and the badge); a non-default course that merely
    // happens to be called "Basic course" is left verbatim, no badge.
    it('localises the seeded default course name and badges it (it → "Corso base")', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [
                { id: 1, name: 'Basic course', is_default: 1, auto_enroll: 1, member_count: 3, join_code: null },
                { id: 2, name: 'Basic course', is_default: 0, member_count: 0, join_code: null },
                { id: 3, name: 'Cardio', is_default: 0, member_count: 1, join_code: 'ABC123' },
            ],
        });
        const { setAppLanguage } = await import('../../i18n');
        await setAppLanguage('it');
        try {
            renderWithProviders(<CohortsManagementTab />);
            await waitFor(() => expect(screen.getByText('Corso base')).toBeTruthy());
            // Only the DEFAULT gets translated; the look-alike keeps its stored name.
            expect(screen.getAllByText('Basic course')).toHaveLength(1);
            expect(screen.getByText('Cardio')).toBeTruthy();
            // Exactly one default badge, on the default course.
            expect(screen.getAllByText('Predefinito')).toHaveLength(1);
        } finally {
            await setAppLanguage('en');
        }
    });

    it('shows a RENAMED default course verbatim, still badged as default', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [
                { id: 1, name: 'Cardiology 101', is_default: 1, auto_enroll: 1, member_count: 3, join_code: null },
            ],
        });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Cardiology 101')).toBeTruthy());
        expect(screen.queryByText('Basic course')).toBeNull();
        expect(screen.getByText('Default')).toBeTruthy();
    });

    it('creates a course, clears the input, and reloads', async () => {
        svc.listCohorts.mockResolvedValue({ cohorts: [] });
        svc.createCohort.mockResolvedValue({});
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No courses yet/i)).toBeTruthy());

        const input = screen.getByPlaceholderText('New course name');
        fireEvent.change(input, { target: { value: '  Cardio  ' } });
        fireEvent.click(screen.getByRole('button', { name: /Create/i }));

        await waitFor(() =>
            expect(svc.createCohort).toHaveBeenCalledWith('Cardio'));
        expect(toast.success).toHaveBeenCalledWith('Class "Cardio" created');
        expect(svc.listCohorts).toHaveBeenCalledTimes(2);
    });

    it('toasts on create failure', async () => {
        svc.createCohort.mockRejectedValue(new ApiError('dup name', 409));
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No courses yet/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText('New course name'), {
            target: { value: 'X' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Create/i }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('dup name'));
    });

    it('pen icon opens the full class settings module (not a rename prompt)', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 1, name: 'Old', member_count: 0 }],
        });
        svc.getCohort.mockResolvedValue({
            cohort: { id: 1, name: 'Old', description: 'desc' },
            members: [], students: [], teachers: [], cases: [],
        });
        const promptSpy = vi.spyOn(window, 'prompt');
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Old')).toBeTruthy());

        fireEvent.click(screen.getByTitle('Class settings'));

        // Drills straight into the Settings section — the editable name
        // field (the rename home) and the new educational fields render,
        // and no window.prompt is used.
        await waitFor(() =>
            expect(screen.getByText('Back to courses')).toBeTruthy());
        expect(await screen.findByDisplayValue('Old')).toBeTruthy();
        expect(screen.getByText('Classroom policy')).toBeTruthy();
        expect(screen.getByText('Learning objectives')).toBeTruthy();
        expect(promptSpy).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('deletes a class after confirm', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 9, name: 'Doomed', member_count: 0 }],
        });
        svc.deleteCohort.mockResolvedValue({});
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Doomed')).toBeTruthy());
        fireEvent.click(screen.getByTitle('Delete'));
        await waitFor(() =>
            expect(svc.deleteCohort).toHaveBeenCalledWith(9));
        expect(toast.success).toHaveBeenCalledWith('Class deleted');
    });

    it('does not delete when confirm is declined', async () => {
        toast.confirm.mockResolvedValue(false);
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 9, name: 'Safe', member_count: 0 }],
        });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Safe')).toBeTruthy());
        fireEvent.click(screen.getByTitle('Delete'));
        await waitFor(() => expect(toast.confirm).toHaveBeenCalled());
        expect(svc.deleteCohort).not.toHaveBeenCalled();
    });
});

describe('CohortsManagementTab — roster drill-down', () => {
    async function openRoster(cohort = { id: 1, name: 'Cardio' }, members = []) {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: cohort.id, name: cohort.name, member_count: members.length }],
        });
        svc.getCohort.mockResolvedValue({ cohort, members });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(cohort.name)).toBeTruthy());
        fireEvent.click(screen.getByText(cohort.name));
        await waitFor(() =>
            expect(screen.getByText('Back to courses')).toBeTruthy());
    }

    it('renders the seeded default course workspace header translated + badged', async () => {
        const { setAppLanguage } = await import('../../i18n');
        await setAppLanguage('it');
        try {
            svc.listCohorts.mockResolvedValue({
                cohorts: [{ id: 1, name: 'Basic course', is_default: 1, member_count: 0 }],
            });
            svc.getCohort.mockResolvedValue({
                cohort: { id: 1, name: 'Basic course', is_default: 1 }, members: [],
            });
            renderWithProviders(<CohortsManagementTab />);
            await waitFor(() => expect(screen.getByText('Corso base')).toBeTruthy());
            fireEvent.click(screen.getByText('Corso base'));
            await waitFor(() =>
                expect(screen.getByRole('heading', { level: 3, name: 'Corso base' })).toBeTruthy());
            expect(screen.queryByText('Basic course')).toBeNull();
            expect(screen.getAllByText('Predefinito').length).toBeGreaterThan(0);
        } finally {
            await setAppLanguage('en');
        }
    });

    it('opens the roster and shows the no-members state + generate-code CTA', async () => {
        await openRoster();
        expect(screen.getByText('No students enrolled yet.')).toBeTruthy();
        expect(screen.getByText(/Generate registration code/i)).toBeTruthy();
    });

    it('renders enrolled students with role label via roleLabel()', async () => {
        await openRoster({ id: 1, name: 'Cardio', join_code: 'XYZ999' }, [
            { id: 5, username: 'alice', name: 'Alice A', role: 'student' },
            { id: 6, username: 'teacher', name: 'Teacher T', role: 'educator' },
        ]);
        expect(screen.getByText('Alice A')).toBeTruthy();
        expect(screen.getByText(/alice · Student/)).toBeTruthy();
        expect(screen.queryByText('Teacher T')).toBeNull();
        // join code is shown when present
        expect(screen.getByText('XYZ999')).toBeTruthy();
    });

    it('adds a member and reloads', async () => {
        await openRoster();
        svc.addCohortMember.mockResolvedValue({});
        fireEvent.change(
            screen.getByPlaceholderText(/Add student by username or email/i),
            { target: { value: ' bob ' } },
        );
        fireEvent.click(screen.getByRole('button', { name: /^Add student$/i }));
        await waitFor(() =>
            expect(svc.addCohortMember).toHaveBeenCalledWith(1, 'bob'));
        expect(toast.success).toHaveBeenCalledWith('Member added');
    });

    it('removes a member after confirm', async () => {
        await openRoster({ id: 1, name: 'Cardio' }, [
            { id: 7, username: 'carol', name: 'Carol' },
        ]);
        svc.removeCohortMember.mockResolvedValue({});
        fireEvent.click(screen.getByTitle('Remove student'));
        await waitFor(() =>
            expect(svc.removeCohortMember).toHaveBeenCalledWith(1, 7));
        expect(toast.success).toHaveBeenCalledWith('Member removed');
    });

    it('generates a join code when none exists', async () => {
        await openRoster();
        svc.rotateJoinCode.mockResolvedValue({ join_code: 'NEW777' });
        fireEvent.click(screen.getByText(/Generate registration code/i));
        await waitFor(() => expect(screen.getByText('NEW777')).toBeTruthy());
        expect(toast.success).toHaveBeenCalledWith('Join code generated');
    });

    it('rotates and disables an existing join code', async () => {
        await openRoster({ id: 1, name: 'Cardio', join_code: 'OLD111' }, []);
        svc.rotateJoinCode.mockResolvedValue({ join_code: 'ROT222' });
        fireEvent.click(screen.getByRole('button', { name: /Rotate/i }));
        await waitFor(() => expect(screen.getByText('ROT222')).toBeTruthy());

        svc.disableJoinCode.mockResolvedValue({});
        fireEvent.click(screen.getByRole('button', { name: /Disable/i }));
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Join code disabled'));
    });

    it('copies the join code to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        await openRoster({ id: 1, name: 'Cardio', join_code: 'CPY333' }, []);
        fireEvent.click(screen.getByTitle('Copy registration code'));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('CPY333'));
    });

    it('switches to the Reports section (renders the stub)', async () => {
        await openRoster();
        fireEvent.click(screen.getByRole('button', { name: /Reports/i }));
        await waitFor(() =>
            expect(screen.getByTestId('reports-stub')).toBeTruthy());
        expect(screen.getByText('reports:1')).toBeTruthy();
    });

    it('navigates back to the class list', async () => {
        await openRoster({ id: 1, name: 'Cardio' }, []);
        fireEvent.click(screen.getByText('Back to courses'));
        // Back returns to the list; the class row (not the roster header)
        // is shown again and the roster "Back" affordance is gone.
        await waitFor(() =>
            expect(screen.queryByText('Back to courses')).toBeNull());
        expect(screen.getByText('Cardio')).toBeTruthy();
        expect(screen.getByPlaceholderText('New course name')).toBeTruthy();
    });

    it('shows "Course not found" when getCohort returns no cohort', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 1, name: 'Ghost', member_count: 0 }],
        });
        svc.getCohort.mockResolvedValue({ cohort: null, members: [] });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Ghost')).toBeTruthy());
        fireEvent.click(screen.getByText('Ghost'));
        await waitFor(() =>
            expect(screen.getByText('Course not found.')).toBeTruthy());
    });
});

describe('CohortsManagementTab — course access switch', () => {
    const LABEL = 'Only show cases to enrolled course members';

    // Regression lock: FI0010.AUTHOR.02 — course access switch was only reachable in the first-run wizard
    it('shows the admin switch with the server state, and turning it on calls setEnforcementFlag(true)', async () => {
        userSvc.getEnforcementFlag.mockResolvedValue({ enabled: false });
        userSvc.setEnforcementFlag.mockResolvedValue({ enabled: true });
        renderWithProviders(<CohortsManagementTab />);
        const box = await screen.findByLabelText(LABEL);
        expect(box.checked).toBe(false);
        expect(screen.getByText(/On \(default\): students see only the cases of their courses, plus the default case if they registered themselves or their course allows it/)).toBeTruthy();

        fireEvent.click(box);
        await waitFor(() => expect(userSvc.setEnforcementFlag).toHaveBeenCalledWith(true));
        await waitFor(() => expect(screen.getByLabelText(LABEL).checked).toBe(true));
        expect(toast.success).toHaveBeenCalledWith(
            'Course access on: students now see only the cases of their courses.');
    });

    it('reflects an ON server state and turns it off', async () => {
        userSvc.getEnforcementFlag.mockResolvedValue({ enabled: true });
        userSvc.setEnforcementFlag.mockResolvedValue({ enabled: false });
        renderWithProviders(<CohortsManagementTab />);
        const box = await screen.findByLabelText(LABEL);
        expect(box.checked).toBe(true);
        fireEvent.click(box);
        await waitFor(() => expect(userSvc.setEnforcementFlag).toHaveBeenCalledWith(false));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
            'Course access off: students now see every published case.'));
    });

    it('keeps the old state and reports the failure when saving fails', async () => {
        userSvc.getEnforcementFlag.mockResolvedValue({ enabled: false });
        userSvc.setEnforcementFlag.mockRejectedValue(new ApiError('nope', { status: 500 }));
        renderWithProviders(<CohortsManagementTab />);
        fireEvent.click(await screen.findByLabelText(LABEL));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
        expect(screen.getByLabelText(LABEL).checked).toBe(false);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('is hidden from an educator (the admin-only read answers 403)', async () => {
        // beforeEach already makes getEnforcementFlag reject with a 403.
        svc.listCohorts.mockResolvedValue({ cohorts: [{ id: 1, name: 'Cardio', member_count: 0 }] });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
        await waitFor(() => expect(userSvc.getEnforcementFlag).toHaveBeenCalled());
        expect(screen.queryByLabelText(LABEL)).toBeNull();
        expect(screen.queryByTestId('course-access-policy')).toBeNull();
    });

    it('says so when the setting cannot be read for another reason', async () => {
        userSvc.getEnforcementFlag.mockRejectedValue(new ApiError('down', { status: 500 }));
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() =>
            expect(screen.getByText('Could not load the course access setting.')).toBeTruthy());
        expect(screen.queryByLabelText(LABEL)).toBeNull();
    });
});

describe('CohortsManagementTab — membership hint when course access is off', () => {
    const HINT = /Course membership does not currently limit which cases students see/;

    async function openCourse(cohort, caseAccessEnforced) {
        svc.listCohorts.mockResolvedValue({ cohorts: [{ ...cohort, member_count: 0 }] });
        svc.getCohort.mockResolvedValue({ cohort, members: [], case_access_enforced: caseAccessEnforced });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(cohort.name)).toBeTruthy());
        fireEvent.click(screen.getByText(cohort.name));
        await waitFor(() => expect(screen.getByText('Back to courses')).toBeTruthy());
    }

    it('warns on a regular course while enforcement is off', async () => {
        await openCourse({ id: 2, name: 'Cardio', is_default: 0 }, false);
        expect(screen.getByText(HINT)).toBeTruthy();
    });

    it('stays quiet when enforcement is on', async () => {
        await openCourse({ id: 2, name: 'Cardio', is_default: 0 }, true);
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('stays quiet on the default course, whose case everyone sees anyway', async () => {
        await openCourse({ id: 1, name: 'Cardiology 101', is_default: 1 }, false);
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('stays quiet when the server does not report the setting', async () => {
        await openCourse({ id: 2, name: 'Cardio', is_default: 0 }, undefined);
        expect(screen.queryByText(HINT)).toBeNull();
    });
});

describe('CohortsManagementTab — per-course default-case access', () => {
    const LABEL = /Members also get the default case/;

    async function openSettings(cohort) {
        svc.listCohorts.mockResolvedValue({ cohorts: [{ id: cohort.id, name: cohort.name, member_count: 0 }] });
        svc.getCohort.mockResolvedValue({
            cohort, members: [], students: [], teachers: [], cases: [],
        });
        svc.updateCohort.mockResolvedValue({});
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(cohort.name)).toBeTruthy());
        fireEvent.click(screen.getByTitle('Class settings'));
        await screen.findByText('Classroom policy');
    }

    const savedSettings = () => svc.updateCohort.mock.calls.at(-1)[1].settings;

    // Regression lock: per-course default-case access is editable in the course settings
    it('shows the checkbox on a regular course and saves default_case_access: true without dropping other keys', async () => {
        await openSettings({
            id: 2, name: 'Cardio', is_default: 0,
            settings: { allow_retakes: false, require_debrief: true, term: 'Spring', future_key: 'kept' },
        });
        const box = screen.getByLabelText(LABEL);
        expect(box.checked).toBe(false);
        expect(screen.getByText(/Off: members see only this course's cases/)).toBeTruthy();

        fireEvent.click(box);
        fireEvent.click(screen.getByRole('button', { name: 'Save class settings' }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(svc.updateCohort.mock.calls[0][0]).toBe(2);
        expect(savedSettings()).toEqual({
            allow_retakes: false,
            require_debrief: true,
            term: 'Spring',
            future_key: 'kept',
            default_case_access: true,
        });
    });

    it('shows a stored true as checked and keeps it when only another setting changes', async () => {
        await openSettings({
            id: 2, name: 'Cardio', is_default: 0,
            settings: JSON.stringify({ default_case_access: true, allow_retakes: true }),
        });
        expect(screen.getByLabelText(LABEL).checked).toBe(true);

        fireEvent.click(screen.getByLabelText(/Require debrief/));
        fireEvent.click(screen.getByRole('button', { name: 'Save class settings' }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(savedSettings()).toEqual({
            default_case_access: true,
            allow_retakes: true,
            require_debrief: true,
        });
    });

    it('reads an absent key as off and never turns it on by saving something else', async () => {
        await openSettings({ id: 2, name: 'Cardio', is_default: 0, settings: { term: 'Fall' } });
        expect(screen.getByLabelText(LABEL).checked).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Save class settings' }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(savedSettings().default_case_access).toBe(false);
        expect(savedSettings().term).toBe('Fall');
    });

    it('turns a stored true off when the educator unticks it', async () => {
        await openSettings({ id: 2, name: 'Cardio', is_default: 0, settings: { default_case_access: true } });
        fireEvent.click(screen.getByLabelText(LABEL));
        fireEvent.click(screen.getByRole('button', { name: 'Save class settings' }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(savedSettings().default_case_access).toBe(false);
    });

    it('is hidden on the default course, and saving there leaves the settings untouched', async () => {
        await openSettings({
            id: 1, name: 'Cardiology 101', is_default: 1,
            settings: { allow_retakes: true, require_debrief: false },
        });
        expect(screen.queryByLabelText(LABEL)).toBeNull();
        expect(screen.queryByText(/Off: members see only this course's cases/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Save class settings' }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(savedSettings()).toEqual({ allow_retakes: true, require_debrief: false });
        expect('default_case_access' in savedSettings()).toBe(false);
    });
});
