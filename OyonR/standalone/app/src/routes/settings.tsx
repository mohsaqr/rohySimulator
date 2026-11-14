import { type ReactNode } from 'react';
import { createRoute, useRouterState } from '@tanstack/react-router';
import { AlertCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Section } from '@/components/ui/Section';
import { Card, CardContent } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Slider } from '@/components/ui/Slider';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  DEFAULT_SETTINGS,
  snapshotSettings,
  useSettings,
  type EditableSettings,
  type SettingsState,
  type GazeEngineSetting,
  type PostureModelSetting,
  type HeartRateRoiSetting,
  type HeartRateMethodSetting,
  type VoiceEngineSetting,
} from '@/lib/settingsStore';
import { MODEL_PROFILES, type ModelProfileId } from '@/lib/modelProfiles';
import { useRuntime } from '@/lib/RuntimeProvider';
import { SETTINGS_SECTIONS } from '@/lib/settingsNav';
import { useConsent } from '@/lib/consentStore';
import { ProfilesSection } from '@/components/settings/ProfilesSection';
import { CalibrationSection } from '@/components/settings/CalibrationSection';

/*
 * Settings — versioned configuration. Edits persist to localStorage and apply
 * on the next runtime start; a drift banner surfaces when the live runtime's
 * settings_hash differs from the edited values (per feedback_no_auto_reload).
 *
 * Structure comes from lib/settingsNav.ts — that module declares the sections
 * and their grouping; this file supplies each section's body, keyed by the
 * same ids. The page was once one flat twelve-section scroll where the
 * ordering existed only as the order of JSX here.
 *
 * The page renders exactly ONE section. Which one is read from the URL hash,
 * and the only thing that sets that hash is the Settings menu on the single
 * top bar — so this page owns no navigation of its own. That is the point:
 * the app has one menu, not a menu inside a menu.
 *
 * Section ids are FROZEN: they are the deep-link anchors (#settings-heart-rate
 * opens that section) and are asserted against settingsNav.ts by
 * tests/settings-nav.test.js.
 */

const modelOptions: SelectOption<ModelProfileId>[] = Object.values(
  MODEL_PROFILES,
).map((p) => ({ value: p.id, label: p.label, hint: p.hint }));

const gazeOptions: SelectOption<GazeEngineSetting>[] = [
  {
    value: 'webgazer',
    label: 'WebGazer (app default)',
    hint: 'GPL — calibrated screen-point accuracy; persistent calibration',
  },
  {
    value: 'mediapipe',
    label: 'MediaPipe landmarks (library default)',
    hint: 'Calibration-free; reuses the face tracker — no second engine',
  },
  {
    value: 'webeyetrack',
    label: 'WebEyeTrack',
    hint: 'MIT; SOTA on GazeCapture (2.32 cm)',
  },
];

const postureModelOptions: SelectOption<PostureModelSetting>[] = [
  { value: 'lite', label: 'Lite (default)', hint: '~3 MB — fastest; enough for lean/tilt/sway' },
  { value: 'full', label: 'Full', hint: 'more accurate landmarks, heavier per frame' },
  { value: 'heavy', label: 'Heavy', hint: 'most accurate; noticeable CPU cost' },
];

const hrMethodOptions: SelectOption<HeartRateMethodSetting>[] = [
  { value: 'pos', label: 'POS (default)', hint: 'Plane-Orthogonal-to-Skin — suppresses motion/specular artifacts' },
  { value: 'green', label: 'Green channel', hint: 'simpler and noisier; useful as a baseline' },
];

const hrRoiOptions: SelectOption<HeartRateRoiSetting>[] = [
  { value: 'forehead', label: 'Forehead (default)', hint: 'least occluded, strongest perfusion signal' },
  { value: 'cheeks', label: 'Cheeks', hint: 'alternative if a fringe or glasses cover the forehead' },
  { value: 'face', label: 'Whole face', hint: 'largest ROI; mixes in non-skin pixels' },
];

const voiceEngineOptions: SelectOption<VoiceEngineSetting>[] = [
  {
    value: 'silero',
    label: 'Silero (neural VAD)',
    hint: 'the only production VAD engine; the library normalizes unknown values back to it',
  },
];

