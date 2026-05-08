import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import AvatarsSettingsTab from './AvatarsSettingsTab.jsx';
import { AgentService } from '../../services/AgentService.js';

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

vi.mock('../chat/PatientAvatar.jsx', () => ({
    default: function PatientAvatarStub() {
        return <div data-testid="patient-avatar-stub" />;
    },
}));

const testVoiceProps = vi.fn();
vi.mock('./TestVoiceButton.jsx', () => ({
    default: function TestVoiceButtonStub(props) {
        testVoiceProps(props);
        return (
            <button
                type="button"
                data-testid={`test-voice-${props.voice || 'empty'}`}
                data-voice={props.voice || ''}
                data-provider={props.provider || ''}
            >
                test voice
            </button>
        );
    },
}));

vi.mock('../../services/AgentService.js', () => ({
    AgentService: {
        getTemplates: vi.fn(),
        updateTemplate: vi.fn(),
    },
}));

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

function apiCalls() {
    return fetchSpy.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/'));
}

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    AgentService.getTemplates.mockResolvedValue([]);
    AgentService.updateTemplate.mockResolvedValue({});
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/avatars/heads/manifest.json')) {
            return Promise.resolve(jsonResponse({
                all: [
                    { id: 'male.glb', label: 'Male Head', gender: 'male' },
                    { id: 'female.glb', label: 'Female Head', gender: 'female' },
                    { id: 'child.glb', label: 'Child Head', gender: 'child' },
                ],
            }));
        }
        if (typeof url === 'string' && url.endsWith('/api/platform-settings/avatars')) {
            return Promise.resolve(jsonResponse({ default_avatar_male: 'male.glb' }));
        }
        if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
            return Promise.resolve(jsonResponse({}));
        }
        if (typeof url === 'string' && url.endsWith('/api/tts/voices')) {
            return Promise.resolve(jsonResponse({
                provider: 'piper',
                voices: [{ filename: 'amy.onnx', displayName: 'Amy', language: 'en-US' }],
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

describe('AvatarsSettingsTab apiFetch migration', () => {
    it('loads avatar defaults with bearer auth and the correct API path', async () => {
        renderWithProviders(
            <AvatarsSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByRole('heading', { name: 'Persona defaults' })).toBeInTheDocument();

        const [url, init] = apiCalls().find(([callUrl]) => callUrl.endsWith('/api/platform-settings/avatars'));
        expect(url).toBe('/api/platform-settings/avatars');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs persona defaults as JSON when saved', async () => {
        renderWithProviders(
            <AvatarsSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByRole('heading', { name: 'Persona defaults' });
        fireEvent.click(screen.getByRole('button', { name: /save persona defaults/i }));

        await waitFor(() => {
            expect(apiCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = apiCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/platform-settings/avatars');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer admin-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            default_avatar_male: 'male.glb',
            default_voice_piper_male: '',
            default_rate_child: '',
        });
    });

    it('surfaces an API error toast when saving defaults fails', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/avatars/heads/manifest.json')) {
                return Promise.resolve(jsonResponse({ all: [] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/avatars') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'no access' }, { status: 403 }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/avatars')) {
                return Promise.resolve(jsonResponse({}));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse({}));
            }
            if (typeof url === 'string' && url.endsWith('/api/tts/voices')) {
                return Promise.resolve(jsonResponse({ provider: 'piper', voices: [] }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <AvatarsSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByRole('heading', { name: 'Persona defaults' });
        fireEvent.click(screen.getByRole('button', { name: /save persona defaults/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('no access'));
    });

    it('falls back to the Voice tab provider slot when no avatar default voice is set', async () => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/avatars/heads/manifest.json')) {
                return Promise.resolve(jsonResponse({
                    all: [{ id: 'male.glb', label: 'Male Head', gender: 'male' }],
                }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/avatars')) {
                return Promise.resolve(jsonResponse({ default_avatar_male: 'male.glb' }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse({
                    tts_provider: 'piper',
                    voice_piper_male: 'amy.onnx',
                }));
            }
            if (typeof url === 'string' && url.endsWith('/api/tts/voices')) {
                return Promise.resolve(jsonResponse({
                    provider: 'piper',
                    voices: [{ filename: 'amy.onnx', displayName: 'Amy', language: 'en-US' }],
                }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <AvatarsSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByRole('heading', { name: 'Persona defaults' })).toBeInTheDocument();
        expect(await screen.findByText(/Inherit \(amy\.onnx\)/)).toBeInTheDocument();
        await waitFor(() => {
            expect(testVoiceProps).toHaveBeenCalledWith(expect.objectContaining({
                voice: 'amy.onnx',
                provider: 'piper',
            }));
        });
    });

    it('filters persona avatar dropdowns by the slot each persona controls', async () => {
        renderWithProviders(
            <AvatarsSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByRole('heading', { name: 'Persona defaults' })).toBeInTheDocument();

        await waitFor(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            const avatarSelects = selects.filter(select =>
                Array.from(select.querySelectorAll('option')).some(option => option.textContent === '— pick —')
            );

            expect(avatarSelects.map(select =>
                Array.from(select.querySelectorAll('option')).map(option => option.value)
            )).toEqual([
                ['', 'male.glb'],
                ['', 'female.glb'],
                ['', 'child.glb'],
            ]);
        });
    });
});
