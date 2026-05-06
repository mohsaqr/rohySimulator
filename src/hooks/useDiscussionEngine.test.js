// Phase-4 unit tests for useDiscussionEngine.
//
// The hook drives the post-case debrief. It owns:
//   - LLM streaming (LLMService.streamMessage)
//   - per-sentence TTS via VoiceService.beginSpeechSession / session.enqueue
//   - voice resolution via voiceResolver.resolveVoice
//   - lifecycle cleanup (unmount aborts the LLM stream + cancels TTS)
//   - persisted message history
//
// All collaborators are mocked via vi.mock so this is a pure orchestration
// test of the hook itself — no real fetch, no real audio, no real LLM.
//
// CONTRACT comments below mark places where the brief asked for surface that
// the hook does NOT actually expose — the comments are the regression anchor
// so a future change either keeps the lacuna or, if it adds the surface,
// updates the test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// --- Mocks -------------------------------------------------------------

vi.mock('../services/llmService', () => ({
    LLMService: {
        streamMessage: vi.fn(),
    },
}));

vi.mock('../services/voiceService', () => {
    // beginSpeechSession returns a session handle. We construct it per test
    // call so each test can introspect the exact handle the hook wired to.
    const sessions = [];
    const beginSpeechSession = vi.fn((opts) => {
        const handle = {
            opts,
            enqueue: vi.fn(),
            flush: vi.fn(),
            cancel: vi.fn(),
        };
        sessions.push(handle);
        return handle;
    });
    return {
        VoiceService: {
            beginSpeechSession,
            cancelSpeech: vi.fn(),
            // Expose the handle log so tests can introspect.
            __sessions: sessions,
        },
    };
});

vi.mock('../services/discussionService', () => ({
    // CONTRACT: useDiscussionEngine does NOT call fetchDiscussantForCase
    // itself — the discussant is passed in as a prop by the caller (the
    // discussion screen). It DOES call buildCaseContext on every send, so
    // we mock that.
    fetchDiscussantForCase: vi.fn(),
    buildCaseContext: vi.fn((activeCase, filter) =>
        `\n[CASE:${activeCase?.id ?? 'none'}|filter:${filter ?? 'none'}]`
    ),
}));

vi.mock('../utils/voiceResolver', () => ({
    resolveVoice: vi.fn(() => ({
        file: 'en-US-Female-A',
        provider: 'google',
        rate: 1.0,
        pitch: 0,
        tier: 'override',
    })),
}));

vi.mock('../utils/personaBlocks', () => ({
    buildPersonaBlocks: vi.fn(() => '\n[PERSONA]'),
}));

vi.mock('../services/eventLogger', () => ({
    default: {
        messageSent: vi.fn(),
        messageReceived: vi.fn(),
    },
    COMPONENTS: { DISCUSSION_SCREEN: 'discussion_screen' },
}));

vi.mock('../config/api', () => ({
    apiUrl: (p) => `/api${p}`,
}));

// --- Imports under test (after mocks) ----------------------------------

import { useDiscussionEngine } from './useDiscussionEngine';
import { LLMService } from '../services/llmService';
import { VoiceService } from '../services/voiceService';
import { resolveVoice } from '../utils/voiceResolver';

// --- Fixtures ----------------------------------------------------------

function makeProps(overrides = {}) {
    return {
        sessionId: 'session-1',
        activeCase: { id: 'case-1', title: 'Chest pain' },
        discussant: {
            systemPrompt: 'You are a clinical educator.',
            voice: { gender: 'male' },
            rawConfig: { dos: ['Be kind'], donts: ['No insults'] },
            contextFilter: null,
        },
        voiceMode: true,
        voiceSettings: { provider: 'google' },
        platformAvatars: { default_voice_google_male: 'en-US-Male-Default' },
        ...overrides,
    };
}

// fetch is called by logTurn — stub it so we don't get unhandled rejections.
// Vitest's project-level clearMocks/restoreMocks wipes implementations between
// tests, so we re-install the factory shape here in beforeEach.
beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    VoiceService.__sessions.length = 0;
    VoiceService.beginSpeechSession.mockImplementation((opts) => {
        const handle = {
            opts,
            enqueue: vi.fn(),
            flush: vi.fn(),
            cancel: vi.fn(),
        };
        VoiceService.__sessions.push(handle);
        return handle;
    });
    resolveVoice.mockImplementation(() => ({
        file: 'en-US-Female-A',
        provider: 'google',
        rate: 1.0,
        pitch: 0,
        tier: 'override',
    }));
});

afterEach(() => {
    vi.useRealTimers();
});

// --- Tests -------------------------------------------------------------

