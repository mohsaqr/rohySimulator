// useVoiceConversation — the surface hook every voice surface uses (patient
// chat, on-call phone, debrief, Bedside room). VoiceService is mocked: the
// test plays the browser's recogniser through the startListening handlers.
// The turn decisions are covered in handsFreeTurns.test.js and
// voiceTurns.pushToTalk.test.js; the engine's timers in
// useVoiceConversation.engine.test.jsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const vs = vi.hoisted(() => ({ listens: [], order: [], supported: true }));
vi.mock('../services/voiceService', () => ({
    VoiceService: {
        isSttSupported: () => vs.supported,
        startListening: vi.fn((h) => { vs.order.push(`start:${h.purpose || 'turn'}`); vs.listens.push(h); }),
        stopListening: vi.fn(() => { vs.order.push('stop'); }),
    },
}));

import { VoiceService } from '../services/voiceService';
import { useVoiceConversation, useVoiceFocus, voiceFloorOwner, voiceFocusClaims, sttErrorKey } from './useVoiceConversation';
import { END_OF_TURN_SILENCE_MS } from './handsFreeTurns';

const last = () => vs.listens[vs.listens.length - 1];

function setup(overrides = {}) {
    const sends = [];
    const props = {
        enabled: true,
        mode: 'pushToTalk',
        lang: 'en-US',
        loading: false,
        speaking: false,
        send: vi.fn((text) => new Promise((resolve) => { sends.push({ text, resolve }); })),
        cancelSpeech: vi.fn(() => vs.order.push('cancel')),
        onTurnStart: vi.fn(() => vs.order.push('oyon')),
        onError: vi.fn(),
        onNoSpeech: vi.fn(),
        getSpokenText: () => 'It hurts here when I breathe in.',
        ...overrides,
    };
    const hook = renderHook((p) => useVoiceConversation(p), { initialProps: props });
    const rerender = (patch) => {
        Object.assign(props, patch);
        hook.rerender({ ...props });
    };
    return { hook, props, rerender, sends };
}

beforeEach(() => {
    vs.listens.length = 0;
    vs.order.length = 0;
    vs.supported = true;
    vi.clearAllMocks();
    vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('useVoiceConversation — push-to-talk', () => {
    it('tap opens the recogniser in the given language, measures the gesture turn first, tap again sends', async () => {
        const t = setup();
        expect(t.hook.result.current.status).toBe('idle');
        act(() => t.hook.result.current.tap());
        expect(vs.order).toEqual(['oyon', 'start:turn']);
        expect(last().lang).toBe('en-US');
        expect(last()).not.toHaveProperty('purpose');
        expect(t.hook.result.current.listening).toBe(true);

        act(() => last().onResult({ final: 'where does', interim: 'it hurt' }));
        expect(t.hook.result.current.interim).toBe('where does it hurt');
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 5); });
        expect(t.props.send).not.toHaveBeenCalled();

        act(() => t.hook.result.current.tap());
        expect(VoiceService.stopListening).toHaveBeenCalledTimes(1);
        expect(t.props.send).toHaveBeenCalledExactlyOnceWith('where does it hurt');
        expect(t.hook.result.current.listening).toBe(false);
        expect(t.hook.result.current.interim).toBe('');

        // The reply ends: no reopen in push-to-talk.
        await act(async () => t.sends[0].resolve());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        expect(t.hook.result.current.status).toBe('idle');
    });

    it('a tap while the other side speaks silences it before the mic opens', () => {
        const t = setup({ speaking: true });
        act(() => t.hook.result.current.tap());
        expect(vs.order).toEqual(['cancel', 'oyon', 'start:turn']);
    });

    it('not interruptible: the tap is refused while the other side speaks', () => {
        const t = setup({ speaking: true, interruptible: false });
        expect(t.hook.result.current.canTap).toBe(false);
        act(() => t.hook.result.current.tap());
        expect(VoiceService.startListening).not.toHaveBeenCalled();
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
    });

    it('a tap while a reply loads is refused (button and Space read the same gate)', () => {
        const t = setup({ loading: true });
        expect(t.hook.result.current.canTap).toBe(false);
        act(() => t.hook.result.current.tap());
        expect(VoiceService.startListening).not.toHaveBeenCalled();
    });

    it('reports a missing language or missing STT instead of opening anything', () => {
        const t = setup({ lang: null });
        act(() => t.hook.result.current.tap());
        expect(t.props.onError).toHaveBeenCalledWith('no-language');
        expect(VoiceService.startListening).not.toHaveBeenCalled();

        vs.supported = false;
        const u = setup();
        expect(u.hook.result.current.supported).toBe(false);
        expect(u.hook.result.current.canTap).toBe(false);
        act(() => u.hook.result.current.tap());
        expect(u.props.onError).toHaveBeenCalledWith('unsupported');
    });

    it('reports real STT errors once, never "aborted", and "nothing heard" only without an error', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => last().onError(new Error('aborted')));
        act(() => last().onEnd({ final: '' }));
        expect(t.props.onError).not.toHaveBeenCalled();

        act(() => t.hook.result.current.tap());
        act(() => last().onError(new Error('no-speech')));
        act(() => last().onEnd({ final: '' }));
        expect(t.props.onError).toHaveBeenCalledExactlyOnceWith('no-speech');
        expect(t.props.onNoSpeech).not.toHaveBeenCalled();

        act(() => t.hook.result.current.tap());
        act(() => last().onEnd({ final: '' }));
        expect(t.props.onNoSpeech).toHaveBeenCalledTimes(1);
        expect(VoiceService.startListening).toHaveBeenCalledTimes(3);
    });
});

