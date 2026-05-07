import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import ScenarioRepository from './ScenarioRepository.jsx';

const toast = {
    confirm: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
};

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: { id: 1, role: 'admin' } }),
    };
});

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
        if (typeof url === 'string' && url.endsWith('/api/scenarios')) {
            return Promise.resolve(jsonResponse({
                scenarios: [{
                    id: 3,
                    name: 'Custom Shock',
                    description: 'custom scenario',
                    category: 'Sepsis',
                    duration_minutes: 10,
                    timeline: [],
                    is_public: true,
                }],
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

describe('ScenarioRepository apiFetch migration', () => {
    it('loads scenario repository rows with bearer auth', async () => {
        renderWithProviders(
            <ScenarioRepository onSelectScenario={vi.fn()} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Custom Shock')).toBeInTheDocument();

        const [url, init] = fetchSpy.mock.calls.find(([callUrl]) => String(callUrl).endsWith('/api/scenarios'));
        expect(url).toBe('/api/scenarios');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });
});
