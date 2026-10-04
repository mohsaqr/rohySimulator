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
