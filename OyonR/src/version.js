/**
 * Machine-readable release and integration contract identifiers.
 *
 * OYON_VERSION mirrors package.json and is verified by the release tests.
 * Host and batch contract versions change only when their public wire/API
 * shapes change; they are intentionally independent from patch releases.
 */
export const OYON_VERSION = '3.3.3';
export const OYON_HOST_CONTRACT_VERSION = '3.1';

/**
 * v4 adds the `modality` discriminator, superseding the ad-hoc `<x>_only`
 * booleans, and admits episode-shaped windows (typing, voice) that do not
 * share the camera's fixed cadence. v3 stays supported: hosts on the older
 * contract keep working and `*_only` events are still accepted.
 */
export const OYON_WINDOW_BATCH_SCHEMA_VERSION = 'oyon-window-batch-v4';
export const OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS = Object.freeze([
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
  'oyon-window-batch-v3',
]);

/**
 * Modalities a window may declare. `emotion` is the camera pipeline's own
 * window; the rest are modality-scoped windows emitted on their own cadence.
 */
export const OYON_MODALITIES = Object.freeze([
  'emotion',
  'engagement',
  'facial',
  'gaze',
  'heart_rate',
  'posture',
  'respiration',
  'illumination',
  'typing',
  'discourse',
  'interaction',
  'ai_assist',
  'voice',
]);

/** Window cadence: fixed-interval camera window, or a host-bounded episode. */
export const OYON_WINDOW_KINDS = Object.freeze(['interval', 'episode']);

/**
 * Who produced an event. The user/ai split is what makes human-AI co-writing
 * analyzable: a 200-grapheme insertion in 40 ms is an accepted suggestion, not
 * fast typing, and a model built on undifferentiated inserts cannot tell.
 */
export const OYON_EVENT_SOURCES = Object.freeze(['user', 'ai', 'system']);

/**
 * Discrete state vocabularies for the per-event log.
 *
 * These are CLOSED and VERSIONED on purpose. Sequence models (TNA, process
 * mining, lag-sequential analysis) build transition matrices keyed on these
 * labels, so a vocabulary that drifts silently makes two studies
 * non-comparable. Adding a state is a version bump, not an edit.
 */
export const OYON_TYPING_STATES_VERSION = 'typing-states-v1';
export const OYON_TYPING_STATES = Object.freeze([
  'start',
  'insert',
  'delete',
  'replace',
  'paste',
  'undo',
  'redo',
  // A spelling/autocorrect suggestion the writer ACCEPTED — the browser reports
  // it as inputType `insertReplacementText`, fired by both the native
  // spellcheck context menu and OS autocorrect. Note the red squiggle itself is
  // NOT observable: no browser exposes spellchecker state to JavaScript, so
  // Oyon sees corrections taken, never errors merely flagged.
  'correct',
  'compose',
  'composing',
  'commit',
  'move',
  'select',
  'deselect',
  // Synthesized, not a DOM event: without an explicit pause state a transition
  // matrix cannot distinguish "deleted right after inserting" from "deleted
  // after nine seconds of staring at the screen".
  'pause',
  'submit',
  'abandon',
]);

export const OYON_INTERACTION_STATES_VERSION = 'interaction-states-v1';
export const OYON_INTERACTION_STATES = Object.freeze([
  'pointer_move',
  'pointer_idle',
  'click',
  'double_click',
  'scroll_down',
  'scroll_up',
  'select_text',
  'focus_gain',
  'focus_loss',
  'tab_hidden',
  'tab_visible',
]);

/**
 * Speech acts, one per sentence of a composed message.
 *
 * Ordered by detection precedence, which IS the design: `thinking` outranks
 * `question` so "what if we tried Y?" reads as exploratory rather than
 * interrogative, and `request` is separated from `directive` so the mitigated
 * "can you explain X" is not scored as the bare imperative "explain X".
 *
 * English-only classification (see `speech_act_lang`); other languages fall
 * back to punctuation, which populates `question` and `statement` only.
 */
export const OYON_DISCOURSE_STATES_VERSION = 'discourse-states-v1';
export const OYON_DISCOURSE_STATES = Object.freeze([
  'thinking',
  'request',
  'question',
  'directive',
  'statement',
]);

/**
 * Voice-turn states. Single-word labels, consistent with the typing vocabulary.
 *
 * `playback` and `contaminated` exist because the AI speaks too: an interval of
 * host AI playback is excluded from learner-speech measurement, and if the
 * microphone picks up strong playback leakage the turn is marked contaminated
 * rather than silently counted as the learner talking.
 */
export const OYON_VOICE_STATES_VERSION = 'voice-states-v1';
export const OYON_VOICE_STATES = Object.freeze([
  'start',
  'speech',
  'silence',
  'pause',
  'clipped',
  'muted',
  'playback',
  'contaminated',
  'end',
]);

export const OYON_AI_ASSIST_STATES_VERSION = 'ai-assist-states-v1';
export const OYON_AI_ASSIST_STATES = Object.freeze([
  'suggestion_request',
  'suggestion_shown',
  'suggestion_accept',
  'suggestion_reject',
  'suggestion_dismiss',
  'ai_turn_start',
  'ai_turn_end',
]);

/** modality → its state vocabulary. Modalities absent here emit no events. */
export const OYON_STATE_VOCABULARIES = Object.freeze({
  typing: OYON_TYPING_STATES,
  discourse: OYON_DISCOURSE_STATES,
  interaction: OYON_INTERACTION_STATES,
  ai_assist: OYON_AI_ASSIST_STATES,
  voice: OYON_VOICE_STATES,
});

/** modality → the version identifier recorded on each event. */
export const OYON_STATE_VOCABULARY_VERSIONS = Object.freeze({
  typing: OYON_TYPING_STATES_VERSION,
  discourse: OYON_DISCOURSE_STATES_VERSION,
  interaction: OYON_INTERACTION_STATES_VERSION,
  ai_assist: OYON_AI_ASSIST_STATES_VERSION,
  voice: OYON_VOICE_STATES_VERSION,
});
