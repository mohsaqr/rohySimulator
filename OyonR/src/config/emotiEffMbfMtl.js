import { EMOTION_MODEL_MOBILEFACENET_MTL_URL } from './cdnDefaults.js';

export const EMOTIEFF_MBF_MTL_CONFIG = {
  id: 'emotiefflib-mbf-va-mtl',
  modelName: 'mbf_va_mtl',
  modelVersion: 'sb-ai-lab-emotiefflib-main',
  modelUrl: EMOTION_MODEL_MOBILEFACENET_MTL_URL,
  labels: ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
  inputSize: 112,
  inputChannels: 3,
  inputName: 'input',
  outputName: null,
  inputScale: 1 / 255,
  colorOrder: 'RGB',
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  emotionOffset: 0,
  valenceIndex: 8,
  arousalIndex: 9,
  supportsValenceArousal: true,
  license: 'Apache-2.0',
  source: 'https://github.com/sb-ai-lab/EmotiEffLib',
  notes: [
    'MobileFaceNet multi-task model from the current EmotiEffLib ONNX model set.',
    'Outputs eight expression logits followed by valence and arousal.',
    'Experimental alternative profile; MobileViT remains the default.',
  ],
};