describe('useVoiceConversation — hands-free', () => {
    it('no Oyon measurement, no toast for routine no-speech; a pause sends; the reply end reopens', async () => {
        const t = setup({ mode: 'handsFree' });
        act(() => t.hook.result.current.tap());
        expect(t.props.onTurnStart).not.toHaveBeenCalled();
        act(() => last().onError(new Error('no-speech')));
        expect(t.props.onError).not.toHaveBeenCalled();
        act(() => last().onEnd({ final: '' }));
        // An empty hands-free turn restarts by itself.
        expect(VoiceService.startListening).toHaveBeenCalledTimes(2);
        act(() => last().onResult({ final: '', interim: 'my chest hurts' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
        expect(t.props.send).toHaveBeenCalledExactlyOnceWith('my chest hurts');
        await act(async () => t.sends[0].resolve());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(3);
        expect(t.hook.result.current.status).toBe('listening');
    });

    it('autoStart opens the mic when the surface becomes ready, without a tap', () => {
        const t = setup({ mode: 'handsFree', autoStart: true, enabled: false });
        expect(VoiceService.startListening).not.toHaveBeenCalled();
        t.rerender({ enabled: true });
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        expect(t.props.onTurnStart).not.toHaveBeenCalled();
    });

    it('switching to push-to-talk mid-turn stops the recogniser and its late end sends nothing', () => {
        const t = setup({ mode: 'handsFree' });
        act(() => t.hook.result.current.tap());
        const rec = last();
        act(() => rec.onResult({ final: 'half a', interim: '' }));
        t.rerender({ mode: 'pushToTalk' });
        expect(VoiceService.stopListening).toHaveBeenCalledTimes(1);
        act(() => rec.onEnd({ final: 'half a sentence' }));
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(t.props.send).not.toHaveBeenCalled();
        expect(t.hook.result.current.mode).toBe('pushToTalk');
    });

    it('Regression lock: no hands-free path opens a second capture (getUserMedia / AudioContext)', async () => {
        // Regression lock: any echo-cancelled getUserMedia capture beside or between recogniser runs left Chrome's SpeechRecognition deaf on macOS (owner's live tests, 2026-11-01).
        const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
        const AudioContextSpy = vi.fn();
        const had = Object.prototype.hasOwnProperty.call(globalThis.navigator, 'mediaDevices');
        const previous = globalThis.navigator.mediaDevices;
        Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
        vi.stubGlobal('AudioContext', AudioContextSpy);
        try {
            const t = setup({ mode: 'handsFree', autoStart: true, enabled: false });
            t.rerender({ enabled: true });
            act(() => last().onResult({ final: '', interim: 'where does it hurt' }));
            act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
            t.rerender({ loading: true, speaking: true });
            // The watcher hears the learner talk over the reply.
            act(() => last().onResult({ final: 'It hurts', interim: 'sorry doctor is it sharp' }));
            act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
            t.rerender({ loading: false, speaking: false });
            await act(async () => t.sends.forEach((s) => s.resolve()));
            t.hook.unmount();
            expect(VoiceService.startListening.mock.calls.some(([h]) => h.purpose === 'watch')).toBe(true);
            expect(t.props.onTurnStart).not.toHaveBeenCalled();
            expect(getUserMedia).not.toHaveBeenCalled();
            expect(AudioContextSpy).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            if (had) Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: previous });
            else delete globalThis.navigator.mediaDevices;
        }
    });
});

describe('one floor: two surfaces never share the recogniser', () => {
    it('the surface that starts listening suspends the other; the other\'s late end sends nothing and it does not restart', () => {
        const chat = setup({ mode: 'handsFree' });
        act(() => chat.hook.result.current.tap());
        const chatRec = last();
        act(() => chatRec.onResult({ final: 'where does', interim: '' }));

        const phone = setup({ mode: 'handsFree' });
        vs.order.length = 0;
        act(() => phone.hook.result.current.tap());
        // The chat's recogniser is stopped BEFORE the phone's starts.
        expect(vs.order).toEqual(['stop', 'start:turn']);
        expect(chat.hook.result.current.phase).toBe('idle');
        expect(phone.hook.result.current.listening).toBe(true);

        act(() => chatRec.onEnd({ final: 'where does it hurt' }));
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(chat.props.send).not.toHaveBeenCalled();
        expect(VoiceService.startListening).toHaveBeenCalledTimes(2);

        // The suspended surface takes the floor back with its own tap.
        act(() => chat.hook.result.current.tap());
        expect(phone.hook.result.current.phase).toBe('idle');
        expect(chat.hook.result.current.listening).toBe(true);
        chat.hook.unmount();
        phone.hook.unmount();
        expect(voiceFloorOwner()).toBeNull();
    });
});

describe('voice focus: a surface on top covers the conversations beneath it', () => {
    // Regression lock: hidden chat kept listening under the Bedside room / ringing phone — words said to the 3D patient or the phone were heard and sent to the chat patient.
    it('the chat underneath stops at once, sends nothing it heard, never reopens, ignores taps, and stays idle after the claim ends', async () => {
        const chat = setup({ mode: 'handsFree' });
        act(() => chat.hook.result.current.tap());
        const chatRec = last();
        act(() => chatRec.onResult({ final: '', interim: 'where does it' }));

        // The Bedside room / the call screen mounts on top.
        const room = renderHook(({ on }) => useVoiceFocus(on), { initialProps: { on: true } });
        expect(voiceFocusClaims()).toBe(1);
        expect(VoiceService.stopListening).toHaveBeenCalledTimes(1);
        expect(chat.hook.result.current.phase).toBe('idle');
        expect(chat.hook.result.current.covered).toBe(true);
        expect(chat.hook.result.current.canTap).toBe(false);

        // The pending silence commit and the recogniser's late words are dead.
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 5); });
        act(() => chatRec.onResult({ final: 'where does it hurt', interim: '' }));
        act(() => chatRec.onEnd({ final: 'where does it hurt' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 5); });
        expect(chat.props.send).not.toHaveBeenCalled();

        // A tap (button or Space) is refused while covered; nothing reopens.
        act(() => chat.hook.result.current.tap());
        chat.rerender({ speaking: true });
        chat.rerender({ speaking: false });
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);

        // A conversation created on top (the room's own mic) is not covered.
        const roomMic = setup({ mode: 'handsFree' });
        expect(roomMic.hook.result.current.covered).toBe(false);
        act(() => roomMic.hook.result.current.tap());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(2);
        roomMic.hook.unmount();

        // Leaving the room: the chat waits for its own tap.
        room.unmount();
        expect(voiceFocusClaims()).toBe(0);
        expect(chat.hook.result.current.covered).toBe(false);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(VoiceService.startListening).toHaveBeenCalledTimes(2);
        expect(chat.hook.result.current.phase).toBe('idle');
        act(() => chat.hook.result.current.tap());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(3);
        expect(chat.hook.result.current.listening).toBe(true);
        expect(chat.props.send).not.toHaveBeenCalled();
        chat.hook.unmount();
    });

    it('claimFocus on a conversation covers older ones, never itself, and blocks their auto-start', () => {
        const chat = setup({ mode: 'handsFree', autoStart: true, enabled: false });
        const phone = setup({ mode: 'pushToTalk', claimFocus: true });
        expect(phone.hook.result.current.covered).toBe(false);
        expect(chat.hook.result.current.covered).toBe(true);
        chat.rerender({ enabled: true });
        expect(VoiceService.startListening).not.toHaveBeenCalled();
        act(() => phone.hook.result.current.tap());
        expect(VoiceService.startListening).toHaveBeenCalledTimes(1);
        phone.hook.unmount();
        chat.hook.unmount();
    });
});

describe('sttErrorKey', () => {
    it('gives every surface the same wording, and none for a self-abort', () => {
        expect(sttErrorKey('not-allowed')).toBe('mic_blocked');
        expect(sttErrorKey('service-not-allowed')).toBe('mic_blocked');
        expect(sttErrorKey('network')).toBe('stt_network_error');
        expect(sttErrorKey('audio-capture')).toBe('no_microphone');
        expect(sttErrorKey('no-speech')).toBe('no_speech_heard');
        expect(sttErrorKey('unsupported')).toBe('stt_not_supported_browser');
        expect(sttErrorKey('no-language')).toBe('no_stt_language');
        expect(sttErrorKey('weird')).toBe('stt_error');
        expect(sttErrorKey('aborted')).toBeNull();
    });
});
