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
export type PostureModelSetting = 'lite' | 'full' | 'heavy';
export type HeartRateRoiSetting = 'forehead' | 'cheeks' | 'face';
export type HeartRateMethodSetting = 'pos' | 'green';
/** Silero is the only production VAD engine (the library normalizes unknown
 *  values back to it — see normalizeVoiceEngineSetting in OyonSettings.js). */
export type VoiceEngineSetting = 'silero';

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

  // Sensing (v3): facial signals (head pose + action units), body posture, rPPG heart rate
  facial_signals_enabled: boolean;
  /** Half-angle (deg) within which the head counts as "facing the screen". */
  facial_frontal_half_angle_deg: number;

  posture_tracking_enabled: boolean;
  posture_model: PostureModelSetting;

  respiration_enabled: boolean;
  /** Require illumination-resistant RGB-share evidence to agree with green. */
  respiration_require_rgb_corroboration: boolean;

  /** Ambient lighting quality — the covariate for every other signal. */
  illumination_enabled: boolean;

  heart_rate_enabled: boolean;
  // Acquisition
  heart_rate_method: HeartRateMethodSetting;
  heart_rate_roi: HeartRateRoiSetting;
  /** ROI sampling rate. The rate the PULSE is sampled at — independent of
   *  sample_interval_ms, which paces the emotion/landmark pipeline. */
  heart_rate_target_fps: number;
  heart_rate_buffer_seconds: number;
  // Quality gates — drop unsure/motion-corrupted frames rather than emitting
  // a low-trust number (see docs/HEART_RATE.md).
  heart_rate_min_confidence: number;
  heart_rate_max_head_movement_deg: number;
  // Cross-window tracker
  heart_rate_max_slew_bpm_per_s: number;
  heart_rate_tracker_windows: number;
  heart_rate_plausible_min_bpm: number;
  heart_rate_plausible_max_bpm: number;
  heart_rate_implausible_corroboration: number;

  // Voice (turn-based; the modal's Start button is the per-turn user action).
  // `voice_enabled` is condition 1 of the library's three-part ACTIVATION
  // gate on microphone hardware — off by default, and never flipped
  // implicitly. It gates hardware access and compute cost, NOT recorded
  // signal (consent is handled outside the app; see docs/VOICE.md).
  voice_enabled: boolean;
  /** Run VAD + per-frame DSP in a dedicated Worker (visible fallback). */
  voice_worker_enabled: boolean;
  /** Frame duration, ms. Silero v5 requires 32 (512 samples at 16 kHz). */
  voice_frame_ms: number;
  voice_vad_threshold: number;
  voice_min_speech_ms: number;
  voice_min_silence_ms: number;
  voice_pause_threshold_ms: number;
  /** Request autoGainControl:false so loudness is a measurement, not an AGC artifact. */
  voice_request_agc_off: boolean;
  voice_engine: VoiceEngineSetting;

  // Consent gate — see docs/CONSENT_PLAN.md. OFF by default: with
  // `consent_required` false the app behaves exactly as it did before the gate
  // existed. `consent_text` holds an operator-supplied agreement; when set, its
  // hash becomes the `consent_version` stamped on every window, so a contract
  // edited afterwards cannot rewrite what was agreed to.
  consent_required: boolean;
  consent_text: string | null;
}

export const DEFAULT_SETTINGS: EditableSettings = {
  // 3 s windows at 2 Hz, not the historical 10 s at 1 Hz.
  //
  // A 10 s window averages the affect probabilities before taking the argmax,
  // so a two-second smile is ~20% of the mean and can never win — it survives
  // in `probabilities` and is invisible to every label-based view, including
  // the transition analysis that is the point of collecting this. chatoyon
  // reached the same conclusion in its v2.8.0 sensing work; these values match
  // it so the two products segment time identically.
  //
  // The three numbers are COUPLED. `min_valid_frames` is an absolute count
  // while the achievable count is floor(window/interval)+1, so shortening the
  // window without re-deriving the floor silently tightens the fraction of
  // frames that must contain a face: 6 was 6-of-11 (~55%) at 10 s/1 Hz, but
  // would be 6-of-7 (~86%) here, where one blink-away nulls the window.
  // 4-of-7 (~57%) preserves the default profile's LENIENCY, which is the
  // quality bar it was actually tuned for.
  sample_interval_ms: 500,
  aggregate_window_ms: 3000,
  min_valid_frames: 4,

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

  facial_signals_enabled: true,
  facial_frontal_half_angle_deg: 20,

  posture_tracking_enabled: true,
  posture_model: 'lite',

  respiration_enabled: true,
  respiration_require_rgb_corroboration: false,
  illumination_enabled: true,

  heart_rate_enabled: true,
  heart_rate_method: 'pos',
  heart_rate_roi: 'forehead',
  heart_rate_target_fps: 16,
  heart_rate_buffer_seconds: 12,
  heart_rate_min_confidence: 0.5,
  heart_rate_max_head_movement_deg: 3,
  heart_rate_max_slew_bpm_per_s: 1.5,
  heart_rate_tracker_windows: 9,
  heart_rate_plausible_min_bpm: 60,
  heart_rate_plausible_max_bpm: 100,
  heart_rate_implausible_corroboration: 3,

  // Voice — defaults mirror src/settings/OyonSettings.js exactly.
  voice_enabled: false,
  voice_worker_enabled: true,
  voice_frame_ms: 32,
  voice_vad_threshold: 0.5,
  voice_min_speech_ms: 100,
  voice_min_silence_ms: 300,
  voice_pause_threshold_ms: 500,
  voice_request_agc_off: true,
  voice_engine: 'silero',

  consent_required: false,
  consent_text: null,
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

/**
 * Pull only the editable values (no actions, no hash) for snapshotting.
 *
 * Keyed off DEFAULT_SETTINGS rather than an explicit destructure: the old
 * hand-listed version had to be edited in two places for every new setting,
 * and a forgotten entry silently dropped that setting from saved profiles
 * with no type error. Driving it from the defaults object makes the key set
 * impossible to get out of sync.
 */
export function snapshotSettings(s: SettingsState): EditableSettings {
  const out = {} as EditableSettings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof EditableSettings>) {
    // Widened through unknown: the per-key value types are heterogeneous, and
    // the loop cannot express "assign K's value to K" without a mapped-type
    // helper that buys nothing here.
    (out as unknown as Record<string, unknown>)[key] = s[key] as unknown;
  }
  return out;
}
