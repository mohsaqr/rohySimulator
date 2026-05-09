export class PredictionSmoother {
  constructor(options = {}) {
    this.options = {
      alpha: 0.28,
      minSwitchConfidence: 0.5,
      minHoldMs: 3000,
      labels: [],
      ...options,
    };
    this.smoothed = null;
    this.visibleLabel = null;
    this.visibleSince = 0;
  }

  update(prediction, timestamp = Date.now()) {
    if (!prediction?.probabilities) return null;
    const labels = this.options.labels.length
      ? this.options.labels
      : Object.keys(prediction.probabilities);

    if (!this.smoothed) {
      this.smoothed = Object.fromEntries(labels.map(label => [label, prediction.probabilities[label] || 0]));
    } else {
      for (const label of labels) {
        const previous = this.smoothed[label] || 0;
        const next = prediction.probabilities[label] || 0;
        this.smoothed[label] = previous * (1 - this.options.alpha) + next * this.options.alpha;
      }
    }

    normalize(this.smoothed);
    const [candidateLabel, candidateConfidence] = topEntry(this.smoothed);
    const canSwitch = !this.visibleLabel
      || timestamp - this.visibleSince >= this.options.minHoldMs
      || candidateLabel === this.visibleLabel;

    if (canSwitch && candidateConfidence >= this.options.minSwitchConfidence) {
      if (candidateLabel !== this.visibleLabel) {
        this.visibleLabel = candidateLabel;
        this.visibleSince = timestamp;
      }
    }

    return {
      ...prediction,
      probabilities: { ...this.smoothed },
      visibleLabel: this.visibleLabel || candidateLabel,
      visibleConfidence: this.smoothed[this.visibleLabel || candidateLabel] || candidateConfidence,
      rawProbabilities: prediction.probabilities,
    };
  }

  reset() {
    this.smoothed = null;
    this.visibleLabel = null;
    this.visibleSince = 0;
  }
}

function topEntry(probabilities) {
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])[0] || [null, 0];
}

function normalize(probabilities) {
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (!sum) return;
  for (const label of Object.keys(probabilities)) {
    probabilities[label] /= sum;
  }
}
