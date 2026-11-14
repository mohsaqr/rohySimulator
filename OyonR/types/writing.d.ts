// Type declarations for the writing analytics (src/analytics/WritingAnalytics.js): what a writer did to a
// document, pooled from `document_edit` signal events. Hand-written; the source is authoritative.

export type WritingOrigin = 'typed' | 'pasted' | 'ai' | 'system';
export const WRITING_ORIGINS: readonly WritingOrigin[];

/** One `document_edit` event as a plain act. A count the host did not supply is `null`. */
export interface WritingAct {
  t: number;
  state: string;
  origin: WritingOrigin;
  userId: string;
  userLabel: string | null;
  sessionId: string;
  contextId: string | null;
  graphemesAdded: number | null;
  graphemesRemoved: number | null;
  wordsAdded: number | null;
  wordsRemoved: number | null;
  blockKind: string | null;
}

export interface WritingOriginSummary {
  acts: number;
  /** Graphemes added from this origin; `null` when no edit measured them. */
  graphemes: number | null;
  words: number | null;
  /** Share of all added graphemes, 0–1; `null` when not measured. */
  share: number | null;
}

export interface WritingSummary {
  acts: number;
  firstMs: number | null;
  lastMs: number | null;
  graphemesAdded: number | null;
  graphemesRemoved: number | null;
  netGraphemes: number | null;
  wordsAdded: number | null;
  wordsRemoved: number | null;
  netWords: number | null;
  /** Removed graphemes over added graphemes; `null` when not measured. */
  removedRatio: number | null;
  origins: Record<WritingOrigin, WritingOriginSummary>;
  /** Edits per `document_edit` state. */
  states: Record<string, number>;
  /** Blocks added, removed and moved. */
  structural: { added: number; removed: number; moved: number };
  people: number;
  sessions: number;
  contexts: number;
}

export interface WritingSummaryRow extends WritingSummary {
  key: string;
  label: string;
  /** The row's added graphemes out of all rows'; `null` when not measured. */
  share: number | null;
}

export interface WritingTimelinePoint {
  t: number;
  /** Net graphemes since the first recorded edit (not the document's length). */
  net: number;
  netWords: number | null;
  added: number;
  removed: number;
  origin: WritingOrigin;
  state: string;
  userId: string;
  sessionId: string;
}

export interface WritingDayPersonCell { day: string; person: string; added: number; removed: number }
export interface WritingByDayAndPerson {
  unit: 'words' | 'graphemes';
  days: string[];
  people: Array<{ key: string; label: string }>;
  cells: WritingDayPersonCell[];
  maxAdded: number;
  maxRemoved: number;
}

export function writingOrigin(event: { source?: string; state?: string }): WritingOrigin;
export function writingActs(events: unknown[]): WritingAct[];
export function summarizeWriting(events: unknown[]): WritingSummary;
export function summarizeWritingBy(
  events: unknown[],
  options?: { by?: 'person' | 'session' | 'context' | 'day'; utc?: boolean },
): WritingSummaryRow[];
export function writingTimeline(events: unknown[]): { points: WritingTimelinePoint[]; unmeasured: number };
export function writingByDayAndPerson(
  events: unknown[],
  options?: { utc?: boolean; unit?: 'words' | 'graphemes' },
): WritingByDayAndPerson;

export type WritingActName = 'write' | 'revise' | 'paste' | 'organise' | 'ai' | 'decide' | 'pause';
export const WRITING_ACTS: readonly WritingActName[];
export const WRITING_PAUSE_MS: number;
/**
 * One event as a writing act. An event with `modality: 'ai_assist'` is read by its state (`suggestion_request`
 * → `ai:ask`, `suggestion_accept` → `decide:kept`, `suggestion_reject` → `decide:rejected`) and gives `null`
 * for any other state; every other event is read as a document edit and never gives `null`.
 */
export function writingActOf(event: { modality?: string; state?: string; source?: string; detail?: unknown }): { act: WritingActName; detail: string | null } | null;
/**
 * The events the writing acts are read from, in time order: every `document_edit` event, and the `ai_assist`
 * requests, accepts and rejects of a person and session that also edited a document.
 */
export function writingActEvents<T = unknown>(events: T[], options?: { aiAssist?: boolean }): T[];
/** State chains of writing acts, one per person and session. `level: 'detail'` names `revise:delete`, `ai:ask`, … */
export function writingActSequences(
  events: unknown[],
  options?: { level?: 'main' | 'detail'; pauseMs?: number | null; aiAssist?: boolean },
): string[][];

export interface WritingActRow { act: WritingActName; count: number; share: number | null; details: Array<{ detail: string; count: number }> }
/** The coarse summary: the seven acts with counts, shares and details. */
export function summarizeWritingActs(events: unknown[], options?: { pauseMs?: number | null; aiAssist?: boolean }): { total: number; acts: WritingActRow[] };
