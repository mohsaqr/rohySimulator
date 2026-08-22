// VoiceTurnAggregator (voice-v1, audio_text.md §5.6): every assertion below is
// hand-computed from a scripted frame sequence — no "is a number" checks.
// frameMs is set to 100 in these tests so durations are round numbers.
import assert from 'node:assert/strict';
import { VoiceTurnAggregator } from '../src/aggregation/VoiceTurnAggregator.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';
import { tna, ftna } from '../standalone/vendor/ladyna/dist/index.js';

const FRAME_MS = 100;
const T0 = 1000;
const WALL0 = 1_700_000_000_000;

const BASE_FEATURES = {
  rms: 0.005,
  peak: 0.02,
  clippedSamples: 0,
  zeroCrossingRate: 0.1,
  centroidHz: null,
  rolloffHz: null,
  f0Hz: null,
  f0Confidence: 0,
  voiced: false,
};

const feat = (overrides = {}) => ({ ...BASE_FEATURES, ...overrides });

function makeAggregator(options = {}) {
  return new VoiceTurnAggregator({ frameMs: FRAME_MS, now: () => WALL0, ...options });
}

const OYON_TRACK_SETTINGS = {
  echo_cancellation: true,
  noise_suppression: true,
  auto_gain_control: false,
  sample_rate: 16000,
  channel_count: 1,
  stream_owner: 'oyon',
  loudness_contaminated: false,
};

