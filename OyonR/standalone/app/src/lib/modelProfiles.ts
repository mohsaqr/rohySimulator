/*
 * Model profile catalog — mirrors MODEL_PROFILES from standalone-demo.js
 * (lines 125–141). Kept as a tiny typed map so the Settings page and the
 * runtime hook share a single source of truth.
 */
import {
  EMOTIEFF_MOBILEVIT_MTL_CONFIG,
  EMOTIEFF_MBF_MTL_CONFIG,
  HSE_EMOTION_MTL_CONFIG,
} from 'oyon';

export type ModelProfileId =
  | 'emotieff-mobilevit'
  | 'hse-emotion-mtl'
  | 'emotieff-mbf-mtl';

export interface ModelProfile {
  id: ModelProfileId;
  label: string;
  hint: string;
  // The classifier config is a deep record; we don't model its shape here.
  config: unknown;
}

export const MODEL_PROFILES: Record<ModelProfileId, ModelProfile> = {
  'emotieff-mobilevit': {
    id: 'emotieff-mobilevit',
    label: 'EmotiEff MobileViT',
    hint: '8 expressions + valence/arousal',
    config: EMOTIEFF_MOBILEVIT_MTL_CONFIG,
  },
  'hse-emotion-mtl': {
    id: 'hse-emotion-mtl',
    label: 'HSEmotion B0 MTL',
    hint: 'experimental, 8 expressions + valence/arousal',
    config: HSE_EMOTION_MTL_CONFIG,
  },
  'emotieff-mbf-mtl': {
    id: 'emotieff-mbf-mtl',
    label: 'EmotiEff MobileFaceNet',
    hint: 'experimental, 8 expressions + valence/arousal',
    config: EMOTIEFF_MBF_MTL_CONFIG,
  },
};

export const DEFAULT_MODEL_PROFILE: ModelProfileId = 'hse-emotion-mtl';
