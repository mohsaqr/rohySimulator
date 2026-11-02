// The push-to-talk mode of the one voice-conversation state machine
// (handsFreeTurns.js), and the switches every surface shares: mode changes,
// suspension by another surface, `interruptible`, auto-start, and the
// status / tap gate the buttons and the Space key read.

import { describe, it, expect } from 'vitest';
import {
    reduceHandsFree,
    initialHandsFreeState,
    voiceStatus,
    canTapVoice,
} from './handsFreeTurns';

const run = (events, state = initialHandsFreeState, opts = {}) => events.reduce(
    (acc, ev) => {
        const r = reduceHandsFree(acc.state, typeof ev === 'function' ? ev(acc.state) : ev, opts);
        return { state: r.state, effects: [...acc.effects, ...r.effects], last: r.effects };
    },
    { state, effects: [], last: [] },
);
const types = (effects) => effects.map(e => e.type);
const PTT = { type: 'ENABLE', mode: 'pushToTalk' };

describe('push-to-talk mode', () => {
    it('ENABLE carries the mode; a tap opens a gesture turn', () => {
        const r = run([PTT, { type: 'TAP' }]);
        expect(r.state.mode).toBe('pushToTalk');
        expect(r.state.phase).toBe('listening');
        expect(r.effects).toEqual([{ type: 'listen', gesture: true }]);
    });

    it('never runs a silence clock: results do not end the turn', () => {
        const base = run([PTT, { type: 'TAP' }]);
        const r = run([
            { type: 'RESULT', turn: base.state.turn, final: 'where does', interim: 'it hurt' },
            { type: 'SILENCE_TIMEOUT', turn: base.state.turn },
        ], base.state);
        expect(r.effects).toEqual([]);
        expect(r.state.phase).toBe('listening');
    });

    it('a second tap sends what was heard at once, final and interim, and stops the recogniser', () => {
        const base = run([PTT, { type: 'TAP' }]);
        const r = run([
            { type: 'RESULT', turn: base.state.turn, final: 'my chest', interim: 'hurts' },
            { type: 'TAP' },
        ], base.state);
        expect(types(r.last)).toEqual(['clearSilence', 'stopListen', 'send']);
        expect(r.last).toContainEqual({ type: 'send', text: 'my chest hurts', reply: 1 });
        // Chrome's late end is from a finished turn: nothing is sent twice.
        expect(reduceHandsFree(r.state, { type: 'RECOGNITION_END', turn: base.state.turn, final: 'my chest hurts' }).effects).toEqual([]);
    });

    it('a tap with nothing heard yet stops, and the end sends whatever the recogniser finalised', () => {
        const base = run([PTT, { type: 'TAP' }, { type: 'TAP' }]);
        expect(types(base.last)).toEqual(['clearSilence', 'stopListen']);
        const r = reduceHandsFree(base.state, { type: 'RECOGNITION_END', turn: base.state.turn, final: 'is there a hilar node' });
        expect(r.effects).toContainEqual({ type: 'send', text: 'is there a hilar node', reply: 1 });
    });

    it('an end with nothing heard goes idle, reports it once, and never restarts', () => {
        const base = run([PTT, { type: 'TAP' }]);
        const r = reduceHandsFree(base.state, { type: 'RECOGNITION_END', turn: base.state.turn, final: '' });
        expect(r.state.phase).toBe('idle');
        expect(types(r.effects)).toEqual(['clearSilence', 'notifyNoSpeech']);
    });

    it('an end after an STT error is not reported again as "nothing heard"', () => {
        const base = run([PTT, { type: 'TAP' }]);
        const r = run([
            { type: 'STT_ERROR', turn: base.state.turn, code: 'no-speech' },
            { type: 'RECOGNITION_END', turn: base.state.turn, final: '' },
        ], base.state);
        expect(types(r.effects)).not.toContain('notifyNoSpeech');
        expect(r.state.phase).toBe('idle');
    });

    it('a fatal error stops the turn with no restart', () => {
        const base = run([PTT, { type: 'TAP' }]);
        const r = reduceHandsFree(base.state, { type: 'STT_ERROR', turn: base.state.turn, code: 'not-allowed' });
        expect(r.state.phase).toBe('idle');
        expect(types(r.effects)).not.toContain('listen');
    });

    it('the reply plays with no watcher, and its end waits for the next tap (no reopen)', () => {
        const base = run([PTT, { type: 'TAP' }, (s) => ({ type: 'RECOGNITION_END', turn: s.turn, final: 'hello' })]);
        expect(base.state.phase).toBe('thinking');
        const speaking = reduceHandsFree(base.state, { type: 'SPEAKING', value: true });
        expect(speaking.effects).toEqual([]);
        expect(speaking.state.phase).toBe('speaking');
        expect(speaking.state.watching).toBe(false);
        const done = reduceHandsFree(speaking.state, { type: 'SEND_DONE', reply: base.state.reply });
        expect(done.state.phase).toBe('idle');
        expect(reduceHandsFree(done.state, { type: 'REOPEN' }).effects).toEqual([]);
    });

    it('a tap while the other side speaks silences it first, then listens', () => {
        const r = run([PTT, { type: 'TAP', speaking: true }]);
        expect(r.effects).toEqual([{ type: 'cancelSpeech' }, { type: 'listen', gesture: true }]);
    });

    it('a tap during the reply (thinking or speaking phase) interrupts it — push-to-talk has no reopen to wait for', () => {
        const thinking = run([PTT, { type: 'TAP' }, (s) => ({ type: 'RECOGNITION_END', turn: s.turn, final: 'hello' })]);
        const fromThinking = reduceHandsFree(thinking.state, { type: 'TAP' });
        expect(fromThinking.state.phase).toBe('listening');
        expect(types(fromThinking.effects)).toEqual(['listen']);
        const speaking = reduceHandsFree(thinking.state, { type: 'SPEAKING', value: true }).state;
        const fromSpeaking = reduceHandsFree(speaking, { type: 'TAP' });
        expect(types(fromSpeaking.effects)).toEqual(['cancelSpeech', 'listen']);
        // The interrupted reply settling later changes nothing.
        expect(reduceHandsFree(fromSpeaking.state, { type: 'SEND_DONE', reply: thinking.state.reply }).state.phase).toBe('listening');
    });
});

