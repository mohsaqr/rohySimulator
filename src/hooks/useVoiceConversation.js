// ONE voice-conversation engine for every surface that talks with someone:
// the patient chat, the on-call phone, the debrief discussant and the
// Bedside (3D) room. Before this, each surface carried its own copy of
// "start the recogniser, collect the words, send on end", and hands-free
// existed in the patient chat only — so the phone and the debrief could not
// do it, and two copies could open the recogniser at once.
//
// Two modes of the same machine (handsFreeTurns.js):
//   pushToTalk  tap to start, tap to end and send. A tap while the other side
//               speaks silences it first, where the surface allows that.
//   handsFree   1. the learner's turn ends after END_OF_TURN_SILENCE_MS
//                  without a new recognition result (a tap still ends it);
//               2. the mic reopens by itself once the reply has finished;
//               3. while the reply plays the recogniser keeps running in a
//                  WATCH role; when what it hears is not the other side's
//                  own text (echoFilter.js) the learner is interrupting: the
//                  speech stops and that same recogniser becomes the turn.
//
// ONE CAPTURE ONLY: the recogniser. A getUserMedia/AudioContext detector for
// barge-in (tried 2026-11-01) left Chrome's SpeechRecognition deaf on macOS —
// evidence in echoFilter.js. Do not add a second microphone here. (The
// surface's `onTurnStart` — Oyon's voice measurement in the patient chat —
// runs on push-to-talk gesture turns only, as it did before.)
//
// ONE FLOOR: the recogniser is a single browser resource. Whichever
// conversation starts listening takes the floor; any other one is suspended
// (back to waiting for its own tap), so the hidden chat under the phone or
// the Bedside room can never restart itself against them.
//
// FOCUS: a surface ON TOP (the on-call call screen from the moment it opens,
// ringing included; the Bedside room while it is mounted) claims voice
// focus with `useVoiceFocus` / `claimFocus`, AT ITS LAYER (VOICE_LAYERS:
// chat < room < phone). Every conversation on a lower layer — the chat that
// stays mounted, inert, underneath — is COVERED while the claim lasts: it
// stops listening at once, drops its silence commit and watcher, sends
// nothing it heard, never reopens, and ignores taps (button and Space).
// Releasing the claim does not resume it: it waits for its own tap. Without
// this a learner talking to the 3D patient or to a ringing phone was heard —
// and answered — by the hidden chat.
// Coverage is decided by LAYER, not by creation order (Codex review
// 2026-11-02): ordering by creation let a chat remounted under the Bedside
// room take the mic (it was "newer" than the room's claim), and let the
// Bedside room, entered during a call, suspend the phone that stays on top
// of it. Only on the SAME layer does order count: the most recent claim
// covers what that layer held before it.
//
// Layers: `useTurnEngine` runs the reducer's effects (timers, recogniser
// through an injected `listen`, the send). `useVoiceConversation` is what a
// surface uses: it drives VoiceService's recogniser for it, keeps the live
// transcript, and reports errors.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { VoiceService } from '../services/voiceService';
import {
    END_OF_TURN_SILENCE_MS,
    STOP_END_GRACE_MS,
    WATCH_STALL_MS,
    MAX_EMPTY_AUTO_TURNS,
    initialHandsFreeState,
    reduceHandsFree,
    voiceStatus,
    canTapVoice,
    currentTurnText,
} from './handsFreeTurns';

// ---- The floor ---------------------------------------------------------

const floor = { owner: null, suspenders: new Map() };

function claimFloor(id) {
    if (floor.owner && floor.owner !== id) floor.suspenders.get(floor.owner)?.();
    floor.owner = id;
}

function releaseFloor(id) {
    if (floor.owner === id) floor.owner = null;
}

/** Test-only: which conversation holds the recogniser. */
export function voiceFloorOwner() {
    return floor.owner;
}

// ---- Focus -------------------------------------------------------------

/**
 * Where a voice surface sits. Higher covers lower: the patient chat is the
 * floor, the Bedside room sits over it, the on-call phone (a modal reachable
 * from any room) over everything.
 */
export const VOICE_LAYERS = Object.freeze({ chat: 0, room: 1, phone: 2 });

