// Contract for useRoomConversation — the learner's spoken turn in the 3D room.
//
// The point of this hook is that it decides NOTHING about the patient. These
// tests are mostly about that restraint: the persona must be the chat room's
// assembled prompt, the thread must be the session's real interaction thread,
// and a room that cannot prove it holds this case's persona must stay quiet
// rather than improvise one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useRoomConversation from './useRoomConversation';
import { setLastPatientPrompt, clearLastPatientPrompt } from '../../utils/lastPatientPrompt';

const streamMessage = vi.fn();
vi.mock('../../services/llmService', () => ({
    LLMService: { streamMessage: (...args) => streamMessage(...args) },
}));

const apiFetch = vi.fn();
vi.mock('../../services/apiClient.js', () => ({
    apiFetch: (...args) => apiFetch(...args),
}));

vi.mock('../../services/eventLogger', () => ({
    default: { messageSent: vi.fn(), messageReceived: vi.fn() },
}));

const CASE = { id: 'case-7', config: { language: 'en' } };

// A speech session that records what the patient was actually given to say.
const makeSpeech = () => {
    const spoken = [];
    const session = {
        spoken,
        flushed: false,
        cancelled: false,
        enqueue: (s) => spoken.push(s),
        flush: () => { session.flushed = true; },
        cancel: () => { session.cancelled = true; },
    };
    return session;
};

let rendered;
const hook = () => rendered.result.current;
let onReply;
const mount = (props = {}) => {
    onReply = vi.fn();
    rendered = renderHook(
        (p) => useRoomConversation(p),
        { initialProps: { activeCase: CASE, sessionId: 's-1', beginSession: () => null, onReply, ...props } },
    );
};
// What the room was last told to put on screen (null = nothing).
const captioned = () => onReply.mock.calls.at(-1)?.[0] ?? null;

beforeEach(() => {
    streamMessage.mockReset();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ interactions: [] });
    clearLastPatientPrompt();
    setLastPatientPrompt({ prompt: 'YOU ARE MRS OKONKWO', caseId: 'case-7' });
});

describe('useRoomConversation', () => {
    it('speaks with the chat room\'s assembled persona, not one of its own', async () => {
        streamMessage.mockResolvedValue('It started this morning.');
        mount();
        await act(async () => { await hook().ask('when did the pain start'); });

        const [sessionId, messages, systemPrompt, mode] = streamMessage.mock.calls[0];
        expect(sessionId).toBe('s-1');
        expect(systemPrompt).toBe('YOU ARE MRS OKONKWO');
        expect(mode).toBe('voice');
        expect(messages.at(-1)).toEqual({ role: 'user', content: 'when did the pain start' });
    });

    it('refuses to ask when the cached persona belongs to another case', async () => {
        setLastPatientPrompt({ prompt: 'YOU ARE SOMEONE ELSE', caseId: 'case-99' });
        mount();
        await act(async () => { await hook().ask('what happened'); });

        expect(streamMessage).not.toHaveBeenCalled();
        expect(hook().error).toBeTruthy();
    });

    it('carries the earlier chat-room conversation into the room', async () => {
        apiFetch.mockResolvedValue({
            interactions: [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'my chest hurts' },
                { role: 'system', content: 'noise that is not dialogue' },
            ],
        });
        streamMessage.mockResolvedValue('Since about six.');
        mount();
        await waitFor(() => expect(hook().ready).toBe(true));
        await act(async () => { await hook().ask('since when'); });

        const messages = streamMessage.mock.calls[0][1];
        expect(messages).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'my chest hurts' },
            { role: 'user', content: 'since when' },
        ]);
    });

    it('starts talking at the first finished sentence, not at the end of the reply', async () => {
        const speech = makeSpeech();
        streamMessage.mockImplementation(async (_s, _m, _p, _mode, { onDelta }) => {
            onDelta('It hurts here. ');
            // One sentence is complete, so it must already be on its way to
            // the voice while the model is still writing the second.
            expect(speech.spoken).toEqual(['It hurts here.']);
            onDelta('It has been like this since six');
            return 'It hurts here. It has been like this since six';
        });
        mount({ beginSession: () => speech });
        await act(async () => { await hook().ask('where'); });

        // The trailing unterminated clause is flushed rather than dropped.
        expect(speech.spoken).toEqual(['It hurts here.', 'It has been like this since six']);
        expect(speech.flushed).toBe(true);
    });

    it('never speaks an error in the patient\'s voice', async () => {
        const speech = makeSpeech();
        streamMessage.mockResolvedValue('Error: the model is unreachable');
        mount({ beginSession: () => speech });
        await act(async () => { await hook().ask('hello'); });

        expect(speech.cancelled).toBe(true);
        expect(speech.flushed).toBe(false);
        expect(captioned()).toBeNull();
        expect(hook().error).toContain('Error:');
    });

    it('remembers its own turn, so the next question has context', async () => {
        streamMessage.mockResolvedValue('Since six.');
        mount();
        await act(async () => { await hook().ask('since when'); });
        streamMessage.mockResolvedValue('Yes, sharp.');
        await act(async () => { await hook().ask('is it sharp'); });

        expect(streamMessage.mock.calls[1][1]).toEqual([
            { role: 'user', content: 'since when' },
            { role: 'assistant', content: 'Since six.' },
            { role: 'user', content: 'is it sharp' },
        ]);
    });

    it('grows the caption as the answer arrives, so subtitles track the voice', async () => {
        const seen = [];
        streamMessage.mockImplementation(async (_s, _m, _p, _mode, { onDelta }) => {
            onDelta('It hurts here.');
            seen.push(captioned());
            onDelta(' Since six.');
            seen.push(captioned());
            return 'It hurts here. Since six.';
        });
        mount();
        await act(async () => { await hook().ask('where'); });

        expect(seen).toEqual(['It hurts here.', 'It hurts here. Since six.']);
        // And the caption is cleared at the start of the NEXT question, so a
        // stale answer never hangs over a new one.
        onReply.mockClear();
        streamMessage.mockResolvedValue('Yes.');
        await act(async () => { await hook().ask('is it sharp'); });
        expect(onReply.mock.calls[0][0]).toBeNull();
    });

    // Regression, 2026-09-01: with voice mode off the room had no way to know
    // the answer would never be heard, so it captioned nothing and the
    // patient looked unresponsive despite having replied.
    it('tells the room when an answer will not be spoken aloud', async () => {
        streamMessage.mockResolvedValue('It started this morning.');
        mount({ beginSession: () => null });
        await act(async () => { await hook().ask('when'); });

        const [line, meta] = onReply.mock.calls.at(-1);
        expect(line).toBe('It started this morning.');
        expect(meta.spoken).toBe(false);
    });

    it('marks an answer as spoken when there is a voice to speak it', async () => {
        streamMessage.mockResolvedValue('It started this morning.');
        mount({ beginSession: makeSpeech });
        await act(async () => { await hook().ask('when'); });

        expect(onReply.mock.calls.at(-1)[1].spoken).toBe(true);
    });

    it('stays silent on an empty utterance rather than sending one', async () => {
        mount();
        await act(async () => { await hook().ask('   '); });
        expect(streamMessage).not.toHaveBeenCalled();
    });
});
