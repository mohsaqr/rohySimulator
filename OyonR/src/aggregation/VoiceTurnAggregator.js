/**
 * VoiceTurnAggregator — aggregates one authorized voice turn (the period
 * between the host's push-to-talk start and stop) into a `voice-v1` episode
 * window, mirroring the episode conventions of `TypingAggregator`
 * (audio_text.md §5.6; window shape: `{ modality: 'voice', window_kind:
 * 'episode', feature_profile: 'voice-v1', ... }`).
 *
 * This class is PURE: no DOM, no audio, no timers, no globals. Per-frame DSP
 * results come from `analyzeFrame` (src/analytics/voiceFeatures.js) via the
 * capture layer (`createVoiceTurnController`'s `onFrameFeatures`); this class
 * only accumulates. The only wall-clock use is `options.now()`, exclusively
 * for the ISO `window_start` / `window_end` strings — it never enters any
 * duration computation. All durations accumulate in frame units
 * (`options.frameMs` per frame), the same deterministic convention the
 * controller uses.
 *
 * ── Scope: §5.6's TRIMMED set, deliberately ────────────────────────────────
 * The `voice-v1` profile was trimmed from ~45 to ~15 measurements so §5.10's
 * frozen-threshold validation gate stays affordable. Jitter, shimmer, HNR,
 * formants, spectral flatness/slope/band ratios, and beginning/middle/end
 * thirds are §5.7 deferrals — do NOT add them here.
 *
 * ── Null discipline (the most important convention in this file) ──────────
 * A statistic that could not be measured is `null`, never 0:
 *   - every pitch statistic (`pitch_median_hz`, `pitch_iqr_hz`,
 *     `pitch_slope_hz_per_s`, `pitch_confidence_mean`) is `null` when fewer
 *     than `minVoicedFramesForPitch` confident voiced frames were seen — a
 *     turn with no detectable pitch is not a turn at 0 Hz;
 *   - `spectral_centroid_mean_hz` / `spectral_rolloffs` on a silent turn are
 *     `null` because the DSP layer already reports per-frame nulls there and
 *     this class excludes nulls from means rather than coercing them;
 *   - a per-frame feature that is missing (e.g. a non-finite `rms`) is an
 *     ABSENT measurement: it is excluded from every mean/ratio it would have
 *     entered (and from `analyzable_speech_ms`) — never coerced to 0;
 *   - every ratio whose denominator is 0 (`speech_ratio` on a turn with no
 *     learner frames, `voiced_frame_ratio` with no analyzable frames, all
 *     coverages with no frames in their scope) is `null`.
 *
 * ── AI playback exclusion (§5.9) ──────────────────────────────────────────
 * Frames flagged `inPlayback` are excluded from LEARNER measurement
 * ENTIRELY: they contribute to `excluded_playback_ms` and (when the VAD
 * called them speech) to `contaminated_coverage`, and to nothing else — not
 * speech/silence structure, not loudness, not pitch, not spectrum, and not
 * the learner-scoped coverages either. Concretely:
 *   - `vad_coverage`, `clipped_coverage`, `muted_coverage`, and
 *     `hidden_coverage` are computed over NON-PLAYBACK (learner) frames
 *     only — a turn that was mostly playback must not report the AI's
 *     frames as covered learner measurement;
 *   - `contaminated_coverage` is the one deliberately turn-wide figure
 *     (leaked-speech playback frames over ALL frames);
 *   - `speech_ratio` divides learner speech time by the LEARNER (non-
 *     playback) timeline — muted learner time included, playback time not —
 *     so "share of the learner's own turn spent speaking" stays true when
 *     the AI talked for half the wall clock. `turn_duration_ms` remains the
 *     wall-clock turn span.
 *
 * ── VAD gating of pitch (frames the VAD called non-speech) ────────────────
 * A frame the VAD explicitly scored below `vadThreshold` is non-speech: its
 * DSP `voiced`/`f0Hz` output (often periodic hum, playback bleed, or music)
 * must not enter the pitch statistics — a turn with no detected speech must
 * never publish a plausible-looking median F0. When NO VAD probability was
 * supplied at all, the DSP voicing decision stands on its own (a VAD-less
 * pipeline still measures pitch). `voiced_frame_ratio` is deliberately NOT
 * VAD-gated: it reports the DSP's own voicing rate over analyzable frames,
 * and disagreement between it and `speech_duration_ms` is itself signal.
 *
 * ── AGC contamination (§5.6 "decide, don't just report") ──────────────────
 * When the capture report says AGC was active (or the stream is host-owned
 * with AGC unknown), absolute loudness figures are artifacts of the gain
 * controller, not the speaker. They are still EMITTED — this repo's data
 * policy forbids withholding signal — but `quality.loudness_contaminated` is
 * set so no downstream consumer mistakes them for comparable measurements.
 * Within-turn RELATIVE loudness measures (`rms_variability`,
 * `peak_to_average_ratio`, `near_silence_ratio`) remain usable under AGC;
 * the absolute ones (`rms_mean`) do not.
 *
 * ── insufficient_data (§10.3 acceptance criterion) ────────────────────────
 * Low-quality input must produce uncertainty states, not confident values.
 * `insufficient_data` is true — with machine-readable `insufficient_reasons`
 * — when the turn is too short, has too little analyzable speech, is
 * dominated by clipping, or the VAD covered too few frames. The measured
 * values are still emitted alongside the flag (record everything; flag the
 * uncertainty).
 *
 * ── Event pass-through ────────────────────────────────────────────────────
 * `recordEvent()` accepts the controller's `onEvent` payloads
 * (`{ state, timestamp_ms, states_version, detail }`, states from
 * `OYON_VOICE_STATES`) and re-emits each one through `options.onEvent` in
 * the SignalEventLog `record()` shape (`{ modality: 'voice', state, source,
 * timestamp, monotonic_ms, detail }`) so a host can wire the voice state
 * stream straight into the per-event log and from there into ladyna `tna()`.
 * This class does not synthesize states of its own — the controller owns the
 * turn state machine — and `start()` therefore dispatches nothing (the
 * controller's own 'start' event arrives via `recordEvent`).
 */

