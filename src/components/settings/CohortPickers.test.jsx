import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import { ApiError } from '../../services/apiClient';
import { CasePicker, PeoplePicker } from './CohortPickers.jsx';

const svc = {
    listLibraryCases: vi.fn(),
    listTenantUsers: vi.fn(),
};

vi.mock('../../services/cohortsService', () => ({
    listLibraryCases: (...a) => svc.listLibraryCases(...a),
    listTenantUsers: (...a) => svc.listTenantUsers(...a),
}));

beforeEach(() => {
    Object.values(svc).forEach((f) => f.mockReset());
});
afterEach(() => vi.restoreAllMocks());

describe('CasePicker', () => {
    it('shows the library-empty guidance when there are no cases', async () => {
        svc.listLibraryCases.mockResolvedValue({ cases: [] });
        renderWithProviders(
            <CasePicker selected={new Set()} onToggle={() => {}} />,
        );
        await waitFor(() =>
            expect(screen.getByText(/No cases in the library yet/i)).toBeTruthy());
    });

    it('lists cases, filters by search, and toggles selection', async () => {
        svc.listLibraryCases.mockResolvedValue({
            cases: [
                { id: 1, name: 'Chest Pain' },
                { id: 2, name: 'Stroke' },
            ],
        });
        const onToggle = vi.fn();
        renderWithProviders(
            <CasePicker selected={new Set()} onToggle={onToggle} />,
        );
        await waitFor(() => expect(screen.getByText('Chest Pain')).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Search cases'), {
            target: { value: 'stro' },
        });
        await waitFor(() => expect(screen.queryByText('Chest Pain')).toBeNull());
        fireEvent.click(screen.getByText('Stroke'));
        expect(onToggle).toHaveBeenCalledWith(2);
    });

    it('hides excluded (already-assigned) cases', async () => {
        svc.listLibraryCases.mockResolvedValue({
            cases: [{ id: 1, name: 'Keep' }, { id: 2, name: 'Hidden' }],
        });
        renderWithProviders(
            <CasePicker selected={new Set()} onToggle={() => {}} excludeIds={[2]} />,
        );
        await waitFor(() => expect(screen.getByText('Keep')).toBeTruthy());
        expect(screen.queryByText('Hidden')).toBeNull();
    });

    it('surfaces a load error inline', async () => {
        svc.listLibraryCases.mockRejectedValue(new ApiError('nope', { status: 500 }));
        renderWithProviders(
            <CasePicker selected={new Set()} onToggle={() => {}} />,
        );
        await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
    });
});

describe('PeoplePicker', () => {
    it('renders a searchable multi-select when /users is accessible (admin)', async () => {
        svc.listTenantUsers.mockResolvedValue({
            users: [
                { id: 1, username: 'stu1', name: 'Student One', role: 'student' },
                { id: 2, username: 'teach', name: 'A Teacher', role: 'educator' },
            ],
        });
        const onChange = vi.fn();
        renderWithProviders(
            <PeoplePicker mode="students" onChange={onChange} />,
        );
        await waitFor(() => expect(screen.getByText('Student One')).toBeTruthy());
        // educator filtered out of the student-mode list
        expect(screen.queryByText('A Teacher')).toBeNull();
        fireEvent.click(screen.getByText('Student One'));
        await waitFor(() =>
            expect(onChange).toHaveBeenLastCalledWith(['stu1']));
    });

    it('falls back to the identifier textarea when /users is 403 (educator)', async () => {
        svc.listTenantUsers.mockRejectedValue(new ApiError('forbidden', { status: 403 }));
        const onChange = vi.fn();
        renderWithProviders(
            <PeoplePicker mode="teachers" onChange={onChange} />,
        );
        const ta = await screen.findByLabelText(
            /Add co-teachers by username or email/i,
        );
        fireEvent.change(ta, { target: { value: 'alice\nbob@example.com' } });
        await waitFor(() =>
            expect(onChange).toHaveBeenLastCalledWith(['alice', 'bob@example.com']));
    });

    it('select-all-of-filtered toggles every shown user', async () => {
        svc.listTenantUsers.mockResolvedValue({
            users: [
                { id: 1, username: 'a', name: 'A', role: 'student' },
                { id: 2, username: 'b', name: 'B', role: 'student' },
            ],
        });
        const onChange = vi.fn();
        renderWithProviders(
            <PeoplePicker mode="students" onChange={onChange} />,
        );
        await waitFor(() => expect(screen.getByText('A')).toBeTruthy());
        fireEvent.click(screen.getByText(/Select all 2 shown/i));
        await waitFor(() =>
            expect(onChange).toHaveBeenLastCalledWith(
                expect.arrayContaining(['a', 'b']),
            ));
    });
});
