import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeRouter } from '@/router';
import { DEFAULT_USER_ID } from '@/lib/identityStore';
import {
  createHostBridgeStore,
  HostBridgeProvider,
  type ChromeMode,
  type GazeAoi,
  type HostBridgeStore,
} from '@/lib/hostBridge';
import elementCss from '@/styles/element.css?inline';
import type { EmotionWindow } from 'oyon';

/*
 * <oyon-app> — the full Oyon Research Instrument as an embeddable custom
 * element. Additive delivery mode: it mounts the SAME app tree main.tsx
 * mounts, inside a shadow root, on a memory-history router (the host page's
 * URL is never touched).
 *
 * Host contract (see docs/EMBEDDING.md):
 *   attributes  user-id, user-label, session-id, api-base-url, asset-base,
 *               page  (identity attrs apply live)
 *   property    getToken: () => string | Promise<string>
 *   methods     start(), stop()
 *   events      oyon:window  { windows, sessionId, userId }
 *               oyon:sample  { dominant, confidence, valence, ts }
 *                            (live ~10Hz per-sample emotion for a real-time
 *                             face/avatar between windows; derived label only)
 *               oyon:status  { state }            (bubbles, composed)
 *
 * Instances are independent: each <oyon-app> owns its OWN host-bridge store
 * (this.bridge), so a real-runtime capture instance and N chrome="none"
 * viewer instances coexist on the same page without clobbering each other's
 * bridge state. Camera safety is still enforced, but only on the ONE real
 * runtime: at most one real-runtime instance (chrome = capture |
 * capture-analytics | full) may own the camera at a time (tracked by
 * `realInstance`); chrome="none" viewers are unlimited and may coexist with
 * that one real instance. A SECOND real-runtime element is refused with a
 * console error.
 */

// The single real-runtime <oyon-app> that currently owns the camera, if any.
// Viewer (chrome="none") instances never set or refuse on this — only the one
// real-runtime instance (capture / capture-analytics / full) claims it.
let realInstance: OyonAppElement | null = null;

/** Real-runtime modes own the camera; only one may be live at a time. The
 *  viewer mode ('none') runs no capture and is unlimited. */
function isRealRuntimeMode(mode: ChromeMode): boolean {
  return mode !== 'none';
}

class ElementErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      console.error('[oyon-app] render failed', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      });
    } catch {
      /* no console */
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100%',
            padding: 24,
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            color: '#111827',
            background: '#ffffff',
          }}
        >
          <div style={{ maxWidth: 720 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
              Oyon view failed to render
            </h2>
            <p style={{ margin: 0, color: '#4b5563', fontSize: 13 }}>
              This embedded view hit a recoverable rendering error. Check the console for the
              original stack.
            </p>
            <pre
              style={{
                marginTop: 16,
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.5,
                color: '#991b1b',
              }}
            >
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const OBSERVED = [
  'user-id',
  'user-label',
  'session-id',
  'api-base-url',
  'asset-base',
  'page',
  // gaze-engine pins the gaze engine for THIS embed ('mediapipe' | 'webgazer'
  // | 'webeyetrack') without touching the user's persisted settings. Hosts
  // that only consume zone aggregates should pin 'mediapipe' (training-free
  // geometry — works from the first frame); absent ⇒ the settings store's
  // engine (standalone preference: webgazer). Read at runtime start.
  'gaze-engine',
  // settings carries a JSON object of EditableSettings keys (e.g. host-tenant
  // aggregation parameters: model_profile, sample_interval_ms,
  // aggregate_window_ms, min_valid_frames, smoothing_alpha, min_hold_ms,
  // switch_confidence). Merged over the persisted settings store at runtime
  // start — never written into the user's persisted settings. Invalid JSON is
  // ignored with a console warning. Like gaze-engine, a live change takes
  // effect on the NEXT start().
  'settings',
  // chrome selects the delivery shell:
  //   absent       → 'full'    : today's full app, untouched.
  //   "none"       → 'none'    : viewer-only — drops capture chrome
  //                  (Live/Sessions + status strip + capture dock), keeps a
  //                  minimal Analyze+Settings nav, never inits the camera
  //                  (viewer STUB runtime).
  //   "capture"    → 'capture' : renders ONLY the compact capture pill with
  //                  the REAL runtime (no nav/header/dock/analytics); the
  //                  element sizes to the pill.
  //   "capture-analytics" → 'capture-analytics' : the compact capture pill as a
  //                  header strip ABOVE the full Analyze dashboards, all on the
  //                  REAL runtime — one element, both capture and analytics.
  'chrome',
] as const;

/** Parse the `chrome` attribute into the four recognized modes. Anything
 *  unrecognized falls back to 'full' (today's app), so a typo never silently
 *  loses the camera. */
function parseChromeMode(value: string | null): ChromeMode {
  const v = value?.trim().toLowerCase();
  if (v === 'none') return 'none';
  if (v === 'capture') return 'capture';
  if (v === 'capture-analytics') return 'capture-analytics';
  // Unknown values fall back to the full app (the safe default — a typo never
  // silently strips the camera). Warn so a misspelled chrome="capure" is
  // diagnosable rather than a confusing "the embed ignored my attribute".
  if (v != null && v !== '' && v !== 'full') {
    try {
      console.warn(
        `[oyon-app] unrecognized chrome="${value}" — falling back to the full app. ` +
          `Valid: "none" | "capture" | "capture-analytics" | absent.`,
      );
    } catch { /* no console */ }
  }
  return 'full';
}

/** Initial memory-history entry. `page` wins when set; otherwise the combined
 *  capture+analytics embed lands on /analyze (its reason to exist), while every
 *  other mode keeps the historical '/' default (→ /live) untouched. */
function initialEntryFor(chromeMode: ChromeMode, pageAttr: string | null): string {
  if (pageAttr != null && pageAttr.trim() !== '') return pageAttr;
  return chromeMode === 'capture-analytics' ? '/analyze' : '/';
}

/** Parse the `settings` attribute: a JSON object of EditableSettings keys.
 *  Anything that isn't a plain JSON object is rejected with a warning (never
 *  a throw — a malformed host attribute must not kill the element). Key-level
 *  validation happens at start() in runtime.ts, where the merge only accepts
 *  known keys with matching types. */
function parseSettingsAttribute(value: string | null): Record<string, unknown> | null {
  if (value == null || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn('[oyon-app] `settings` attribute must be a JSON object — ignored.');
  } catch {
    console.warn('[oyon-app] `settings` attribute is not valid JSON — ignored.');
  }
  return null;
}

export class OyonAppElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED];
  }

  /** Bearer-token provider for the optional sync leg. Set before start(). */
  getToken: (() => string | Promise<string>) | null = null;

  private reactRoot: Root | null = null;
  private router: ReturnType<typeof makeRouter> | null = null;
  /** This instance's OWN host-bridge store — created at connect, GC'd with the
   *  element. Never shared, so a viewer's setBridge can't clobber a capture
   *  instance's runtime. Null until connectedCallback runs. */
  private bridge: HostBridgeStore | null = null;

  connectedCallback(): void {
    if (this.reactRoot) return; // re-append of the same node — already live

    const chromeMode = parseChromeMode(this.getAttribute('chrome'));
    // Camera-safety guard: only ONE real-runtime instance may own the camera.
    // chrome="none" viewers run no capture, so they neither claim nor refuse.
    if (isRealRuntimeMode(chromeMode)) {
      if (realInstance && realInstance !== this) {
        console.error(
          '[oyon-app] another real-runtime <oyon-app> owns the camera; ' +
            "only chrome='none' viewers may coexist. Refusing this instance.",
        );
        return;
      }
      realInstance = this;
    }

    // Per-instance bridge store: independent of every other <oyon-app> and of
    // the default module store, so concurrent instances never clobber each
    // other's chromeMode / runtime selection.
    this.bridge = createHostBridgeStore();

    // Immutable layout key: element.css sizes capture mode off `data-oyon-chrome`,
    // NOT the public `chrome` attribute — so a host that externally mutates
    // `chrome` post-mount (unsupported; the runtime ignores it) can't resize the
    // embed. Set once here and never changed.
    this.setAttribute('data-oyon-chrome', chromeMode);

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    adoptStyles(shadow, elementCss);

    const host = document.createElement('div');
    host.className = 'oyon-app-host';
    host.dataset.theme = 'light';
    shadow.appendChild(host);

    this.applyIdentityAttributes();
    this.bridge.getState().setBridge({
      embedded: true,
      chromeMode,
      assetBase: this.getAttribute('asset-base'),
      apiBaseUrl: this.getAttribute('api-base-url'),
      gazeEngineOverride: this.getAttribute('gaze-engine')?.trim().toLowerCase() || null,
      settingsOverride: parseSettingsAttribute(this.getAttribute('settings')),
      // Lazy passthrough, resolved at REQUEST time — never at connect time.
      // For a parser-created element, connectedCallback fires during
      // upgrade, before any host script can assign `el.getToken`; snapshot-
      // ing the property here would permanently discard a token provider
      // set later. Returning null when unset means HttpEmotionTransport
      // simply omits the Authorization header.
      getToken: () => (this.getToken ? this.getToken() : null),
      emitHostEvent: (type, detail) => {
        // EVERY host event (oyon:window / oyon:status / oyon:sample) bubbles and
        // crosses the shadow boundary (composed), so a host can listen on the
        // element or any ancestor. The full signal is exposed — Oyon is
        // research-grade (CLAUDE.md "Data policy").
        this.dispatchEvent(
          new CustomEvent(type, { detail, bubbles: true, composed: true }),
        );
      },
    });

    this.router = makeRouter(
      createMemoryHistory({
        initialEntries: [initialEntryFor(chromeMode, this.getAttribute('page'))],
      }),
    );
    this.reactRoot = createRoot(host);
    this.reactRoot.render(
      <StrictMode>
        <ElementErrorBoundary>
          <HostBridgeProvider store={this.bridge}>
            <QueryClientProvider client={makeQueryClient()}>
              <RouterProvider router={this.router} />
            </QueryClientProvider>
          </HostBridgeProvider>
        </ElementErrorBoundary>
      </StrictMode>,
    );
  }

  disconnectedCallback(): void {
    if (!this.reactRoot) return; // never mounted (e.g. refused real instance)
    // Release the camera claim SYNCHRONOUSLY — NOT in the deferred microtask
    // below. A host that swaps the element in ONE commit (React
    // `<oyon-app key={…}>` remount, or any keyed re-render: the old node is
    // removed and a new node inserted in the same synchronous task) fires this
    // disconnect and then the NEW node's connect, both BEFORE any microtask
    // runs. If the claim were freed only in the microtask, the incoming
    // instance would still see the camera held and refuse itself — leaving
    // NOTHING mounted. Free it now so the incoming instance can claim it; if
    // this turns out to be a re-parent of THIS node (not a removal), we
    // re-claim in the microtask.
    const heldCamera = realInstance === this;
    if (heldCamera) realInstance = null;
    // Deferred teardown: a host re-parenting the element (appendChild move,
    // framework keyed re-render of the SAME node) fires disconnect+connect
    // synchronously in the same task — by the time this microtask runs,
    // isConnected is true again and we keep the live tree (connectedCallback
    // early-returns on the surviving reactRoot). Only a REAL removal tears
    // down, and it must stop capture first: the runtime deliberately has no
    // unmount teardown, so skipping stop() here would orphan a running camera
    // with no handle left to reach it (element.stop() no-ops once controls
    // deregister).
    queueMicrotask(() => {
      if (this.isConnected || !this.reactRoot) {
        // Re-parent of THIS node: the live tree survives. Re-claim the camera
        // if we held it and no incoming instance grabbed it in the meantime
        // (a true node-swap leaves realInstance pointing at the new element).
        if (heldCamera && realInstance === null) realInstance = this;
        return;
      }
      // Genuine removal — tear down. The camera claim was already released
      // above (and may already be held by an incoming instance), so this path
      // must NOT touch realInstance.
      const bridge = this.bridge;
      const controls = bridge?.getState().controls;
      // AWAIT stop before unmounting: unmounting first deregisters controls /
      // disposes the runtime while stop() is mid-flight, which can leave the
      // camera pipeline half-stopped and drop its final window flush. The
      // claim release above already lets an incoming instance mount; this only
      // sequences OUR teardown after OUR stop settles.
      const stopSettled: Promise<void> = controls
        ? controls.stop().catch(() => {
            /* best-effort: never throw out of a lifecycle callback */
          })
        : Promise.resolve();
      void stopSettled.then(() => {
        this.reactRoot?.unmount();
        this.reactRoot = null;
        this.router = null;
        // Reset THIS instance's own store for parity (it's GC'd with the element
        // anyway, but keep teardown symmetric with connect).
        bridge?.getState().setBridge({
          embedded: false,
          chromeMode: 'full',
          userId: null,
          userLabel: null,
          sessionIdOverride: null,
          gazeEngineOverride: null,
          gazeAois: null,
          settingsOverride: null,
          assetBase: null,
          apiBaseUrl: null,
          getToken: null,
          emitHostEvent: null,
        });
        bridge?.getState().setHostWindows(null);
        this.bridge = null;
        if (this.shadowRoot) this.shadowRoot.replaceChildren();
      });
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (!this.reactRoot) return; // connectedCallback will read everything
    switch (name) {
      case 'user-id':
      case 'user-label':
      case 'session-id':
        this.applyIdentityAttributes();
        break;
      case 'gaze-engine':
        // Takes effect on the NEXT start() — the runtime snapshots settings at
        // start time, so a live attribute change never hot-swaps the adapter.
        this.bridge?.getState().setBridge({
          gazeEngineOverride: value && value.trim() !== '' ? value.trim().toLowerCase() : null,
        });
        break;
      case 'api-base-url':
        this.bridge?.getState().setBridge({ apiBaseUrl: value });
        break;
      case 'asset-base':
        this.bridge?.getState().setBridge({ assetBase: value });
        break;
      case 'settings':
        // Same contract as gaze-engine: snapshotted at start() — a live
        // attribute change never reconfigures a running capture.
        this.bridge?.getState().setBridge({ settingsOverride: parseSettingsAttribute(value) });
        break;
      case 'page':
        if (value) void this.router?.navigate({ to: value });
        break;
      case 'chrome':
        // chrome is FIXED at mount. The runtime-hook tree branches on it (stub
        // vs real), and the one-real-runtime camera guard (`realInstance`) is
        // claimed only at connect — so mutating chromeMode live would swap the
        // hook tree (a rules-of-hooks violation) and bypass that guard. Ignore
        // the change with a warning; remount the element to change chrome.
        try {
          console.warn(
            '[oyon-app] `chrome` is fixed at mount and cannot change live — ' +
              'the change was ignored. Remount the element to change chrome.',
          );
        } catch { /* no console */ }
        break;
      default:
        break;
    }
  }

  /** Begin capture. Call from a user gesture (camera permission prompt). */
  async start(): Promise<void> {
    if (this.bridge?.getState().chromeless) {
      // Viewer-only mode (chrome="none"): the embed owns no camera — the host
      // captures and feeds windows via setWindows(). Make start() a safe
      // no-op so a host that calls it indiscriminately can't trigger a camera
      // prompt or contend with its own capture.
      console.info(
        '[oyon-app] start() is a no-op in chrome="none" mode — this embed is a ' +
          'pure analytics viewer. Feed windows with el.setWindows(...).',
      );
      return;
    }
    const controls = this.bridge?.getState().controls;
    if (!controls) {
      throw new Error('[oyon-app] not mounted yet — wait for the element to render before start()');
    }
    await controls.start();
  }

  /** Stop capture and flush the final window. */
  async stop(): Promise<void> {
    if (this.bridge?.getState().chromeless) {
      console.info('[oyon-app] stop() is a no-op in chrome="none" mode (no capture is running).');
      return;
    }
    const controls = this.bridge?.getState().controls;
    if (!controls) return;
    await controls.stop();
  }

  /**
   * Feed the embedded Analyze dashboards windows the HOST already captured.
   * In chrome="none" mode this is how the embed gets its data (no camera).
   * Windows are the same `EmotionWindow` (AggregateWindow) shape the element
   * emits via the `oyon:window` event. Pass `null` to clear and fall back to
   * the element's own local store. Available in all modes; outside
   * chrome="none" it simply overrides the local store for the dashboards.
   */
  setWindows(windows: EmotionWindow[] | null): void {
    this.bridge?.getState().setHostWindows(windows ?? null);
  }

  /**
   * Define/replace the gaze Areas-of-Interest for THIS embed — e.g. the host
   * app's tutor-avatar face region, so windows report `aoi_dwell_ms` ("was
   * the learner looking at the agent?"). Rects use the gaze convention:
   * [-0.5, 0.5] both axes, origin = screen center, x/y = top-left corner.
   * Safe to call any time: before start() the rects are picked up at runtime
   * construction; while running they hot-swap on the live aggregator (the
   * NEXT flushed window reflects them). Pass [] or null to clear.
   */
  setGazeAois(aois: GazeAoi[] | null): void {
    const next = Array.isArray(aois) ? aois : [];
    this.bridge?.getState().setBridge({ gazeAois: next });
    this.bridge?.getState().controls?.setGazeAois?.(next);
  }

  private applyIdentityAttributes(): void {
    const userId = this.getAttribute('user-id');
    const userLabel = this.getAttribute('user-label');
    const sessionId = this.getAttribute('session-id');
    // Write identity into THIS element's OWN bridge store, NOT the module-level
    // useIdentity store. Sharing the module store let a coexisting
    // chrome="none" viewer (which carries no session-id) overwrite the capture
    // instance's sessionIdOverride to null, mis-attributing capture to a
    // generated standalone-* session. runtime.ts reads identity from this
    // per-instance store when embedded; standalone still uses useIdentity.
    this.bridge?.getState().setBridge({
      userId: userId && userId.trim().length > 0 ? userId.trim() : DEFAULT_USER_ID,
      userLabel: userLabel && userLabel.trim().length > 0 ? userLabel.trim() : null,
      sessionIdOverride: sessionId && sessionId.trim().length > 0 ? sessionId.trim() : null,
    });
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

// Constructable sheets are shareable across shadow roots and (unlike shadow
// child nodes) survive disconnect cleanup — parse the inlined stylesheet
// once per page and assign idempotently, so repeated connect cycles neither
// re-parse the CSS nor accumulate duplicate adopted sheets.
let cachedSheet: CSSStyleSheet | null = null;

function adoptStyles(shadow: ShadowRoot, css: string): void {
  try {
    if (!cachedSheet) {
      cachedSheet = new CSSStyleSheet();
      cachedSheet.replaceSync(css);
    }
    if (!shadow.adoptedStyleSheets.includes(cachedSheet)) {
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, cachedSheet];
    }
  } catch {
    // Safari < 16.4 — fall back to a <style> tag. No accumulation risk:
    // the fallback is a shadow child node, removed by replaceChildren()
    // during teardown.
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }
}

if (!customElements.get('oyon-app')) {
  customElements.define('oyon-app', OyonAppElement);
}
