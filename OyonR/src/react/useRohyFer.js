import { createRohyFerAttachment } from '../adapters/rohyAttach.js';
import { useOyon } from './useOyon.js';

/**
 * useRohyFer — Rohy-shaped wrapper over the host-neutral {@link useOyon}.
 * Kept for back-compat; it pins capture to Rohy's fixed session fields.
 *
 * New hosts should prefer `useOyon`, which preserves arbitrary context keys.
 */
export function useRohyFer(options) {
  return useOyon({ ...options, attachmentFactory: createRohyFerAttachment });
}
