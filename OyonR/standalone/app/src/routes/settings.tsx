import { createRoute } from '@tanstack/react-router';
import { AlertCircle, Eye, RotateCcw, Shield } from 'lucide-react';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
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
  type GazeEngineSetting,
} from '@/lib/settingsStore';
import {
  MODEL_PROFILES,
  type ModelProfileId,
} from '@/lib/modelProfiles';
import { useRuntime } from '@/lib/RuntimeProvider';
import { ProfilesSection } from '@/components/settings/ProfilesSection';
import { CalibrationSection } from '@/components/settings/CalibrationSection';

/*
 * Settings — versioned configuration. Edits persist to localStorage and
 * apply on the next runtime start. A "Restart capture to apply" banner
 * surfaces when the live runtime's settings_hash differs from the
 * currently-edited values (per memory feedback_no_auto_reload).
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

function SettingsPage() {
  const editable = useSettings();
  const runtime = useRuntime();
  // Runtime may not have surfaced a settings_hash yet (or the .d.ts is
  // missing the field). Compare against our editable hash to detect drift.
  const liveHash =
    (runtime.settings as unknown as { settings_hash?: string }).settings_hash ??
    null;
  const editedHash = editable.settings_hash;
  const isDifferent = liveHash != null && liveHash !== editedHash;
  const isRunning =
    runtime.status === 'running' || runtime.status === 'paused';

  function handleReset() {
    editable.setMany(DEFAULT_SETTINGS);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Versioned configuration. Changes persist locally and apply on the next capture start — the live capture is not auto-restarted."
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone="info" size="sm">
              hash · {editedHash.slice(0, 7)}
            </StatusPill>
            <Button onClick={handleReset} variant="ghost" size="sm">
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

      <div className="flex flex-col gap-8">
        <Section
          id="settings-capture"
          title="Capture"
          description="Sampling interval, aggregate window length, and the minimum number of valid frames a window must contain before it is emitted."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Slider
              label="Sample interval"
              min={250}
              max={5000}
              step={50}
              value={editable.sample_interval_ms}
              unit="ms"
              hint="how often a frame is sampled"
              onChange={(v) => editable.set('sample_interval_ms', v)}
            />
            <Slider
              label="Window length"
              min={2000}
              max={30000}
              step={500}
              value={editable.aggregate_window_ms}
              unit="ms"
              hint="aggregate duration per emitted window"
              onChange={(v) => editable.set('aggregate_window_ms', v)}
            />
            <Slider
              label="Min valid frames"
              min={1}
              max={30}
              value={editable.min_valid_frames}
              hint="windows with fewer valid frames are dropped"
              onChange={(v) => editable.set('min_valid_frames', v)}
            />
          </div>
        </Section>

        <Section
          id="settings-inference"
          title="Inference"
          description="Emotion classifier and gaze engine selection."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="Emotion model"
              value={editable.model_profile}
              options={modelOptions}
              onChange={(v) => editable.set('model_profile', v)}
            />
            <Select
              label="Gaze engine"
              value={editable.gaze_engine}
              options={gazeOptions}
              onChange={(v) => editable.set('gaze_engine', v)}
            />
          </div>
        </Section>

        <Section
          id="settings-smoothing"
          title="Smoothing"
          description="EWMA alpha, label hold time, and switch confidence threshold."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Slider
              label="EWMA alpha"
              min={0.01}
              max={1}
              step={0.01}
              value={editable.smoothing_alpha}
              format={(v) => v.toFixed(2)}
              hint="higher = more responsive, more jitter"
              onChange={(v) => editable.set('smoothing_alpha', v)}
            />
            <Slider
              label="Min hold"
              min={500}
              max={10000}
              step={250}
              value={editable.min_hold_ms}
              unit="ms"
              hint="minimum time a label must persist"
              onChange={(v) => editable.set('min_hold_ms', v)}
            />
            <Slider
              label="Switch confidence"
              min={0.05}
              max={1}
              step={0.05}
              value={editable.switch_confidence}
              format={(v) => v.toFixed(2)}
              hint="probability needed to change label"
              onChange={(v) => editable.set('switch_confidence', v)}
            />
          </div>
        </Section>

        <Section
          id="settings-gaze"
          title="Gaze"
          description="Master gaze flag, calibration policy, zone grid, and quality gate."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              label="Gaze tracking enabled"
              checked={editable.gaze_tracking_enabled}
              hint="emit a gaze block on every window"
              onChange={(v) => editable.set('gaze_tracking_enabled', v)}
            />
            <Toggle
              label="Require calibration"
              checked={editable.gaze_calibration_required}
              hint="off = emit before calibration too"
              onChange={(v) => editable.set('gaze_calibration_required', v)}
              disabled={!editable.gaze_tracking_enabled}
            />
            <Slider
              label="Zone grid"
              min={2}
              max={6}
              value={editable.gaze_zone_grid}
              unit="×N"
              hint="3 uses named zones; ≥4 uses r#c#"
              onChange={(v) => editable.set('gaze_zone_grid', v)}
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
              onChange={(v) => editable.set('gaze_min_quality_score', v)}
              disabled={!editable.gaze_tracking_enabled}
            />
          </div>
        </Section>

        <Section
          id="settings-engagement"
          title="Engagement"
          description="Eye-openness, blink rate, focus score — derived from the same face landmark stream."
        >
          <Toggle
            label="Eye tracking enabled (engagement block)"
            checked={editable.eye_tracking_enabled}
            hint="adds the `engagement` sibling on every window"
            onChange={(v) => editable.set('eye_tracking_enabled', v)}
          />
        </Section>

        <CalibrationSection />

        <PrivacyDisclosure />

        <ProfilesSection
          current={snapshotSettings(editable)}
          onLoad={(s) => editable.setMany(s)}
        />
      </div>
    </>
  );
}

function PrivacyDisclosure() {
  // Static — these come from src/validation/validateEmotionPayload.js and
  // are part of the data contract. Edits to this list happen in the
  // library, not the app.
  const denyList = [
    'iris_landmarks_raw',
    'gaze_points_raw',
    'pupil_diameter_px',
    'eye_image_*',
    'frame*, image*, video*, pixels, landmarks, blob, base64',
  ];

  return (
    <Section
      id="settings-privacy"
      title="Privacy"
      description="The transport-layer deny-list. These field names are rejected by validateEmotionPayload before any window leaves the device."
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="size-3.5" aria-hidden="true" />
              Denied at transport
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-1" role="list">
            {denyList.map((d) => (
              <li
                key={d}
                className="flex items-center gap-2 font-mono text-xs"
              >
                <span className="inline-block size-1.5 rounded-full bg-status-bad" aria-hidden="true" />
                {d}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-3 flex items-start gap-2 text-xs text-ink-3">
            <Eye className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Source of truth:{' '}
            <code className="font-mono">
              src/validation/validateEmotionPayload.js
            </code>
            . Adding a field with a deny-listed prefix would silently fail
            every batch on the server side as well.
          </p>
        </CardContent>
      </Card>
    </Section>
  );
}

void useSettings;
void useRuntime;
// Above keeps imports referenced when transient TypeScript shaking
// is too aggressive — components consume them.
export type { EditableSettings };

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});