// ─── Scenario A: full structured turn — segmentation, pauses, pitch, ──────
// ─── loudness, spectrum, and validator round trip ─────────────────────────
//
// 34 frames × 100 ms, timestamps t_i = 1000 + 100·i:
//   i  0– 2  silence (3 frames, 300 ms)          → initial silence
//   i  3–12  speech  (10 frames)                  → segment 1
//   i 13–18  silence (6 frames, 600 ms)           → internal pause (≥ 500)
//   i 19–23  speech  (5 frames)                   → segment 2
//   i 24–25  silence (2 frames, 200 ms)           → internal run, sub-pause
//   i 26–29  speech  (4 frames)                   → segment 3
//   i 30–33  silence (4 frames, 400 ms)           → trailing silence
// finalize at t = 1000 + 3400 = 4400.
//
// Pitch: 11 confident voiced frames on a perfect line f0 = 100 + 0.05·(t −
// 1300) Hz — frames i 3–12 give f0 = 100, 105, …, 145 and frame i 19 gives
// f0 = 180 (t − t0 = 1600 ms). Collinear points make the OLS fit exact:
//   slope = 0.05 Hz/ms = 50 Hz/s      (hand check: +5 Hz per 100 ms frame)
//   sorted f0s: [100,105,110,115,120,125,130,135,140,145,180] (n = 11)
//   median (index 5)                       = 125
//   q1 at index 2.5 → 110 + 0.5·5          = 112.5
//   q3 at index 7.5 → 135 + 0.5·5          = 137.5   → IQR = 25
// Two more voiced frames (i 20, 21) carry confidence 0.55 — above the DSP's
// 0.5 clarity floor but below minPitchConfidence 0.6 — so they are pitch
// CANDIDATES that get excluded: 13 candidates, 11 kept, excluded 2/13.
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0, targetKind: 'voice_control', targetId: 'mic-1' });

  const script = [];
  const silence = () => ({ prob: 0.1, features: feat() });
  for (let i = 0; i < 3; i += 1) script.push(silence());
  for (let i = 0; i < 10; i += 1) {
    // Speech frames i 3–12: rms 0.1; first 4 carry centroid 1000 / rolloff
    // 3000, next 4 carry centroid 2000 / rolloff 5000; all 10 are confident
    // voiced frames on the rising contour.
    const spectral = i < 4
      ? { centroidHz: 1000, rolloffHz: 3000 }
      : (i < 8 ? { centroidHz: 2000, rolloffHz: 5000 } : {});
    script.push({
      prob: 0.9,
      features: feat({
        rms: 0.1, peak: 0.3, voiced: true, f0Hz: 100 + 5 * i, f0Confidence: 0.9, ...spectral,
      }),
    });
  }
  for (let i = 0; i < 6; i += 1) script.push(silence());
  // Speech frames i 19–23: rms 0.2. i 19 is the 11th kept voiced frame
  // (f0 180); i 20–21 are the two low-confidence excluded candidates.
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3, voiced: true, f0Hz: 180, f0Confidence: 0.9 }) });
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3, voiced: true, f0Hz: 120, f0Confidence: 0.55 }) });
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3, voiced: true, f0Hz: 120, f0Confidence: 0.55 }) });
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3 }) });
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3 }) });
  for (let i = 0; i < 2; i += 1) script.push(silence());
  // Speech frames i 26–29: rms 0.2; i 26 carries the turn's peak 0.5.
  script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.5 }) });
  for (let i = 0; i < 3; i += 1) script.push({ prob: 0.9, features: feat({ rms: 0.2, peak: 0.3 }) });
  for (let i = 0; i < 4; i += 1) script.push(silence());

  assert.equal(script.length, 34, 'scenario A script must be 34 frames');
  script.forEach((entry, i) => {
    agg.recordFrame(entry.features, { timestamp: T0 + i * FRAME_MS, speechProbability: entry.prob });
  });

  const win = agg.finalize({
    timestamp: T0 + 34 * FRAME_MS,
    report: { track_settings: OYON_TRACK_SETTINGS },
  });

  assert.equal(win.modality, 'voice');
  assert.equal(win.window_kind, 'episode');
  assert.equal(win.feature_profile, 'voice-v1');
  assert.deepEqual(win.target, { kind: 'voice_control', id: 'mic-1' });

  const v = win.voice;
  // ── turn and speech structure (all hand-counted above) ──
  assert.equal(v.turn_duration_ms, 3400);
  assert.equal(v.speech_duration_ms, 1900); // 19 speech frames × 100 ms
  assert.equal(v.speech_ratio, 1900 / 3400);
  assert.equal(v.initial_silence_ms, 300);
  assert.equal(v.trailing_silence_ms, 400);
  assert.equal(v.internal_pause_count, 1); // only the 600 ms run reaches 500
  assert.equal(v.internal_pause_total_ms, 600);
  // Histogram covers BOTH internal silence runs (600 ms and 200 ms).
  assert.deepEqual(v.pause_histogram, {
    lt_500_ms: 1, '500_to_1000_ms': 1, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 0,
  });
  assert.equal(v.speech_segment_count, 3);
  assert.equal(v.segment_duration_mean_ms, 1900 / 3);
  assert.equal(v.excluded_playback_ms, 0);
  assert.equal(v.muted_ms, 0);

  // ── pitch (hand-computed: median 125, IQR 25, slope exactly 50 Hz/s) ──
  assert.equal(v.voiced_frame_ratio, 13 / 34);
  assert.equal(v.pitch_median_hz, 125);
  assert.equal(v.pitch_iqr_hz, 25);
  assert.ok(Math.abs(v.pitch_slope_hz_per_s - 50) < 1e-9,
    `slope must be exactly 50 Hz/s for a collinear contour, got ${v.pitch_slope_hz_per_s}`);
  assert.ok(Math.abs(v.pitch_confidence_mean - 0.9) < 1e-12);
  assert.equal(v.pitch_frames_excluded_ratio, 2 / 13);

  // ── loudness: 10 speech frames at rms 0.1, 9 at 0.2 ──
  const rmsMean = (10 * 0.1 + 9 * 0.2) / 19;
  assert.ok(Math.abs(v.rms_mean - rmsMean) < 1e-12);
  const rmsVar = (10 * 0.01 + 9 * 0.04) / 19 - rmsMean * rmsMean;
  assert.ok(Math.abs(v.rms_variability - Math.sqrt(rmsVar)) < 1e-12);
  assert.ok(Math.abs(v.peak_to_average_ratio - 0.5 / rmsMean) < 1e-12);
  assert.equal(v.clipping_ratio, 0);
  assert.equal(v.near_silence_ratio, 15 / 34); // the 15 silence frames at rms 0.005

  // ── spectrum: 4 frames at 1000 Hz + 4 at 2000 Hz; rolloffs 3000/5000 ──
  assert.equal(v.spectral_centroid_mean_hz, 1500);
  assert.equal(v.spectral_rolloff_mean_hz, 4000);

  // ── quality and uncertainty ──
  assert.equal(v.sample_rate, 16000);
  assert.equal(v.channel_count, 1);
  assert.equal(v.echo_cancellation, true);
  assert.equal(v.noise_suppression, true);
  assert.equal(v.auto_gain_control, false);
  assert.equal(v.stream_owner, 'oyon');
  assert.equal(v.clipped_coverage, 0);
  assert.equal(v.muted_coverage, 0);
  assert.equal(v.hidden_coverage, null, 'hidden never supplied -> null, not 0');
  assert.equal(v.contaminated_coverage, 0);
  assert.equal(v.vad_coverage, 1);
  assert.equal(v.pitch_coverage, 11 / 19);
  assert.equal(v.analyzable_speech_ms, 1900);
  assert.equal(v.insufficient_data, false);
  assert.deepEqual(v.insufficient_reasons, []);

  assert.equal(win.quality.loudness_contaminated, false);
  assert.equal(win.quality.thresholds.frame_ms, FRAME_MS);
  assert.equal(win.quality.thresholds.min_voiced_frames_for_pitch, 5);

  // The finalized window must pass the transport validator untouched.
  assert.deepEqual(validateEmotionEvent(win), []);

  // finalize() resets: a second call returns null.
  assert.equal(agg.finalize({ timestamp: T0 + 3500 }), null);
}

