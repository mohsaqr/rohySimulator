import { createOyonAddon, createNoopOyonAddon } from './OyonAddon.js';

// Back-compat surface. The generic addon lives in OyonAddon.js; the Rohy
// variant is just `createOyonAddon({ rohy: true })`. Re-exported here (and via
// `oyon/addon`) so existing imports keep working unchanged.
export { createOyonAddon, createNoopOyonAddon };

/**
 * createRohyOyonAddon — Rohy-shaped wrapper over {@link createOyonAddon}.
 * Equivalent to `createOyonAddon({ ...options, rohy: true })`: Rohy's addon
 * endpoint + fixed-four-field session normalization. Prefer `createOyonAddon`
 * for new, non-Rohy hosts.
 */
export function createRohyOyonAddon(options = {}) {
  return createOyonAddon({ ...options, rohy: true });
}