describe('useDiscussionEngine — initial state', () => {
    it('returns the documented public surface', () => {
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));

        // CONTRACT: the hook exposes { messages, busy, speaking, visemes,
        // sendMessage, startConversation }. There is NO `error`, `isRunning`,
        // or `currentSpeaker` on the public API — `busy` and `speaking`
        // together cover the running-state semantics. If a future refactor
        // adds those names, update this assertion.
        expect(Object.keys(result.current).sort()).toEqual(
            ['busy', 'messages', 'sendMessage', 'speaking', 'startConversation', 'visemes'].sort()
        );
        expect(typeof result.current.sendMessage).toBe('function');
        expect(typeof result.current.startConversation).toBe('function');
    });

    it('starts with empty messages, busy=false, speaking=false, silent visemes', () => {
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        expect(result.current.messages).toEqual([]);
        expect(result.current.busy).toBe(false);
        expect(result.current.speaking).toBe(false);
        expect(result.current.visemes).toEqual({ viseme_sil: 1 });
    });

    it('hydrates messages from localStorage for the given sessionId', () => {
        const stored = [{ role: 'user', content: 'hi' }];
        window.localStorage.setItem('rohy_discussion_history_session-1', JSON.stringify(stored));
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        expect(result.current.messages).toEqual(stored);
    });
});

describe('useDiscussionEngine — voice resolution at session start', () => {
    it('passes resolved voice (file, provider, rate, pitch, gender) to beginSpeechSession', async () => {
        resolveVoice.mockReturnValue({
            file: 'en-GB-Wavenet-D',
            provider: 'google',
            rate: 1.1,
            pitch: 2,
            tier: 'platform-default',
        });
        LLMService.streamMessage.mockImplementation(async () => 'hello there.');

        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        // CONTRACT: voice resolution is done inline via resolveVoice with
        // the discussant.voice + voiceSettings + platformAvatars + gender.
        // The hook does NOT preload a voice on mount or session-start; it
        // resolves per-send. This locks the call shape.
        expect(resolveVoice).toHaveBeenCalledWith(expect.objectContaining({
            voice: { gender: 'male' },
            voiceSettings: { provider: 'google' },
            platformAvatars: expect.any(Object),
            gender: 'male',
        }));

        expect(VoiceService.beginSpeechSession).toHaveBeenCalledTimes(1);
        const opts = VoiceService.beginSpeechSession.mock.calls[0][0];
        expect(opts).toMatchObject({
            voice: 'en-GB-Wavenet-D',
            provider: 'google',
            rate: 1.1,
            pitch: 2,
            gender: 'male',
        });
    });

    it('skips TTS when voiceMode is false', async () => {
        LLMService.streamMessage.mockImplementation(async () => 'hello.');
        const { result } = renderHook(() => useDiscussionEngine(makeProps({ voiceMode: false })));
        await act(async () => { await result.current.sendMessage('hi'); });
        expect(VoiceService.beginSpeechSession).not.toHaveBeenCalled();
    });

    it('skips TTS when resolveVoice returns no file (text-only fallback)', async () => {
        resolveVoice.mockReturnValue({ file: null, provider: 'google', rate: 1, pitch: 0 });
        LLMService.streamMessage.mockImplementation(async () => 'hello.');
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });
        expect(VoiceService.beginSpeechSession).not.toHaveBeenCalled();
        // Stream still completes and updates messages.
        expect(result.current.messages.at(-1).content).toBe('hello.');
    });
});

describe('useDiscussionEngine — sentence streaming → enqueue', () => {
    it('enqueues each completed sentence to the speech session as deltas arrive', async () => {
        // CONTRACT: the hook splits sentences using an INLINE regex
        // (/^(.+?[.!?])\s+/s) — it does NOT import src/utils/sentenceSplit.js.
        // If a future refactor moves to the shared splitter, update both
        // this CONTRACT note and the assertion below.
        let capturedOnDelta;
        LLMService.streamMessage.mockImplementation(async (_sid, _msgs, _sys, _mode, { onDelta }) => {
            capturedOnDelta = onDelta;
            onDelta('Hello there. ');
            onDelta('How are you? ');
            onDelta('I am well!');
            return 'Hello there. How are you? I am well!';
        });

        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        const session = VoiceService.__sessions[0];
        // First two sentences are full ("X.\s") and get enqueued during the
        // stream. The third has no trailing whitespace so it's drained on
        // flush via the buffer remainder enqueue.
        const enqueued = session.enqueue.mock.calls.map((c) => c[0]);
        expect(enqueued).toEqual(['Hello there.', 'How are you?', 'I am well!']);
        expect(capturedOnDelta).toBeTypeOf('function');
    });

    it('flushes the speech session at end-of-stream', async () => {
        LLMService.streamMessage.mockImplementation(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('Done. ');
            return 'Done.';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });
        const session = VoiceService.__sessions[0];
        expect(session.flush).toHaveBeenCalledTimes(1);
    });
});

