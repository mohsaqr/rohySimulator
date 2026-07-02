/*
 * tnaPooling — build one emotion-state chain PER SESSION so transition
 * counts pool across sessions without fabricating a transition between one
 * session's last state and the next session's first state.
 *
 * Within a single continuous capture, sessions don't fragment a chain — but
 * when the dashboard aggregates DISTINCT sessions (the 'all'/'past' filter
 * scopes), session boundaries are real discontinuities. dynajs `tna()`
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
 * Group windows by session, time-order each group, and emit one state
 * sequence per session (insertion-ordered by first appearance).
 *
 * @param {Array<object>} windows  stored EmotionWindow records
 * @returns {string[][]}  one chain of normalized emotion states per session
 */
export function buildSessionSequences(windows) {
  const list = Array.isArray(windows) ? windows : [];
  const groups = new Map();
  for (const w of list) {
    const key = sessionIdOf(w);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const sequences = [];
  for (const group of groups.values()) {
    const sorted = group
      .slice()
      .sort((a, b) => parseTime(a.window_end || a.timestamp) - parseTime(b.window_end || b.timestamp));
    const states = sorted.map((w) => normalizedEmotion(w.dominant_emotion) || 'insufficient');
    if (states.length > 0) sequences.push(states);
  }
  return sequences;
}

/**
 * Transition counts pooled across the per-session chains — exposed mainly
 * for tests (the dashboard feeds the sequences to dynajs `tna()` instead).
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
