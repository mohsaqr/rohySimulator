import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import CohortsManagementTab from './CohortsManagementTab.jsx';

const toast = { success: vi.fn(), error: vi.fn(), confirm: vi.fn() };
vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});
vi.mock('./CohortReports', () => ({
    default: () => <div data-testid="reports-stub" />,
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
    listLibraryCases: vi.fn(),
    listTenantUsers: vi.fn(),
};
vi.mock('../../services/cohortsService', () => {
    const proxy = {};
    for (const k of [
        'listCohorts', 'getCohort', 'createCohort',
        'deleteCohort', 'addCohortMember', 'removeCohortMember',
        'rotateJoinCode', 'disableJoinCode', 'updateCohort',
        'assignCohortCases', 'unassignCohortCase', 'addCohortTeacher',
        'removeCohortTeacher', 'listLibraryCases', 'listTenantUsers',
    ]) proxy[k] = (...a) => svc[k](...a);
    return proxy;
});

beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockReset());
    Object.values(svc).forEach((f) => f.mockReset());
    toast.confirm.mockResolvedValue(true);
    svc.listCohorts.mockResolvedValue({ cohorts: [] });
    svc.listLibraryCases.mockResolvedValue({ cases: [{ id: 11, name: 'Sepsis' }] });
    svc.listTenantUsers.mockResolvedValue({
        users: [{ id: 3, username: 'sam', name: 'Sam', role: 'student' }],
    });
});
afterEach(() => vi.restoreAllMocks());

describe('Phase-9 rich create form', () => {
    it('sends a single rich POST with description, dates, join code and cases', async () => {
        svc.createCohort.mockResolvedValue({ cohort: { id: 99 } });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No classes yet/i)).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText('New class name'), {
            target: { value: 'Block A' },
        });
        fireEvent.click(screen.getByText(/Add details, cases, co-teachers/i));
        fireEvent.change(screen.getByPlaceholderText(/What is this class for/i), {
            target: { value: 'Year 3' },
        });
        fireEvent.click(screen.getByLabelText(/Generate a join code now/i));
        await waitFor(() => expect(screen.getByText('Sepsis')).toBeTruthy());
        fireEvent.click(screen.getByText('Sepsis'));

        fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
        await waitFor(() => expect(svc.createCohort).toHaveBeenCalledTimes(1));
        const payload = svc.createCohort.mock.calls[0][0];
        expect(payload).toMatchObject({
            name: 'Block A',
            description: 'Year 3',
            join_code: true,
            case_ids: [11],
        });
        expect(toast.success).toHaveBeenCalledWith('Class "Block A" created');
    });

    it('keeps the minimal name-only path (string arg, legacy contract)', async () => {
        svc.createCohort.mockResolvedValue({});
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No classes yet/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText('New class name'), {
            target: { value: 'Plain' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
        await waitFor(() =>
            expect(svc.createCohort).toHaveBeenCalledWith('Plain'));
    });

    it('blocks create when start date is after end date', async () => {
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No classes yet/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText('New class name'), {
            target: { value: 'Bad Dates' },
        });
        fireEvent.click(screen.getByText(/Add details, cases, co-teachers/i));
        const [start, end] = screen.getAllByDisplayValue('').filter(
            (el) => el.type === 'date',
        );
        fireEvent.change(start, { target: { value: '2026-06-10' } });
        fireEvent.change(end, { target: { value: '2026-06-01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                'Start date must be on or before the end date',
            ));
        expect(svc.createCohort).not.toHaveBeenCalled();
    });
});

async function openSettings() {
    svc.listCohorts.mockResolvedValue({
        cohorts: [{ id: 1, name: 'Cardio', member_count: 0 }],
    });
    svc.getCohort.mockResolvedValue({
        cohort: { id: 1, name: 'Cardio', description: 'old', owner_user_id: 50 },
        members: [],
        students: [],
        teachers: [{ id: 8, username: 'cot', name: 'Co T', role: 'educator' }],
        cases: [{ id: 11, name: 'Sepsis' }],
    });
    renderWithProviders(<CohortsManagementTab />);
    await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
    fireEvent.click(screen.getByText('Cardio'));
    await waitFor(() => expect(screen.getByText('Back to classes')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
}

describe('Phase-9 Settings sub-nav', () => {
    it('PATCHes name/description/dates', async () => {
        await openSettings();
        svc.updateCohort.mockResolvedValue({});
        const nameInput = await screen.findByDisplayValue('Cardio');
        fireEvent.change(nameInput, { target: { value: 'Cardio II' } });
        fireEvent.click(screen.getByRole('button', { name: /Save class settings/i }));
        await waitFor(() =>
            expect(svc.updateCohort).toHaveBeenCalledWith(
                1,
                expect.objectContaining({ name: 'Cardio II' }),
            ));
        expect(toast.success).toHaveBeenCalledWith('Class details saved');
    });

    it('unassigns a case after confirm', async () => {
        await openSettings();
        svc.unassignCohortCase.mockResolvedValue({});
        await screen.findByText(/Assigned cases \(1\)/i);
        fireEvent.click(screen.getByTitle('Unassign case'));
        await waitFor(() =>
            expect(svc.unassignCohortCase).toHaveBeenCalledWith(1, 11));
    });

    it('removes a co-teacher (owner shown non-removable)', async () => {
        await openSettings();
        svc.removeCohortTeacher.mockResolvedValue({});
        await screen.findByText(/Co-teachers \(1\)/i);
        expect(
            screen.getByText(/class owner is always a teacher/i),
        ).toBeTruthy();
        fireEvent.click(screen.getByTitle('Remove co-teacher'));
        await waitFor(() =>
            expect(svc.removeCohortTeacher).toHaveBeenCalledWith(1, 8));
    });
});

describe('Phase-9 bulk student add', () => {
    it('throttled batch produces ONE summary toast (added + skipped)', async () => {
        svc.listCohorts.mockResolvedValue({
            cohorts: [{ id: 1, name: 'Cardio', member_count: 0 }],
        });
        svc.getCohort.mockResolvedValue({
            cohort: { id: 1, name: 'Cardio' },
            members: [], students: [], teachers: [], cases: [],
        });
        svc.listTenantUsers.mockRejectedValue(
            Object.assign(new Error('forbidden'), { status: 403, name: 'ApiError' }),
        );
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
        fireEvent.click(screen.getByText('Cardio'));
        await waitFor(() => expect(screen.getByText('Back to classes')).toBeTruthy());

        fireEvent.click(screen.getByText(/Add students in bulk/i));
        const ta = await screen.findByLabelText(
            /Add students by username or email/i,
        );
        fireEvent.change(ta, { target: { value: 'a\nb\nc' } });

        svc.addCohortMember
            .mockResolvedValueOnce({ membership: { created: true } })
            .mockResolvedValueOnce({ already_teacher: true })
            .mockResolvedValueOnce({ membership: { created: true } });

        fireEvent.click(
            await screen.findByRole('button', { name: /Add 3 students/i }),
        );
        await waitFor(() =>
            expect(svc.addCohortMember).toHaveBeenCalledTimes(3));
        expect(toast.success).toHaveBeenCalledWith(
            'Added 2, 1 already a member.',
        );
    });
});
