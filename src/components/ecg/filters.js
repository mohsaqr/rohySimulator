/**
 * Display filters.
 *
 * A real ECG cart does not show you the raw signal — it shows you the signal
 * through a declared filter chain, and the chain is printed on the paper
 * because it changes what you are allowed to conclude. A 40 Hz low-pass makes
 * a tracing look clean and quietly shrinks R waves, which is why it is a
 * monitoring setting and not a diagnostic one. A 0.5 Hz high-pass steadies the
 * baseline and can manufacture ST depression that is not there.
 *
 * So these are genuine filters over the samples, not a cosmetic class on the
 * path: if a control claims to be a 40 Hz low-pass, the signal really is
 * low-passed, and a learner measuring an R wave through it gets the smaller
 * number a real machine would have given them.
 *
 * Every filter here is applied FORWARD AND BACKWARD. A causal high-pass shifts
 * and skews the ST segment — the single most consequential region of the
 * tracing — so phase distortion is not acceptable at any cutoff. Running the
 * same filter over the reversed signal cancels the phase shift exactly, at the
 * cost of squaring the magnitude response (an order-1 pass becomes order-2).
 */

/** Signal chain a diagnostic 12-lead is expected to be recorded through. */
export const DIAGNOSTIC_CHAIN = Object.freeze({
  high_pass_hz: 0.05, low_pass_hz: 150, notch_hz: 0,
});

/** The steadier, blunter chain used for monitoring. Not diagnostic. */
export const MONITOR_CHAIN = Object.freeze({
  high_pass_hz: 0.5, low_pass_hz: 40, notch_hz: 0,
});

/**
 * Every chain a reader can select, by id.
 *
 * This lives here rather than beside the buttons that offer it: which filter a
 * measurement was taken through is a fact about the signal, and a scoring or
 * audit consumer must be able to resolve an id to a chain without importing a
 * React component.
 */
export const FILTER_CHAINS = Object.freeze({
  raw: Object.freeze({ high_pass_hz: 0, low_pass_hz: 0, notch_hz: 0 }),
  diagnostic: DIAGNOSTIC_CHAIN,
  monitor: MONITOR_CHAIN,
  mains_50: Object.freeze({ ...DIAGNOSTIC_CHAIN, notch_hz: 50 }),
  mains_60: Object.freeze({ ...DIAGNOSTIC_CHAIN, notch_hz: 60 }),
});

export const FILTER_CHAIN_IDS = Object.freeze(Object.keys(FILTER_CHAINS));

/**
 * Resolve a preset id to its chain, falling back to unfiltered.
 *
 * @param {string} preset_id one of `FILTER_CHAIN_IDS`
 * @returns {{high_pass_hz:number, low_pass_hz:number, notch_hz:number}} the chain
 */
export function filter_chain(preset_id) {
  return FILTER_CHAINS[preset_id] ?? FILTER_CHAINS.raw;
}

const PAD_SECONDS = 0.5;

/**
 * Reflect-pad a signal so filter start-up transients land outside the data.
 *
 * Without this a high-pass leaves a visible swoop in the first beat, which a
 * reader would measure as ST deviation. Takes the integer samples directly and
 * widens to double precision here, so no separate conversion pass is needed.
 */
const pad = (values, pad_length) => {
  const out = new Float64Array(values.length + pad_length * 2);
  for (let i = 0; i < pad_length; i += 1) {
    out[i] = 2 * values[0] - values[Math.min(pad_length - i, values.length - 1)];
    out[out.length - 1 - i] = 2 * values[values.length - 1]
      - values[Math.max(0, values.length - 1 - (pad_length - i))];
  }
  out.set(values, pad_length);
  return out;
};

const unpad = (values, pad_length) => values.slice(pad_length, values.length - pad_length);

/**
 * Run a one-directional filter step, then the same step over the reverse.
 *
 * Every step allocates its own output, so both reversals are done in place —
 * copying first would allocate two more full-length arrays per lead per pass.
 */
const zero_phase = (values, step) => step(step(values).reverse()).reverse();

const single_pole_high_pass = (values, alpha) => {
  const out = new Float64Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = alpha * (out[i - 1] + values[i] - values[i - 1]);
  }
  return out;
};

const single_pole_low_pass = (values, alpha) => {
  const out = new Float64Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = out[i - 1] + alpha * (values[i] - out[i - 1]);
  }
  return out;
};

