// Tests for CaseAvatarVoicePicker.jsx — the per-case voice/avatar override
// picker shown inside the case wizard.
//
// CONTRACT (Voice 2.0, 2026-07 — VOICE2_PLAN.md §6.2; supersedes the
// 2026-05 platform-provider contract):
//   1. NO PROVIDER PICKER, NO PLATFORM PROVIDER. The picker offers voices
//      from EVERY usable engine in one select (grouped engine → language,
//      free/paid badged); each voice plays on its own engine. Unusable
//      engines appear as a disabled group naming the reason.
//   2. TEST VOICE BUTTON: receives the resolved voice and its DERIVED
//      engine, plus per-case rate/pitch.
//   3. CASE VOICE OVERRIDE: choosing a voice writes
//      `config.voice.case_voice`. Resetting clears it.
//   4. INHERIT: case → Patient persona template → the platform's
//      per-language default voice (each step declared, never silent).
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
    google: [
        { filename: 'en-US-Neural2-F', displayName: 'Neural2-F', gender: 'female', language: 'en-US' },
        { filename: 'en-US-Neural2-J', displayName: 'Neural2-J', gender: 'male', language: 'en-US' },
    ],
    kokoro: [
        { filename: 'af_bella', displayName: 'Bella', gender: 'female', language: 'en-US' },
        { filename: 'am_michael', displayName: 'Michael', gender: 'male', language: 'en-US' },
    ],
    openai: [
        { filename: 'alloy', displayName: 'Alloy', gender: 'neutral', language: 'en' },
    ],
    piper: [],
};

// The all-providers /tts/voices shape (Voice 2.0 §5.6): piper is present
// but unusable, with the reason — pickers must show it as a disabled group
// rather than hiding it.
const allProvidersPayload = () => ({
    providers: [
        { id: 'kokoro', capable: true, enabled: true, usable: true, reason: null, voices: sampleVoices.kokoro },
        { id: 'google', capable: true, enabled: true, usable: true, reason: null, voices: sampleVoices.google },
        { id: 'openai', capable: true, enabled: true, usable: true, reason: null, voices: sampleVoices.openai },
        { id: 'piper', capable: false, enabled: true, usable: false, reason: 'piper binary not installed', voices: [] },
    ],
});

