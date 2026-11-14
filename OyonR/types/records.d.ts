// Type declarations for the Oyon records subpath (`oyon/records`): the shape
// check and scope filter for records a host feeds back through
// `<oyon-app>.setRecords()`, and the oyon-log-v1 → signal-event mapping.
// Hand-written; see src/records/ for authoritative behaviour.

import type { EmotionWindow, OyonLogEvent, OyonMetric } from './index';
import type { SignalEvent, SignalEventModality, SignalEventSource } from './signal-events';

export type HostRecordKind = 'windows' | 'signalWindows' | 'signalEvents' | 'logEvents';
export const HOST_RECORD_KINDS: readonly HostRecordKind[];

/** Bucket for records with no `session_id`. */
export const DEFAULT_SESSION: '__default__';
/** Bucket for records with no `user_id`. */
export const DEFAULT_USER: '__unknown__';

/** What a host hands to `setRecords()`. A kind left out is an empty set. */
export interface HostRecordsInput {
  /** Interval windows: emotion, gaze, engagement, … */
  windows?: EmotionWindow[] | null;
  /** Episode windows: typing-v3, ai-assist-v1, voice, … */
  signalWindows?: Array<Record<string, unknown>> | null;
  /** Per-event states: typing-states-v1, interaction-states-v1, … */
  signalEvents?: SignalEvent[] | Array<Record<string, unknown>> | null;
  /** oyon-log-v1 events. */
  logEvents?: Array<Record<string, unknown>> | null;
}

export type HostRecordCounts = Record<HostRecordKind | 'total', number>;

/** One record that did not pass the shape check. */
export interface RefusedHostRecord {
  kind: HostRecordKind;
  /** Position in the array the host supplied. */
  index: number;
  reason: string;
}

export interface ValidatedHostRecords {
  records: Record<HostRecordKind, unknown[]>;
  refused: RefusedHostRecord[];
  counts: { accepted: HostRecordCounts; refused: HostRecordCounts };
}

/**
 * Shape-check everything a host feeds. Never throws on a bad record (it is
 * listed in `refused`); throws `TypeError` only when the argument is not an
 * object or a supplied kind is not an array.
 */
export function validateHostRecords(input: HostRecordsInput): ValidatedHostRecords;

export type RecordScopeName = 'session' | 'person' | 'group' | 'class' | (string & {});

export interface ScopeRecordsOptions {
  /** Default `'session'`. */
  scope?: RecordScopeName;
  /** The one session a `'session'` scope draws. None means no records. */
  sessionId?: string | null;
  /** The one person a `'person'` scope draws. None means no records. */
  userId?: string | null;
  /** Narrow within the scope; null or empty means no narrowing. */
  sessionIds?: string[] | null;
  userIds?: string[] | null;
  /** Narrow at any other level by record field: `{ group_id: ['team-a'] }`. */
  filters?: Record<string, string[]>;
  /** The host's own levels, when it has more than the built-in ones. */
  levels?: readonly RecordLevel[];
}

/** Keep the records one embed scope may draw. Works on any record kind. */
export function scopeRecords<T>(records: T[], options?: ScopeRecordsOptions): T[];

/** How many sessions, people and records a list of record arrays holds. */
export function countScopedRecords(recordSets: unknown[][]): {
  sessions: number;
  people: number;
  records: number;
};

/** One row per session, newest first. */
export function listScopedSessions(recordSets: unknown[][]): Array<{
  id: string;
  records: number;
  people: number;
  lastMs: number | null;
}>;

/** One row per person, in first-seen order. */
export function listScopedPeople(recordSets: unknown[][]): Array<{
  id: string;
  label: string;
  records: number;
  sessions: number;
}>;

export function recordSessionId(record: unknown): string;
export function recordUserId(record: unknown): string;
export function recordGroupId(record: unknown): string | null;
export function recordContextId(record: unknown): string | null;
export function recordUserLabel(record: unknown): string | null;

/** How one host log event name maps onto a closed state vocabulary. */
export interface LogEventMappingRule {
  modality: SignalEventModality;
  state: string;
  /** Default `'user'`. */
  source?: SignalEventSource;
  /** Builds the event's `detail` from the log event's `details`. */
  detail?: (details: Record<string, unknown>) => Record<string, unknown> | null;
}

/**
 * Map stored `oyon-log-v1` events to signal events on a closed vocabulary.
 * Throws `TypeError` when the mapping names an unknown modality or state.
 */
export function mapLogEventsToSignalEvents(
  logEvents: Array<Record<string, unknown>>,
  mapping: Record<string, LogEventMappingRule>,
): {
  events: SignalEvent[];
  unmapped: Array<{ index: number; event_name: string | null; reason: string }>;
};

/** One row of `summarizeRecordsBy`: a session or a person, across every record kind. */
export interface RecordSummaryRow {
  key: string;
  label: string;
  /** By session: the session's person, null when it holds more than one. */
  userId: string | null;
  userLabel: string | null;
  people: number;
  sessions: number;
  firstMs: number | null;
  lastMs: number | null;
  spanMs: number | null;
  records: number;
  windows: number;
  typingEpisodes: number;
  voiceTurns: number;
  events: number;
  logEvents: number;
  /** Sorted names of every signal present. */
  modalities: string[];
  dominantEmotion: string | null;
  dominantShare: number | null;
  meanValence: number | null;
  meanFocus: number | null;
  /** Pooled over the row's typing episodes; null when it has none. */
  typingActiveMs: number | null;
  charsPerMinActive: number | null;
  revisionRatio: number | null;
}

