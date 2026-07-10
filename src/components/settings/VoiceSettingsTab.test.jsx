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

// Voice 2.0 settings payload (VOICE2_PLAN.md §5.2/§6.4): provider status
// cards + per-language defaults + enable toggles. No tts_provider — the
// engine setting is retired.
const PROVIDERS_STATUS = [
    { id: 'kokoro', capable: true, enabled: true, usable: true, reason: null },
    { id: 'google', capable: false, enabled: true, usable: false, reason: 'no API key' },
    { id: 'openai', capable: true, enabled: true, usable: true, reason: null },
    { id: 'piper', capable: false, enabled: true, usable: false, reason: 'piper binary not installed' },
];

const voiceSettingsPayload = (extra = {}) => ({
    voice_mode_enabled: true,
    tts_rate: 1,
    tts_pitch: 0,
    stt_provider: 'browser',
    stt_language: 'en-US',
    avatar_type: '3d_head',
    providers: PROVIDERS_STATUS,
    tts_default_voice_en: 'af_bella',
    tts_default_voice_it: 'if_sara',
    tts_default_voice_de: null,
    tts_default_voice_fi: null,
    tts_default_voice_sv: null,
    tts_provider_enabled_kokoro: true,
    tts_provider_enabled_google: true,
    tts_provider_enabled_openai: true,
    tts_provider_enabled_piper: true,
    ...extra,
});

