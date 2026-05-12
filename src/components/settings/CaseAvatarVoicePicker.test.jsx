// Tests for CaseAvatarVoicePicker.jsx — the per-case voice/avatar override
// picker shown inside the case wizard.
//
// CONTRACT (post-2026-05-12, after the provider-picker removal):
//   1. NO PROVIDER PICKER. TTS provider is platform-wide (Voice Settings).
//      The case voice <select> uses voiceSettings.tts_provider to fetch
//      its catalogue and disables itself if no provider is configured.
//   2. TEST VOICE BUTTON: receives the picker's resolved voice, the platform
//      provider, plus per-case rate/pitch. No `gender` prop (slot logic
//      removed).
//   3. CASE VOICE OVERRIDE: choosing a voice writes
//      `config.voice.case_voice`. Resetting clears it.
//   4. INHERIT FROM PATIENT PERSONA: the picker fetches the Patient persona
//      template and shows its case_voice in the "(inherit …)" placeholder.
//      No hardcoded provider voice anywhere — if neither case nor persona
//      has a voice set, the placeholder says "(none set)".
//   5. PITCH SLIDER UNITS: min=-10, max=10, step=0.25 (semitones).
//   6. RATE SLIDER: min=0.5, max=1.5, step=0.05.
//   7. AVATAR LIST: still slot-filtered by patient demographics (avatar
//      logic is unchanged — only voice lost its slot pickers).

import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

const testVoiceProps = vi.fn();
const voiceRequests = [];
vi.mock('./TestVoiceButton.jsx', () => ({
    default: function TestVoiceButtonStub(props) {
        testVoiceProps(props);
        return (
            <button
                type="button"
                data-testid="test-voice-button-stub"
                data-voice={props.voice ?? ''}
                data-provider={props.provider ?? ''}
                data-rate={props.rate ?? ''}
                data-pitch={props.pitch ?? ''}
            >
                test-voice-stub
            </button>
        );
    },
}));

vi.mock('../chat/PatientAvatar', () => ({
    default: function PatientAvatarStub() {
        return <div data-testid="patient-avatar-stub" />;
    },
}));

const sampleVoices = {
    piper: [
        { filename: 'en_US-amy-medium.onnx', displayName: 'Amy', gender: 'female' },
        { filename: 'en_US-ryan-medium.onnx', displayName: 'Ryan', gender: 'male' },
    ],
    google: [
        { filename: 'en-US-Neural2-F', displayName: 'Neural2-F', gender: 'female' },
        { filename: 'en-US-Neural2-J', displayName: 'Neural2-J', gender: 'male' },
    ],
    kokoro: [
        { filename: 'af_bella', displayName: 'Bella', gender: 'female' },
        { filename: 'am_michael', displayName: 'Michael', gender: 'male' },
    ],
    openai: [
        { filename: 'alloy', displayName: 'Alloy', gender: 'female' },
    ],
};

const sampleAvatarManifest = {
    all: [
        { id: 'male-adult.glb', label: 'Male Adult', gender: 'male' },
        { id: 'female-adult.glb', label: 'Female Adult', gender: 'female' },
        { id: 'male-child.glb', label: 'Male Child', gender: 'male', age: 'child' },
        { id: 'female-child.glb', label: 'Female Child', gender: 'female', age: 'child' },
        { id: 'neutral.glb', label: 'Neutral' },
    ],
};

