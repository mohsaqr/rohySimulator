/**
 * Where the twelve leads come from on the body.
 *
 * Two different things share the word "lead", and a chooser that blurs them
 * teaches the blur. The six precordial leads ARE electrode positions: V4 is a
 * place on the chest wall, and pointing at that place is exactly what selecting
 * V4 means. The six frontal leads are not places at all — they are directions
 * derived from three limb electrodes, which is why they are shown on the
 * hexaxial reference circle instead of pinned to a shoulder.
 *
 * Coordinates are pixel positions in the 232 × 282 frame of
 * `patientFigure.js` — the virtual-patient system's own examination figure —
 * and were measured against that figure's anatomy: the suprasternal notch and
 * sternal midline at x ≈ 113, the nipple line (≈ 4th intercostal space) at
 * y ≈ 128, and the midclavicular line through the nipple at x ≈ 137. The view
 * is anterior, so the patient's right is on the reader's left.
 *
 * These numbers are only correct for that exact crop. Re-cropping the figure
 * without re-measuring here moves every electrode off the landmark it names.
 */

import { PATIENT_FIGURE_HEIGHT, PATIENT_FIGURE_WIDTH } from './patientFigure.js';

/** The frame every coordinate below is measured in. */
export const FIGURE_FRAME = Object.freeze({
  width: PATIENT_FIGURE_WIDTH,
  height: PATIENT_FIGURE_HEIGHT,
});

/** Sternal midline in the figure frame. */
export const TORSO_MIDLINE_X = 113;

/**
 * Precordial electrode positions.
 *
 * Placement follows the AHA/ACCF/HRS standardization statement: V1 and V2 in
 * the fourth intercostal space at the right and left sternal borders, V4 in the
 * fifth space at the midclavicular line, V3 midway between V2 and V4, and V5/V6
 * on the anterior axillary and midaxillary lines at the V4 horizontal level —
 * NOT following the ribs downward, which is the classic placement error.
 */
export const PRECORDIAL_POSITIONS = Object.freeze([
  Object.freeze({ lead: 'V1', x: 106, y: 128, anatomy: '4th intercostal space, right sternal border' }),
  Object.freeze({ lead: 'V2', x: 120, y: 128, anatomy: '4th intercostal space, left sternal border' }),
  Object.freeze({ lead: 'V3', x: 128.5, y: 134, anatomy: 'Midway between V2 and V4' }),
  Object.freeze({ lead: 'V4', x: 137, y: 140, anatomy: '5th intercostal space, midclavicular line' }),
  Object.freeze({ lead: 'V5', x: 148, y: 140, anatomy: 'Anterior axillary line, V4 horizontal level' }),
  Object.freeze({ lead: 'V6', x: 157, y: 140, anatomy: 'Midaxillary line, V4 horizontal level' }),
]);

/**
 * Limb electrodes.
 *
 * Four electrodes, three of which contribute signal; RL is the driven ground
 * and appears so a reader does not wonder where the fourth cable went.
 */
export const LIMB_ELECTRODES = Object.freeze([
  Object.freeze({ electrode: 'RA', x: 55, y: 200, label: 'Right arm', ground: false }),
  Object.freeze({ electrode: 'LA', x: 177, y: 200, label: 'Left arm', ground: false }),
  Object.freeze({ electrode: 'RL', x: 100, y: 266, label: 'Right leg (ground)', ground: true }),
  Object.freeze({ electrode: 'LL', x: 132, y: 266, label: 'Left leg', ground: false }),
]);

/**
 * Hexaxial reference angles in degrees, positive clockwise from lead I.
 *
 * These are the standard frontal-plane axes: the same convention `classify_axis`
 * uses, so a lead highlighted here and an axis reported there mean the same
 * thing.
 */
export const FRONTAL_LEAD_ANGLES = Object.freeze({
  I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90,
});

export const FRONTAL_LEADS = Object.freeze(Object.keys(FRONTAL_LEAD_ANGLES));
export const PRECORDIAL_LEADS = Object.freeze(PRECORDIAL_POSITIONS.map(({ lead }) => lead));

/**
 * Which wall each lead looks at.
 *
 * Contiguity is the whole reason a reader cares which lead is which: ST change
 * in two leads of the same territory means something that the same change
 * scattered across territories does not.
 */
export const LEAD_TERRITORIES = Object.freeze({
  I: 'lateral', aVL: 'lateral', V5: 'lateral', V6: 'lateral',
  II: 'inferior', III: 'inferior', aVF: 'inferior',
  V1: 'septal', V2: 'septal',
  V3: 'anterior', V4: 'anterior',
  aVR: 'cavity',
});

export const TERRITORY_LABELS = Object.freeze({
  lateral: 'Lateral wall',
  inferior: 'Inferior wall',
  septal: 'Septum',
  anterior: 'Anterior wall',
  cavity: 'Cavity / outflow',
});

/**
 * Endpoint of a frontal lead axis on the hexaxial circle.
 *
 * SVG y grows downward and ECG frontal angles are positive downward, so the
 * conventional angle maps to screen coordinates directly: aVF at +90° points to
 * the foot of the diagram, as it should.
 *
 * @param {string} lead frontal lead name
 * @param {{center_x?:number,center_y?:number,radius?:number}} circle hexaxial circle geometry
 * @returns {{x:number,y:number,angle_degrees:number}} positive-pole endpoint
 */
export function frontal_lead_endpoint(lead, { center_x = 50, center_y = 50, radius = 34 } = {}) {
  const angle_degrees = FRONTAL_LEAD_ANGLES[lead];
  if (!Number.isFinite(angle_degrees)) {
    throw new RangeError(`frontal_lead_endpoint(lead): '${lead}' is not a frontal-plane lead`);
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError('frontal_lead_endpoint(): radius must be a positive number');
  }
  const radians = angle_degrees * Math.PI / 180;
  return {
    x: center_x + radius * Math.cos(radians),
    y: center_y + radius * Math.sin(radians),
    angle_degrees,
  };
}

/**
 * Human-readable origin of one lead, for the selector's caption and its
 * accessible name.
 *
 * @param {string} lead any of the twelve standard leads
 * @returns {{lead:string,kind:'precordial'|'frontal',anatomy:string,territory:string|null}}
 */
export function lead_topography(lead) {
  const precordial = PRECORDIAL_POSITIONS.find((position) => position.lead === lead);
  if (precordial) {
    return {
      lead,
      kind: 'precordial',
      anatomy: precordial.anatomy,
      territory: LEAD_TERRITORIES[lead] ?? null,
    };
  }
  const angle = FRONTAL_LEAD_ANGLES[lead];
  if (!Number.isFinite(angle)) throw new RangeError(`lead_topography(lead): unknown lead '${lead}'`);
  const derivation = {
    I: 'Left arm minus right arm',
    II: 'Left leg minus right arm',
    III: 'Left leg minus left arm',
    aVR: 'Right arm against the average of the others',
    aVL: 'Left arm against the average of the others',
    aVF: 'Left leg against the average of the others',
  }[lead];
  return {
    lead,
    kind: 'frontal',
    anatomy: `${derivation} · ${angle > 0 ? '+' : ''}${angle}° in the frontal plane`,
    territory: LEAD_TERRITORIES[lead] ?? null,
  };
}
