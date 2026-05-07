import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import UserProfilePanel from './UserProfilePanel.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: { id: 1, role: 'educator' }, isAdmin: () => false }),
    };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

function profileCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && (
            url.endsWith('/api/user/profile') ||
            url.endsWith('/api/users/preferences') ||
            url.endsWith('/api/platform-settings/user-fields')
        )
    );
}

beforeEach(() => {
    localStorage.setItem('token', 'educator-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/user/profile')) {
            return Promise.resolve(jsonResponse({
                user: {
                    username: 'learner',
                    name: 'Learner One',
                    email: 'learner@example.com',
                    institution: 'Rohy University',
                },
            }));
        }
        if (typeof url === 'string' && url.endsWith('/api/platform-settings/user-fields')) {
            return Promise.resolve(jsonResponse({ config: {} }));
        }
        if (typeof url === 'string' && url.endsWith('/api/users/preferences')) {
            return Promise.resolve(jsonResponse({ default_llm_settings: {} }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('UserProfilePanel apiFetch migration', () => {
    it('loads the user profile with bearer auth and the correct path', async () => {
        renderWithProviders(
            <UserProfilePanel />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Learner One')).toBeInTheDocument();

        const [url, init] = profileCalls().find(([callUrl]) => callUrl.endsWith('/api/user/profile'));
        expect(url).toBe('/api/user/profile');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer educator-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs the edited profile JSON body when saved', async () => {
        renderWithProviders(
            <UserProfilePanel />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        const nameInput = await screen.findByDisplayValue('Learner One');
        fireEvent.change(nameInput, { target: { value: 'Learner Two' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(profileCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = profileCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/user/profile');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer educator-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            name: 'Learner Two',
            institution: 'Rohy University',
        });
    });

    it('surfaces an API error toast when saving profile changes fails', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/api/user/profile') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'denied' }, { status: 403 }));
            }
            if (typeof url === 'string' && url.endsWith('/api/user/profile')) {
                return Promise.resolve(jsonResponse({ user: { username: 'learner', name: 'Learner One', email: 'learner@example.com' } }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/user-fields')) {
                return Promise.resolve(jsonResponse({ config: {} }));
            }
            if (typeof url === 'string' && url.endsWith('/api/users/preferences')) {
                return Promise.resolve(jsonResponse({ default_llm_settings: {} }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <UserProfilePanel />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText('Learner One');
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('denied'));
    });
});