function defaultHandlers() {
    return [
        http.get('*/avatars/heads/manifest.json', () =>
            HttpResponse.json({ all: [] })
        ),
        http.get('*/api/tts/voices', ({ request }) => {
            const url = new URL(request.url);
            const provider = url.searchParams.get('provider') || 'kokoro';
            return HttpResponse.json({ voices: sampleVoices[provider] || [] });
        }),
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        // Default: platform provider = kokoro. Tests that need other
        // behaviour override this handler explicitly.
        http.get('*/api/platform-settings/voice', () =>
            HttpResponse.json({ tts_provider: 'kokoro' })
        ),
        http.get('*/api/platform-settings/avatars', () => HttpResponse.json({})),
        http.get('*/api/platform-settings/chat', () => HttpResponse.json({})),
        http.get('*/api/agents/templates', () =>
            HttpResponse.json({ templates: [] })
        ),
        http.get('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
    server.resetHandlers(...defaultHandlers());
    testVoiceProps.mockClear();
    voiceRequests.length = 0;
    localStorage.clear();
});
afterAll(() => server.close());

import CaseAvatarVoicePicker from './CaseAvatarVoicePicker.jsx';

function mount(initialCase = null, props = {}) {
    const captured = { current: null };
    const baseCase = initialCase || {
        id: 'case-test',
        config: {
            demographics: { age: 35, gender: 'male' },
        },
    };

    function Harness() {
        const [caseData, setCaseData] = useState(baseCase);
        useEffect(() => {
            captured.current = caseData;
        }, [caseData]);
        return (
            <CaseAvatarVoicePicker
                caseData={caseData}
                setCaseData={(updater) => {
                    setCaseData((prev) =>
                        typeof updater === 'function' ? updater(prev) : updater
                    );
                }}
                {...props}
            />
        );
    }

    const utils = renderWithProviders(<Harness />, { withPatientRecord: false });
    return { ...utils, captured };
}

function getCaseVoiceSelect() {
    const stub = screen.getByTestId('test-voice-button-stub');
    const container = stub.parentElement;
    const found = container.querySelector('select');
    if (!found) throw new Error('case-voice <select> not found');
    return found;
}

function getAvatarSelect() {
    const selects = Array.from(document.querySelectorAll('select'));
    const found = selects.find((s) =>
        Array.from(s.querySelectorAll('option')).some((o) => /^Auto \(/.test(o.textContent || ''))
    );
    if (!found) throw new Error('avatar <select> not found');
    return found;
}

async function waitForVoices(provider = 'kokoro') {
    const expected = sampleVoices[provider] || [];
    if (expected.length === 0) return;
    await waitFor(() => {
        const select = getCaseVoiceSelect();
        const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent || '');
        expect(optionTexts.some(t => expected.some(v => t.includes(v.displayName)))).toBe(true);
    });
}

describe('CaseAvatarVoicePicker — provider picker is gone (platform-wide)', () => {
    it('does not render a provider <select>', async () => {
        mount();
        await waitForVoices('kokoro');
        // The only selects on the page should be avatar + voice — none of
        // them should expose provider options.
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
            const optionValues = Array.from(s.querySelectorAll('option')).map(o => o.value);
            expect(optionValues).not.toContain('piper');
            expect(optionValues).not.toContain('google');
        }
    });

    it('disables the case-voice select when no platform provider is configured', async () => {
        server.use(
            http.get('*/api/platform-settings/voice', () => HttpResponse.json({}))
        );
        mount();
        await waitFor(() => {
            const select = getCaseVoiceSelect();
            expect(select.disabled).toBe(true);
        });
    });
});

describe('CaseAvatarVoicePicker — avatar list filtering (unchanged)', () => {
    it('shows adult male avatars plus neutral avatars for adult male cases', async () => {
        server.use(
            http.get('*/avatars/heads/manifest.json', () =>
                HttpResponse.json(sampleAvatarManifest)
            )
        );

        mount({
            id: 'male-case',
            config: { demographics: { age: 35, gender: 'male' } },
        });

        await waitFor(() => {
            const values = Array.from(getAvatarSelect().querySelectorAll('option')).map(o => o.value);
            expect(values).toEqual(['', 'male-adult.glb', 'neutral.glb']);
        });
    });

    it('shows adult female avatars plus neutral avatars for adult female cases', async () => {
        server.use(
            http.get('*/avatars/heads/manifest.json', () =>
                HttpResponse.json(sampleAvatarManifest)
            )
        );

        mount({
            id: 'female-case',
            config: { demographics: { age: 35, gender: 'female' } },
        });

        await waitFor(() => {
            const values = Array.from(getAvatarSelect().querySelectorAll('option')).map(o => o.value);
            expect(values).toEqual(['', 'female-adult.glb', 'neutral.glb']);
        });
    });

    it('shows only child avatars for child cases', async () => {
        server.use(
            http.get('*/avatars/heads/manifest.json', () =>
                HttpResponse.json(sampleAvatarManifest)
            )
        );

        mount({
            id: 'child-case',
            config: { demographics: { age: 8, gender: 'female' } },
        });

        await waitFor(() => {
            const values = Array.from(getAvatarSelect().querySelectorAll('option')).map(o => o.value);
            expect(values).toEqual(['', 'male-child.glb', 'female-child.glb']);
        });
    });

    it('keeps an existing mismatched avatar visible so it can be changed', async () => {
        server.use(
            http.get('*/avatars/heads/manifest.json', () =>
                HttpResponse.json(sampleAvatarManifest)
            )
        );

        mount({
            id: 'male-case',
            config: {
                avatar_id: 'female-adult.glb',
                demographics: { age: 35, gender: 'male' },
            },
        });

        await waitFor(() => {
            const values = Array.from(getAvatarSelect().querySelectorAll('option')).map(o => o.value);
            expect(values).toEqual(['', 'female-adult.glb', 'male-adult.glb', 'neutral.glb']);
        });
    });
});

