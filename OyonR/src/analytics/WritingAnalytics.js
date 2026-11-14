/**
 * WritingAnalytics — what a writer DID to a document, pooled from `document_edit` signal events.
 *
 * Typing episodes (TypingEpisodeAnalytics) describe the keystrokes of one sitting at one composer: pauses,
 * bursts, revisions. They cannot say where the text of a document came from or how it grew across sittings,
 * because a paste, an AI insertion and a structural move are not keystrokes. A host that owns a document
 * reports those as `document_edit` events (`createDocumentEditTracker`, or `mapLogEventsToSignalEvents`
 * for stored logs): one event per edit, with its state, its source (`user` | `ai` | `system`), and counts
 * of graphemes and words added and removed. Never the text.
 *
 * This module pools them into the figures a writing dashboard draws:
 *   - how much was added and removed, and what remains (net);
 *   - where added text came from: typed, pasted, inserted by an AI, or by the system;
 *   - the growth of the text over time (the process graph);
 *   - the same per person, per session, per document (`context_id`) and per day.
 *
 * Null discipline (as everywhere in Oyon): a count the host did not supply is `null` — not measured —
 * and a sum is `null` when no event measured it. Zero means measured and zero.
 *
 * Descriptive only. These figures say what happened to the text; they do not say how good it is, and a
 * share of text is not a share of the thinking.
 */

import { DEFAULT_SESSION, DEFAULT_USER, recordLevelValue, recordUserLabel } from '../records/hostRecords.js';

/** Where added text came from, in display order. */
export const WRITING_ORIGINS = Object.freeze(['typed', 'pasted', 'ai', 'system']);

const STRUCTURAL = Object.freeze({ block_add: 'added', block_remove: 'removed', block_reorder: 'moved' });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const add = (sum, value) => (value === null ? sum : (sum ?? 0) + value);

function timeMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The origin of one edit: an AI's or the system's by `source`; a person's paste by `state`; else typed. */
export function writingOrigin(event) {
  if (event.source === 'ai') return 'ai';
  if (event.source === 'system') return 'system';
  return event.state === 'paste' ? 'pasted' : 'typed';
}

/**
 * The `document_edit` events of a set, as plain acts in time order (ties keep `sequence_index`, then input
 * order). Events of other modalities and events with no usable timestamp are left out.
 *
 * @returns {Array<{t: number, state: string, origin: string, userId: string, userLabel: string|null,
 *   sessionId: string, contextId: string|null, graphemesAdded: number|null, graphemesRemoved: number|null,
 *   wordsAdded: number|null, wordsRemoved: number|null, blockKind: string|null}>}
 */
