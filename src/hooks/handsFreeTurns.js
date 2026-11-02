// Turn-taking state machine for every voice conversation in Rohy (the
// patient chat, the on-call phone, the debrief, the Bedside room). Pure:
// `reduceHandsFree(state, event)` returns the next state and the list of
// effects the caller must run, in order. The hook (useVoiceConversation)
// owns the timers and the recogniser; this file owns every decision.
//
// TWO MODES, one machine (`state.mode`):
//   handsFree   the turn ends on a pause, the mic reopens after the reply,
//               and the learner can talk over the other side (barge-in).
//   pushToTalk  tap to start, tap to end and send. No silence commit, no
//               reopen, no watcher. A tap while the other side speaks
//               silences it first (when the surface is `interruptible`).
// `interruptible` (a reducer option, per surface) says whether the learner
// may cut the other side off at all — by a tap or, hands-free, by voice. The
// debrief says no: the discussant finishes its point.
//
// ONE CAPTURE ONLY. The Web Speech recogniser is the only microphone user.
// While the patient speaks it runs in a WATCH role and barge-in is decided
// from its text (echoFilter.js). A second capture for barge-in
// (getUserMedia + an energy VAD, tried 2026-11-01) left the recogniser deaf
// on macOS Chrome — see the header of echoFilter.js for the evidence.
//
// Phases
//   off        hands-free is not active (pref off, not voice mode, not the
//              patient tab, unmounted). Nothing automatic happens.
//   idle       active, waiting for the learner's first tap, or paused after
//              repeated empty turns / an STT error.
//   listening  the recogniser is running for the learner's `turn`.
//   thinking   a heard turn was sent; the reply is being generated.
//   speaking   the patient's reply is playing; the recogniser WATCHES
//              (`watching`). Nothing it hears is sent unless it is an
//              interruption, which switches the same recogniser to listening.
//   reopening  the reply finished; the hook reopens the mic as soon as
//              nothing is loading or speaking. The watcher may still run.
//
// Every recogniser callback carries the `turn` it was started for. Starting,
// stopping or restarting a recogniser bumps `turn`, so a late callback from
// a recogniser that was stopped (Chrome fires onend asynchronously) can never
// send a turn or restart the loop. An interruption does NOT bump it: the
// watcher simply becomes the learner's recogniser, opening words included.
// Each sent turn has its own `reply` id, so the end of an interrupted reply
// can never reopen the mic under a newer turn.

import { detectInterruption, learnerTurnText } from './echoFilter';

/** Silence after the last recognised word that ends the learner's turn. */
export const END_OF_TURN_SILENCE_MS = 900;
/** Recover Chrome's silent stall after a watch final, without restarting on every result. */
export const WATCH_STALL_MS = 900;
/** Consecutive empty auto-started turns before falling back to tap-to-talk. */
export const MAX_EMPTY_AUTO_TURNS = 3;
/**
 * Silent watcher restarts in a row without a single result before the
 * watcher gives up for this reply (tap-to-interrupt still works). Chrome ends
 * a recogniser that hears nothing after ~8 s, so a long reply legitimately
 * needs several; a recogniser that ends at once every time must not spin.
 */
export const MAX_WATCH_RESTARTS = 12;
/** STT errors that stop hands-free outright (no auto-restart). */
// 'unsupported' is raised by the caller when STT or its language is missing.
export const FATAL_STT_ERRORS = Object.freeze(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'unsupported']);

export const VOICE_MODES = Object.freeze(['pushToTalk', 'handsFree']);

export const initialHandsFreeState = Object.freeze({
    phase: 'off',
    mode: 'handsFree',
    turn: 0,
    reply: 0,
    emptyStreak: 0,
    lastFinal: '',
    lastInterim: '',
    heard: false,
    stopRequested: false,
    watching: false,
    watchRestarts: 0,
    echoFinal: '',
    watchText: '',
    // Set when the turn began as an interruption: the patient's text and the
    // fixed final/interim echo boundary (see echoFilter.learnerTurnText).
    echo: null,
    // Push-to-talk: the recogniser reported an error this turn, so an empty
    // end is not ALSO reported as "nothing was heard".
    errored: false,
});

