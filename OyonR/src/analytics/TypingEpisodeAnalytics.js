/**
 * TypingEpisodeAnalytics — pools typing episode windows (`typing-v3`, and
 * older `typing-v2` rows) into the summaries the typing dashboards render:
 * one summary for a set of episodes, and one row per person, per session or
 * per day for the person and group views. Pure functions over window
 * records; no IO.
 *
 * Null discipline (AUTHORITATIVE for this module): the aggregator emits
 * `null` — and older `typing-v2` rows simply omit v3 fields — when a
 * measurement was NOT MADE (no word counts supplied, no boundary contexts,
 * no positioned revisions). Every pooled figure here stays `null` in that
 * case so a dashboard renders "—"; coercing to 0 would assert a
 * measurement that never happened. Sums pool only what was measured;
 * rates and means divide pooled totals, and are never an average of
 * per-episode rates (episodes have very different durations).
 */

/** Ops that count as revisions — matches TypingAggregator's `revisionOps`. */
const REVISION_OPS = new Set(['delete', 'replace', 'correct']);

/** Leading-edge tolerance the aggregator defaults to when a row's quality block lacks it. */
const DEFAULT_LEADING_EDGE_TOLERANCE = 2;

/** Bucket for records that carry no `user_id` (see filterWindows.js). */
const UNKNOWN_USER = '__unknown__';
/** Bucket for records that carry no `session_id`. */
const UNKNOWN_SESSION = '__default__';

/** Canonical presentation order for pause locations (most → least local). */
export const PAUSE_LOCATION_ORDER = Object.freeze([
  'mid_word',
  'word_boundary',
  'sentence_boundary',
  'paragraph_boundary',
]);

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Ascending sort key for a pause-histogram bucket key (`lt_500_ms`,
 * `500_to_1000_ms`, `gte_5000_ms`, ...): the bucket's lower bound in ms.
 * Unrecognized keys sort last, preserving relative order.
 */
function pauseBucketLowerBound(key) {
  if (key.startsWith('lt_')) return 0;
  const gte = /^gte_(\d+)_ms$/.exec(key);
  if (gte) return Number(gte[1]);
  const range = /^(\d+)_to_\d+_ms$/.exec(key);
  if (range) return Number(range[1]);
  return Number.MAX_SAFE_INTEGER;
}

/** Human label for a pause-histogram bucket key; falls back to the raw key. */
export function pauseBucketLabel(key) {
  const seconds = (ms) => (ms % 1000 === 0 ? `${ms / 1000}` : `${(ms / 1000).toFixed(1)}`);
  const lt = /^lt_(\d+)_ms$/.exec(key);
  if (lt) return `< ${seconds(Number(lt[1]))} s`;
  const gte = /^gte_(\d+)_ms$/.exec(key);
  if (gte) return `≥ ${seconds(Number(gte[1]))} s`;
  const range = /^(\d+)_to_(\d+)_ms$/.exec(key);
  if (range) return `${seconds(Number(range[1]))}–${seconds(Number(range[2]))} s`;
  return key;
}

/**
 * Episode fluency for a per-episode table: the stored v3 `chars_per_min`
 * when present, else recomputed from the always-present v1 fields (identical
 * formula). Null when the episode had no elapsed time.
 */
export function episodeCharsPerMin(typing) {
  const stored = num(typing.chars_per_min);
  if (stored !== null) return stored;
  const elapsed = num(typing.elapsed_ms) ?? 0;
  const committed = num(typing.committed_graphemes) ?? 0;
  return elapsed > 0 ? committed / (elapsed / 60000) : null;
}

/**
 * Pool typing episode windows into one summary. Returns a
 * `TypingAggregateSummary` (see types/typing.d.ts): counts and sums are
 * numbers, and every figure that needs a measurement the episodes may not
 * carry is `number | null`.
 */
