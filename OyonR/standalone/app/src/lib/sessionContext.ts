import { create } from 'zustand';

/*
 * Session context store — the "who/what/when" identity that lives in the
 * TopBar context strip and is implicit context for every analytic below it.
 *
 * Phase A note: these values are placeholders. In Phase D they will be wired
 * to IndexedDB-backed settings_profiles and the real capture lifecycle.
 *
 * Why Zustand: this state is read by many components but mutated rarely; we
 * want subscriptions without prop-drilling, and we don't need server cache
 * semantics (that's TanStack Query's job for the IndexedDB reads).
 */

export type CalibrationStatus =
  | { status: 'ok'; quality: number; ageMs: number }
  | { status: 'stale'; quality: number; ageMs: number }
  | { status: 'never' };

export type ConsentStatus = 'granted' | 'denied' | 'unset' | 'expired';

export interface SessionContextState {
  studyId: string | null;
  participantId: string | null;
  sessionId: string | null;
  modelName: string;
  modelVersion: string;
  calibration: CalibrationStatus;
  consent: ConsentStatus;
  settingsHash: string | null;
  /** Replace the entire context (e.g. when switching sessions). */
  setContext: (next: Partial<Omit<SessionContextState, 'setContext'>>) => void;
}

export const useSessionContext = create<SessionContextState>((set) => ({
  studyId: null,
  participantId: null,
  sessionId: null,
  modelName: 'tinyfer',
  modelVersion: 'v1.2',
  calibration: { status: 'never' },
  consent: 'unset',
  settingsHash: null,
  setContext: (next) => set(next),
}));
