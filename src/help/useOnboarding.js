// First-run onboarding tour state (Stage 4 — P2).
//
// The tour is per-role and versioned: bumping TOUR_VERSION re-shows it to
// everyone after a significant UX change. Completion is persisted in
// localStorage so it never nags a returning user. Storage logic is pure
// and exported so it can be unit-tested without React or a real DOM.

import { useCallback, useState, useEffect } from 'react';
import EventLogger, { COMPONENTS } from '../services/eventLogger';

export const TOUR_VERSION = 1;

// M1 ships trainee + educator tours. Other roles fall back to the trainee
// tour (everyone is at least a learner of the simulator).
//
// Steps carry CATALOGUE KEYS, not prose: the tour is rendered in the viewer's
// language by OnboardingTour, which resolves them against the `help`
// namespace. Keys are literal strings here (an explicit key map — the pattern
// i18next-parser.config.js documents for enum-style lookups) so the copy stays
// in src/locales/*/help.json and never drifts back into the module.
export const TOUR_STEPS = Object.freeze({
  student: [
    { titleKey: 'tour_student_welcome_title', bodyKey: 'tour_student_welcome_body' },
    { titleKey: 'tour_student_rooms_title', bodyKey: 'tour_student_rooms_body' },
    { titleKey: 'tour_student_start_title', bodyKey: 'tour_student_start_body' },
    { titleKey: 'tour_student_help_title', bodyKey: 'tour_student_help_body' },
  ],
  educator: [
    { titleKey: 'tour_educator_welcome_title', bodyKey: 'tour_educator_welcome_body' },
    { titleKey: 'tour_educator_classes_title', bodyKey: 'tour_educator_classes_body' },
    { titleKey: 'tour_educator_authoring_title', bodyKey: 'tour_educator_authoring_body' },
    { titleKey: 'tour_educator_help_title', bodyKey: 'tour_educator_help_body' },
  ],
});

export function tourStepsForRole(role) {
  return TOUR_STEPS[role] || TOUR_STEPS.student;
}

export function onboardingKey(role) {
  return `rohy.onboarding.${role || 'student'}.v${TOUR_VERSION}`;
}

/** Pure: has this role already finished/skipped the current tour version? */
export function isTourDone(storage, role) {
  try {
    return storage?.getItem(onboardingKey(role)) === 'done';
  } catch {
    return false;
  }
}

/** Pure: mark the current tour version finished for this role. */
export function markTourDone(storage, role) {
  try {
    storage?.setItem(onboardingKey(role), 'done');
  } catch {
    /* storage unavailable (private mode / SSR) — tour just re-shows */
  }
}

/**
 * React hook driving the first-run tour for a role.
 * @param {string} role
 * @param {{enabled?:boolean, storage?:Storage}} [opts]
 */
export function useOnboarding(role, opts = {}) {
  const enabled = opts.enabled !== false;
  const storage =
    opts.storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined);
  const steps = tourStepsForRole(role);

  // Lazy initial state: decide once at mount whether the first-run tour
  // should show. role is stable for a session, so an effect would only add
  // a redundant render (and trip react-hooks/set-state-in-effect).
  const [open, setOpen] = useState(
    () => enabled && Boolean(role) && !isTourDone(storage, role),
  );
  const [index, setIndex] = useState(0);

  const tourId = `first_run:${role}`;
  // STARTED_TOUR once, when the tour actually opens.
  useEffect(() => {
    if (open) EventLogger.tourStarted(tourId, COMPONENTS.APP);
  }, [open, tourId]);

  const finish = useCallback(() => {
    markTourDone(storage, role);
    EventLogger.tourEnded(tourId, 'skipped', COMPONENTS.APP);
    setOpen(false);
  }, [storage, role, tourId]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= steps.length) {
        markTourDone(storage, role);
        EventLogger.tourEnded(tourId, 'completed', COMPONENTS.APP);
        setOpen(false);
        return i;
      }
      EventLogger.tourStepAdvanced(tourId, steps[i + 1]?.id ?? String(i + 1), i + 1, COMPONENTS.APP);
      return i + 1;
    });
  }, [steps, storage, role, tourId]);

  return {
    open,
    step: steps[index],
    index,
    total: steps.length,
    isLast: index + 1 >= steps.length,
    next,
    skip: finish,
  };
}
