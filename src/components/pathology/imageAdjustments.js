/**
 * Display adjustments — brightness, contrast, gamma, saturation.
 *
 * WHY A PATHOLOGY VIEWER NEEDS THESE AT ALL: H&E staining intensity varies
 * between laboratories, between batches, and with section thickness, and
 * scanners differ in white balance. A pale section that is unreadable at the
 * scanner's own exposure becomes readable with a contrast lift. Every
 * commercial workstation offers this, and its absence is one of the things
 * that makes a viewer feel like a toy.
 *
 * WHY IT IS FENCED OFF IN ITS OWN MODULE: because the boundary matters. These
 * controls change WHAT IS SEEN and must never touch WHAT IS MEASURED. Every
 * measurement in this package derives from the scanner's `nativeMpp`, so a
 * contrast change cannot move a number — and keeping the filter arithmetic out
 * of the component that renders the sliders keeps that separation visible, and
 * testable, rather than merely intended.
 */

/** Exactly the pixels the scanner produced. */
export const NEUTRAL_ADJUSTMENTS = { brightness: 1, contrast: 1, gamma: 1, saturation: 1 };

/** The sliders, and the range each is allowed. */
export const ADJUSTMENT_CONTROLS = [
    { key: 'brightness', label: 'Brightness', min: 0.4, max: 1.8, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: 0.4, max: 2.2, step: 0.01 },
    { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.2, step: 0.01 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
];

/**
 * Is anything moved off neutral?
 *
 * @param {object} adjustments
 * @returns {boolean}
 */
export function isAdjusted(adjustments) {
    if (!adjustments) return false;
    return ADJUSTMENT_CONTROLS.some(({ key }) => adjustments[key] !== NEUTRAL_ADJUSTMENTS[key]);
}

/**
 * Turn the adjustment state into a CSS `filter` value.
 *
 * Gamma has no CSS filter primitive. It is approximated by folding its inverse
 * into `contrast`, which pivots around the mid-grey point in much the way a
 * gamma curve does. That is an APPROXIMATION and is labelled as one in the UI:
 * it is a legibility aid, not a photometric correction, and nothing downstream
 * consumes it.
 *
 * Returns the literal string 'none' when nothing is adjusted, so the neutral
 * case costs no compositing work at all rather than a no-op filter chain.
 *
 * @param {object} adjustments
 * @returns {string}
 */
export function adjustmentFilter(adjustments) {
    if (!isAdjusted(adjustments)) return 'none';
    const gammaAsContrast = 1 / adjustments.gamma;
    return [
        `brightness(${adjustments.brightness})`,
        `contrast(${adjustments.contrast * gammaAsContrast})`,
        `saturate(${adjustments.saturation})`,
    ].join(' ');
}
