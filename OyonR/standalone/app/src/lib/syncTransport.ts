import { HttpEmotionTransport, FallbackEmotionTransport } from 'oyon';

/*
 * TeeTransport — local-first with a best-effort remote leg.
 *
 * The local transport (the app's existing DualWriteTransport: IndexedDB →
 * localStorage) is AUTHORITATIVE: its result decides whether the write
 * succeeded, and remote failures must never reject a window that was
 * persisted locally. The remote leg is additional, not a fallback — which
 * is why this is a Tee and not a third DualWriteTransport stage (DualWrite
 * has cascade-on-failure semantics).
 *
 * The remote leg is wrapped in the library's FallbackEmotionTransport so a
 * dead endpoint stops being hammered after `maxFailures` batches instead of
 * erroring on every window.
 */

interface TransportLike {
  send(events: unknown[], context?: Record<string, unknown>): Promise<unknown>;
}

export class TeeTransport implements TransportLike {
  private readonly local: TransportLike;
  private readonly remote: TransportLike;

  constructor({ local, remote }: { local: TransportLike; remote: TransportLike }) {
    this.local = local;
    this.remote = remote;
  }

  async send(events: unknown[], context?: Record<string, unknown>): Promise<unknown> {
    const result = await this.local.send(events, context);
    // Fire-and-forget: remote outcomes are tracked by FallbackEmotionTransport
    // (failure budget + structured drop callbacks), not by the caller.
    void Promise.resolve(this.remote.send(events, context)).catch(() => {
      /* counted inside FallbackEmotionTransport */
    });
    return result;
  }
}

export function createRemoteLeg({
  apiBaseUrl,
  getToken,
  onDrop,
}: {
  apiBaseUrl: string;
  getToken: (() => string | null | Promise<string | null>) | null;
  onDrop?: (payload: unknown) => void;
}): TransportLike {
  const http = new HttpEmotionTransport({
    baseUrl: apiBaseUrl,
    ...(getToken ? { tokenProvider: getToken } : {}),
  });
  return new FallbackEmotionTransport({
    transport: http,
    maxFailures: 3,
    ...(onDrop ? { onDrop } : {}),
  }) as unknown as TransportLike;
}
