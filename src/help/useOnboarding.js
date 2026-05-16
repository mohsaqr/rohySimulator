// First-run onboarding tour state (Stage 4 — P2).
//
// The tour is per-role and versioned: bumping TOUR_VERSION re-shows it to
// everyone after a significant UX change. Completion is persisted in
// localStorage so it never nags a returning user. Storage logic is pure
// and exported so it can be unit-tested without React or a real DOM.

import { useCallback, useState } from 'react';

export const TOUR_VERSION = 1;

// M1 ships trainee + educator tours. Other roles fall back to the trainee
// tour (everyone is at least a learner of the simulator).
export const TOUR_STEPS = Object.freeze({
  student: [
    { title: 'Welcome to Rohy', body: 'You will run a virtual patient case. Nothing here is real or medical advice.' },
    { title: 'Five rooms', body: 'Use the bottom navigator to move between Patient, Examination, Laboratory, Radiology and the Debrief.' },
    { title: 'Start by talking', body: 'Send your first message to the patient to begin the session. Your work is logged for the debrief.' },
    { title: 'Need help?', body: 'Open Settings → Help & Support any time for guides, what is new, and a support bundle.' },
  ],
  educator: [
    { title: 'Welcome, Teacher', body: 'Build a class, author cases, and read how your students performed.' },
    { title: 'Classes', body: 'Create a class and share its join code. The per-tenant Base Class already holds pre-existing activity.' },
    { title: 'Authoring & reporting', body: 'Use the case wizard to build scenarios; the reporting views show roster, completion, analytics and exports.' },
    { title: 'Need help?', body: 'Settings → Help & Support has the full educator guide and release notes.' },
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

  const finish = useCallback(() => {
    markTourDone(storage, role);
    setOpen(false);
  }, [storage, role]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= steps.length) {
        markTourDone(storage, role);
        setOpen(false);
        return i;
      }
      return i + 1;
    });
  }, [steps.length, storage, role]);

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