// ─── Scenario B: AI playback exclusion (§5.9) ─────────────────────────────
// 5 speech frames, 6 playback frames (3 of which the VAD calls speech —
// leakage), 5 speech frames. Playback time never enters speech_duration_ms;
// VAD-speech-during-playback raises contaminated_coverage only.
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  let i = 0;
  const push = (prob, inPlayback) => {
    agg.recordFrame(feat({ rms: 0.1, peak: 0.3 }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: prob, inPlayback,
    });
    i += 1;
  };
  for (let k = 0; k < 5; k += 1) push(0.9, false);
  for (let k = 0; k < 3; k += 1) push(0.9, true); // leakage: VAD says speech
  for (let k = 0; k < 3; k += 1) push(0.1, true);
  for (let k = 0; k < 5; k += 1) push(0.9, false);

  const win = agg.finalize({ timestamp: T0 + 16 * FRAME_MS });
  const v = win.voice;
  assert.equal(v.turn_duration_ms, 1600);
  assert.equal(v.speech_duration_ms, 1000, 'playback frames must never count as speech');
  assert.equal(v.excluded_playback_ms, 600);
  assert.equal(v.contaminated_coverage, 3 / 16, 'the one turn-wide coverage: leaked frames over ALL 16 frames');
  // REGRESSION (finding 7): speech_ratio divides by the LEARNER timeline
  // (10 frames x 100 ms), not the playback-inclusive turn duration — the
  // learner spoke for ALL of their own 1000 ms.
  assert.equal(v.speech_ratio, 1, '1000 ms speech / 1000 ms learner timeline, not 1000/1600');
  // REGRESSION (finding 7): learner-scoped coverages divide by the 10
  // non-playback frames, not all 16.
  assert.equal(v.vad_coverage, 1, '10 VAD-covered learner frames / 10 learner frames');
  assert.equal(v.clipped_coverage, 0);
  assert.equal(v.muted_coverage, 0);
  // Playback is excluded from the structural timeline entirely, so the two
  // learner speech runs are contiguous learner-time: one segment, no
  // internal silence.
  assert.equal(v.speech_segment_count, 1);
  assert.equal(v.internal_pause_count, 0);
  assert.equal(v.insufficient_data, false);
  // No report passed: capture conditions are unknown, not fabricated.
  assert.equal(v.sample_rate, null);
  assert.equal(win.quality.loudness_contaminated, null);
}

