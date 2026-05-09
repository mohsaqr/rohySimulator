// Tests for CaseAvatarVoicePicker.jsx — the per-case voice/avatar override
// picker shown inside the case wizard.
//
// CONTRACT (locked from src/components/settings/CaseAvatarVoicePicker.jsx):
//   1. PROVIDER DROPDOWN: lists exactly the providers
//      ['', 'kokoro', 'piper', 'google', 'openai']. Picking one writes
//      `config.voice.tts_provider`; picking '' (Inherit) deletes it.
//   2. PROVIDER CHANGE INVALIDATES VOICE: switching provider always
//      deletes `config.voice.case_voice` (voice ids are provider-specific
//      so a Piper id has no meaning under Kokoro/Google/OpenAI).
//   3. TEST VOICE BUTTON: TestVoiceButton receives the picker's resolved
//      voice/provider/rate/pitch/gender as props. We stub it to capture props —
//      the real button is owned by a sibling agent's tests.
//   4. PITCH SLIDER UNITS (POST-bb34d88 REGRESSION LOCK):
//        min = -10, max = 10, step = 0.25
//      Helper text contains "semitones (Google only)". This is the unit
//      change from "ratio multiplier" to "semitones" introduced in
//      migration 0006_tts_pitch_semitones.sql.
//   5. RATE SLIDER: min = 0.5, max = 1.5, step = 0.05.
//   6. INHERIT HANDLING: empty values (the default) produce NO
//      `config.voice` key. Clearing the last override removes the whole
//      `voice` object.
//   7. CASE-VOICE OVERRIDE: choosing a voice writes
//      `config.voice.case_voice`.
//   8. HINT COPY: the literal string "semitones (Google only)" is
//      present in the rendered DOM.
//
// We mount the component with `renderWithProviders` (default stack
// includes VoiceProvider, which exposes `platformAvatars` = null — that
// matches the case where no platform persona defaults are loaded yet).
// `useState`-based parent simulates the wizard owner so we can read the
// resulting `caseData.config` object.

import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// ---------------------------------------------------------------------
// Stub TestVoiceButton.
// The picker passes resolved {voice, provider, rate, pitch} props down.
// We render a probe element whose data-attributes mirror those props so
// each test can assert on them without firing actual TTS network traffic.
// Importantly the stub itself uses vi.fn() so we can also inspect call
// history if needed.
// ---------------------------------------------------------------------
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
                data-gender={props.gender ?? ''}
            >
                test-voice-stub
            </button>
        );
    },
}));

// PatientAvatar is lazy-loaded via dynamic import. We never set
// `config.avatar_id`, so it never renders. Stub anyway just so the import
// graph doesn't try to pull in three.js/r3f at test time.
vi.mock('../chat/PatientAvatar', () => ({
    default: function PatientAvatarStub() {
        return <div data-testid="patient-avatar-stub" />;
    },
}));

// ---------------------------------------------------------------------
// MSW endpoints the picker hits on mount.
// ---------------------------------------------------------------------
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
        // Provider-aware voices endpoint.
        http.get('*/api/tts/voices', ({ request }) => {
            const url = new URL(request.url);
            const provider = url.searchParams.get('provider') || 'kokoro';
            return HttpResponse.json({ voices: sampleVoices[provider] || [] });
        }),
        // Catch-all to keep the provider stack quiet.
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        http.get('*/api/platform-settings/voice', () => HttpResponse.json({})),
        http.get('*/api/platform-settings/avatars', () => HttpResponse.json({})),
        http.get('*/api/platform-settings/chat', () => HttpResponse.json({})),
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

// ---------------------------------------------------------------------
// Mount harness — owns the caseData state like the real wizard would.
// ---------------------------------------------------------------------
import CaseAvatarVoicePicker from './CaseAvatarVoicePicker.jsx';

function mount(initialCase = null) {
    const captured = { current: null };
    const baseCase = initialCase || {
        id: 'case-test',
        config: {
            demographics: { age: 35, gender: 'male' },
        },
    };

    function Harness() {
        const [caseData, setCaseData] = useState(baseCase);
        // react-hooks/immutability forbids assigning to outer-scope refs
        // during render; the effect runs after commit and is the
        // sanctioned escape hatch (see VoiceContext.test.jsx for the same
        // pattern).
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
            />
        );
    }

    const utils = renderWithProviders(<Harness />, { withPatientRecord: false });
    return { ...utils, captured };
}

// The component renders three <select> elements with no htmlFor links so
// getByLabelText doesn't work. We locate them by signature instead:
//   - provider select  : has an <option value="piper">
//   - case-voice select: any other select that's a sibling of the
//                        TestVoiceButton stub
//   - 3D avatar select : has <option value="">Auto (...)</option>
function getProviderSelect() {
    const selects = Array.from(document.querySelectorAll('select'));
    const found = selects.find((s) =>
        Array.from(s.querySelectorAll('option')).some((o) => o.value === 'piper')
    );
    if (!found) throw new Error('provider <select> not found');
    return found;
}

