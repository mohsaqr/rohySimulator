import { ComponentType } from 'react';
import { UseRohyFerOptions } from './react.js';

export interface EmotionCapturePanelProps extends UseRohyFerOptions {
  className?: string;
  onWindow?: (window: unknown) => void;
}

export const EmotionCapturePanel: ComponentType<EmotionCapturePanelProps>;
export default EmotionCapturePanel;
