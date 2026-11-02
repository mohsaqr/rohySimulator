// The debrief wired end to end in the client: the REAL DiscussionScreen,
// useDiscussionEngine and VoiceControl (on the shared voice engine), with
// only the network-facing services mocked. DiscussionScreen.test.jsx mocks
// the hook and VoiceControl away, so it could not see the two interact — and
// the v3.1.2 migration of VoiceControl onto useVoiceConversation broke the
// debrief's opening line exactly there (CI e2e gate-debrief.spec.js:138).

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';

const vs = vi.hoisted(() => ({ sessions: [], listens: [] }));
vi.mock('../../services/voiceService', () => ({
    VoiceService: {
        isSttSupported: () => true,
        startListening: vi.fn((h) => { vs.listens.push(h); }),
        stopListening: vi.fn(),
        cancelSpeech: vi.fn(() => { vs.sessions.forEach((s) => s.end()); }),
        isSpeaking: () => false,
        // Like the real session: the first sentence starts the audio, flush()
        // resolves once it has played (here: at once, like the e2e's silent WAV).
        beginSpeechSession: vi.fn((opts) => {
            const s = { ended: false };
            s.end = () => {
                if (s.ended) return;
                s.ended = true;
                opts.onEnd?.();
            };
            s.handle = {
                enqueue: vi.fn(() => { if (!s.started) { s.started = true; opts.onStart?.(); } }),
                flush: vi.fn(async () => { s.end(); }),
                cancel: vi.fn(() => s.end()),
            };
            vs.sessions.push(s);
            return s.handle;
        }),
    },
}));

const llm = vi.hoisted(() => ({ reply: 'What did you think was going on?' }));
vi.mock('../../services/llmService', () => ({
    LLMService: {
        streamMessage: vi.fn(async (_sid, _msgs, _sys, _mode, { onDelta } = {}) => {
            onDelta?.(llm.reply);
            return llm.reply;
        }),
    },
}));

vi.mock('../../services/discussionService', () => ({
    fetchDiscussantForCase: vi.fn(async (caseId) => ({
        id: 'd-1', name: 'Dr. Debrief', roleTitle: 'Tutor', avatarUrl: null, systemPrompt: '',
        voice: { case_voice: 'en-US-Chirp3-HD-Charon' }, _caseId: caseId,
    })),
}));

vi.mock('../../services/apiClient', async (importOriginal) => ({
    ...(await importOriginal()),
    apiPost: vi.fn(async () => ({})),
}));

vi.mock('../chat/PatientAvatar.jsx', () => ({ default: () => <div data-testid="patient-avatar" /> }));
vi.mock('./PatientSummaryCard', () => ({ default: () => null }));
vi.mock('../../services/eventLogger', async (importOriginal) => ({
    ...(await importOriginal()),
    default: {
        log: vi.fn(), debriefSubmitted: vi.fn(), debriefMessageSent: vi.fn(), debriefMessageReceived: vi.fn(),
        componentOpened: vi.fn(), componentClosed: vi.fn(), panelOpened: vi.fn(), panelClosed: vi.fn(),
    },
}));

import DiscussionScreen from './DiscussionScreen.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';
import { VoiceService } from '../../services/voiceService';

// The platform voice settings the patient chat loaded before the debrief:
// with them the discussant is voiced (a speech session per turn).
function VoiceSettings() {
    const { setVoiceSettings } = useVoice();
    useEffect(() => {
        setVoiceSettings({
            voice_mode_enabled: true,
            stt_language: 'en-US',
            voice_google_male: 'en-US-Chirp3-HD-Charon',
            voice_google_female: 'en-US-Chirp3-HD-Aoede',
        });
    }, [setVoiceSettings]);
    return null;
}

const ACTIVE_CASE = { id: 42, name: 'Chest Pain', config: {} };

beforeEach(() => {
    vs.sessions.length = 0;
    vs.listens.length = 0;
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe('the debrief, end to end in the client', () => {
    // Regression lock: after "Start debrief" the opening line never captioned (CI e2e gate-debrief.spec.js:138, red on v3.1.2).
    it('Start debrief: the discussant\'s opening line is captioned once it has been spoken', async () => {
        renderWithProviders(
            <>
                <VoiceSettings />
                <DiscussionScreen sessionId={777} activeCase={ACTIVE_CASE} onClose={() => {}} />
            </>,
            { withPatientRecord: false },
        );
        const start = await screen.findByRole('button', { name: 'Start debrief' });
        await waitFor(() => expect(start).toBeEnabled());
        await act(async () => { fireEvent.click(start); });
        const caption = await screen.findByTestId('debrief-caption', {}, { timeout: 3000 });
        expect(caption).toHaveTextContent(llm.reply);
        expect(VoiceService.beginSpeechSession).toHaveBeenCalledTimes(1);
    });

    // Regression lock: CI e2e gate-debrief.spec.js:138 (red on v3.1.2) — the caption WAS rendered but 0 px tall ("hidden") at 1280x720: it was the column's only `min-h-0` part, so when the voice control grew a row (the Hands-free switch) the question collapsed. jsdom has no layout, so this pins the height contract that prevents it: the caption keeps a floor, the avatar is what yields, and the switch shares the status row.
    it('the caption keeps a height floor, the avatar yields space, and the voice control stays two rows tall', async () => {
        renderWithProviders(
            <>
                <VoiceSettings />
                <DiscussionScreen sessionId={778} activeCase={ACTIVE_CASE} onClose={() => {}} />
            </>,
            { withPatientRecord: false },
        );
        const start = await screen.findByRole('button', { name: 'Start debrief' });
        await waitFor(() => expect(start).toBeEnabled());
        await act(async () => { fireEvent.click(start); });
        const caption = await screen.findByTestId('debrief-caption');
        const classes = caption.className.split(/\s+/);
        expect(classes).not.toContain('min-h-0');
        expect(classes.some((c) => /^min-h-(\d+|\[)/.test(c) && c !== 'min-h-0')).toBe(true);
        const avatar = screen.getByTestId('debrief-avatar-block').className.split(/\s+/);
        expect(avatar).toEqual(expect.arrayContaining(['min-h-0', 'shrink']));
        // The voice control: the button, then ONE row with the status and the
        // Hands-free switch — never a third row.
        const row = screen.getByTestId('voice-status-row');
        expect(row).toHaveTextContent(/tap to talk/i);
        expect(row).toContainElement(screen.getByTestId('hands-free-toggle'));
        const control = row.parentElement;
        expect([...control.children].map((el) => el.tagName)).toEqual(['BUTTON', 'DIV']);
    });
});