function layerOf(layer) {
    if (typeof layer === 'number' && Number.isFinite(layer)) return layer;
    if (Object.prototype.hasOwnProperty.call(VOICE_LAYERS, layer)) return VOICE_LAYERS[layer];
    throw new TypeError(`unknown voice layer: ${String(layer)}`);
}

// Creation order, taken at RENDER time: a parent renders before its
// children, so a screen's claim is older than the conversations it
// contains. It only breaks ties on one layer.
let creationSeq = 0;
const focus = { claims: new Map(), listeners: new Set() };

function emitFocus() {
    focus.listeners.forEach((listener) => listener());
}

// Covered = a claim on a higher layer, or a newer claim on the same layer.
function isCovered(layer, seq) {
    for (const claim of focus.claims.values()) {
        if (claim.layer > layer || (claim.layer === layer && claim.seq > seq)) return true;
    }
    return false;
}

/**
 * Claim voice focus while `active` (a surface on top of others): every
 * voice conversation on a lower layer — and any created earlier on the same
 * layer — is suspended until the claim ends, and then waits for its own tap.
 * @param {boolean} [active=true]
 * @param {'chat'|'room'|'phone'|number} [layer='room']  where the claiming surface sits (VOICE_LAYERS)
 */
export function useVoiceFocus(active = true, layer = 'room') {
    const id = useId();
    const [seq] = useState(() => ++creationSeq);
    const level = layerOf(layer);
    useEffect(() => {
        if (!active) return undefined;
        focus.claims.set(id, { layer: level, seq });
        emitFocus();
        return () => {
            focus.claims.delete(id);
            emitFocus();
        };
    }, [active, id, seq, level]);
}

/** Test-only: how many focus claims are held. */
export function voiceFocusClaims() {
    return focus.claims.size;
}

// ---- The engine --------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.enabled   the surface can converse now (case running, call connected, …)
 * @param {'pushToTalk'|'handsFree'} [opts.mode='handsFree']
 * @param {boolean} [opts.interruptible=true]  the learner may cut the other side off (tap or voice)
 * @param {boolean} [opts.autoStart=false]     open the mic without a tap once it becomes possible (enabled,
 *        ready, nothing loading or speaking, not covered) — once per enable
 * @param {boolean} [opts.ready=true]          the recogniser can start (e.g. its language is known)
 * @param {'chat'|'room'|'phone'|number} [opts.layer='chat']  where this surface sits (VOICE_LAYERS)
 * @param {boolean} [opts.claimFocus=false]    this surface is on top: cover every lower conversation while mounted
 * @param {boolean} opts.loading   a reply is in flight
 * @param {boolean} opts.speaking  the other side's voice is playing
 * @param {(h: {gesture: boolean, watch: boolean, isWatching: () => boolean, onResult: Function, onError: Function, onEnd: Function}) => void} opts.listen
 *        start the recogniser; onResult({final, interim}), onError(code), onEnd(final).
 * @param {() => void} opts.stopListening  stop the recogniser (its onEnd still fires)
 * @param {() => void} [opts.cancelSpeech] silence the other side now
 * @param {(text: string) => Promise<void>} opts.send  resolves when the reply has finished (spoken or not)
 * @param {() => string} [opts.getSpokenText]  the text being spoken now (echo reference)
 * @param {(text: string) => void} [opts.onTranscript]  the learner's words so far in a listening turn
 * @param {() => void} [opts.onPaused]     hands-free fell back to tap-to-talk after repeated empty turns
 * @param {() => void} [opts.onNoSpeech]   push-to-talk: the turn ended with nothing heard and no error
 */