const allVoicesPayload = () => ({
    providers: [
        {
            ...PROVIDERS_STATUS[0],
            voices: [
                { filename: 'af_bella', displayName: 'Bella', language: 'en-US', gender: 'female' },
                { filename: 'if_sara', displayName: 'Sara', language: 'it-IT', gender: 'female' },
            ]
        },
        { ...PROVIDERS_STATUS[1], voices: [] },
        { ...PROVIDERS_STATUS[2], voices: [{ filename: 'alloy', displayName: 'Alloy', language: 'en', gender: 'neutral' }] },
        { ...PROVIDERS_STATUS[3], voices: [] },
    ],
});

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
            return Promise.resolve(jsonResponse(voiceSettingsPayload()));
        }
        if (typeof url === 'string' && url.endsWith('/api/llm/models')) {
            return Promise.resolve(jsonResponse({ models: [{ id: 'gpt-test', label: 'GPT Test', tier: 'fast' }] }));
        }
        if (typeof url === 'string' && url.includes('/api/tts/voices')) {
            return Promise.resolve(jsonResponse(allVoicesPayload()));
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

    it('PUTs the Voice 2.0 payload when saved — defaults + toggles, no engine field (the silent-drop trap)', async () => {
        // CONTRACT REWRITE (2026-07): the payload's explicit field list must
        // carry every per-language default and every enable toggle, and the
        // retired keys must never reappear.
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
            tts_rate: 1,
            tts_pitch: 0,
            // Round-trip: the loaded defaults survive save untouched.
            tts_default_voice_en: 'af_bella',
            tts_default_voice_it: 'if_sara',
            tts_default_voice_de: '',
            tts_provider_enabled_kokoro: true,
            tts_provider_enabled_google: true,
        });
        // Retired keys must NOT be in the payload: no engine setting, no
        // per-gender voice slots.
        expect(body).not.toHaveProperty('tts_provider');
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
            // The RAW server payload (incl. providers status + per-language
            // defaults) reaches VoiceContext so the chat resolver can use it
            // without a reload.
            expect(captured.current).toMatchObject({
                tts_default_voice_en: 'af_bella',
                voice_mode_enabled: true,
            });
            expect(Array.isArray(captured.current.providers)).toBe(true);
            expect(screen.getByTestId('voice-probe').getAttribute('data-voice-settings'))
                .toContain('tts_default_voice_en');
        });
    });

    it('renders NO engine dropdown, provider status cards instead, and per-language default rows', async () => {
        // Voice 2.0 (owner directive): "configured voice providers, not a
        // dropdown list". The engine <select> is gone; each provider is a
        // status card with an enable toggle, and the fallback safety net is
        // one default-voice row per registry language — the German gap is
        // VISIBLE here, not just in the boot log.
        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText(/Voice & Avatar/i)).toBeInTheDocument();
        // No select offers engine names as values (the old dropdown).
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
            const values = Array.from(s.querySelectorAll('option')).map(o => o.value);
            expect(values).not.toContain('kokoro');
            expect(values).not.toContain('piper');
        }
        // Provider cards with status lines.
        expect(screen.getByText(/Configured voice providers/i)).toBeInTheDocument();
        expect(screen.getByText(/Kokoro-82M/)).toBeInTheDocument();
        expect(document.body.textContent).toContain('no API key'); // google's reason
        // Per-language default rows: German unset → loud amber gap warning.
        expect(screen.getByRole('heading', { name: /Default voices/i })).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/No fallback for German/);
        // (a saved-but-unusable default is covered by its own test below)
        // The default rows carry audition buttons (preview-exempt on the
        // server, so the admin hears the literal voice).
        expect(testVoiceProps).toHaveBeenCalled();
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

    it('keeps a saved default visible (with the reason) when its engine becomes unusable', async () => {
        // Codex P3: filtering options to usable engines used to blank the
        // select for a stored google default after the key was removed —
        // an existing fallback LOOKED unset. The saved value must stay
        // rendered under a "saved — engine unavailable" group, with an
        // amber line naming the reason.
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse(voiceSettingsPayload({
                    tts_default_voice_de: 'de-DE-Chirp3-HD-Kore', // google — unusable in the fixture (no API key)
                })));
            }
            if (typeof url === 'string' && url.endsWith('/api/llm/models')) return Promise.resolve(jsonResponse({ models: [] }));
            if (typeof url === 'string' && url.includes('/api/tts/voices')) return Promise.resolve(jsonResponse(allVoicesPayload()));
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

        const deSelect = screen.getByLabelText(/Default voice for German/i);
        expect(deSelect.value).toBe('de-DE-Chirp3-HD-Kore'); // NOT blank
        const savedGroup = Array.from(deSelect.querySelectorAll('optgroup'))
            .find(g => /unavailable/.test(g.label));
        expect(savedGroup).toBeTruthy();
        expect(document.body.textContent).toMatch(/needs google, which is\s+currently unavailable \(no API key\)/);
    });

    it('every sound control has an audition: rate/pitch, provider cards, default rows', async () => {
        renderWithProviders(
            <VoiceSettingsTab />,
            { withAuth: false, withNotifications: false, withToast: false }
        );
        await screen.findByText(/Voice & Avatar/i);

        const calls = testVoiceProps.mock.calls.map(([p]) => p);
        // Rate/pitch audition: the en default voice at the CURRENT slider values.
        expect(calls.some(p => p.voice === 'af_bella' && p.rate === 1 && p.pitch === 0)).toBe(true);
        // Provider-card smoke tests: each usable engine auditions its first voice.
        expect(calls.some(p => p.provider === 'kokoro' && p.voice === 'af_bella')).toBe(true);
        expect(calls.some(p => p.provider === 'openai' && p.voice === 'alloy')).toBe(true);
        // Default-voice rows audition at the platform rate/pitch, not factory values.
        expect(calls.some(p => p.voice === 'if_sara' && p.rate === 1 && p.pitch === 0)).toBe(true);
    });

    it('turning an engine OFF shows the impact modal naming dependent cases; cancel keeps it on', async () => {
        // v1.4 sovereignty: configured voices are never substituted, so
        // disabling an engine strands every case voiced on it — the admin
        // must see the blast radius by name and explicitly confirm.
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/platform-settings/voice')) {
                return Promise.resolve(jsonResponse(voiceSettingsPayload()));
            }
            if (typeof url === 'string' && url.endsWith('/api/tts/voice-usage')) {
                return Promise.resolve(jsonResponse({
                    providers: {
                        kokoro: [{ kind: 'case', id: 1, name: 'STEMI Case', voice: 'af_bella' }],
                        google: [], openai: [], piper: []
                    },
                    unknown: []
                }));
            }
            if (typeof url === 'string' && url.endsWith('/api/llm/models')) return Promise.resolve(jsonResponse({ models: [] }));
            if (typeof url === 'string' && url.includes('/api/tts/voices')) return Promise.resolve(jsonResponse(allVoicesPayload()));
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

        const toggles = screen.getAllByRole('checkbox');
        // The kokoro card is first (TTS_PROVIDERS order); its toggle is the
        // first "enabled" checkbox after the voice-mode master toggle? The
        // provider cards render before the master toggle in DOM order, so
        // index 0 is kokoro. Uncheck it.
        fireEvent.click(toggles[0]);

        // Modal appears, names the case, and the toggle has NOT flipped yet.
        expect(await screen.findByText(/configured voice relies/i)).toBeInTheDocument();
        expect(screen.getByText(/STEMI Case/)).toBeInTheDocument();
        expect(toggles[0].checked).toBe(true);

        // Cancel → still enabled, modal gone.
        fireEvent.click(screen.getByRole('button', { name: /cancel — keep enabled/i }));
        expect(screen.queryByText(/configured voice relies/i)).toBeNull();
        expect(toggles[0].checked).toBe(true);

        // Uncheck again, confirm → now disabled.
        fireEvent.click(toggles[0]);
        await screen.findByText(/configured voice relies/i);
        fireEvent.click(screen.getByRole('button', { name: /disable anyway/i }));
        await waitFor(() => {
            expect(toggles[0].checked).toBe(false);
        });
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