/** A section's rendered content plus the prose the search box should match. */
interface SectionBody {
  title: string;
  description: string;
  body: ReactNode;
  /** Set when the section renders its own <Section> (Calibration, Profiles). */
  standalone?: boolean;
}

function SettingsPage() {
  const editable = useSettings();
  const runtime = useRuntime();

  // Runtime may not have surfaced a settings_hash yet (or the .d.ts is missing
  // the field). Compare against our editable hash to detect drift.
  const liveHash =
    (runtime.settings as unknown as { settings_hash?: string }).settings_hash ?? null;
  const editedHash = editable.settings_hash;
  const isDifferent = liveHash != null && liveHash !== editedHash;
  const isRunning = runtime.status === 'running' || runtime.status === 'paused';

  const bodies = useSectionBodies(editable);

  /*
   * The active section is derived from the router's hash rather than held in
   * local state. There is no second source of truth to keep in sync: the top
   * bar navigates, the URL changes, this re-renders. Deep links, browser Back
   * and the menu all take the same path by construction.
   */
  const hash = useRouterState({ select: (s) => s.location.hash }).replace(/^#/, '');
  const active = SETTINGS_SECTIONS.some((s) => s.id === hash)
    ? hash
    : SETTINGS_SECTIONS[0].id;

  const activeMeta = SETTINGS_SECTIONS.find((s) => s.id === active) ?? null;
  const activeBody = bodies[active] ?? null;
  const activeEnabled = activeMeta?.toggleKey
    ? Boolean(editable[activeMeta.toggleKey as keyof EditableSettings])
    : undefined;

  return (
    <>
      <PageHeader
        title={activeBody ? `Settings · ${activeBody.title}` : 'Settings'}
        description={activeBody?.description}
        actions={
          // flex-wrap: two status pills plus the reset control exceed a phone's
          // width beside the section title.
          <div className="flex flex-wrap items-center gap-2">
            {activeEnabled === undefined ? null : (
              <StatusPill tone={activeEnabled ? 'ok' : 'null'} size="sm">
                {activeEnabled ? 'enabled' : 'off'}
              </StatusPill>
            )}
            <StatusPill tone="info" size="sm">
              hash · {editedHash.slice(0, 7)}
            </StatusPill>
            <Button
              onClick={() => editable.setMany(DEFAULT_SETTINGS)}
              variant="ghost"
              size="sm"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reset to defaults
            </Button>
          </div>
        }
      />

      {isDifferent && isRunning ? (
        <div className="mb-6 flex items-start gap-3 rounded border border-status-warn/40 bg-status-warn-dim px-3 py-2 text-sm text-status-warn">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <div className="font-medium">Restart capture to apply</div>
            <div className="text-xs opacity-80">
              The running capture was started with settings_hash{' '}
              <code className="font-mono">{liveHash?.slice(0, 7)}</code>; the
              current edits hash to{' '}
              <code className="font-mono">{editedHash.slice(0, 7)}</code>. Stop
              and start capture (Capture → Stop, then Start) to apply.
            </div>
          </div>
        </div>
      ) : null}

      <div>
        {activeBody && activeMeta ? (
          <div
            id={`panel-${active}`}
            className="min-w-0 rounded-lg border border-line bg-surface-1 p-5"
          >
            {activeBody.standalone ? (
              activeBody.body
            ) : (
              <Section
                id={active}
                title={activeBody.title}
                description={activeBody.description}
                actions={
                  activeEnabled === undefined ? undefined : (
                    <StatusPill tone={activeEnabled ? 'ok' : 'null'} size="sm">
                      {activeEnabled ? 'enabled' : 'off'}
                    </StatusPill>
                  )
                }
              >
                {activeBody.body}
              </Section>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Each section's title, description and controls.
 *
 * Keyed by the same frozen ids as settingsNav.ts. Kept as one record rather
 * than inline JSX so the render loop above stays a loop — order lives in the
 * nav module, content lives here, and neither can silently reorder the other.
 */
function useSectionBodies(editable: SettingsState): Record<string, SectionBody> {
  const set = editable.set;

  return {
    'settings-capture': {
      title: 'Capture',
      description:
        'Sampling interval, aggregate window length, and the minimum number of valid frames a window must contain before it is emitted.',
      body: (
        <div className="grid gap-3 md:grid-cols-3">
          <Slider
            label="Sample interval"
            min={250}
            max={5000}
            step={50}
            value={editable.sample_interval_ms}
            unit="ms"
            hint="how often a frame is sampled"
            onChange={(v) => set('sample_interval_ms', v)}
          />
          <Slider
            label="Window length"
            min={2000}
            max={30000}
            step={500}
            value={editable.aggregate_window_ms}
            unit="ms"
            hint="aggregate duration per emitted window"
            onChange={(v) => set('aggregate_window_ms', v)}
          />
          <Slider
            label="Min valid frames"
            min={1}
            max={30}
            value={editable.min_valid_frames}
            hint="windows with fewer valid frames are dropped"
            onChange={(v) => set('min_valid_frames', v)}
          />
        </div>
      ),
    },

    'settings-inference': {
      title: 'Inference',
      description: 'Emotion classifier and gaze engine selection.',
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Emotion model"
            value={editable.model_profile}
            options={modelOptions}
            onChange={(v) => set('model_profile', v)}
          />
          <Select
            label="Gaze engine"
            value={editable.gaze_engine}
            options={gazeOptions}
            onChange={(v) => set('gaze_engine', v)}
          />
        </div>
      ),
    },

    'settings-smoothing': {
      title: 'Smoothing',
      description: 'EWMA alpha, label hold time, and switch confidence threshold.',
      body: (
        <div className="grid gap-3 md:grid-cols-3">
          <Slider
            label="EWMA alpha"
            min={0.01}
            max={1}
            step={0.01}
            value={editable.smoothing_alpha}
            format={(v) => v.toFixed(2)}
            hint="higher = more responsive, more jitter"
            onChange={(v) => set('smoothing_alpha', v)}
          />
          <Slider
            label="Min hold"
            min={500}
            max={10000}
            step={250}
            value={editable.min_hold_ms}
            unit="ms"
            hint="minimum time a label must persist"
            onChange={(v) => set('min_hold_ms', v)}
          />
          <Slider
            label="Switch confidence"
            min={0.05}
            max={1}
            step={0.05}
            value={editable.switch_confidence}
            format={(v) => v.toFixed(2)}
            hint="probability needed to change label"
            onChange={(v) => set('switch_confidence', v)}
          />
        </div>
      ),
    },

    'settings-gaze': {
      title: 'Gaze',
      description:
        'Where on screen the learner looked. Needs calibration; zones and AOI dwell are derived from the calibrated point stream.',
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Gaze tracking enabled"
            checked={editable.gaze_tracking_enabled}
            hint="emit a gaze block on every window"
            onChange={(v) => set('gaze_tracking_enabled', v)}
          />
          <Toggle
            label="Require calibration"
            checked={editable.gaze_calibration_required}
            hint="off = emit before calibration too"
            onChange={(v) => set('gaze_calibration_required', v)}
            disabled={!editable.gaze_tracking_enabled}
          />
          <Slider
            label="Zone grid"
            min={2}
            max={6}
            value={editable.gaze_zone_grid}
            unit="×N"
            hint="3 uses named zones; ≥4 uses r#c#"
            onChange={(v) => set('gaze_zone_grid', v)}
            disabled={!editable.gaze_tracking_enabled}
          />
          <Slider
            label="Min quality"
            min={0}
            max={1}
            step={0.05}
            value={editable.gaze_min_quality_score}
            format={(v) => v.toFixed(2)}
            hint="adapter rejects samples below this"
            onChange={(v) => set('gaze_min_quality_score', v)}
            disabled={!editable.gaze_tracking_enabled}
          />
        </div>
      ),
    },

    'settings-engagement': {
      title: 'Engagement',
      description:
        'Eye-openness, blink rate, focus score — derived from the same face landmark stream, no extra model.',
      body: (
        <Toggle
          label="Eye tracking enabled (engagement block)"
          checked={editable.eye_tracking_enabled}
          hint="adds the `engagement` sibling on every window"
          onChange={(v) => set('eye_tracking_enabled', v)}
        />
      ),
    },

    'settings-facial': {
      title: 'Facial signals',
      description:
        'Head pose (nod / turn / tilt) and action units, derived from the face landmarks already computed for emotion — no extra model. Feeds Analyze → Position.',
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Facial signals enabled"
            checked={editable.facial_signals_enabled}
            hint="adds the `facial` block to every window"
            onChange={(v) => set('facial_signals_enabled', v)}
          />
          <Slider
            label="Facing-screen half-angle"
            min={5}
            max={45}
            value={editable.facial_frontal_half_angle_deg}
            unit="°"
            hint="yaw/pitch within this counts as facing the screen"
            onChange={(v) => set('facial_frontal_half_angle_deg', v)}
            disabled={!editable.facial_signals_enabled}
          />
        </div>
      ),
    },

    'settings-posture': {
      title: 'Body posture',
      description:
        'Torso lean, shoulder tilt, sway and slouch from MediaPipe PoseLandmarker. This is the only pipeline that loads a second model.',
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Body posture enabled"
            checked={editable.posture_tracking_enabled}
            hint="adds the `posture` block; downloads a pose model on first start"
            onChange={(v) => set('posture_tracking_enabled', v)}
          />
          <Select
            label="Pose model"
            value={editable.posture_model}
            options={postureModelOptions}
            onChange={(v) => set('posture_model', v)}
            disabled={!editable.posture_tracking_enabled}
          />
        </div>
      ),
    },

    'settings-heart-rate': {
      title: 'Heart rate (rPPG)',
      description:
        'Remote photoplethysmography — pulse recovered from colour changes in a facial skin ROI. Research-grade trend, NEVER a clinical measurement.',
      body: (
        <div className="flex flex-col gap-5">
          <Toggle
            label="Heart rate enabled"
            checked={editable.heart_rate_enabled}
            hint="adds the `heart_rate` block; feeds Analyze → Heart & breathing"
            onChange={(v) => set('heart_rate_enabled', v)}
          />

          <FieldGroup
            label="Signal"
            hint="What is measured, how fast it is sampled, and over how long."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Method"
                value={editable.heart_rate_method}
                options={hrMethodOptions}
                onChange={(v) => set('heart_rate_method', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Select
                label="Skin ROI"
                value={editable.heart_rate_roi}
                options={hrRoiOptions}
                onChange={(v) => set('heart_rate_roi', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="ROI sampling rate"
                min={5}
                max={30}
                value={editable.heart_rate_target_fps}
                unit=" fps"
                hint="how fast the pulse itself is sampled — separate from the capture sample interval"
                onChange={(v) => set('heart_rate_target_fps', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="Analysis window"
                min={4}
                max={30}
                value={editable.heart_rate_buffer_seconds}
                unit="s"
                hint="longer = steadier but laggier; ~1/T frequency resolution"
                onChange={(v) => set('heart_rate_buffer_seconds', v)}
                disabled={!editable.heart_rate_enabled}
              />
            </div>
            <p className="m-0 text-xs text-ink-3">
              Sampling rate and analysis window multiply:{' '}
              <strong className="tabular-nums text-ink-2">
                {editable.heart_rate_target_fps * editable.heart_rate_buffer_seconds}
              </strong>{' '}
              samples per estimate at{' '}
              {editable.heart_rate_target_fps}&nbsp;fps ×{' '}
              {editable.heart_rate_buffer_seconds}&nbsp;s. More samples mean a
              cleaner spectrum, but the rate is capped by the camera — asking
              for more fps than it delivers buys nothing and costs CPU.
            </p>
          </FieldGroup>

          <FieldGroup
            label="Quality gates"
            hint="Refuse to answer rather than answer badly."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider
                label="Min confidence"
                min={0}
                max={1}
                step={0.05}
                value={editable.heart_rate_min_confidence}
                format={(v) => v.toFixed(2)}
                hint="drop unsure estimates instead of emitting a low-trust number; 0 disables"
                onChange={(v) => set('heart_rate_min_confidence', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="Max head movement"
                min={0}
                max={20}
                step={0.5}
                value={editable.heart_rate_max_head_movement_deg}
                unit="°"
                hint="pause ROI sampling above this rotation so motion never enters the buffer; 0 disables"
                onChange={(v) => set('heart_rate_max_head_movement_deg', v)}
                disabled={!editable.heart_rate_enabled}
              />
            </div>
          </FieldGroup>

          <FieldGroup
            label="Cross-window tracker"
            hint="Rejects jumps no heart can make, and demands corroboration before believing an implausible value."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider
                label="Max slew"
                min={0}
                max={10}
                step={0.1}
                value={editable.heart_rate_max_slew_bpm_per_s}
                unit="bpm/s"
                hint="rejects physiologically impossible inter-window jumps; 0 disables"
                onChange={(v) => set('heart_rate_max_slew_bpm_per_s', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="Anchor windows"
                min={1}
                max={20}
                value={editable.heart_rate_tracker_windows}
                hint="rolling median depth — must EXCEED the longest run of bad windows; 1 disables"
                onChange={(v) => set('heart_rate_tracker_windows', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="Plausible min"
                min={30}
                max={120}
                value={editable.heart_rate_plausible_min_bpm}
                unit="bpm"
                hint="values inside the band are believed immediately"
                onChange={(v) => set('heart_rate_plausible_min_bpm', v)}
                disabled={!editable.heart_rate_enabled}
              />
              <Slider
                label="Plausible max"
                min={60}
                max={220}
                value={editable.heart_rate_plausible_max_bpm}
                unit="bpm"
                hint="clinical normal resting range is 60–100"
                onChange={(v) => set('heart_rate_plausible_max_bpm', v)}
                disabled={!editable.heart_rate_enabled}
              />
              {/* Five controls will not divide evenly into two columns. Rather
                  than leave a ragged hole, the odd one out spans the row — and
                  it is the right one to single out: slew/anchor and min/max are
                  pairs, corroboration is the rule that governs both. */}
              <div className="sm:col-span-2">
                <Slider
                  label="Corroboration"
                  min={1}
                  max={10}
                  value={editable.heart_rate_implausible_corroboration}
                  unit=" windows"
                  hint="agreeing windows required before adopting a value OUTSIDE the plausible band"
                  onChange={(v) => set('heart_rate_implausible_corroboration', v)}
                  disabled={!editable.heart_rate_enabled}
                />
              </div>
            </div>
          </FieldGroup>

          <p className="m-0 text-xs text-ink-3">
            The plausible band also drives the colour of the live readout:
            outside it, the number turns red however confident the estimator
            is. Full rationale and the measured effect of each gate:{' '}
            <code className="font-mono">docs/HEART_RATE.md</code>.
          </p>
        </div>
      ),
    },

    'settings-respiration': {
      title: 'Respiration',
      description:
        'Breathing rate from the 0.1–0.5 Hz band of the SAME facial-ROI colour stream as heart rate — no extra sensor or model. A learning-analytics trend, not a diagnostic measurement.',
      body: (
        <div className="flex flex-col gap-3">
          <Toggle
            label="Respiration enabled"
            checked={editable.respiration_enabled}
            hint="adds the `respiration` block; keeps the ROI sampler alive even if heart rate is off"
            onChange={(v) => set('respiration_enabled', v)}
          />
          <Toggle
            label="Require RGB corroboration"
            checked={editable.respiration_require_rgb_corroboration}
            hint="stricter: rejects rates without an agreeing illumination-resistant colour signal; may reduce coverage"
            onChange={(v) => set('respiration_require_rgb_corroboration', v)}
            disabled={!editable.respiration_enabled}
          />
          <p className="m-0 text-xs text-ink-3">
            Needs a long window by physics: frequency resolution is 1/T, so
            telling 12 from 15 breaths/min requires tens of seconds. Oyon
            integrates over ~45&nbsp;s and updates every ~5&nbsp;s, which is why
            the live tile reads “acquiring” for the first half-minute. A value
            that is actually right beats a jittery one that is not.
          </p>
        </div>
      ),
    },

    'settings-illumination': {
      title: 'Lighting',
      description:
        'Ambient illumination measured from the camera frame. Not a signal about the learner — the covariate that says how far to trust every other signal, since rPPG, emotion confidence and gaze quality all degrade in poor or unstable light.',
      body: (
        <div className="flex flex-col gap-3">
          <Toggle
            label="Lighting quality enabled"
            checked={editable.illumination_enabled}
            hint="one 32×18 frame read per sample; adds the `illumination` block"
            onChange={(v) => set('illumination_enabled', v)}
          />
          <p className="m-0 text-xs text-ink-3">
            Reports exposure, clipping and — the field that matters most for
            rPPG — temporal <strong>stability</strong>. A steadily dim room is
            workable; a room whose brightness swings injects energy straight
            into the heart-rate band while looking fine on average.
          </p>
        </div>
      ),
    },

    'settings-voice': {
      title: 'Voice',
      description:
        'Turn-based voice analytics — speech structure, pitch and loudness measured from the microphone, one deliberate turn at a time. Feeds Analyze → Voice.',
      body: (
        <div className="flex flex-col gap-5">
          <Toggle
            label="Voice capture enabled"
            checked={editable.voice_enabled}
            hint="condition 1 of the activation gate — a turn also needs a deliberate Start action"
            onChange={(v) => set('voice_enabled', v)}
          />
          <p className="m-0 text-xs text-ink-3">
            The microphone is <strong>off by default</strong> and every turn requires a
            deliberate per-turn action (the Start button in the voice test): no microphone
            hardware is touched until this setting, the host&rsquo;s enablement, and that user
            action all agree — there is no ambient listening, no hot-word, no automatic re-arm.
            This is an <strong>activation gate on hardware access and compute cost, not a data
            gate</strong> (exactly like <code className="font-mono">heart_rate_enabled</code>):
            once a turn is active, every derived signal — per-frame samples, RMS, VAD
            probability, pitch — is recorded at full rate with nothing withheld. Informed
            consent is handled outside the app; see{' '}
            <code className="font-mono">docs/VOICE.md</code>.
          </p>

          <FieldGroup
            label="Analysis"
            hint="Where the expensive per-frame work (neural VAD + FFT + pitch) runs."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                label="Worker analysis"
                checked={editable.voice_worker_enabled}
                hint="run VAD + DSP in a dedicated Worker, off the UI thread where the camera pipelines run; falls back visibly to the main thread"
                onChange={(v) => set('voice_worker_enabled', v)}
                disabled={!editable.voice_enabled}
              />
              <Select
                label="VAD engine"
                value={editable.voice_engine}
                options={voiceEngineOptions}
                onChange={(v) => set('voice_engine', v)}
                disabled={!editable.voice_enabled}
              />
              <Slider
                label="Frame duration"
                min={10}
                max={100}
                value={editable.voice_frame_ms}
                unit="ms"
                hint="Silero requires 32 (512 samples at 16 kHz); other values are for research/mock engines"
                onChange={(v) => set('voice_frame_ms', v)}
                disabled={!editable.voice_enabled}
              />
            </div>
          </FieldGroup>

          <FieldGroup
            label="Speech detection"
            hint="How per-frame VAD probabilities become speech, silence and pauses."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider
                label="VAD threshold"
                min={0}
                max={1}
                step={0.05}
                value={editable.voice_vad_threshold}
                format={(v) => v.toFixed(2)}
                hint="speech probability at/above this makes a frame speech-like"
                onChange={(v) => set('voice_vad_threshold', v)}
                disabled={!editable.voice_enabled}
              />
              <Slider
                label="Min speech"
                min={0}
                max={2000}
                step={20}
                value={editable.voice_min_speech_ms}
                unit="ms"
                hint="consecutive speech-like frames required before the state flips to speech"
                onChange={(v) => set('voice_min_speech_ms', v)}
                disabled={!editable.voice_enabled}
              />
              <Slider
                label="Min silence"
                min={0}
                max={5000}
                step={20}
                value={editable.voice_min_silence_ms}
                unit="ms"
                hint="consecutive quiet frames required before the state flips to silence"
                onChange={(v) => set('voice_min_silence_ms', v)}
                disabled={!editable.voice_enabled}
              />
              <Slider
                label="Pause threshold"
                min={0}
                max={10000}
                step={100}
                value={editable.voice_pause_threshold_ms}
                unit="ms"
                hint="a post-speech silence run this long counts as an internal pause"
                onChange={(v) => set('voice_pause_threshold_ms', v)}
                disabled={!editable.voice_enabled}
              />
            </div>
          </FieldGroup>

          <FieldGroup
            label="Capture"
            hint="Microphone stream constraints when Oyon owns the stream."
          >
            <Toggle
              label="Request AGC off"
              checked={editable.voice_request_agc_off}
              hint="ask the browser to disable auto gain control so absolute loudness is a measurement, not a gain-controller artifact"
              onChange={(v) => set('voice_request_agc_off', v)}
              disabled={!editable.voice_enabled}
            />
          </FieldGroup>
        </div>
      ),
    },

    'settings-calibration': {
      title: 'Calibration',
      description: 'Gaze calibration points, accuracy and recalibration.',
      standalone: true,
      body: <CalibrationSection />,
    },

    'settings-profiles': {
      title: 'Profiles',
      description: 'Save, load and share complete settings snapshots.',
      standalone: true,
      body: (
        <ProfilesSection
          current={snapshotSettings(editable)}
          onLoad={(s) => editable.setMany(s)}
        />
      ),
    },

    'settings-consent': {
      title: 'Consent',
      description:
        'Ask the participant what may be measured before the first capture. Off by default.',
      body: (
        <div className="flex flex-col gap-space-3">
          <Toggle
            label="Require agreement before capture"
            hint="Shows the startup agreement, itemized by sensor. Declining an item stops that sensor starting."
            checked={editable.consent_required}
            onChange={(v) => editable.set('consent_required', v)}
          />
          <FieldGroup
            label="Your own agreement (optional)"
            hint="Leave empty to use the built-in wording. Custom text is hashed, and the hash becomes the consent_version stamped on every window — so editing it later cannot rewrite what was already agreed to."
          >
            <textarea
              value={editable.consent_text ?? ''}
              rows={6}
              disabled={!editable.consent_required}
              placeholder="Paste or write the agreement participants must accept…"
              onChange={(e) =>
                editable.set('consent_text', e.target.value.trim().length > 0 ? e.target.value : null)
              }
              className="w-full rounded border border-line bg-surface-0 p-2 text-xs text-ink-0 disabled:opacity-60"
            />
          </FieldGroup>
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-micro leading-snug text-ink-3">
              Opens the agreement exactly as a participant sees it, without
              switching the requirement on.
            </p>
            <button
              type="button"
              onClick={() => useConsent.getState().requestGate()}
              className="shrink-0 rounded border border-line-strong bg-surface-0 px-2 py-1 text-xs font-medium text-ink-0 hover:border-ink-3"
            >
              Show agreement
            </button>
          </div>
        </div>
      ),
    },

    'settings-transport': {
      title: 'Transport contract',
      description:
        'Field names validateEmotionPayload rejects so window batches stay well-formed in transit.',
      body: <TransportContract />,
    },
  };
}

/*
 * Was titled "Privacy" and framed as a protective deny-list. That framing
 * contradicted the project's authoritative data policy, which states the app
 * is NOT a privacy gatekeeper and that the validator is transport-shape
 * sanity, never a censor. The list below is unchanged and still accurate —
 * only the claim about WHY it exists is corrected: these are raw-media and
 * unbounded-array field names that do not belong in a JSON window batch, not
 * signals withheld from researchers.
 */
function TransportContract() {
  const rejected = [
    'frame*, image*, video*, pixels, landmarks, blob, base64',
    'iris_landmarks_raw',
    'gaze_points_raw, gaze_raw, gaze_trace, points, points_raw',
    'pupil_diameter_px',
    'eye_patch, eye_image',
  ];

  return (
    <Card>
      <CardContent>
        <p className="m-0 mb-3 flex items-start gap-2 text-xs text-ink-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            These names are rejected because a window batch is a JSON summary,
            not a media channel — raw frames and unbounded point arrays break
            batch size and shape. This is <strong>not</strong> a privacy gate:
            per-sample signal is exposed by design through events, accessors
            and storage. If a study needs raw points or landmarks, the fix is a
            channel that carries them, not a field smuggled into this batch.
          </span>
        </p>
        <ul className="m-0 flex flex-col gap-1.5 p-0 text-sm text-ink-1" role="list">
          {rejected.map((d) => (
            <li key={d} className="flex items-start gap-2 font-mono text-xs">
              <span
                className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-status-bad"
                aria-hidden="true"
              />
              {d}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 text-xs text-ink-3">
          Source of truth:{' '}
          <code className="font-mono">src/validation/validateEmotionPayload.js</code>.
          The example backend mirrors the same check server-side.
        </p>
      </CardContent>
    </Card>
  );
}

export type { EditableSettings };

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});
