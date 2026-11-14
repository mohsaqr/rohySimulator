import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettings, type EditableSettings } from './settingsStore';

/*
 * Consent store — what the participant has agreed may be measured.
 *
 * Itemized at the SENSOR boundary, not the inference boundary. Emotion,
 * engagement, gaze and posture are all computed from the same camera frames
 * via the same landmarks, so offering them as separate switches would imply a
 * refusal that changes nothing about what is captured. What a participant can
 * actually refuse is a sensor. See docs/CONSENT_PLAN.md §1.
 *
 * Heart rate is its own item despite also coming from the camera: rPPG
 * recovers a pulse trend, which is health data (GDPR Art. 9) and needs
 * explicit consent rather than quiet inclusion under Camera.
 *
 * The gate is OFF by default (`consent_required` in settingsStore). When off,
 * behaviour is exactly as before this file existed.
 */

export type ConsentItemKey = 'camera' | 'heart' | 'microphone';

export type ConsentAcceptance = Record<ConsentItemKey, boolean>;

export interface ConsentItemSpec {
  key: ConsentItemKey;
  name: string;
  /** Plain-language description of what this sensor produces. */
  covers: string;
  /** Shown while allowed. */
  onLabel: string;
  /** Shown while declined. */
  offLabel: string;
  /** GDPR Art. 9 special category — rendered with a badge. */
  specialCategory?: boolean;
}

export const CONSENT_ITEMS: Record<ConsentItemKey, ConsentItemSpec> = {
  camera: {
    key: 'camera',
    name: 'Camera',
    covers: 'Facial expression, engagement, gaze direction, body posture.',
    onLabel: 'Allowed — can be turned off at any time',
    offLabel: 'Off — your camera is not used',
  },
  heart: {
    key: 'heart',
    name: 'Heart rate',
    covers:
      'A pulse trend read from colour changes in facial skin. A research estimate, not a vital sign.',
    onLabel: 'Allowed — can be turned off at any time',
    offLabel: 'Off — no pulse is estimated',
    specialCategory: true,
  },
  microphone: {
    key: 'microphone',
    name: 'Microphone',
    covers: 'Speaking turns, pace and tone of voice. No transcription.',
    onLabel: 'Allowed — can be turned off at any time',
    offLabel: 'Off — your microphone is not used',
  },
};

export const BUILTIN_CONSENT_VERSION = 'fer-consent-v1';

/*
 * Which items to show. DERIVED, never hardcoded: asking permission for a
 * sensor that cannot run misrepresents what is happening. Camera is always
 * present (it is the base capture path); heart rate and microphone appear only
 * when the operator has enabled them.
 *
 * Discourse and interaction are deliberately absent — docs/DISCOURSE.md and
 * docs/INTERACTION.md both state that runtime auto-wiring is not implemented,
 * so nothing would be measured by accepting them. Add their keys here when
 * they land, and the gate picks them up with no other change.
 */
export function availableConsentItems(settings: EditableSettings): ConsentItemSpec[] {
  const keys: ConsentItemKey[] = ['camera'];
  if (settings.heart_rate_enabled) keys.push('heart');
  if (settings.voice_enabled) keys.push('microphone');
  return keys.map((key) => CONSENT_ITEMS[key]);
}

/*
 * djb2 over the agreement text, matching settingsStore's hashSettings so the
 * two provenance strings are produced the same way. The hash IS the consent
 * version for custom text: every window carries `consent_version`, so a
 * contract edited after the fact cannot rewrite what was actually agreed to.
 */
export function consentVersionFor(text: string | null): string {
  if (!text || text.trim().length === 0) return BUILTIN_CONSENT_VERSION;
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return `custom-${h.toString(16).padStart(8, '0')}`;
}

/** Nothing allowed. Exported so callers build acceptance maps from one shape. */
export const NO_CONSENT: ConsentAcceptance = Object.freeze({
  camera: false,
  heart: false,
  microphone: false,
});

const NONE: ConsentAcceptance = { ...NO_CONSENT };

export interface ConsentState {
  /** Which items are currently allowed. */
  accepted: ConsentAcceptance;
  /** The version answered against. A change means the text changed — re-ask. */
  answeredVersion: string | null;
  /** True once the participant has responded, even by declining everything. */
  answered: boolean;
  /**
   * Someone asked to see the agreement on purpose — from Settings, or from the
   * Consent pill. Transient and NOT persisted: a reload should not reopen a
   * dialog nobody asked for twice. It opens the gate even when the operator
   * has the requirement switched off, which is the whole point of a review
   * button, and it never clears an existing answer.
   */
  requested: boolean;
  accept: (next: ConsentAcceptance, version: string) => void;
  /** Withdraw one item mid-session. Sensing must stop straight away. */
  setItem: (key: ConsentItemKey, allowed: boolean) => void;
  requestGate: () => void;
  dismissGate: () => void;
  reset: () => void;
}

