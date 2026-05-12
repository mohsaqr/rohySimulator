import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import VoiceSettingsTab from './VoiceSettingsTab.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';

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

const testVoiceProps = vi.fn();
vi.mock('./TestVoiceButton.jsx', () => ({
    default: function TestVoiceButtonStub(props) {
        testVoiceProps(props);
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

function VoiceProbe({ onUpdate }) {
    const { voiceSettings } = useVoice();
    useEffect(() => {
        onUpdate?.(voiceSettings);
    }, [onUpdate, voiceSettings]);
    return (
        <div
            data-testid="voice-probe"
            data-voice-settings={voiceSettings ? JSON.stringify(voiceSettings) : ''}
        />
    );
}

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

    it('PUTs voice settings JSON when saved (without per-gender voice fields)', async () => {
        // 2026-05-12 — the per-gender voice slot UI was removed; the tab no
        // longer writes `voice_<provider>_<slot>` fields. The payload now
        // covers only platform-wide settings: provider, rate/pitch, STT,
        // voice mode, and API keys.
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
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({
            voice_mode_enabled: true,
            tts_provider: 'piper',
            tts_rate: 1,
            tts_pitch: 0,
        });
        // Per-gender voice fields must NOT be in the payload anymore.
        expect(body).not.toHaveProperty('voice_piper_male');
        expect(body).not.toHaveProperty('voice_piper_female');
        expect(body).not.toHaveProperty('voice_piper_child');
    });

    it('publishes loaded voice settings into VoiceContext so chat uses changed defaults without a reload', async () => {
        const captured = { current: null };
        renderWithProviders(
            <>
                <VoiceSettingsTab />
                <VoiceProbe onUpdate={(settings) => { captured.current = settings; }} />
            </>,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText(/Voice & Avatar/i)).toBeInTheDocument();

        await waitFor(() => {
            expect(captured.current).toMatchObject({
                tts_provider: 'piper',
                voice_piper_male: 'amy.onnx',
            });
            expect(screen.getByTestId('voice-probe').getAttribute('data-voice-settings'))
                .toContain('voice_piper_male');
        });
    });

    it('no longer renders per-gender voice preview buttons (moved to case/persona editors)', async () => {
        // 2026-05-12 — per-gender voice pickers + TestVoiceButton instances
        // were removed from this tab. The previous version of this test
        // asserted that selecting a Google voice for each gender fed the
        // right voice into TestVoiceButton; that wiring no longer exists.
        // The lock-in for *this* tab is now just "no TestVoiceButton is
        // rendered." Per-character preview lives in CaseAvatarVoicePicker
        // and AgentPersonaEditor and is exercised by those test files.
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse({
                    voice_mode_enabled: true,
                    tts_provider: 'google',
                    tts_rate: 1,
                    tts_pitch: 0,
                    stt_provider: 'browser',
                    stt_language: 'en-US',
                    avatar_type: '3d_head',
                }));
            }
            if (typeof url === 'string' && url.endsWith('/api/llm/models')) return Promise.resolve(jsonResponse({ models: [] }));
            if (typeof url === 'string' && url.includes('/api/tts/voices')) {
                return Promise.resolve(jsonResponse({ provider: 'google', voices: [] }));
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

        expect(await screen.findByText(/Voice & Avatar/i)).toBeInTheDocument();
        // No TestVoiceButton stub should ever be rendered from this tab.
        expect(testVoiceProps).not.toHaveBeenCalled();
        // The "Patient voices" fieldset was removed; the title heading
        // exists nowhere on this page anymore.
        expect(screen.queryByText(/Patient voices/i)).toBeNull();
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

    // 2026-05-12 — the "Patient voices (<provider>)" legend was removed
    // along with the per-gender voice pickers. The test below previously
    // asserted that picking Google/OpenAI/Kokoro/Piper updated the legend
    // text; that surface no longer exists. We keep the test but invert it:
    // the legend MUST be absent for every provider, otherwise it means a
    // half-removed picker fieldset shipped.
    it.each([
        'google',
        'openai',
        'kokoro',
        'piper',
    ])('does NOT render the (removed) "Patient voices (...)" legend for %s', async (provider) => {
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

        expect(await screen.findByText(/Voice & Avatar/i)).toBeInTheDocument();
        expect(screen.queryByText(/Patient voices/i)).toBeNull();
    });
});