// The final/interim pair a finished turn is made of. Chrome normally
// finalises pending interim words when stop() is called, but not always —
// when the end-of-turn final is missing the last interim words seen, keep them.
function splitTurnText(endFinal, lastFinal, lastInterim) {
    const fin = (endFinal || '').trim();
    const last = String(lastFinal || '').trim();
    const interim = (lastInterim || '').trim();
    if (!fin) return { final: last, interim };
    if (interim && fin === last) return { final: fin, interim };
    // stop() sometimes finalises only the beginning of the pending interim.
    if (interim && fin.startsWith(last)) {
        const added = fin.slice(last.length).trim();
        if (added && interim.startsWith(added)) return { final: fin, interim: interim.slice(added.length).trim() };
    }
    return { final: fin, interim: '' };
}

/** The text of a finished turn (final plus any interim never finalised). */
export function pickTurnText(endFinal, lastFinal, lastInterim) {
    const { final, interim } = splitTurnText(endFinal, lastFinal, lastInterim);
    return [final, interim].filter(Boolean).join(' ');
}

// What the learner said in this turn: everything, or — when the turn began
// by talking over the patient — everything from their first own word.
function turnText(state, endFinal) {
    const { final, interim } = splitTurnText(endFinal, state.lastFinal, state.lastInterim);
    if (!state.echo) return [final, interim].filter(Boolean).join(' ').trim();
    return learnerTurnText({ final, interim, ...state.echo }).trim();
}

/** The learner's words so far in the current listening turn (for display). */
export function currentTurnText(state) {
    return state.phase === 'listening' ? turnText(state, '') : '';
}

const freshTurn = {
    lastFinal: '',
    lastInterim: '',
    heard: false,
    stopRequested: false,
    echoFinal: '',
    watchText: '',
    echo: null,
    errored: false,
};

function startListening(state, { gesture, resetStreak }) {
    // A running watcher is stopped first: its words were the patient's.
    const effects = state.watching ? [{ type: 'stopListen' }] : [];
    effects.push({ type: 'listen', gesture });
    return {
        state: {
            ...state,
            ...freshTurn,
            phase: 'listening',
            turn: state.turn + 1,
            emptyStreak: resetStreak ? 0 : state.emptyStreak,
            watching: false,
        },
        effects,
    };
}

function startWatching(state, { restarts }) {
    return {
        state: { ...state, ...freshTurn, turn: state.turn + 1, watching: true, watchRestarts: restarts },
        effects: [{ type: 'watch' }],
    };
}

// The watcher stops for good this reply; the phase is unchanged.
const stopWatching = (state) => ({ ...state, turn: state.turn + 1, watching: false });

const none = (state) => ({ state, effects: [] });

function commitTurn(state, text, stop = false) {
    const reply = state.reply + 1;
    return {
        // Invalidate callbacks BEFORE stop(): Chrome may end synchronously,
        // many seconds later, or never. None may send this turn twice.
        state: { ...state, phase: 'thinking', turn: state.turn + 1, reply, emptyStreak: 0, stopRequested: false, watching: false, echo: null },
        effects: [{ type: 'clearSilence' }, ...(stop ? [{ type: 'stopListen' }] : []), { type: 'send', text, reply }],
    };
}

// The learner ends a listening turn: send what was heard, or stop and let
// the recogniser's onEnd decide (it may still carry the last words).
function endTurnNow(state) {
    if (turnText(state, '')) return commitTurn(state, turnText(state, ''), true);
    return {
        state: { ...state, stopRequested: true },
        effects: [{ type: 'clearSilence' }, { type: 'stopListen' }],
    };
}

// A gesture turn that may have to silence the other side first.
function tapToListen(state, otherSpeaking) {
    const next = startListening(state, { gesture: true, resetStreak: true });
    return otherSpeaking ? { state: next.state, effects: [{ type: 'cancelSpeech' }, ...next.effects] } : next;
}

const isPushToTalk = (state) => state.mode === 'pushToTalk';