describe('useDiscussionEngine — message state & silentUser', () => {
    it('appends both user and assistant messages on a normal send', async () => {
        LLMService.streamMessage.mockImplementation(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('hi back.');
            return 'hi back.';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hello'); });

        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[0]).toEqual({ role: 'user', content: 'hello' });
        expect(result.current.messages[1].role).toBe('assistant');
        expect(result.current.messages[1].content).toBe('hi back.');
    });

    it('silentUser=true hides the user turn but still triggers an assistant response', async () => {
        // CONTRACT: silentUser is a per-send flag on sendMessage's options
        // bag — it is NOT a hook-level prop. The discussant still speaks
        // (TTS still fires, beginSpeechSession is still called when
        // voiceMode is on). There is no separate STT wire-up in this hook
        // at all — STT belongs to the chat screen, not the engine — so
        // "no user-side STT is wired" is trivially true.
        LLMService.streamMessage.mockImplementation(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('Welcome! ');
            return 'Welcome!';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => {
            await result.current.sendMessage('kick off', { silentUser: true });
        });

        // Only the assistant turn is in the visible transcript.
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].role).toBe('assistant');
        // acc accumulates the raw deltas verbatim, so trailing whitespace
        // from the delta is preserved on the final message.
        expect(result.current.messages[0].content).toBe('Welcome! ');
        // TTS still fired — discussant speaks.
        expect(VoiceService.beginSpeechSession).toHaveBeenCalledTimes(1);
    });

    it('startConversation kicks off a silent-user opener', async () => {
        let capturedMessages;
        LLMService.streamMessage.mockImplementation(async (_s, msgs, _sp, _mo, { onDelta }) => {
            capturedMessages = msgs;
            onDelta('Hi, welcome to the debrief.');
            return 'Hi, welcome to the debrief.';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.startConversation(); });

        // The kickoff prompt was sent to the LLM as a user turn...
        expect(capturedMessages.at(-1).role).toBe('user');
        expect(capturedMessages.at(-1).content).toMatch(/Begin the debrief/);
        // ...but the visible transcript only shows the assistant reply.
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].role).toBe('assistant');
    });
});

describe('useDiscussionEngine — busy / speaking lifecycle', () => {
    it('toggles busy=true during the LLM call and false after', async () => {
        let resolveStream;
        LLMService.streamMessage.mockImplementation(() => new Promise((res) => { resolveStream = () => res('done.'); }));
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));

        let pending;
        act(() => { pending = result.current.sendMessage('hi'); });
        await waitFor(() => expect(result.current.busy).toBe(true));

        await act(async () => { resolveStream(); await pending; });
        expect(result.current.busy).toBe(false);
    });

    it('drives speaking + visemes via VoiceService callbacks', async () => {
        LLMService.streamMessage.mockImplementation(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('hi.');
            return 'hi.';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        const session = VoiceService.__sessions[0];
        // Fire the wired callbacks — these are the contract between the
        // hook and the voice service.
        act(() => { session.opts.onStart(); });
        expect(result.current.speaking).toBe(true);

        act(() => { session.opts.onVisemes({ viseme_PP: 0.8 }); });
        expect(result.current.visemes).toEqual({ viseme_PP: 0.8 });

        act(() => { session.opts.onEnd(); });
        expect(result.current.speaking).toBe(false);
        expect(result.current.visemes).toEqual({ viseme_sil: 1 });
    });
});

describe('useDiscussionEngine — cancel / cleanup', () => {
    it('unmount cancels the speech session and aborts the LLM stream', async () => {
        let receivedSignal;
        let resolveStream;
        LLMService.streamMessage.mockImplementation((_s, _m, _sp, _mo, { signal }) => {
            receivedSignal = signal;
            return new Promise((res) => { resolveStream = res; });
        });

        const { result, unmount } = renderHook(() => useDiscussionEngine(makeProps()));
        act(() => { result.current.sendMessage('hi'); });
        await waitFor(() => expect(VoiceService.beginSpeechSession).toHaveBeenCalled());

        const session = VoiceService.__sessions[0];

        unmount();

        // The hook's unmount effect aborts the in-flight LLM controller and
        // calls VoiceService.cancelSpeech (the global teardown). It also
        // calls the active session's .cancel().
        expect(receivedSignal.aborted).toBe(true);
        expect(VoiceService.cancelSpeech).toHaveBeenCalled();
        expect(session.cancel).toHaveBeenCalled();

        // Resolve the dangling promise so we don't leak.
        await act(async () => { resolveStream(''); });
    });

    it('CONTRACT: the hook does NOT expose a cancel() action — cancellation is via unmount only', () => {
        // CONTRACT: the brief asks for a cancel() API. The current hook
        // does NOT expose one. Cancellation happens implicitly when the
        // host component unmounts (see the cleanup useEffect). If a
        // future refactor adds an explicit cancel handle, replace this
        // test with one that calls it.
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        expect(result.current).not.toHaveProperty('cancel');
        expect(result.current).not.toHaveProperty('stop');
        expect(result.current).not.toHaveProperty('abort');
    });
});

