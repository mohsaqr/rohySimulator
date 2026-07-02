import { create } from 'zustand';
import { useBridge, useBridgeStore } from './hostBridge';

/*
 * Identity store — who the captured windows belong to.
 *
 * The runtime's contextProvider reads this store on EVERY window emission
 * (EmotionRuntime.sendWindows spreads the context into each persisted
 * event), so identity changes apply live without rebuilding the runtime.
 *
 * Sources of truth, by mode:
 *   - standalone: the Participant pill in the TopBar (user-editable).
 *   - embedded (<oyon-app>): the element's `user-id` / `user-label` /
 *     `session-id` attributes (live-updatable via attributeChangedCallback).
 *
 * `userId` defaults to 'standalone-user' for backward compatibility with
 * windows captured before identity existed.
 */

export interface IdentityState {
  userId: string;
  userLabel: string | null;
  /** When set, overrides the generated capture session id. */
  sessionIdOverride: string | null;
  setIdentity: (
    next: Partial<Pick<IdentityState, 'userId' | 'userLabel' | 'sessionIdOverride'>>,
  ) => void;
}

export const DEFAULT_USER_ID = 'standalone-user';

export const useIdentity = create<IdentityState>((set) => ({
  userId: DEFAULT_USER_ID,
  userLabel: null,
  sessionIdOverride: null,
  setIdentity: (next) => set(next),
}));

export interface ResolvedIdentity {
  userId: string;
  userLabel: string | null;
  setIdentity: (next: { userId: string; userLabel: string | null }) => void;
}

/*
 * useResolvedIdentity — the identity source for participant UI (the TopBar
 * ParticipantPill), mirroring runtime.ts `resolveIdentity` at the React layer.
 *
 * In an embed (`bridge.embedded`) the host's identity is PER-INSTANCE in the
 * bridge store, and the runtime stamps every window from THERE. So the pill
 * must read AND write the bridge: reading the module `useIdentity` store would
 * show 'standalone-user' instead of the host's `user-label`, and — worse —
 * editing the pill would write the module store that `resolveIdentity` ignores
 * when embedded, so the edit would silently never reach the stamped windows.
 * Standalone (no <oyon-app> provider ⇒ embedded false) → the module store,
 * unchanged.
 *
 * Every hook below runs on every render; only the RETURN branches on
 * `embedded`, which is fixed for an element instance (and always false
 * standalone), so the branch is stable and rules-of-hooks holds.
 */
export function useResolvedIdentity(): ResolvedIdentity {
  const embedded = useBridge((s) => s.embedded);
  const bridgeStore = useBridgeStore();
  const bridgeUserId = useBridge((s) => s.userId);
  const bridgeUserLabel = useBridge((s) => s.userLabel);
  const moduleUserId = useIdentity((s) => s.userId);
  const moduleUserLabel = useIdentity((s) => s.userLabel);
  const moduleSetIdentity = useIdentity((s) => s.setIdentity);

  if (embedded) {
    return {
      userId: bridgeUserId ?? DEFAULT_USER_ID,
      userLabel: bridgeUserLabel,
      setIdentity: (next) => bridgeStore.getState().setBridge(next),
    };
  }
  return {
    userId: moduleUserId,
    userLabel: moduleUserLabel,
    setIdentity: moduleSetIdentity,
  };
}
