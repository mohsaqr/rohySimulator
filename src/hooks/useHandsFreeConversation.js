// Hands-free voice conversation with the patient (learner preference, off by
// default). Push-to-talk makes the learner open and close the mic for every
// turn; this hook makes the turn-taking implicit:
//
//   1. the learner's turn ends after END_OF_TURN_SILENCE_MS without a new
//      recognition result (a tap still ends it at once);
//   2. the mic reopens by itself once the patient's reply has finished;
//   3. while the patient speaks, the recogniser keeps running in a WATCH
//      role; when what it hears is not the patient's own text (echoFilter.js)
//      the learner is interrupting: the patient stops and that same
//      recogniser becomes the learner's turn (barge-in).
//
// ONE CAPTURE ONLY: the recogniser. A getUserMedia/AudioContext detector for
// barge-in (tried 2026-11-01) left Chrome's SpeechRecognition deaf on macOS —
// evidence in echoFilter.js. Do not add a second microphone here.
//
// Decisions live in the pure reducer (handsFreeTurns.js). This hook runs its
// effects: the silence timer, the recogniser (through the caller's `listen`)
// and the send.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    END_OF_TURN_SILENCE_MS,
    WATCH_STALL_MS,
    MAX_EMPTY_AUTO_TURNS,
    initialHandsFreeState,
    reduceHandsFree,
    handsFreeStatus,
    currentTurnText,
} from './handsFreeTurns';

/**
 * @param {object} opts
 * @param {boolean} opts.enabled   all conditions hold: pref on, voice mode, patient tab, case running
 * @param {boolean} opts.loading   a patient turn is in flight
 * @param {boolean} opts.speaking  the patient's voice is playing
 * @param {(h: {gesture: boolean, watch: boolean, isWatching: () => boolean, onResult: Function, onError: Function, onEnd: Function}) => void} opts.listen
 *        start the recogniser; onResult({final, interim}), onError(code), onEnd(final).
 *        `watch` = started to watch the patient's reply (no UI, no toasts);
 *        `isWatching()` = still in that role (it switches on an interruption).
 * @param {() => void} opts.stopListening  stop the recogniser (its onEnd still fires)
 * @param {() => void} opts.cancelSpeech   silence the patient now
 * @param {(text: string) => Promise<void>} opts.send  resolves when the reply has finished (spoken or not)
 * @param {() => string} [opts.getSpokenText]  the text the patient is speaking now (echo reference)
 * @param {(text: string) => void} [opts.onTranscript]  the learner's words so far in a listening turn
 * @param {() => void} [opts.onPaused]     fallback to tap-to-talk after repeated empty turns
 */
