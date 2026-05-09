# FER Model Selection

Oyon defaults to HSEmotion EfficientNet-B0 MTL because it has the clearest published benchmark evidence among the bundled valence/arousal-capable profiles. EmotiEffLib MobileViT MTL and MobileFaceNet MTL remain bundled as alternatives.

## Recommended First Model Criteria

- ONNX export available or easy to export from PyTorch.
- Compact enough for browser use.
- Input size 112, 160, or 224 square RGB face crop.
- Outputs logits or probabilities for:
  - neutral
  - happy
  - sad
  - surprise
  - anger
  - fear
  - disgust
  - optional contempt
- License permits educational/research deployment.
- Model card or paper reports validation on AffectNet, RAF-DB, or equivalent.

## Selected Default

- **HSEmotion EfficientNet-B0 MTL**
- File: `standalone/models/emotion/enet_b0_8_va_mtl.onnx`
- Outputs eight expression logits plus valence and arousal.
- Input size: 224 square RGB/BGR-normalized face crop.

Alternatives:

- **EmotiEffLib MobileViT MTL**
- File: `standalone/models/emotion/mobilevit_va_mtl.onnx`
- Outputs eight expression logits plus valence and arousal.
- Input size: 224 square RGB/BGR-normalized face crop.

- **EmotiEffLib MobileFaceNet MTL**
- File: `standalone/models/emotion/mbf_va_mtl.onnx`
- Outputs eight expression logits plus valence and arousal.
- Input size: 112 square RGB-normalized face crop.

## Rejection Criteria

- Unknown license.
- Requires remote inference.
- Too large for reliable browser use.
- Outputs only a hard label with no probabilities.
- No documented training/validation data.
- No way to calibrate or evaluate subgroup performance.

## Expected Browser Asset Layout

```text
public/models/
  mediapipe/
    wasm/
    face_landmarker.task
  emotion/
    mobilevit_va_mtl.onnx
    manifest.json
```

Example `manifest.json`:

```json
{
  "modelName": "mobilevit_va_mtl",
  "modelVersion": "0.1.0",
  "runtime": "onnxruntime-web",
  "inputSize": 224,
  "labels": ["neutral", "happy", "sad", "surprise", "anger", "fear", "disgust"],
  "preprocessing": {
    "color": "RGB",
    "layout": "NCHW",
    "mean": [0.485, 0.456, 0.406],
    "std": [0.229, 0.224, 0.225]
  }
}
```
