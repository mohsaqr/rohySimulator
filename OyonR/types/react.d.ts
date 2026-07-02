import {
  EmotionRuntime,
  OyonAttachmentOptions,
  RohyFerAttachmentOptions,
  EmotionWindow,
} from './index.js';

export interface UseOyonOptions extends OyonAttachmentOptions {
  /** When false, the hook is inert (no runtime is created). Default true. */
  enabled?: boolean;
  /** Called with every aggregate-window batch. */
  onWindow?: (windows: EmotionWindow[]) => void;
}

export interface UseOyonResult {
  status: string;
  error: unknown;
  lastWindow: EmotionWindow | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  runtime: EmotionRuntime | null;
}

export function useOyon(options?: UseOyonOptions): UseOyonResult;

/** @deprecated Rohy-shaped alias — prefer `useOyon`, which preserves all context keys. */
export interface UseRohyFerOptions extends RohyFerAttachmentOptions {
  enabled?: boolean;
}

/** @deprecated Rohy-shaped alias — prefer `UseOyonResult`. */
export type UseRohyFerResult = UseOyonResult;

export function useRohyFer(options?: UseRohyFerOptions): UseRohyFerResult;