function getCaseVoiceSelect() {
    // The case-voice select is the one that sits next to the
    // TestVoiceButton stub inside the same flex container.
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

// Wait until the picker has fetched the voice list for whichever provider
// is currently active. The component sets voices via setVoices(...) inside
// a useEffect that depends on `effectiveProvider`.
async function waitForVoices(provider = 'kokoro') {
    const expected = sampleVoices[provider] || [];
    if (expected.length === 0) return;
    await waitFor(() => {
        const select = getCaseVoiceSelect();
        const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        // At least one provider voice matching the case slot must show up.
        expect(optionTexts.some((t) => expected.some(v => t && t.includes(v.displayName)))).toBe(true);
    });
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('CaseAvatarVoicePicker — provider dropdown', () => {
    it('lists every supported provider plus the inherit option', () => {
        // CONTRACT 1: dropdown contains exactly the canonical provider set.
        mount();
        const select = getProviderSelect();
        const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(values).toEqual(['', 'kokoro', 'piper', 'google', 'openai']);
    });

    it('defaults the provider dropdown to "" (inherit) when no override is set', () => {
        // CONTRACT 6: empty config => no `voice` key => provider control
        // shows the inherit option as selected.
        mount();
        const select = getProviderSelect();
        expect(select.value).toBe('');
    });

    it('writes config.voice.tts_provider when a non-inherit provider is picked', async () => {
        // CONTRACT 1: picking 'google' updates the voice config.
        const { captured } = mount();
        const select = getProviderSelect();
        fireEvent.change(select, { target: { value: 'google' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.tts_provider).toBe('google');
        });
    });

    it('removes config.voice entirely when provider is set back to inherit', async () => {
        // CONTRACT 6: clearing all overrides deletes the voice object.
        const { captured } = mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: { tts_provider: 'google' },
            },
        });
        const select = getProviderSelect();
        fireEvent.change(select, { target: { value: '' } });
        await waitFor(() => {
            expect(captured.current.config.voice).toBeUndefined();
        });
    });
});

describe('CaseAvatarVoicePicker — avatar list filtering', () => {
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

describe('CaseAvatarVoicePicker — voice list filtering', () => {
    it('fetches the effective provider voice list through apiFetch with bearer auth', async () => {
        localStorage.setItem('token', 'admin-token');
        server.use(
            http.get('*/api/tts/voices', ({ request }) => {
                voiceRequests.push({
                    url: request.url,
                    authorization: request.headers.get('authorization'),
                    requestId: request.headers.get('x-request-id'),
                });
                const url = new URL(request.url);
                const provider = url.searchParams.get('provider') || 'kokoro';
                return HttpResponse.json({ voices: sampleVoices[provider] || [] });
            })
        );

        mount();
        await waitForVoices('kokoro');

        expect(voiceRequests[0]).toMatchObject({
            authorization: 'Bearer admin-token',
        });
        expect(new URL(voiceRequests[0].url).pathname).toBe('/api/tts/voices');
        expect(new URL(voiceRequests[0].url).searchParams.get('provider')).toBe('kokoro');
        expect(voiceRequests[0].requestId).toBeTruthy();
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
            expect(Array.from(select.querySelectorAll('option')).map(o => o.value)).toEqual(['']);
        });
    });

    it('fetches the voice list for the effective provider and renders each option', async () => {
        // CONTRACT 2 (positive side): the case-voice select reflects the
        // active provider's catalogue filtered to the patient slot.
        mount();
        await waitForVoices('kokoro');
        const select = getCaseVoiceSelect();
        const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(optionValues).toContain('am_michael');
        expect(optionValues).not.toContain('af_bella');
    });

    it('filters case voices by patient gender when catalogue metadata is available', async () => {
        mount({
            id: 'female-case',
            config: {
                demographics: { age: 35, gender: 'female' },
            },
        });
        await waitForVoices('kokoro');
        const select = getCaseVoiceSelect();
        const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(optionValues).toContain('af_bella');
        expect(optionValues).not.toContain('am_michael');
    });

    it('clears case_voice when the provider changes (cross-provider voice ids are not portable)', async () => {
        // CONTRACT 2: the picker forcibly deletes the stale case_voice on
        // provider change.
        const { captured } = mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: {
                    tts_provider: 'piper',
                    case_voice: 'en_US-amy-medium.onnx',
                },
            },
        });
        await waitForVoices('piper');
        const providerSelect = getProviderSelect();
        fireEvent.change(providerSelect, { target: { value: 'google' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.tts_provider).toBe('google');
            expect(captured.current.config.voice?.case_voice).toBeUndefined();
        });
    });

    it('refetches the voice list when the provider switches', async () => {
        // CONTRACT 2: the new provider's voices replace the old list.
        mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: { tts_provider: 'piper' },
            },
        });
        await waitForVoices('piper');
        const providerSelect = getProviderSelect();
        fireEvent.change(providerSelect, { target: { value: 'google' } });
        await waitForVoices('google');
        const voiceSelect = getCaseVoiceSelect();
        const values = Array.from(voiceSelect.querySelectorAll('option')).map((o) => o.value);
        expect(values).toContain('en-US-Neural2-J');
        expect(values).not.toContain('en_US-amy-medium.onnx');
    });
});

