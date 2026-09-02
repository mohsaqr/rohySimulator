import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import {
    PatientConversationProvider,
    narrowConversation,
    usePatientConversation,
} from './PatientConversationContext.jsx';

const wrapper = ({ children }) => <PatientConversationProvider>{children}</PatientConversationProvider>;

describe('PatientConversationContext', () => {
    it('is inert without a provider: nothing to read, sending refuses', async () => {
        const { result } = renderHook(() => usePatientConversation());
        expect(result.current.available).toBe(false);
        expect(result.current.messages).toEqual([]);
        await expect(result.current.send('hello')).rejects.toThrow(/No patient conversation/);
        expect(narrowConversation(result.current)).toBeNull();
    });

    it('routes send through the registered handler with its meta', async () => {
        const { result } = renderHook(() => usePatientConversation(), { wrapper });
        const send = vi.fn(async (text, meta) => `${text}|${meta.source}`);
        let unregister;
        act(() => { unregister = result.current.register({ send }); });
        await expect(result.current.send('Where does it hurt?', { source: 'room3d', spoken: true }))
            .resolves.toBe('Where does it hurt?|room3d');
        expect(send).toHaveBeenCalledWith('Where does it hurt?', { source: 'room3d', spoken: true });
        act(() => { unregister(); });
        await expect(result.current.send('again')).rejects.toThrow(/No patient conversation/);
    });

    it('publishes the transcript and turn state to every consumer', () => {
        const seen = [];
        function Publisher() {
            // `publish` is stable; keying on the whole bus would re-publish a
            // fresh array on every change it caused and never settle.
            const { publish } = usePatientConversation();
            useEffect(() => {
                publish({ messages: [{ role: 'user', content: 'hi' }], loading: true, sessionId: 7 });
            }, [publish]);
            return null;
        }
        function Reader() {
            const bus = usePatientConversation();
            seen.push({ n: bus.messages.length, loading: bus.loading, sessionId: bus.sessionId });
            return null;
        }
        render(<PatientConversationProvider><Publisher /><Reader /></PatientConversationProvider>);
        expect(seen.at(-1)).toEqual({ n: 1, loading: true, sessionId: 7 });
    });

    it('publishes whether the current reply is being voiced, unknown by default', () => {
        const seen = [];
        function Publisher({ voiced }) {
            const { publish } = usePatientConversation();
            useEffect(() => { publish({ voiced }); }, [publish, voiced]);
            return null;
        }
        function Reader() {
            seen.push(usePatientConversation().voiced);
            return null;
        }
        const view = render(<PatientConversationProvider><Reader /></PatientConversationProvider>);
        expect(seen.at(-1)).toBeNull();
        view.rerender(<PatientConversationProvider><Publisher voiced={false} /><Reader /></PatientConversationProvider>);
        expect(seen.at(-1)).toBe(false);
        view.rerender(<PatientConversationProvider><Publisher voiced={true} /><Reader /></PatientConversationProvider>);
        expect(seen.at(-1)).toBe(true);
    });

    it('narrows to send + read only: a plugin cannot replace the sender', () => {
        const { result } = renderHook(() => usePatientConversation(), { wrapper });
        const narrowed = narrowConversation(result.current);
        expect(Object.keys(narrowed).sort()).toEqual(['loading', 'messages', 'send', 'sessionId', 'voiced']);
        expect(narrowed.register).toBeUndefined();
        expect(narrowed.publish).toBeUndefined();
    });
});