// ─── Scenario C: pitch below the voiced-frame floor → null, NOT 0 ─────────
// 10 speech frames, only 3 confident voiced frames (< minVoicedFramesForPitch
// 5). Every pitch statistic must be null; a turn with no spectral content
// likewise reports null spectral means.
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  for (let i = 0; i < 10; i += 1) {
    const voiced = i < 3 ? { voiced: true, f0Hz: 120 + i, f0Confidence: 0.9 } : {};
    agg.recordFrame(feat({ rms: 0.1, peak: 0.3, ...voiced }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: 0.9,
    });
  }
  const win = agg.finalize({ timestamp: T0 + 10 * FRAME_MS });
  const v = win.voice;
  assert.equal(v.pitch_median_hz, null);
  assert.equal(v.pitch_iqr_hz, null);
  assert.equal(v.pitch_slope_hz_per_s, null);
  assert.equal(v.pitch_confidence_mean, null);
  // The 3 candidates all cleared the confidence gate: excluded share is a
  // real measured 0 — distinct from the never-measured nulls above.
  assert.equal(v.pitch_frames_excluded_ratio, 0);
  assert.equal(v.pitch_coverage, 3 / 10);
  assert.equal(v.spectral_centroid_mean_hz, null, 'no spectral content -> null, not 0');
  assert.equal(v.spectral_rolloff_mean_hz, null);
  assert.equal(v.insufficient_data, false); // exactly 1000 ms and clean
}

// ─── Scenario D: too-short turn → insufficient_data with the right reasons ─
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  for (let i = 0; i < 2; i += 1) {
    agg.recordFrame(feat({ rms: 0.1, peak: 0.3 }), { timestamp: T0 + i * FRAME_MS, speechProbability: 0.9 });
  }
  const win = agg.finalize({ timestamp: T0 + 2 * FRAME_MS });
  const v = win.voice;
  assert.equal(v.insufficient_data, true);
  assert.ok(v.insufficient_reasons.includes('turn_too_short'));
  assert.ok(v.insufficient_reasons.includes('insufficient_analyzable_speech')); // 200 ms < 500 ms
  assert.ok(!v.insufficient_reasons.includes('excessive_clipping'));
  assert.ok(!v.insufficient_reasons.includes('poor_vad_coverage'));
  // An insufficient window is still a valid transport payload.
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ─── Scenario E: heavily clipped turn → uncertainty, not confident values ──
// 20 speech frames, every one clipped: rms_mean is still EMITTED (record
// everything) but the window carries excessive_clipping and zero analyzable
// speech — low-quality input produces uncertainty states (§10.3), not a
// confident clean-looking rms.
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  for (let i = 0; i < 20; i += 1) {
    agg.recordFrame(feat({ rms: 0.5, peak: 1.0, clippedSamples: 40 }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: 0.9,
    });
  }
  const win = agg.finalize({ timestamp: T0 + 20 * FRAME_MS });
  const v = win.voice;
  assert.equal(v.clipped_coverage, 1);
  assert.equal(v.clipping_ratio, 1);
  assert.equal(v.analyzable_speech_ms, 0, 'clipped speech is not analyzable speech');
  assert.equal(v.insufficient_data, true);
  assert.ok(v.insufficient_reasons.includes('excessive_clipping'));
  assert.ok(v.insufficient_reasons.includes('insufficient_analyzable_speech'));
  assert.equal(v.rms_mean, 0.5); // emitted AND flagged — never silently dropped
}

