import { createContext, createElement, useContext, type ReactNode } from 'react';
import { create } from 'zustand';
import { useStore, type StoreApi, type UseBoundStore } from 'zustand';
import type { EmotionWindow } from 'oyon';

/*
 * Host bridge — everything the <oyon-app> custom element needs to tell the
 * app, with defaults that reproduce standalone behavior exactly. The app
 * never imports from element.tsx; the element writes into this store and
 * the app reads it, keeping the dependency one-directional.
 *
 *   embedded        — true only when mounted via <oyon-app>. Switches asset
 *                     defaults from origin-relative '/standalone/...' paths
 *                     (which only exist on the dev server / standalone
 *                     deploy) to the library's public CDN constants.
 *   assetBase       — host-provided root for self-hosted assets (the
 *                     `npx oyon install-assets` layout). Wins over both
 *                     defaults. No trailing slash.
 *   apiBaseUrl/getToken — enable the optional HTTP sync leg (local-first:
 *                     IndexedDB stays authoritative; remote is best-effort).
 *   emitHostEvent   — set by the element to dispatch DOM CustomEvents
 *                     (oyon:window, oyon:status) on the host page. No-op
 *                     when standalone.
 *   registerControls — RuntimeProvider registers start/stop here so the
 *                     element can expose them as methods.
 *   chromeMode      — which chrome the host requested on <oyon-app>:
 *                       'full'    (chrome absent)   → today's full app.
 *                       'none'    (chrome="none")   → viewer-only analytics
 *                                  embed: no capture chrome, no camera, viewer
 *                                  STUB runtime; minimal Analyze+Settings nav.
 *                       'capture' (chrome="capture")→ the REAL capture runtime
 *                                  rendering ONLY the compact capture pill — no
 *                                  nav/header/dock/analytics. The element sizes
 *                                  to the pill.
 *                       'capture-analytics' (chrome="capture-analytics") → the
 *                                  self-contained embed: the compact capture
 *                                  pill as a header strip ABOVE the full Analyze
 *                                  dashboards, all on the REAL runtime, so one
 *                                  element gives a host both live capture and
 *                                  the analytics of the windows it produces.
 *                     Default 'full'. Set once at element mount; stable for the
 *                     element instance's lifetime (so the runtime-hook branch
 *                     it gates is stable across renders → no rules-of-hooks
 *                     violation).
 *   chromeless      — derived convenience: true IFF chromeMode === 'none'
 *                     (the VIEWER stub mode). Capture mode is NOT chromeless —
 *                     it runs the real engine. Kept so existing viewer-stub /
 *                     no-op consumers read unchanged.
 *   hostWindows     — windows supplied directly by the host via
 *                     el.setWindows(). When non-null, storedWindows prefers
 *                     them over the local IndexedDB store so the Analyze
 *                     dashboards render the host's already-captured windows.
 *                     Null ⇒ read the local store (unchanged behavior).
 */

/** One gaze Area-of-Interest rect, in the gaze coordinate convention:
 *  [-0.5, 0.5] both axes, origin = screen center, x/y = top-left corner. */
