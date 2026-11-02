import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTurnEngine } from './useVoiceConversation';
import { END_OF_TURN_SILENCE_MS, MAX_EMPTY_AUTO_TURNS } from './handsFreeTurns';

const PATIENT = 'I have had chest pain since yesterday morning. It gets worse on the stairs.';

// A fake recogniser driver: each listen() records its handlers; tests play
// the browser's part by calling them.
function setup(overrides = {}) {
    const order = [];
    const listens = [];
    const sends = [];
    const transcripts = [];
    const props = {
        enabled: true,
        loading: false,
        speaking: false,
        listen: vi.fn((h) => { order.push(`${h.watch ? 'watch' : 'listen'}:${h.gesture ? 'gesture' : 'auto'}`); listens.push(h); }),
        stopListening: vi.fn(() => order.push('stop')),
        cancelSpeech: vi.fn(() => order.push('cancel')),
        send: vi.fn((text) => new Promise((resolve) => { sends.push({ text, resolve }); })),
        getSpokenText: vi.fn(() => PATIENT),
        onTranscript: vi.fn((text) => transcripts.push(text)),
        onPaused: vi.fn(),
        ...overrides,
    };
    const hook = renderHook((p) => useTurnEngine(p), { initialProps: props });
    const rerender = (patch) => {
        Object.assign(props, patch);
        hook.rerender({ ...props });
    };
    const last = () => listens[listens.length - 1];
    return { hook, props, rerender, listens, sends, order, last, transcripts };
}

// Tap, say "hello", the reply starts streaming and playing: the watcher runs.
function toSpeaking(t) {
    act(() => t.hook.result.current.tap());
    act(() => t.last().onEnd('hello'));
    t.rerender({ loading: true, speaking: true });
}

