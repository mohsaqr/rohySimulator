import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useRoomConversation from './useRoomConversation.js';

// A stand-in for the host's 'conversation' grant: the chat room's transcript
// and its send handler, narrowed. `push` plays the part of ChatInterface
// publishing a new transcript.
function bus({ sessionId = 's1', loading = false, messages = [], send = vi.fn(async () => {}) } = {}) {
    return { sessionId, loading, messages, send };
}

describe('useRoomConversation', () => {
    it('sends the learner\'s words through the chat room\'s own handler, marked as the room\'s', async () => {
        const send = vi.fn(async () => 'ok');
        const { result } = renderHook(() => useRoomConversation({ conversation: bus({ send }), onReply: vi.fn() }));
        await act(async () => { await result.current.ask('  Where does it hurt?  '); });
        expect(send).toHaveBeenCalledWith('Where does it hurt?', { source: 'room3d', spoken: true });
        expect(result.current.error).toBeNull();
    });

    it('passes the room\'s voice switch through: a muted room asks for a silent reply', async () => {
        const send = vi.fn(async () => 'ok');
        const { result } = renderHook(() => useRoomConversation({ conversation: bus({ send }), spoken: false, onReply: vi.fn() }));
        await act(async () => { await result.current.ask('Any pain?'); });
        expect(send).toHaveBeenCalledWith('Any pain?', { source: 'room3d', spoken: false });
    });

    it('refuses to ask before the conversation has a session, and says so', async () => {
        const send = vi.fn();
        const { result } = renderHook(() => useRoomConversation({ conversation: bus({ sessionId: null, send }), onReply: vi.fn() }));
        expect(result.current.ready).toBe(false);
        await act(async () => { await result.current.ask('Hello?'); });
        expect(send).not.toHaveBeenCalled();
        expect(result.current.error).toMatch(/not ready/);
    });

    it('has no conversation at all when the host granted none', async () => {
        const { result } = renderHook(() => useRoomConversation({ conversation: null, onReply: vi.fn() }));
        expect(result.current.ready).toBe(false);
        expect(result.current.thinking).toBe(false);
        await act(async () => { await result.current.ask('Hello?'); });
        expect(result.current.error).toMatch(/not ready/);
    });

    it('surfaces a failed turn as an error, never as a patient line', async () => {
        const send = vi.fn(async () => { throw new Error('LLM unavailable'); });
        const onReply = vi.fn();
        const { result } = renderHook(() => useRoomConversation({ conversation: bus({ send }), onReply }));
        await act(async () => { await result.current.ask('Hello?'); });
        expect(result.current.error).toBe('LLM unavailable');
        expect(onReply).not.toHaveBeenCalledWith(expect.any(String), expect.anything());
    });

    it('is thinking exactly while the shared turn is in flight', () => {
        const { result, rerender } = renderHook(
            ({ loading }) => useRoomConversation({ conversation: bus({ loading }), onReply: vi.fn() }),
            { initialProps: { loading: false } },
        );
        expect(result.current.thinking).toBe(false);
        rerender({ loading: true });
        expect(result.current.thinking).toBe(true);
    });

    it('grows the caption as the shared transcript grows, so subtitles track the voice', () => {
        const onReply = vi.fn();
        const { rerender } = renderHook(
            ({ messages }) => useRoomConversation({ conversation: bus({ messages }), onReply }),
            { initialProps: { messages: [] } },
        );
        const user = { role: 'user', content: 'Where does it hurt?', source: 'room3d' };
        rerender({ messages: [user] });
        expect(onReply).toHaveBeenLastCalledWith(null);
        rerender({ messages: [user, { role: 'assistant', content: 'It hurts here.' }] });
        expect(onReply).toHaveBeenLastCalledWith('It hurts here.', { source: 'room3d' });
        rerender({ messages: [user, { role: 'assistant', content: 'It hurts here. Right in the middle.' }] });
        expect(onReply).toHaveBeenLastCalledWith('It hurts here. Right in the middle.', { source: 'room3d' });
    });

    it('captions a reply to a question typed in the chat room, telling the room who asked', () => {
        const onReply = vi.fn();
        const user = { role: 'user', content: 'Any allergies?', source: 'typed' };
        renderHook(() => useRoomConversation({
            conversation: bus({ messages: [user, { role: 'assistant', content: 'None that I know of.' }] }),
            onReply,
        }));
        expect(onReply).toHaveBeenLastCalledWith('None that I know of.', { source: 'typed' });
    });

    it('never captions an errored reply in the patient\'s voice', () => {
        const onReply = vi.fn();
        renderHook(() => useRoomConversation({
            conversation: bus({ messages: [
                { role: 'user', content: 'Hello?', source: 'room3d' },
                { role: 'assistant', content: 'Error: model unavailable', error: true },
            ] }),
            onReply,
        }));
        expect(onReply).toHaveBeenLastCalledWith(null, { source: 'room3d' });
    });

    it('stays silent on an empty utterance rather than sending one', async () => {
        const send = vi.fn();
        const { result } = renderHook(() => useRoomConversation({ conversation: bus({ send }), onReply: vi.fn() }));
        await act(async () => { await result.current.ask('   '); });
        expect(send).not.toHaveBeenCalled();
    });
});