export function aggregateTypingEpisodes(episodes) {
  let submitted = 0;
  let abandoned = 0;
  let totalElapsedMs = 0;
  let totalActiveMs = 0;
  let committedGraphemes = 0;
  let insertedGraphemes = 0;
  let deletedGraphemes = 0;

  // Word totals pool ONLY episodes that measured words; their elapsed/active
  // denominators are tracked separately so unmeasured episodes don't dilute
  // the rate.
  let sawProduced = false;
  let producedGraphemes = 0;
  let survivedGraphemes = 0;
  let episodeProduction = 0;
  let wordTotal = 0;
  let wordElapsedMs = 0;
  let sawWords = false;
  let wordActiveTotal = 0;
  let wordActiveMs = 0;
  let sawWordsActive = false;

  const pauseHistogram = {};
  const pauseLocations = {};
  let sawPauseLocations = false;

  let sawBursts = false;
  let pBurstCount = 0;
  let rBurstCount = 0;
  let pBurstGraphemes = 0;
  let rBurstGraphemes = 0;

  let revisionCount = 0;
  let revisionDistanceSum = 0;
  let leadingEdgeCount = 0;
  let sawRevisionDistances = false;
  let sawCorrections = false;
  let correctionCount = 0;

  for (const episode of episodes) {
    const t = episode.typing;
    if (t.submitted) submitted += 1;
    if (t.abandoned) abandoned += 1;
    const elapsed = num(t.elapsed_ms) ?? 0;
    const active = num(t.active_input_ms) ?? 0;
    const committed = num(t.committed_graphemes) ?? 0;
    totalElapsedMs += elapsed;
    totalActiveMs += active;
    committedGraphemes += committed;
    const inserted = num(t.inserted_graphemes) ?? 0;
    const deleted = num(t.deleted_graphemes) ?? 0;
    insertedGraphemes += inserted;
    deletedGraphemes += deleted;
    // The episode's own net production, floored at 0 exactly as the
    // aggregator floors it for the episode's rates (TypingAggregator
    // "Episode baseline"): text that was already in the document when the
    // episode opened is not something the episode wrote.
    episodeProduction += Math.max(0, inserted - deleted);

    // produced_graphemes is v3; on v2 rows inserted_graphemes is the same
    // accumulator under its v1 name (see TypingAggregator.finalize()).
    const produced = num(t.produced_graphemes) ?? num(t.inserted_graphemes);
    if (produced !== null) {
      sawProduced = true;
      producedGraphemes += produced;
      survivedGraphemes += Math.max(0, produced - deleted);
    }

    // Words: recover the episode's word count from its rate x its own
    // denominator, then pool counts over pooled denominators.
    const wpm = num(t.words_per_min);
    if (wpm !== null && elapsed > 0) {
      sawWords = true;
      wordTotal += wpm * (elapsed / 60000);
      wordElapsedMs += elapsed;
    }
    const wpmActive = num(t.words_per_min_active);
    if (wpmActive !== null && active > 0) {
      sawWordsActive = true;
      wordActiveTotal += wpmActive * (active / 60000);
      wordActiveMs += active;
    }

    if (t.pause_histogram && typeof t.pause_histogram === 'object') {
      for (const [key, count] of Object.entries(t.pause_histogram)) {
        const n = num(count);
        if (n !== null) pauseHistogram[key] = (pauseHistogram[key] ?? 0) + n;
      }
    }
    if (t.pause_location_counts && typeof t.pause_location_counts === 'object') {
      sawPauseLocations = true;
      for (const [key, count] of Object.entries(t.pause_location_counts)) {
        const n = num(count);
        if (n !== null) pauseLocations[key] = (pauseLocations[key] ?? 0) + n;
      }
    }

    const pCount = num(t.p_burst_count);
    const rCount = num(t.r_burst_count);
    if (pCount !== null || rCount !== null) {
      sawBursts = true;
      pBurstCount += pCount ?? 0;
      rBurstCount += rCount ?? 0;
      // Pooled mean = total graphemes / total bursts, reconstructed from each
      // episode's mean x count (mean is 0 when the count is 0).
      pBurstGraphemes += (num(t.p_burst_mean_graphemes) ?? 0) * (pCount ?? 0);
      rBurstGraphemes += (num(t.r_burst_mean_graphemes) ?? 0) * (rCount ?? 0);
    }

    // Revision distances: recompute from revision_locations (the aggregator
    // derives its own mean/median from the same capped array, so pooling the
    // entries is exactly consistent), honoring each episode's own
    // leading-edge tolerance.
    const tolerance =
      num(episode.quality?.thresholds && episode.quality.thresholds.leading_edge_tolerance_graphemes)
      ?? DEFAULT_LEADING_EDGE_TOLERANCE;
    for (const entry of Array.isArray(t.revision_locations) ? t.revision_locations : []) {
      if (!REVISION_OPS.has(entry.op)) continue;
      const distance = num(entry.distance);
      if (distance === null) continue; // typing-v2 rows carry no distance — not measured.
      sawRevisionDistances = true;
      revisionCount += 1;
      revisionDistanceSum += distance;
      if (distance <= tolerance) leadingEdgeCount += 1;
    }

    const corrections = num(t.correction_count);
    if (corrections !== null) {
      sawCorrections = true;
      correctionCount += corrections;
    }
  }

  const orderedHistogram = {};
  for (const key of Object.keys(pauseHistogram).sort((a, b) => pauseBucketLowerBound(a) - pauseBucketLowerBound(b))) {
    orderedHistogram[key] = pauseHistogram[key];
  }

  const orderedLocations = {};
  if (sawPauseLocations) {
    for (const key of PAUSE_LOCATION_ORDER) {
      if (key in pauseLocations) orderedLocations[key] = pauseLocations[key];
    }
    for (const key of Object.keys(pauseLocations)) {
      if (!(key in orderedLocations)) orderedLocations[key] = pauseLocations[key];
    }
  }

  return {
    episodes: episodes.length,
    submitted,
    abandoned,
    totalElapsedMs,
    totalActiveMs,
    committedGraphemes,
    // What the episodes themselves added to their documents, net of what
    // they deleted: Σ (inserted − deleted). `committedGraphemes` above is a
    // sum of DOCUMENT lengths at episode end, so for an editor that opens
    // onto existing text it counts that text once per episode; this figure
    // does not, which is why shares of text are computed from it.
    netGraphemes: insertedGraphemes - deletedGraphemes,
    producedGraphemes: sawProduced ? producedGraphemes : null,
    // Rates and the product ratio are scoped to what the episodes produced,
    // as the aggregator scopes each episode's own: an episode that opens on
    // a 2,000-grapheme draft and adds 10 produced 10, not 2,010. For
    // episodes that start from an empty editor these equal the classic
    // committed-based figures.
    productRatio: sawProduced && producedGraphemes > 0 ? survivedGraphemes / producedGraphemes : null,
    charsPerMin: totalElapsedMs > 0 ? episodeProduction / (totalElapsedMs / 60000) : null,
    charsPerMinActive: totalActiveMs > 0 ? episodeProduction / (totalActiveMs / 60000) : null,
    wordsPerMin: sawWords && wordElapsedMs > 0 ? wordTotal / (wordElapsedMs / 60000) : null,
    wordsPerMinActive: sawWordsActive && wordActiveMs > 0 ? wordActiveTotal / (wordActiveMs / 60000) : null,
    pauseHistogram: orderedHistogram,
    pauseLocationCounts: sawPauseLocations ? orderedLocations : null,
    pBurstCount: sawBursts ? pBurstCount : null,
    rBurstCount: sawBursts ? rBurstCount : null,
    pBurstMeanGraphemes: sawBursts && pBurstCount > 0 ? pBurstGraphemes / pBurstCount : null,
    rBurstMeanGraphemes: sawBursts && rBurstCount > 0 ? rBurstGraphemes / rBurstCount : null,
    revisionRatio: insertedGraphemes > 0 ? deletedGraphemes / insertedGraphemes : null,
    revisionDistanceMean: sawRevisionDistances && revisionCount > 0 ? revisionDistanceSum / revisionCount : null,
    leadingEdgeRevisionRatio: sawRevisionDistances && revisionCount > 0 ? leadingEdgeCount / revisionCount : null,
    correctionCount: sawCorrections ? correctionCount : null,
  };
}

