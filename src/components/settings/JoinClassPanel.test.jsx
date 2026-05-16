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

beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    fetchSpy.mockRestore();
});

describe('JoinClassPanel', () => {
    it('renders the join-code form', () => {
        renderWithProviders(<JoinClassPanel />);
        expect(screen.getByText('Join a class')).toBeTruthy();
        expect(screen.getByPlaceholderText(/e\.g\. ABC123/)).toBeTruthy();
    });

    it('submits the code and toasts success with the cohort name', async () => {
        fetchSpy.mockImplementation(() =>
            Promise.resolve(jsonResponse({ cohort: { id: 7, name: 'Cardiology 101' } })));
        renderWithProviders(<JoinClassPanel />);

        fireEvent.change(screen.getByPlaceholderText(/e\.g\. ABC123/), {
            target: { value: 'ABC123' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Join class/i }));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Joined Cardiology 101');
        });
        const [url, opts] = fetchSpy.mock.calls.at(-1);
        expect(String(url)).toContain('/cohorts/join');
        expect(JSON.parse(opts.body)).toEqual({ join_code: 'ABC123' });
    });

    it('toasts an error when the join fails', async () => {
        fetchSpy.mockImplementation(() =>
            Promise.resolve(jsonResponse({ error: 'Invalid join code' }, { status: 404 })));
        renderWithProviders(<JoinClassPanel />);

        fireEvent.change(screen.getByPlaceholderText(/e\.g\. ABC123/), {
            target: { value: 'BADCODE' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Join class/i }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalled();
        });
        expect(toast.success).not.toHaveBeenCalled();
    });
});
