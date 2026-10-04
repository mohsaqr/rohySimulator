/**
 * How strongly a dose acts, relative to the dose a treatment's effects are
 * written for.
 *
 * Shared because two places must agree on it: the administer route stores
 * `peak = base effect × multiplier` (server/routes/orders-routes.js), and the
 * order form previews the effect the learner is about to order
 * (src/components/treatments/TreatmentPanel.jsx). The form used to show the
 * BASE effect whatever dose was typed — "RR -4" for 4 mg morphine, which then
 * applied RR -8 (QA 2026-10-04, PRV-37).
 *
 * Lives under server/shared/ because the client imports it and the Docker
 * runtime image copies server/ but not src/.
 *
 * @param {object} effect  a treatment_effects row: dose_dependent, base_dose,
 *   max_effect_multiplier (DB default 2.0)
 * @param {unknown} doseValue  the ordered dose, in the effect's base unit
 * @returns {number} 1 for a dose-independent effect or a missing/invalid
 *   dose; otherwise dose / base_dose, capped at max_effect_multiplier
 */
export function doseMultiplierFor(effect, doseValue) {
    const num = (v, fb) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fb;
    };
    const baseDose = num(effect?.base_dose, 0);
    const dose = num(doseValue, 0);
    if (!effect?.dose_dependent || baseDose <= 0 || dose <= 0) return 1;
    const multiplier = Math.min(dose / baseDose, num(effect.max_effect_multiplier, 2.0));
    return Number.isFinite(multiplier) ? multiplier : 1;
}
