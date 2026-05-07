import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import MedicationManager from './MedicationManager.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

let mockUser = { id: 1, username: 'admin', role: 'admin', tenant_id: 1 };

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: mockUser, isAdmin: () => mockUser?.role === 'admin' }),
    };
});

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useToast: () => toast,
    };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

const medication = {
    id: 42,
    generic_name: 'Aspirin',
    drug_class: 'NSAID',
    category: 'Analgesic',
    route: 'oral',
    typical_dose: '81',
    dose_unit: 'mg',
    frequency: 'daily',
    indications: ['Headache'],
    scope: 'platform',
    created_by: 1,
};

let fetchSpy;

function medicationCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && url.includes('/api/') && url.includes('medications')
    );
}

beforeEach(() => {
    mockUser = { id: 1, username: 'admin', role: 'admin', tenant_id: 1 };
    localStorage.setItem('token', 'admin-token');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/master/medications')) {
            return Promise.resolve(jsonResponse({ medications: [medication] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/master/medications/bulk')) {
            return Promise.resolve(jsonResponse({ inserted: 2, skipped: 0 }));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    window.confirm.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('MedicationManager apiFetch migration', () => {
    it('loads medications with bearer auth and the correct path', async () => {
        renderWithProviders(
            <MedicationManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Aspirin')).toBeInTheDocument();

        const [url, init] = medicationCalls().find(([callUrl]) => callUrl.endsWith('/api/master/medications'));
        expect(url).toBe('/api/master/medications');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('POSTs the new medication JSON body when added', async () => {
        renderWithProviders(
            <MedicationManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
        fireEvent.change(screen.getByPlaceholderText(/e.g., Metformin/i), { target: { value: 'Metformin' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., Biguanide/i), { target: { value: 'Biguanide' } });
        fireEvent.change(screen.getByPlaceholderText(/e.g., 500mg/i), { target: { value: '500mg' } });
        fireEvent.change(screen.getByPlaceholderText(/Type 2 Diabetes/i), { target: { value: 'Type 2 Diabetes, PCOS' } });
        fireEvent.change(screen.getByPlaceholderText(/Nausea/i), { target: { value: 'Nausea, Diarrhea' } });
        fireEvent.click(screen.getByRole('button', { name: /Add Medication/i }));

        await waitFor(() => {
            expect(medicationCalls().some(([, init]) => init?.method === 'POST')).toBe(true);
        });

        const [url, init] = medicationCalls().find(([, callInit]) => callInit?.method === 'POST');
        expect(url).toBe('/api/master/medications');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer admin-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            generic_name: 'Metformin',
            drug_class: 'Biguanide',
            typical_dose: '500mg',
            indications: ['Type 2 Diabetes', 'PCOS'],
            side_effects: ['Nausea', 'Diarrhea'],
        });
    });

    it('PUTs the edited medication JSON body when saved', async () => {
        renderWithProviders(
            <MedicationManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        fireEvent.click(await screen.findByText('Aspirin'));
        fireEvent.click(await screen.findByRole('button', { name: /^Edit$/i }));
        fireEvent.change(screen.getByDisplayValue('Aspirin'), { target: { value: 'Aspirin EC' } });
        fireEvent.change(screen.getByDisplayValue('Headache'), { target: { value: 'Pain, Fever' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => {
            expect(medicationCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = medicationCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/catalogue/medications/42');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer admin-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            generic_name: 'Aspirin EC',
            indications: ['Pain', 'Fever'],
        });
    });

    it('surfaces an API error toast when adding a medication fails', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/api/master/medications') && init?.method === 'POST') {
                return Promise.resolve(jsonResponse({ error: 'duplicate medication' }, { status: 409 }));
            }
            if (typeof url === 'string' && url.endsWith('/api/master/medications')) {
                return Promise.resolve(jsonResponse({ medications: [] }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <MedicationManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText(/No medications in database/i);
        fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
        fireEvent.change(screen.getByPlaceholderText(/e.g., Metformin/i), { target: { value: 'Metformin' } });
        fireEvent.click(screen.getByRole('button', { name: /Add Medication/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('duplicate medication'));
    });

    it("doesn't render the medication management surface for non-admin users", async () => {
        mockUser = { id: 2, username: 'student', role: 'student', tenant_id: 1 };

        renderWithProviders(
            <MedicationManager />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText(/requires an administrator account/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Add$/i })).not.toBeInTheDocument();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
