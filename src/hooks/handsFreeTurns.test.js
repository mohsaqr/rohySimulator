import { describe, it, expect } from 'vitest';
import {
    reduceHandsFree,
    initialHandsFreeState,
    pickTurnText,
    handsFreeStatus,
    currentTurnText,
    END_OF_TURN_SILENCE_MS,
    MAX_EMPTY_AUTO_TURNS,
    MAX_WATCH_RESTARTS,
} from './handsFreeTurns';

const PATIENT = 'I have had chest pain since yesterday morning.';

const run = (events, state = initialHandsFreeState) => events.reduce(
    (acc, ev) => {
        const r = reduceHandsFree(acc.state, typeof ev === 'function' ? ev(acc.state) : ev);
        return { state: r.state, effects: [...acc.effects, ...r.effects], last: r.effects };
    },
    { state, effects: [], last: [] },
);
const types = (effects) => effects.map(e => e.type);

describe('handsFreeTurns constants', () => {
    it('starts end-of-turn silence at 900 ms and caps empty auto turns at 3', () => {
        expect(END_OF_TURN_SILENCE_MS).toBe(900);
        expect(MAX_EMPTY_AUTO_TURNS).toBe(3);
    });
});

describe('pickTurnText', () => {
    it('uses the end-of-turn final', () => {
        expect(pickTurnText('my chest hurts', 'my chest hurts', '')).toBe('my chest hurts');
    });
    it('keeps interim words the recogniser never finalised', () => {
        expect(pickTurnText('my chest', 'my chest', 'hurts a lot')).toBe('my chest hurts a lot');
        expect(pickTurnText('', '', 'since yesterday')).toBe('since yesterday');
        // Regression lock: stop() may finalise only part of the pending interim.
        expect(pickTurnText('my chest hurts', 'my chest', 'hurts a lot')).toBe('my chest hurts a lot');
    });
    it('is empty for whitespace only', () => {
        expect(pickTurnText('  ', '', '   ')).toBe('');
    });
});

