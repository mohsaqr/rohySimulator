// Canonical Oyon emotion vocabulary shared by capture-derived analytics.
// Upstream Oyon emits `anger`; older Rohy UI/tests sometimes used `angry`.
// Normalize aliases at analytics boundaries so labels do not split.

export const OYON_EMOTION_LABELS = Object.freeze([
   'anger',
   'contempt',
   'disgust',
   'fear',
   'happy',
   'neutral',
   'sad',
   'surprise',
]);

export const OYON_EMOTION_ALIASES = Object.freeze({
   angry: 'anger',
   anger: 'anger',
   contempt: 'contempt',
   disgust: 'disgust',
   fear: 'fear',
   happy: 'happy',
   happiness: 'happy',
   joy: 'happy',
   neutral: 'neutral',
   sad: 'sad',
   sadness: 'sad',
   surprise: 'surprise',
});

export function canonicalEmotionLabel(raw) {
   const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
   if (!key) return null;
   return OYON_EMOTION_ALIASES[key] ?? key;
}

export function observedDominantLabels(records) {
   const set = new Set();
   for (const r of Array.isArray(records) ? records : []) {
      const label = canonicalEmotionLabel(r?.dominant_emotion);
      if (label) set.add(label);
   }
   return [...set].sort();
}

export function probabilityChannelLabels(records) {
   const set = new Set();
   for (const r of Array.isArray(records) ? records : []) {
      const probs = r?.probabilities;
      if (!probs || typeof probs !== 'object') continue;
      for (const label of Object.keys(probs)) {
         const canonical = canonicalEmotionLabel(label);
         if (canonical) set.add(canonical);
      }
   }
   return [...set].sort();
}
