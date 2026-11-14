/*
 * The Settings page's structure, as data.
 *
 * The page used to be twelve <Section>s stacked in one flat scroll, every one
 * carrying the same visual weight whether it held a single toggle or eleven
 * sliders, with no way to navigate or search. This module gives that pile a
 * spine: an ordered set of GROUPS, each holding sections, so the rail, the
 * pipeline chips and the search filter all read from one description instead
 * of three hand-maintained copies that drift apart.
 *
 * Deliberately dependency-free (no React, no store import) so a plain node
 * test can parse it and assert it stays in sync with what the page actually
 * renders. This page's whole failure mode is a list that mirrors a source of
 * truth while the type system stays happy either way.
 *
 * `id` values are FROZEN — they are the anchor targets that existing deep
 * links (#settings-heart-rate) rely on, and they must keep matching the
 * <Section id> props one-for-one.
 */

export interface SettingsSectionMeta {
  /** Anchor id — must equal the rendered <Section id>. Frozen for deep links. */
  id: string;
  /** Rail label. Shorter than the section title where the title is a phrase. */
  label: string;
  /**
   * Store key of this section's master on/off flag, when it has one. Drives
   * the pipeline chips and lets the rail dim a section whose pipeline is off.
   */
  toggleKey?: string;
  /**
   * Extra search terms that are NOT in the title or label — the words someone
   * would actually type. "bpm" should find Heart rate; "webgazer" should find
   * Gaze. Titles are matched automatically, so don't repeat them here.
   */
  keywords: string[];
}

export interface SettingsGroupMeta {
  id: string;
  label: string;
  /** One line explaining what the group is for, shown above its rail entries. */
  hint: string;
  sections: SettingsSectionMeta[];
}

export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  {
    id: 'group-core',
    label: 'Core',
    hint: 'Applies to every pipeline',
    sections: [
      {
        id: 'settings-capture',
        label: 'Capture',
        keywords: ['sample', 'interval', 'window', 'frames', 'rate', 'hz', 'duration'],
      },
      {
        id: 'settings-inference',
        label: 'Inference',
        keywords: ['model', 'onnx', 'classifier', 'engine', 'webgazer', 'mediapipe', 'webeyetrack'],
      },
      {
        id: 'settings-smoothing',
        label: 'Smoothing',
        keywords: ['ewma', 'alpha', 'hold', 'switch', 'threshold', 'jitter', 'label'],
      },
    ],
  },
  {
    id: 'group-sensing',
    label: 'Sensing pipelines',
    hint: 'Each adds its own block to every window',
    sections: [
      {
        id: 'settings-gaze',
        label: 'Gaze',
        toggleKey: 'gaze_tracking_enabled',
        keywords: ['screen', 'point', 'zone', 'grid', 'aoi', 'calibration', 'dwell', 'webgazer'],
      },
      {
        id: 'settings-engagement',
        label: 'Engagement',
        toggleKey: 'eye_tracking_enabled',
        keywords: ['eye', 'blink', 'openness', 'focus', 'attention', 'entropy'],
      },
      {
        id: 'settings-facial',
        label: 'Facial signals',
        toggleKey: 'facial_signals_enabled',
        keywords: ['head', 'pose', 'yaw', 'pitch', 'roll', 'action unit', 'au', 'nod', 'turn', 'tilt'],
      },
      {
        id: 'settings-posture',
        label: 'Body posture',
        toggleKey: 'posture_tracking_enabled',
        keywords: ['lean', 'shoulder', 'sway', 'slouch', 'torso', 'skeleton', 'pose model'],
      },
      {
        id: 'settings-heart-rate',
        label: 'Heart rate',
        toggleKey: 'heart_rate_enabled',
        keywords: ['rppg', 'bpm', 'pulse', 'pos', 'roi', 'forehead', 'tracker', 'slew', 'plausible', 'fps', 'sampling rate'],
      },
      {
        id: 'settings-respiration',
        label: 'Respiration',
        toggleKey: 'respiration_enabled',
        keywords: ['breath', 'breathing', 'brpm', 'respiratory', 'lowband'],
      },
      {
        id: 'settings-illumination',
        label: 'Lighting',
        toggleKey: 'illumination_enabled',
        keywords: ['light', 'luma', 'exposure', 'brightness', 'backlit', 'clipping', 'stability'],
      },
      {
        id: 'settings-voice',
        label: 'Voice',
        toggleKey: 'voice_enabled',
        keywords: ['microphone', 'mic', 'audio', 'speech', 'vad', 'silero', 'turn', 'pause', 'agc', 'worker', 'pitch', 'prosody'],
      },
    ],
  },
  {
    id: 'group-session',
    label: 'Session',
    hint: 'Calibration, saved profiles, transport contract',
    sections: [
      {
        id: 'settings-calibration',
        label: 'Calibration',
        keywords: ['gaze', 'points', 'recalibrate', 'accuracy', 'clear'],
      },
      {
        id: 'settings-profiles',
        label: 'Profiles',
        keywords: ['save', 'load', 'preset', 'export', 'import', 'share'],
      },
      {
        id: 'settings-consent',
        label: 'Consent',
        toggleKey: 'consent_required',
        keywords: ['agreement', 'contract', 'permission', 'gdpr', 'opt in', 'participant'],
      },
      {
        id: 'settings-transport',
        label: 'Transport contract',
        keywords: ['validation', 'batch', 'payload', 'reject', 'schema', 'privacy', 'deny'],
      },
    ],
  },
] as const;

/** Flat section list in render order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] =
  SETTINGS_GROUPS.flatMap((g) => g.sections);

/** Sections that own an on/off pipeline flag, in render order. */
export const PIPELINE_SECTIONS: readonly SettingsSectionMeta[] =
  SETTINGS_SECTIONS.filter((s) => s.toggleKey != null);

/**
 * Does a section match a search query?
 *
 * Matches the label and the keywords. The caller passes the section's rendered
 * title/description too, so a term that appears in the prose someone is
 * reading also finds the section — searching "slouch" or "specular" should
 * work without every such word being duplicated into `keywords`.
 */
export function sectionMatches(
  section: SettingsSectionMeta,
  query: string,
  haystack = '',
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const terms = q.split(/\s+/);
  const text = `${section.label} ${section.keywords.join(' ')} ${haystack}`.toLowerCase();
  // Every term must appear: typing more words should narrow, not widen.
  return terms.every((t) => text.includes(t));
}