import { OYON_VOICE_STATES } from '../version.js';

const MODALITY = 'voice';
const FEATURE_PROFILE = 'voice-v1';
const WINDOW_KIND = 'episode';

/** Controller states whose actor is the AI side of the conversation. */
const AI_SOURCED_STATES = new Set(['playback', 'contaminated']);

export class VoiceTurnAggregator {
  constructor(options = {}) {
    this.options = {
      // Duration of one analysis frame (ms). Must match the capture layer's
      // framing (`voice_frame_ms`, default 32 ms = 512 samples at 16 kHz).
      // All duration fields accumulate in these units — deterministic and
      // clock-independent, same as the controller.
      frameMs: 32,
      // A frame is speech-like when speechProbability >= this (mirrors the
      // controller's `voice_vad_threshold` default).
      vadThreshold: 0.5,
      // An internal silence run (between two speech runs) at/above this is an
      // internal PAUSE (counted + totalled); shorter internal runs still land
      // in the histogram's low buckets but are not pauses.
      pauseThresholdMs: 500,
      // Upper bounds (ms) for `pause_histogram` over internal silence runs —
      // same bucket-key convention as TypingAggregator's pause histogram.
      pauseBuckets: [500, 1000, 2000, 5000],
      // Pitch statistics need at least this many confident voiced frames;
      // below the floor every pitch statistic is null, never 0.
      minVoicedFramesForPitch: 5,
      // A voiced frame's f0 enters the pitch statistics only when its NSDF
      // confidence reaches this; voiced-but-below-threshold frames count into
      // `pitch_frames_excluded_ratio`. Deliberately above estimateF0's own
      // 0.5 clarity floor so the exclusion is a real second gate.
      minPitchConfidence: 0.6,
      // insufficient_data thresholds (§10.3): turn shorter than this…
      minTurnMs: 1000,
      // …or with less clip-free speech than this…
      minAnalyzableMs: 500,
      // …or with more than this share of clipped frames…
      maxClippingRatio: 0.05,
      // …or with the VAD covering less than this share of frames…
      minVadCoverage: 0.5,
      // …or when the worker analysis path dropped more than this share of
      // frames under backpressure (report.dropped_frame_ratio). 0.2 means
      // one dropped frame in five: past that, speech/pitch statistics are
      // measured on a visibly incomplete frame stream and the turn must
      // read as uncertain, not clean.
      maxDroppedFrameRatio: 0.2,
      // A frame with rms below this counts as near-silence.
      nearSilenceRms: 0.01,
      // Wall clock, used ONLY for the ISO window_start / window_end strings.
      now: () => Date.now(),
      // Per-event sink (SignalEventLog-shaped re-emission of controller
      // events — see class doc). null (default) means emit nothing.
      onEvent: null,
      ...options,
    };
    this._reset();
  }