export interface GazeAoi {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HostControls {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Live-replace the gaze AOIs on the RUNNING runtime (no restart). */
  setGazeAois?: (aois: GazeAoi[]) => void;
}

/** Which chrome the host requested via the <oyon-app> `chrome` attribute. */
export type ChromeMode = 'full' | 'none' | 'capture' | 'capture-analytics';

export interface HostBridgeState {
  embedded: boolean;
  /**
   * Host chrome request: 'full' (default) | 'none' (viewer) | 'capture' (pill
   * only) | 'capture-analytics' (pill + dashboards). Only 'none' is chromeless.
   */
  chromeMode: ChromeMode;
  /**
   * VIEWER-only mode (chrome="none"). Derived: true IFF chromeMode==='none'.
   * Capture mode is NOT chromeless — it runs the real engine. Kept so the
   * viewer-stub gate and start()/stop() no-op consumers read unchanged.
   */
  chromeless: boolean;
  assetBase: string | null;
  apiBaseUrl: string | null;
  /** May resolve null (no token yet) — the sync leg then sends without auth. */
  getToken: (() => string | null | Promise<string | null>) | null;
  emitHostEvent: ((type: string, detail: unknown) => void) | null;
  controls: HostControls | null;
  /** Windows the host supplied via el.setWindows(). Null ⇒ read local store. */
  hostWindows: EmotionWindow[] | null;
  /**
   * PER-INSTANCE identity for the embed. The element writes the <oyon-app>
   * `user-id` / `user-label` / `session-id` attributes HERE (not into the
   * module-level useIdentity store), so a coexisting chrome="none" viewer (no
   * session-id) can never clobber the capture instance's session attribution.
   * `runtime.ts` reads these when `embedded` is true; standalone falls back to
   * the module useIdentity store, so its behavior is unchanged.
   *   userId            — defaults to DEFAULT_USER_ID at the element boundary.
   *   userLabel         — display name, or null.
   *   sessionIdOverride — host-pinned capture session id, or null (generate).
   */
  userId: string | null;
  userLabel: string | null;
  sessionIdOverride: string | null;
  /**
   * Host-pinned gaze engine for the embed (the <oyon-app> `gaze-engine`
   * attribute): 'mediapipe' | 'webgazer' | 'webeyetrack'. Wins over the
   * persisted settings-store value at runtime construction, WITHOUT being
   * written into the user's persisted settings — a host that needs the
   * training-free geometric engine (e.g. chatoyon, which only consumes 3×3
   * zone aggregates) can pin it while the standalone app keeps its own
   * preference. Null ⇒ use the settings store (unchanged behavior). Unknown
   * values degrade safely: GazeAdapterFactory normalizes them to mediapipe.
   */
  gazeEngineOverride: string | null;
  /**
   * Host-supplied gaze AOIs (el.setGazeAois). Applied at runtime construction
   * so AOIs set BEFORE start() aren't lost; while running, the element also
   * forwards updates to controls.setGazeAois for a live swap. Null ⇒ the
   * persisted `gaze_aois` setting (default []). Same per-instance isolation
   * rationale as gazeEngineOverride.
   */
  gazeAois: GazeAoi[] | null;
  /**
   * Host-supplied runtime settings for the embed (the <oyon-app> `settings`
   * attribute, a JSON object of EditableSettings keys — e.g. tenant-level
   * aggregation parameters a host admin tuned server-side: model_profile,
   * sample_interval_ms, aggregate_window_ms, min_valid_frames,
   * smoothing_alpha, min_hold_ms, switch_confidence …). Merged over the
   * persisted settings store at runtime construction WITHOUT being written
   * into the user's persisted settings — same per-instance isolation
   * rationale as gazeEngineOverride, which (as the more specific override)
   * still wins for gaze_engine. Unknown keys and mismatched types are
   * ignored key-by-key. Null ⇒ use the settings store (unchanged behavior).
   */
  settingsOverride: Record<string, unknown> | null;
  setBridge: (
    // `chromeless` is intentionally NOT settable: it is strictly derived from
    // `chromeMode` (below), so it cannot be patched into an inconsistent pair.
    next: Partial<
      Pick<
        HostBridgeState,
        | 'embedded'
        | 'chromeMode'
        | 'assetBase'
        | 'apiBaseUrl'
        | 'getToken'
        | 'emitHostEvent'
        | 'userId'
        | 'userLabel'
        | 'sessionIdOverride'
        | 'gazeEngineOverride'
        | 'gazeAois'
        | 'settingsOverride'
      >
    >,
  ) => void;
  registerControls: (controls: HostControls | null) => void;
  /** Replace the host-supplied windows (or clear with null). */
  setHostWindows: (windows: EmotionWindow[] | null) => void;
}

/** A bound zustand store carrying one instance's host-bridge state. */
export type HostBridgeStore = UseBoundStore<StoreApi<HostBridgeState>>;

/**
 * Build a fresh, fully-independent host-bridge store. Each `<oyon-app>`
 * element owns ONE of these (created in connectedCallback), so a `capture`
 * instance and N `chrome="none"` viewer instances coexist on the same page
 * without clobbering each other's bridge state. The default module store
 * (`useHostBridge`, below) is just the first one of these, kept for the
 * standalone / non-embedded code path so that path is byte-for-byte unchanged.
 */
export function createHostBridgeStore(): HostBridgeStore {
  return create<HostBridgeState>((set) => ({
    embedded: false,
    chromeMode: 'full',
    chromeless: false,
    assetBase: null,
    apiBaseUrl: null,
    getToken: null,
    emitHostEvent: null,
    controls: null,
    hostWindows: null,
    userId: null,
    userLabel: null,
    sessionIdOverride: null,
    gazeEngineOverride: null,
    gazeAois: null,
    settingsOverride: null,
    // `chromeless` is kept strictly derived from `chromeMode` so the viewer
    // stub gate can NEVER drift from the viewer mode: every update that carries
    // chromeMode re-derives chromeless === (chromeMode === 'none'), and callers
    // cannot patch chromeless directly (it is excluded from setBridge's Pick),
    // so an inconsistent pair (e.g. chromeMode:'none' ∧ chromeless:false) is not
    // representable. A patch without chromeMode leaves the (already-consistent)
    // value untouched.
    setBridge: (next) =>
      set(
        'chromeMode' in next
          ? { ...next, chromeless: next.chromeMode === 'none' }
          : next,
      ),
    registerControls: (controls) => set({ controls }),
    setHostWindows: (windows) => set({ hostWindows: windows }),
  }));
}

/**
 * The DEFAULT module store. Standalone (`main.tsx`) and any code path that is
 * not wrapped in a `HostBridgeProvider` read/write THIS store, exactly as
 * before the per-instance factory existed.
 */
export const useHostBridge: HostBridgeStore = createHostBridgeStore();

/**
 * React context carrying the host-bridge store for the surrounding subtree.
 * Its default is the module `useHostBridge` store, so any component rendered
 * WITHOUT a `HostBridgeProvider` (i.e. standalone) sees the module store and
 * behaves identically to before.
 */
const HostBridgeContext = createContext<HostBridgeStore>(useHostBridge);

/**
 * Scope a host-bridge store to a subtree. Each `<oyon-app>` element wraps its
 * React root in this with its OWN store, so the hooks/`emitHostEvent` below
 * resolve to that instance's state rather than the shared module store.
 */
export function HostBridgeProvider({
  store,
  children,
}: {
  store: HostBridgeStore;
  children: ReactNode;
}): ReactNode {
  return createElement(HostBridgeContext.Provider, { value: store }, children);
}

/**
 * Subscribe to the surrounding store's state (replacement for
 * `useHostBridge(selector)`). Reads the context store, so a viewer instance
 * and a capture instance select from their own independent state.
 */
export function useBridge<U>(selector: (state: HostBridgeState) => U): U {
  return useStore(useContext(HostBridgeContext), selector);
}

/**
 * Return the surrounding store object itself, so callers can read/write it
 * imperatively (`.getState()` / `.setState()`) from inside React without
 * subscribing. This is how `runtime.ts` reaches the PER-INSTANCE bridge.
 */
export function useBridgeStore(): HostBridgeStore {
  return useContext(HostBridgeContext);
}
