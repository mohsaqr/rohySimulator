/**
 * hostRecords — the shape check for records a host feeds back into Oyon
 * (`<oyon-app>.setRecords(...)`), and the scope filter the dashboards apply
 * to them.
 *
 * A host stores what Oyon emitted and later returns it: interval windows,
 * episode windows, per-event states and log events. Before any of it is
 * drawn, each record is checked for the few fields the dashboards cannot
 * work without. This is a transport-shape check in the sense of CLAUDE.md's
 * data policy — it never removes a signal a record carries, and a record
 * that fails is REPORTED (kind, index, reason), not silently dropped.
 */

import {
  OYON_EVENT_SOURCES,
  OYON_MODALITIES,
  OYON_STATE_VOCABULARIES,
} from '../version.js';

/** The four kinds of record a host can feed, in the order they are checked. */
export const HOST_RECORD_KINDS = Object.freeze(['windows', 'signalWindows', 'signalEvents', 'logEvents']);

/** Bucket for records that carry no `session_id`. */
export const DEFAULT_SESSION = '__default__';
/** Bucket for records that carry no `user_id`. */
export const DEFAULT_USER = '__unknown__';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsableTime(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Why an interval window cannot be drawn, or `null` when it can. */
function refuseWindow(record) {
  if (!isObject(record)) return 'not an object';
  if (!parsableTime(record.window_end_ms ?? record.window_end)) return 'window_end is missing or not a time';
  return null;
}

/** Why an episode window cannot be drawn, or `null` when it can. */
function refuseSignalWindow(record) {
  if (!isObject(record)) return 'not an object';
  if (!OYON_MODALITIES.includes(record.modality)) return `modality ${JSON.stringify(record.modality)} is not a known modality`;
  if (!parsableTime(record.window_start)) return 'window_start is missing or not a time';
  return null;
}

/** Why a per-event state cannot be drawn, or `null` when it can. */
function refuseSignalEvent(record) {
  if (!isObject(record)) return 'not an object';
  const vocabulary = Object.prototype.hasOwnProperty.call(OYON_STATE_VOCABULARIES, record.modality)
    ? OYON_STATE_VOCABULARIES[record.modality]
    : null;
  if (!vocabulary) return `modality ${JSON.stringify(record.modality)} has no state vocabulary`;
  if (!vocabulary.includes(record.state)) return `state ${JSON.stringify(record.state)} is not in the ${record.modality} vocabulary`;
  if (!Number.isFinite(record.sequence_index)) return 'sequence_index is missing or not a number';
  if (record.source !== undefined && record.source !== null && !OYON_EVENT_SOURCES.includes(record.source)) {
    return `source ${JSON.stringify(record.source)} is not one of ${OYON_EVENT_SOURCES.join(', ')}`;
  }
  return null;
}

/** Why a log event cannot be drawn, or `null` when it can. */
function refuseLogEvent(record) {
  if (!isObject(record)) return 'not an object';
  if (record.schema_version !== 'oyon-log-v1') return 'schema_version is not oyon-log-v1';
  if (typeof record.event_name !== 'string' || record.event_name.length === 0) return 'event_name is missing';
  if (!parsableTime(record.timestamp)) return 'timestamp is missing or not a time';
  return null;
}

const REFUSERS = {
  windows: refuseWindow,
  signalWindows: refuseSignalWindow,
  signalEvents: refuseSignalEvent,
  logEvents: refuseLogEvent,
};

/**
 * Check everything a host feeds, one record at a time.
 *
 *   const { records, refused, counts } = validateHostRecords({
 *     windows, signalWindows, signalEvents, logEvents,
 *   });
 *
 * Returns:
 *   - `records`  the four arrays holding only the records that passed (a
 *                kind the host left out is an empty array);
 *   - `refused`  one row per record that did not pass:
 *                `{ kind, index, reason }`, `index` being its position in
 *                the array the host supplied;
 *   - `counts`   `{ accepted, refused }`, each `{ windows, signalWindows,
 *                signalEvents, logEvents, total }`.
 *
 * Never throws on a bad record. Throws a `TypeError` only when the argument
 * itself is not an object, or a supplied kind is not an array — a call that
 * cannot be interpreted at all.
 */
export function validateHostRecords(input) {
  if (!isObject(input)) {
    throw new TypeError('validateHostRecords: expected an object of { windows, signalWindows, signalEvents, logEvents }');
  }
  const records = {};
  const refused = [];
  const counts = { accepted: { total: 0 }, refused: { total: 0 } };

  for (const kind of HOST_RECORD_KINDS) {
    const supplied = input[kind];
    if (supplied !== undefined && supplied !== null && !Array.isArray(supplied)) {
      throw new TypeError(`validateHostRecords: \`${kind}\` must be an array, got ${typeof supplied}`);
    }
    const list = supplied ?? [];
    const accepted = [];
    let refusedCount = 0;
    list.forEach((record, index) => {
      const reason = REFUSERS[kind](record);
      if (reason === null) {
        accepted.push(record);
      } else {
        refused.push({ kind, index, reason });
        refusedCount += 1;
      }
    });
    records[kind] = accepted;
    counts.accepted[kind] = accepted.length;
    counts.accepted.total += accepted.length;
    counts.refused[kind] = refusedCount;
    counts.refused.total += refusedCount;
  }

  return { records, refused, counts };
}

function identityField(record, key) {
  if (!isObject(record)) return null;
  if (typeof record[key] === 'string' && record[key].length > 0) return record[key];
  const context = record.context;
  if (isObject(context) && typeof context[key] === 'string' && context[key].length > 0) return context[key];
  return null;
}

/**
 * The aggregation levels a record can be grouped at, widest first. Each is
 * an identity field on the record: `key` is the field, `labelKey` an optional
 * display-name field beside it.
 *
 * A level a host does not use simply never appears: no record carries its
 * key. A host with other levels (a cohort, a school, a course run) passes its
 * own list wherever a `levels` option is taken, widest first.
 */
export const RECORD_LEVELS = Object.freeze([
  { id: 'class', key: 'class_id', labelKey: 'class_label', label: 'Class', plural: 'Classes' },
  { id: 'group', key: 'group_id', labelKey: 'group_label', label: 'Group', plural: 'Groups' },
  { id: 'person', key: 'user_id', labelKey: 'user_label', label: 'Person', plural: 'People' },
  { id: 'session', key: 'session_id', labelKey: null, label: 'Session', plural: 'Sessions' },
].map(Object.freeze));

/** Bucket for records that carry no value at a level above the person. */
export const NO_LEVEL_VALUE = '__none__';

/**
 * A record's unit at one level: its `key` field (direct, or under
 * `context`). Records with no value fall into the documented bucket —
 * `__default__` for sessions, `__unknown__` for people, `__none__` otherwise.
 */
export function recordLevelValue(record, key) {
  const value = identityField(record, key);
  if (value !== null) return value;
  if (key === 'session_id') return DEFAULT_SESSION;
  if (key === 'user_id') return DEFAULT_USER;
  return NO_LEVEL_VALUE;
}

/** Whether a record carries a real value (not a bucket) at `key`. */
export function recordHasLevel(record, key) {
  return identityField(record, key) !== null;
}

/** A record's display name at a level, or `null`. */
export function recordLevelLabel(record, labelKey) {
  return labelKey ? identityField(record, labelKey) : null;
}

/** `session_id` of any record kind (`context.session_id` for log events); `__default__` when absent. */
export function recordSessionId(record) {
  return identityField(record, 'session_id') ?? DEFAULT_SESSION;
}

/** `user_id` of any record kind; `__unknown__` when absent. */
export function recordUserId(record) {
  return identityField(record, 'user_id') ?? DEFAULT_USER;
}

/** `group_id` of any record kind, or `null`. */
export function recordGroupId(record) {
  return identityField(record, 'group_id');
}

/** `context_id` (the document, case, conversation or task) of any record kind, or `null`. */
export function recordContextId(record) {
  return identityField(record, 'context_id');
}

/** `user_label` of any record kind, or `null`. */
export function recordUserLabel(record) {
  return identityField(record, 'user_label');
}

/**
 * Keep the records one embed scope is allowed to draw.
 *
 *   scopeRecords(records, { scope: 'person', userId: 'student-42' })
 *
 *   - `scope: 'session'`  only `sessionId`'s records. No `sessionId` means
 *                         no records, never a fallback to another session.
 *   - `scope: 'person'`   every session of `userId`. No `userId` means no
 *                         records.
 *   - `scope: 'group'`    every record handed in. The host already filtered
 *                         to what this reader may see.
 *
 * `sessionIds` / `userIds` narrow further within the scope (the session list
 * and the person filter); `null` or an empty array means no narrowing.
 * `filters` narrows at any other level: `{ group_id: ['team-a'] }` keeps the
 * records whose `group_id` is listed. Narrowing only ever removes records.
 *
 * Any `scope` other than `'session'` and `'person'` (`'group'`, `'class'`, a
 * host's own widest level) draws every record handed in.
 * Works on any record kind. Returns a new array; the input is not changed.
 */
export function scopeRecords(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  // 'session' and 'person' bind to one unit; every wider level draws all
  // that was fed. A name that is not a known level is the narrowest scope,
  // so a typo can never widen what is drawn.
  const levels = Array.isArray(options.levels) ? options.levels : RECORD_LEVELS;
  const isWideLevel = levels.some((level) => level.id === options.scope && level.id !== 'person' && level.id !== 'session');
  const scope = options.scope === 'person' ? 'person' : isWideLevel ? 'all' : 'session';
  const keyFilters = Object.entries(isObject(options.filters) ? options.filters : {})
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([key, ids]) => [key, new Set(ids)]);
  const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : null;
  const userId = typeof options.userId === 'string' && options.userId.length > 0 ? options.userId : null;
  const sessionIds = Array.isArray(options.sessionIds) && options.sessionIds.length > 0 ? new Set(options.sessionIds) : null;
  const userIds = Array.isArray(options.userIds) && options.userIds.length > 0 ? new Set(options.userIds) : null;

  if (scope === 'session' && sessionId === null) return [];
  if (scope === 'person' && userId === null) return [];

  return list.filter((record) => {
    const session = recordSessionId(record);
    const user = recordUserId(record);
    if (scope === 'session' && session !== sessionId) return false;
    if (scope === 'person' && user !== userId) return false;
    if (sessionIds && !sessionIds.has(session)) return false;
    if (userIds && !userIds.has(user)) return false;
    for (const [key, ids] of keyFilters) {
      if (!ids.has(recordLevelValue(record, key))) return false;
    }
    return true;
  });
}

