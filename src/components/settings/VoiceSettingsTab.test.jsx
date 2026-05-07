import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import VoiceSettingsTab from './VoiceSettingsTab.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

vi.mock('../../contexts/AuthContext.jsx', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: { id: 1, role: 'admin' }, isAdmin: () => true }),
    };
});

vi.mock('./TestVoiceButton.jsx', () => ({
    default: function TestVoiceButtonStub() {
        return <button type="button">test voice</button>;
    },
}));

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

function voiceCalls() {
    return fetchSpy.mock.calls.filter(([url]) =>
        typeof url === 'string' && (
            url.endsWith('/api/platform-settings/voice') ||
            url.endsWith('/api/llm/models') ||
            url.includes('/api/tts/voices') ||
            url.includes('/api/tts/usage')
        )
    );
}

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
            return Promise.resolve(jsonResponse({
                voice_mode_enabled: true,
                tts_provider: 'piper',
                tts_rate: 1,
                tts_pitch: 0,
                stt_provider: 'browser',
                stt_language: 'en-US',
                avatar_type: '3d_head',
                voice_piper_male: 'amy.onnx',
            }));
        }
        if (typeof url === 'string' && url.endsWith('/api/llm/models')) {
            return Promise.resolve(jsonResponse({ models: [{ id: 'gpt-test', label: 'GPT Test', tier: 'fast' }] }));
        }
        if (typeof url === 'string' && url.includes('/api/tts/voices')) {
            return Promise.resolve(jsonResponse({
                provider: 'piper',
                voices: [{ filename: 'amy.onnx', displayName: 'Amy', language: 'en-US', gender: 'female' }],
            }));
        }
        if (typeof url === 'string' && url.includes('/api/tts/usage')) {
            return Promise.resolve(jsonResponse({ today: [], last_7_days: [], this_month: [], all_time: [] }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('VoiceSettingsTab apiFetch migration', () => {
    it('loads voice settings with bearer auth and the correct path', async () => {
        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText(/Voice & Avatar/i)).toBeInTheDocument();

        const [url, init] = voiceCalls().find(([callUrl]) => callUrl.endsWith('/api/platform-settings/voice'));
        expect(url).toBe('/api/platform-settings/voice');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('PUTs voice settings JSON when saved', async () => {
        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText(/Voice & Avatar/i);
        fireEvent.click(screen.getByRole('button', { name: /save voice settings/i }));

        await waitFor(() => {
            expect(voiceCalls().some(([, init]) => init?.method === 'PUT')).toBe(true);
        });

        const [url, init] = voiceCalls().find(([, callInit]) => callInit?.method === 'PUT');
        expect(url).toBe('/api/platform-settings/voice');
        expect(init.headers).toMatchObject({
            Authorization: 'Bearer admin-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body)).toMatchObject({
            voice_mode_enabled: true,
            tts_provider: 'piper',
            voice_piper_male: 'amy.onnx',
            tts_rate: 1,
            tts_pitch: 0,
        });
    });

    it('surfaces an API error toast when saving voice settings fails', async () => {
        fetchSpy.mockImplementation((url, init) => {
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'no access' }, { status: 403 }));
            }
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse({ tts_provider: 'piper' }));
            }
            if (typeof url === 'string' && url.endsWith('/api/llm/models')) {
                return Promise.resolve(jsonResponse({ models: [] }));
            }
            if (typeof url === 'string' && url.includes('/api/tts/voices')) {
                return Promise.resolve(jsonResponse({ voices: [] }));
            }
            if (typeof url === 'string' && url.includes('/api/tts/usage')) {
                return Promise.resolve(jsonResponse({ today: [], last_7_days: [], this_month: [], all_time: [] }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        await screen.findByText(/Voice & Avatar/i);
        fireEvent.click(screen.getByRole('button', { name: /save voice settings/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('no access'));
    });

    it('shows the admin usage scope selector only for admins', async () => {
        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByRole('option', { name: /all users/i })).toBeInTheDocument();
    });

    // Regression lock: 2026-05-08. The legend used `isKokoro ? 'Kokoro' : 'Piper'`
    // so picking Google or OpenAI fell through to "Piper" — looked like the UI
    // wasn't switching providers at all.
    it.each([
        ['google', /Patient voices \(Google Cloud TTS\)/i],
        ['openai', /Patient voices \(OpenAI TTS\)/i],
        ['kokoro', /Patient voices \(Kokoro\)/i],
        ['piper',  /Patient voices \(Piper\)/i],
    ])('legend shows the actual provider name when tts_provider=%s', async (provider, expected) => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse({
                    voice_mode_enabled: true,
                    tts_provider: provider,
                    tts_rate: 1, tts_pitch: 0,
                    stt_provider: 'browser', stt_language: 'en-US', avatar_type: '3d_head',
                }));
            }
            if (typeof url === 'string' && url.endsWith('/api/llm/models')) return Promise.resolve(jsonResponse({ models: [] }));
            if (typeof url === 'string' && url.includes('/api/tts/voices')) return Promise.resolve(jsonResponse({ voices: [] }));
            if (typeof url === 'string' && url.includes('/api/tts/usage')) return Promise.resolve(jsonResponse({ today: [], last_7_days: [], this_month: [], all_time: [] }));
            return Promise.resolve(jsonResponse({}));
        });

        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText(expected)).toBeInTheDocument();
    });
});
