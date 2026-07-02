import type { EmotionWindow } from 'oyon';

export interface FrameQuality {
  validFrames: number | null;
  totalFrames: number | null;
  ratio: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function deriveFrameQuality(window: EmotionWindow | null): FrameQuality {
  if (!window) return { validFrames: null, totalFrames: null, ratio: null };

  const validFrames = finiteNumber(window.valid_frames);
  if (validFrames == null) {
    return { validFrames: null, totalFrames: null, ratio: null };
  }

  const missingFaceRatio = finiteNumber(window.missing_face_ratio);
  const expectedSamples = finiteNumber(window.expected_samples);
  let totalFrames: number | null = null;

  if (missingFaceRatio != null && missingFaceRatio >= 0 && missingFaceRatio < 1) {
    const derived = Math.round(validFrames / (1 - missingFaceRatio));
    if (derived > 0) totalFrames = derived;
  }

  if (totalFrames == null && expectedSamples != null && expectedSamples > 0) {
    totalFrames = expectedSamples;
  }

  return {
    validFrames,
    totalFrames,
    ratio: totalFrames != null ? validFrames / totalFrames : null,
  };
}
