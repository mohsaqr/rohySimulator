import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import LabTestManager from './LabTestManager.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

function labCalls() {
    return fetchSpy.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/labs'));
}

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    toast.confirm.mockResolvedValue(true);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.startsWith('/api/labs/all')) {
            return Promise.resolve(jsonResponse({
                tests: [{
                    test_name: 'Hemoglobin',
                    group: 'Hematology',
                    category: 'Both',
                    min_value: 12,
                    max_value: 16,
                    unit: 'g/dL',
                    normal_samples: [13, 14],
                }],
            }));
        }
        if (typeof url === 'string' && url.endsWith('/api/labs/groups')) {
            return Promise.resolve(jsonResponse({ groups: ['Hematology'] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/labs/stats')) {
            return Promise.resolve(jsonResponse({ total: 1 }));
        }
        if (typeof url === 'string' && url.endsWith('/api/labs/test')) {
            return Promise.resolve(jsonResponse({ ok: true }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('LabTestManager apiFetch migration', () => {
    it('loads lab tests with bearer auth and the correct path', async () => {
        renderWithProviders(
            <LabTestManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByRole('button', { name: /Hematology/ })).toBeInTheDocument();

        const [url, init] = labCalls().find(([callUrl]) => callUrl.startsWith('/api/labs/all'));
        expect(url).toBe('/api/labs/all?pageSize=1000');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('POSTs the new lab test JSON body when added', async () => {
        renderWithProviders(
            <LabTestManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByRole('button', { name: /Hematology/ });
        fireEvent.click(screen.getByRole('button', { name: /add test/i }));
        fireEvent.change(screen.getByPlaceholderText(/e.g., Hemoglobin/i), { target: { value: 'Sodium' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., Hematology/i), { target: { value: 'Chemistry' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., g\/dL/i), { target: { value: 'mmol/L' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., 12.0/i), { target: { value: '135' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., 16.0/i), { target: { value: '145' } });
        const addButtons = screen.getAllByRole('button', { name: /^add test$/i });
        fireEvent.click(addButtons[addButtons.length - 1]);

        await waitFor(() => {
            expect(labCalls().some(([, init]) => init?.method === 'POST')).toBe(true);
        });

        const [url, init] = labCalls().find(([, callInit]) => callInit?.method === 'POST');
        expect(url).toBe('/api/labs/test');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer admin-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            test_name: 'Sodium',
            group: 'Chemistry',
            unit: 'mmol/L',
            min_value: 135,
            max_value: 145,
            normal_samples: [],
        });
    });

    it('surfaces an API error toast when adding a lab test fails', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.startsWith('/api/labs/all')) {
                return Promise.resolve(jsonResponse({ tests: [] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/labs/groups')) {
                return Promise.resolve(jsonResponse({ groups: [] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/labs/stats')) {
                return Promise.resolve(jsonResponse({ total: 0 }));
            }
            if (typeof url === 'string' && url.endsWith('/api/labs/test') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({ error: 'duplicate test' }, { status: 409 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <LabTestManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText(/No tests found/i);
        fireEvent.click(screen.getByRole('button', { name: /add test/i }));
        fireEvent.change(screen.getByPlaceholderText(/e.g., Hemoglobin/i), { target: { value: 'Sodium' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., Hematology/i), { target: { value: 'Chemistry' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., g\/dL/i), { target: { value: 'mmol/L' } });
        const addButtons = screen.getAllByRole('button', { name: /^add test$/i });
        fireEvent.click(addButtons[addButtons.length - 1]);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('duplicate test'));
    });
});
