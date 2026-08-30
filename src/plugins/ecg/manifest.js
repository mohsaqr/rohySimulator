/**
 * Copy this file to Rohy `src/plugins/ecg/manifest.js` after vendoring this
 * package's `src/` folder to `src/components/ecg/`.
 */
import {
  ECG_COMPONENTS,
  ECG_OBJECT_TYPES,
  ECG_ROOM,
  ECG_VERB_METADATA,
} from '../../components/ecg/ecgEvents.js';
import {
  ECG_INTERPRETATIONS,
  ECG_OBJECT_OVERRIDES,
  ECG_VERB_FALLBACKS,
} from '../../components/ecg/ecgStates.js';

export const manifest = {
  id: ECG_ROOM,
  version: '1.0.0',
  room: {
    key: ECG_ROOM,
    labelKey: 'room_ecg',
    subKey: 'room_ecg_sub',
    icon: 'HeartPulse',
    accent: 'teal',
    order: 45,
  },
  vocabulary: {
    verbs: ECG_VERB_METADATA,
    objectTypes: ECG_OBJECT_TYPES,
    components: ECG_COMPONENTS,
  },
  states: {
    verbFallbacks: ECG_VERB_FALLBACKS,
    objectOverrides: ECG_OBJECT_OVERRIDES,
    interpretations: ECG_INTERPRETATIONS,
  },
  capabilities: ['persist'],
  minRole: 'student',
  authoring: {
    labelKey: 'room_ecg_author',
    minRole: 'educator',
  },
  document: {
    learnerOmit: ['rubric'],
  },
};

export default manifest;
