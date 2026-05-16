# Oyon &amp; EU AI Act

Oyon is the vendored, **browser-only** facial-expression analytics add-on
mounted at `/api/addons/oyon/*`. This page states its privacy and EU AI Act
posture. It describes what the system is designed and built to do; it is
**not** a legal opinion or a compliance certification.

## Browser-only inference

All camera capture, face detection (MediaPipe), and expression
classification (ONNX Runtime Web) run **inside the user's browser**. The
pipeline is: Camera → MediaPipe Face Landmarker → ONNX Runtime Web →
PredictionSmoother → EmotionAggregator. Raw frames, images, audio, and
landmarks are processed locally and **never stored**.

## Only aggregated windows leave the device

What leaves the browser is an **aggregate window** computed over a 5–10
second span (Rohy stamps these as ~10-second windows): a dominant
expression label, class probabilities, valence/arousal, confidence,
entropy, a valid-frame count, a missing-face ratio, and quality metadata.
No per-frame data, no images, no landmark or blendshape arrays.

The server **hard-rejects raw frames**. The server-side validation
contract rejects the **entire batch** with a **400** if any payload
contains a forbidden field — `frame*`, `image*`, `video*`, `pixels`,
`landmarks`, `blob`, or `base64`. The batch is not silently stripped: the
problem is surfaced. The server additionally enforces a per-request event
cap, a per-event byte cap, timestamp bounds tied to the session, and that
`tenant_id` / `session_id` / `user_id` come from the authenticated context
— body-supplied identity values are ignored, never trusted. Validators run
**on both ends**: the browser also defensively validates before any network
call.

::: tip
`scripts/tech-test.sh` can be **armed** with credentials so every deploy
POSTs a deliberately malformed emotion batch and asserts the server returns
`400` with the expected error. This catches "label-set drift" — when client
and server disagree about valid emotions or the validator's tolerance is
silently relaxed. See the [Hardening checklist](/security/hardening) for the
arming steps.
:::

## Consent model

Capture is **opt-in per session and revocable at any time**:

- The feature is **off by default per tenant**; opt-in per user.
- The camera is requested **only after explicit consent** for the active
  session; a single click stops it, and the camera indicator follows
  actual capture.
- Consent grant and revocation are recorded per session and written to the
  [audit chain](/security/audit-chain) (`oyon.consent_granted`,
  `oyon.consent_revoked`) so the existence — and withdrawal — of consent
  is provable and tamper-evident.
- Emotion data is retained per tenant and physically purged by the
  retention sweep (see [Data retention](/security/retention)).

## EU AI Act Article 5 posture

EU AI Act Art. 5 restricts emotion inference in educational contexts,
subject to a medical/safety exception. Rohy's posture, per the Oyon
integration plan's governance summary:

- Rohy is positioned specifically as a **clinical / medical-education
  simulator**. Whether that scope falls inside the medical exception is a
  question for the deploying organization's legal/ethics review — this
  documentation does **not** assert that it does.
- **No emotion labels are shown to the learner during the case** by
  default.
- **No grading, ranking, or progression decisions** are derived from Oyon
  outputs — no automated decision-making.
- Educators see the data only for **post-hoc reflection**, with the
  uncertainty-first language built into the UI ("possible frustration
  signal", not "the student is frustrated").
- The feature stays **off by default per tenant**, opt-in per user, with
  consent recorded per session.

::: warning
Before enabling Oyon in any education or clinical-simulation deployment,
the deploying organization must obtain its own legal/ethics sign-off on EU
AI Act Art. 5 applicability for its jurisdiction and use. The technical
controls above support a defensible posture; they do not constitute legal
compliance, and Rohy makes no certification claim. Do not use Oyon outputs
for grading or any automated decision about a learner.
:::

To disable Oyon entirely, set `OYON_ENABLED=0`
([config reference](/reference/config/)); the Oyon routes return a
structured 503 stub instead of a live router, and the Settings tab shows a
disabled panel.