export function useHandsFreeConversation({
    enabled,
    loading,
    speaking,
    listen,
    stopListening,
    cancelSpeech,
    send,
    getSpokenText,
    onTranscript,
    onPaused,
    silenceMs = END_OF_TURN_SILENCE_MS,
    maxEmptyTurns = MAX_EMPTY_AUTO_TURNS,
}) {
    const [phase, setPhase] = useState(initialHandsFreeState.phase);
    const stateRef = useRef(initialHandsFreeState);
    const silenceTimerRef = useRef(null);
    const watchTimerRef = useRef(null);
    const pendingSendRef = useRef(null);
    const loadingRef = useRef(loading);
    const dispatchRef = useRef(null);

    // Latest callbacks and props. Written in an effect (declared first, so it
    // runs before the others) so a render React discards never leaves its
    // closures behind; every reader runs after commit.
    const cbRef = useRef({});
    useEffect(() => {
        cbRef.current = { listen, stopListening, cancelSpeech, send, getSpokenText, onTranscript, onPaused };
        loadingRef.current = loading;
    });

    const deliver = useCallback((text, reply) => {
        if (loadingRef.current) {
            // Another turn is still streaming (e.g. the learner barged in
            // before the reply text finished): send once it is done, never
            // drop the learner's words on the in-flight guard.
            pendingSendRef.current = { text, reply };
            return;
        }
        pendingSendRef.current = null;
        let done;
        try {
            done = Promise.resolve(cbRef.current.send?.(text));
        } catch (err) {
            done = Promise.reject(err);
        }
        done.catch((err) => console.warn('[hands-free] send failed:', err?.message || err))
            .finally(() => dispatchRef.current?.({ type: 'SEND_DONE', reply }));
    }, []);

    const runEffect = useCallback((effect, state) => {
        const cbs = cbRef.current;
        switch (effect.type) {
            case 'listen':
            case 'watch': {
                clearTimeout(watchTimerRef.current);
                const turn = state.turn;
                const d = dispatchRef.current;
                cbs.listen?.({
                    gesture: effect.gesture === true,
                    watch: effect.type === 'watch',
                    isWatching: () => stateRef.current.turn === turn && stateRef.current.watching,
                    onResult: ({ final = '', interim = '' } = {}) => {
                        if (stateRef.current.turn !== turn) return;
                        clearTimeout(watchTimerRef.current);
                        d({ type: 'RESULT', turn, final, interim, patientText: cbRef.current.getSpokenText?.() || '' });
                        const now = stateRef.current;
                        // Continuous Chrome recognition can go quiet after a
                        // final under TTS, without onend. Only recycle after
                        // a full quiet deadline; active interim speech keeps
                        // this recogniser and all the interruption's words.
                        if (now.turn === turn && now.watching && final.trim() && !interim.trim()) {
                            watchTimerRef.current = setTimeout(() => d({ type: 'WATCH_STALLED', turn }), WATCH_STALL_MS);
                        }
                        if (now.turn === turn && now.phase === 'listening') cbRef.current.onTranscript?.(currentTurnText(now));
                    },
                    onError: (code) => d({ type: 'STT_ERROR', turn, code }),
                    onEnd: (final) => {
                        // A stale end must not clear the replacement's timer.
                        if (stateRef.current.turn === turn) clearTimeout(watchTimerRef.current);
                        d({ type: 'RECOGNITION_END', turn, final: final || '', patientText: cbRef.current.getSpokenText?.() || '' });
                    },
                });
                break;
            }
            case 'stopListen':
                clearTimeout(watchTimerRef.current);
                cbs.stopListening?.();
                break;
            case 'cancelSpeech':
                cbs.cancelSpeech?.();
                break;
            case 'restartSilence': {
                clearTimeout(silenceTimerRef.current);
                const turn = state.turn;
                silenceTimerRef.current = setTimeout(
                    () => dispatchRef.current?.({ type: 'SILENCE_TIMEOUT', turn }),
                    silenceMs,
                );
                break;
            }
            case 'clearSilence':
                clearTimeout(watchTimerRef.current);
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
                break;
            case 'send':
                deliver(effect.text, effect.reply);
                break;
            case 'dropPendingSend':
                pendingSendRef.current = null;
                break;
            case 'notifyPaused':
                cbs.onPaused?.();
                break;
            default:
                break;
        }
    }, [deliver, silenceMs]);

    const dispatch = useCallback((event) => {
        const { state, effects } = reduceHandsFree(stateRef.current, event, { maxEmptyTurns });
        stateRef.current = state;
        setPhase(state.phase);
        for (const effect of effects) runEffect(effect, state);
    }, [runEffect, maxEmptyTurns]);
    useEffect(() => {
        dispatchRef.current = dispatch;
    }, [dispatch]);

    // Activation follows the caller's conditions; unmount is a disable too.
    useEffect(() => {
        dispatch({ type: enabled ? 'ENABLE' : 'DISABLE' });
    }, [enabled, dispatch]);
    useEffect(() => () => dispatchRef.current?.({ type: 'DISABLE' }), []);

    useEffect(() => {
        dispatch({ type: 'SPEAKING', value: Boolean(speaking) });
    }, [speaking, dispatch]);

    // Deferred send: deliver once the in-flight turn has finished.
    useEffect(() => {
        const pending = pendingSendRef.current;
        if (loading || !pending) return;
        if (pending.reply !== stateRef.current.reply) {
            pendingSendRef.current = null;
            return;
        }
        deliver(pending.text, pending.reply);
    }, [loading, deliver]);

    // Reopen the mic once the reply is over and nothing else is in flight.
    useEffect(() => {
        if (phase === 'reopening' && !loading && !speaking) dispatch({ type: 'REOPEN' });
    }, [phase, loading, speaking, dispatch]);

    const tap = useCallback(() => dispatch({ type: 'TAP' }), [dispatch]);

    return {
        active: phase !== 'off',
        phase,
        status: handsFreeStatus(phase, { loading }),
        tap,
    };
}
