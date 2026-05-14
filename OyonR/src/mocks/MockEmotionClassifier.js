const LABELS = ['neutral', 'happy', 'sad', 'surprise', 'anger'];

export class MockEmotionClassifier {
  constructor(options = {}) {
    this.options = {
      labels: LABELS,
      modelName: 'mock-fer',
      modelVersion: 'dev',
      ...options,
    };
    this.tick = 0;
  }

  async init() {}

  async classify() {
    this.tick += 1;
    const active = this.options.labels[this.tick % this.options.labels.length];
    const probabilities = Object.fromEntries(this.options.labels.map(label => [label, label === active ? 0.62 : 0.38 / (this.options.labels.length - 1)]));
    return {
      probabilities,
      confidence: probabilities[active],
      entropy: 1.5,
      valence: null,
      arousal: null,
      model: {
        name: this.options.modelName,
        version: this.options.modelVersion,
      },
    };
  }
}
