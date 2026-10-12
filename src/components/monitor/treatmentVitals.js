// Base vitals with the active-treatment aggregate applied and clamped to
// physiological bounds. The ONE place that rule lives: the params-sync
// effect, the treatment effect and the jitter loop all display through it,
// so they can never disagree about what the patient's numbers are.
export const withTreatmentEffects = (params, aggregate) => {
   const a = aggregate || {};
   return {
      hr: Math.max(20, Math.min(250, params.hr + (a.hr || 0))),
      spo2: Math.max(50, Math.min(100, params.spo2 + (a.spo2 || 0))),
      rr: Math.max(4, Math.min(60, params.rr + (a.rr || 0))),
      bpSys: Math.max(40, Math.min(300, params.bpSys + (a.bp_sys || 0))),
      bpDia: Math.max(20, Math.min(200, params.bpDia + (a.bp_dia || 0))),
      temp: params.temp + (a.temp || 0),
      etco2: (params.etco2 || 38) + (a.etco2 || 0),
   };
};

/**
 * `prev` with `patch` laid over it — or `prev` ITSELF when the patch changes
 * nothing. The scenario engine ticks every second; handing React a new object
 * each tick, even on a plateau where no value moved, re-ran the monitor's
 * params-sync effect, which resets the display to the un-jittered values. The
 * 2-second bedside jitter then showed for under 100 ms in every 2 s and the
 * numbers looked frozen (MONITOR.VITALS.01, found by the gate e2e under
 * repetition, rc.47). Returning the same object lets React skip the update.
 */
export function mergeIfChanged(prev, patch) {
   const changed = Object.keys(patch).some((key) => !Object.is(prev?.[key], patch[key]));
   return changed ? { ...prev, ...patch } : prev;
}
