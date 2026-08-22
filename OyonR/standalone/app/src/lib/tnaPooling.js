/*
 * tnaPooling — build one emotion-state chain PER SESSION so transition
 * counts pool across sessions without fabricating a transition between one
 * session's last state and the next session's first state.
 *
 * Within a single continuous capture, sessions don't fragment a chain — but
 * when the dashboard aggregates DISTINCT sessions (the 'all'/'past' filter
 * scopes), session boundaries are real discontinuities. ladyna `tna()`
 * accepts an array of sequences and pools transitions across them, so the
 * whole fix is in how the sequences are built.
 *
 * Pure, node-executable plain JS (sibling .d.ts) — same precedent as
 * src/legacy/dashboard.js. Session identity comes from filterWindows.js
 * sessionIdOf so the chains are grouped by EXACTLY the same key the
 * FilterBar filters on (a divergent key here would chain windows under a
 * session the user filtered out). parseTime/normalizedEmotion mirror
 * dashboard.js (which is not node-importable — it imports vite aliases)
 * and must stay in sync with it.
 */

import { sessionIdOf } from './filterWindows.js';

function parseTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedEmotion(value) {
  if (!value) return '';
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

/**
 * Group records by session, order each group, and emit one state sequence per
 * session (insertion-ordered by first appearance).
 *
 * Records are EmotionWindows by default. Signal-log events (typing, discourse,
 * interaction, ai_assist) are the same shape of problem — group by session,
 * order, project to a state label — so they reuse this function rather than a
 * near-duplicate: pass `stateOf` and `orderOf`. Everything downstream
 * (ladyna `tna()`, `discoverPatterns`, `lsa`, CentralityPanel) consumes
 * `string[][]` and does not care which channel produced it.
 *
 * @param {Array<object>} records
 * @param {object} [options]
 * @param {(record: object) => string} [options.stateOf]  record → state label
 * @param {(record: object) => number} [options.orderOf]  record → sort key
 * @param {(record: object) => string} [options.groupOf]  record → chain key
 * @returns {string[][]}  one chain per group
 */
export function buildSessionSequences(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const stateOf = options.stateOf
    || ((w) => normalizedEmotion(w.dominant_emotion) || 'insufficient');
  const groupOf = options.groupOf || sessionIdOf;
  // Events carry a monotonic `sequence_index`; windows only have wall-clock
  // times. Prefer the index where present — wall clock is not monotonic across
  // a tab suspend, and ordering by it can silently scramble a chain.
  const orderOf = options.orderOf
    || ((w) => (Number.isFinite(w.sequence_index)
      ? w.sequence_index
      : parseTime(w.window_end || w.timestamp)));

  const groups = new Map();
  for (const record of list) {
    const key = groupOf(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const sequences = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => orderOf(a) - orderOf(b));
    const states = sorted.map(stateOf).filter((s) => typeof s === 'string' && s.length > 0);
    if (states.length > 0) sequences.push(states);
  }
  return sequences;
}

/**
 * Signal-log events → per-session state chains, via `buildSessionSequences`.
 * `modality` filters the log to one channel; omit it to interleave every
 * channel on one timeline (typing + discourse + ai_assist in `sequence_index`
 * order), which is what cross-channel transition questions need.
 *
 * @param {Array<object>} events  stored signal_events records
 * @param {string|null} [modality]
 * @returns {string[][]}
 */
export function buildEventSequences(events, modality = null) {
  const list = Array.isArray(events) ? events : [];
  const scoped = modality ? list.filter((e) => e?.modality === modality) : list;
  return buildSessionSequences(scoped, {
    stateOf: (e) => e?.state,
    // Chain per CAPTURE, not per session. `sequence_index` restarts at 0 for
    // each capture, so two captures in one session would otherwise be sorted
    // into each other and joined end-to-end — producing a phantom transition
    // from one capture's last state to the next capture's first.
    groupOf: (e) => `${sessionIdOf(e)}::${e?.capture_id ?? ''}`,
  });
}

/**
 * Transition counts pooled across the per-session chains — exposed mainly
 * for tests (the dashboard feeds the sequences to ladyna `tna()` instead).
 *
 * @param {string[][]} sequences
 * @returns {Map<string, number>}  keys are `${from}→${to}`
 */
export function pooledTransitionCounts(sequences) {
  const counts = new Map();
  for (const seq of Array.isArray(sequences) ? sequences : []) {
    for (let i = 1; i < seq.length; i += 1) {
      const key = `${seq[i - 1]}→${seq[i]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}
