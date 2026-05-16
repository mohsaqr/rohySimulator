// First-run onboarding overlay (Stage 4 — P2).
//
// Deliberately self-contained: a modal card with Next/Skip. It does NOT use
// the notification system (it is not an alert — it is a one-time guided
// intro), and it persists its own completion via useOnboarding so it never
// re-nags. Dismissible at any step.

import { useOnboarding } from './useOnboarding.js';

export default function OnboardingTour({ role, enabled = true, storage }) {
  const { open, step, index, total, isLast, next, skip } = useOnboarding(
    role,
    { enabled, storage },
  );

  if (!open || !step) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
    >
      <div className="w-[min(28rem,90vw)] bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-6">
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Step {index + 1} of {total}
        </div>
        <h2 className="text-lg font-semibold text-neutral-100 mb-2">
          {step.title}
        </h2>
        <p className="text-sm text-neutral-300 leading-relaxed mb-6">
          {step.body}
        </p>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={skip}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
