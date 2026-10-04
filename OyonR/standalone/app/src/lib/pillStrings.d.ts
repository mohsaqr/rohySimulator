export declare const PILL_LANGS: readonly ['en', 'de', 'es', 'it', 'fi', 'sv', 'fr', 'kk'];
export type PillLang = (typeof PILL_LANGS)[number];

export declare const PILL_STRING_KEYS: readonly [
  'pillLabel',
  'ready',
  'error',
  'starting',
  'capturing',
  'paused',
  'startCapture',
  'startingCapture',
  'pauseCapture',
  'resumeCapture',
  'stopCapture',
  'calibrateGaze',
  'recalibrateGaze',
  'calibratingGaze',
  'gazeError',
  'gazeActive',
  'gazeNoSignal',
  'gazeWaiting',
  'gazeWaitingStatus',
  'openAnalytics',
  'openAnalyticsUnavailable',
  'emotion_anger',
  'emotion_contempt',
  'emotion_disgust',
  'emotion_fear',
  'emotion_happy',
  'emotion_neutral',
  'emotion_sad',
  'emotion_surprise',
];
export type PillStringKey = (typeof PILL_STRING_KEYS)[number];
export type PillStrings = Readonly<Record<PillStringKey, string>>;
/** Host overrides from the `labels` attribute: any subset of the keys. */
export type PillLabels = Readonly<Partial<Record<PillStringKey, string>>>;

export declare const PILL_STRING_TABLE: Readonly<Record<PillLang, PillStrings>>;

export interface ParsedPillLang {
  lang: PillLang;
  /** False when a non-empty value named a language without a table (→ 'en'). */
  recognized: boolean;
}
export declare function parsePillLang(value: string | null | undefined): ParsedPillLang;

export interface ParsedPillLabels {
  /** Valid overrides, or null when there are none. */
  labels: PillLabels | null;
  /** Human-readable reasons something was ignored (for a console warning). */
  problems: string[];
}
export declare function parsePillLabels(value: string | null | undefined): ParsedPillLabels;

export declare function pillStrings(lang: PillLang, labels?: PillLabels | null): PillStrings;

export declare function formatPillString(
  template: string,
  vars: Readonly<Record<string, string | number | null | undefined>>,
): string;

export declare function pillEmotionLabel(strings: PillStrings, raw: string): string;
