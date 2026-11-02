// Hands-free conversation wiring in ChatInterface (prototype, preference off
// by default). VoiceService is mocked: the test plays the browser's
// recogniser (startListening handlers) and the TTS session (onStart/onEnd).
// The turn-taking decisions themselves are covered in
// src/hooks/handsFreeTurns.test.js and useHandsFreeConversation.test.jsx.

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChatInterface from './ChatInterface.jsx';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

const vs = vi.hoisted(() => ({ listens: [], sessions: [] }));

vi.mock('../../services/voiceService', () => ({
    VoiceService: {
        isSttSupported: () => true,
        startListening: vi.fn((h) => { vs.listens.push(h); }),
        stopListening: vi.fn(),
        // Like the real teardown: the live session ends (onEnd, flush resolves).
        cancelSpeech: vi.fn(() => { vs.sessions.forEach((s) => s.end()); }),
        isSpeaking: () => false,
        speak: vi.fn(),
        // A speech session the test drives: the first sentence starts the
        // audio; flush() resolves when the test says the audio has drained.
        beginSpeechSession: vi.fn((opts) => {
            const s = { opts, started: false, endFired: false };
            s.end = () => {
                if (s.endFired) return;
                s.endFired = true;
                opts.onEnd?.();
                s.resolveFlush?.();
            };
            s.handle = {
                enqueue: vi.fn(() => {
                    if (!s.started) { s.started = true; opts.onStart?.(); }
                }),
                flush: vi.fn(() => s.endFired ? Promise.resolve() : new Promise((resolve) => { s.resolveFlush = resolve; })),
                cancel: vi.fn(() => s.end()),
            };
            vs.sessions.push(s);
            return s.handle;
        }),
    },
}));

import { VoiceService } from '../../services/voiceService';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

const caseFixture = {
    id: 42,
    name: 'Hands-free case',
    system_prompt: 'You are the patient.',
    config: {
        patient_name: 'Alice Original',
        demographics: { age: 35, gender: 'male' },
        voice: { case_voice: 'en-US-Neural2-CASE' },
    },
};

let llmRequests = [];
function handlers() {
    llmRequests = [];
    return [
        http.get('*/api/auth/verify', () => HttpResponse.json({ user: { id: 1, username: 'tester', role: 'student' } })),
        http.get('*/api/platform-settings/voice', () => HttpResponse.json({
            voice_mode_enabled: true,
            stt_language: 'en-US',
            voice_google_male: 'en-US-Chirp3-HD-Charon',
            voice_google_female: 'en-US-Chirp3-HD-Aoede',
        })),
        http.get('*/api/sessions/:sid', ({ params }) => HttpResponse.json({
            session: { id: Number(params.sid), case_snapshot: JSON.stringify(caseFixture) },
        })),
        http.get('*/api/sessions/:sid/agents', () => HttpResponse.json({ agents: [] })),
        http.get('*/api/interactions/:sid', () => HttpResponse.json({ interactions: [] })),
        http.post('*/api/proxy/llm', async ({ request }) => {
            const body = await request.clone().json().catch(() => null);
            llmRequests.push(body);
            return new HttpResponse(
                `data: ${JSON.stringify({ delta: 'It hurts here.' })}\n\ndata: [DONE]\n\n`,
                { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
            );
        }),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({ ok: true })),
    ];
}
const server = setupServer(...handlers());

// A second capture must never be opened (see src/hooks/echoFilter.js): spy
// on the browser surface it would need.
function installMicSpies() {
    vi.stubGlobal('AudioContext', vi.fn());
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
}

function VoiceOn() {
    const { setVoiceMode } = useVoice();
    useEffect(() => { setVoiceMode(true); }, [setVoiceMode]);
    return null;
}

function mount(signalCapture = null) {
    return renderWithProviders(
        <>
            <ChatInterface activeCase={caseFixture} onSessionStart={() => {}} restoredSessionId={999} sessionStartTime={Date.now()} signalCapture={signalCapture} />
            <VoiceOn />
        </>,
        { withPatientRecord: false },
    );
}

const lastListen = () => vs.listens[vs.listens.length - 1];
const lastUserText = () => {
    const msgs = llmRequests[llmRequests.length - 1]?.messages || [];
    return msgs[msgs.length - 1]?.content;
};

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('token', 'test-token');
    vs.listens.length = 0;
    vs.sessions.length = 0;
    vi.clearAllMocks();
    installMicSpies();
});
afterEach(() => {
    server.resetHandlers(...handlers());
    vi.unstubAllGlobals();
});
afterAll(() => server.close());

async function talkButton() {
    return screen.findByRole('button', { name: /click to talk to alice original/i });
}

