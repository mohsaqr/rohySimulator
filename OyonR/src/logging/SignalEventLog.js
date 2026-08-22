import {
  OYON_EVENT_SOURCES,
  OYON_STATE_VOCABULARIES,
  OYON_STATE_VOCABULARY_VERSIONS,
} from '../version.js';
import { oyonRecordId } from '../storage/IndexedDbOyonStore.js';

const DEFAULT_MAX_EVENTS = 50000;

/**
 * The complete, ordered, per-event log behind every modality's discrete
 * state stream (typing, interaction, ai_assist, ...). See audio_text.md
 * §3.6: aggregate windows cannot support sequence analysis (TNA, process
 * mining, lag-sequential) because that needs one ordered, state-labelled row
 * per event — this is that row source, and `toSequences()` is the direct
 * feed into ladyna `tna()` with no reshape step.
 *
 * `sequence_index` (not wall-clock `timestamp`) is the ordering key
 * everywhere in this class: timestamps are not monotonic across a tab
 * suspend, but the per-capture counter always is.
 */
export class SignalEventLog {
  constructor(options = {}) {
    this.options = {
      maxEvents: DEFAULT_MAX_EVENTS,
      now: () => Date.now(),
      monotonicNow: () => performance.now(),
      idFactory: () => oyonRecordId('evt'),
      onEvent: null,
      ...options,
    };
    this.context = null;
    this.events = [];
    this.nextSequenceIndex = 0;
    this.droppedEventsCount = 0;
  }

  /**
   * Begin (or restart) logging for one capture. Resets `sequence_index`
   * numbering to 0 and clears any buffered events and drop count — a new
   * capture is a new ordering domain.
   */
  start(context = {}) {
    this.context = {
      capture_id: context.capture_id ?? null,
      session_id: context.session_id ?? null,
    };
    this.events = [];
    this.nextSequenceIndex = 0;
    this.droppedEventsCount = 0;
  }

  /**
   * Validate and store one event, stamping the fields the caller doesn't
   * own: `event_id`, `sequence_index`, `state_vocabulary`, and (unless
   * supplied) `timestamp`/`monotonic_ms`. Returns the stored object.
   */
  record(event = {}) {
    if (!this.context) {
      throw new Error(
        'SignalEventLog.record() was called before start(): call start({ capture_id, session_id }) first.',
      );
    }

    const { modality, state, source = 'user', target = null, detail = null, timestamp, monotonic_ms } = event;

    const vocabulary = Object.prototype.hasOwnProperty.call(OYON_STATE_VOCABULARIES, modality)
      ? OYON_STATE_VOCABULARIES[modality]
      : null;
    if (!vocabulary) {
      throw new Error(
        `SignalEventLog.record(): unknown modality "${modality}" — no state vocabulary is registered for it `
        + `(known modalities: ${Object.keys(OYON_STATE_VOCABULARIES).join(', ')}).`,
      );
    }
    if (!vocabulary.includes(state)) {
      throw new Error(
        `SignalEventLog.record(): unknown state "${state}" for modality "${modality}" `
        + `(expected one of: ${vocabulary.join(', ')}).`,
      );
    }
    if (!OYON_EVENT_SOURCES.includes(source)) {
      throw new Error(
        `SignalEventLog.record(): unknown source "${source}" `
        + `(expected one of: ${OYON_EVENT_SOURCES.join(', ')}).`,
      );
    }

    const stored = {
      event_id: this.options.idFactory(),
      capture_id: this.context.capture_id,
      session_id: this.context.session_id,
      modality,
      state,
      source,
      sequence_index: this.nextSequenceIndex,
      timestamp: timestamp ?? this.options.now(),
      monotonic_ms: monotonic_ms ?? this.options.monotonicNow(),
      state_vocabulary: OYON_STATE_VOCABULARY_VERSIONS[modality],
      target,
      detail,
    };
    this.nextSequenceIndex += 1;

    this.events.push(stored);
    // Ring buffer: drop the OLDEST event, never the newest, and never stop
    // counting sequence_index — a gap in the indices is what makes the drop
    // detectable downstream even after the event itself is gone.
    if (this.events.length > this.options.maxEvents) {
      this.events.shift();
      this.droppedEventsCount += 1;
    }

    this.options.onEvent?.(stored);
    return stored;
  }

  /** Return events buffered so far and clear the buffer. */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Return events buffered so far without clearing the buffer. */
  all() {
    return this.events.slice();
  }

  /** Clear the buffer without touching sequence numbering or drop count. */
  clear() {
    this.events = [];
  }

  get size() {
    return this.events.length;
  }

  /** Count of events discarded by the ring buffer since the last `start()`. */
  get droppedEvents() {
    return this.droppedEventsCount;
  }

  /**
   * Flat, one-row-per-event view: `{ session_id, actor, sequence_index,
   * timestamp, monotonic_ms, state, modality, source }`. `actorKey` selects
   * which stored field becomes `actor` (default `session_id`) so a caller
   * can group by capture, session, or target instead.
   */
  toLongFormat({ actorKey = 'session_id' } = {}) {
    return this.events.map((event) => ({
      session_id: event.session_id,
      actor: event[actorKey],
      sequence_index: event.sequence_index,
      timestamp: event.timestamp,
      monotonic_ms: event.monotonic_ms,
      state: event.state,
      modality: event.modality,
      source: event.source,
    }));
  }

  /**
   * One ordered state chain per `groupBy` key (default `session_id`),
   * optionally filtered to a single `modality` first. Chains are built by
   * grouping and THEN sorting each group by `sequence_index` — never by
   * concatenating across groups — so no transition is fabricated between one
   * group's last state and the next group's first. See
   * standalone/app/src/lib/tnaPooling.js, which solves the identical problem
   * for emotion windows.
   *
   * Sorting uses `sequence_index`, not `timestamp`: wall-clock time is not
   * monotonic across a tab suspend, so it cannot be trusted to order events.
   *
   * The result feeds ladyna `tna()` directly (string[][], one array per
   * session/group), with no reshape step.
   */
  toSequences({ groupBy = 'session_id', modality = null } = {}) {
    const filtered = modality ? this.events.filter((event) => event.modality === modality) : this.events;
    const groups = new Map();
    for (const event of filtered) {
      const key = event[groupBy];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    const sequences = [];
    for (const group of groups.values()) {
      const sorted = group.slice().sort((a, b) => a.sequence_index - b.sequence_index);
      sequences.push(sorted.map((event) => event.state));
    }
    return sequences;
  }
}