/**
 * One row per session (newest first) or per person (first-seen order),
 * counting interval windows, episode windows, events and log events together.
 * Throws `TypeError` on an unknown `by`.
 */
export function summarizeRecordsBy(
  records: HostRecordsInput,
  options?: { by?: string; levels?: readonly RecordLevel[] },
): RecordSummaryRow[];

/** One aggregation level: an identity field records can be grouped by. */
export interface RecordLevel {
  /** `'class'`, `'group'`, `'person'`, `'session'`, or a host's own. */
  id: string;
  /** The record field: `class_id`, `group_id`, `user_id`, `session_id`. */
  key: string;
  /** An optional display-name field beside it. */
  labelKey: string | null;
  label: string;
  plural: string;
}

/** The built-in levels, widest first: class, group, person, session. */
export const RECORD_LEVELS: readonly RecordLevel[];

/** A record's unit at a level (`__none__` when it carries no value there). */
export function recordLevelValue(record: unknown, key: string): string;

/** The levels present in a set of record arrays, widest first, with unit counts. */
export function listRecordLevels(
  recordSets: unknown[][],
  options?: { levels?: readonly RecordLevel[] },
): Array<RecordLevel & { units: number }>;

/** Which kinds of record a set holds. */
export interface RecordKinds {
  /** Any interval window (emotion, gaze, engagement, …). */
  windows: boolean;
  /** A typing episode window. */
  typing: boolean;
  /** A voice turn window. */
  voice: boolean;
  /** Any signal event. */
  events: boolean;
  logEvents: boolean;
  /** Every episode-window modality present, sorted. */
  modalities: string[];
  /** Every signal-event modality present, sorted. */
  eventModalities: string[];
}
/** What is in a record set, so a dashboard offers only the pages it can fill. */
export function recordKindsOf(records: HostRecordsInput | Record<HostRecordKind, unknown[]> | null): RecordKinds;

// ─── One log over every record kind (src/records/logRows.js) ───────────────

/** Row kinds, in the order a tie at the same instant is listed. */
export type LogRowKind = 'window' | 'episode' | 'event' | 'log' | 'metric';
export const LOG_ROW_KINDS: readonly LogRowKind[];

/** Every record kind `toLogRows` reads; a kind left out is empty. */
export interface LogRecordsInput {
  windows?: ReadonlyArray<EmotionWindow | Record<string, unknown>> | null;
  signalWindows?: ReadonlyArray<Record<string, unknown>> | null;
  signalEvents?: ReadonlyArray<SignalEvent | Record<string, unknown>> | null;
  /** `oyon-log-v1` runtime or host log events. */
  logEvents?: ReadonlyArray<OyonLogEvent | Record<string, unknown>> | null;
  /** `oyon-metric-v1` runtime metrics. */
  metrics?: ReadonlyArray<OyonMetric | Record<string, unknown>> | null;
}

/** One record of any kind, in the one log's shape. */
export interface LogRow {
  /** `<kind>:<index in its input array>` — unique within one call. */
  id: string;
  kind: LogRowKind;
  index: number;
  /** Start (windows, episodes) or the instant (events, logs, metrics); null when unreadable. */
  ts_ms: number | null;
  end_ms: number | null;
  duration_ms: number | null;
  session_id: string | null;
  user_id: string | null;
  group_id: string | null;
  /** Window: its modality or `'camera'`; episode/event: modality; `'log'`; `'metric'`. */
  channel: string;
  /** Window: dominant emotion; episode: window kind; event: state; log: event name; metric: metric name. */
  label: string | null;
  source: string | null;
  /** Log events only: debug | info | warn | error. */
  level: string | null;
  /** Window: confidence; metric: its value. */
  value: number | null;
  unit: string | null;
  /** Window: the signal blocks it carries (`engagement`, `gaze`, `raw_streams`, …). */
  blocks: string[];
  /** The record the row was read from, unchanged. */
  record: Record<string, unknown>;
}

/**
 * Every record as one log row, oldest first (`order: 'desc'` for newest first).
 * Throws `TypeError` when `records` is not an object, a supplied kind is not
 * an array, or `kinds` names an unknown kind.
 */
export function toLogRows(
  records: LogRecordsInput,
  options?: { kinds?: readonly LogRowKind[]; order?: 'asc' | 'desc' },
): LogRow[];

export interface LogRowSummary {
  total: number;
  kinds: Record<LogRowKind, number>;
  channels: Record<string, number>;
  levels: Record<string, number>;
  sessions: number;
  people: number;
  firstMs: number | null;
  lastMs: number | null;
}
/** Counts per kind, channel and level, distinct sessions and people, and the time span. */
export function summarizeLogRows(rows: readonly LogRow[]): LogRowSummary;

/**
 * One record as flat dotted columns for a wide table or CSV. `raw_streams`
 * becomes its row count per stream (`raw_streams.eye.rows`).
 */
export function flattenLogRecord(
  record: Record<string, unknown>,
  options?: { maxDepth?: number },
): Record<string, string | number | boolean | null>;

/**
 * Rebuild windows split across POSTs: the parts sharing `raw_part.id` are
 * merged onto index 0 (rows concatenated per stream, `raw_part.joined` = parts
 * found). Parts without their index-0 window, and raw-only envelopes without
 * `raw_part`, are returned unchanged. Nothing is dropped.
 */
export function joinRawParts<T extends Record<string, unknown>>(windows: readonly T[]): T[];

/** The split side (also on the root `oyon` entry), for hosts that post windows themselves. */
export { chunkWindowBatch, rawPartId, DEFAULT_MAX_POST_BYTES } from './index';