// ─── Scenario F: no VAD → poor_vad_coverage ───────────────────────────────
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  for (let i = 0; i < 15; i += 1) {
    agg.recordFrame(feat({ rms: 0.1 }), { timestamp: T0 + i * FRAME_MS, speechProbability: null });
  }
  const win = agg.finalize({ timestamp: T0 + 15 * FRAME_MS });
  assert.equal(win.voice.vad_coverage, 0);
  assert.ok(win.voice.insufficient_reasons.includes('poor_vad_coverage'));
  assert.equal(win.voice.speech_ratio, 0); // no speech-like frames at all
}

// ─── Scenario G: muted frames — structural silence, measured as muted ─────
// 5 speech, 6 muted (600 ms), 5 speech: mute time extends the internal
// silence run (so the pause is detected) while being excluded from loudness.
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  let i = 0;
  const push = (prob, muted) => {
    agg.recordFrame(feat({ rms: muted ? 0 : 0.1, peak: muted ? 0 : 0.3 }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: prob, muted,
    });
    i += 1;
  };
  for (let k = 0; k < 5; k += 1) push(0.9, false);
  for (let k = 0; k < 6; k += 1) push(0.1, true);
  for (let k = 0; k < 5; k += 1) push(0.9, false);
  const win = agg.finalize({ timestamp: T0 + 16 * FRAME_MS });
  const v = win.voice;
  assert.equal(v.muted_ms, 600);
  assert.equal(v.muted_coverage, 6 / 16);
  assert.equal(v.internal_pause_count, 1);
  assert.equal(v.internal_pause_total_ms, 600);
  assert.equal(v.speech_segment_count, 2);
  assert.equal(v.speech_duration_ms, 1000);
  // Loudness excluded the muted zeros: mean is the speech frames' 0.1.
  assert.ok(Math.abs(v.rms_mean - 0.1) < 1e-12);
}

// ─── Scenario H: AGC on → loudness marked contaminated, never comparable ──
{
  // Host-owned stream, AGC on, controller-computed flag present.
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  for (let k = 0; k < 12; k += 1) {
    agg.recordFrame(feat({ rms: 0.2, peak: 0.4 }), { timestamp: T0 + k * FRAME_MS, speechProbability: 0.9 });
  }
  const win = agg.finalize({
    timestamp: T0 + 12 * FRAME_MS,
    report: {
      track_settings: {
        ...OYON_TRACK_SETTINGS, auto_gain_control: true, stream_owner: 'host', loudness_contaminated: true,
      },
    },
  });
  assert.equal(win.quality.loudness_contaminated, true);
  assert.equal(win.voice.auto_gain_control, true);
  assert.equal(win.voice.stream_owner, 'host');
  // Absolute loudness is still emitted — flagged, not withheld.
  assert.ok(Math.abs(win.voice.rms_mean - 0.2) < 1e-12);

  // Derived path: no precomputed flag, AGC true -> contaminated.
  const agg2 = makeAggregator();
  agg2.start({ timestamp: T0 });
  agg2.recordFrame(feat({ rms: 0.2 }), { timestamp: T0, speechProbability: 0.9 });
  const win2 = agg2.finalize({
    timestamp: T0 + FRAME_MS,
    report: { track_settings: { auto_gain_control: true, stream_owner: 'oyon' } },
  });
  assert.equal(win2.quality.loudness_contaminated, true);

  // Host-owned stream with AGC unknowable -> contaminated too.
  const agg3 = makeAggregator();
  agg3.start({ timestamp: T0 });
  agg3.recordFrame(feat({ rms: 0.2 }), { timestamp: T0, speechProbability: 0.9 });
  const win3 = agg3.finalize({
    timestamp: T0 + FRAME_MS,
    report: { track_settings: { stream_owner: 'host' } },
  });
  assert.equal(win3.quality.loudness_contaminated, true);
}

