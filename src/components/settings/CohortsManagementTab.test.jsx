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

beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockReset());
    Object.values(svc).forEach((f) => f.mockReset());
    toast.confirm.mockResolvedValue(true);
    svc.listCohorts.mockResolvedValue({ cohorts: [] });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('CohortsManagementTab — list view', () => {
    it('shows the empty state when there are no classes', async () => {
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() =>
            expect(screen.getByText(/No classes yet/i)).toBeTruthy());
    });

    it('surfaces a load error via toast', async () => {
        svc.listCohorts.mockRejectedValue(new ApiError('boom', 500));
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    });

    it('renders cohorts with member-count pluralisation and join-code state', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [
                { id: 1, name: 'Cardio', member_count: 1, join_code: 'ABC123' },
                { id: 2, name: 'Neuro', member_count: 0, join_code: null },
            ],
        });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
        expect(screen.getByText(/1 member ·/)).toBeTruthy();
        expect(screen.getByText(/join code active/)).toBeTruthy();
        expect(screen.getByText(/0 members ·/)).toBeTruthy();
        expect(screen.getByText(/no join code/)).toBeTruthy();
    });

    it('creates a class, clears the input, and reloads', async () => {
        svc.listCohorts.mockResolvedValue({ cohorts: [] });
        svc.createCohort.mockResolvedValue({});
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No classes yet/i)).toBeTruthy());

        const input = screen.getByPlaceholderText('New class name');
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
        await waitFor(() => expect(screen.getByText(/No classes yet/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText('New class name'), {
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
            expect(screen.getByText('Back to classes')).toBeTruthy());
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
            expect(screen.getByText('Back to classes')).toBeTruthy());
    }

    it('opens the roster and shows the no-members state + generate-code CTA', async () => {
        await openRoster();
        expect(screen.getByText('No members yet.')).toBeTruthy();
        expect(screen.getByText(/Generate join code/i)).toBeTruthy();
    });

    it('renders members with role label via roleLabel()', async () => {
        await openRoster({ id: 1, name: 'Cardio', join_code: 'XYZ999' }, [
            { id: 5, username: 'alice', name: 'Alice A', role: 'educator' },
        ]);
        expect(screen.getByText('Alice A')).toBeTruthy();
        expect(screen.getByText(/alice · Teacher/)).toBeTruthy();
        // join code is shown when present
        expect(screen.getByText('XYZ999')).toBeTruthy();
    });

    it('adds a member and reloads', async () => {
        await openRoster();
        svc.addCohortMember.mockResolvedValue({});
        fireEvent.change(
            screen.getByPlaceholderText(/Add member by username or email/i),
            { target: { value: ' bob ' } },
        );
        fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
        await waitFor(() =>
            expect(svc.addCohortMember).toHaveBeenCalledWith(1, 'bob'));
        expect(toast.success).toHaveBeenCalledWith('Member added');
    });

    it('removes a member after confirm', async () => {
        await openRoster({ id: 1, name: 'Cardio' }, [
            { id: 7, username: 'carol', name: 'Carol' },
        ]);
        svc.removeCohortMember.mockResolvedValue({});
        fireEvent.click(screen.getByTitle('Remove member'));
        await waitFor(() =>
            expect(svc.removeCohortMember).toHaveBeenCalledWith(1, 7));
        expect(toast.success).toHaveBeenCalledWith('Member removed');
    });

    it('generates a join code when none exists', async () => {
        await openRoster();
        svc.rotateJoinCode.mockResolvedValue({ join_code: 'NEW777' });
        fireEvent.click(screen.getByText(/Generate join code/i));
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
        fireEvent.click(screen.getByTitle('Copy join code'));
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
        fireEvent.click(screen.getByText('Back to classes'));
        // Back returns to the list; the class row (not the roster header)
        // is shown again and the roster "Back" affordance is gone.
        await waitFor(() =>
            expect(screen.queryByText('Back to classes')).toBeNull());
        expect(screen.getByText('Cardio')).toBeTruthy();
        expect(screen.getByPlaceholderText('New class name')).toBeTruthy();
    });

    it('shows "Class not found" when getCohort returns no cohort', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 1, name: 'Ghost', member_count: 0 }],
        });
        svc.getCohort.mockResolvedValue({ cohort: null, members: [] });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Ghost')).toBeTruthy());
        fireEvent.click(screen.getByText('Ghost'));
        await waitFor(() =>
            expect(screen.getByText('Class not found.')).toBeTruthy());
    });
});
