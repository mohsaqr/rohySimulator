import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import LabInvestigationEditor from './LabInvestigationEditor.jsx';

const toast = {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
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

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/labs/groups')) {
            return Promise.resolve(jsonResponse({ groups: ['Chemistry'] }));
        }
        if (typeof url === 'string' && url.includes('/api/labs/search')) {
            return Promise.resolve(jsonResponse({
                results: [[{
                    test_name: 'Sodium',
                    group: 'Chemistry',
                    category: 'Both',
                    min_value: 135,
                    max_value: 145,
                    unit: 'mmol/L',
                    normal_samples: [140],
                }]],
            }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('LabInvestigationEditor apiFetch migration', () => {
    it('loads groups and searches labs with bearer auth', async () => {
        renderWithProviders(
            <LabInvestigationEditor
                caseData={{ config: { investigations: { labs: [] } } }}
                setCaseData={vi.fn()}
                patientGender="Both"
            />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await waitFor(() => {
            expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/api/labs/groups'))).toBe(true);
        });
        fireEvent.change(screen.getByPlaceholderText(/Search tests/i), { target: { value: 'sodium' } });

        await waitFor(() => {
            expect(screen.getByText('Sodium')).toBeInTheDocument();
        });

        const groupsCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/api/labs/groups'));
        expect(groupsCall[1].headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(groupsCall[1].headers['X-Request-Id']).toBeTruthy();

        const searchCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/api/labs/search'));
        expect(searchCall[1].headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(searchCall[1].headers['X-Request-Id']).toBeTruthy();
    });
});