export const useConsent = create<ConsentState>()(
  persist(
    (set) => ({
      accepted: { ...NONE },
      answeredVersion: null,
      answered: false,
      requested: false,
      accept: (next, version) =>
        set({
          accepted: { ...next },
          answeredVersion: version,
          answered: true,
          requested: false,
        }),
      setItem: (key, allowed) =>
        set((s) => ({ accepted: { ...s.accepted, [key]: allowed } })),
      requestGate: () => set({ requested: true }),
      dismissGate: () => set({ requested: false }),
      reset: () =>
        set({ accepted: { ...NONE }, answeredVersion: null, answered: false, requested: false }),
    }),
    {
      name: 'oyon-app-consent',
      // Persist the answer, never the transient open flag.
      partialize: (s) => ({
        accepted: s.accepted,
        answeredVersion: s.answeredVersion,
        answered: s.answered,
      }),
    },
  ),
);

/*
 * Should the gate be shown? Only when the operator turned it on AND the
 * participant has not answered the CURRENT text. A new hash means new wording,
 * which the previous acceptance does not cover.
 */
export function consentGateOpen(
  settings: EditableSettings,
  state: Pick<ConsentState, 'answered' | 'answeredVersion'>,
): boolean {
  if (!settings.consent_required) return false;
  const version = consentVersionFor(settings.consent_text);
  return !state.answered || state.answeredVersion !== version;
}

/*
 * Mask the settings a capture starts with by what was consented to. This is
 * where itemized consent becomes real: declining an item must prevent the
 * sensor from starting, not merely record a preference while capture proceeds.
 * A consent record that does not gate is worse than no consent screen, because
 * it documents a promise that was broken.
 *
 * When the gate is off (the default) settings pass through untouched.
 */
export function applyConsentToSettings(
  settings: EditableSettings,
  state: Pick<ConsentState, 'accepted' | 'answered'>,
): EditableSettings {
  if (!state.answered) return settings;
  const { accepted } = state;
  return {
    ...settings,
    heart_rate_enabled: settings.heart_rate_enabled && accepted.heart,
    voice_enabled: settings.voice_enabled && accepted.microphone,
  };
}

/**
 * Camera declined ⇒ there is nothing to capture at all.
 *
 * An ANSWER wins over the requirement flag. Gating this on
 * `consent_required` was a defect: someone who opened the agreement from the
 * nav or the Consent pill — available whether or not the operator requires it
 * — and chose "Continue without sensing" had their refusal ignored, because
 * the requirement was off. A refusal that the system records and then
 * disregards is worse than never having asked.
 *
 * Never answered is the only case the flag decides: requirement on ⇒ withhold
 * until the gate is answered; requirement off ⇒ behave exactly as before this
 * feature existed.
 */
export function cameraAllowed(
  settings: EditableSettings,
  state: Pick<ConsentState, 'accepted' | 'answered'>,
): boolean {
  if (state.answered) return state.accepted.camera;
  return !settings.consent_required;
}

/*
 * A stable signature of everything about consent that changes how a runtime is
 * BUILT: which sensors are masked off, and which agreement version gets
 * stamped onto each window.
 *
 * The runtime is memoized (`ensureRuntime` returns the cached instance), so
 * without comparing this, a participant who changes their answer keeps the
 * runtime built under the OLD answer — still running the microphone they just
 * declined, still stamping the version they no longer agreed to. Comparing the
 * signature at start() is what forces a rebuild.
 */
export function consentBuildSignature(
  settings: EditableSettings,
  state: Pick<ConsentState, 'accepted' | 'answered' | 'answeredVersion'>,
): string {
  const masked = applyConsentToSettings(settings, state);
  return [
    state.answered ? '1' : '0',
    state.answeredVersion ?? consentVersionFor(settings.consent_text),
    state.accepted.camera ? 'c' : '-',
    masked.heart_rate_enabled ? 'h' : '-',
    masked.voice_enabled ? 'm' : '-',
  ].join('|');
}

/** Convenience hook for surfaces that only need the live camera verdict. */
export function useCameraAllowed(): boolean {
  const settings = useSettings();
  const accepted = useConsent((s) => s.accepted);
  const answered = useConsent((s) => s.answered);
  return cameraAllowed(settings, { accepted, answered });
}