describe('CaseAvatarVoicePicker — voice list comes from the platform provider', () => {
    it('fetches the platform provider voices through /api/tts/voices', async () => {
        server.use(
            http.get('*/api/tts/voices', ({ request }) => {
                voiceRequests.push({ url: request.url });
                const url = new URL(request.url);
                const provider = url.searchParams.get('provider') || 'kokoro';
                return HttpResponse.json({ voices: sampleVoices[provider] || [] });
            })
        );

        mount();
        await waitForVoices('kokoro');

        expect(new URL(voiceRequests[0].url).searchParams.get('provider')).toBe('kokoro');
    });

    it('does not crash when the voice list request is forbidden', async () => {
        server.use(
            http.get('*/api/tts/voices', () =>
                HttpResponse.json({ error: 'forbidden' }, { status: 403 })
            )
        );

        mount();

        await waitFor(() => {
            const select = getCaseVoiceSelect();
            // Only the "inherit" placeholder remains.
            expect(Array.from(select.querySelectorAll('option'))).toHaveLength(1);
        });
    });

    it('renders every voice in the platform provider catalogue, regardless of patient gender', async () => {
        // Slot-filtering was removed. A female patient sees male voices too,
        // because per-character voice id is the entire model — gender is no
        // longer used to filter the list.
        mount({
            id: 'female-case',
            config: { demographics: { age: 35, gender: 'female' } },
        });
        await waitForVoices('kokoro');
        const select = getCaseVoiceSelect();
        const values = Array.from(select.querySelectorAll('option')).map(o => o.value);
        expect(values).toContain('am_michael');
        expect(values).toContain('af_bella');
    });

    it('refetches when the platform provider switches', async () => {
        // Simulate the admin changing tts_provider from kokoro to google in
        // Voice Settings — the case picker should reload its catalogue.
        const { rerender } = mount();
        await waitForVoices('kokoro');

        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json({ tts_provider: 'google' })
            )
        );
        // Trigger a remount with the new platform settings.
        rerender(<div />);
        mount();
        await waitForVoices('google');
        const select = getCaseVoiceSelect();
        const values = Array.from(select.querySelectorAll('option')).map(o => o.value);
        expect(values).toContain('en-US-Neural2-J');
    });
});

describe('CaseAvatarVoicePicker — TestVoiceButton wiring', () => {
    it('forwards case_voice + platform provider + rate + pitch to TestVoiceButton', async () => {
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json({ tts_provider: 'google' })
            )
        );
        mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: {
                    case_voice: 'en-US-Neural2-J',
                    tts_rate: 1.1,
                    tts_pitch: 2.5,
                },
            },
        });
        await waitForVoices('google');
        const stub = screen.getByTestId('test-voice-button-stub');
        expect(stub.getAttribute('data-voice')).toBe('en-US-Neural2-J');
        expect(stub.getAttribute('data-provider')).toBe('google');
        expect(stub.getAttribute('data-rate')).toBe('1.1');
        expect(stub.getAttribute('data-pitch')).toBe('2.5');
    });

    it('forwards empty voice when neither case nor patient persona has one set', async () => {
        // No silent hardcoded fallback — if nothing is configured, the test
        // button has nothing to play and the admin gets a clear "no voice"
        // signal in the UI.
        mount();
        await waitForVoices('kokoro');
        const stub = screen.getByTestId('test-voice-button-stub');
        expect(stub.getAttribute('data-voice')).toBe('');
        expect(stub.getAttribute('data-provider')).toBe('kokoro');
    });

    it('inherits voice from the Patient persona template when case_voice is unset', async () => {
        // The picker fetches the Patient persona template; its case_voice is
        // the only fallback below case-level — no PROVIDER_FALLBACK_VOICE.
        server.use(
            http.get('*/api/agents/templates', () =>
                HttpResponse.json({
                    templates: [
                        {
                            id: 1,
                            agent_type: 'patient',
                            config: { voice: { case_voice: 'af_bella' } },
                        },
                    ],
                })
            )
        );
        mount();
        await waitForVoices('kokoro');
        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('af_bella');
        });
    });
});

