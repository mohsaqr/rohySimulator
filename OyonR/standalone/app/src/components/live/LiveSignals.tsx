import type {
  FacialSampleSnapshot,
  PostureSampleSnapshot,
  HeartRateSampleSnapshot,
  RespirationSampleSnapshot,
  IlluminationSampleSnapshot,
} from '@/lib/runtime';
import { vitalTone } from '@/lib/vitalsTone';
import { respirationPhase, respirationStatusText } from '@/lib/respirationState.js';

/*
 * Live tiles for the v3 sensing pipelines. Each renders three distinct states,
 * because conflating them is what makes a live screen untrustworthy:
 *
 *   off       — the pipeline is disabled in Settings (say where to turn it on)
 *   waiting   — enabled, but nothing usable yet (no face / no torso / rPPG
 *               buffer still filling); shown as an explicit reason, never 0
 *   live      — a real sample
 *
 * The visuals are purpose-built rather than generic numbers: a pulse that
 * actually beats at the measured rate, a pose dot you can steer by moving your
 * head, and a stick figure that leans when you do. On a live screen the value
 * of a readout is how fast you can tell it is tracking YOU.
 */

/* Tiles share a card height with the rest of the Live grid, so each one fills
 * that height rather than pooling its content at the top and leaving a void.
 * Short states centre; the live states distribute (visual first, detail last). */
const FILL = 'flex h-full flex-col';

function OffState({ what, where }: { what: string; where: string }) {
  return (
    <div className={`${FILL} justify-center space-y-1 text-sm text-ink-2`}>
      <div className="text-xs uppercase tracking-wider text-ink-3">{what} off</div>
      <div className="text-xs">Enable it in {where}.</div>
    </div>
  );
}

function WaitingState({ reason }: { reason: string }) {
  return (
    <div className={`${FILL} justify-center`}>
      <div className="rounded border border-dashed border-line bg-surface-1 p-3 text-xs text-ink-3">
        {reason}
      </div>
    </div>
  );
}

/* ── Heart rate ───────────────────────────────────────────────────────────── */

/*
 * DECORATIVE ECG — SYNTHETIC. Drawn geometry, not data.
 *
 * Oyon has no electrodes: rPPG measures blood VOLUME in facial skin, so a
 * PQRST complex (P/QRS/T are electrical events) is not something this sensor
 * could ever produce. It is a pulse indicator — one static cycle with a dot
 * tracing it once per beat — while the NUMBERS carry every accuracy claim the
 * tile makes. Deliberate call by the project owner.
 *
 * If you ever want the real thing, the honest waveform already exists and is
 * discarded: the filtered `pulse` array in HeartRateEstimator.estimate(),
 * snapshotted before the applyHann() taper. Plot that, not this.
 *
 * ONE cycle, sized as a badge rather than a strip. Curves for the P and T
 * waves (they are rounded), straight segments for QRS (it is sharp) — drawing
 * all five with the same primitive is what makes a fake ECG look fake. The dot
 * rides this exact path via CSS offset-path, so the trace and the tracer can
 * never disagree: one definition, used twice.
 *
 * The flat runs are kept SHORT. At strip proportions most of the width is
 * isoelectric baseline, which is realistic and also dead space — at this size
 * the features have to sit close together or the thing reads as a mostly-empty
 * line with an occasional twitch.
 */
const ECG_VIEW_WIDTH = 100;
const ECG_VIEW_HEIGHT = 26;
const ECG_PATH = 'M0,13 L11,13 Q19,5 27,13 L35,13 L39,16 L45,2 L51,20 L56,13 L63,13 Q73,3 83,13 L100,13';