export function useTurnEngine({
    enabled,
    mode = 'handsFree',
    interruptible = true,
    autoStart = false,
    ready = true,
    layer = 'chat',
    claimFocus = false,
    loading,
    speaking,
    listen,
    stopListening,
    cancelSpeech,
    send,
    getSpokenText,
    onTranscript,
    onPaused,
    onNoSpeech,
    silenceMs = END_OF_TURN_SILENCE_MS,
    endGraceMs = STOP_END_GRACE_MS,
    maxEmptyTurns = MAX_EMPTY_AUTO_TURNS,
}) {
    // The claim is taken before this conversation's own creation number, so
    // a surface never covers itself.
    const level = layerOf(layer);
    useVoiceFocus(claimFocus, level);
    const [seq] = useState(() => ++creationSeq);
    const [covered, setCovered] = useState(() => isCovered(level, seq));
    const coveredRef = useRef(covered);
    const floorId = useId();
    const [phase, setPhase] = useState(initialHandsFreeState.phase);
    const [stateMode, setStateMode] = useState(mode);
    const stateRef = useRef(initialHandsFreeState);
    const silenceTimerRef = useRef(null);
    const watchTimerRef = useRef(null);
    const pendingSendRef = useRef(null);
    const loadingRef = useRef(loading);
    const speakingRef = useRef(speaking);
    const interruptibleRef = useRef(interruptible);
    const dispatchRef = useRef(null);

    // Latest callbacks and props. Written in an effect (declared first, so it
    // runs before the others) so a render React discards never leaves its
    // closures behind; every reader runs after commit.
    const cbRef = useRef({});
    useEffect(() => {
        cbRef.current = { listen, stopListening, cancelSpeech, send, getSpokenText, onTranscript, onPaused, onNoSpeech };
        loadingRef.current = loading;
        speakingRef.current = speaking;
        interruptibleRef.current = interruptible;
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
        done.catch((err) => console.warn('[voice] send failed:', err?.message || err))
            .finally(() => dispatchRef.current?.({ type: 'SEND_DONE', reply }));
    }, []);

    const runEffect = useCallback((effect, state) => {
        const cbs = cbRef.current;
        switch (effect.type) {
            case 'listen':
            case 'watch': {
                clearTimeout(watchTimerRef.current);
                // Taking the recogniser suspends whoever had it.
                claimFloor(floorId);
                const turn = state.turn;
                const d = dispatchRef.current;
                cbs.listen?.({
                    gesture: effect.gesture === true,
                    watch: effect.type === 'watch',
                    isWatching: () => stateRef.current.turn === turn && stateRef.current.watching,
                    isCurrent: () => stateRef.current.turn === turn,
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
            case 'awaitEnd': {
                // A tapped-off turn waits for the recogniser's end; this
                // deadline sends what was heard if it never comes. It shares
                // the silence timer, so clearSilence (every commit, suspend,
                // disable) cancels it.
                clearTimeout(silenceTimerRef.current);
                const turn = state.turn;
                silenceTimerRef.current = setTimeout(
                    () => dispatchRef.current?.({ type: 'END_TIMEOUT', turn }),
                    endGraceMs,
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
            case 'notifyNoSpeech':
                cbs.onNoSpeech?.();
                break;
            default:
                break;
        }
    }, [deliver, silenceMs, endGraceMs, floorId]);

    const dispatch = useCallback((event) => {
        // Covered by a surface on top: nothing may open the mic.
        if (coveredRef.current && (event.type === 'TAP' || event.type === 'AUTO_START' || event.type === 'REOPEN')) return;
        const { state, effects } = reduceHandsFree(stateRef.current, event, {
            maxEmptyTurns,
            interruptible: interruptibleRef.current,
        });
        stateRef.current = state;
        setPhase(state.phase);
        setStateMode(state.mode);
        if (state.phase === 'off') releaseFloor(floorId);
        for (const effect of effects) runEffect(effect, state);
    }, [runEffect, maxEmptyTurns, floorId]);
    useEffect(() => {
        dispatchRef.current = dispatch;
    }, [dispatch]);

    // A surface claiming focus on top suspends this one at once; its
    // release leaves it idle until its own tap.
    useEffect(() => {
        const check = () => {
            const now = isCovered(level, seq);
            const was = coveredRef.current;
            coveredRef.current = now;
            setCovered(now);
            if (now && !was) dispatchRef.current?.({ type: 'SUSPEND' });
        };
        focus.listeners.add(check);
        check();
        return () => { focus.listeners.delete(check); };
    }, [seq, level]);

    // Another conversation taking the recogniser suspends this one.
    useEffect(() => {
        floor.suspenders.set(floorId, () => dispatchRef.current?.({ type: 'SUSPEND' }));
        return () => {
            floor.suspenders.delete(floorId);
            releaseFloor(floorId);
        };
    }, [floorId]);

    // Activation follows the caller's conditions; unmount is a disable too.
    // The mode rides on ENABLE so the first turn already has it.
    const modeRef = useRef(mode);
    useEffect(() => { modeRef.current = mode; });
    useEffect(() => {
        dispatch(enabled ? { type: 'ENABLE', mode: modeRef.current } : { type: 'DISABLE' });
    }, [enabled, dispatch]);
    useEffect(() => () => dispatchRef.current?.({ type: 'DISABLE' }), []);

    useEffect(() => {
        dispatch({ type: 'SET_MODE', mode });
    }, [mode, dispatch]);

    useEffect(() => {
        dispatch({ type: 'SPEAKING', value: Boolean(speaking) });
    }, [speaking, dispatch]);

    // Hands-free surfaces that open the mic by themselves (a connected call).
    // Becoming enabled ARMS one automatic start; it fires as soon as it is
    // possible — the language known (`ready`), nothing loading or speaking,
    // not covered — and is then spent. A call that connects before the voice
    // settings arrive, or while a reply is still loading, used to skip its
    // start for good (Codex review 2026-11-02). Spent also means a learner
    // who tapped to stop is never reopened behind their back; being covered
    // disarms it (a released claim waits for a tap, like everywhere else).
    // Read through refs: the ENABLE above has just run in this same commit.
    const autoArmedRef = useRef(false);
    useEffect(() => {
        autoArmedRef.current = Boolean(enabled && autoStart);
    }, [enabled, autoStart]);
    useEffect(() => {
        if (!autoArmedRef.current) return;
        const now = stateRef.current.phase;
        if (now === 'off') return;
        if (covered || now !== 'idle') {
            // Covered, or the learner already took a turn: never auto-start.
            autoArmedRef.current = false;
            return;
        }
        if (!ready || loading || speaking) return;
        autoArmedRef.current = false;
        dispatch({ type: 'AUTO_START' });
    }, [enabled, autoStart, ready, loading, speaking, covered, phase, dispatch]);

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

    const tap = useCallback(() => {
        if (coveredRef.current) return;
        const s = stateRef.current;
        const allowed = canTapVoice({
            phase: s.phase,
            mode: s.mode,
            loading: loadingRef.current,
            speaking: speakingRef.current,
            interruptible: interruptibleRef.current,
        });
        if (!allowed) return;
        dispatch({ type: 'TAP', speaking: Boolean(speakingRef.current) });
    }, [dispatch]);

    return {
        active: phase !== 'off',
        phase,
        mode: stateMode,
        status: voiceStatus(phase, { mode: stateMode, loading, speaking }),
        canTap: !covered && canTapVoice({ phase, mode: stateMode, loading, speaking, interruptible }),
        covered,
        tap,
    };
}

// ---- The surface hook --------------------------------------------------

/**
 * A voice conversation on one surface. The surface says who it talks to and
 * how to send; the engine does the listening.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled          the surface can converse now
 * @param {'pushToTalk'|'handsFree'} opts.mode
 * @param {string|null} opts.lang          BCP-47 the learner speaks (null = not configured)
 * @param {boolean} opts.loading           a reply is in flight
 * @param {boolean} opts.speaking          the other side's voice is playing
 * @param {(text: string) => Promise<void>|void} opts.send   resolves when the reply has finished (or at once if nothing is spoken)
 * @param {() => void} [opts.cancelSpeech] silence the other side now
 * @param {() => string} [opts.getSpokenText]  what the other side is saying (hands-free echo rejection)
 * @param {boolean} [opts.interruptible=true]  the learner may cut the other side off
 * @param {boolean} [opts.autoStart=false]     open the mic without a tap when the surface becomes ready
 *        (waits for `lang` and for nothing to be loading or speaking)
 * @param {'chat'|'room'|'phone'|number} [opts.layer='chat']  where the surface sits (VOICE_LAYERS)
 * @param {boolean} [opts.claimFocus=false]    the surface sits on top of others (a call screen):
 *        every conversation on a lower layer is suspended while it is mounted
 * @param {() => void} [opts.onTurnStart]  a push-to-talk turn started from a gesture (Oyon voice measurement)
 * @param {(code: string) => void} [opts.onError]  a recogniser problem worth telling the learner
 *        ('not-allowed', 'network', 'unsupported', 'no-language', …; never 'aborted',
 *        never hands-free's routine 'no-speech')
 * @param {() => void} [opts.onNoSpeech]   push-to-talk ended with nothing heard
 * @param {() => void} [opts.onPaused]     hands-free paused after repeated empty turns
 * @param {(text: string) => void} [opts.onTranscript]  the learner's words so far
 * @returns {{active: boolean, mode: string, phase: string, status: string|null,
 *   listening: boolean, interim: string, canTap: boolean, covered: boolean,
 *   supported: boolean, tap: () => void}}
 */
export function useVoiceConversation({
    enabled,
    mode = 'pushToTalk',
    lang,
    loading = false,
    speaking = false,
    send,
    cancelSpeech,
    getSpokenText,
    interruptible = true,
    autoStart = false,
    layer = 'chat',
    claimFocus = false,
    onTurnStart,
    onError,
    onNoSpeech,
    onPaused,
    onTranscript,
    silenceMs,
}) {
    const [supported] = useState(() => VoiceService.isSttSupported());
    const [interim, setInterim] = useState('');
    const latest = useRef({});
    useEffect(() => {
        latest.current = { lang, mode, onTurnStart, onError, onTranscript };
    });
    // Bumped per recogniser so a stopped one's late callbacks cannot touch
    // the UI of the one that replaced it.
    const recRef = useRef(0);

    const report = useCallback((code) => latest.current.onError?.(code), []);

    const listen = useCallback(({ gesture, watch, isWatching, isCurrent, onResult, onError: engineError, onEnd }) => {
        const sttLang = latest.current.lang;
        if (!VoiceService.isSttSupported() || !sttLang) {
            engineError('unsupported');
            return;
        }
        const rec = ++recRef.current;
        if (!watch) {
            setInterim('');
            // Oyon opens its own capture, which leaves Web Speech deaf on
            // macOS Chrome when the recogniser runs hands-free: push-to-talk only.
            if (gesture && latest.current.mode === 'pushToTalk') latest.current.onTurnStart?.();
        }
        VoiceService.startListening({
            lang: sttLang,
            ...(watch ? { purpose: 'watch' } : {}),
            onResult: ({ final, interim: live }) => onResult({ final, interim: live }),
            onError: (err) => {
                const code = err?.message || 'unknown';
                // A watcher fails silently (Chrome ends it with 'no-speech'
                // during every long reply); 'no-speech' is routine hands-free
                // too — repeated empty turns end in one "paused" notice.
                if (rec === recRef.current && !isWatching() && isCurrent() && code !== 'aborted'
                    && !(latest.current.mode === 'handsFree' && code === 'no-speech')) {
                    report(code);
                }
                engineError(code);
            },
            onEnd: ({ final } = {}) => onEnd(final),
        });
    }, [report]);

    const stopListening = useCallback(() => {
        recRef.current += 1;
        VoiceService.stopListening();
    }, []);

    const engine = useTurnEngine({
        enabled: Boolean(enabled) && supported,
        mode,
        interruptible,
        autoStart,
        ready: Boolean(lang),
        layer,
        claimFocus,
        loading,
        speaking,
        listen,
        stopListening,
        cancelSpeech,
        send,
        getSpokenText,
        onTranscript: (text) => {
            setInterim(text);
            latest.current.onTranscript?.(text);
        },
        onPaused,
        onNoSpeech,
        ...(silenceMs ? { silenceMs } : {}),
    });

    const { tap: engineTap } = engine;
    const tap = useCallback(() => {
        // Under a surface on top, a tap (or Space) is not this surface's.
        if (engine.covered) return;
        if (!VoiceService.isSttSupported()) {
            report('unsupported');
            return;
        }
        if (!latest.current.lang && engine.phase !== 'listening') {
            report('no-language');
            return;
        }
        engineTap();
    }, [engineTap, engine.phase, engine.covered, report]);

    const listening = engine.phase === 'listening';
    return {
        ...engine,
        supported,
        listening,
        interim: listening ? interim : '',
        tap,
    };
}

/**
 * The translation key (chat namespace) for a recogniser problem, or null
 * when it is not the learner's business. Shared by every surface that
 * toasts STT failures, so they say the same thing.
 */
export function sttErrorKey(code) {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed': return 'mic_blocked';
        case 'network': return 'stt_network_error';
        case 'audio-capture': return 'no_microphone';
        case 'no-speech': return 'no_speech_heard';
        case 'unsupported': return 'stt_not_supported_browser';
        case 'no-language': return 'no_stt_language';
        case 'aborted': return null;
        default: return 'stt_error';
    }
}
