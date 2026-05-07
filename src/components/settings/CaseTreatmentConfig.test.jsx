import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import CaseTreatmentConfig from './CaseTreatmentConfig.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

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

const effect = {
    id: 7,
    treatment_type: 'medication',
    treatment_name: 'Aspirin',
    route: 'PO',
    description: 'Antiplatelet',
    hr_effect: 0,
    bp_sys_effect: 0,
    spo2_effect: 0,
    onset_minutes: 5,
};

let fetchSpy;

function treatmentCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && (
            url.endsWith('/api/treatment-effects') ||
            url.endsWith('/api/cases/case-1/treatments')
        )
    );
}

beforeEach(() => {
    localStorage.setItem('token', 'educator-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/treatment-effects')) {
            return Promise.resolve(jsonResponse({ effects: [effect] }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('CaseTreatmentConfig apiFetch migration', () => {
    it('loads treatment effects with bearer auth and the correct path', async () => {
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Aspirin')).toBeInTheDocument();

        const [url, init] = treatmentCalls()[0];
        expect(url).toBe('/api/treatment-effects');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer educator-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs the configured treatments JSON body when saved', async () => {
        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        fireEvent.click(await screen.findByText('Aspirin'));
        fireEvent.click(screen.getByRole('button', { name: /expected/i }));
        fireEvent.click(screen.getByRole('button', { name: /save treatment config/i }));

        await waitFor(() => {
            expect(treatmentCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = treatmentCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/cases/case-1/treatments');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer educator-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toEqual({
            treatments: [{
                treatment_type: 'medication',
                treatment_name: 'Aspirin',
                is_available: true,
                is_expected: true,
                is_contraindicated: false,
                points_if_ordered: 0,
                feedback_if_ordered: null,
                feedback_if_missed: null,
            }],
        });
    });

    it('surfaces an API error toast when saving is forbidden', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/api/treatment-effects')) {
                return Promise.resolve(jsonResponse({ effects: [effect] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/cases/case-1/treatments') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <CaseTreatmentConfig caseId="case-1" caseTreatments={[]} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /save treatment config/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('forbidden'));
    });
});