// ─── Scenario I: recordEvent → SignalEventLog → ladyna tna() round trip ───
// Controller-shaped state events pass through recordEvent into the per-event
// log in record() shape, and toSequences({ modality: 'voice' }) feeds tna()
// with no reshape step — the same payoff contract as signal-event-tna.test.js.
{
  const log = new SignalEventLog({ now: () => WALL0, monotonicNow: () => 0 });
  log.start({ capture_id: 'cap-v', session_id: 'sess-v' });

  const agg = makeAggregator({ onEvent: (event) => log.record(event) });
  agg.start({ timestamp: T0 });

  const states = ['start', 'speech', 'pause', 'speech', 'silence', 'playback', 'contaminated', 'speech', 'end'];
  states.forEach((state, k) => {
    agg.recordEvent({ state, timestamp_ms: T0 + k * 500, states_version: 'voice-states-v1', detail: { k } });
  });

  assert.equal(log.size, states.length);
  const stored = log.all();
  assert.equal(stored[5].source, 'ai', 'playback is the AI speaking');
  assert.equal(stored[6].source, 'ai', 'contaminated is AI leakage');
  assert.equal(stored[1].source, 'user');
  assert.equal(stored[0].state_vocabulary, 'voice-states-v1');
  assert.equal(stored[2].monotonic_ms, T0 + 2 * 500);

  const sequences = log.toSequences({ modality: 'voice' });
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0], states);

  const model = tna(sequences);
  assert.deepEqual([...model.labels].sort(), [...new Set(states)].sort());
  // Row-stochastic invariant for any state with an outgoing edge.
  for (let r = 0; r < model.weights.rows; r += 1) {
    let rowSum = 0;
    for (let c = 0; c < model.weights.cols; c += 1) rowSum += model.weights.get(r, c);
    if (rowSum > 0) assert.ok(Math.abs(rowSum - 1) < 1e-9, `row ${r} sum ${rowSum}`);
  }
  // Hand-counted transitions in the 9-state chain: speech appears 3 times,
  // with outgoing edges speech->pause, speech->silence, speech->end (1 each).
  const freq = ftna(sequences);
  const idx = (label) => freq.labels.indexOf(label);
  assert.equal(freq.weights.get(idx('speech'), idx('pause')), 1);
  assert.equal(freq.weights.get(idx('playback'), idx('contaminated')), 1);
  assert.equal(freq.weights.get(idx('contaminated'), idx('speech')), 1);
  let totalEdges = 0;
  for (let r = 0; r < freq.weights.rows; r += 1) {
    for (let c = 0; c < freq.weights.cols; c += 1) totalEdges += freq.weights.get(r, c);
  }
  assert.equal(totalEdges, states.length - 1);

  // An unknown state is a programming error, never logged quietly.
  assert.throws(() => agg.recordEvent({ state: 'humming' }), /OYON_VOICE_STATES/);
}

// ═══ Statistical-defect regressions (adversarial review, finding 7) ═══════