// The Voice 2.0 settings payload: provider status + per-language defaults
// (none configured in the base fixture — tests that need the default tier
// override this).
const voiceSettingsPayload = (extra = {}) => ({
    voice_mode_enabled: true,
    providers: allProvidersPayload().providers.map(({ voices: _v, ...status }) => status),
    ...extra,
});

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
            const provider = url.searchParams.get('provider');
            if (provider) {
                return HttpResponse.json({ provider, voices: sampleVoices[provider] || [] });
            }
            return HttpResponse.json(allProvidersPayload());
        }),
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        http.get('*/api/platform-settings/voice', () =>
            HttpResponse.json(voiceSettingsPayload())
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

async function waitForVoices() {
    await waitFor(() => {
        const select = getCaseVoiceSelect();
        const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(values).toContain('af_bella');
    });
}

describe('CaseAvatarVoicePicker — engines, not a provider picker', () => {
    it('does not render a provider <select>', async () => {
        mount();
        await waitForVoices();
        const selects = Array.from(document.querySelectorAll('select'));
        for (const s of selects) {
            const optionValues = Array.from(s.querySelectorAll('option')).map(o => o.value);
            expect(optionValues).not.toContain('piper');
            expect(optionValues).not.toContain('google');
        }
    });

    it('offers voices from EVERY usable engine together (mixed engines are legal)', async () => {
        mount();
        await waitForVoices();
        const values = Array.from(getCaseVoiceSelect().querySelectorAll('option')).map(o => o.value);
        expect(values).toContain('af_bella');          // kokoro
        expect(values).toContain('en-US-Neural2-J');   // google — same select
        expect(values).toContain('alloy');             // openai — same select
    });

    it('labels engine groups with free/paid badges', async () => {
        mount();
        await waitForVoices();
        const groups = Array.from(getCaseVoiceSelect().querySelectorAll('optgroup')).map(g => g.label);
        expect(groups.some(l => l.startsWith('kokoro') && l.includes('free'))).toBe(true);
        expect(groups.some(l => l.startsWith('google') && l.includes('paid'))).toBe(true);
    });

    it('shows an unusable engine as a disabled group naming the reason', async () => {
        mount();
        await waitForVoices();
        const select = getCaseVoiceSelect();
        const piperGroup = Array.from(select.querySelectorAll('optgroup')).find(g => g.label.startsWith('piper'));
        expect(piperGroup).toBeTruthy();
        const opt = piperGroup.querySelector('option');
        expect(opt.disabled).toBe(true);
        expect(opt.textContent).toContain('piper binary not installed');
    });

    it('renders every voice regardless of patient gender (no slot filter)', async () => {
        mount({
            id: 'female-case',
            config: { demographics: { age: 35, gender: 'female' } },
        });
        await waitForVoices();
        const values = Array.from(getCaseVoiceSelect().querySelectorAll('option')).map(o => o.value);
        expect(values).toContain('am_michael');
        expect(values).toContain('af_bella');
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

describe('CaseAvatarVoicePicker — TestVoiceButton wiring (derived engine)', () => {
    it('forwards case_voice + its DERIVED engine + rate + pitch to TestVoiceButton', async () => {
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
        await waitForVoices();
        const stub = screen.getByTestId('test-voice-button-stub');
        expect(stub.getAttribute('data-voice')).toBe('en-US-Neural2-J');
        expect(stub.getAttribute('data-provider')).toBe('google'); // derived from the id
        expect(stub.getAttribute('data-rate')).toBe('1.1');
        expect(stub.getAttribute('data-pitch')).toBe('2.5');
    });

    it('forwards empty voice when nothing is configured and no language default exists', async () => {
        mount();
        await waitForVoices();
        const stub = screen.getByTestId('test-voice-button-stub');
        expect(stub.getAttribute('data-voice')).toBe('');
    });

    it('auditions the language default when nothing is configured but a default exists (the truth)', async () => {
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json(voiceSettingsPayload({ tts_default_voice_en: 'af_bella' }))
            )
        );
        mount();
        await waitForVoices();
        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('af_bella');
            expect(stub.getAttribute('data-provider')).toBe('kokoro');
        });
        // Truth clause: a default filling in for an unset voice is said out
        // loud, not implied (Codex P2 — the note used to vanish here).
        expect(document.body.textContent).toMatch(/No voice is set here/);
        expect(document.body.textContent).toContain('af_bella');
    });

    it("the case's OWN language field wins — a de case auditions the de default even in an en session", async () => {
        // config.case_language beats the session language (that is what the
        // runtime plays the case in, via useCaseLanguageSync).
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json(voiceSettingsPayload({
                    tts_default_voice_en: 'af_bella',
                    tts_default_voice_de: 'alloy',
                }))
            )
        );
        mount({
            id: 'de-case',
            config: {
                case_language: 'de',
                demographics: { age: 35, gender: 'male' },
            },
        });
        const stub = await screen.findByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('alloy');
            expect(stub.getAttribute('data-provider')).toBe('openai');
        });
    });


    it('inherits voice from the Patient persona template when case_voice is unset', async () => {
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
        await waitForVoices();
        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('af_bella');
        });
    });

    it('shows the amber loud-fail note when the saved voice cannot play here (never a stand-in)', async () => {
        // v1.4 sovereignty: google unusable → the saved google voice FAILS;
        // the note must say so, and the configured en default must NOT be
        // offered as what will play.
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json(voiceSettingsPayload({
                    providers: [
                        { id: 'kokoro', capable: true, enabled: true, usable: true, reason: null },
                        { id: 'google', capable: false, enabled: true, usable: false, reason: 'no API key' },
                        { id: 'openai', capable: true, enabled: true, usable: true, reason: null },
                        { id: 'piper', capable: false, enabled: true, usable: false, reason: 'not installed' },
                    ],
                    tts_default_voice_en: 'af_bella',
                }))
            )
        );
        mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: { case_voice: 'en-US-Neural2-J' },
            },
        });
        await waitForVoices();
        await waitFor(() => {
            expect(document.body.textContent).toContain('en-US-Neural2-J');
            expect(document.body.textContent).toMatch(/never substituted/);
        });
        // The audition button has nothing to play — the voice is literal.
        expect(screen.getByTestId('test-voice-button-stub').getAttribute('data-voice')).toBe('');
    });

    it('picking a voice FREEZES rate/pitch into the case from the platform values', async () => {
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json(voiceSettingsPayload({ tts_rate: 1.2, tts_pitch: -2 }))
            )
        );
        const { captured } = mount();
        await waitForVoices();
        fireEvent.change(getCaseVoiceSelect(), { target: { value: 'af_bella' } });
        await waitFor(() => {
            expect(captured.current.config.voice).toMatchObject({
                case_voice: 'af_bella',
                tts_rate: 1.2,   // pinned at pick time —
                tts_pitch: -2,   // later platform changes can't alter the case
            });
        });
    });

    it('author-pinned rate/pitch survive a voice re-pick (never overwritten)', async () => {
        const { captured } = mount({
            id: 'c',
            config: {
                demographics: { age: 35, gender: 'male' },
                voice: { case_voice: 'am_michael', tts_rate: 0.8, tts_pitch: 3 },
            },
        });
        await waitForVoices();
        fireEvent.change(getCaseVoiceSelect(), { target: { value: 'af_bella' } });
        await waitFor(() => {
            expect(captured.current.config.voice).toMatchObject({
                case_voice: 'af_bella',
                tts_rate: 0.8,
                tts_pitch: 3,
            });
        });
    });
});

