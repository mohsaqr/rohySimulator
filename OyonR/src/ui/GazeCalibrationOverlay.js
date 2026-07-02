/**
 * GazeCalibrationOverlay — Stage 5 of the screen-point gaze pipeline.
 *
 * Vanilla custom element `<oyon-gaze-calibration>` that owns the visible
 * calibration UI: a full-viewport dim overlay with a single moving target
 * dot. The element is a thin shell over `GazeCalibrationDriver` — it
 * supplies the DOM-side concerns (rendering, keyboard handling, click
 * dispatching) and forwards driver events as DOM CustomEvents so hosts
 * can wire them via `addEventListener` like any other element.
 *
 * Why split this from the driver:
 *   `webeyetrack@0.0.2`'s calibration is driven by real DOM click events
 *   (`WebEyeTrack.handleClick`). The overlay's job is to fire synthetic
 *   `MouseEvent('click')` at each target's pixel position so the upstream
 *   worker observes a "click" at the same spot the user is looking. The
 *   driver doesn't know about the DOM; the overlay supplies the click
 *   dispatcher that bridges them.
 *
 * File-import safety:
 *   This file is imported from `src/index.js` (so a Node consumer that
 *   imports `oyon` doesn't crash before `defineGazeCalibrationOverlay()`
 *   is called). The custom-element class is defined *inside* the function,
 *   matching `EmotionCaptureElement.js`'s pattern — `HTMLElement` is only
 *   referenced when the function is actually invoked (which only happens
 *   in a browser).
 *
 * Usage:
 *
 *   import { defineGazeCalibrationOverlay } from 'oyon/ui/gaze-calibration';
 *   defineGazeCalibrationOverlay();
 *
 *   const overlay = document.createElement('oyon-gaze-calibration');
 *   overlay.addEventListener('calibration:complete', (e) => {
 *     console.log('done', e.detail.result);
 *   });
 *   document.body.appendChild(overlay);
 *   overlay.startCalibration(runtime);   // returns Promise<CalibrationResult>
 *
 * Configure (optional, before startCalibration):
 *   overlay.points = [{x: -0.4, y: -0.4}, ...];   // custom sequence
 *   overlay.fixationMs = 800;
 *   overlay.captureMs = 1200;
 *
 * Events emitted (CustomEvent.detail in parentheses):
 *   - calibration:start        ({ totalPoints })
 *   - calibration:progress     ({ type, index?, total?, point?, pixelX?, pixelY? })
 *   - calibration:show         ({ point, index, total, pixelX, pixelY })
 *   - calibration:capture      ({ point, index, total, pixelX, pixelY })
 *   - calibration:complete     ({ result })
 *   - calibration:aborted      ({ reason })
 */

import { GazeCalibrationDriver } from './GazeCalibrationDriver.js';

const ELEMENT_TAG_DEFAULT = 'oyon-gaze-calibration';
const ACTIVE_STYLE_ID = 'oyon-gaze-calibration-style';

const STYLE_BLOCK = `
  oyon-gaze-calibration {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: none;
    background: rgba(0, 0, 0, 0.78);
    color: #fff;
    font: 14px/1.4 system-ui, -apple-system, sans-serif;
  }
  oyon-gaze-calibration[active] { display: block; }
  oyon-gaze-calibration .oyon-gc-dot {
    position: absolute;
    width: 28px;
    height: 28px;
    margin-left: -14px;
    margin-top: -14px;
    border-radius: 50%;
    /* High-contrast calibration target: a red core inside a white ring, with a
       dark outline + halo. Stays visible on ANY background — red reads on white,
       the white ring reads on black/green, and the dark outline defines the edge
       everywhere (the overlay dim can be clipped to the embed box, so the dot
       can land on a plain white page). */
    background: radial-gradient(circle at center, #ff3b30 0 38%, #ffffff 42% 64%, transparent 66%);
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.65), 0 0 14px 2px rgba(0, 0, 0, 0.4);
    transition: left 120ms ease-out, top 120ms ease-out, transform 220ms ease-out;
    transform: scale(1);
    pointer-events: none;
  }
  oyon-gaze-calibration[data-phase="capturing"] .oyon-gc-dot {
    transform: scale(0.55);
  }
  oyon-gaze-calibration .oyon-gc-header {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 6px;
    padding: 6px 12px;
    font-variant-numeric: tabular-nums;
  }
  oyon-gaze-calibration .oyon-gc-progress {
    font-weight: 600;
    color: #fff;
  }
  oyon-gaze-calibration .oyon-gc-header-sep {
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.18);
  }
  oyon-gaze-calibration .oyon-gc-hint {
    opacity: 0.85;
    font-size: 13px;
  }
`;

/**
 * Define the `<oyon-gaze-calibration>` custom element. Idempotent — safe to
 * call multiple times with the same tag. Does nothing (and does not throw)
 * in environments without `customElements` (e.g., Node tests).
 *
 * @param {string} [name='oyon-gaze-calibration']
 */
