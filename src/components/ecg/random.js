/**
 * Create a deterministic pseudo-random number generator.
 * Mulberry32 is used for reproducibility, not cryptography.
 *
 * @param {number} seed integer seed
 * @returns {() => number} values in [0, 1)
 */
export function create_seeded_random(seed) {
  if (!Number.isInteger(seed)) {
    throw new TypeError('create_seeded_random(seed): seed must be an integer');
  }
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller standard-normal sample using an injected deterministic source.
 *
 * @param {() => number} random random source
 * @returns {number}
 */
export function random_normal(random) {
  if (typeof random !== 'function') {
    throw new TypeError('random_normal(random): random must be a function');
  }
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