// ─── Scenario J: a playback frame contributes to excluded_playback_ms and
// contaminated_coverage and to NOTHING else — not the vad/clipped/hidden
// coverages it used to leak into ───────────────────────────────────────────
{
  // Playback-only turn: one leaked-speech playback frame that is also
  // clipped and hidden. Used to report vad/clipped/hidden coverage 1.
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  agg.recordFrame(feat({ clippedSamples: 3 }), { timestamp: T0, speechProbability: 1, inPlayback: true, hidden: true });
  const v = agg.finalize({ timestamp: T0 + FRAME_MS }).voice;
  assert.equal(v.speech_duration_ms, 0);
  assert.equal(v.excluded_playback_ms, 100);
  assert.equal(v.contaminated_coverage, 1, 'leaked speech during playback / all frames');
  assert.equal(v.vad_coverage, null, 'no learner frames -> nothing to cover, NOT a fully-VAD-covered turn');
  assert.equal(v.clipped_coverage, null, 'the AI clipping its own audio is not learner clipping');
  assert.equal(v.hidden_coverage, null, 'hidden was only ever supplied on a playback frame');
  assert.equal(v.muted_coverage, null);
  assert.equal(v.speech_ratio, null, 'no learner timeline at all -> unmeasurable, not 0');

  // Mixed turn: 1 playback frame (leaked, clipped, hidden) + 4 clean learner
  // speech frames — learner-scoped coverages use denominator 4, not 5.
  const agg2 = makeAggregator();
  agg2.start({ timestamp: T0 });
  agg2.recordFrame(feat({ clippedSamples: 3 }), { timestamp: T0, speechProbability: 1, inPlayback: true, hidden: true });
  for (let i = 1; i < 5; i += 1) {
    agg2.recordFrame(feat({ rms: 0.1, peak: 0.3 }), { timestamp: T0 + i * FRAME_MS, speechProbability: 0.9 });
  }
  const v2 = agg2.finalize({ timestamp: T0 + 5 * FRAME_MS }).voice;
  assert.equal(v2.turn_duration_ms, 500);
  assert.equal(v2.speech_duration_ms, 400);
  assert.equal(v2.speech_ratio, 1, '400 ms speech over the 400 ms learner timeline');
  assert.equal(v2.vad_coverage, 1, '4 / 4 learner frames');
  assert.equal(v2.clipped_coverage, 0, '0 / 4 learner frames — the playback clip does not count');
  assert.equal(v2.hidden_coverage, null, 'hidden never supplied on a learner frame');
  assert.equal(v2.contaminated_coverage, 1 / 5, 'turn-wide: 1 leaked frame / all 5 frames');
  assert.equal(v2.excluded_playback_ms, 100);
}

// ─── Scenario K: pitch is never measured on frames the VAD called non-speech;
// with no VAD at all, the DSP voicing decision stands on its own ───────────
{
  // Two confidently-voiced frames that the VAD scored 0 (hum/bleed, not the
  // learner). Used to publish a plausible 150 Hz median for a turn with NO
  // detected speech.
  const agg = makeAggregator({ minVoicedFramesForPitch: 2 });
  agg.start({ timestamp: T0 });
  agg.recordFrame(feat({ voiced: true, f0Hz: 100, f0Confidence: 1 }), { timestamp: T0, speechProbability: 0 });
  agg.recordFrame(feat({ voiced: true, f0Hz: 200, f0Confidence: 1 }), { timestamp: T0 + FRAME_MS, speechProbability: 0 });
  const v = agg.finalize({ timestamp: T0 + 2 * FRAME_MS }).voice;
  assert.equal(v.speech_duration_ms, 0);
  assert.equal(v.pitch_median_hz, null, 'no speech -> no pitch, never a fabricated 150 Hz');
  assert.equal(v.pitch_iqr_hz, null);
  assert.equal(v.pitch_slope_hz_per_s, null);
  assert.equal(v.pitch_confidence_mean, null);
  assert.equal(v.pitch_frames_excluded_ratio, null, 'VAD-rejected frames are not pitch candidates at all');
  assert.equal(v.pitch_coverage, null, 'no speech frames -> nothing to cover');
  assert.equal(v.voiced_frame_ratio, 1, 'the DSP-level voicing rate is deliberately NOT VAD-gated (documented)');

  // VAD-less pipeline (speechProbability null): DSP voicing stands alone and
  // pitch IS measured. Hand-computed over f0s [100, 200]: median 150, IQR
  // (175 - 125) = 50, slope (200-100)Hz / 0.1s = 1000 Hz/s.
  const agg2 = makeAggregator({ minVoicedFramesForPitch: 2 });
  agg2.start({ timestamp: T0 });
  agg2.recordFrame(feat({ voiced: true, f0Hz: 100, f0Confidence: 1 }), { timestamp: T0, speechProbability: null });
  agg2.recordFrame(feat({ voiced: true, f0Hz: 200, f0Confidence: 1 }), { timestamp: T0 + FRAME_MS, speechProbability: null });
  const v2 = agg2.finalize({ timestamp: T0 + 2 * FRAME_MS }).voice;
  assert.equal(v2.pitch_median_hz, 150, 'no VAD ran -> DSP voicing is the only evidence and pitch is still measured');
  assert.equal(v2.pitch_iqr_hz, 50);
  assert.ok(Math.abs(v2.pitch_slope_hz_per_s - 1000) < 1e-9);
  assert.equal(v2.vad_coverage, 0);
  assert.ok(v2.insufficient_reasons.includes('poor_vad_coverage'), 'the VAD-less turn is flagged, not silently trusted');

  // Mixed turn: VAD-speech voiced frames keep their pitch; VAD-rejected
  // voiced frames (f0 400) stay out of the distribution.
  const agg3 = makeAggregator({ minVoicedFramesForPitch: 3 });
  agg3.start({ timestamp: T0 });
  const f0s = [100, 110, 120];
  f0s.forEach((f0, i) => {
    agg3.recordFrame(feat({ rms: 0.1, peak: 0.3, voiced: true, f0Hz: f0, f0Confidence: 0.9 }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: 0.9,
    });
  });
  for (let i = 3; i < 5; i += 1) {
    agg3.recordFrame(feat({ voiced: true, f0Hz: 400, f0Confidence: 0.9 }), {
      timestamp: T0 + i * FRAME_MS, speechProbability: 0.1,
    });
  }
  const v3 = agg3.finalize({ timestamp: T0 + 5 * FRAME_MS }).voice;
  assert.equal(v3.pitch_median_hz, 110, 'median of the 3 speech-frame f0s; the 400 Hz VAD-rejected frames never enter');
  assert.equal(v3.pitch_coverage, 1, '3 kept / 3 speech frames');
  assert.equal(v3.voiced_frame_ratio, 1, 'all 5 analyzable frames were DSP-voiced');
}