describe('CaseAvatarVoicePicker — TestVoiceButton wiring', () => {
    it('passes resolved voice/provider/rate/pitch to TestVoiceButton', async () => {
        // CONTRACT 3: the stubbed button receives the live picker state.
        mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: {
                    tts_provider: 'google',
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
        expect(stub.getAttribute('data-gender')).toBe('male');
    });

    it('falls back to the Kokoro default when case_voice is unset', () => {
        // CONTRACT 3: with no override and no platform default, the default
        // provider is Kokoro, which has a hardcoded fallback voice.
        mount();
        const stub = screen.getByTestId('test-voice-button-stub');
        expect(stub.getAttribute('data-voice')).toBe('am_michael');
        expect(stub.getAttribute('data-provider')).toBe('kokoro');
    });

    it('inherits the platform provider, voice slot, rate, and pitch for preview', async () => {
        server.use(
            http.get('*/api/platform-settings/voice', () => HttpResponse.json({
                tts_provider: 'google',
                voice_google_male: 'en-US-Neural2-J',
                tts_rate: 0.9,
                tts_pitch: 2,
            })),
            http.get('*/api/platform-settings/avatars', () => HttpResponse.json({}))
        );

        mount();
        await waitForVoices('google');

        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-provider')).toBe('google');
            expect(stub.getAttribute('data-voice')).toBe('en-US-Neural2-J');
            expect(stub.getAttribute('data-rate')).toBe('0.9');
            expect(stub.getAttribute('data-pitch')).toBe('2');
        });
    });
});

describe('CaseAvatarVoicePicker — pitch slider (POST-bb34d88 SEMITONES UNIT)', () => {
    it('renders a pitch slider with min=-10, max=10, step=0.25 (semitones)', () => {
        // CONTRACT 4: regression lock for the unit change. Pre-bb34d88 the
        // slider was a 0.5..2.0 ratio; post-bb34d88 it's -10..10 semitones.
        mount();
        const labels = Array.from(document.querySelectorAll('label'));
        const pitchLabel = labels.find((l) => /Pitch/.test(l.textContent || ''));
        expect(pitchLabel).toBeTruthy();
        // The slider sits as a sibling of the label inside the SliderRow.
        // Find the range input whose min/max match semitone bounds.
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const pitchRange = ranges.find(
            (r) => r.getAttribute('min') === '-10' && r.getAttribute('max') === '10'
        );
        expect(pitchRange).toBeTruthy();
        expect(pitchRange.getAttribute('step')).toBe('0.25');
    });

    it('renders the helper text "semitones (Google only)" near the pitch label', () => {
        // CONTRACT 8: the literal hint string must be in the DOM. This is
        // the one-line user-facing signal that the unit changed; remove
        // it and admins won't know -10..10 isn't a ratio anymore.
        mount();
        // Grab text content of the whole rendered tree and search.
        expect(document.body.textContent).toContain('semitones (Google only)');
    });

    it('writes config.voice.tts_pitch as a number when the pitch slider moves', async () => {
        // CONTRACT 4: dragging the slider stores a numeric semitone value.
        const { captured } = mount();
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
    it('renders a rate slider with min=0.5, max=1.5, step=0.05', () => {
        // CONTRACT 5: rate range is independent of pitch unit changes.
        mount();
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const rateRange = ranges.find(
            (r) => r.getAttribute('min') === '0.5' && r.getAttribute('max') === '1.5'
        );
        expect(rateRange).toBeTruthy();
        expect(rateRange.getAttribute('step')).toBe('0.05');
    });

    it('writes config.voice.tts_rate when the rate slider moves', async () => {
        // CONTRACT 5: rate edits round-trip into config.voice.
        const { captured } = mount();
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
        // CONTRACT 6: empty defaults => no override object.
        const { captured } = mount();
        expect(captured.current.config.voice).toBeUndefined();
    });

    it('writes config.voice.case_voice when a specific voice is picked', async () => {
        // CONTRACT 7: choosing a voice in the dropdown stores it.
        const { captured } = mount();
        await waitForVoices('kokoro');
        const voiceSelect = getCaseVoiceSelect();
        fireEvent.change(voiceSelect, { target: { value: 'am_michael' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.case_voice).toBe('am_michael');
        });
    });

    it('removes case_voice (and config.voice if empty) when reset to inherit', async () => {
        // CONTRACT 6 + 7: clearing the last override deletes the wrapper.
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
});
