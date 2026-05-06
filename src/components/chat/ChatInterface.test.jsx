// Regression lock for the 8-hour voice-context leak bug discovered on
// 2026-05-06 (commit bb34d88). Pre-fix, `ChatInterface` merged the active
// case's `config.voice` (specifically `tts_pitch`) into the shared
// VoiceContext, which the discussant component reads. The discussant then
// spoke with the patient's per-case pitch override. The fix keeps
// VoiceContext platform-only and applies per-case overrides only at the
// patient TTS callsite via `resolveSpeakerVoice`.
//
// These tests must FAIL against the un-fixed code and PASS against the
// current code so they act as a permanent leak alarm.

import React, { useEffect } from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChatInterface from './ChatInterface.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import { resolveVoice } from '../../utils/voiceResolver.js';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// jsdom doesn't implement Element.prototype.scrollIntoView; ChatInterface
// calls it inside a useEffect on every messages change. Stub it locally
// (don't touch tests/setup.js — that's shared infra).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// --- inline msw handlers ------------------------------------------------
// We don't import mockTtsServer.js here because (a) ChatInterface in this
// test never enters voice mode so /api/tts is never hit, and (b) the
// platform-settings + manifest endpoints are component-mount concerns
// outside that helper's scope. Using inline handlers keeps the shared
// mockTtsServer.js untouched (other agents may be modifying it in
// parallel for different tests).
//
// `voiceFixture` is the platform's voice settings as returned by
// /api/platform-settings/voice. The test mutates this between cases to
// confirm the component pushes platform values verbatim.
const platformVoice = {
    tts_pitch: 1.0,
    tts_rate: 1.0,
    voice_google_male: 'en-US-Chirp3-HD-Charon',
    voice_mode_enabled: false, // keep voice mode off so we don't fire TTS
    stt_language: 'en-US',
};

