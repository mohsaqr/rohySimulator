// Single source of truth for Oyon model profiles inside Rohy.
//
// The Rohy miniature, the admin Settings dropdown, and the Rohy-mode
// standalone dashboard all resolve their runtime config through this
// registry. The IDs here match what the standalone app uses upstream
// (OyonR/standalone/standalone-demo.js MODEL_PROFILES) so admin choices
// in Rohy round-trip cleanly when the standalone is launched with
// ?source=rohy.
//
// To add a model: add an entry here, no other file needs to change.

import {
   EMOTIEFF_MOBILEVIT_MTL_CONFIG,
   EMOTIEFF_MBF_MTL_CONFIG,
   HSE_EMOTION_MTL_CONFIG,
} from 'oyon';

export const MODEL_PROFILES = {
   'hse-emotion-mtl': {
      label: 'HSEmotion B0 MTL',
      hint: '8 expressions + valence/arousal · default',
      config: HSE_EMOTION_MTL_CONFIG,
   },
   'emotieff-mobilevit': {
      label: 'EmotiEff MobileViT',
      hint: '8 expressions + valence/arousal',
      config: EMOTIEFF_MOBILEVIT_MTL_CONFIG,
   },
   'emotieff-mbf-mtl': {
      label: 'EmotiEff MobileFaceNet',
      hint: 'experimental, lightweight',
      config: EMOTIEFF_MBF_MTL_CONFIG,
   },
};

export const DEFAULT_MODEL_PROFILE = 'hse-emotion-mtl';

export function resolveModelConfig(profileId) {
   const profile = MODEL_PROFILES[profileId] || MODEL_PROFILES[DEFAULT_MODEL_PROFILE];
   return profile.config;
}

export function modelProfileLabel(profileId) {
   return (MODEL_PROFILES[profileId] || MODEL_PROFILES[DEFAULT_MODEL_PROFILE]).label;
}

export function modelProfileList() {
   return Object.entries(MODEL_PROFILES).map(([id, p]) => ({ id, label: p.label, hint: p.hint }));
}