const biquad = (values, { b0, b1, b2, a1, a2 }) => {
  const out = new Float64Array(values.length);
  let x1 = values[0], x2 = values[0], y1 = values[0], y2 = values[0];
  for (let i = 0; i < values.length; i += 1) {
    const x0 = values[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
};

const assert_signal = (samples, sample_rate_hz, name) => {
  if (!(samples instanceof Int32Array) && !Array.isArray(samples)) {
    throw new TypeError(`${name}(): samples must be an Int32Array or array`);
  }
  if (!Number.isFinite(sample_rate_hz) || sample_rate_hz <= 0) {
    throw new RangeError(`${name}(): sample_rate_hz must be positive`);
  }
};

/**
 * Remove baseline wander below `cutoff_hz`.
 *
 * @param {Int32Array|number[]} samples integer microvolts
 * @param {{sample_rate_hz:number, cutoff_hz:number}} options filter settings
 * @returns {Int32Array} filtered integer microvolts
 */
export function high_pass(samples, { sample_rate_hz, cutoff_hz }) {
  assert_signal(samples, sample_rate_hz, 'high_pass');
  if (!Number.isFinite(cutoff_hz) || cutoff_hz <= 0) return Int32Array.from(samples);
  const pad_length = Math.min(samples.length - 1, Math.round(PAD_SECONDS * sample_rate_hz));
  const rc = 1 / (2 * Math.PI * cutoff_hz);
  const dt = 1 / sample_rate_hz;
  const alpha = rc / (rc + dt);
  const filtered = zero_phase(pad(samples, pad_length),
    (values) => single_pole_high_pass(values, alpha));
  return Int32Array.from(unpad(filtered, pad_length), Math.round);
}

/**
 * Attenuate content above `cutoff_hz` — muscle noise, and real QRS detail.
 *
 * @param {Int32Array|number[]} samples integer microvolts
 * @param {{sample_rate_hz:number, cutoff_hz:number}} options filter settings
 * @returns {Int32Array} filtered integer microvolts
 */
export function low_pass(samples, { sample_rate_hz, cutoff_hz }) {
  assert_signal(samples, sample_rate_hz, 'low_pass');
  if (!Number.isFinite(cutoff_hz) || cutoff_hz <= 0 || cutoff_hz >= sample_rate_hz / 2) {
    return Int32Array.from(samples);
  }
  const pad_length = Math.min(samples.length - 1, Math.round(PAD_SECONDS * sample_rate_hz));
  const rc = 1 / (2 * Math.PI * cutoff_hz);
  const dt = 1 / sample_rate_hz;
  const alpha = dt / (rc + dt);
  const filtered = zero_phase(pad(samples, pad_length),
    (values) => single_pole_low_pass(values, alpha));
  return Int32Array.from(unpad(filtered, pad_length), Math.round);
}

/**
 * Notch out mains interference at `frequency_hz` (50 Hz or 60 Hz).
 *
 * @param {Int32Array|number[]} samples integer microvolts
 * @param {{sample_rate_hz:number, frequency_hz:number, quality?:number}} options filter settings
 * @returns {Int32Array} filtered integer microvolts
 */
export function notch(samples, { sample_rate_hz, frequency_hz, quality = 12 }) {
  assert_signal(samples, sample_rate_hz, 'notch');
  if (!Number.isFinite(frequency_hz) || frequency_hz <= 0 || frequency_hz >= sample_rate_hz / 2) {
    return Int32Array.from(samples);
  }
  const w0 = 2 * Math.PI * frequency_hz / sample_rate_hz;
  const alpha = Math.sin(w0) / (2 * quality);
  const cos_w0 = Math.cos(w0);
  const a0 = 1 + alpha;
  const coefficients = {
    b0: 1 / a0, b1: -2 * cos_w0 / a0, b2: 1 / a0,
    a1: -2 * cos_w0 / a0, a2: (1 - alpha) / a0,
  };
  const pad_length = Math.min(samples.length - 1, Math.round(PAD_SECONDS * sample_rate_hz));
  const filtered = zero_phase(pad(samples, pad_length),
    (values) => biquad(values, coefficients));
  return Int32Array.from(unpad(filtered, pad_length), Math.round);
}

/**
 * Apply a whole filter chain to every lead of a recording.
 *
 * Returns the recording unchanged when the chain is a no-op, so an unfiltered
 * display costs nothing and keeps object identity for memoisation.
 *
 * @param {object} recording materialized recording with integer-microvolt leads
 * @param {{high_pass_hz?:number, low_pass_hz?:number, notch_hz?:number}} chain filter chain
 * @returns {object} recording with filtered leads and a `filter_chain` field
 */
export function apply_filter_chain(recording, chain) {
  if (!recording || typeof recording !== 'object' || !recording.leads) {
    throw new TypeError('apply_filter_chain(recording, chain): expected a materialized recording');
  }
  const { high_pass_hz = 0, low_pass_hz = 0, notch_hz = 0 } = chain ?? {};
  if (!high_pass_hz && !low_pass_hz && !notch_hz) return recording;
  const sample_rate_hz = recording.sample_rate_hz;
  const leads = Object.fromEntries(Object.entries(recording.leads).map(([lead, samples]) => {
    let out = samples;
    if (high_pass_hz) out = high_pass(out, { sample_rate_hz, cutoff_hz: high_pass_hz });
    if (low_pass_hz) out = low_pass(out, { sample_rate_hz, cutoff_hz: low_pass_hz });
    if (notch_hz) out = notch(out, { sample_rate_hz, frequency_hz: notch_hz });
    return [lead, out];
  }));
  return { ...recording, leads, filter_chain: { high_pass_hz, low_pass_hz, notch_hz } };
}
