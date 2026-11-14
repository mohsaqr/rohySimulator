import type { EmotionWindow } from './index.js';
import type { GazeAoi } from './gaze.js';
import type { HostRecordCounts, HostRecordsInput, RefusedHostRecord } from './records.js';

/** Public host API installed by the side-effect-only `oyon/app-element` entry. */
export interface OyonAppElement extends HTMLElement {
  readonly version: string;
  readonly hostContractVersion: string;
  getToken: (() => string | null | Promise<string | null>) | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  setWindows(windows: EmotionWindow[] | null): void;
  /**
   * Feed every record kind the host stored. While set it is the only data
   * source for the dashboards and is held in memory only; `null` returns to
   * the element's own local store. Emits `oyon:records`.
   */
  setRecords(records: HostRecordsInput | null): void;
  setGazeAois(aois: GazeAoi[] | null): void;
}

export interface OyonAppElementConstructor extends CustomElementConstructor {
  readonly version: string;
  readonly hostContractVersion: string;
  new (): OyonAppElement;
}

export interface OyonWindowEventDetail {
  windows: EmotionWindow[];
  sessionId: string;
  userId: string;
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonStatusEventDetail {
  state: string;
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonSampleEventDetail {
  dominant: string | null;
  confidence: number;
  valence: number | null;
  arousal: number | null;
  probabilities: Record<string, number>;
  face: { x: number; y: number; width: number; height: number } | null;
  ts: number;
  oyonVersion: string;
  contractVersion: string;
}

/** Emitted after every `setRecords()` with a non-null argument. */
export interface OyonRecordsEventDetail {
  accepted: HostRecordCounts;
  refused: HostRecordCounts;
  /** Up to 50 refused records: which kind, its index, and why. */
  reasons: RefusedHostRecord[];
  oyonVersion: string;
  contractVersion: string;
}

/** Emitted when the reader presses the close control (`closable`). */
export interface OyonCloseEventDetail {
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonOpenAnalyticsEventDetail {
  sessionId: string;
  userId: string | null;
  oyonVersion: string;
  contractVersion: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'oyon-app': OyonAppElement;
  }

  interface HTMLElementEventMap {
    'oyon:window': CustomEvent<OyonWindowEventDetail>;
    'oyon:status': CustomEvent<OyonStatusEventDetail>;
    'oyon:sample': CustomEvent<OyonSampleEventDetail>;
    'oyon:open-analytics': CustomEvent<OyonOpenAnalyticsEventDetail>;
    'oyon:records': CustomEvent<OyonRecordsEventDetail>;
    'oyon:close': CustomEvent<OyonCloseEventDetail>;
  }

  interface CustomElementRegistry {
    get(name: 'oyon-app'): OyonAppElementConstructor | undefined;
  }
}