describe('reduceHandsFree', () => {
    it('ENABLE → idle; a tap listens as a gesture turn (no other capture)', () => {
        const { state, effects } = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        expect(state.phase).toBe('listening');
        expect(effects).toEqual([{ type: 'listen', gesture: true }]);
    });

    it('does nothing while off', () => {
        const { state, effects } = run([{ type: 'TAP' }, { type: 'RECOGNITION_END', final: 'hi' }, { type: 'REOPEN' }]);
        expect(state.phase).toBe('off');
        expect(effects).toEqual([]);
    });

    it('starts the silence clock only once something was heard, and restarts it per result', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const turn = base.state.turn;
        const empty = run([{ type: 'RESULT', turn, final: '', interim: '' }], base.state);
        expect(empty.effects).toEqual([]);
        const heard = run([
            { type: 'RESULT', turn, final: '', interim: 'my' },
            { type: 'RESULT', turn, final: '', interim: 'my chest' },
        ], base.state);
        expect(types(heard.effects)).toEqual(['restartSilence', 'restartSilence']);
    });

    // Regression lock: (a) silence sends immediately and invalidates delayed recogniser callbacks.
    it('silence commits the heard text once without waiting for the recogniser to end', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const turn = base.state.turn;
        const r = run([
            { type: 'RESULT', turn, final: '', interim: 'my chest hurts' },
            { type: 'SILENCE_TIMEOUT', turn },
            { type: 'RECOGNITION_END', turn, final: 'my chest hurts' },
            { type: 'RECOGNITION_END', turn, final: 'my chest hurts' },
        ], base.state);
        expect(types(r.effects)).toEqual(['restartSilence', 'clearSilence', 'stopListen', 'send']);
        expect(r.effects.filter(e => e.type === 'send')).toEqual([{ type: 'send', text: 'my chest hurts', reply: 1 }]);
        expect(r.state.phase).toBe('thinking');
    });

    it('never sends an empty or whitespace turn', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = run([{ type: 'RECOGNITION_END', turn: base.state.turn, final: '   ' }], base.state);
        expect(types(r.effects)).not.toContain('send');
    });

    // Regression lock: an empty final update must not erase unfinalised interim words at the silence deadline.
    it('sends an interim-only turn even after an empty result', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const turn = base.state.turn;
        const r = run([
            { type: 'RESULT', turn, final: '', interim: 'please explain that again' },
            { type: 'RESULT', turn, final: '', interim: '' },
            { type: 'SILENCE_TIMEOUT', turn },
        ], base.state);
        expect(r.effects).toContainEqual({ type: 'send', text: 'please explain that again', reply: 1 });
    });

    it('ignores callbacks from a stale recogniser', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = run([{ type: 'RECOGNITION_END', turn: base.state.turn - 1, final: 'old words' }], base.state);
        expect(r.effects).toEqual([]);
        expect(r.state).toBe(base.state);
    });

    it('a tap while listening ends the turn now', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = run([{ type: 'TAP' }], base.state);
        expect(types(r.effects)).toEqual(['clearSilence', 'stopListen']);
        const end = run([{ type: 'RECOGNITION_END', turn: base.state.turn, final: 'hello' }], r.state);
        expect(end.effects).toContainEqual({ type: 'send', text: 'hello', reply: 1 });
    });

    it('a tap that ends an empty turn waits for the learner instead of restarting', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }, { type: 'TAP' }]);
        const r = run([{ type: 'RECOGNITION_END', turn: base.state.turn, final: '' }], base.state);
        expect(r.state.phase).toBe('idle');
        expect(types(r.effects)).not.toContain('listen');
    });

    it('restarts an empty auto turn, and after 3 in a row falls back to tap-to-talk with a notice', () => {
        let s = run([{ type: 'ENABLE' }, { type: 'TAP' }]).state;
        const listens = [];
        let notices = 0;
        for (let i = 0; i < MAX_EMPTY_AUTO_TURNS; i += 1) {
            const r = reduceHandsFree(s, { type: 'RECOGNITION_END', turn: s.turn, final: '' });
            s = r.state;
            listens.push(r.effects.filter(e => e.type === 'listen').length);
            notices += r.effects.filter(e => e.type === 'notifyPaused').length;
        }
        expect(listens).toEqual([1, 1, 0]);
        expect(notices).toBe(1);
        expect(s.phase).toBe('idle');
    });

    it('a heard turn resets the empty streak', () => {
        let s = run([{ type: 'ENABLE' }, { type: 'TAP' }]).state;
        s = reduceHandsFree(s, { type: 'RECOGNITION_END', turn: s.turn, final: '' }).state;
        expect(s.emptyStreak).toBe(1);
        s = reduceHandsFree(s, { type: 'RECOGNITION_END', turn: s.turn, final: 'hello' }).state;
        expect(s.emptyStreak).toBe(0);
    });

    // A heard turn, sent, with the reply now playing and the watcher on.
    const speakingState = () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        return run([
            { type: 'RECOGNITION_END', turn: base.state.turn, final: 'hello' },
            { type: 'SPEAKING', value: true },
        ], base.state);
    };

    it('the reply starting to play starts the recogniser in the watch role', () => {
        const r = speakingState();
        expect(r.state.phase).toBe('speaking');
        expect(r.state.watching).toBe(true);
        expect(r.last).toEqual([{ type: 'watch' }]);
    });

    it('reopens after an uninterrupted reply: the watcher is stopped and a fresh recogniser listens', () => {
        const s = speakingState().state;
        const echo = run([{ type: 'RESULT', turn: s.turn, final: 'I have had chest pain', interim: 'since', patientText: PATIENT }], s);
        expect(echo.effects).toEqual([]);
        const done = run([{ type: 'SEND_DONE', reply: s.reply }, { type: 'REOPEN' }], echo.state);
        expect(done.effects).toEqual([{ type: 'stopListen' }, { type: 'listen', gesture: false }]);
        expect(done.state.phase).toBe('listening');
        // Watcher text discarded: nothing heard in the new turn.
        expect(done.state.lastFinal).toBe('');
        expect(done.state.heard).toBe(false);
        // The stopped watcher's late end is stale.
        expect(reduceHandsFree(done.state, { type: 'RECOGNITION_END', turn: s.turn, final: 'I have had chest pain' }).effects).toEqual([]);
    });

    it('echo-only watch results retain an echo boundary but never interrupt or start the learner silence clock', () => {
        const s = speakingState().state;
        const r = run([
            { type: 'RESULT', turn: s.turn, final: '', interim: 'I have', patientText: PATIENT },
            { type: 'RESULT', turn: s.turn, final: 'I have had chest pane', interim: 'since yes terday', patientText: PATIENT },
        ], s);
        expect(r.effects).toEqual([]);
        expect(r.state.phase).toBe('speaking');
        expect(r.state.lastFinal).toBe('I have had chest pane');
        expect(r.state.heard).toBe(false);
    });

    it('novel words interrupt: cancel the patient once, keep the SAME recogniser, start the silence clock', () => {
        const s = speakingState().state;
        const r = run([{ type: 'RESULT', turn: s.turn, final: 'I have had chest pain', interim: 'since where exactly', patientText: PATIENT }], s);
        expect(r.effects).toEqual([{ type: 'cancelSpeech' }, { type: 'restartSilence' }]);
        expect(r.state.phase).toBe('listening');
        expect(r.state.turn).toBe(s.turn); // not restarted
        expect(currentTurnText(r.state)).toBe('where exactly');
        // The learner goes on; the silence ends the turn; the sent text starts at the first novel word.
        const end = run([
            { type: 'RESULT', turn: s.turn, final: 'I have had chest pain since where exactly', interim: 'does it hurt', patientText: PATIENT },
            { type: 'SILENCE_TIMEOUT', turn: s.turn },
            { type: 'RECOGNITION_END', turn: s.turn, final: 'I have had chest pain since where exactly does it hurt' },
        ], r.state);
        expect(end.effects.filter(e => e.type === 'cancelSpeech')).toEqual([]);
        expect(end.effects.filter(e => e.type === 'listen' || e.type === 'watch')).toEqual([]);
        expect(end.effects).toContainEqual({ type: 'send', text: 'where exactly does it hurt', reply: s.reply + 1 });
        expect(end.state.phase).toBe('thinking');
    });

    it('the interrupted reply ending later does not reopen under the new turn', () => {
        const s = speakingState().state;
        const r = run([
            { type: 'RESULT', turn: s.turn, final: '', interim: 'wait doctor', patientText: PATIENT },
            { type: 'RECOGNITION_END', turn: s.turn, final: 'wait doctor' },
        ], s);
        expect(r.state.phase).toBe('thinking');
        const late = reduceHandsFree(r.state, { type: 'SEND_DONE', reply: s.reply });
        expect(late.state.phase).toBe('thinking');
        expect(reduceHandsFree(r.state, { type: 'SEND_DONE', reply: r.state.reply }).state.phase).toBe('reopening');
    });

    it('Chrome ending the watcher mid-reply restarts it silently, without counting an empty turn', () => {
        let s = speakingState().state;
        const streak = s.emptyStreak;
        const effects = [];
        for (let i = 0; i < MAX_EMPTY_AUTO_TURNS + 2; i += 1) {
            const e1 = reduceHandsFree(s, { type: 'STT_ERROR', turn: s.turn, code: 'no-speech' });
            const e2 = reduceHandsFree(e1.state, { type: 'RECOGNITION_END', turn: s.turn, final: '' });
            effects.push(...e1.effects, ...e2.effects);
            s = e2.state;
        }
        expect(types(effects)).toEqual(Array(MAX_EMPTY_AUTO_TURNS + 2).fill('watch'));
        expect(s.phase).toBe('speaking');
        expect(s.emptyStreak).toBe(streak);
        expect(types(effects)).not.toContain('notifyPaused');
    });

    it(`a watcher that ends at once every time gives up after ${MAX_WATCH_RESTARTS} restarts; a result resets the count`, () => {
        let s = speakingState().state;
        let watches = 0;
        for (let i = 0; i < MAX_WATCH_RESTARTS + 5; i += 1) {
            const r = reduceHandsFree(s, { type: 'RECOGNITION_END', turn: s.turn, final: '' });
            watches += r.effects.filter(e => e.type === 'watch').length;
            s = r.state;
        }
        expect(watches).toBe(MAX_WATCH_RESTARTS);
        expect(s.watching).toBe(false);
        expect(s.phase).toBe('speaking');

        let t = speakingState().state;
        t = reduceHandsFree(t, { type: 'RECOGNITION_END', turn: t.turn, final: '' }).state;
        expect(t.watchRestarts).toBe(1);
        t = reduceHandsFree(t, { type: 'RESULT', turn: t.turn, final: 'I have', interim: '', patientText: PATIENT }).state;
        expect(t.watchRestarts).toBe(0);
    });

    it('a watcher error is silent: fatal or aborted stops watching only; the reopen still happens', () => {
        for (const code of ['not-allowed', 'aborted', 'network']) {
            const s = speakingState().state;
            const r = reduceHandsFree(s, { type: 'STT_ERROR', turn: s.turn, code });
            expect(r.effects).toEqual([]);
            expect(r.state.phase).toBe('speaking');
            expect(r.state.watching).toBe(false);
            const done = run([{ type: 'SEND_DONE', reply: s.reply }, { type: 'REOPEN' }], r.state);
            expect(done.effects).toEqual([{ type: 'listen', gesture: false }]);
        }
    });

    it('a tap while the patient speaks interrupts: cancel, stop the watcher, fresh gesture turn', () => {
        const s = speakingState().state;
        const r = reduceHandsFree(s, { type: 'TAP' });
        expect(r.effects).toEqual([{ type: 'cancelSpeech' }, { type: 'stopListen' }, { type: 'listen', gesture: true }]);
        expect(r.state.phase).toBe('listening');
        expect(r.state.watching).toBe(false);
    });

    it('a text-only reply (no speech) reopens without a watcher', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = run([
            { type: 'RECOGNITION_END', turn: base.state.turn, final: 'hello' },
            { type: 'SEND_DONE', reply: 1 },
            { type: 'REOPEN' },
        ], base.state);
        expect(types(r.effects)).toEqual(['clearSilence', 'send', 'listen']);
    });

    it('a fatal STT error stops everything, with no restart', () => {
        for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network']) {
            const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
            const turn = base.state.turn;
            const r = run([
                { type: 'STT_ERROR', turn, code },
                { type: 'RECOGNITION_END', turn, final: '' },
            ], base.state);
            expect(types(r.effects)).toEqual(['clearSilence']);
            expect(r.state.phase).toBe('idle');
        }
    });

    it('no-speech is not fatal: the end that follows counts as an empty turn', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const turn = base.state.turn;
        const r = run([{ type: 'STT_ERROR', turn, code: 'no-speech' }, { type: 'RECOGNITION_END', turn, final: '' }], base.state);
        expect(types(r.effects)).toEqual(['clearSilence', 'listen']);
    });

    it('DISABLE while watching stops the watcher', () => {
        const s = speakingState().state;
        const r = reduceHandsFree(s, { type: 'DISABLE' });
        expect(types(r.effects)).toEqual(['clearSilence', 'stopListen', 'dropPendingSend']);
        expect(r.state.watching).toBe(false);
    });

    it('DISABLE while listening stops the recogniser', () => {
        const base = run([{ type: 'ENABLE' }, { type: 'TAP' }]);
        const r = reduceHandsFree(base.state, { type: 'DISABLE' });
        expect(types(r.effects)).toEqual(['clearSilence', 'stopListen', 'dropPendingSend']);
        expect(r.state.phase).toBe('off');
        // The stopped recogniser's late end is ignored.
        expect(reduceHandsFree(r.state, { type: 'RECOGNITION_END', turn: base.state.turn, final: 'x' }).effects).toEqual([]);
    });

    it('maps phases to the visible status', () => {
        expect(handsFreeStatus('listening')).toBe('listening');
        expect(handsFreeStatus('speaking')).toBe('speaking');
        expect(handsFreeStatus('thinking')).toBe('thinking');
        expect(handsFreeStatus('reopening', { loading: true })).toBe('thinking');
        expect(handsFreeStatus('off')).toBeNull();
    });
});
