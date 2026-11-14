/*
 * typingAnalytics — the pooled typing summaries the /analyze/typing dashboard
 * renders. The functions live in the Oyon library
 * (src/analytics/TypingEpisodeAnalytics.js) so a host can compute the same
 * person and group figures the dashboard shows; this module only re-exports
 * them for the app's existing import path.
 *
 * Null discipline is the library's and is unchanged: a `null` figure means
 * "not measured" and renders "—", never 0. Rates divide pooled totals; they
 * are never an average of per-episode rates.
 */
export {
  aggregateTypingEpisodes,
  summarizeTypingBy,
  compareTypingSummaries,
  episodeCharsPerMin,
  pauseBucketLabel,
  PAUSE_LOCATION_ORDER,
  TYPING_SUMMARY_MEASURES,
} from 'oyon';
export type {
  TypingAggregateSummary,
  TypingSummaryRow,
  TypingSummaryComparisonRow,
  TypingSummaryMeasureKind,
} from 'oyon';
