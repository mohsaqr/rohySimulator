/**
 * The patient, as an ink-coverage mask.
 *
 * This is the same anterior figure the virtual-patient system already uses for
 * physical examination, so a learner meets one body across the whole case
 * rather than a different cartoon in every room. It is cropped to head-through-
 * hips, downsized to 232 x 282, solarized (the source is dark line art on a
 * light body; here it must read as light line art on a dark panel) and reduced
 * to eight coverage levels.
 *
 * Only coverage is stored, not colour: the figure is a single tint at varying
 * opacity, so the colour belongs to the theme and is applied by the SVG through
 * `currentColor`. That is also why this is 5 KB rather than the 28 KB a tinted
 * RGBA copy would cost.
 *
 * The frame is load-bearing. `leadTopography.js` places every electrode in
 * these exact coordinates, measured against this crop's anatomy; re-cropping or
 * resizing the figure without re-measuring the electrodes would silently move
 * them off the landmarks they name.
 */

export const PATIENT_FIGURE_WIDTH = 232;
export const PATIENT_FIGURE_HEIGHT = 282;

/** Grayscale ink-coverage mask; white is full ink. */
export const PATIENT_FIGURE_MASK = 'data:image/png;base64,'
  + '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'
  + 'zuj/A/DOA52M1Kh8AAAAAElFTkSuQmCC';
