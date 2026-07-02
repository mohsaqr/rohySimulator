import React from 'react';
import { createPortal } from 'react-dom';
import { defineGazeCalibrationOverlay } from '../ui/GazeCalibrationOverlay.js';

/**
 * GazeCalibrationPanel — thin React wrapper around `<oyon-gaze-calibration>`.
 *
 * Renders the custom element, registers it on first mount (idempotent), and
 * forwards DOM events as React props. The actual calibration is driven via
 * the imperative `start(runtime, options?)` method exposed through `ref`:
 *
 *   const panelRef = useRef(null);
 *   <GazeCalibrationPanel ref={panelRef} runtime={runtime} onComplete={...} />
 *   await panelRef.current.start();
 *
 * Or pass `autoStart` + a `runtime` prop to kick off on mount.
 *
 * This matches `EmotionCapturePanel`'s ethos: a 30-line React surface over a
 * vanilla element so React-using and non-React hosts share the same code path.
 */
export const GazeCalibrationPanel = React.forwardRef(function GazeCalibrationPanel(props, ref) {
  const {
    runtime,
    autoStart = false,
    points,
    fixationMs,
    captureMs,
    onStart,
    onShow,
    onCapture,
    onProgress,
    onComplete,
    onAbort,
    className,
    ...rest
  } = props;

  const elementRef = React.useRef(null);

  React.useEffect(() => {
    defineGazeCalibrationOverlay();
  }, []);

  React.useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (Array.isArray(points)) el.points = points;
    if (Number.isFinite(fixationMs)) el.fixationMs = fixationMs;
    if (Number.isFinite(captureMs)) el.captureMs = captureMs;
  }, [points, fixationMs, captureMs]);

  React.useEffect(() => {
    const el = elementRef.current;
    if (!el) return undefined;
    const handlers = {
      'calibration:start': onStart,
      'calibration:show': onShow,
      'calibration:capture': onCapture,
      'calibration:progress': onProgress,
      'calibration:complete': onComplete,
      'calibration:aborted': onAbort,
    };
    const wired = [];
    for (const [type, fn] of Object.entries(handlers)) {
      if (typeof fn !== 'function') continue;
      const listener = (e) => fn(e.detail);
      el.addEventListener(type, listener);
      wired.push([type, listener]);
    }
    return () => {
      for (const [type, listener] of wired) el.removeEventListener(type, listener);
    };
  }, [onStart, onShow, onCapture, onProgress, onComplete, onAbort]);

  React.useImperativeHandle(ref, () => ({
    start(rt, options) {
      const el = elementRef.current;
      if (!el || typeof el.startCalibration !== 'function') {
        return Promise.resolve({ ok: false, reason: 'element_not_mounted' });
      }
      return el.startCalibration(rt || runtime, options);
    },
    abort(reason) {
      elementRef.current?.abort?.(reason);
    },
    element: () => elementRef.current,
  }), [runtime]);

  React.useEffect(() => {
    if (!autoStart || !runtime) return;
    const el = elementRef.current;
    if (!el || typeof el.startCalibration !== 'function') return;
    el.startCalibration(runtime);
  }, [autoStart, runtime]);

  const tree = React.createElement('oyon-gaze-calibration', {
    ref: elementRef,
    class: className || 'oyon-gaze-calibration-panel',
    ...rest,
  });

  // Portal the overlay into the TOP document body so it calibrates over the FULL
  // page, not just the embed. Inside <oyon-app>'s shadow root,
  // `:host { contain: layout }` confines `position: fixed` to the embed box — so
  // the dim + dots (and the gaze model they train) would only span the embed,
  // not the screen the user actually looks at. Rendering into document.body
  // escapes the shadow root + containment; React still owns the node (clean
  // unmount), and the overlay installs its styles into the top document head via
  // getRootNode(). Falls back to inline render where there is no document (SSR).
  return typeof document !== 'undefined' && document.body
    ? createPortal(tree, document.body)
    : tree;
});

export default GazeCalibrationPanel;