describe('interruptible: false (the debrief — the other side finishes its point)', () => {
    const opts = { interruptible: false };

    it('a tap while the other side speaks does nothing, in either mode', () => {
        expect(run([PTT, { type: 'TAP', speaking: true }], initialHandsFreeState, opts).effects).toEqual([]);
        expect(run([{ type: 'ENABLE' }, { type: 'TAP', speaking: true }], initialHandsFreeState, opts).effects).toEqual([]);
    });

    it('the other side starting to speak ends an open turn, so its voice is never recorded', () => {
        const base = run([PTT, { type: 'TAP' }], initialHandsFreeState, opts);
        const empty = reduceHandsFree(base.state, { type: 'SPEAKING', value: true }, opts);
        expect(types(empty.effects)).toEqual(['clearSilence', 'stopListen']);
        const heard = run([
            { type: 'RESULT', turn: base.state.turn, final: 'I think', interim: '' },
            { type: 'SPEAKING', value: true },
        ], base.state, opts);
        expect(heard.last).toContainEqual({ type: 'send', text: 'I think', reply: 1 });
    });

    it('hands-free still ends turns on a pause and reopens, but never watches the reply', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }, (s) => ({ type: 'RECOGNITION_END', turn: s.turn, final: 'hello' })], initialHandsFreeState, opts);
        const speaking = reduceHandsFree(base.state, { type: 'SPEAKING', value: true }, opts);
        expect(speaking.effects).toEqual([]);
        expect(speaking.state.watching).toBe(false);
        const reopen = run([{ type: 'SEND_DONE', reply: base.state.reply }, { type: 'REOPEN' }], speaking.state, opts);
        expect(reopen.last).toEqual([{ type: 'listen', gesture: false }]);
    });
});

