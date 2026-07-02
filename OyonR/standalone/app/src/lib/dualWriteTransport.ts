import type { EmotionTransport, EmotionWindow } from 'oyon';

/*
 * DualWriteTransport — tries `primary.send()` first; on rejection it falls
 * back to `secondary.send()` and logs a warning via `onFallback`. The
 * library's `FallbackEmotionTransport` has a different (single-transport)
 * contract — it tracks failures on one transport rather than chaining two,
 * so we keep this small local helper to express the IDB → localStorage
 * cascade Phase C.3 wants.
 *
 * Semantics are explicit on purpose:
 *   - Primary success  → returns primary's result; secondary is NOT called
 *     (no duplication; the merge happens at read time in storedWindows.ts)
 *   - Primary rejects  → onFallback is invoked, then secondary.send() runs.
 *     If THAT rejects too, the error propagates so the runtime sees it.
 */

export interface DualWriteOptions {
  primary: EmotionTransport;
  secondary: EmotionTransport;
  onFallback?: (err: unknown) => void;
}

export class DualWriteTransport implements EmotionTransport {
  private readonly primary: EmotionTransport;
  private readonly secondary: EmotionTransport;
  private readonly onFallback: (err: unknown) => void;

  constructor(options: DualWriteOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.onFallback =
      options.onFallback ??
      ((err: unknown) =>
        console.warn(
          '[dual-write] primary transport rejected; falling back',
          err,
        ));
  }

  async send(
    windows: EmotionWindow[],
    context?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!Array.isArray(windows) || windows.length === 0) return undefined;
    try {
      return await this.primary.send(windows, context);
    } catch (err) {
      this.onFallback(err);
      return this.secondary.send(windows, context);
    }
  }
}
