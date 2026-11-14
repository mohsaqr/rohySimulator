import assert from 'node:assert/strict';
import {
  aggregateTypingEpisodes,
  compareTypingSummaries,
  episodeCharsPerMin,
  pauseBucketLabel,
  summarizeTypingBy,
  TYPING_SUMMARY_MEASURES,
} from '../src/analytics/TypingEpisodeAnalytics.js';

/*
 * Pooled typing summaries (AGENT-NOTE-HOST-SCOPES acceptance 4): person and
 * group figures must equal a HAND-COMPUTED pool over a small fixture — two
 * people, three sessions, known sums — and a person whose episodes carry no
 * word counts must show "not measured" (null), never 0.
 *
 * Every expected value below is worked out in the comment beside it from the
 * fixture's raw sums, not read back from the function under test.
 */

const TOLERANCE = 1e-9;
function close(actual, expected, message) {
  assert.ok(
    actual !== null && Math.abs(actual - expected) < TOLERANCE,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

/** One typing episode window with only the fields the pooling reads. */
function episode({ user, label, session, start, typing }) {
  return {
    modality: 'typing',
    window_kind: 'episode',
    feature_profile: 'typing-v3',
    window_start: start,
    window_end: start,
    session_id: session,
    ...(user ? { user_id: user } : {}),
    ...(label ? { user_label: label } : {}),
    typing: { submitted: true, abandoned: false, revision_locations: [], ...typing },
    quality: { thresholds: { leading_edge_tolerance_graphemes: 2 } },
  };
}

// Ada: two sessions, three episodes, word counts and boundary contexts present.
const adaS1E1 = episode({
  user: 'ada', label: 'Ada L.', session: 's1', start: '2026-03-02T12:00:00.000Z',
  typing: {
    elapsed_ms: 60000, active_input_ms: 30000,
    committed_graphemes: 100, inserted_graphemes: 120, deleted_graphemes: 20, produced_graphemes: 120,
    words_per_min: 20, words_per_min_active: 40,          // 20 words in 1 min; 20 words in 0.5 active min
    pause_histogram: { lt_500_ms: 80, '2000_to_5000_ms': 4 },
    pause_location_counts: { mid_word: 1, word_boundary: 2, sentence_boundary: 1, paragraph_boundary: 0 },
    p_burst_count: 4, r_burst_count: 2, p_burst_mean_graphemes: 20, r_burst_mean_graphemes: 5,
    revision_locations: [
      { op: 'delete', distance: 0 },
      { op: 'delete', distance: 10 },
      { op: 'insert', distance: 0 },        // not a revision op — ignored
    ],
    correction_count: 1,
  },
});
const adaS1E2 = episode({
  user: 'ada', label: 'Ada L.', session: 's1', start: '2026-03-02T12:30:00.000Z',
  typing: {
    elapsed_ms: 120000, active_input_ms: 60000,
    committed_graphemes: 200, inserted_graphemes: 220, deleted_graphemes: 20, produced_graphemes: 220,
    words_per_min: 20, words_per_min_active: 40,          // 40 words in 2 min; 40 words in 1 active min
    pause_histogram: { lt_500_ms: 150, gte_5000_ms: 1 },
    pause_location_counts: { mid_word: 0, word_boundary: 3, sentence_boundary: 2, paragraph_boundary: 1 },
    p_burst_count: 6, r_burst_count: 0, p_burst_mean_graphemes: 30, r_burst_mean_graphemes: 0,
    revision_locations: [{ op: 'replace', distance: 2 }],
    correction_count: 0,
  },
});
const adaS2E1 = episode({
  user: 'ada', label: 'Ada L.', session: 's2', start: '2026-03-03T12:00:00.000Z',
  typing: {
    elapsed_ms: 60000, active_input_ms: 60000,
    committed_graphemes: 60, inserted_graphemes: 60, deleted_graphemes: 0, produced_graphemes: 60,
    words_per_min: 12, words_per_min_active: 12,          // 12 words in 1 min
    pause_histogram: { lt_500_ms: 50 },
    pause_location_counts: { mid_word: 0, word_boundary: 1, sentence_boundary: 0, paragraph_boundary: 0 },
    p_burst_count: 2, r_burst_count: 0, p_burst_mean_graphemes: 30, r_burst_mean_graphemes: 0,
    correction_count: 0,
  },
});

// Ben: one session, two typing-v2-style episodes — NO word counts, NO
// boundary contexts, NO burst split, NO revision distances.
const benS3E1 = episode({
  user: 'ben', session: 's3', start: '2026-03-02T12:10:00.000Z',
  typing: {
    elapsed_ms: 30000, active_input_ms: 20000,
    committed_graphemes: 50, inserted_graphemes: 60, deleted_graphemes: 10,
    pause_histogram: { lt_500_ms: 40 },
    revision_locations: [{ op: 'delete' }],   // v2: no distance — not measured
  },
});
const benS3E2 = episode({
  user: 'ben', session: 's3', start: '2026-03-02T12:20:00.000Z',
  typing: {
    elapsed_ms: 90000, active_input_ms: 40000, submitted: false, abandoned: true,
    committed_graphemes: 70, inserted_graphemes: 100, deleted_graphemes: 30,
    pause_histogram: { lt_500_ms: 60, '2000_to_5000_ms': 2 },
  },
});

const ALL = [adaS1E1, adaS1E2, adaS2E1, benS3E1, benS3E2];

// ── Person scope: Ada pooled over her two sessions ────────────────────────
{
  const ada = aggregateTypingEpisodes([adaS1E1, adaS1E2, adaS2E1]);
  assert.equal(ada.episodes, 3);
  assert.equal(ada.submitted, 3);
  assert.equal(ada.totalElapsedMs, 240000);            // 60 + 120 + 60 s
  assert.equal(ada.totalActiveMs, 150000);             // 30 + 60 + 60 s
  assert.equal(ada.committedGraphemes, 360);           // 100 + 200 + 60
  assert.equal(ada.producedGraphemes, 400);            // 120 + 220 + 60
  assert.equal(ada.netGraphemes, 360);                 // (120−20) + (220−20) + (60−0)
  close(ada.productRatio, 360 / 400, 'product ratio = committed / produced');           // 0.9
  close(ada.charsPerMin, 360 / 4, 'chars/min = 360 graphemes over 4 minutes');          // 90
  close(ada.charsPerMinActive, 360 / 2.5, 'chars/min over 2.5 active minutes');         // 144
  close(ada.wordsPerMin, 72 / 4, 'words/min = (20 + 40 + 12) words over 4 minutes');    // 18
  close(ada.wordsPerMinActive, 72 / 2.5, 'words/min over 2.5 active minutes');          // 28.8
  assert.deepEqual(ada.pauseHistogram, { lt_500_ms: 280, '2000_to_5000_ms': 4, gte_5000_ms: 1 },
    'buckets summed and ordered by lower bound');
  assert.deepEqual(ada.pauseLocationCounts,
    { mid_word: 1, word_boundary: 6, sentence_boundary: 3, paragraph_boundary: 1 });
  assert.equal(ada.pBurstCount, 12);                   // 4 + 6 + 2
  assert.equal(ada.rBurstCount, 2);
  close(ada.pBurstMeanGraphemes, (4 * 20 + 6 * 30 + 2 * 30) / 12, 'P-burst mean = total graphemes / total bursts'); // 320/12
  close(ada.rBurstMeanGraphemes, (2 * 5) / 2, 'R-burst mean');                          // 5
  close(ada.revisionRatio, 40 / 400, 'revision ratio = deleted / inserted');            // 0.1
  close(ada.revisionDistanceMean, (0 + 10 + 2) / 3, 'mean over the three positioned revisions'); // 4
  close(ada.leadingEdgeRevisionRatio, 2 / 3, 'distances 0 and 2 are within the tolerance of 2');
  assert.equal(ada.correctionCount, 1);

  // Pooled from sums, NOT a mean of per-episode rates: the three episodes'
  // own chars/min are 100, 100 and 60, whose mean is 86.67 — not 90.
  const meanOfRates = [adaS1E1, adaS1E2, adaS2E1]
    .map((e) => episodeCharsPerMin(e.typing))
    .reduce((sum, rate) => sum + rate, 0) / 3;
  close(meanOfRates, 260 / 3, 'the per-episode rates are 100, 100 and 60');
  assert.ok(Math.abs(ada.charsPerMin - meanOfRates) > 1,
    'the pooled rate must differ from the mean of per-episode rates on this fixture');
}

// ── Null discipline: Ben's episodes never measured words, locations, bursts ─
{
  const ben = aggregateTypingEpisodes([benS3E1, benS3E2]);
  assert.equal(ben.episodes, 2);
  assert.equal(ben.submitted, 1);
  assert.equal(ben.abandoned, 1);
  assert.equal(ben.committedGraphemes, 120);           // 50 + 70
  assert.equal(ben.netGraphemes, 120);                 // (60−10) + (100−30)
  close(ben.charsPerMin, 120 / 2, 'chars/min = 120 graphemes over 2 minutes');          // 60
  close(ben.charsPerMinActive, 120 / 1, 'over 1 active minute');                        // 120
  close(ben.revisionRatio, 40 / 160, 'revision ratio');                                 // 0.25
  // produced_graphemes is absent on v2 rows; inserted_graphemes stands in.
  assert.equal(ben.producedGraphemes, 160);
  close(ben.productRatio, 120 / 160, 'product ratio from inserted as produced');        // 0.75

  for (const field of [
    'wordsPerMin', 'wordsPerMinActive', 'pauseLocationCounts',
    'pBurstCount', 'rBurstCount', 'pBurstMeanGraphemes', 'rBurstMeanGraphemes',
    'revisionDistanceMean', 'leadingEdgeRevisionRatio', 'correctionCount',
  ]) {
    assert.equal(ben[field], null, `${field} was not measured — it must be null ("—"), never 0`);
  }

  // No episodes at all: every rate is null, every count is 0.
  const empty = aggregateTypingEpisodes([]);
  assert.equal(empty.episodes, 0);
  assert.equal(empty.charsPerMin, null);
  assert.equal(empty.productRatio, null);
  assert.equal(empty.revisionRatio, null);
}

// ── Episodes that open on existing text (a document editor) ───────────────
// The second episode opens on the 100 graphemes the first one left and adds
// 20 (inserted 30, deleted 10). Its document ends at 120, but it PRODUCED 20.
{
  const first = episode({
    user: 'dee', session: 's5', start: '2026-03-04T10:00:00.000Z',
    typing: { elapsed_ms: 60000, active_input_ms: 60000, committed_graphemes: 100, inserted_graphemes: 100, deleted_graphemes: 0, produced_graphemes: 100 },
  });
  const second = episode({
    user: 'dee', session: 's5', start: '2026-03-04T10:10:00.000Z',
    typing: { elapsed_ms: 60000, active_input_ms: 60000, committed_graphemes: 120, inserted_graphemes: 30, deleted_graphemes: 10, produced_graphemes: 30, baseline_graphemes: 100 },
  });
  const pooled = aggregateTypingEpisodes([first, second]);
  assert.equal(pooled.committedGraphemes, 220, 'the sum of document lengths is still reported as such');
  assert.equal(pooled.netGraphemes, 120);                 // 100 + (30 − 10)
  close(pooled.charsPerMin, 120 / 2, 'rate uses what was produced: 120 graphemes over 2 minutes, not 220'); // 60
  close(pooled.charsPerMinActive, 120 / 2, 'same over active time');
  close(pooled.productRatio, (100 + 20) / 130, 'survived / produced, per episode: (100 + 20) of 130 typed');
  // An episode that only deleted pre-existing text produced nothing: its
  // rate contribution is 0, never negative.
  const eraser = episode({
    user: 'dee', session: 's5', start: '2026-03-04T10:20:00.000Z',
    typing: { elapsed_ms: 60000, active_input_ms: 60000, committed_graphemes: 70, inserted_graphemes: 0, deleted_graphemes: 50, produced_graphemes: 0 },
  });
  close(aggregateTypingEpisodes([first, eraser]).charsPerMin, 100 / 2, 'a net-deleting episode adds time but no negative production');
}

// ── Group scope: one row per person, with each person's share of the text ──
{
  const rows = summarizeTypingBy(ALL, { by: 'person' });
  assert.deepEqual(rows.map((row) => row.key), ['ada', 'ben'], 'first-seen order');
  assert.deepEqual(rows.map((row) => row.label), ['Ada L.', 'ben'],
    'user_label when a record carries one, else the id');
  assert.deepEqual(rows[0].summary, aggregateTypingEpisodes([adaS1E1, adaS1E2, adaS2E1]),
    "a person's row is exactly that person's pooled summary");
  assert.deepEqual(rows[1].summary, aggregateTypingEpisodes([benS3E1, benS3E2]));
  close(rows[0].textShare, 360 / 480, "Ada's net 360 of the group's 480");              // 0.75
  close(rows[1].textShare, 120 / 480, "Ben's net 120 of the group's 480");              // 0.25
  assert.equal(rows[1].summary.wordsPerMin, null, 'Ben still shows — for words in the group table');

  // Invariant: shares sum to 1.
  close(rows.reduce((sum, row) => sum + row.textShare, 0), 1, 'shares sum to 1');

  // Invariant: the rows do not depend on the order the episodes arrive in.
  const shuffled = [benS3E2, adaS2E1, adaS1E2, benS3E1, adaS1E1];
  const byKey = (list) => Object.fromEntries(list.map((row) => [row.key, row]));
  const a = byKey(rows);
  const b = byKey(summarizeTypingBy(shuffled, { by: 'person' }));
  for (const key of ['ada', 'ben']) {
    close(b[key].textShare, a[key].textShare, `${key}: share is order-invariant`);
    close(b[key].summary.charsPerMin, a[key].summary.charsPerMin, `${key}: rate is order-invariant`);
    assert.equal(b[key].summary.committedGraphemes, a[key].summary.committedGraphemes);
    assert.deepEqual(b[key].summary.pauseHistogram, a[key].summary.pauseHistogram);
  }

  // A share floors a net-deleting person at 0 rather than going negative.
  const eraser = episode({
    user: 'cy', session: 's4', start: '2026-03-02T13:00:00.000Z',
    typing: { elapsed_ms: 1000, active_input_ms: 1000, committed_graphemes: 5, inserted_graphemes: 10, deleted_graphemes: 40 },
  });
  const withEraser = summarizeTypingBy([...ALL, eraser], { by: 'person' });
  assert.equal(withEraser[2].summary.netGraphemes, -30);
  assert.equal(withEraser[2].textShare, 0);
  close(withEraser[0].textShare, 0.75, "the others' shares are unchanged");

  // Nobody committed anything: the share is not measurable.
  assert.equal(summarizeTypingBy([eraser], { by: 'person' })[0].textShare, null);

  // Records with no user_id pool under __unknown__ (not dropped).
  const anonymous = episode({ session: 's9', start: '2026-03-02T14:00:00.000Z', typing: { elapsed_ms: 1, committed_graphemes: 1, inserted_graphemes: 1, deleted_graphemes: 0 } });
  assert.deepEqual(summarizeTypingBy([anonymous], { by: 'person' }).map((row) => row.key), ['__unknown__']);
}

// ── Person scope tables: per session and per day ──────────────────────────
{
  const adaEpisodes = [adaS1E1, adaS1E2, adaS2E1];
  const bySession = summarizeTypingBy(adaEpisodes, { by: 'session' });
  assert.deepEqual(bySession.map((row) => [row.key, row.summary.episodes]), [['s1', 2], ['s2', 1]]);
  close(bySession[0].summary.charsPerMin, 300 / 3, 's1: 300 graphemes over 3 minutes');  // 100
  close(bySession[1].summary.charsPerMin, 60 / 1, 's2: 60 graphemes over 1 minute');     // 60
  close(bySession[0].textShare, 300 / 360, 's1 holds 300 of her 360 net graphemes');

  const byDay = summarizeTypingBy([adaS2E1, adaS1E1, adaS1E2], { by: 'day', utc: true });
  assert.deepEqual(byDay.map((row) => [row.key, row.summary.episodes]),
    [['2026-03-02', 2], ['2026-03-03', 1]], 'days ascend whatever the input order');

  assert.throws(() => summarizeTypingBy(adaEpisodes, { by: 'cohort' }), TypeError,
    'an unknown grouping is a broken call, not an empty table');
  assert.deepEqual(summarizeTypingBy([], { by: 'person' }), []);
}

// ── Two-person comparison ─────────────────────────────────────────────────
{
  const [ada, ben] = summarizeTypingBy(ALL, { by: 'person' });
  const rows = compareTypingSummaries(ada.summary, ben.summary);
  assert.deepEqual(rows.map((row) => row.key), TYPING_SUMMARY_MEASURES.map((measure) => measure.key),
    'one row per measure, in presentation order');
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  close(byKey.charsPerMinActive.difference, 120 - 144, 'difference is B − A');           // −24
  close(byKey.revisionRatio.difference, 0.25 - 0.1, 'revision ratio difference');
  assert.equal(byKey.episodes.difference, 2 - 3);
  // Ben never measured words or bursts: his side and the difference are null.
  assert.equal(byKey.wordsPerMinActive.b, null);
  assert.equal(byKey.wordsPerMinActive.difference, null);
  assert.equal(byKey.pBurstMeanGraphemes.difference, null);
  close(byKey.wordsPerMinActive.a, 28.8, "Ada's side is still reported");
  // Antisymmetry of the difference where both sides are measured.
  const reversed = Object.fromEntries(compareTypingSummaries(ben.summary, ada.summary).map((row) => [row.key, row]));
  close(reversed.charsPerMinActive.difference, -byKey.charsPerMinActive.difference, 'swapping sides flips the sign');
}

// ── Helpers ───────────────────────────────────────────────────────────────
{
  assert.equal(pauseBucketLabel('lt_500_ms'), '< 0.5 s');
  assert.equal(pauseBucketLabel('2000_to_5000_ms'), '2–5 s');
  assert.equal(pauseBucketLabel('gte_5000_ms'), '≥ 5 s');
  assert.equal(pauseBucketLabel('custom'), 'custom');
  assert.equal(episodeCharsPerMin({ chars_per_min: 77 }), 77, 'the stored v3 rate wins');
  assert.equal(episodeCharsPerMin({ elapsed_ms: 0, committed_graphemes: 10 }), null, 'no elapsed time, no rate');
}

console.log('typing-episode-analytics OK');
