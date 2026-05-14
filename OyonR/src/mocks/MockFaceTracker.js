export class MockFaceTracker {
  async init() {}

  async analyze() {
    return {
      facePresent: true,
      bbox: { x: 0.25, y: 0.15, width: 0.5, height: 0.65 },
      landmarks: [],
      blendshapes: {},
      quality: {
        faceAreaRatio: 0.32,
        mock: true,
      },
    };
  }
}
