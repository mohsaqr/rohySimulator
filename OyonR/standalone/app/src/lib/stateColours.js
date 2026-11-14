/*
 * One colour per state for the whole app, so a state keeps its colour on every
 * page, in every figure and whatever span, session or filter is shown. Okabe–Ito
 * only (colour-blind safe); every figure also names its states (node labels,
 * legends), so a colour is never the only cue — with more than eight states in
 * one figure some colours necessarily repeat.
 *
 *   emotions      fixed, chosen to read at a glance: neutral grey, anger
 *                 vermillion, happy orange, sad sky, fear blue, disgust green,
 *                 contempt pink, surprise yellow, 'insufficient' (no usable
 *                 face) light grey
 *   low/mid/high  the Okabe–Ito low/mid/high ramp
 *   known states  Oyon's closed vocabularies (writing acts, then the per-event
 *                 vocabularies in OYON_STATE_VOCABULARIES order): each state's
 *                 colour is fixed by its place in its vocabulary — never by
 *                 which other states happen to be on screen
 *   other states  (AOI names, regime codes, member tokens …) the next
 *                 Okabe–Ito colour the first time the app meets the state
 *                 (states of one call taken in sorted order), then kept for
 *                 the page's lifetime: filtering never recolours a state
 *
 * Used by the Analyze pages (patternViews.stateColors), the group networks and
 * patterns (groupNetworks.js) and the member ribbons (groupChart.stateColorMap).
 */
import { OYON_STATE_VOCABULARIES } from '../../../../src/version.js';
import { WRITING_ACTS } from '../../../../src/analytics/WritingAnalytics.js';

/** The eight Okabe–Ito colours other than grey (grey is neutral / missing). */
export const OKABE_ITO = Object.freeze(['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#000000']);

export const EMOTION_STATES = Object.freeze(['anger', 'contempt', 'disgust', 'fear', 'happy', 'insufficient', 'neutral', 'sad', 'surprise']);
export const EMOTION_COLOURS = Object.freeze({
  anger: '#D55E00',
  contempt: '#CC79A7',
  disgust: '#009E73',
  fear: '#0072B2',
  happy: '#E69F00',
  insufficient: '#DDDDDD',
  neutral: '#999999',
  sad: '#56B4E9',
  surprise: '#F0E442',
});
export const LEVEL_COLOURS = Object.freeze({ low: '#0072B2', mid: '#F0E442', high: '#D55E00', uncertain: '#CC79A7' });

// Known vocabularies: a state takes the colour of its place in the first
// vocabulary that lists it ('start' is typing's, 'pause' typing's, …).
const KNOWN = new Map();
for (const vocabulary of [WRITING_ACTS, ...Object.values(OYON_STATE_VOCABULARIES)]) {
  vocabulary.forEach((state, i) => {
    if (!KNOWN.has(state)) KNOWN.set(state, OKABE_ITO[i % OKABE_ITO.length]);
  });
}

// Any other state: assigned on first sight, kept for the page's lifetime.
const met = new Map();

function fixedColour(state) {
  return LEVEL_COLOURS[state] ?? EMOTION_COLOURS[state] ?? KNOWN.get(state) ?? null;
}

/** state → colour for every distinct non-empty state in `states`. */
export function stateColourMap(states) {
  const distinct = [...new Set((states ?? []).filter((s) => typeof s === 'string' && s !== ''))].sort();
  distinct.forEach((s) => {
    if (fixedColour(s) === null && !met.has(s)) met.set(s, OKABE_ITO[met.size % OKABE_ITO.length]);
  });
  return Object.fromEntries(distinct.map((s) => [s, fixedColour(s) ?? met.get(s)]));
}

/** Forget the states met so far (tests; a page never needs it). */
export function resetStateColours() {
  met.clear();
}