  /** True while a turn is in progress (between start/finalize). */
  get active() {
    return this._started;
  }

  /** Begin a new turn. Discards any prior unfinished turn. */
  start({ timestamp, targetKind = null, targetId = null }) {
    this._reset();
    this._started = true;
    this._startTimestamp = timestamp;
    this._startWallClock = this.options.now();
    this._target = (targetKind != null || targetId != null)
      ? { kind: targetKind, id: targetId }
      : null;
  }

  /**
   * Consume one per-frame DSP record (the `analyzeFrame` result for the frame
   * the controller handed to `onFrameFeatures`). No-op when not active.
   *
   * @param {object} features  `analyzeFrame` output: `{ rms, peak,
   *   clippedSamples, zeroCrossingRate, centroidHz, rolloffHz, f0Hz,
   *   f0Confidence, voiced }`. `f0Hz` is null on unvoiced frames and
   *   `centroidHz`/`rolloffHz` are null on silence — nulls are EXCLUDED from
   *   the statistics here, never coerced to 0.
   * @param {object} meta  `{ timestamp, speechProbability, inPlayback,
   *   muted?, hidden? }` — `timestamp` monotonic ms; `speechProbability`
   *   null when no VAD ran; `muted`/`hidden` optional additive flags.
   */
  recordFrame(features, { timestamp, speechProbability = null, inPlayback = false, muted = false, hidden } = {}) {
    if (!this._started || !features) return;

    this._totalFrames += 1;
    const frameMs = this.options.frameMs;

    const hasVad = speechProbability != null && Number.isFinite(speechProbability);
    const speechLike = hasVad && speechProbability >= this.options.vadThreshold;

    if (inPlayback) {
      // §5.9: excluded from learner measurement entirely — a playback frame
      // contributes to `excluded_playback_ms` and (when the VAD called it
      // speech — leakage, not the learner) to `contaminated_coverage`, and
      // to NOTHING else: not the vad/clipped/hidden/muted coverages, not
      // structure, not loudness, not pitch, not spectrum.
      this._playbackFrames += 1;
      if (speechLike) this._contaminatedFrames += 1;
      return;
    }

    // ── learner (non-playback) frame: coverage denominators live here ─────
    this._learnerFrames += 1;
    if (hidden !== undefined) {
      this._sawHidden = true;
      if (hidden === true) this._hiddenFrames += 1;
    }
    if (hasVad) this._vadFrames += 1;
    const clippedFrame = (features.clippedSamples || 0) > 0;
    if (clippedFrame) this._clippedFrames += 1;

    if (muted === true) {
      // A muted frame is structural non-speech time: it extends silence runs
      // and the turn timeline but is excluded from loudness/pitch/spectrum
      // (its samples are synthetic zeros, not the learner).
      this._mutedFrames += 1;
      this._advanceStructure(false);
      return;
    }

    // ── analyzable frame: full accounting ─────────────────────────────────
    this._analyzedFrames += 1;
    const rmsMeasured = Number.isFinite(features.rms);
    if (rmsMeasured) {
      this._rmsMeasuredFrames += 1;
      if (features.rms < this.options.nearSilenceRms) this._nearSilenceFrames += 1;
    }
    if (clippedFrame) this._clippedAnalyzedFrames += 1;

    if (Number.isFinite(features.centroidHz)) {
      this._centroidSum += features.centroidHz;
      this._centroidFrames += 1;
    }
    if (Number.isFinite(features.rolloffHz)) {
      this._rolloffSum += features.rolloffHz;
      this._rolloffFrames += 1;
    }

    // Pitch is VAD-gated (class doc "VAD gating of pitch"): a frame the VAD
    // explicitly called non-speech contributes NO pitch candidate — its DSP
    // voicing is hum/bleed, not the learner speaking. With no VAD at all
    // (`!hasVad`) the DSP voicing decision stands on its own.
    if ((speechLike || !hasVad) && features.voiced === true && Number.isFinite(features.f0Hz)) {
      this._pitchCandidateFrames += 1;
      if (features.f0Confidence >= this.options.minPitchConfidence) {
        // Time axis for the slope fit: the caller's monotonic timestamp when
        // finite, else the deterministic frame-count clock.
        const t = Number.isFinite(timestamp) ? timestamp : this._structuralMs;
        this._pitchSamples.push({ t, f0: features.f0Hz, confidence: features.f0Confidence });
      }
    }
    // Deliberately NOT VAD-gated — the DSP's own voicing rate (see class doc).
    if (features.voiced === true) this._voicedFrames += 1;

    if (speechLike) {
      // Loudness statistics are speech-scoped: silence frames would drag
      // rms_mean toward the noise floor and make speech loudness unreadable.
      // A frame with no finite rms is an ABSENT loudness measurement: it is
      // excluded from the loudness statistics AND from analyzable_speech_ms
      // (speech that could not be measured is not analyzable speech) — never
      // coerced to a fake 0 that drags the mean down.
      if (rmsMeasured) {
        this._speechRmsFrames += 1;
        this._speechRmsSum += features.rms;
        this._speechRmsSumSq += features.rms * features.rms;
        if (!clippedFrame) this._analyzableSpeechMs += frameMs;
      }
      if (Number.isFinite(features.peak) && features.peak > this._speechPeakMax) {
        this._speechPeakMax = features.peak;
      }
    }

    this._advanceStructure(speechLike);
  }

