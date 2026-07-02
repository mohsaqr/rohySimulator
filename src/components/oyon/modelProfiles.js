// Single source of truth for Oyon model profiles inside Rohy.
//
// IDs, labels and hints mirror the upstream catalog
// (OyonR/standalone/app/src/lib/modelProfiles.ts). Since the Oyon v2 element
// embed, Rohy only needs this id/label/hint surface for the admin Settings
// dropdown — the classifier CONFIGS (model URLs, tensor layouts) are
// resolved INSIDE the <oyon-app> element from the same ids, forwarded via
// its `settings` attribute (model_profile). Importing the config objects
// from 'oyon' here would drag the whole library into the SPA bundle graph
// (v2's optional gaze adapters dynamically import peer deps Vite can't
// resolve), for data the SPA never uses.
//
// To add a model: add it upstream, re-sync OyonR, then list it here.

export const MODEL_PROFILES = {
   'hse-emotion-mtl': {
      label: 'HSEmotion B0 MTL',
      hint: '8 expressions + valence/arousal · default',
   },
   'emotieff-mobilevit': {
      label: 'EmotiEff MobileViT',
      hint: '8 expressions + valence/arousal',
   },
   'emotieff-mbf-mtl': {
      label: 'EmotiEff MobileFaceNet',
      hint: 'experimental, lightweight',
   },
};

export const DEFAULT_MODEL_PROFILE = 'hse-emotion-mtl';

export function modelProfileList() {
   return Object.entries(MODEL_PROFILES).map(([id, p]) => ({ id, label: p.label, hint: p.hint }));
}