export function LiveHeartRateTile({
  enabled,
  active = true,
  sample,
  trackedBpm = null,
  trackedSpanSeconds = null,
  respirationEnabled,
  respiration,
  plausibleMinBpm = 60,
  plausibleMaxBpm = 100,
  plausibleMinBrpm = 9,
  plausibleMaxBrpm = 24,
  lighting = null,
}: {
  enabled: boolean;
  active?: boolean;
  sample: HeartRateSampleSnapshot | null;
  /** Illumination assessment ('good' | 'dim' | 'backlit' | 'bright' | 'unstable'). */
  lighting?: string | null;
  /** Cross-window tracked BPM — the value Analyze stores. Shown ALONGSIDE the
   *  per-sample reading, never in place of it: they are different estimators
   *  and the gap between them is the smoothing lag, which is worth seeing. */
  trackedBpm?: number | null;
  /** Seconds of history the tracker's rolling anchor spans, so the lag the
   *  tracked number carries is stated rather than inferred. */
  trackedSpanSeconds?: number | null;
  respirationEnabled?: boolean;
  respiration?: RespirationSampleSnapshot | null;
  plausibleMinBpm?: number;
  plausibleMaxBpm?: number;
  plausibleMinBrpm?: number;
  plausibleMaxBrpm?: number;
}) {
  const respTone = vitalTone({
    value: respiration?.brpm,
    confidence: respiration?.confidence,
    min: plausibleMinBrpm,
    max: plausibleMaxBrpm,
  });
  const respPhase = respirationPhase(respiration);
  const respHeld = respiration?.brpm != null && (!active || respiration.current === false);
  const respColor = respHeld ? 'var(--ink-3)' : respTone.color;
  // Respiration rides in this card rather than its own: it is literally the
  // low band of the same ROI colour signal, so separating them would imply two
  // independent sensors.
  const resp = respirationEnabled ? (
    <div className="mt-auto flex items-baseline gap-2 border-t border-line pt-2 text-xs">
      <span className="text-ink-3">breathing</span>
      {respiration?.brpm != null ? (
        <>
          <span className="text-base font-semibold tabular-nums" style={{ color: respColor }}>
            {respiration.brpm.toFixed(1)}
          </span>
          <span className="text-ink-3">br/min</span>
          <span className="ml-auto text-mini" style={{ color: respHeld ? respColor : respTone.reason ? respTone.color : 'var(--ink-3)' }}>
            {respHeld
              ? 'last reading · current signal unavailable'
              : respTone.reason
              ?? (respiration.rgbCorroborationAgrees === true ? 'RGB corroborated' : null)
              ?? (respiration.rgbCorroborationAvailable === true ? 'RGB disagrees' : null)
              ?? (respiration.windowSeconds != null ? `${respiration.windowSeconds.toFixed(0)} s window` : '~45 s window')}
          </span>
        </>
      ) : respPhase === 'confirming' ? (
        <span className="text-ink-3">{respirationStatusText(respiration)}</span>
      ) : respPhase === 'unconfirmed' ? (
        // Enough signal, no confirmed rate. Saying "acquiring" here is a lie
        // that never resolves — explain the actual rejection instead.
        <span className="text-ink-3">{respirationStatusText(respiration)}</span>
      ) : (
        <span className="text-ink-3">{respirationStatusText(respiration)} · then stability checks</span>
      )}
    </div>
  ) : null;

  /* The second number. Kept visually subordinate to the live reading — one
   * colour channel, one headline — but present whenever it exists, including
   * while the live estimate is still acquiring. */
  const trackedDelta = trackedBpm != null && sample?.bpm != null ? trackedBpm - sample.bpm : null;
  const trackedRow = trackedBpm != null ? (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-mini text-ink-3">
      <span>tracked</span>
      <span className="text-xs font-semibold tabular-nums text-ink-1">{trackedBpm.toFixed(0)}</span>
      <span>bpm</span>
      <span>
        · smoothed across windows
        {trackedSpanSeconds != null ? ` (${trackedSpanSeconds.toFixed(0)} s anchor)` : ''}
        {/* A signed gap, not an absolute one: the SIGN is the diagnosis. The
            anchor is a trailing median, so it sits behind a changing rate —
            persistently negative means the tracked value is lagging a rise. */}
        {trackedDelta != null && Math.abs(trackedDelta) >= 1
          ? `, ${trackedDelta > 0 ? '+' : ''}${trackedDelta.toFixed(0)} vs live`
          : ''}
      </span>
    </div>
  ) : null;

  if (!enabled && !respirationEnabled) {
    return <OffState what="Heart rate and breathing" where="Settings → Heart rate / Respiration" />;
  }
  const hasRememberedRate = sample?.bpm != null || respiration?.brpm != null;
  if (!active && !hasRememberedRate) {
    return <WaitingState reason="Start capture to measure pulse and breathing." />;
  }
  if (!enabled) {
    return (
      <div className={FILL}>
        <div className="flex flex-1 items-center">
          <OffState what="Heart rate" where="Settings → Heart rate (rPPG)" />
        </div>
        {resp}
      </div>
    );
  }
  if (!sample || sample.bpm == null) {
    // `ready` is false whenever the estimator has a reason, so low cadence must
    // be checked first — otherwise it can only ever read as "Acquiring".
    // Below 8 Hz the estimator cannot resolve a pulse; at that cadence the
    // buffer also never reaches its sample minimum, so say so directly.
    const lowCadence = sample?.statusReason === 'low_sample_rate'
      || (sample?.sampleRateHz != null && sample.sampleRateHz > 0 && sample.sampleRateHz < 8);
    const reason = lowCadence
      ? `Pulse cadence too low${sample.sampleRateHz != null ? ` (${sample.sampleRateHz.toFixed(1)} Hz)` : ''}. Keep this tab visible.`
      : sample?.ready === true
        ? 'No stable pulse rate — sit still and improve front lighting.'
      : `Acquiring pulse${sample?.progress != null ? ` — ${Math.round(sample.progress * 100)}%` : ''}. Hold still and keep your face lit.`;
    return (
      <div className={FILL}>
        <div className="flex flex-1 flex-col justify-center">
          <WaitingState reason={reason} />
          {trackedRow}
        </div>
        {resp}
      </div>
    );
  }

  const bpm = sample.bpm;
  const conf = sample.confidence ?? 0;
  const heldHeart = !active || sample.current === false;
  const weak = !heldHeart && (sample.qualityAccepted === false || conf < 0.5);
  // Capture problems as terse footer tags; nothing is spelled out under the number.
  const LIGHTING_TAG: Record<string, string> = {
    dim: 'low light', backlit: 'backlit', bright: 'overexposed', unstable: 'flickering light',
  };
  const heartIssues = [
    sample.motionPaused === true ? 'moving' : null,
    lighting ? LIGHTING_TAG[lighting] ?? null : null,
    sample.sampleRateHz != null && sample.sampleRateHz < 10 ? 'low fps' : null,
    weak ? 'weak signal' : null,
    heldHeart ? 'held' : null,
    !heldHeart && (bpm < plausibleMinBpm || bpm > plausibleMaxBpm) ? `outside ${plausibleMinBpm}–${plausibleMaxBpm}` : null,
  ].filter((tag): tag is string => tag != null);
  // The dot beats at the measured rate. A number can be wrong without looking
  // wrong; a pulse visibly out of step with your own is immediately obvious.
  const beatSeconds = Math.min(2, Math.max(0.3, 60 / bpm));
  // Trust colour drives the DOT and the NUMBER, not just a caption. The dot was
  // previously hardcoded red, which reads as "bad" permanently and made the
  // colour channel meaningless — the one channel the eye reads first.
  const hr = heldHeart
    ? { tone: 'null' as const, color: 'var(--ink-3)', reason: 'last reading · current signal unavailable' }
    : vitalTone({
        value: bpm,
        // A configured quality threshold is advisory, but it still has to be
        // visible. Keep the number and force the unaccepted candidate red.
        confidence: sample.qualityAccepted === false ? 0 : conf,
        min: plausibleMinBpm,
        max: plausibleMaxBpm,
      });

  return (
    <div className={FILL}>
      {/* Two thumps per cycle (systole then the softer diastolic rebound), not
          one swell — a single pulse reads as a blinking dot, which is what this
          was. The whole figure completes inside the first ~55% of the cycle so
          the rest is rest: at 50 bpm you see a beat and a pause, at 150 bpm a
          near-continuous flutter. That difference is legible without reading
          the number, which is the entire point of the animation.
          Motion is suppressed under prefers-reduced-motion — a 2-3 Hz pulsing
          element is exactly the pattern that setting exists to stop. */}
      {/* The dot animates offset-distance along ECG_PATH — one traversal per
          beat, linear. Because offset-distance advances by ARC LENGTH, the dot
          covers the long QRS excursion at the same speed it crosses the flat
          baseline, so it visibly lingers through the spike instead of
          teleporting across it. Both animations are CSS, so the reduced-motion
          rule below reaches them; a SMIL <animateMotion> would not obey it. */}
      <style>{`@keyframes oyon-beat{0%,100%{transform:scale(1)}8%{transform:scale(1.26)}20%{transform:scale(1.02)}30%{transform:scale(1.13)}55%{transform:scale(1)}}@keyframes oyon-ecg{from{offset-distance:0%}to{offset-distance:100%}}@media (prefers-reduced-motion:reduce){.oyon-heart,.oyon-ecg{animation:none!important}}`}</style>
      {/* The reading owns the card's vertical centre; the caveat sits on the
          floor (mt-auto) so the tile fills its shared height. */}
      <div className="flex flex-1 items-center gap-4">
        <span
          className="oyon-heart inline-block shrink-0"
          style={{
            animation: heldHeart ? 'none' : `oyon-beat ${beatSeconds.toFixed(2)}s ease-in-out infinite`,
            // SVG elements default to a 0 0 transform-origin in some engines,
            // so the scale is applied to the wrapping span instead — otherwise
            // the heart lunges down-right on every beat rather than swelling.
            transformOrigin: 'center',
            opacity: heldHeart ? 0.45 : undefined,
          }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="size-7 block" fill={hr.color}>
            <path d="M12 20.7l-1.45-1.32C5.4 14.74 2 11.66 2 7.9 2 4.82 4.42 2.4 7.5 2.4c1.74 0 3.41.81 4.5 2.09C13.09 3.21 14.76 2.4 16.5 2.4 19.58 2.4 22 4.82 22 7.9c0 3.76-3.4 6.84-8.55 11.49L12 20.7z" />
          </svg>
        </span>
        <div>
          {/* The headline is the LIVE per-sample estimate, and the heart beats
              at that same rate. It used to be the cross-window tracked value,
              which meant the animation ticked at a rate nobody was measuring
              and the lag hid behind the word "live". */}
          <div className="flex items-center gap-3">
            <div className="text-5xl font-semibold leading-none tabular-nums" style={{ color: hr.color }}>
              {bpm.toFixed(0)}
              <span className="ml-1.5 text-base font-normal text-ink-3">bpm</span>
              {trackedBpm != null && (
                <span className="ml-1.5 text-mini font-normal uppercase tracking-wider text-ink-3">live</span>
              )}
            </div>
            {/* Synthetic trace — see ECG_PATH. The dot laps it once per beat at
                the LIVE rate, matching the heart. aria-hidden because it
                encodes nothing a screen reader could announce; the number it
                sits beside is the content. */}
            <svg
              viewBox={`0 0 ${ECG_VIEW_WIDTH} ${ECG_VIEW_HEIGHT}`}
              /* Uniform scaling (the default `meet`), NOT
                 preserveAspectRatio="none". A non-uniform stretch would squash
                 the tracer circle into an ellipse whose shape changes with the
                 container — the one element here that cannot survive
                 anamorphic scaling. The aspect-ratio style keeps the box
                 matched to the viewBox so `meet` never letterboxes. */
              className="block w-24 shrink-0"
              style={{ aspectRatio: `${ECG_VIEW_WIDTH} / ${ECG_VIEW_HEIGHT}`, opacity: heldHeart ? 0.4 : 1 }}
              aria-hidden="true"
            >
              {/* The trace sits back at low opacity so the dot owns the eye. */}
              <path
                d={ECG_PATH}
                fill="none"
                stroke={hr.color}
                strokeOpacity={0.3}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                className="oyon-ecg"
                /* cx/cy MUST be 0: offset-path positions the element's own
                   origin, so any non-zero centre would be added on top of the
                   path coordinates and float the dot off the line. */
                cx="0"
                cy="0"
                r="2.6"
                fill={hr.color}
                style={{
                  offsetPath: `path("${ECG_PATH}")`,
                  // Keep the dot upright rather than banking into the curve — a
                  // rotating circle is invisible, but this pins the behaviour
                  // if the marker ever becomes non-circular.
                  offsetRotate: '0deg',
                  animation: heldHeart ? 'none' : `oyon-ecg ${beatSeconds.toFixed(2)}s linear infinite`,
                }}
              />
            </svg>
          </div>
          {/* Labelled "signal quality", NOT confidence: the underlying value
              is clamp01((snr - 1) / 9), a bounded index that saturates at
              SNR 10. Printing "confidence 100%" claimed certainty that webcam
              rPPG cannot have — the scale had simply hit its ceiling. */}
          {!heldHeart && !weak && (
            <div className="mt-2 text-xs text-ink-3">
              signal quality <span style={{ color: hr.color }}>{(conf * 100).toFixed(0)}%</span>
            </div>
          )}
          {trackedRow}
        </div>
      </div>
      <div className="text-mini leading-relaxed text-ink-3">
        {sample.windowSeconds != null ? `${sample.windowSeconds.toFixed(0)} s window` : '~10 s window'}
        {sample.method ? ` · ${sample.method.toUpperCase()}` : ''}
        {heartIssues.length > 0 && (
          <span style={{ color: 'var(--status-warn)' }}> · {heartIssues.join(' · ')}</span>
        )}
      </div>
      {resp}
    </div>
  );
}

/* ── Lighting ─────────────────────────────────────────────────────────────── */

const ASSESSMENT_COPY: Record<string, { tone: string; note: string }> = {
  good: { tone: 'var(--status-ok)', note: 'Exposure is in the workable range.' },
  dim: { tone: 'var(--status-warn)', note: 'Too dark — the sensor is noise-dominated. Add a light facing you.' },
  bright: { tone: 'var(--status-warn)', note: 'Over-exposed — highlights are clipping and colour detail is lost.' },
  backlit: { tone: 'var(--status-bad)', note: 'Light behind you: shadows crushed AND highlights blown. Turn to face the light source.' },
  unstable: { tone: 'var(--status-bad)', note: 'Brightness is swinging. This corrupts rPPG far more than steady dim light does.' },
};

export function LiveIlluminationTile({
  enabled,
  sample,
}: {
  enabled: boolean;
  sample: IlluminationSampleSnapshot | null;
}) {
  if (!enabled) return <OffState what="Lighting" where="Settings → Lighting" />;
  if (!sample || sample.meanLuma == null) {
    return <WaitingState reason="Waiting for camera frames." />;
  }

  const verdict = ASSESSMENT_COPY[sample.assessment ?? 'good'] ?? ASSESSMENT_COPY.good;
  const quality = sample.quality ?? 0;
  // The exposure bar shows WHERE the frame sits, with the workable 25-75%
  // band marked — a bare percentage cannot say "too dark" vs "too bright".
  const lumaPct = Math.max(0, Math.min(1, sample.meanLuma)) * 100;

  return (
    <div className={FILL}>
      <div className="flex flex-1 flex-col justify-center gap-3">
        <div>
          <div className="text-3xl font-semibold capitalize leading-none" style={{ color: verdict.tone }}>
            {sample.assessment ?? '—'}
          </div>
          <div className="mt-2 text-xs text-ink-3">
            quality <span className="tabular-nums text-ink-1">{(quality * 100).toFixed(0)}%</span>
            {' · '}exposure <span className="tabular-nums text-ink-1">{lumaPct.toFixed(0)}%</span>
          </div>
        </div>

        <div>
          <div className="relative h-2 w-full overflow-hidden rounded bg-gradient-to-r from-black/70 via-neutral-400 to-white">
            {/* workable band */}
            <span className="absolute inset-y-0 border-x border-status-ok/70" style={{ left: '25%', width: '50%' }} />
            <span
              className="absolute -top-0.5 h-3 w-0.5 rounded bg-ink-0"
              style={{ left: `calc(${lumaPct}% - 1px)` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1 flex justify-between text-micro text-ink-3">
            <span>dark</span>
            <span className="text-status-ok">workable</span>
            <span>blown</span>
          </div>
        </div>

        {(sample.clippedLow ?? 0) + (sample.clippedHigh ?? 0) > 0.02 && (
          <div className="text-mini text-ink-3">
            clipped {((sample.clippedLow ?? 0) * 100).toFixed(0)}% dark ·{' '}
            {((sample.clippedHigh ?? 0) * 100).toFixed(0)}% blown
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-line pt-2 text-mini leading-relaxed text-ink-3">
        {verdict.note}
      </div>
    </div>
  );
}

/* ── Head pose + action units ─────────────────────────────────────────────── */

const POSE_SPAN_DEG = 25; // half-range of the mini pad

export function LiveHeadPoseTile({
  enabled,
  sample,
}: {
  enabled: boolean;
  sample: FacialSampleSnapshot | null;
}) {
  if (!enabled) return <OffState what="Facial signals" where="Settings → Facial signals" />;
  if (!sample || !sample.valid || sample.yawDeg == null || sample.pitchDeg == null) {
    return <WaitingState reason="Waiting for a face with a resolvable head pose." />;
  }

  const S = 120;
  const clamp = (v: number) => Math.max(-POSE_SPAN_DEG, Math.min(POSE_SPAN_DEG, v));
  const dx = (clamp(sample.yawDeg) / POSE_SPAN_DEG) * (S / 2 - 10);
  const dy = -(clamp(sample.pitchDeg) / POSE_SPAN_DEG) * (S / 2 - 10);
  const roll = sample.rollDeg ?? 0;

  // Top few active action units — a live face rarely fires more than a couple
  // at once, and a full 7-row list is noise at 10 Hz.
  const aus = Object.entries(sample.actionUnits)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className={FILL}>
      <div className="flex flex-1 items-start gap-3">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-2/5 max-w-[150px] shrink-0" role="img" aria-label="Live head pose">
        <rect x={0.5} y={0.5} width={S - 1} height={S - 1} rx={4} fill="var(--surface-3)" stroke="var(--line)" />
        <line x1={S / 2} x2={S / 2} y1={6} y2={S - 6} stroke="var(--line)" />
        <line x1={6} x2={S - 6} y1={S / 2} y2={S / 2} stroke="var(--line)" />
        <circle cx={S / 2} cy={S / 2} r={(S / 2 - 10) / 2} fill="none" stroke="var(--line)" strokeDasharray="2 4" />
        <g transform={`translate(${S / 2 + dx},${S / 2 + dy}) rotate(${-roll})`}>
          {/* an ellipse reads as a head; its tilt shows roll directly */}
          <ellipse cx={0} cy={0} rx={9} ry={12} fill="var(--status-info)" fillOpacity={0.25} stroke="var(--status-info)" strokeWidth={1.5} />
          <line x1={-9} x2={9} y1={0} y2={0} stroke="var(--status-info)" strokeWidth={1.5} />
        </g>
      </svg>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ background: sample.facingScreen ? 'var(--status-ok)' : 'var(--status-warn)' }}
            aria-hidden="true"
          />
          <span className="text-ink-1">
            {sample.facingScreen ? 'facing the screen' : 'looking away'}
          </span>
        </div>
        <PoseRow label="Yaw" value={sample.yawDeg} hint="− left · + right" />
        <PoseRow label="Pitch" value={sample.pitchDeg} hint="− down · + up" />
        <PoseRow label="Roll" value={sample.rollDeg} hint="head tilt" />
      </div>
      </div>
      {aus.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          {aus.map(([name, v]) => (
            <div key={name} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="w-24 shrink-0 capitalize text-ink-3">{name.replace(/_/g, ' ')}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded bg-surface-2">
                <span
                  className="block h-full rounded bg-status-info"
                  style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-ink-2">
                {v.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PoseRow({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="label-eyebrow">{label}</span>
      <span className="tabular-nums text-ink-0">
        {value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}°`}
      </span>
      <span className="w-24 shrink-0 text-right text-micro text-ink-3">{hint}</span>
    </div>
  );
}

/* ── Posture ──────────────────────────────────────────────────────────────── */

export function LivePostureTile({
  enabled,
  sample,
}: {
  enabled: boolean;
  sample: PostureSampleSnapshot | null;
}) {
  if (!enabled) return <OffState what="Body posture" where="Settings → Body posture" />;
  if (!sample || !sample.valid) {
    return <WaitingState reason="Waiting for visible shoulders — sit back far enough that your upper body is in frame." />;
  }

  const S = 120;
  // A null angle means "not measurable this frame" (e.g. hips out of frame), so
  // the figure must not draw it as 0 — that would be the numeric column saying
  // "—" while the picture asserts a confidently upright posture. Unmeasured
  // segments render dashed and grey instead of solid and blue.
  const tilt = sample.shoulderTiltDeg;
  const lean = sample.torsoLeanDeg;
  const known = (v: number | null) => v != null;
  const limb = (v: number | null) => ({
    stroke: known(v) ? 'var(--status-info)' : 'var(--ink-3)',
    strokeDasharray: known(v) ? undefined : '3 3',
    strokeOpacity: known(v) ? 1 : 0.5,
  });
  const cx = S / 2;
  const shoulderY = 52;
  const halfWidth = 26;

  return (
    <div className={FILL}>
      <div className="flex flex-1 items-start gap-3">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-2/5 max-w-[150px] shrink-0" role="img" aria-label="Live posture">
        <rect x={0.5} y={0.5} width={S - 1} height={S - 1} rx={4} fill="var(--surface-3)" stroke="var(--line)" />
        {/* upright reference */}
        <line x1={cx} x2={cx} y1={shoulderY - 22} y2={S - 12} stroke="var(--line)" strokeDasharray="2 3" />
        {/* torso: leans about the hip, so the whole upper body rotates */}
        <g transform={`rotate(${(-(lean ?? 0)).toFixed(1)} ${cx} ${S - 12})`}>
          <line
            x1={cx} x2={cx} y1={shoulderY} y2={S - 12}
            strokeWidth={2.5} strokeLinecap="round" {...limb(lean)}
          />
          {/* shoulders: tilt about the neck, independently of the torso lean */}
          <g transform={`rotate(${(-(tilt ?? 0)).toFixed(1)} ${cx} ${shoulderY})`}>
            <line
              x1={cx - halfWidth} x2={cx + halfWidth} y1={shoulderY} y2={shoulderY}
              strokeWidth={2.5} strokeLinecap="round" {...limb(tilt)}
            />
          </g>
          <circle
            cx={cx} cy={shoulderY - 16} r={9}
            fill={known(lean) ? 'var(--status-info)' : 'var(--ink-3)'} fillOpacity={0.2}
            strokeWidth={1.5} {...limb(lean)}
          />
        </g>
      </svg>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <PoseRow label="Lean" value={sample.torsoLeanDeg} hint="− left · + right" />
        <PoseRow label="Tilt" value={sample.shoulderTiltDeg} hint="shoulders" />
        <div className="flex items-baseline justify-between gap-2">
          <span className="label-eyebrow">Slouch</span>
          <span className="tabular-nums text-ink-0">
            {sample.headAboveNorm == null ? '—' : sample.headAboveNorm.toFixed(2)}
          </span>
          <span className="w-24 shrink-0 text-right text-micro text-ink-3">lower = slumped</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="label-eyebrow">Proximity</span>
          <span className="tabular-nums text-ink-0">
            {sample.shoulderWidthNorm == null ? '—' : sample.shoulderWidthNorm.toFixed(3)}
          </span>
          <span className="w-24 shrink-0 text-right text-micro text-ink-3">wider = closer</span>
        </div>
      </div>
      </div>
      <div className="mt-auto border-t border-line pt-2 text-micro leading-relaxed text-ink-3">
        {sample.upperVisibility != null
          ? `upper-body visibility ${(sample.upperVisibility * 100).toFixed(0)}%`
          : 'upper-body visibility unknown'}
        {(!known(lean) || !known(tilt)) && (
          <> · dashed = not measurable from the visible landmarks</>
        )}
      </div>
    </div>
  );
}