// ─── Scenario L: a missing rms is an ABSENT measurement — excluded from the
// loudness statistics and from analyzable_speech_ms, never coerced to 0 ────
{
  const agg = makeAggregator();
  agg.start({ timestamp: T0 });
  agg.recordFrame(feat({ rms: 1, peak: 0.6 }), { timestamp: T0, speechProbability: 1 });
  agg.recordFrame(feat({ rms: null, peak: 0.6 }), { timestamp: T0 + FRAME_MS, speechProbability: 1 });
  const v = agg.finalize({ timestamp: T0 + 2 * FRAME_MS }).voice;
  assert.equal(v.speech_duration_ms, 200, 'both frames are still VAD speech time');
  assert.equal(v.rms_mean, 1, 'mean over the one MEASURED frame — a fake 0 would have dragged it to 0.5');
  assert.equal(v.rms_variability, 0, 'one measured value -> zero spread');
  assert.ok(Math.abs(v.peak_to_average_ratio - 0.6 / 1) < 1e-12, 'peak is measured on both frames; mean only on the measured one');
  assert.equal(v.analyzable_speech_ms, 100, 'speech whose loudness could not be measured is not analyzable speech');
  assert.equal(v.near_silence_ratio, 0, '0 near-silent / 1 rms-measured frame — the unmeasured frame cannot testify');
}

// ─── Lifecycle guards ─────────────────────────────────────────────────────
{
  const agg = makeAggregator();
  // Not started: recordFrame/recordEvent no-op, finalize returns null.
  agg.recordFrame(feat({ rms: 0.5 }), { timestamp: T0, speechProbability: 0.9 });
  agg.recordEvent({ state: 'speech', timestamp_ms: T0 });
  assert.equal(agg.finalize({ timestamp: T0 }), null);
  assert.equal(agg.active, false);
  agg.start({ timestamp: T0 });
  assert.equal(agg.active, true);
}

console.log('voice-aggregator.test.js passed');
