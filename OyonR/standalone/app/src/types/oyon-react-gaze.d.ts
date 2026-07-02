/*
 * Local declaration for the `oyon/react/gaze-calibration` subpath. The
 * library ships this as plain React.createElement code (src/react/
 * GazeCalibrationPanel.js); there's no hand-written .d.ts yet. We only need
 * the shapes the new app actually uses.
 */
import type { ComponentType, RefAttributes, RefObject } from 'react';
import type { EmotionRuntime } from 'oyon';

export interface GazeCalibrationPoint {
  x: number;
  y: number;
}

export interface GazeCalibrationCompleteDetail {
  ok: boolean;
  quality: number | null;
  confidence: 'measured' | 'inferred' | 'unknown';
  model: string;
  reason?: string;
  message?: string;
}

export interface GazeCalibrationPanelProps {
  runtime?: EmotionRuntime | null;
  autoStart?: boolean;
  points?: GazeCalibrationPoint[];
  fixationMs?: number;
  captureMs?: number;
  onStart?: (detail: unknown) => void;
  onShow?: (detail: unknown) => void;
  onCapture?: (detail: unknown) => void;
  onProgress?: (detail: { index: number; total: number }) => void;
  onComplete?: (detail: GazeCalibrationCompleteDetail) => void;
  onAbort?: (detail: unknown) => void;
  className?: string;
}

export interface GazeCalibrationPanelHandle {
  start: (
    runtime?: EmotionRuntime | null,
    options?: { points?: GazeCalibrationPoint[] },
  ) => Promise<GazeCalibrationCompleteDetail>;
  abort: (reason?: string) => void;
  element: () => HTMLElement | null;
}

export const GazeCalibrationPanel: ComponentType<
  GazeCalibrationPanelProps & RefAttributes<GazeCalibrationPanelHandle>
>;

// JSX intrinsic — the React panel renders <oyon-gaze-calibration>, so add a
// declaration so TS does not complain about the unknown element. Most TS
// projects scope this in their global types; we only need it under one
// component, but a module-scoped augmentation is the simplest path.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'oyon-gaze-calibration': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { class?: string };
    }
  }
}

export type GazeCalibrationPanelRef = RefObject<GazeCalibrationPanelHandle>;