describe('CaseAvatarVoicePicker — pitch slider', () => {
    it('renders a pitch slider with min=-10, max=10, step=0.25 (semitones)', async () => {
        mount();
        await waitForVoices();
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const pitchRange = ranges.find(
            (r) => r.getAttribute('min') === '-10' && r.getAttribute('max') === '10'
        );
        expect(pitchRange).toBeTruthy();
        expect(pitchRange.getAttribute('step')).toBe('0.25');
    });

    it('renders the helper text "semitones (Google only)" near the pitch label', async () => {
        mount();
        await waitForVoices();
        expect(document.body.textContent).toContain('semitones (Google only)');
    });

    it('writes config.voice.tts_pitch as a number when the pitch slider moves', async () => {
        const { captured } = mount();
        await waitForVoices();
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
        await waitForVoices();
        const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
        const rateRange = ranges.find(
            (r) => r.getAttribute('min') === '0.5' && r.getAttribute('max') === '1.5'
        );
        expect(rateRange).toBeTruthy();
        expect(rateRange.getAttribute('step')).toBe('0.05');
    });

    it('writes config.voice.tts_rate when the rate slider moves', async () => {
        const { captured } = mount();
        await waitForVoices();
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
        await waitForVoices();
        const voiceSelect = getCaseVoiceSelect();
        fireEvent.change(voiceSelect, { target: { value: 'am_michael' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.case_voice).toBe('am_michael');
        });
    });

    it('a cross-engine pick works the same way (google voice into a kokoro-voiced world)', async () => {
        const { captured } = mount();
        await waitForVoices();
        fireEvent.change(getCaseVoiceSelect(), { target: { value: 'en-US-Neural2-J' } });
        await waitFor(() => {
            expect(captured.current.config.voice?.case_voice).toBe('en-US-Neural2-J');
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
        await waitForVoices();
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
        await waitForVoices();
        const stub = screen.getByTestId('test-voice-button-stub');
        await waitFor(() => {
            expect(stub.getAttribute('data-voice')).toBe('af_bella');
        });
        expect(templatesFetched).toBe(false);
    });
});

// Quarantined last: this test flips the module-global i18n instance to de
// via a real LanguageProvider; running it after every other test means any
// residual language state cannot bleed into unrelated assertions.
describe('CaseAvatarVoicePicker — session-language resolution (LanguageProvider)', () => {
    it('resolves against the SESSION language — a de session auditions the de default, never the en one', async () => {
        // The picker keys resolveVoice on useLanguage()'s caseLanguage —
        // the same source the chat runtime uses (Codex P2: it used to
        // hardcode en, so non-English cases previewed the wrong fallback).
        localStorage.setItem('rohy_ui_language', 'de');
        server.use(
            http.get('*/api/platform-settings/voice', () =>
                HttpResponse.json(voiceSettingsPayload({
                    tts_default_voice_en: 'af_bella',
                    tts_default_voice_de: 'alloy', // openai — multilingual, usable in the fixture
                }))
            )
        );
        const { LanguageProvider } = await import('../../contexts/LanguageContext.jsx');
        function Harness() {
            const [caseData, setCaseData] = useState({
                id: 'de-case',
                config: { demographics: { age: 35, gender: 'male' } },
            });
            return (
                <CaseAvatarVoicePicker caseData={caseData} setCaseData={setCaseData} />
            );
        }
        renderWithProviders(
            <LanguageProvider><Harness /></LanguageProvider>,
            { withPatientRecord: false }
        );
        try {
            const stub = await screen.findByTestId('test-voice-button-stub');
            await waitFor(() => {
                expect(stub.getAttribute('data-voice')).toBe('alloy');   // the de default
                expect(stub.getAttribute('data-provider')).toBe('openai');
            });
        } finally {
            // LanguageProvider flipped the module-global i18n instance to de;
            // localStorage.clear() in afterEach does NOT undo that — reset
            // explicitly so later tests render English again.
            const { default: i18n } = await import('../../i18n');
            await i18n.changeLanguage('en');
        }
    });
});