describe('ChatInterface hands-free conversation', () => {
    // Regression lock: an opted-in Oyon voice controller must never open a second capture on a hands-free gesture turn.
    it('skips Oyon voice measurement even when it is enabled and consented', async () => {
        const voice = { startTurn: vi.fn(async () => ({ ok: true })), stopTurn: vi.fn() };
        mount({ voice });
        fireEvent.click(await screen.findByTestId('hands-free-toggle'));
        await waitFor(() => expect(screen.getByTestId('hands-free-toggle')).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(await talkButton());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        expect(voice.startTurn).not.toHaveBeenCalled();
        expect(globalThis.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
        expect(globalThis.AudioContext).not.toHaveBeenCalled();
    });

    // Regression lock: a barge-in queued during streaming must survive the loading/in-flight handoff and cancellation before flush().
    it('delivers the whole interruption when the previous reply is still streaming', async () => {
        let finishReply;
        server.use(http.post('*/api/proxy/llm', async ({ request }) => {
            llmRequests.push(await request.json());
            if (llmRequests.length > 1) return new HttpResponse('data: {"delta":"Understood."}\n\ndata: [DONE]\n\n');
            const encoder = new TextEncoder();
            return new HttpResponse(new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"delta":"It hurts here. My arm also hurts. "}\n\n'));
                    finishReply = () => {
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    };
                },
            }), { headers: { 'Content-Type': 'text/event-stream' } });
        }));
        mount();
        fireEvent.click(await screen.findByTestId('hands-free-toggle'));
        fireEvent.click(await talkButton());
        act(() => lastListen().onEnd({ final: 'hello' }));
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'speaking'));
        const watcher = lastListen();
        act(() => watcher.onResult({ final: 'It hurts here', interim: 'sorry doctor where exactly does it radiate?' }));
        await waitFor(() => expect(VoiceService.stopListening).toHaveBeenCalledTimes(1), { timeout: 2000 });
        expect(llmRequests).toHaveLength(1);
        act(() => finishReply());
        await waitFor(() => expect(llmRequests).toHaveLength(2));
        expect(lastUserText()).toBe('sorry doctor where exactly does it radiate?');
        act(() => watcher.onEnd({ final: 'It hurts here sorry doctor where exactly does it radiate?' }));
        expect(llmRequests).toHaveLength(2);
    });

    it('is off by default: push-to-talk, no silence end, no reopen, no extra mic', async () => {
        mount();
        const toggle = await screen.findByTestId('hands-free-toggle');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId('hands-free-status')).toBeNull();

        fireEvent.click(await talkButton());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        act(() => lastListen().onResult({ final: '', interim: 'where does it hurt' }));
        await new Promise((r) => setTimeout(r, 1300));
        expect(VoiceService.stopListening).not.toHaveBeenCalled();

        act(() => lastListen().onEnd({ final: 'where does it hurt' }));
        await waitFor(() => expect(llmRequests.length).toBe(1));
        expect(lastUserText()).toBe('where does it hurt');
        await waitFor(() => expect(vs.sessions.length).toBe(1));
        await waitFor(() => expect(vs.sessions[0].handle.flush).toHaveBeenCalled());
        act(() => vs.sessions[0].end());
        await new Promise((r) => setTimeout(r, 100));
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        expect(globalThis.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });

    it('on: pause ends the turn, the reply plays while the recogniser watches, the mic reopens; off stops it', async () => {
        mount();
        fireEvent.click(await screen.findByTestId('hands-free-toggle'));
        await waitFor(() => expect(screen.getByTestId('hands-free-toggle')).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'idle');

        fireEvent.click(await talkButton());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'listening'));

        const learner = lastListen();
        act(() => learner.onResult({ final: '', interim: 'where does it hurt' }));
        await waitFor(() => expect(VoiceService.stopListening).toHaveBeenCalledTimes(1), { timeout: 2000 });
        // Regression lock: (a) the silence deadline sends before Chrome's delayed onend.
        await waitFor(() => expect(llmRequests.length).toBe(1));
        act(() => learner.onEnd({ final: 'where does it hurt' }));
        expect(lastUserText()).toBe('where does it hurt');

        // The patient speaks; the recogniser restarts as a watcher.
        await waitFor(() => expect(vs.sessions.length).toBe(1));
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'speaking'));
        await waitFor(() => expect(VoiceService.startListening).toHaveBeenCalledTimes(2));
        const watcher = lastListen();
        const cancelsBefore = VoiceService.cancelSpeech.mock.calls.length;
        // It hears the patient's own words: nothing is interrupted or sent.
        act(() => watcher.onResult({ final: 'It hurts', interim: 'here' }));
        await new Promise((r) => setTimeout(r, 1300));
        expect(VoiceService.cancelSpeech.mock.calls.length).toBe(cancelsBefore);
        expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'speaking');
        expect(llmRequests.length).toBe(1);
        // Chrome ends it with no-speech: restarted silently, no toast-worthy pause.
        act(() => watcher.onError({ message: 'no-speech' }));
        act(() => watcher.onEnd({ final: 'It hurts here' }));
        await waitFor(() => expect(VoiceService.startListening).toHaveBeenCalledTimes(3));
        expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'speaking');

        // The reply drains: the watcher is stopped and a fresh turn listens.
        await waitFor(() => expect(vs.sessions[0].handle.flush).toHaveBeenCalled());
        act(() => vs.sessions[0].end());
        await waitFor(() => expect(VoiceService.startListening).toHaveBeenCalledTimes(4));
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'listening'));
        expect(llmRequests.length).toBe(1);

        // Regression lock: (c) the reopened turn sends even without onend;
        // the stopped watcher's late end cannot strand or overwrite it.
        const reopened = lastListen();
        act(() => watcher.onEnd({ final: 'It hurts here' }));
        act(() => reopened.onResult({ final: 'where does it hurt?', interim: '' }));
        await waitFor(() => expect(llmRequests.length).toBe(2), { timeout: 2000 });
        expect(lastUserText()).toBe('where does it hurt?');
        await waitFor(() => expect(vs.sessions.length).toBe(2));
        await waitFor(() => expect(vs.sessions[1].handle.flush).toHaveBeenCalled());
        act(() => vs.sessions[1].end());
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'listening'));

        // Off: listening stops.
        const stopsBefore = VoiceService.stopListening.mock.calls.length;
        fireEvent.click(screen.getByTestId('hands-free-toggle'));
        await waitFor(() => expect(VoiceService.stopListening.mock.calls.length).toBe(stopsBefore + 1));
        // The stopped recogniser's late end sends nothing.
        act(() => lastListen().onEnd({ final: 'half a' }));
        await new Promise((r) => setTimeout(r, 100));
        expect(llmRequests.length).toBe(2);
        // Regression lock: hands-free never opens a second capture beside the recogniser — any echo-cancelled getUserMedia left SpeechRecognition deaf on macOS Chrome (owner's live tests 2026-11-01).
        expect(globalThis.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
        expect(globalThis.AudioContext).not.toHaveBeenCalled();
    });

    it('on: talking over the patient interrupts — speech cancelled once, the same recogniser keeps the learner\'s words', async () => {
        mount();
        fireEvent.click(await screen.findByTestId('hands-free-toggle'));
        await waitFor(() => expect(screen.getByTestId('hands-free-toggle')).toHaveAttribute('aria-pressed', 'true'));
        fireEvent.click(await talkButton());
        const learner = lastListen();
        act(() => learner.onResult({ final: '', interim: 'where does it hurt' }));
        await waitFor(() => expect(VoiceService.stopListening).toHaveBeenCalledTimes(1), { timeout: 2000 });
        act(() => learner.onEnd({ final: 'where does it hurt' }));
        await waitFor(() => expect(llmRequests.length).toBe(1));
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'speaking'));
        await waitFor(() => expect(VoiceService.startListening).toHaveBeenCalledTimes(2));
        const watcher = lastListen();
        const cancelsBefore = VoiceService.cancelSpeech.mock.calls.length;

        act(() => watcher.onResult({ final: 'It hurts', interim: 'here sorry doctor' }));
        expect(VoiceService.cancelSpeech.mock.calls.length).toBe(cancelsBefore + 1);
        await waitFor(() => expect(screen.getByTestId('hands-free-status')).toHaveAttribute('data-status', 'listening'));
        act(() => watcher.onResult({ final: 'It hurts here sorry doctor', interim: 'is it sharp' }));
        // The pause ends the turn on the same recogniser.
        await waitFor(() => expect(VoiceService.stopListening).toHaveBeenCalledTimes(2), { timeout: 2000 });
        // No new recogniser was started for the interruption.
        // A new watcher may already exist for the next reply; the one that
        // captured the interruption was never replaced while it was spoken.
        expect(vs.listens[1]).toBe(watcher);
        expect(VoiceService.cancelSpeech.mock.calls.length).toBe(cancelsBefore + 1);
        act(() => watcher.onEnd({ final: 'It hurts here sorry doctor is it sharp' }));
        await waitFor(() => expect(llmRequests.length).toBe(2));
        expect(lastUserText()).toBe('sorry doctor is it sharp');
        // The next reply plays under a new watcher, tagged as such.
        await waitFor(() => expect(VoiceService.startListening).toHaveBeenCalledTimes(3));
        expect(VoiceService.startListening.mock.calls[1][0].purpose).toBe('watch');
        expect(VoiceService.startListening.mock.calls[2][0].purpose).toBe('watch');
        expect(VoiceService.startListening.mock.calls[0][0]).not.toHaveProperty('purpose');
        expect(globalThis.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });
});
