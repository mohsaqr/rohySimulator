import { ONNX_RUNTIME_WASM_CDN, DEFAULT_EMOTION_MODEL_URL } from '../config/cdnDefaults.js';

const DEFAULT_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

export class OnnxEmotionClassifier {
  constructor(options = {}) {
    this.options = {
      modelUrl: DEFAULT_EMOTION_MODEL_URL,
      labels: DEFAULT_LABELS,
      inputSize: 224,
      inputName: 'input',
      outputName: null,
      inputScale: 1 / 255,
      inputChannels: 3,
      colorOrder: 'BGR',
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      emotionOffset: 0,
      valenceIndex: 8,
      arousalIndex: 9,
      wasmPaths: ONNX_RUNTIME_WASM_CDN,
      executionProviders: null,
      modelName: 'fer-onnx',
      modelVersion: 'unknown',
      ...options,
    };
    this.ort = null;
    this.session = null;
    this.canvas = null;
    this.ctx = null;
  }

  async init() {
    this.ort = await loadOrt();
    configureOrt(this.ort, this.options);
    this.session = await this.ort.InferenceSession.create(this.options.modelUrl, {
      executionProviders: executionProviders(this.options),
    });
    this.options.inputName ||= this.session.inputNames[0];
    this.options.outputName ||= this.session.outputNames[0];
  }

  async classify(video, face = {}) {
    if (!this.session) throw new Error('OnnxEmotionClassifier.init() must run first.');
    const input = this.preprocess(video, face.bbox);
    const feeds = { [this.options.inputName]: input };
    const outputs = await this.session.run(feeds);
    const output = outputs[this.options.outputName] || outputs[this.session.outputNames[0]];
    const raw = Array.from(output.data);
    const emotionScores = raw.slice(this.options.emotionOffset, this.options.emotionOffset + this.options.labels.length);
    const probabilities = toProbabilityObject(emotionScores, this.options.labels);
    const confidence = Math.max(...Object.values(probabilities));
    return {
      probabilities,
      confidence,
      entropy: entropy(Object.values(probabilities)),
      valence: Number.isInteger(this.options.valenceIndex) ? clamp(raw[this.options.valenceIndex], -1, 1) : null,
      arousal: Number.isInteger(this.options.arousalIndex) ? clamp(raw[this.options.arousalIndex], -1, 1) : null,
      model: {
        name: this.options.modelName,
        version: this.options.modelVersion,
      },
    };
  }

  preprocess(video, bbox) {
    const size = this.options.inputSize;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = size;
      this.canvas.height = size;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    const crop = cropFromBbox(video, bbox);
    this.ctx.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
    const image = this.ctx.getImageData(0, 0, size, size).data;
    const channelCount = this.options.inputChannels;
    const chw = new Float32Array(channelCount * size * size);

    for (let i = 0, p = 0; i < image.length; i += 4, p += 1) {
      const r = image[i] * this.options.inputScale;
      const g = image[i + 1] * this.options.inputScale;
      const b = image[i + 2] * this.options.inputScale;
      if (channelCount === 1) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        chw[p] = (gray - this.options.mean[0]) / this.options.std[0];
        continue;
      }
      const channels = this.options.colorOrder === 'BGR' ? [b, g, r] : [r, g, b];
      chw[p] = (channels[0] - this.options.mean[0]) / this.options.std[0];
      chw[size * size + p] = (channels[1] - this.options.mean[1]) / this.options.std[1];
      chw[2 * size * size + p] = (channels[2] - this.options.mean[2]) / this.options.std[2];
    }

    return new this.ort.Tensor('float32', chw, [1, channelCount, size, size]);
  }
}

async function loadOrt() {
  try {
    return await import('onnxruntime-web/webgpu');
  } catch {
    return await import('onnxruntime-web');
  }
}

function configureOrt(ort, options) {
  if (ort?.env?.wasm) {
    ort.env.wasm.wasmPaths = resolveWasmPaths(ort, options.wasmPaths);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }
}

// If the configured WASM URL is the default jsDelivr pin, substitute the
// version against whatever onnxruntime-web is actually loaded — the WASM
// file names diverge across ORT minors (1.20.x: only jsep; 1.21+: also
// asyncify) and a hardcoded pin drifts out of sync with package.json's
// `^1.20.0` peer-dep range as ORT publishes new versions.
//
// Self-hosted, local `/public`, or custom URLs are returned unchanged.
export function resolveWasmPaths(ort, configuredPath) {
  if (!configuredPath || typeof configuredPath !== 'string') return configuredPath;
  const jsdelivrMatch = /(onnxruntime-web@)([0-9][0-9A-Za-z.\-+]*)(\/dist\/)/.exec(configuredPath);
  if (!jsdelivrMatch) return configuredPath;
  const runtimeVersion =
    ort?.env?.versions?.web ||
    ort?.env?.versions?.common ||
    null;
  if (!runtimeVersion || runtimeVersion === jsdelivrMatch[2]) return configuredPath;
  return configuredPath.replace(jsdelivrMatch[0], `${jsdelivrMatch[1]}${runtimeVersion}${jsdelivrMatch[3]}`);
}

function executionProviders(options) {
  if (Array.isArray(options.executionProviders)) return options.executionProviders;
  return ['wasm'];
}

function cropFromBbox(video, bbox) {
  const width = video.videoWidth || video.width;
  const height = video.videoHeight || video.height;
  const normalized = bbox || { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
  const centerX = (normalized.x + normalized.width / 2) * width;
  const centerY = (normalized.y + normalized.height / 2) * height;
  const size = Math.min(Math.max(normalized.width * width, normalized.height * height) * 1.35, Math.min(width, height));
  return {
    x: clamp(centerX - size / 2, 0, width - size),
    y: clamp(centerY - size / 2, 0, height - size),
    size,
  };
}

function toProbabilityObject(values, labels) {
  const raw = Array.from(values).slice(0, labels.length);
  const probs = looksLikeProbability(raw) ? raw : softmax(raw);
  return Object.fromEntries(labels.map((label, index) => [label, probs[index] || 0]));
}

function looksLikeProbability(values) {
  const sum = values.reduce((a, b) => a + b, 0);
  return values.every(v => v >= 0 && v <= 1) && sum > 0.98 && sum < 1.02;
}

function softmax(values) {
  const max = Math.max(...values);
  const exp = values.map(v => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  return exp.map(v => v / sum);
}

function entropy(values) {
  return values.reduce((sum, value) => {
    if (!value) return sum;
    return sum - value * Math.log2(value);
  }, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