// Default empty handlers — each test can override with server.use(...).
function defaultHandlers() {
    return [
        // /api/platform-settings/voice — the canonical source of leak
        http.get('*/api/platform-settings/voice', () =>
            HttpResponse.json(platformVoice)
        ),
        // /api/platform-settings/chat — also fetched on mount
        http.get('*/api/platform-settings/chat', () =>
            HttpResponse.json({ doctorName: 'Dr. Test', doctorAvatar: '' })
        ),
        // /api/platform-settings/avatars — also fetched on mount
        http.get('*/api/platform-settings/avatars', () =>
            HttpResponse.json({})
        ),
        // Static manifest fetched in parallel with voice settings
        http.get('*/avatars/heads/manifest.json', () =>
            HttpResponse.json({})
        ),
        // AuthService.verifyToken is fired by AuthProvider on mount.
        // We don't need a real user (the leak is observable via
        // VoiceContext alone), but we do need to not blow up the network.
        http.get('*/api/auth/verify', () =>
            HttpResponse.json({ user: null }, { status: 401 })
        ),
        // Catch-all for anything else ChatInterface or its children might
        // probe at mount time. Returning {} keeps the component from
        // throwing on JSON parse.
        http.get('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers(...defaultHandlers()));
afterAll(() => server.close());

// --- VoiceProbe ---------------------------------------------------------
// Tiny consumer that sits inside the same VoiceProvider as ChatInterface
// and surfaces the live VoiceContext.voiceSettings via DOM attributes.
// We chose this over extending renderWithProviders.jsx (option 1 in the
// task spec) so the shared helper stays untouched.
function VoiceProbe({ onUpdate }) {
    const { voiceSettings } = useVoice();
    useEffect(() => {
        if (typeof onUpdate === 'function') onUpdate(voiceSettings);
    }, [voiceSettings, onUpdate]);
    const json = voiceSettings ? JSON.stringify(voiceSettings) : '';
    return (
        <div
            data-testid="voice-probe"
            data-voice-settings={json}
            data-tts-pitch={voiceSettings?.tts_pitch ?? ''}
            data-tts-rate={voiceSettings?.tts_rate ?? ''}
            data-has-case-voice={
                voiceSettings && Object.prototype.hasOwnProperty.call(voiceSettings, 'case_voice')
                    ? 'yes'
                    : 'no'
            }
        />
    );
}

// Assemble both ChatInterface (writer) and VoiceProbe (reader) under one
// VoiceProvider so the probe sees exactly what ChatInterface published.
function mount(activeCase, { extraProps = {} } = {}) {
    const captured = { settings: null };
    const onUpdate = (s) => { captured.settings = s; };
    const result = renderWithProviders(
        <>
            <ChatInterface
                activeCase={activeCase}
                onSessionStart={() => {}}
                restoredSessionId={null}
                sessionStartTime={Date.now()}
                currentVitals={null}
                {...extraProps}
            />
            <VoiceProbe onUpdate={onUpdate} />
        </>,
        { withPatientRecord: false }
    );
    return { ...result, captured };
}

function readProbe(getByTestId) {
    const node = getByTestId('voice-probe');
    return {
        pitch: node.getAttribute('data-tts-pitch'),
        rate: node.getAttribute('data-tts-rate'),
        hasCaseVoice: node.getAttribute('data-has-case-voice'),
        json: node.getAttribute('data-voice-settings'),
        parsed: (() => {
            const raw = node.getAttribute('data-voice-settings');
            return raw ? JSON.parse(raw) : null;
        })(),
    };
}

// Wait until the VoiceProvider has received the platform fetch result.
// The component runs an async useEffect on mount; before the fetch
// resolves, voiceSettings is still null.
async function waitForVoiceSettings(getByTestId) {
    await waitFor(() => {
        const probe = readProbe(getByTestId);
        expect(probe.parsed).not.toBeNull();
    });
}

// ----------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------
const caseWithOverride = {
    id: 1,
    name: 'Case With Override',
    system_prompt: 'You are a patient.',
    config: {
        patient_name: 'Test Patient',
        demographics: { age: 35, gender: 'male' },
        voice: {
            tts_pitch: 1.05,
            tts_rate: 1.15,
            case_voice: 'en-US-Neural2-J',
        },
    },
};

const caseWithoutOverride = {
    id: 2,
    name: 'Case Without Override',
    system_prompt: 'You are a patient.',
    config: {
        patient_name: 'Plain Patient',
        demographics: { age: 50, gender: 'female' },
        // No `voice` key at all.
    },
};

const caseWithDifferentOverride = {
    id: 3,
    name: 'Case Different Override',
    system_prompt: 'You are a patient.',
    config: {
        patient_name: 'Other Patient',
        demographics: { age: 40, gender: 'female' },
        voice: {
            tts_pitch: 0.8,
            tts_rate: 0.9,
            case_voice: 'en-US-Neural2-F',
        },
    },
};

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

describe('ChatInterface — VoiceContext leak regression (commit bb34d88)', () => {
    it('does NOT leak per-case voice override into VoiceContext.voiceSettings', async () => {
        // Pre-fix this is the failing assertion: the component pushed
        // activeCase.config.voice into VoiceContext, so probe.tts_pitch
        // would be 1.05 instead of 1.0.
        const { getByTestId } = mount(caseWithOverride);
        await waitForVoiceSettings(getByTestId);

        const probe = readProbe(getByTestId);

        expect(probe.parsed.tts_pitch).toBe(1.0);   // platform, NOT 1.05
        expect(probe.parsed.tts_rate).toBe(1.0);    // platform, NOT 1.15
        expect(probe.hasCaseVoice).toBe('no');      // NEVER add case_voice
        expect(probe.parsed).not.toHaveProperty('case_voice');
        // The platform-only fields the discussant relies on must be present.
        expect(probe.parsed.voice_google_male).toBe('en-US-Chirp3-HD-Charon');
    });

    it('uses platform values verbatim when activeCase has no per-case override', async () => {
        const { getByTestId } = mount(caseWithoutOverride);
        await waitForVoiceSettings(getByTestId);

        const probe = readProbe(getByTestId);
        expect(probe.parsed.tts_pitch).toBe(1.0);
        expect(probe.parsed.tts_rate).toBe(1.0);
        expect(probe.hasCaseVoice).toBe('no');
        expect(probe.parsed.voice_google_male).toBe('en-US-Chirp3-HD-Charon');
        // Sanity: the platform fixture is exactly what came through.
        expect(probe.parsed).toEqual(platformVoice);
    });

    it('still does not leak when the active case is swapped to a different override', async () => {
        // Swapping activeCase.id is what happens when the trainee picks a
        // new case mid-app. Pre-fix the merge useEffect re-fired and
        // pushed the new case's pitch into VoiceContext too. Post-fix
        // VoiceContext is stable and platform-only.
        const { getByTestId, rerender } = mount(caseWithOverride);
        await waitForVoiceSettings(getByTestId);

        // First render leak guard.
        let probe = readProbe(getByTestId);
        expect(probe.parsed.tts_pitch).toBe(1.0);

        // Rerender with a different case carrying a different override.
        rerender(
            <>
                <ChatInterface
                    activeCase={caseWithDifferentOverride}
                    onSessionStart={() => {}}
                    restoredSessionId={null}
                    sessionStartTime={Date.now()}
                    currentVitals={null}
                />
                <VoiceProbe />
            </>
        );

        // Give any post-rerender effects a chance to run before re-asserting.
        await waitFor(() => {
            probe = readProbe(getByTestId);
            // Nothing should have shifted; this is the exact assertion the
            // bug would have flunked.
            expect(probe.parsed.tts_pitch).toBe(1.0);
        });

        expect(probe.parsed.tts_rate).toBe(1.0);
        expect(probe.hasCaseVoice).toBe('no');
        // The new case's pitch (0.8) must NOT have leaked through either.
        expect(probe.parsed.tts_pitch).not.toBe(0.8);
    });

    it('per-case override still flows through resolveSpeakerVoice (not via VoiceContext)', async () => {
        // The leak fix moved the override out of VoiceContext but it must
        // STILL apply to the patient TTS callsite — the patient should
        // continue to use case-level pitch/rate/voice while the discussant
        // (which reads VoiceContext) does not. This test exercises the
        // resolver the same way ChatInterface.handleSendToPatient does
        // and confirms the case-level override survives.
        const { getByTestId } = mount(caseWithOverride);
        await waitForVoiceSettings(getByTestId);

        const probe = readProbe(getByTestId);
        // VoiceContext is platform-only (proven again here for clarity).
        expect(probe.parsed.tts_pitch).toBe(1.0);

        // Now call resolveVoice the same way ChatInterface does. The
        // override is the case's own config.voice — NOT VoiceContext's
        // voiceSettings.
        const resolved = resolveVoice({
            voice: caseWithOverride.config.voice,
            voiceSettings: probe.parsed,            // platform only
            platformAvatars: null,
            gender: caseWithOverride.config.demographics.gender,
            age: caseWithOverride.config.demographics.age,
        });

        // Patient still gets its case-level override values.
        expect(resolved.file).toBe('en-US-Neural2-J');
        expect(resolved.tier).toBe('override');
        expect(resolved.pitch).toBe(1.05);
        expect(resolved.rate).toBe(1.15);
    });
});
