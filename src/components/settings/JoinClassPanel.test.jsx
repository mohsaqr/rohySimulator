import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import JoinClassPanel from './JoinClassPanel.jsx';

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

// Route the two endpoints the panel touches: GET /cohorts/mine (list) and
// POST /cohorts/join. `mine` may be a function so a test can change the
// list between the initial load and the post-join refresh.
function mockApi({ mine = { cohorts: [] }, join = jsonResponse({}) } = {}) {
    fetchSpy.mockImplementation((url) => {
        const u = String(url);
        if (u.includes('/cohorts/mine')) {
            return Promise.resolve(typeof mine === 'function' ? mine() : jsonResponse(mine));
        }
        if (u.includes('/cohorts/join')) {
            return Promise.resolve(typeof join === 'function' ? join() : join);
        }
        return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
}

beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    fetchSpy.mockRestore();
});

describe('JoinClassPanel', () => {
    it('renders the join-code form and the empty "My classes" state', async () => {
        mockApi();
        renderWithProviders(<JoinClassPanel />);
        expect(screen.getByText('Join a class')).toBeTruthy();
        expect(screen.getByPlaceholderText(/e\.g\. ABC123/)).toBeTruthy();
        expect(screen.getByText('My classes')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByText(/haven't joined a class yet/)).toBeTruthy();
        });
    });

    it('renders the caller\'s memberships from /cohorts/mine', async () => {
        // Regression lock: a successful join was invisible — the panel showed
        // only a toast and no membership list (bug report 2.9.15 #18).
        mockApi({
            mine: {
                cohorts: [
                    { id: 1, name: 'Cardiology 101', description: 'Winter term', joined_at: '2026-08-01 09:00:00', status: 'active' },
                    { id: 2, name: 'Emergency 200', description: null, joined_at: '2026-08-02 09:00:00', status: 'active' },
                ],
            },
        });
        renderWithProviders(<JoinClassPanel />);
        await waitFor(() => {
            expect(screen.getByText('Cardiology 101')).toBeTruthy();
        });
        expect(screen.getByText('Emergency 200')).toBeTruthy();
        expect(screen.getByText('Winter term')).toBeTruthy();
    });

    it('refreshes the membership list after a successful join', async () => {
        // Regression lock: joining must become visibly confirmed — the list
        // reloads after POST /cohorts/join succeeds (bug report 2.9.15 #18).
        let mineCalls = 0;
        mockApi({
            mine: () => {
                mineCalls += 1;
                return jsonResponse(mineCalls === 1
                    ? { cohorts: [] }
                    : { cohorts: [{ id: 7, name: 'Cardiology 101', joined_at: '2026-08-08 10:00:00', status: 'active' }] });
            },
            join: jsonResponse({ cohort: { id: 7, name: 'Cardiology 101' } }),
        });
        renderWithProviders(<JoinClassPanel />);
        await waitFor(() => {
            expect(screen.getByText(/haven't joined a class yet/)).toBeTruthy();
        });

        fireEvent.change(screen.getByPlaceholderText(/e\.g\. ABC123/), {
            target: { value: 'ABC123' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Join class/i }));

        await waitFor(() => {
            expect(screen.getByText('Cardiology 101')).toBeTruthy();
        });
        expect(mineCalls).toBeGreaterThanOrEqual(2);
    });

    it('submits the code and toasts success with the cohort name', async () => {
        mockApi({ join: jsonResponse({ cohort: { id: 7, name: 'Cardiology 101' } }) });
        renderWithProviders(<JoinClassPanel />);

        fireEvent.change(screen.getByPlaceholderText(/e\.g\. ABC123/), {
            target: { value: 'ABC123' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Join class/i }));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Joined Cardiology 101');
        });
        const joinCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/cohorts/join'));
        expect(joinCall).toBeTruthy();
        expect(JSON.parse(joinCall[1].body)).toEqual({ join_code: 'ABC123' });
    });

    it('toasts the server message when the join fails', async () => {
        // The server distinguishes a closed class (COHORT_DELETED) from an
        // unknown code; the client surfaces the server's message verbatim.
        mockApi({ join: jsonResponse({ error: 'That class has been closed', code: 'COHORT_DELETED' }, { status: 404 }) });
        renderWithProviders(<JoinClassPanel />);

        fireEvent.change(screen.getByPlaceholderText(/e\.g\. ABC123/), {
            target: { value: 'BADCODE' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Join class/i }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('That class has been closed');
        });
        expect(toast.success).not.toHaveBeenCalled();
    });
});

// A course may carry an informational agreement (owner decision 2026-10-25).
// Regression lock: the learner can open it read-only, rendered by the terms
// renderer, and a course without one shows no link.
describe('JoinClassPanel — course agreement', () => {
    it('lets the learner open a course agreement and shows no link for a course without one', async () => {
        mockApi({
            mine: {
                cohorts: [
                    {
                        id: 1, name: 'Cardiology', joined_at: '2026-10-01 10:00:00',
                        oyon_sensing_enabled: true,
                        agreement: { title: 'Research information', body: '## Purpose\n\nWe study **learning**.' },
                    },
                    { id: 2, name: 'Plain course', joined_at: '2026-10-01 10:00:00', oyon_sensing_enabled: false, agreement: null },
                ],
            },
        });
        renderWithProviders(<JoinClassPanel />);
        await waitFor(() => expect(screen.getByText('Cardiology')).toBeTruthy());
        expect(screen.getAllByRole('button', { name: /Course agreement/ })).toHaveLength(1);
        expect(screen.getByText(/Optional learning measures \(Oyon\) are enabled in this course/)).toBeTruthy();
        expect(screen.queryByTestId('learner-course-agreement')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Course agreement/ }));
        const doc = await screen.findByTestId('learner-course-agreement');
        expect(doc.querySelector('h4').textContent).toBe('Research information');
        expect(doc.querySelector('h3').textContent).toBe('Purpose');
        expect(doc.querySelector('strong').textContent).toBe('learning');
        // Informational only: nothing to accept.
        expect(screen.queryByRole('button', { name: /^(accept|i agree)/i })).toBeNull();
    });
});
