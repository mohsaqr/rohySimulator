/**
 * logEventMapping — turn a host's own `oyon-log-v1` events into signal
 * events on a closed vocabulary, so the Dynamics and Patterns views can draw
 * them.
 *
 * Hosts that had no vocabulary for a document edit or a code run logged
 * them as free-form `oyon-log-v1` events under names of their own. No
 * dashboard draws those: a transition network needs states from a closed,
 * versioned set. A host keeps its stored log events and supplies a REVIEWED
 * mapping from each of its event names to a `{ modality, state }`:
 *
 *   const mapping = {
 *     'doc.text_inserted': { modality: 'document_edit', state: 'insert' },
 *     'doc.ai_rewrite':    { modality: 'document_edit', state: 'replace', source: 'ai' },
 *     'run.finished_ok':   { modality: 'code_run', state: 'success',
 *                            detail: (details) => ({ duration_ms: details.ms ?? null }) },
 *   };
 *   const { events, unmapped } = mapLogEventsToSignalEvents(logEvents, mapping);
 *
 * New capture should report through `createDocumentEditTracker` /
 * `createCodeRunTracker` directly; this function is for records that already
 * exist.
 */

import {
  OYON_EVENT_SOURCES,
  OYON_STATE_VOCABULARIES,
  OYON_STATE_VOCABULARY_VERSIONS,
} from '../version.js';

const IDENTITY_KEYS = ['user_id', 'user_label', 'group_id', 'group_label', 'class_id', 'class_label', 'context_id'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timeMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function checkMapping(mapping) {
  if (!isObject(mapping)) {
    throw new TypeError('mapLogEventsToSignalEvents: `mapping` must be an object of event_name → { modality, state }');
  }
  for (const [eventName, rule] of Object.entries(mapping)) {
    if (!isObject(rule)) {
      throw new TypeError(`mapLogEventsToSignalEvents: mapping for "${eventName}" must be an object`);
    }
    const vocabulary = Object.prototype.hasOwnProperty.call(OYON_STATE_VOCABULARIES, rule.modality)
      ? OYON_STATE_VOCABULARIES[rule.modality]
      : null;
    if (!vocabulary) {
      throw new TypeError(`mapLogEventsToSignalEvents: mapping for "${eventName}" names unknown modality ${JSON.stringify(rule.modality)}`);
    }
    if (!vocabulary.includes(rule.state)) {
      throw new TypeError(
        `mapLogEventsToSignalEvents: mapping for "${eventName}" names state ${JSON.stringify(rule.state)}, `
        + `which is not in the ${rule.modality} vocabulary (${vocabulary.join(', ')})`,
      );
    }
    if (rule.source !== undefined && !OYON_EVENT_SOURCES.includes(rule.source)) {
      throw new TypeError(`mapLogEventsToSignalEvents: mapping for "${eventName}" names unknown source ${JSON.stringify(rule.source)}`);
    }
    if (rule.detail !== undefined && typeof rule.detail !== 'function') {
      throw new TypeError(`mapLogEventsToSignalEvents: mapping for "${eventName}" has a \`detail\` that is not a function`);
    }
  }
}

/**
 * Map `oyon-log-v1` events to signal events.
 *
 * Returns `{ events, unmapped }`:
 *   - `events`    signal events in the stored shape (`event_id`,
 *                 `capture_id`, `session_id`, identity fields, `modality`,
 *                 `state`, `source`, `sequence_index`, `timestamp`,
 *                 `state_vocabulary`, `detail`), ready for
 *                 `setRecords({ signalEvents })`;
 *   - `unmapped`  one row per log event that produced no signal event:
 *                 `{ index, event_name, reason }`.
 *
 * Ordering: a log has no `sequence_index`, so one is assigned per session in
 * timestamp order (ties keep the log's own order). Each session's events
 * share the `capture_id` `log:<session_id>`, which keeps them one chain in
 * the sequence views. Identity (`session_id`, `user_id`, `user_label`,
 * `group_id`, `context_id`) is read from the log event's `context`.
 *
 * A mapping that names an unknown modality or state throws a `TypeError`:
 * a wrong mapping is a programming error, and events on a made-up state
 * would corrupt every transition matrix built from them.
 */
export function mapLogEventsToSignalEvents(logEvents, mapping) {
  checkMapping(mapping);
  const list = Array.isArray(logEvents) ? logEvents : [];
  const unmapped = [];
  const bySession = new Map();

  list.forEach((logEvent, index) => {
    const eventName = isObject(logEvent) ? logEvent.event_name : undefined;
    if (!isObject(logEvent) || typeof eventName !== 'string') {
      unmapped.push({ index, event_name: null, reason: 'not a log event' });
      return;
    }
    const rule = Object.prototype.hasOwnProperty.call(mapping, eventName) ? mapping[eventName] : null;
    if (!rule) {
      unmapped.push({ index, event_name: eventName, reason: 'no mapping for this event name' });
      return;
    }
    const timestamp = timeMs(logEvent.timestamp);
    if (timestamp === null) {
      unmapped.push({ index, event_name: eventName, reason: 'timestamp is missing or not a time' });
      return;
    }
    const context = isObject(logEvent.context) ? logEvent.context : {};
    const sessionId = typeof context.session_id === 'string' && context.session_id.length > 0
      ? context.session_id
      : null;
    const key = sessionId ?? '';
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push({ index, logEvent, rule, timestamp, context, sessionId });
  });

  const events = [];
  for (const entries of bySession.values()) {
    // Stable: Array.prototype.sort keeps the log's order for equal timestamps.
    entries.sort((a, b) => a.timestamp - b.timestamp);
    entries.forEach((entry, sequenceIndex) => {
      const { index, logEvent, rule, timestamp, context, sessionId } = entry;
      const identity = {};
      for (const identityKey of IDENTITY_KEYS) {
        if (typeof context[identityKey] === 'string' && context[identityKey].length > 0) {
          identity[identityKey] = context[identityKey];
        }
      }
      const details = isObject(logEvent.details) ? logEvent.details : {};
      events.push({
        event_id: `log_${sessionId ?? 'nosession'}_${index}`,
        capture_id: `log:${sessionId ?? 'nosession'}`,
        session_id: sessionId,
        ...identity,
        modality: rule.modality,
        state: rule.state,
        source: rule.source ?? 'user',
        sequence_index: sequenceIndex,
        timestamp,
        monotonic_ms: null,
        state_vocabulary: OYON_STATE_VOCABULARY_VERSIONS[rule.modality],
        target: null,
        detail: rule.detail ? rule.detail(details) : null,
      });
    });
  }

  return { events, unmapped };
}