/**
 * What a scoped view states in its header: how many sessions, people and
 * records it is drawing. `recordSets` is the list of record arrays in view
 * (windows, episode windows, events, log events).
 *
 * Returns `{ sessions, people, records }`.
 */
export function countScopedRecords(recordSets) {
  const sessions = new Set();
  const people = new Set();
  let records = 0;
  for (const set of Array.isArray(recordSets) ? recordSets : []) {
    for (const record of Array.isArray(set) ? set : []) {
      sessions.add(recordSessionId(record));
      people.add(recordUserId(record));
      records += 1;
    }
  }
  return { sessions: sessions.size, people: people.size, records };
}

function recordTimeMs(record) {
  if (!isObject(record)) return null;
  for (const value of [record.window_end_ms, record.window_end, record.window_start, record.timestamp]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function flatten(recordSets) {
  const out = [];
  for (const set of Array.isArray(recordSets) ? recordSets : []) {
    for (const record of Array.isArray(set) ? set : []) out.push(record);
  }
  return out;
}

/**
 * The sessions present in a set of record arrays, newest first: one row per
 * session, as `{ id, records, people, lastMs }` — its record count, how many
 * people recorded in it, and the time of its latest record (`null` when no
 * record carried a time).
 */
export function listScopedSessions(recordSets) {
  const sessions = new Map();
  for (const record of flatten(recordSets)) {
    const id = recordSessionId(record);
    if (!sessions.has(id)) sessions.set(id, { id, records: 0, users: new Set(), lastMs: null });
    const row = sessions.get(id);
    row.records += 1;
    row.users.add(recordUserId(record));
    const time = recordTimeMs(record);
    if (time !== null && (row.lastMs === null || time > row.lastMs)) row.lastMs = time;
  }
  return [...sessions.values()]
    .map(({ id, records, users, lastMs }) => ({ id, records, people: users.size, lastMs }))
    .sort((a, b) => (b.lastMs ?? -Infinity) - (a.lastMs ?? -Infinity) || a.id.localeCompare(b.id));
}

/**
 * The people present in a set of record arrays, in first-seen order: one row
 * per person, as `{ id, label, records, sessions }`. `label` is the first
 * `user_label` any of the person's records carries, else the id.
 */
export function listScopedPeople(recordSets) {
  const people = new Map();
  for (const record of flatten(recordSets)) {
    const id = recordUserId(record);
    if (!people.has(id)) people.set(id, { id, label: null, records: 0, sessionIds: new Set() });
    const row = people.get(id);
    row.records += 1;
    row.sessionIds.add(recordSessionId(record));
    if (row.label === null) row.label = recordUserLabel(record);
  }
  return [...people.values()].map(({ id, label, records, sessionIds }) => ({
    id,
    label: label ?? id,
    records,
    sessions: sessionIds.size,
  }));
}

/**
 * The levels a set of records can actually be aggregated at, widest first:
 * each level of `levels` (default `RECORD_LEVELS`) that at least one record
 * carries a value for, with how many distinct units it has, as
 * `{ id, key, labelKey, label, plural, units }`. Person and session are
 * always listed when there are any records.
 */
export function listRecordLevels(recordSets, options = {}) {
  const levels = Array.isArray(options.levels) ? options.levels : RECORD_LEVELS;
  const records = flatten(recordSets);
  if (records.length === 0) return [];
  return levels
    .map((level) => {
      const always = level.key === 'user_id' || level.key === 'session_id';
      const present = always || records.some((record) => recordHasLevel(record, level.key));
      if (!present) return null;
      const units = new Set(records.map((record) => recordLevelValue(record, level.key)));
      return { ...level, units: units.size };
    })
    .filter((level) => level !== null);
}