describe('useTurnEngine (hands-free mode)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a tap starts listening (gesture turn)', () => {
        const t = setup();
        expect(t.hook.result.current.status).toBe('idle');
        act(() => t.hook.result.current.tap());
        expect(t.props.listen).toHaveBeenCalledTimes(1);
        expect(t.last().gesture).toBe(true);
        expect(t.last().watch).toBe(false);
        expect(t.hook.result.current.status).toBe('listening');
    });

    it(`ends the turn after ${END_OF_TURN_SILENCE_MS} ms of silence and sends once`, async () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onResult({ final: '', interim: 'my chest' }));
        act(() => { vi.advanceTimersByTime(600); });
        act(() => t.last().onResult({ final: '', interim: 'my chest hurts' }));
        expect(t.transcripts[t.transcripts.length - 1]).toBe('my chest hurts');
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS - 1); });
        expect(t.props.stopListening).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
        // Chrome finalises on stop() and fires onend.
        act(() => t.last().onEnd('my chest hurts'));
        expect(t.props.send).toHaveBeenCalledTimes(1);
        expect(t.props.send).toHaveBeenCalledWith('my chest hurts');
        expect(t.hook.result.current.status).toBe('thinking');
        act(() => { vi.advanceTimersByTime(5000); });
        expect(t.props.send).toHaveBeenCalledTimes(1);
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
    });

    it('never runs the silence clock or sends before anything was heard', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onResult({ final: '', interim: '   ' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 5); });
        expect(t.props.stopListening).not.toHaveBeenCalled();
        act(() => t.last().onEnd(''));
        expect(t.props.send).not.toHaveBeenCalled();
    });

    // Regression lock: (a) a final-only result sends at 900 ms even if Chrome delays onend by 14 seconds.
    it('commits a final-only turn on silence, ignoring the delayed end', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        const rec = t.last();
        act(() => rec.onResult({ final: 'does the pain radiate', interim: '' }));
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.props.send).toHaveBeenCalledExactlyOnceWith('does the pain radiate');
        act(() => vi.advanceTimersByTime(14_000));
        act(() => rec.onEnd('does the pain radiate'));
        expect(t.props.send).toHaveBeenCalledTimes(1);
    });

    // Regression lock: (b) Chrome can stall after its first echo final without ever firing onend.
    it('recovers a stalled final-only watcher, then keeps the interruption on its replacement', () => {
        const t = setup();
        toSpeaking(t);
        const old = t.last();
        act(() => old.onResult({ final: "It's", interim: '' }));
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.listens).toHaveLength(3);
        expect(t.last().watch).toBe(true);
        act(() => old.onEnd("It's"));
        act(() => t.last().onResult({ final: '', interim: 'sorry doctor' }));
        expect(t.hook.result.current.phase).toBe('listening');
        t.rerender({ loading: false, speaking: false });
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.props.send).toHaveBeenLastCalledWith('sorry doctor');
    });

    // Regression lock: recovery must not introduce a restart gap while the watcher is still receiving interim speech.
    it('cancels the watch deadline on activity and ignores old results after recovery', () => {
        const t = setup();
        toSpeaking(t);
        const old = t.last();
        act(() => old.onResult({ final: 'I have', interim: '' }));
        act(() => vi.advanceTimersByTime(600));
        act(() => old.onResult({ final: 'I have', interim: 'had chest' }));
        act(() => vi.advanceTimersByTime(600));
        expect(t.listens).toHaveLength(2);
        act(() => old.onResult({ final: 'I have had chest pain', interim: '' }));
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        const current = t.last();
        expect(t.listens).toHaveLength(3);
        act(() => current.onResult({ final: 'I have', interim: '' }));
        act(() => old.onResult({ final: '', interim: 'sorry doctor' }));
        act(() => old.onEnd('I have had chest pain'));
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.listens).toHaveLength(4);
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
    });

    // Regression lock: an ending watcher may deliver the only final containing the learner's interruption.
    it('keeps learner words supplied only by the watcher onend', () => {
        const t = setup();
        toSpeaking(t);
        act(() => t.last().onEnd('I have had chest pain sorry doctor'));
        expect(t.props.cancelSpeech).toHaveBeenCalledTimes(1);
        t.rerender({ loading: false, speaking: false });
        expect(t.props.send).toHaveBeenLastCalledWith('sorry doctor');
    });

    // Regression lock: separate final events must not turn the learner's first novel word into confirmed echo.
    it('retains both interruption words when Chrome finalises them separately', () => {
        const t = setup();
        toSpeaking(t);
        const watcher = t.last();
        act(() => watcher.onResult({ final: 'I have had chest pain', interim: '' }));
        act(() => watcher.onResult({ final: 'I have had chest pain sorry', interim: '' }));
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
        act(() => watcher.onResult({ final: 'I have had chest pain sorry doctor', interim: '' }));
        expect(t.transcripts.at(-1)).toBe('sorry doctor');
        t.rerender({ loading: false, speaking: false });
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.props.send).toHaveBeenLastCalledWith('sorry doctor');
    });

    // Regression lock: (c) a reopened heard turn must send without onend, despite an old watcher's late callbacks.
    it('sends a reopened turn before navigation can discard it', async () => {
        const t = setup();
        toSpeaking(t);
        const watcher = t.last();
        t.rerender({ loading: false, speaking: false });
        await act(async () => t.sends[0].resolve());
        const learner = t.last();
        act(() => watcher.onEnd("It's"));
        act(() => learner.onResult({ final: 'where does it hurt?', interim: '' }));
        act(() => vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS));
        expect(t.props.send).toHaveBeenLastCalledWith('where does it hurt?');
        expect(t.props.send).toHaveBeenCalledTimes(2);
        t.rerender({ enabled: false });
        act(() => learner.onEnd('where does it hurt?'));
        expect(t.props.send).toHaveBeenCalledTimes(2);
    });

    it('a tap still ends the turn immediately and sends what was heard', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onResult({ final: 'I have a headache', interim: '' }));
        act(() => t.hook.result.current.tap());
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
        act(() => t.last().onEnd('I have a headache'));
        expect(t.props.send).toHaveBeenCalledWith('I have a headache');
        // The silence timer was cleared: no second stop.
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 2); });
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
    });

    it('while the patient speaks the recogniser watches; an uninterrupted reply discards what it heard and reopens fresh', async () => {
        const t = setup();
        toSpeaking(t);
        expect(t.hook.result.current.status).toBe('speaking');
        expect(t.props.listen).toHaveBeenCalledTimes(2);
        const watcher = t.last();
        expect(watcher.watch).toBe(true);
        expect(watcher.isWatching()).toBe(true);
        // The watcher hears the patient (echo), including a garbled word.
        act(() => watcher.onResult({ final: 'I have had chest pane', interim: 'since yes terday' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 3); });
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
        expect(t.props.send).toHaveBeenCalledTimes(1);
        expect(t.transcripts).toEqual([]); // the echo never reaches the composer
        // The reply finishes.
        t.rerender({ loading: false });
        await act(async () => { t.sends[0].resolve(); });
        expect(t.props.listen).toHaveBeenCalledTimes(2); // still playing
        t.order.length = 0;
        t.rerender({ speaking: false });
        expect(t.order).toEqual(['stop', 'listen:auto']);
        expect(t.hook.result.current.status).toBe('listening');
        // The stopped watcher's late end (with the echo) sends nothing.
        act(() => watcher.onEnd('I have had chest pane since yes terday'));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 3); });
        expect(t.props.send).toHaveBeenCalledTimes(1);
        // The fresh recogniser's turn holds only the learner's words.
        act(() => t.last().onResult({ final: '', interim: 'thank you' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
        act(() => t.last().onEnd('thank you'));
        expect(t.props.send).toHaveBeenLastCalledWith('thank you');
    });

    it('barge-in: novel words cancel the patient once, keep the recogniser, and the turn starts at the first novel word', async () => {
        const t = setup();
        toSpeaking(t);
        const watcher = t.last();
        act(() => watcher.onResult({ final: 'I have had chest pain', interim: 'since' }));
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
        t.order.length = 0;
        act(() => watcher.onResult({ final: 'I have had chest pain', interim: 'since sorry doctor' }));
        expect(t.order).toEqual(['cancel']);
        expect(t.hook.result.current.status).toBe('listening');
        expect(watcher.isWatching()).toBe(false);
        expect(t.transcripts[t.transcripts.length - 1]).toBe('sorry doctor');
        t.rerender({ speaking: false });
        // More results: no second cancel, no new recogniser.
        act(() => watcher.onResult({ final: 'I have had chest pain since sorry doctor', interim: 'where is it' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
        act(() => watcher.onEnd('I have had chest pain since sorry doctor where is it'));
        expect(t.props.cancelSpeech).toHaveBeenCalledTimes(1);
        expect(t.props.listen).toHaveBeenCalledTimes(2);
        // Still streaming: the send waits for it, then goes.
        expect(t.props.send).toHaveBeenCalledTimes(1);
        t.rerender({ loading: false });
        expect(t.props.send).toHaveBeenCalledTimes(2);
        expect(t.props.send).toHaveBeenLastCalledWith('sorry doctor where is it');
        // The interrupted reply settling later does not start another turn.
        await act(async () => { t.sends[0].resolve(); });
        expect(t.props.listen).toHaveBeenCalledTimes(2);
        expect(t.hook.result.current.status).toBe('thinking');
    });

    it('no-speech while watching restarts the watcher silently and never counts as an empty turn', () => {
        const t = setup();
        toSpeaking(t);
        for (let i = 0; i < MAX_EMPTY_AUTO_TURNS + 2; i += 1) {
            act(() => t.last().onError('no-speech'));
            act(() => t.last().onEnd(''));
        }
        // 1 tap + 1 watch + 5 silent restarts, each a watcher.
        expect(t.props.listen).toHaveBeenCalledTimes(MAX_EMPTY_AUTO_TURNS + 4);
        expect(t.listens.slice(1).every((h) => h.watch)).toBe(true);
        expect(t.props.onPaused).not.toHaveBeenCalled();
        expect(t.hook.result.current.status).toBe('speaking');
    });

    it('tap while the patient speaks still interrupts at once (fresh gesture turn)', () => {
        const t = setup();
        toSpeaking(t);
        t.order.length = 0;
        act(() => t.hook.result.current.tap());
        expect(t.order).toEqual(['cancel', 'stop', 'listen:gesture']);
        expect(t.hook.result.current.status).toBe('listening');
    });

    it('reopens when a text-only reply arrives (no speech at all)', async () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onEnd('hello'));
        t.rerender({ loading: true });
        t.rerender({ loading: false });
        await act(async () => { t.sends[0].resolve(); });
        expect(t.props.listen).toHaveBeenCalledTimes(2);
        expect(t.last().watch).toBe(false);
    });

    it(`stops auto-restarting after ${MAX_EMPTY_AUTO_TURNS} empty turns and tells the learner`, () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        for (let i = 0; i < MAX_EMPTY_AUTO_TURNS; i += 1) {
            act(() => t.last().onError('no-speech'));
            act(() => t.last().onEnd(''));
        }
        // 1 tap + 2 automatic restarts, then nothing.
        expect(t.props.listen).toHaveBeenCalledTimes(MAX_EMPTY_AUTO_TURNS);
        expect(t.props.onPaused).toHaveBeenCalledTimes(1);
        expect(t.hook.result.current.status).toBe('idle');
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(t.props.listen).toHaveBeenCalledTimes(MAX_EMPTY_AUTO_TURNS);
        // A tap resumes.
        act(() => t.hook.result.current.tap());
        expect(t.props.listen).toHaveBeenCalledTimes(MAX_EMPTY_AUTO_TURNS + 1);
    });

    it('a fatal STT error stops everything', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onError('not-allowed'));
        act(() => t.last().onEnd(''));
        expect(t.props.listen).toHaveBeenCalledTimes(1);
        expect(t.hook.result.current.status).toBe('idle');
    });

    // `enabled` folds together the patient tab, voice mode and the preference.
    it('leaving the patient tab / voice mode / turning hands-free off: stops listening, ignores the late end', () => {
        const t = setup();
        act(() => t.hook.result.current.tap());
        act(() => t.last().onResult({ final: 'half a sent', interim: '' }));
        const h = t.last();
        t.rerender({ enabled: false });
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
        act(() => h.onEnd('half a sentence'));
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(t.props.send).not.toHaveBeenCalled();
        expect(t.props.listen).toHaveBeenCalledTimes(1);
        expect(t.hook.result.current.active).toBe(false);
    });

    it('unmount while watching stops the watcher', () => {
        const t = setup();
        toSpeaking(t);
        t.hook.unmount();
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
    });

    it('Regression lock: hands-free never opens a second microphone (getUserMedia / AudioContext)', () => {
        // Regression lock: any echo-cancelled getUserMedia capture beside or between recogniser runs left Chrome's SpeechRecognition deaf on macOS (owner's live tests, 2026-11-01).
        const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
        const AudioContextSpy = vi.fn();
        const hadMediaDevices = Object.prototype.hasOwnProperty.call(globalThis.navigator, 'mediaDevices');
        const previous = globalThis.navigator.mediaDevices;
        Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
        vi.stubGlobal('AudioContext', AudioContextSpy);
        try {
            const t = setup();
            toSpeaking(t);
            act(() => t.last().onResult({ final: '', interim: 'sorry doctor' }));
            act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
            act(() => t.last().onEnd('sorry doctor'));
            t.hook.unmount();
            expect(getUserMedia).not.toHaveBeenCalled();
            expect(AudioContextSpy).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            if (hadMediaDevices) Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: previous });
            else delete globalThis.navigator.mediaDevices;
        }
    });

    it('preference off: nothing automatic, a tap is not handled', () => {
        const t = setup({ enabled: false });
        expect(t.hook.result.current.active).toBe(false);
        expect(t.hook.result.current.status).toBeNull();
        act(() => t.hook.result.current.tap());
        t.rerender({ speaking: true, loading: true });
        t.rerender({ speaking: false, loading: false });
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(t.props.listen).not.toHaveBeenCalled();
        expect(t.props.send).not.toHaveBeenCalled();
    });
});