  /**
   * Consume one controller state event (`{ state, timestamp_ms, detail }`,
   * state from `OYON_VOICE_STATES`) and re-emit it through `options.onEvent`
   * in the SignalEventLog `record()` shape. Throws on a state outside the
   * closed voice-states-v1 vocabulary — an unknown state is a programming
   * error, never something to log quietly. No-op when not active.
   */
  recordEvent(event) {
    if (!this._started || !event) return;
    const { state, timestamp_ms: timestampMs = null, detail = null } = event;
    if (!OYON_VOICE_STATES.includes(state)) {
      throw new Error(`VoiceTurnAggregator: '${state}' is not a member of OYON_VOICE_STATES`);
    }
    if (typeof this.options.onEvent !== 'function') return;
    const monotonic = Number.isFinite(timestampMs) ? timestampMs : this._startTimestamp;
    this.options.onEvent({
      modality: MODALITY,
      state,
      // playback/contaminated are the AI speaking (or leaking); everything
      // else is the learner's own turn activity.
      source: AI_SOURCED_STATES.has(state) ? 'ai' : 'user',
      timestamp: this._startWallClock + (monotonic - this._startTimestamp),
      monotonic_ms: monotonic,
      detail,
    });
  }

  /**
   * End the turn and return its `voice-v1` window, or `null` if no turn was
   * active. `report` is the controller's `stopTurn()` report — its
   * `track_settings` populate the capture-condition fields and decide
   * `loudness_contaminated`; a missing report degrades those fields to null
   * (unknown), never to fabricated values.
   */
  finalize({ timestamp, report = null } = {}) {
    if (!this._started) return null;

    const opts = this.options;
    const turnDurationMs = Math.max(0, timestamp - this._startTimestamp);

    // Close the structural timeline: silence still pending at the end of the
    // turn is TRAILING silence (never an internal pause); a turn with no
    // speech at all is one long initial silence.
    let initialSilenceMs;
    let trailingSilenceMs;
    if (this._sawSpeech) {
      initialSilenceMs = this._initialSilenceMs;
      trailingSilenceMs = this._pendingSilenceMs;
    } else {
      initialSilenceMs = this._structuralMs;
      trailingSilenceMs = 0;
    }

    const speechMs = this._speechMs;
    const speechFrames = this._speechFrames;
    const segmentCount = this._segmentCount;

    // ── loudness (speech-scoped, over frames with a MEASURED rms only —
    // a missing rms is an absent measurement, never a 0; see recordFrame) ──
    const speechRmsFrames = this._speechRmsFrames;
    let rmsMean = null;
    let rmsVariability = null;
    let peakToAverageRatio = null;
    if (speechRmsFrames > 0) {
      rmsMean = this._speechRmsSum / speechRmsFrames;
      // Population SD of the per-frame speech rms values.
      const variance = Math.max(0, this._speechRmsSumSq / speechRmsFrames - rmsMean * rmsMean);
      rmsVariability = Math.sqrt(variance);
      peakToAverageRatio = rmsMean > 0 ? this._speechPeakMax / rmsMean : null;
    }

    // ── pitch (null below the voiced-frame floor — never 0) ───────────────
    const kept = this._pitchSamples;
    let pitchMedianHz = null;
    let pitchIqrHz = null;
    let pitchSlopeHzPerS = null;
    let pitchConfidenceMean = null;
    if (kept.length >= opts.minVoicedFramesForPitch) {
      const f0s = kept.map((sample) => sample.f0).sort((a, b) => a - b);
      pitchMedianHz = quantileSorted(f0s, 0.5);
      pitchIqrHz = quantileSorted(f0s, 0.75) - quantileSorted(f0s, 0.25);
      pitchSlopeHzPerS = olsSlopePerSecond(kept);
      pitchConfidenceMean = kept.reduce((total, sample) => total + sample.confidence, 0) / kept.length;
    }
    const pitchFramesExcludedRatio = this._pitchCandidateFrames > 0
      ? (this._pitchCandidateFrames - kept.length) / this._pitchCandidateFrames
      : null;

    // ── coverages (null when there is nothing to cover) ───────────────────
    // Learner-scoped coverages divide by NON-PLAYBACK frames only (§5.9 —
    // playback contributes to nothing but excluded_playback_ms and
    // contaminated_coverage); `contaminated_coverage` alone is turn-wide.
    const totalFrames = this._totalFrames;
    const learnerFrames = this._learnerFrames;
    const learnerCoverage = (count) => (learnerFrames > 0 ? count / learnerFrames : null);
    const vadCoverage = learnerCoverage(this._vadFrames);
    const clippedCoverage = learnerCoverage(this._clippedFrames);

    // ── worker analysis-path health (from the controller report) ──────────
    const processingMode = report?.processing_mode === 'worker' || report?.processing_mode === 'main-thread'
      ? report.processing_mode
      : null;
    const droppedFrames = Number.isFinite(report?.dropped_frames) ? report.dropped_frames : null;
    const droppedFrameRatio = Number.isFinite(report?.dropped_frame_ratio)
      ? report.dropped_frame_ratio
      : (droppedFrames != null && totalFrames > 0 ? droppedFrames / totalFrames : null);

    // ── insufficient_data (§10.3): uncertainty states, not confident values ─
    const insufficientReasons = [];
    if (turnDurationMs < opts.minTurnMs) insufficientReasons.push('turn_too_short');
    if (this._analyzableSpeechMs < opts.minAnalyzableMs) insufficientReasons.push('insufficient_analyzable_speech');
    if (clippedCoverage != null && clippedCoverage > opts.maxClippingRatio) insufficientReasons.push('excessive_clipping');
    if (vadCoverage == null || vadCoverage < opts.minVadCoverage) insufficientReasons.push('poor_vad_coverage');
    // Backpressure drops: a turn measured on a visibly incomplete frame
    // stream must not read as a clean measurement.
    if (droppedFrameRatio != null && droppedFrameRatio > opts.maxDroppedFrameRatio) insufficientReasons.push('dropped_frames');

    // ── capture conditions + AGC contamination (from the controller report) ─
    const track = report?.track_settings ?? null;
    const agc = typeof track?.auto_gain_control === 'boolean' ? track.auto_gain_control : null;
    const streamOwner = track?.stream_owner === 'oyon' || track?.stream_owner === 'host'
      ? track.stream_owner
      : null;
    let loudnessContaminated = null;
    if (typeof track?.loudness_contaminated === 'boolean') {
      loudnessContaminated = track.loudness_contaminated;
    } else if (track) {
      // Same rule the controller applies: AGC on — or a host-owned stream
      // whose AGC state is unknowable — makes absolute loudness an artifact
      // of the gain controller.
      loudnessContaminated = agc === true || (streamOwner === 'host' && agc == null);
    }

    const window = {
      modality: MODALITY,
      window_kind: WINDOW_KIND,
      feature_profile: FEATURE_PROFILE,
      window_start: new Date(this._startWallClock).toISOString(),
      window_end: new Date(this.options.now()).toISOString(),
      voice: {
        // ── turn and speech structure ──
        turn_duration_ms: turnDurationMs,
        speech_duration_ms: speechMs,
        // Learner speech time over the LEARNER (non-playback) timeline —
        // muted learner time included, AI playback time not (§5.9: playback
        // is excluded from learner measurement entirely, denominators
        // included). Null when no learner frames were seen.
        speech_ratio: this._structuralMs > 0 ? Math.min(1, speechMs / this._structuralMs) : null,
        initial_silence_ms: initialSilenceMs,
        trailing_silence_ms: trailingSilenceMs,
        internal_pause_count: this._internalPauseCount,
        internal_pause_total_ms: this._internalPauseTotalMs,
        pause_histogram: this._pauseHistogram,
        speech_segment_count: segmentCount,
        segment_duration_mean_ms: segmentCount > 0 ? speechMs / segmentCount : null,
        excluded_playback_ms: this._playbackFrames * opts.frameMs,
        muted_ms: this._mutedFrames * opts.frameMs,
        // ── pitch and voicing ──
        voiced_frame_ratio: this._analyzedFrames > 0 ? this._voicedFrames / this._analyzedFrames : null,
        pitch_median_hz: pitchMedianHz,
        pitch_iqr_hz: pitchIqrHz,
        pitch_slope_hz_per_s: pitchSlopeHzPerS,
        pitch_confidence_mean: pitchConfidenceMean,
        pitch_frames_excluded_ratio: pitchFramesExcludedRatio,
        // ── loudness and energy (see quality.loudness_contaminated) ──
        rms_mean: rmsMean,
        rms_variability: rmsVariability,
        peak_to_average_ratio: peakToAverageRatio,
        clipping_ratio: this._analyzedFrames > 0 ? this._clippedAnalyzedFrames / this._analyzedFrames : null,
        // Over analyzable frames whose rms was actually MEASURED — a frame
        // with no rms cannot testify about near-silence either way.
        near_silence_ratio: this._rmsMeasuredFrames > 0 ? this._nearSilenceFrames / this._rmsMeasuredFrames : null,
        // ── spectrum (centroid + roll-off ONLY — §5.7 defers the rest) ──
        spectral_centroid_mean_hz: this._centroidFrames > 0 ? this._centroidSum / this._centroidFrames : null,
        spectral_rolloff_mean_hz: this._rolloffFrames > 0 ? this._rolloffSum / this._rolloffFrames : null,
        // ── quality and uncertainty ──
        sample_rate: Number.isFinite(track?.sample_rate) ? track.sample_rate : null,
        channel_count: Number.isFinite(track?.channel_count) ? track.channel_count : null,
        echo_cancellation: typeof track?.echo_cancellation === 'boolean' ? track.echo_cancellation : null,
        noise_suppression: typeof track?.noise_suppression === 'boolean' ? track.noise_suppression : null,
        auto_gain_control: agc,
        stream_owner: streamOwner,
        clipped_coverage: clippedCoverage,
        muted_coverage: learnerCoverage(this._mutedFrames),
        hidden_coverage: this._sawHidden ? learnerCoverage(this._hiddenFrames) : null,
        // The one deliberately TURN-WIDE coverage: leaked-speech playback
        // frames over all frames (playback included) — contamination is a
        // property of the whole turn, not of the learner timeline.
        contaminated_coverage: totalFrames > 0 ? this._contaminatedFrames / totalFrames : null,
        vad_coverage: vadCoverage,
        pitch_coverage: speechFrames > 0 ? Math.min(1, kept.length / speechFrames) : null,
        analyzable_speech_ms: this._analyzableSpeechMs,
        insufficient_data: insufficientReasons.length > 0,
        insufficient_reasons: insufficientReasons,
      },
      quality: {
        thresholds: {
          frame_ms: opts.frameMs,
          vad_threshold: opts.vadThreshold,
          pause_threshold_ms: opts.pauseThresholdMs,
          pause_buckets: opts.pauseBuckets,
          min_voiced_frames_for_pitch: opts.minVoicedFramesForPitch,
          min_pitch_confidence: opts.minPitchConfidence,
          min_turn_ms: opts.minTurnMs,
          min_analyzable_ms: opts.minAnalyzableMs,
          max_clipping_ratio: opts.maxClippingRatio,
          min_vad_coverage: opts.minVadCoverage,
          near_silence_rms: opts.nearSilenceRms,
          max_dropped_frame_ratio: opts.maxDroppedFrameRatio,
        },
        // ── worker analysis-path health (§5.2 thread split) ──
        // Which thread measured this turn ('worker' = off-main-thread
        // WorkerVoiceAnalyzer; 'main-thread' = same-thread analysis, either
        // the visible fallback or the legacy path; null = no report), and
        // how many frames the analyzer's bounded backpressure dropped.
        processing_mode: processingMode,
        dropped_frames: droppedFrames,
        dropped_frame_ratio: droppedFrameRatio,
        // AGC (or an unknowable host-stream AGC state) makes ABSOLUTE
        // loudness an artifact of the gain controller. The figures are still
        // emitted — never withheld — but flagged: within-turn relative
        // measures (rms_variability, peak_to_average_ratio,
        // near_silence_ratio) stay usable; absolute ones (rms_mean) are not
        // comparable across turns/users. null = capture conditions unknown.
        loudness_contaminated: loudnessContaminated,
      },
    };

    if (this._target) window.target = this._target;

    this._reset();
    return window;
  }

