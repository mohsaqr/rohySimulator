// Turnaround time — single source of truth for both labs and radiology.
// Wall-clock minutes from order time to result availability. Defaults are
// clamped to 1–5 minutes for the sim's compressed pacing; authors can
// still override per-test or per-case for delayed-result teaching.

export const DEFAULT_TURNAROUND_MINUTES = 3;

/**
 * Priority (highest first):
 *   1. requestOverride === 0           student clicked "Order instantly"
 *   2. caseConfig.investigations.instantResults === true
 *                                      educator pinned the case to instant
 *   3. requestOverride > 0             explicit per-order value
 *   4. testDefault > 0                 per-test value (case_investigations
 *                                      row or radiology master DB)
 *   5. caseConfig.investigations.defaultTurnaround > 0
 *                                      case-level default
 *   6. DEFAULT_TURNAROUND_MINUTES (3)  final fallback
 *
 * Student instant beats case-level instant: the button is a learner-side
 * convenience that should always work, even on a realistic-timing case.
 */
export function resolveTurnaroundMinutes({ requestOverride, caseConfig, testDefault } = {}) {
    if (requestOverride === 0) return 0;
    if (caseConfig?.investigations?.instantResults === true) return 0;
    if (typeof requestOverride === 'number' && requestOverride > 0) return requestOverride;
    if (typeof testDefault === 'number' && testDefault > 0) return testDefault;
    const caseDefault = caseConfig?.investigations?.defaultTurnaround;
    if (typeof caseDefault === 'number' && caseDefault > 0) return caseDefault;
    return DEFAULT_TURNAROUND_MINUTES;
}