describe('useTurnEngine — speech it did not ask for (Codex review 2026-11-02)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    // Regression lock: the Bedside room's exam reaction, played while hands-free was listening, was transcribed and sent as the learner's words.
    it('a line played while the mic waits is watched, never sent, and the mic reopens after it', () => {
        const LINE = 'Ouch, that really hurts there.';
        const t = setup({ getSpokenText: vi.fn(() => LINE) });
        act(() => t.hook.result.current.tap());
        const learner = t.last();
        t.rerender({ speaking: true });
        expect(t.props.stopListening).toHaveBeenCalledTimes(1);
        const watcher = t.last();
        expect(watcher.watch).toBe(true);
        expect(t.hook.result.current.status).toBe('speaking');
        act(() => learner.onEnd(''));
        act(() => watcher.onResult({ final: 'ouch that really', interim: 'hurts there' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS * 3); });
        expect(t.props.send).not.toHaveBeenCalled();
        expect(t.props.cancelSpeech).not.toHaveBeenCalled();
        t.rerender({ speaking: false });
        expect(t.hook.result.current.phase).toBe('listening');
        const reopened = t.last();
        expect(reopened.watch).toBe(false);
        act(() => reopened.onResult({ final: 'can you sit up', interim: '' }));
        act(() => { vi.advanceTimersByTime(END_OF_TURN_SILENCE_MS); });
        expect(t.props.send).toHaveBeenCalledExactlyOnceWith('can you sit up');
    });
});