  // ---- internal ----

  /**
   * Advance the speech/silence structural timeline by one non-playback
   * frame. Silence runs BETWEEN speech runs are internal: runs at/above
   * `pauseThresholdMs` count as internal pauses, and every internal run
   * (any length) lands in the pause histogram. Silence before the first
   * speech frame is initial; silence still pending at finalize is trailing.
   */
  _advanceStructure(speechLike) {
    const frameMs = this.options.frameMs;
    if (speechLike) {
      if (!this._sawSpeech) {
        this._sawSpeech = true;
        this._initialSilenceMs = this._structuralMs;
      } else if (this._pendingSilenceMs > 0) {
        // Close an internal silence run.
        if (this._pendingSilenceMs >= this.options.pauseThresholdMs) {
          this._internalPauseCount += 1;
          this._internalPauseTotalMs += this._pendingSilenceMs;
        }
        const key = pauseBucketKey(this._pendingSilenceMs, this.options.pauseBuckets, this._pauseHistogramKeys);
        this._pauseHistogram[key] += 1;
      }
      if (!this._inSpeechRun) {
        this._segmentCount += 1;
        this._inSpeechRun = true;
      }
      this._pendingSilenceMs = 0;
      this._speechMs += frameMs;
      this._speechFrames += 1;
    } else {
      this._inSpeechRun = false;
      if (this._sawSpeech) this._pendingSilenceMs += frameMs;
    }
    this._structuralMs += frameMs;
  }

