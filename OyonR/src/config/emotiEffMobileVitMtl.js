import { EMOTION_MODEL_MOBILEVIT_MTL_URL } from './cdnDefaults.js';

export const EMOTIEFF_MOBILEVIT_MTL_CONFIG = {
  id: 'emotiefflib-mobilevit-va-mtl',
  modelName: 'mobilevit_va_mtl',
  modelVersion: 'sb-ai-lab-emotiefflib-main',
  modelUrl: EMOTION_MODEL_MOBILEVIT_MTL_URL,
  labels: ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
  inputSize: 224,
  inputChannels: 3,
  inputName: 'input',
  outputName: null,
  inputScale: 1 / 255,
  colorOrder: 'BGR',
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  emotionOffset: 0,
  valenceIndex: 8,
  arousalIndex: 9,
  supportsValenceArousal: true,
  license: 'Apache-2.0',
  source: 'https://github.com/sb-ai-lab/EmotiEffLib',
  notes: [
    'Current EmotiEffLib MobileViT multi-task model.',
    'Outputs eight expression logits followed by valence and arousal.',
    'Default standalone profile for stronger valence/arousal-capable inference.',
  ],
};

