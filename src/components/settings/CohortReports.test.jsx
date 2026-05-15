import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CohortReports from './CohortReports.jsx';

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

let fetchSpy;

beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    fetchSpy.mockRestore();
});

describe('CohortReports', () => {
    it('renders the four reporting sub-tabs and the roster by default', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/roster')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    roster: [{
                        id: 9, username: 'stu', name: 'Stu', role: 'student',
                        session_count: 3, cases_attempted: 2,
                        cases_completed: 1, last_activity: null,
                    }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(<CohortReports cohortId={1} />);

        expect(screen.getByText('Completion grid')).toBeTruthy();
        expect(screen.getByText('Live feed')).toBeTruthy();
        await waitFor(() => expect(screen.getByText('Stu')).toBeTruthy());
    });

    it('shows the empty-grid message when no cases attempted', async () => {
        fetchSpy.mockImplementation((url) => {
            if (String(url).includes('/grid')) {
                return Promise.resolve(jsonResponse({
                    cohort: { id: 1, name: 'C' },
                    students: [{ id: 9, username: 'stu', name: 'Stu' }],
                    cases: [],
                    cells: {},
                }));
            }
            return Promise.resolve(jsonResponse({
                cohort: { id: 1, name: 'C' }, roster: [],
            }));
        });

        renderWithProviders(<CohortReports cohortId={1} />);
        fireEvent.click(screen.getByText('Completion grid'));
        await waitFor(() =>
            expect(screen.getByText(/No cases attempted/)).toBeTruthy());
    });
});