  _reset() {
    this._started = false;
    this._startTimestamp = null;
    this._startWallClock = null;
    this._target = null;

    // Frame counters. `_learnerFrames` = non-playback frames — the
    // denominator for every learner-scoped coverage (§5.9).
    this._totalFrames = 0;
    this._learnerFrames = 0;
    this._analyzedFrames = 0;
    this._playbackFrames = 0;
    this._contaminatedFrames = 0;
    this._mutedFrames = 0;
    this._hiddenFrames = 0;
    this._sawHidden = false;
    this._vadFrames = 0;
    this._clippedFrames = 0;
    this._clippedAnalyzedFrames = 0;
    this._rmsMeasuredFrames = 0;
    this._nearSilenceFrames = 0;
    this._voicedFrames = 0;

    // Structural timeline (non-playback frames).
    this._structuralMs = 0;
    this._sawSpeech = false;
    this._inSpeechRun = false;
    this._initialSilenceMs = 0;
    this._pendingSilenceMs = 0;
    this._speechMs = 0;
    this._speechFrames = 0;
    this._segmentCount = 0;
    this._internalPauseCount = 0;
    this._internalPauseTotalMs = 0;
    this._pauseHistogramKeys = buildPauseHistogramKeys(this.options.pauseBuckets);
    this._pauseHistogram = buildZeroedHistogram(this._pauseHistogramKeys);

    // Loudness (speech-scoped; only frames with a measured rms).
    this._speechRmsFrames = 0;
    this._speechRmsSum = 0;
    this._speechRmsSumSq = 0;
    this._speechPeakMax = 0;
    this._analyzableSpeechMs = 0;

    // Spectrum (nulls excluded, never coerced).
    this._centroidSum = 0;
    this._centroidFrames = 0;
    this._rolloffSum = 0;
    this._rolloffFrames = 0;

    // Pitch.
    this._pitchCandidateFrames = 0;
    this._pitchSamples = [];
  }
}

