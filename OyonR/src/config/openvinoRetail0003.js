import { assertSubsetOfAllowed } from './emotionLabels.js';

export const OPENVINO_RETAIL_0003_CONFIG = {
  id: 'openvino-emotions-recognition-retail-0003',
  modelName: 'emotions-recognition-retail-0003',
  modelVersion: 'open-model-zoo-retail-0003',
  // 5-label subset of the canonical 8 — this baseline does not emit
  // disgust/fear/contempt. Aggregator output for this profile sums to
  // ~0.625, which the validator rejects (sum-close-to-1 check). That
  // rejection is the deliberate signal that this profile isn't wired
  // for the persistence path; it stays in the repo as a baseline
  // contract reference only.
  labels: assertSubsetOfAllowed(
    ['neutral', 'happy', 'sad', 'surprise', 'anger'],
    'openvino-emotions-recognition-retail-0003',
  ),
  inputSize: 64,
  inputName: 'data',
  outputName: 'prob_emotion',
  colorOrder: 'BGR',
  inputScale: 1,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  expectedOnnxPath: '/models/emotion/openvino-retail-0003.onnx',
  notes: [
    'This is the first baseline contract, not a claim that the model is best.',
    'The original OpenVINO model is commonly distributed as OpenVINO IR/Caffe-derived assets.',
    'For browser use, provide a converted or equivalent ONNX file at expectedOnnxPath.',
    'It has five labels only: neutral, happy, sad, surprise, anger.',
  ],
};