export function reduceHandsFree(state, event, { maxEmptyTurns = MAX_EMPTY_AUTO_TURNS, interruptible = true } = {}) {
    const stale = event.turn !== undefined && event.turn !== state.turn;
    const ptt = isPushToTalk(state);

    switch (event.type) {
        case 'ENABLE':
            if (state.phase !== 'off') return none(state);
            return {
                state: {
                    ...initialHandsFreeState,
                    mode: VOICE_MODES.includes(event.mode) ? event.mode : state.mode,
                    turn: state.turn + 1,
                    reply: state.reply,
                    phase: 'idle',
                },
                effects: [],
            };

        case 'DISABLE': {
            if (state.phase === 'off') return none(state);
            const effects = [{ type: 'clearSilence' }];
            if (state.phase === 'listening' || state.watching) effects.push({ type: 'stopListen' });
            effects.push({ type: 'dropPendingSend' });
            return { state: { ...initialHandsFreeState, mode: state.mode, turn: state.turn + 1, reply: state.reply + 1 }, effects };
        }

        case 'SUSPEND': {
            // Another conversation took the microphone (the phone over the
            // chat, the Bedside room over the hidden chat). Stop, forget the
            // turn in flight, and wait for this surface's next tap — never
            // fight the new owner with an automatic restart.
            if (state.phase === 'off') return none(state);
            const effects = [{ type: 'clearSilence' }];
            if (state.phase === 'listening' || state.watching) effects.push({ type: 'stopListen' });
            effects.push({ type: 'dropPendingSend' });
            return {
                state: { ...state, ...freshTurn, phase: 'idle', turn: state.turn + 1, reply: state.reply + 1, emptyStreak: 0, watching: false, watchRestarts: 0 },
                effects,
            };
        }

        case 'SET_MODE': {
            // Switching modes starts over: whatever was running stops and the
            // surface waits for a tap in the new mode. A turn half-spoken in
            // one mode is not finished under the other's rules.
            if (!VOICE_MODES.includes(event.mode) || event.mode === state.mode) return none(state);
            if (state.phase === 'off') return none({ ...state, mode: event.mode });
            const effects = [{ type: 'clearSilence' }];
            if (state.phase === 'listening' || state.watching) effects.push({ type: 'stopListen' });
            effects.push({ type: 'dropPendingSend' });
            return {
                state: { ...initialHandsFreeState, mode: event.mode, phase: 'idle', turn: state.turn + 1, reply: state.reply + 1 },
                effects,
            };
        }

        case 'AUTO_START':
            // The surface opens the mic by itself (a phone call that has just
            // connected, hands-free): an automatic turn, not a gesture.
            if (state.phase !== 'idle') return none(state);
            return startListening(state, { gesture: false, resetStreak: true });

        case 'TAP': {
            const otherSpeaking = event.speaking === true || state.phase === 'speaking';
            if (state.phase === 'listening') return endTurnNow(state);
            if (state.phase === 'off') return none(state);
            // Some surfaces let the other side finish (the debrief).
            if (otherSpeaking && !interruptible) return none(state);
            switch (state.phase) {
                case 'idle':
                    return tapToListen(state, otherSpeaking);
                case 'speaking':
                    // Tap-to-interrupt: a fresh gesture turn (the watcher, if
                    // any, is stopped — it only ever heard the patient).
                    return tapToListen(state, true);
                case 'thinking':
                case 'reopening':
                    // Push-to-talk has no automatic reopen to wait for: the
                    // learner may talk again once nothing is in flight (the
                    // hook does not pass a tap while a reply is loading).
                    return ptt ? tapToListen(state, otherSpeaking) : none(state);
                default:
                    return none(state);
            }
        }

        case 'RESULT': {
            if (stale) return none(state);
            if (state.watching) {
                const patientText = event.patientText || state.watchText;
                const d = detectInterruption({ final: event.final, interim: event.interim, patientText, echoFinal: state.echoFinal });
                if (!d.interrupt) {
                    // Keep the confirmed echo boundary, never a learner turn.
                    // It is discarded when reopening a fresh recogniser.
                    return {
                        state: {
                            ...state, lastFinal: event.final ?? '', lastInterim: event.interim ?? '', watchRestarts: 0,
                            watchText: patientText,
                            // A single novel word may be the START of an
                            // interruption. Never reclassify it as known echo
                            // just because the next word has not arrived yet.
                            echoFinal: d.novel.length ? state.echoFinal : (event.final ?? state.echoFinal),
                        },
                        effects: [],
                    };
                }
                // The learner is talking over the patient: silence the
                // patient and keep THIS recogniser — restarting it would
                // lose the words that made this an interruption.
                const effects = state.phase === 'speaking' ? [{ type: 'cancelSpeech' }] : [];
                effects.push({ type: 'restartSilence' });
                return {
                    state: {
                        ...state,
                        phase: 'listening',
                        watching: false,
                        watchRestarts: 0,
                        emptyStreak: 0,
                        lastFinal: event.final ?? '',
                        lastInterim: event.interim ?? '',
                        heard: true,
                        stopRequested: false,
                        echo: { patientText, cutFinal: d.cutFinal, cutTokens: d.cutTokens },
                    },
                    effects,
                };
            }
            if (state.phase !== 'listening') return none(state);
            const lastFinal = event.final ?? state.lastFinal;
            // An empty update with no new final must not erase words Chrome
            // never finalised. A growing final replaces the pending interim.
            const lastInterim = event.interim || (lastFinal === state.lastFinal ? state.lastInterim : '');
            const heardNow = Boolean(`${lastFinal}${lastInterim}`.trim());
            const next = { ...state, lastFinal, lastInterim, heard: state.heard || heardNow };
            // The silence clock only runs once something was heard, and every
            // new result (interim or final) restarts it. Push-to-talk has no
            // silence clock: the learner's tap ends the turn.
            return { state: next, effects: next.heard && !state.stopRequested && !ptt ? [{ type: 'restartSilence' }] : [] };
        }

        case 'SILENCE_TIMEOUT':
            if (stale || ptt || state.phase !== 'listening' || !state.heard) return none(state);
            // The deadline commits the text already heard, including interim.
            // Waiting for stop()'s onend caused 14 s delays and dropped turns.
            return commitTurn(state, turnText(state, ''), true);

        case 'WATCH_STALLED': {
            if (stale || !state.watching) return none(state);
            if (state.watchRestarts >= MAX_WATCH_RESTARTS) return { state: stopWatching(state), effects: [{ type: 'stopListen' }] };
            const next = startWatching(state, { restarts: state.watchRestarts + 1 });
            return { state: next.state, effects: [{ type: 'stopListen' }, ...next.effects] };
        }

        case 'RECOGNITION_END': {
            if (stale) return none(state);
            if (state.watching) {
                // onend can contain words that never arrived in onresult.
                const result = reduceHandsFree(state, {
                    type: 'RESULT', turn: state.turn,
                    ...splitTurnText(event.final, state.lastFinal, state.lastInterim),
                    patientText: event.patientText || '',
                });
                if (!result.state.watching) {
                    const committed = commitTurn(result.state, turnText(result.state, ''));
                    return { state: committed.state, effects: [...result.effects, ...committed.effects] };
                }
                // Chrome ended the watcher mid-reply (no-speech after ~8 s,
                // or a quiet onend). Restart it silently: this is not an
                // empty learner turn and nobody is told.
                if (state.watchRestarts >= MAX_WATCH_RESTARTS) return none(stopWatching(state));
                return startWatching(state, { restarts: state.watchRestarts + 1 });
            }
            if (state.phase !== 'listening') return none(state);
            const text = turnText(state, event.final);
            if (text) {
                return commitTurn(state, text);
            }
            if (ptt) {
                // Push-to-talk never restarts itself. An end with nothing
                // heard is reported once, unless an error already was.
                return {
                    state: { ...state, phase: 'idle', turn: state.turn + 1, stopRequested: false, echo: null },
                    effects: [{ type: 'clearSilence' }, ...(state.errored ? [] : [{ type: 'notifyNoSpeech' }])],
                };
            }
            if (state.stopRequested) {
                // The learner tapped to stop and said nothing: wait for them.
                return { state: { ...state, phase: 'idle', turn: state.turn + 1, stopRequested: false, echo: null }, effects: [{ type: 'clearSilence' }] };
            }
            const emptyStreak = state.emptyStreak + 1;
            if (emptyStreak >= maxEmptyTurns) {
                return {
                    state: { ...state, phase: 'idle', turn: state.turn + 1, emptyStreak, echo: null },
                    effects: [{ type: 'clearSilence' }, { type: 'notifyPaused' }],
                };
            }
            const next = startListening({ ...state, emptyStreak }, { gesture: false, resetStreak: false });
            return { state: next.state, effects: [{ type: 'clearSilence' }, ...next.effects] };
        }

        case 'STT_ERROR': {
            if (stale) return none(state);
            if (state.watching) {
                // Watching is best-effort and silent. A blocked or missing
                // mic, or another surface taking the recogniser ('aborted'):
                // stop watching for this reply; the reopen will surface a
                // real problem. Anything else ('no-speech'): onEnd follows
                // and restarts the watcher.
                if (FATAL_STT_ERRORS.includes(event.code) || event.code === 'aborted') return none(stopWatching(state));
                return none(state);
            }
            if (state.phase !== 'listening') return none(state);
            if (FATAL_STT_ERRORS.includes(event.code)) {
                // Mic blocked / missing / offline: stop everything, no loop.
                return {
                    state: { ...state, phase: 'idle', turn: state.turn + 1, stopRequested: false, echo: null },
                    effects: [{ type: 'clearSilence' }],
                };
            }
            if (event.code === 'aborted') {
                // Someone else took the recogniser (another surface called
                // startListening). Never fight it with an auto-restart.
                return { state: { ...state, phase: 'idle', turn: state.turn + 1, stopRequested: false, echo: null }, effects: [{ type: 'clearSilence' }] };
            }
            // 'no-speech' and friends: onEnd follows and counts the empty turn
            // (push-to-talk: ends the turn, already reported).
            return ptt ? none({ ...state, errored: true }) : none(state);
        }

        case 'SPEAKING':
            if (!event.value) return none(state);
            // The reply starts playing: hands-free watches for the learner
            // talking over it — where the learner may interrupt at all.
            if (state.phase === 'thinking') {
                if (!ptt && interruptible) return startWatching({ ...state, phase: 'speaking' }, { restarts: 0 });
                return none({ ...state, phase: 'speaking' });
            }
            // Where the other side may not be interrupted, it starting to
            // speak ends an open turn, so the mic never records its voice.
            if (state.phase === 'listening' && !interruptible) return endTurnNow(state);
            return none(state);

        case 'SEND_DONE':
            if (event.reply !== state.reply || (state.phase !== 'thinking' && state.phase !== 'speaking')) return none(state);
            // Push-to-talk waits for the learner's next tap.
            return { state: { ...state, phase: ptt ? 'idle' : 'reopening' }, effects: [] };

        case 'REOPEN':
            // The reply is over and was not interrupted: the watcher (if
            // running) is stopped and a fresh recogniser listens, so nothing
            // it heard — the patient's own words — reaches the learner's turn.
            if (state.phase !== 'reopening') return none(state);
            return startListening(state, { gesture: false, resetStreak: false });

        default:
            return none(state);
    }
}