/**
 * Linear-interpolation quantile (R type-7) of an ASCENDING-sorted array.
 * Used for the pitch median and IQR so quartiles between two observed F0s
 * interpolate rather than snap.
 */
function quantileSorted(sorted, p) {
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const t = position - lower;
  return sorted[lower] * (1 - t) + sorted[upper] * t;
}

/**
 * Ordinary-least-squares slope of f0 (Hz) against time (SECONDS) over the
 * kept voiced samples — the `pitch_slope_hz_per_s` linear fit. Returns 0 for
 * a degenerate time axis (all samples at one instant); callers only reach
 * this with >= minVoicedFramesForPitch samples.
 */
function olsSlopePerSecond(samples) {
  const n = samples.length;
  const t0 = samples[0].t;
  let sumX = 0;
  let sumY = 0;
  for (const sample of samples) {
    sumX += (sample.t - t0) / 1000;
    sumY += sample.f0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let covXY = 0;
  let varX = 0;
  for (const sample of samples) {
    const dx = (sample.t - t0) / 1000 - meanX;
    covXY += dx * (sample.f0 - meanY);
    varX += dx * dx;
  }
  return varX > 0 ? covXY / varX : 0;
}

/** Same bucket-key derivation as TypingAggregator's pause histogram. */
function buildPauseHistogramKeys(buckets) {
  const keys = [`lt_${buckets[0]}_ms`];
  for (let i = 1; i < buckets.length; i += 1) {
    keys.push(`${buckets[i - 1]}_to_${buckets[i]}_ms`);
  }
  keys.push(`gte_${buckets[buckets.length - 1]}_ms`);
  return keys;
}

function buildZeroedHistogram(keys) {
  const histogram = {};
  for (const key of keys) histogram[key] = 0;
  return histogram;
}

function pauseBucketKey(interval, buckets, keys) {
  for (let i = 0; i < buckets.length; i += 1) {
    if (interval < buckets[i]) return keys[i];
  }
  return keys[keys.length - 1];
}
