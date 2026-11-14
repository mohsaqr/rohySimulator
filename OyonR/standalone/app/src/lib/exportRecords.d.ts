export type ExportRecordKind = 'signal_windows' | 'signal_events' | 'log_events' | 'metrics' | 'raw_windows';
export declare const EXPORT_RECORD_KINDS: ReadonlyArray<ExportRecordKind>;

type Rec = Record<string, unknown>;
export interface RecordSetsInput {
  signalWindows?: ReadonlyArray<object>;
  signalEvents?: ReadonlyArray<object>;
  logEvents?: ReadonlyArray<object>;
  metrics?: ReadonlyArray<object>;
  /** Raw-only envelopes (`modality: 'raw'`). */
  rawWindows?: ReadonlyArray<object>;
}
export interface CollectedRecords {
  signal_windows: Rec[];
  signal_events: Rec[];
  log_events: Rec[];
  metrics: Rec[];
  raw_windows: Rec[];
}

export declare function collectRecords(sets: RecordSetsInput, keep: (record: object) => boolean): CollectedRecords;
export declare function inSessions(sessionIds: Iterable<string>): (record: object) => boolean;
export declare function ofPeople(userIds: Iterable<string>): (record: object) => boolean;
export declare function recordCounts(records: Partial<Record<ExportRecordKind, unknown[]>>): Record<ExportRecordKind, number>;
