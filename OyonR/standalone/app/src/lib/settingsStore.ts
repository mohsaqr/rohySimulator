import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelProfileId } from './modelProfiles';
import { DEFAULT_MODEL_PROFILE } from './modelProfiles';

/*
 * Editable settings store — sits in front of the runtime so a user can
 * dial-in parameters on /settings without forcing an immediate restart.
 * The runtime reads these values at `start()` time; live changes are
 * surfaced via a "Restart capture to apply" affordance per memory rule
 * (feedback_no_auto_reload).
 *
 * Persistence: localStorage under `oyon-app-settings`. The hash field is
 * derived from the editable values (cheap djb2 over a normalized string)
 * so the TopBar's settings-hash pill changes deterministically when a
 * parameter is edited — even before the next start.
 */

export type GazeEngineSetting = 'webgazer' | 'webeyetrack' | 'mediapipe';

export interface EditableSettings {
  // Capture
  sample_interval_ms: number;
  aggregate_window_ms: number;
  min_valid_frames: number;

  // Inference
  model_profile: ModelProfileId;
  gaze_engine: GazeEngineSetting;

  // Smoothing
  smoothing_alpha: number;
  min_hold_ms: number;
  switch_confidence: number;

  // Gaze
  gaze_tracking_enabled: boolean;
  gaze_calibration_required: boolean;
  gaze_zone_grid: number;
  gaze_min_quality_score: number;

  // Engagement
  eye_tracking_enabled: boolean;
}

export const DEFAULT_SETTINGS: EditableSettings = {
  sample_interval_ms: 1000,
  aggregate_window_ms: 10000,
  min_valid_frames: 6,

  model_profile: DEFAULT_MODEL_PROFILE,
  gaze_engine: 'webgazer',

  smoothing_alpha: 0.28,
  min_hold_ms: 3000,
  switch_confidence: 0.5,

  gaze_tracking_enabled: true,
  gaze_calibration_required: false,
  gaze_zone_grid: 3,
  gaze_min_quality_score: 0.3,

  eye_tracking_enabled: true,
};

export interface SettingsState extends EditableSettings {
  /** djb2 hash of the current editable settings — surfaced as the TopBar
   *  settings pill. Recomputed on every update. */
  settings_hash: string;
  set: <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => void;
  setMany: (partial: Partial<EditableSettings>) => void;
  reset: () => void;
}

function hashSettings(s: EditableSettings): string {
  const str = JSON.stringify(s, Object.keys(s).sort());
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      settings_hash: hashSettings(DEFAULT_SETTINGS),
      set: (key, value) => {
        const next: EditableSettings = { ...get(), [key]: value };
        set({ ...next, settings_hash: hashSettings(next) });
      },
      setMany: (partial) => {
        const next: EditableSettings = { ...get(), ...partial };
        set({ ...next, settings_hash: hashSettings(next) });
      },
      reset: () =>
        set({ ...DEFAULT_SETTINGS, settings_hash: hashSettings(DEFAULT_SETTINGS) }),
    }),
    {
      name: 'oyon-app-settings',
      // gaze_engine default has changed across versions; each bump forces
      // existing browsers' persisted setting back to the current default so
      // a stale value can't silently pin an old engine. History:
      //   v1: webgazer -> webeyetrack (WebGazer was failing invisibly)
      //   v2: webeyetrack -> webgazer (WebGazer wiring fixed + it's the
      //       preferred engine and the only one with persistent calibration
      //       via saveDataAcrossSessions)
      //   v3: preserve WebGazer as the default but clear stale calibration
      //       gates. WebGazer must emit uncalibrated-ish gaze windows; the
      //       calibration flow improves/persists quality, not availability.
      // Every OTHER user setting is preserved.
      version: 3,
      migrate: (persisted, version) => {
        const s = { ...(persisted as Partial<EditableSettings> | null ?? {}) };
        if (version < 2) {
          s.gaze_engine = DEFAULT_SETTINGS.gaze_engine;
        }
        if (version < 3) {
          s.gaze_calibration_required = DEFAULT_SETTINGS.gaze_calibration_required;
        }
        return s as SettingsState;
      },
      partialize: (s) => {
        // Only persist the editable fields — `set` etc. would round-trip
        // bad if included.
        const { set: _s, setMany: _sm, reset: _r, settings_hash: _h, ...rest } = s;
        void _s;
        void _sm;
        void _r;
        void _h;
        return rest;
      },
    },
  ),
);

/** Pull only the editable values (no actions, no hash) for snapshotting. */
export function snapshotSettings(s: SettingsState): EditableSettings {
  const {
    sample_interval_ms,
    aggregate_window_ms,
    min_valid_frames,
    model_profile,
    gaze_engine,
    smoothing_alpha,
    min_hold_ms,
    switch_confidence,
    gaze_tracking_enabled,
    gaze_calibration_required,
    gaze_zone_grid,
    gaze_min_quality_score,
    eye_tracking_enabled,
  } = s;
  return {
    sample_interval_ms,
    aggregate_window_ms,
    min_valid_frames,
    model_profile,
    gaze_engine,
    smoothing_alpha,
    min_hold_ms,
    switch_confidence,
    gaze_tracking_enabled,
    gaze_calibration_required,
    gaze_zone_grid,
    gaze_min_quality_score,
    eye_tracking_enabled,
  };
}