describe('CaseAvatarVoicePicker — pitch slider', () => {
    it('renders a pitch slider with min=-10, max=10, step=0.25 (semitones)', async () => {
        mount();
        await waitForVoices('kokoro');
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const pitchRange = ranges.find(
            (r) => r.getAttribute('min') === '-10' && r.getAttribute('max') === '10'
        );
        expect(pitchRange).toBeTruthy();
        expect(pitchRange.getAttribute('step')).toBe('0.25');
    });

    it('renders the helper text "semitones (Google only)" near the pitch label', async () => {
        mount();
        await waitForVoices('kokoro');
        expect(document.body.textContent).toContain('semitones (Google only)');
    });

    it('writes config.voice.tts_pitch as a number when the pitch slider moves', async () => {
        const { captured } = mount();
        await waitForVoices('kokoro');
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const pitchRange = ranges.find(
            (r) => r.getAttribute('min') === '-10' && r.getAttribute('max') === '10'
        );
        fireEvent.change(pitchRange, { target: { value: '3.5' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.tts_pitch).toBe(3.5);
        });
    });
});

describe('CaseAvatarVoicePicker — rate slider', () => {
    it('renders a rate slider with min=0.5, max=1.5, step=0.05', async () => {
        mount();
        await waitForVoices('kokoro');
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const rateRange = ranges.find(
            (r) => r.getAttribute('min') === '0.5' && r.getAttribute('max') === '1.5'
        );
        expect(rateRange).toBeTruthy();
        expect(rateRange.getAttribute('step')).toBe('0.05');
    });

    it('writes config.voice.tts_rate when the rate slider moves', async () => {
        const { captured } = mount();
        await waitForVoices('kokoro');
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const rateRange = ranges.find(
            (r) => r.getAttribute('min') === '0.5' && r.getAttribute('max') === '1.5'
        );
        fireEvent.change(rateRange, { target: { value: '1.25' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.tts_rate).toBe(1.25);
        });
    });
});

describe('CaseAvatarVoicePicker — inherit handling and case-voice override', () => {
    it('starts with no config.voice when the case carries no override', () => {
        const { captured } = mount();
        expect(captured.current.config.voice).toBeUndefined();
    });

    it('writes config.voice.case_voice when a specific voice is picked', async () => {
        const { captured } = mount();
        await waitForVoices('kokoro');
        const voiceSelect = getCaseVoiceSelect();
        fireEvent.change(voiceSelect, { target: { value: 'am_michael' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.case_voice).toBe('am_michael');
        });
    });

    it('removes case_voice (and config.voice if empty) when reset to inherit', async () => {
        const { captured } = mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: { case_voice: 'am_michael' },
            },
        });
        await waitForVoices('kokoro');
        const voiceSelect = getCaseVoiceSelect();
        fireEvent.change(voiceSelect, { target: { value: '' } });
        await waitFor(() => {
            expect(captured.current.config.voice).toBeUndefined();
        });
    });

    it('passing patientTemplateVoice prop skips the /agents/templates fetch and uses the prop', async () => {
        let templatesFetched = false;
        server.use(
            http.get('*/api/agents/templates', () => {
                templatesFetched = true;
                return HttpResponse.json({ templates: [] });
            })
        );
        mount(null, { patientTemplateVoice: { case_voice: 'af_bella' } });
        await waitForVoices('kokoro');
        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('af_bella');
        });
        expect(templatesFetched).toBe(false);
    });
});