describe('useDiscussionEngine — error handling', () => {
    it('surfaces non-abort LLM errors as an assistant message marked error=true', async () => {
        // CONTRACT: there is NO top-level `error` state. Errors are rendered
        // as a special assistant message with `error: true` on the object.
        // Callers introspect the messages array to detect failure. If a
        // future refactor adds `result.current.error`, this test should
        // grow an assertion for it; for now we lock the actual surface.
        LLMService.streamMessage.mockImplementation(async () => {
            const e = new Error('boom');
            e.name = 'TypeError';
            throw e;
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        const last = result.current.messages.at(-1);
        expect(last.role).toBe('assistant');
        expect(last.error).toBe(true);
        expect(last.content).toMatch(/Error: boom/);
        // Speaking is reset to false even on failure so the mic isn't stuck.
        expect(result.current.speaking).toBe(false);
        expect(result.current.busy).toBe(false);
    });

    it('AbortError does not produce an error message bubble', async () => {
        LLMService.streamMessage.mockImplementation(async () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            throw e;
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        const last = result.current.messages.at(-1);
        expect(last?.error).toBeUndefined();
        // The placeholder content stays empty because no delta arrived.
        expect(last?.content).toBe('');
    });

    it('cancels the speech session if the LLM stream throws mid-stream', async () => {
        LLMService.streamMessage.mockImplementation(async () => { throw new Error('mid-stream'); });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hi'); });

        const session = VoiceService.__sessions[0];
        expect(session.cancel).toHaveBeenCalled();
    });
});

describe('useDiscussionEngine — guards & resume', () => {
    it('does nothing when called with empty text, no sessionId, or no discussant', async () => {
        const { result: r1 } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await r1.current.sendMessage('   '); });
        expect(LLMService.streamMessage).not.toHaveBeenCalled();

        const { result: r2 } = renderHook(() => useDiscussionEngine(makeProps({ sessionId: null })));
        await act(async () => { await r2.current.sendMessage('hi'); });
        expect(LLMService.streamMessage).not.toHaveBeenCalled();

        const { result: r3 } = renderHook(() => useDiscussionEngine(makeProps({ discussant: null })));
        await act(async () => { await r3.current.sendMessage('hi'); });
        expect(LLMService.streamMessage).not.toHaveBeenCalled();
    });

    it('resume after error: a second send reuses the hook and produces a fresh session', async () => {
        // CONTRACT: there is no explicit cancel() to recover from, but a
        // failed send must not poison the hook — the next sendMessage call
        // should open a brand new TTS session and a brand new LLM stream.
        LLMService.streamMessage.mockImplementationOnce(async () => { throw new Error('first fail'); });
        LLMService.streamMessage.mockImplementationOnce(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('recovered.');
            return 'recovered.';
        });

        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('first'); });
        await act(async () => { await result.current.sendMessage('second'); });

        expect(VoiceService.beginSpeechSession).toHaveBeenCalledTimes(2);
        expect(LLMService.streamMessage).toHaveBeenCalledTimes(2);
        expect(result.current.messages.at(-1).content).toBe('recovered.');
        expect(result.current.busy).toBe(false);
    });

    it('persists messages back to localStorage on every change', async () => {
        LLMService.streamMessage.mockImplementation(async (_s, _m, _sp, _mo, { onDelta }) => {
            onDelta('persisted.');
            return 'persisted.';
        });
        const { result } = renderHook(() => useDiscussionEngine(makeProps()));
        await act(async () => { await result.current.sendMessage('hello'); });

        const stored = JSON.parse(window.localStorage.getItem('rohy_discussion_history_session-1') || '[]');
        expect(stored).toHaveLength(2);
        expect(stored[0]).toEqual({ role: 'user', content: 'hello' });
        expect(stored[1].role).toBe('assistant');
    });
});
