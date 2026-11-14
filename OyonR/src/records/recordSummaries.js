/**
 * recordSummaries — one row per session or per person across EVERY record
 * kind, for the overview dashboard.
 *
 * The session list used to be built from interval (camera) windows alone, so
 * a session that held only typing, or a host with no camera at all, did not
 * appear. A row here counts interval windows, episode windows, per-event
 * states and log events together, and carries the headline figure of each
 * signal the session actually recorded.
 *
 * Null discipline: a figure whose signal was not recorded is `null` ("—"),
 * never 0. A count is a count and may be 0.
 */

import { aggregateTypingEpisodes } from '../analytics/TypingEpisodeAnalytics.js';
import {
  RECORD_LEVELS,
  recordLevelLabel,
  recordLevelValue,
  recordSessionId,
  recordUserId,
  recordUserLabel,
} from './hostRecords.js';

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

/** `[startMs, endMs]` of any record kind; either may be `null`. */
function recordSpan(record) {
  if (!isObject(record)) return [null, null];
  const end = timeMs(record.window_end_ms ?? record.window_end) ?? timeMs(record.timestamp);
  const start = timeMs(record.window_start_ms ?? record.window_start) ?? end;
  return [start, end ?? start];
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function emptyGroup(key) {
  return {
    key,
    label: null,
    userLabel: null,
    userIds: new Set(),
    sessionIds: new Set(),
    firstMs: null,
    lastMs: null,
    windows: 0,
    typing: [],
    voiceTurns: 0,
    otherEpisodes: 0,
    events: 0,
    logEvents: 0,
    modalities: new Set(),
    emotionCounts: new Map(),
    focusSum: 0,
    focusCount: 0,
    valenceSum: 0,
    valenceCount: 0,
  };
}

function touch(group, record, level) {
  group.userIds.add(recordUserId(record));
  group.sessionIds.add(recordSessionId(record));
  if (group.label === null) group.label = recordLevelLabel(record, level.labelKey);
  if (group.userLabel === null) group.userLabel = recordUserLabel(record);
  const [start, end] = recordSpan(record);
  if (start !== null && (group.firstMs === null || start < group.firstMs)) group.firstMs = start;
  if (end !== null && (group.lastMs === null || end > group.lastMs)) group.lastMs = end;
}

/**
 * Summarise records per session or per person.
 *
 *   summarizeRecordsBy({ windows, signalWindows, signalEvents, logEvents }, { by: 'session' })
 *
 * `by` is the id of an aggregation level: `'session'`, `'person'`, `'group'`
 * or `'class'` (see `RECORD_LEVELS`), or a level of the host's own passed in
 * `options.levels`. Records with no value at the level pool into one
 * `__none__` row.
 *
 * Returns one row per group:
 *
 *   key, label           the session id, or the person's id and display name
 *   userId, userLabel    (by session) the session's person, `null` when the
 *                        session holds more than one
 *   people, sessions     distinct people / sessions in the row
 *   firstMs, lastMs      earliest start and latest end of its records
 *   spanMs               lastMs − firstMs, `null` when no record had a time
 *   records              all records in the row
 *   windows              interval windows
 *   typingEpisodes, voiceTurns, events, logEvents
 *   modalities           sorted names of every signal present
 *   dominantEmotion, dominantShare   over interval windows that carry a label
 *   meanValence, meanFocus           over interval windows that carry them
 *   typingActiveMs, charsPerMinActive, revisionRatio   pooled over the row's
 *                        typing episodes (see aggregateTypingEpisodes)
 *
 * Session rows come newest first; rows at every other level in first-seen
 * order. Throws `TypeError` on an unknown `by`.
 */
export function summarizeRecordsBy(records, options = {}) {
  const by = options.by ?? 'session';
  const levels = Array.isArray(options.levels) ? options.levels : RECORD_LEVELS;
  const level = levels.find((entry) => entry.id === by);
  if (!level) {
    throw new TypeError(
      `summarizeRecordsBy: \`by\` must be one of ${levels.map((entry) => entry.id).join(', ')}, got ${JSON.stringify(by)}`,
    );
  }
  const source = isObject(records) ? records : {};
  const keyOf = (record) => recordLevelValue(record, level.key);
  const groups = new Map();
  const groupOf = (record) => {
    const key = keyOf(record);
    if (!groups.has(key)) groups.set(key, emptyGroup(key));
    const group = groups.get(key);
    touch(group, record, level);
    return group;
  };
  const list = (kind) => (Array.isArray(source[kind]) ? source[kind] : []);

  for (const window of list('windows')) {
    const group = groupOf(window);
    group.windows += 1;
    group.modalities.add(typeof window.modality === 'string' ? window.modality : 'emotion');
    if (typeof window.dominant_emotion === 'string' && window.dominant_emotion.length > 0) {
      group.emotionCounts.set(window.dominant_emotion, (group.emotionCounts.get(window.dominant_emotion) ?? 0) + 1);
    }
    const focus = finite(isObject(window.engagement) ? window.engagement.focus_score : null);
    if (focus !== null) {
      group.focusSum += focus;
      group.focusCount += 1;
      group.modalities.add('engagement');
    }
    if (isObject(window.gaze)) group.modalities.add('gaze');
    const valence = finite(window.valence);
    if (valence !== null) {
      group.valenceSum += valence;
      group.valenceCount += 1;
    }
  }

  for (const window of list('signalWindows')) {
    const group = groupOf(window);
    if (typeof window.modality === 'string') group.modalities.add(window.modality);
    if (window.modality === 'typing' && isObject(window.typing)) group.typing.push(window);
    else if (window.modality === 'voice') group.voiceTurns += 1;
    else group.otherEpisodes += 1;
  }

  for (const event of list('signalEvents')) {
    const group = groupOf(event);
    group.events += 1;
    if (typeof event.modality === 'string') group.modalities.add(event.modality);
  }

  for (const logEvent of list('logEvents')) {
    groupOf(logEvent).logEvents += 1;
  }

  const rows = [...groups.values()].map((group) => {
    let dominantEmotion = null;
    let dominantCount = 0;
    let labelled = 0;
    for (const [emotion, count] of group.emotionCounts) {
      labelled += count;
      // Ties keep the first label seen: Map iteration is insertion order.
      if (count > dominantCount) {
        dominantEmotion = emotion;
        dominantCount = count;
      }
    }
    const typing = group.typing.length > 0 ? aggregateTypingEpisodes(group.typing) : null;
    const userIds = [...group.userIds];
    const singleUser = userIds.length === 1 ? userIds[0] : null;
    return {
      key: group.key,
      label: group.label ?? group.key,
      // The row's one person, when it holds exactly one (always, for a
      // person row; usually, for a session row).
      userId: singleUser,
      userLabel: singleUser !== null ? group.userLabel ?? singleUser : null,
      people: group.userIds.size,
      sessions: group.sessionIds.size,
      firstMs: group.firstMs,
      lastMs: group.lastMs,
      spanMs: group.firstMs !== null && group.lastMs !== null ? group.lastMs - group.firstMs : null,
      records: group.windows + group.typing.length + group.voiceTurns + group.otherEpisodes + group.events + group.logEvents,
      windows: group.windows,
      typingEpisodes: group.typing.length,
      voiceTurns: group.voiceTurns,
      events: group.events,
      logEvents: group.logEvents,
      modalities: [...group.modalities].sort(),
      dominantEmotion,
      dominantShare: labelled > 0 ? dominantCount / labelled : null,
      meanValence: group.valenceCount > 0 ? group.valenceSum / group.valenceCount : null,
      meanFocus: group.focusCount > 0 ? group.focusSum / group.focusCount : null,
      typingActiveMs: typing ? typing.totalActiveMs : null,
      charsPerMinActive: typing ? typing.charsPerMinActive : null,
      revisionRatio: typing ? typing.revisionRatio : null,
    };
  });

  if (level.key === 'session_id') {
    rows.sort((a, b) => (b.lastMs ?? -Infinity) - (a.lastMs ?? -Infinity) || a.key.localeCompare(b.key));
  }
  return rows;
}