describe('shared switches', () => {
    it('SET_MODE while a turn runs starts over: the recogniser stops and the late end sends nothing', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = reduceHandsFree(base.state, { type: 'SET_MODE', mode: 'pushToTalk' });
        expect(r.state).toMatchObject({ phase: 'idle', mode: 'pushToTalk' });
        expect(types(r.effects)).toEqual(['clearSilence', 'stopListen', 'dropPendingSend']);
        expect(reduceHandsFree(r.state, { type: 'RECOGNITION_END', turn: base.state.turn, final: 'half a' }).effects).toEqual([]);
    });

    it('SET_MODE while off only records the mode; the next ENABLE keeps it', () => {
        const off = reduceHandsFree(initialHandsFreeState, { type: 'SET_MODE', mode: 'pushToTalk' });
        expect(off.effects).toEqual([]);
        expect(reduceHandsFree(off.state, { type: 'ENABLE' }).state.mode).toBe('pushToTalk');
    });

    it('SUSPEND (another surface took the mic) stops, forgets the turn and waits for a tap', () => {
        const watching = run([{ type: 'ENABLE' }, { type: 'TAP' }, (s) => ({ type: 'RECOGNITION_END', turn: s.turn, final: 'hello' }), { type: 'SPEAKING', value: true }]);
        expect(watching.state.watching).toBe(true);
        const r = reduceHandsFree(watching.state, { type: 'SUSPEND' });
        expect(r.state.phase).toBe('idle');
        expect(types(r.effects)).toEqual(['clearSilence', 'stopListen', 'dropPendingSend']);
        // The reply it was waiting for can no longer reopen anything.
        expect(reduceHandsFree(r.state, { type: 'SEND_DONE', reply: watching.state.reply }).state.phase).toBe('idle');
        expect(reduceHandsFree(initialHandsFreeState, { type: 'SUSPEND' }).effects).toEqual([]);
    });

    it('AUTO_START opens an automatic (non-gesture) turn from idle only', () => {
        const r = run([{ type: 'ENABLE' }, { type: 'AUTO_START' }]);
        expect(r.effects).toEqual([{ type: 'listen', gesture: false }]);
        expect(reduceHandsFree(r.state, { type: 'AUTO_START' }).effects).toEqual([]);
    });

    it('status: hands-free follows the phase; push-to-talk follows what is happening', () => {
        expect(voiceStatus('off', { mode: 'pushToTalk' })).toBeNull();
        expect(voiceStatus('idle', { mode: 'pushToTalk', speaking: true })).toBe('speaking');
        expect(voiceStatus('idle', { mode: 'pushToTalk', loading: true })).toBe('thinking');
        expect(voiceStatus('listening', { mode: 'pushToTalk', speaking: true })).toBe('listening');
        expect(voiceStatus('idle', { mode: 'pushToTalk' })).toBe('idle');
        expect(voiceStatus('reopening', { mode: 'handsFree', loading: false })).toBe('listening');
    });

    it('the tap gate (button and Space alike)', () => {
        expect(canTapVoice({ phase: 'off' })).toBe(false);
        expect(canTapVoice({ phase: 'listening', loading: true, speaking: true, interruptible: false })).toBe(true);
        expect(canTapVoice({ phase: 'idle', mode: 'pushToTalk', loading: true })).toBe(false);
        expect(canTapVoice({ phase: 'idle', mode: 'pushToTalk', speaking: true, interruptible: false })).toBe(false);
        expect(canTapVoice({ phase: 'idle', mode: 'pushToTalk', speaking: true })).toBe(true);
        expect(canTapVoice({ phase: 'speaking', mode: 'handsFree', loading: true, speaking: true })).toBe(true);
        expect(canTapVoice({ phase: 'idle', mode: 'handsFree', loading: true })).toBe(false);
    });
});