export function defineGazeCalibrationOverlay(name = ELEMENT_TAG_DEFAULT) {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return;
  if (customElements.get(name)) return;

  installStyles();

  customElements.define(name, class GazeCalibrationOverlay extends HTMLElement {
    constructor() {
      super();
      this._driver = null;
      this._dot = null;
      this._label = null;
      this._hint = null;
      this._keyHandler = (e) => {
        if (e.key === 'Escape') this.abort('user_aborted');
      };
    }

    connectedCallback() {
      // Install the stylesheet into THIS element's root, not just document.head.
      // When embedded in a shadow-isolated host (e.g. `<oyon-app>`) the overlay
      // lives inside that shadow root, which document.head CSS cannot reach — so
      // the `display:none` idle rule would never apply and the hint text would
      // leak. Installing into getRootNode() makes the overlay self-sufficient in
      // any root (document or shadow).
      installStyles(this.getRootNode());
      if (this._dot) return;
      this._render();
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this._keyHandler);
      this.abort('disconnected');
    }

    /**
     * Begin a calibration sequence. Resolves with the runtime's
     * `calibrateGaze()` result, or { ok:false, reason } on abort / setup
     * failure. Never rejects.
     */
    startCalibration(runtime, options = {}) {
      const viewport = {
        width: options?.viewport?.width || window.innerWidth || document.documentElement.clientWidth,
        height: options?.viewport?.height || window.innerHeight || document.documentElement.clientHeight,
      };
      this._driver = new GazeCalibrationDriver({
        points: this.points,
        fixationMs: this.fixationMs,
        captureMs: this.captureMs,
        clickDispatcher: ({ pixelX, pixelY }) => dispatchSyntheticClick(pixelX, pixelY),
        onShow: (evt) => {
          this.setAttribute('data-phase', 'showing');
          this._moveDot(evt.pixelX, evt.pixelY);
          this._setLabel(`${evt.index + 1} / ${evt.total}`);
          this._emit('calibration:show', evt);
        },
        onCapture: (evt) => {
          this.setAttribute('data-phase', 'capturing');
          this._emit('calibration:capture', evt);
        },
        onProgress: (evt) => this._emit('calibration:progress', evt),
        onComplete: (result) => {
          this.removeAttribute('active');
          this.removeAttribute('data-phase');
          document.removeEventListener('keydown', this._keyHandler);
          this._emit('calibration:complete', { result });
        },
        onAbort: (reason) => {
          this.removeAttribute('active');
          this.removeAttribute('data-phase');
          document.removeEventListener('keydown', this._keyHandler);
          this._emit('calibration:aborted', { reason });
        },
      });

      this.setAttribute('active', '');
      document.addEventListener('keydown', this._keyHandler);
      this._emit('calibration:start', { totalPoints: (this.points || this._driver.options.points).length });
      return this._driver.start(runtime, { viewport });
    }

    /** Abort an in-flight run. Idempotent. */
    abort(reason = 'user_aborted') {
      if (this._driver) this._driver.abort(reason);
    }

    // ---- internal ----

    _render() {
      this.innerHTML = `
        <div class="oyon-gc-header" part="header">
          <span class="oyon-gc-progress" part="progress" data-gc-progress></span>
          <span class="oyon-gc-header-sep"></span>
          <span class="oyon-gc-hint" part="hint">Look at the dot. Press Esc to cancel.</span>
        </div>
        <div class="oyon-gc-dot" part="dot" data-gc-dot></div>
      `;
      this._dot = this.querySelector('[data-gc-dot]');
      this._label = this.querySelector('[data-gc-progress]');
      this._hint = this.querySelector('.oyon-gc-hint');
    }

    _moveDot(x, y) {
      if (!this._dot) this._render();
      if (!this._dot) return;
      this._dot.style.left = `${x}px`;
      this._dot.style.top = `${y}px`;
    }

    _setLabel(text) {
      if (!this._label) return;
      this._label.textContent = text;
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
  });
}

function dispatchSyntheticClick(pixelX, pixelY) {
  if (typeof window === 'undefined' || typeof MouseEvent === 'undefined') return;
  const init = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: pixelX,
    clientY: pixelY,
    screenX: pixelX,
    screenY: pixelY,
    button: 0,
  };
  // Dispatch the calibration click on the DOCUMENT — NOT on the element under
  // (x, y). The gaze engines (WebGazer / WebEyeTrack) register a GLOBAL click
  // listener and read clientX/clientY to record the calibration point, so a
  // document-level click is all they need. Clicking the actual element under the
  // dot fires that element's default action — and because the overlay can't
  // guarantee it covers the whole viewport inside a shadow-isolated embed, the
  // dot can sit over a host link/logo, so a real click there NAVIGATES the host
  // page away (calibration "fails" and the front page loads). Targeting the
  // document records the point with zero host side effects.
  const target = typeof document !== 'undefined' ? document : window;
  try {
    target.dispatchEvent(new MouseEvent('click', init));
  } catch {
    try { window.dispatchEvent(new MouseEvent('click', init)); } catch { /* swallow */ }
  }
}

function installStyles(root) {
  if (typeof document === 'undefined') return;
  // Resolve where the <style> must live so its rules actually reach the
  // overlay. ANY style-isolated root (a DocumentFragment, nodeType 11 — a
  // ShadowRoot is one) must receive the sheet directly, because document.head
  // CSS cannot cross into it; only a Document/unset root falls back to the
  // head. We key on nodeType alone (not `.host`): a host-less isolated fragment
  // is still unreachable from the head, so falling back there would silently
  // re-introduce the exact leak this fix exists to prevent. Idempotency is
  // per-root — querySelector works on a ShadowRoot, a fragment, and the head.
  const isolated = root && root.nodeType === 11;
  if (isolated && !root.host) {
    // Unusual: an isolated fragment with no host. Installing into it is still
    // correct (reachable); warn so an unexpected root is diagnosable, not silent.
    try { console.warn('[oyon-gaze-calibration] style root is an isolated fragment with no host; installed into it directly.'); } catch { /* no console */ }
  }
  const target = isolated ? root : (document.head || document.documentElement);
  if (target.querySelector(`#${ACTIVE_STYLE_ID}`)) return;
  const style = document.createElement('style');
  style.id = ACTIVE_STYLE_ID;
  style.textContent = STYLE_BLOCK;
  target.appendChild(style);
}