export function writingActs(events) {
  const acts = [];
  (Array.isArray(events) ? events : []).forEach((event, index) => {
    if (!isObject(event) || event.modality !== 'document_edit' || typeof event.state !== 'string') return;
    const t = timeMs(event.timestamp);
    if (t === null) return;
    const detail = isObject(event.detail) ? event.detail : {};
    const contextId = recordLevelValue(event, 'context_id');
    acts.push({
      t,
      state: event.state,
      origin: writingOrigin(event),
      userId: recordLevelValue(event, 'user_id'),
      userLabel: recordUserLabel(event),
      sessionId: recordLevelValue(event, 'session_id'),
      contextId: contextId === '__none__' ? null : contextId,
      graphemesAdded: count(detail.graphemes_added),
      graphemesRemoved: count(detail.graphemes_removed),
      wordsAdded: count(detail.words_added),
      wordsRemoved: count(detail.words_removed),
      blockKind: typeof detail.block_kind === 'string' ? detail.block_kind : null,
      order: [typeof event.sequence_index === 'number' ? event.sequence_index : 0, index],
    });
  });
  acts.sort((a, b) => a.t - b.t || a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  return acts.map(({ order, ...act }) => act);
}

function emptyOrigins() {
  return Object.fromEntries(WRITING_ORIGINS.map((origin) => [origin, { acts: 0, graphemes: null, words: null, share: null }]));
}

function summarizeActs(acts) {
  const origins = emptyOrigins();
  const states = {};
  const structural = { added: 0, removed: 0, moved: 0 };
  const people = new Set();
  const sessions = new Set();
  const contexts = new Set();
  let graphemesAdded = null, graphemesRemoved = null, wordsAdded = null, wordsRemoved = null;
  let firstMs = null, lastMs = null;
  for (const act of acts) {
    states[act.state] = (states[act.state] ?? 0) + 1;
    if (STRUCTURAL[act.state]) structural[STRUCTURAL[act.state]] += 1;
    people.add(act.userId);
    sessions.add(`${act.userId}\u0000${act.sessionId}`);
    if (act.contextId !== null) contexts.add(act.contextId);
    graphemesAdded = add(graphemesAdded, act.graphemesAdded);
    graphemesRemoved = add(graphemesRemoved, act.graphemesRemoved);
    wordsAdded = add(wordsAdded, act.wordsAdded);
    wordsRemoved = add(wordsRemoved, act.wordsRemoved);
    const origin = origins[act.origin];
    origin.acts += 1;
    origin.graphemes = add(origin.graphemes, act.graphemesAdded);
    origin.words = add(origin.words, act.wordsAdded);
    if (firstMs === null || act.t < firstMs) firstMs = act.t;
    if (lastMs === null || act.t > lastMs) lastMs = act.t;
  }
  // A share is of the ADDED text, by graphemes: the one count every edit can carry.
  for (const origin of WRITING_ORIGINS) {
    const row = origins[origin];
    row.share = graphemesAdded !== null && graphemesAdded > 0 ? (row.graphemes ?? 0) / graphemesAdded : null;
  }
  return {
    acts: acts.length,
    firstMs,
    lastMs,
    graphemesAdded,
    graphemesRemoved,
    netGraphemes: graphemesAdded === null && graphemesRemoved === null ? null : (graphemesAdded ?? 0) - (graphemesRemoved ?? 0),
    wordsAdded,
    wordsRemoved,
    netWords: wordsAdded === null && wordsRemoved === null ? null : (wordsAdded ?? 0) - (wordsRemoved ?? 0),
    // Of everything added, the part that was later removed, as a ratio of totals: 0 = nothing removed.
    removedRatio: graphemesAdded !== null && graphemesAdded > 0 && graphemesRemoved !== null ? graphemesRemoved / graphemesAdded : null,
    origins,
    states,
    structural,
    people: people.size,
    sessions: sessions.size,
    contexts: contexts.size,
  };
}

/** One pooled summary of every `document_edit` event in `events`. */
export function summarizeWriting(events) {
  return summarizeActs(writingActs(events));
}

function dayKey(ms, utc) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return utc
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const GROUPERS = {
  person: (act) => ({ key: act.userId, label: act.userLabel ?? (act.userId === DEFAULT_USER ? 'Unknown' : act.userId) }),
  session: (act) => ({ key: `${act.userId}\u0000${act.sessionId}`, label: act.sessionId === DEFAULT_SESSION ? 'No session' : act.sessionId }),
  context: (act) => ({ key: act.contextId ?? '__none__', label: act.contextId ?? 'No document' }),
};

/**
 * One summary row per person, session, document (`context`) or calendar day.
 *
 * @param {unknown[]} events
 * @param {{by?: 'person'|'session'|'context'|'day', utc?: boolean}} [options]  days are local unless `utc`
 * @returns {Array<object>} rows `{key, label, share, ...summarizeWriting fields}`; `share` is the row's
 *   added graphemes out of all rows' (null when not measured). People, sessions and documents are ordered
 *   by added text, most first; days by date.
 */
export function summarizeWritingBy(events, options = {}) {
  const by = options.by ?? 'person';
  const acts = writingActs(events);
  const groups = new Map();
  for (const act of acts) {
    const unit = by === 'day' ? { key: dayKey(act.t, options.utc === true), label: dayKey(act.t, options.utc === true) }
      : (GROUPERS[by] ?? GROUPERS.person)(act);
    if (!groups.has(unit.key)) groups.set(unit.key, { ...unit, acts: [] });
    const group = groups.get(unit.key);
    if (by === 'person' && act.userLabel) group.label = act.userLabel;
    group.acts.push(act);
  }
  const rows = [...groups.values()].map((group) => ({ key: group.key, label: group.label, ...summarizeActs(group.acts) }));
  const total = rows.reduce((sum, row) => add(sum, row.graphemesAdded), null);
  for (const row of rows) row.share = total !== null && total > 0 && row.graphemesAdded !== null ? row.graphemesAdded / total : null;
  if (by === 'day') rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  else rows.sort((a, b) => (b.graphemesAdded ?? -1) - (a.graphemesAdded ?? -1) || (a.label < b.label ? -1 : 1));
  return rows;
}

/**
 * The growth of the text over time: one point per edit that measured graphemes, with the running net.
 *
 * `net` starts at 0 — the text that existed before the first recorded edit is not known from events, so
 * the curve is the change since recording began, not the document's length.
 *
 * @returns {{points: Array<{t: number, net: number, netWords: number|null, added: number, removed: number,
 *   origin: string, state: string, userId: string, sessionId: string}>, unmeasured: number}}
 *   `unmeasured` — edits left out because they carried no grapheme count.
 */
export function writingTimeline(events) {
  const points = [];
  let net = 0, netWords = null, unmeasured = 0;
  for (const act of writingActs(events)) {
    if (act.graphemesAdded === null && act.graphemesRemoved === null) {
      if (!STRUCTURAL[act.state] && act.state !== 'format') unmeasured += 1;
      continue;
    }
    const added = act.graphemesAdded ?? 0, removed = act.graphemesRemoved ?? 0;
    net += added - removed;
    if (act.wordsAdded !== null || act.wordsRemoved !== null) netWords = (netWords ?? 0) + (act.wordsAdded ?? 0) - (act.wordsRemoved ?? 0);
    points.push({ t: act.t, net, netWords, added, removed, origin: act.origin, state: act.state, userId: act.userId, sessionId: act.sessionId });
  }
  return { points, unmeasured };
}

/**
 * Words (or graphemes) added and removed per calendar day, split by person: the group timeline.
 *
 * @param {unknown[]} events
 * @param {{utc?: boolean, unit?: 'words'|'graphemes'}} [options]
 * @returns {{unit: string, days: string[], people: Array<{key: string, label: string}>,
 *   cells: Array<{day: string, person: string, added: number, removed: number}>, maxAdded: number, maxRemoved: number}}
 *   `unit` is the one used: words when any edit measured words, otherwise graphemes. `maxAdded` / `maxRemoved`
 *   are the largest per-day totals, for a shared axis.
 */
export function writingByDayAndPerson(events, options = {}) {
  const acts = writingActs(events);
  const measuredWords = acts.some((act) => act.wordsAdded !== null || act.wordsRemoved !== null);
  const unit = options.unit ?? (measuredWords ? 'words' : 'graphemes');
  const addedOf = (act) => (unit === 'words' ? act.wordsAdded : act.graphemesAdded) ?? 0;
  const removedOf = (act) => (unit === 'words' ? act.wordsRemoved : act.graphemesRemoved) ?? 0;
  const people = new Map();
  const cells = new Map();
  const days = new Set();
  for (const act of acts) {
    const day = dayKey(act.t, options.utc === true);
    days.add(day);
    if (!people.has(act.userId) || act.userLabel) {
      people.set(act.userId, { key: act.userId, label: act.userLabel ?? people.get(act.userId)?.label ?? (act.userId === DEFAULT_USER ? 'Unknown' : act.userId) });
    }
    const id = `${day}\u0000${act.userId}`;
    if (!cells.has(id)) cells.set(id, { day, person: act.userId, added: 0, removed: 0 });
    const cell = cells.get(id);
    cell.added += addedOf(act);
    cell.removed += removedOf(act);
  }
  const dayList = [...days].sort();
  const list = [...cells.values()];
  const perDay = (field) => Math.max(0, ...dayList.map((day) => list.filter((c) => c.day === day).reduce((s, c) => s + c[field], 0)));
  return {
    unit,
    days: dayList,
    people: [...people.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    cells: list,
    maxAdded: perDay('added'),
    maxRemoved: perDay('removed'),
  };
}

/**
 * The seven writing ACTS, for sequence views (Dynamics, Patterns). Few on purpose: a transition network
 * over thirty states is unreadable.
 *
 *   write     a person added new text                    detail: —
 *   revise    a person changed text that was there       detail: delete · replace · undo
 *   paste     a person brought text in                   detail: —
 *   organise  appearance or structure, words unchanged   detail: format · structure
 *   ai        an AI was asked, or its words placed       detail: ask · insert · replace
 *   decide    a person ruled on an AI's words            detail: kept · rejected
 *   pause     nothing for `pauseMs` or longer            detail: —
 *
 * Read from `document_edit` events, and from three `ai_assist` events, which are acts of writing that
 * change no text: `suggestion_request` is `ai:ask`, `suggestion_accept` is `decide:kept`,
 * `suggestion_reject` is `decide:rejected`. Other `ai_assist` states are not writing acts.
 *
 * `decide` is also read from `detail.ai_decision` ('kept' | 'rejected') on the document edit that carried
 * a decision out. A host reports one decision one way: either the `ai_assist` event or `ai_decision` on
 * the edit, not both, or the decision is counted twice.
 */
export const WRITING_ACTS = Object.freeze(['write', 'revise', 'paste', 'organise', 'ai', 'decide', 'pause']);
/** A pause is a silence of at least this long between two acts of one session (2 minutes). */
export const WRITING_PAUSE_MS = 120000;

const REVISE_DETAIL = { delete: 'delete', replace: 'replace', undo: 'undo', redo: 'undo' };
const AI_ASSIST_ACTS = Object.freeze({
  suggestion_request: Object.freeze({ act: 'ai', detail: 'ask' }),
  suggestion_accept: Object.freeze({ act: 'decide', detail: 'kept' }),
  suggestion_reject: Object.freeze({ act: 'decide', detail: 'rejected' }),
});

/**
 * One event → `{act, detail}`; `detail` is null where the act has one form. An event with
 * `modality: 'ai_assist'` is read by its state and gives `null` when that state is not a writing act;
 * any other event is read as a document edit.
 */
export function writingActOf(event) {
  const state = event.state;
  if (event.modality === 'ai_assist') {
    const read = Object.prototype.hasOwnProperty.call(AI_ASSIST_ACTS, state) ? AI_ASSIST_ACTS[state] : null;
    return read ? { act: read.act, detail: read.detail } : null;
  }
  const decision = isObject(event.detail) ? event.detail.ai_decision : null;
  if (decision === 'kept' || decision === 'rejected') return { act: 'decide', detail: decision };
  if (event.source === 'ai') return { act: 'ai', detail: state === 'insert' || state === 'paste' || state === 'block_add' ? 'insert' : 'replace' };
  if (state === 'insert') return { act: 'write', detail: null };
  if (state === 'paste') return { act: 'paste', detail: null };
  if (REVISE_DETAIL[state]) return { act: 'revise', detail: REVISE_DETAIL[state] };
  return { act: 'organise', detail: state === 'format' ? 'format' : 'structure' };
}

const chainKey = (event) => `${recordLevelValue(event, 'user_id')}\u0000${recordLevelValue(event, 'session_id')}`;

/**
 * The events the writing acts are read from, in time order (ties keep `sequence_index`, then input
 * order): every `document_edit` event, and the `ai_assist` requests, accepts and rejects of a person and
 * session that also edited a document. An AI used where no document was edited (inline code completion
 * in another tool, say) is not writing and is left out.
 *
 * @param {unknown[]} events  signal events
 * @param {{aiAssist?: boolean}} [options]  `aiAssist: false` reads document edits only
 * @returns {object[]}
 */
export function writingActEvents(events, options = {}) {
  const withAi = options.aiAssist !== false;
  const list = [];
  const editors = new Set();
  (Array.isArray(events) ? events : []).forEach((event, index) => {
    if (!isObject(event) || typeof event.state !== 'string') return;
    const edit = event.modality === 'document_edit';
    if (!edit && !(withAi && event.modality === 'ai_assist' && writingActOf(event))) return;
    const t = timeMs(event.timestamp);
    if (t === null) return;
    if (edit) editors.add(chainKey(event));
    list.push({ t, index, seq: typeof event.sequence_index === 'number' ? event.sequence_index : 0, event, edit });
  });
  list.sort((a, b) => a.t - b.t || a.seq - b.seq || a.index - b.index);
  return list.filter((row) => row.edit || editors.has(chainKey(row.event))).map((row) => row.event);
}

/**
 * The writing acts of a set as state chains, one per person and session, in time order. A pause is
 * measured over the merged stream of edits and AI acts.
 *
 * @param {unknown[]} events  signal events; see `writingActEvents` for which are read
 * @param {{level?: 'main'|'detail', pauseMs?: number|null, aiAssist?: boolean}} [options]
 *   `level: 'detail'` names states `revise:delete`, `ai:ask`, …; `pauseMs: null` adds no pauses;
 *   `aiAssist: false` reads document edits only
 * @returns {string[][]}
 */
export function writingActSequences(events, options = {}) {
  const detailed = options.level === 'detail';
  const pauseMs = options.pauseMs === null ? null : (Number.isFinite(options.pauseMs) ? options.pauseMs : WRITING_PAUSE_MS);
  const chains = new Map();
  for (const event of writingActEvents(events, { aiAssist: options.aiAssist })) {
    const t = timeMs(event.timestamp);
    const key = chainKey(event);
    if (!chains.has(key)) chains.set(key, { states: [], last: null });
    const chain = chains.get(key);
    if (pauseMs !== null && chain.last !== null && t - chain.last >= pauseMs) chain.states.push('pause');
    const { act, detail } = writingActOf(event);
    chain.states.push(detailed && detail ? `${act}:${detail}` : act);
    chain.last = t;
  }
  return [...chains.values()].map((chain) => chain.states);
}

/**
 * The coarse summary: how many of each of the seven acts, their shares, and each act's details.
 *
 * @param {unknown[]} events
 * @param {{pauseMs?: number|null, aiAssist?: boolean}} [options]
 * @returns {{total: number, acts: Array<{act: string, count: number, share: number|null,
 *   details: Array<{detail: string, count: number}>}>}}
 *   Always the seven acts in `WRITING_ACTS` order, zero counts included; `share` is of `total`, null when 0.
 */
export function summarizeWritingActs(events, options = {}) {
  const counts = new Map(WRITING_ACTS.map((act) => [act, { count: 0, details: new Map() }]));
  let total = 0;
  for (const chain of writingActSequences(events, { level: 'detail', pauseMs: options.pauseMs, aiAssist: options.aiAssist })) {
    for (const state of chain) {
      const [act, detail] = state.split(':');
      const row = counts.get(act);
      if (!row) continue;
      row.count += 1;
      total += 1;
      if (detail) row.details.set(detail, (row.details.get(detail) ?? 0) + 1);
    }
  }
  return {
    total,
    acts: WRITING_ACTS.map((act) => {
      const row = counts.get(act);
      return {
        act,
        count: row.count,
        share: total > 0 ? row.count / total : null,
        details: [...row.details.entries()].map(([detail, count]) => ({ detail, count })).sort((a, b) => b.count - a.count),
      };
    }),
  };
}