/**
 * What a voice control shows: 'idle' | 'listening' | 'thinking' | 'speaking',
 * or null when the conversation is off. Hands-free follows the phase;
 * push-to-talk follows what is actually happening (a reply may play that the
 * learner did not ask for, e.g. an alarm line or the debrief's opening).
 */
export function voiceStatus(phase, { mode = 'handsFree', loading = false, speaking = false } = {}) {
    if (phase === 'off') return null;
    if (mode !== 'pushToTalk') return handsFreeStatus(phase, { loading });
    if (phase === 'listening') return 'listening';
    if (speaking) return 'speaking';
    if (loading || phase === 'thinking') return 'thinking';
    return 'idle';
}

/**
 * Whether a tap does anything now — the button's enabled state and the gate
 * for keyboard taps (Space), so both behave the same.
 */
export function canTapVoice({ phase, mode = 'handsFree', loading = false, speaking = false, interruptible = true }) {
    if (phase === 'off') return false;
    if (phase === 'listening') return true;
    if (speaking && !interruptible) return false;
    if (mode === 'pushToTalk') return !loading;
    // Hands-free: a tap also interrupts a reply that is still streaming.
    if (loading && phase !== 'speaking') return false;
    return phase === 'idle' || phase === 'speaking';
}

/** What the voice controls show for a phase (null = no hands-free line). */
export function handsFreeStatus(phase, { loading = false } = {}) {
    switch (phase) {
        case 'listening': return 'listening';
        case 'speaking': return 'speaking';
        case 'thinking': return 'thinking';
        case 'reopening': return loading ? 'thinking' : 'listening';
        case 'idle': return 'idle';
        default: return null;
    }
}
