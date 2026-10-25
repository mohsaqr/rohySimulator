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
        'removeCohortTeacher', 'listLibraryCases', 'listTenantUsers',
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
    svc.listLibraryCases.mockResolvedValue({ cases: [{ id: 11, name: 'Sepsis' }] });
    svc.listTenantUsers.mockResolvedValue({
        users: [{ id: 3, username: 'sam', name: 'Sam', role: 'student' }],
    });
    userSvc.getEnforcementFlag.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
});
afterEach(() => vi.restoreAllMocks());


// Owner decision 2026-10-25: Oyon sensing is a per-COURSE teacher switch, and a
// course may carry an informational agreement. Regression lock: the course form
// sends both keys, previews the agreement with the terms renderer, and — since
// PATCH replaces settings wholesale — merges every other stored key.
const NOTICE = /Obtaining any agreements, consents or approvals needed for this course is the teacher's responsibility/;

async function openSettingsWith(settings) {
    svc.listCohorts.mockResolvedValue({ cohorts: [{ id: 1, name: 'Cardio', member_count: 0 }] });
    svc.getCohort.mockResolvedValue({
        cohort: { id: 1, name: 'Cardio', owner_user_id: 50, settings },
        members: [], students: [], teachers: [], cases: [],
    });
    renderWithProviders(<CohortsManagementTab />);
    await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
    fireEvent.click(screen.getByText('Cardio'));
    await waitFor(() => expect(screen.getByText('Back to courses')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/i }));
    await screen.findByDisplayValue('Cardio');
}

describe('course form: learning measures + agreement', () => {
    it('defaults the Oyon toggle off and shows the responsibility notice', async () => {
        await openSettingsWith(null);
        const toggle = screen.getByLabelText(/Optional learning measures \(Oyon\) in this course/);
        expect(toggle.checked).toBe(false);
        expect(screen.getByText(/only takes effect when Oyon is enabled for the platform/i)).toBeTruthy();
        expect(screen.getByText(NOTICE)).toBeTruthy();
    });

    it('previews the agreement with the terms renderer and saves both keys merged over existing settings', async () => {
        await openSettingsWith(JSON.stringify({ course_code: 'C-1', some_future_key: 'keep me', oyon_sensing_enabled: false }));
        svc.updateCohort.mockResolvedValue({});

        fireEvent.click(screen.getByLabelText(/Optional learning measures \(Oyon\) in this course/));
        fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: '  Research information ' } });
        fireEvent.change(screen.getByLabelText('Agreement text'), {
            target: { value: '\n## Purpose\n\nWe study **learning**.\n\n- Data stays here\n' },
        });

        fireEvent.click(screen.getByRole('button', { name: /Preview as learners see it/i }));
        const preview = await screen.findByTestId('course-agreement-preview');
        // Rendered by TermsDocument: a heading, bold text and a list item — not raw Markdown.
        expect(preview.querySelector('h3').textContent).toBe('Research information');
        expect(Array.from(preview.querySelectorAll('h3')).map((h) => h.textContent)).toContain('Purpose');
        expect(preview.querySelector('strong').textContent).toBe('learning');
        expect(preview.querySelector('li').textContent).toBe('Data stays here');
        expect(preview.textContent).not.toContain('##');

        fireEvent.click(screen.getByRole('button', { name: /Save class settings/i }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        const { settings } = svc.updateCohort.mock.calls[0][1];
        expect(settings).toMatchObject({
            course_code: 'C-1',
            some_future_key: 'keep me',
            oyon_sensing_enabled: true,
            agreement: { title: 'Research information', body: '## Purpose\n\nWe study **learning**.\n\n- Data stays here' },
        });
    });

    it('seeds from stored settings and clears the agreement when its text is emptied', async () => {
        await openSettingsWith({ oyon_sensing_enabled: true, agreement: { title: 'Rules', body: 'Be kind.' } });
        svc.updateCohort.mockResolvedValue({});
        expect(screen.getByLabelText(/Optional learning measures \(Oyon\) in this course/).checked).toBe(true);
        expect(screen.getByLabelText('Agreement title').value).toBe('Rules');
        fireEvent.change(screen.getByLabelText('Agreement text'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: /Save class settings/i }));
        await waitFor(() => expect(svc.updateCohort).toHaveBeenCalledTimes(1));
        expect(svc.updateCohort.mock.calls[0][1].settings).toMatchObject({ oyon_sensing_enabled: true, agreement: null });
    });

    it('the create form sends the Oyon switch in settings', async () => {
        svc.createCohort.mockResolvedValue({ cohort: { id: 5 } });
        renderWithProviders(<CohortsManagementTab />);
        await waitFor(() => expect(screen.getByText(/No courses yet/i)).toBeTruthy());
        fireEvent.change(screen.getByPlaceholderText('New course name'), { target: { value: 'Block B' } });
        fireEvent.click(screen.getByText(/Add details, cases, co-teachers/i));
        fireEvent.click(screen.getByLabelText(/Optional learning measures \(Oyon\) in this course/));
        fireEvent.click(screen.getByRole('button', { name: /^Create course$/i }));
        await waitFor(() => expect(svc.createCohort).toHaveBeenCalledTimes(1));
        expect(svc.createCohort.mock.calls[0][0]).toMatchObject({ name: 'Block B' });
        expect(svc.createCohort.mock.calls[0][0].settings).toEqual({ oyon_sensing_enabled: true });
    });
});