function stringField(record, key) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record[key] === 'string' && record[key].length > 0) return record[key];
  const context = record.context;
  if (context && typeof context[key] === 'string' && context[key].length > 0) return context[key];
  return null;
}

/** `YYYY-MM-DD` of an episode's start, in local time or (with `utc`) UTC. */
function dayKeyOf(episode, utc) {
  const ms = Date.parse(episode.window_start);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return utc
    ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const GROUPERS = {
  person: (episode) => stringField(episode, 'user_id') ?? UNKNOWN_USER,
  session: (episode) => stringField(episode, 'session_id') ?? UNKNOWN_SESSION,
  day: (episode, options) => dayKeyOf(episode, options.utc === true) ?? 'unknown',
};

/**
 * One row per person, per session or per day: the episodes of that group
 * pooled with `aggregateTypingEpisodes`, plus the group's share of the text
 * all rows together committed.
 *
 *   summarizeTypingBy(episodes, { by: 'person' })
 *
 * Returns an array of `{ key, label, summary, textShare }`, in first-seen
 * order for `person` and `session` and in ascending date order for `day`.
 *
 *   - `key`        the `user_id`, `session_id` or `YYYY-MM-DD` day.
 *   - `label`      the person's `user_label` when a record carries one,
 *                  else the key.
 *   - `summary`    `aggregateTypingEpisodes()` over the row's episodes.
 *   - `textShare`  the row's net committed graphemes (`summary.netGraphemes`,
 *                  floored at 0) over the same sum across all rows; `null`
 *                  when no row committed any text.
 *
 * `by: 'day'` buckets on the episode's `window_start` in local time; pass
 * `utc: true` for UTC days. Records with no `user_id` pool under
 * `__unknown__`, records with no `session_id` under `__default__`.
 */
export function summarizeTypingBy(episodes, options = {}) {
  const by = options.by ?? 'person';
  const grouper = GROUPERS[by];
  if (!grouper) {
    throw new TypeError(`summarizeTypingBy: \`by\` must be one of ${Object.keys(GROUPERS).join(', ')}, got ${JSON.stringify(by)}`);
  }
  const list = Array.isArray(episodes) ? episodes : [];
  const groups = new Map();
  for (const episode of list) {
    const key = grouper(episode, options);
    if (!groups.has(key)) groups.set(key, { episodes: [], label: null });
    const group = groups.get(key);
    group.episodes.push(episode);
    if (by === 'person' && group.label === null) group.label = stringField(episode, 'user_label');
  }

  const keys = [...groups.keys()];
  if (by === 'day') keys.sort();

  const rows = keys.map((key) => {
    const group = groups.get(key);
    return { key, label: group.label ?? key, summary: aggregateTypingEpisodes(group.episodes) };
  });
  const contributions = rows.map((row) => Math.max(0, row.summary.netGraphemes));
  const total = contributions.reduce((sum, value) => sum + value, 0);
  return rows.map((row, index) => ({
    ...row,
    textShare: total > 0 ? contributions[index] / total : null,
  }));
}

/**
 * The measures a typing summary is compared on, in presentation order. `kind`
 * tells a renderer how to format the value: `count`, `duration_ms`, `rate`
 * (per minute), `ratio` (0–1) or `graphemes`.
 */
export const TYPING_SUMMARY_MEASURES = Object.freeze([
  { key: 'episodes', label: 'Episodes', kind: 'count' },
  { key: 'totalActiveMs', label: 'Active time', kind: 'duration_ms' },
  { key: 'charsPerMinActive', label: 'Production rate (chars/min, active)', kind: 'rate' },
  { key: 'wordsPerMinActive', label: 'Words/min (active)', kind: 'rate' },
  { key: 'productRatio', label: 'Product ratio', kind: 'ratio' },
  { key: 'pBurstMeanGraphemes', label: 'P-burst mean', kind: 'graphemes' },
  { key: 'rBurstMeanGraphemes', label: 'R-burst mean', kind: 'graphemes' },
  { key: 'revisionRatio', label: 'Revision ratio', kind: 'ratio' },
  { key: 'leadingEdgeRevisionRatio', label: 'Leading-edge revisions', kind: 'ratio' },
].map(Object.freeze));

/**
 * Two typing summaries side by side: one row per measure in
 * `TYPING_SUMMARY_MEASURES`, as `{ key, label, kind, a, b, difference }`.
 * `difference` is `b − a`, and `null` when either side was not measured.
 */
export function compareTypingSummaries(a, b) {
  return TYPING_SUMMARY_MEASURES.map(({ key, label, kind }) => {
    const left = num(a ? a[key] : null);
    const right = num(b ? b[key] : null);
    return {
      key,
      label,
      kind,
      a: left,
      b: right,
      difference: left !== null && right !== null ? right - left : null,
    };
  });
}
