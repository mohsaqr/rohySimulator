# Oyon

Local facial-expression analytics for browser-based learning simulations.

Oyon runs the camera, face detection (MediaPipe), and expression
classification (ONNX Runtime Web) **inside the user's browser**. Only
aggregate signals — dominant expression, valence/arousal, confidence —
leave the device every few seconds. **No video, image, or audio is
ever stored.**

Oyon also owns its standalone settings, structured runtime logs, numeric
metrics, aggregate analytics windows, and DynaJ-ready derived features.
Host applications such as Rohy provide identity/context and persistence
endpoints through a thin adapter.

It can run **standalone** (a self-contained demo page) or **attach to a
host app** (such as a virtual-patient simulator) through a small
adapter, without the host having to know anything about MediaPipe,
ONNX, or camera lifecycle.

---

## Why this exists

Education and clinical-simulation research increasingly wants to look
at *visible affective signals* alongside learner activity. Off-the-shelf
"emotion recognition" services either send raw video to the cloud or
ship overconfident labels with no uncertainty. Oyon is the opposite:

- **Local-only inference.** Frames never leave the browser.
- **Aggregate over time, not per-frame.** Dense per-frame labels are
  noise; 5–10 second windows are research-usable.
- **Uncertainty-first UI.** "Possible frustration signal," not "the
  student is frustrated."
- **Opt-in per session, revocable any time.** Camera turns on only
  after explicit consent, and a single click stops it.
- **EU AI Act Art. 5 conscious.** Read [`docs/INTEGRATION_PLAN.md`][plan]
  before deploying in education contexts; this is a research/medical
  simulation tool, not a grading aid.

[plan]: docs/INTEGRATION_PLAN.md

## What it gives you

| Output | Where |
|---|---|
| Live face box + landmarks | Browser canvas overlay |
| Eye-tracking engagement signals (opt-in) | UI + telemetry |
| Dominant expression label + confidence | UI + telemetry |
| 8 expression class probabilities | UI + telemetry |
| Valence (negative ↔ positive) and Arousal (calm ↔ activated) | UI + telemetry |
| 5–10 second aggregate windows | Sent to a host backend or saved locally |
| 60-second rolling timeline | UI — valence + arousal as two trace lines |

B0 MTL is the default emotion model because it has the strongest published benchmark evidence among the bundled valence/arousal-capable profiles. Alternatives are also bundled for comparison, loaded through ONNX Runtime Web:

- **HSEmotion EfficientNet-B0 MTL** — default, 8 expressions + valence/arousal.
- **EmotiEffLib MobileViT** — 8 expressions + valence/arousal.
- **EmotiEffLib MobileFaceNet MTL** — experimental alternative with the same output contract.

See [`docs/MODEL_SELECTION.md`](docs/MODEL_SELECTION.md) for the
trade-offs and licensing of the bundled weights.

## Where it runs

Oyon is plug-and-attach **inside one envelope**: a browser front-end that
can open a camera over a secure context. Confirm the fit before integrating:

- **Runs in:** any browser UI — vanilla, React, Next.js (client-only),
  Vue/Svelte/Angular, static sites, Tauri/Electron. Desktop + mobile
  (Chrome 90+, Safari 14+, Firefox 90+).
- **Requires:** HTTPS or `localhost` (LAN IPs fail), a camera + user gesture,
  and `'wasm-unsafe-eval'` in the page CSP. Two required peer deps
  (`@mediapipe/tasks-vision`, `onnxruntime-web`); React is optional.
- **Out of scope by construction:** Node/SSR execution, plain-HTTP or LAN-IP
  production, multiple capture surfaces per page, and proprietary bundles
  that select the GPL WebGazer engine (the default `mediapipe` engine is
  permissive).

Full support matrix, browser table, licensing, and a pre-integration
checklist: **[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)**.

## Three ways to use it

### 0. Embedded — the whole app in one tag

The full Oyon Research Instrument (capture + every analytics dashboard,
filterable by session/user) drops into any page as a web component:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/oyon@2/standalone/app/dist-element/oyon-app.element.js"></script>
<oyon-app user-id="student-42" style="height:100vh"></oyon-app>
```

Local-first (IndexedDB), optional backend sync, shadow-DOM isolated.
See [`docs/EMBEDDING.md`](docs/EMBEDDING.md).

### 1. Standalone

A complete browser demo with camera, settings drawer,
affect circumplex, and a 60-second timeline. Best for piloting or
demo'ing the system without integrating into anything.

```bash
git clone https://github.com/mohsaqr/Oyon.git
cd Oyon
npm install
npm start
# open http://127.0.0.1:5173/standalone/
```

See [`docs/STANDALONE.md`](docs/STANDALONE.md) for screenshots and the
settings reference.

### 2. Attached to a host app

Oyon exposes a small adapter (`oyon/adapter`), a React hook
(`oyon/react`), and a payload validator (`oyon/validation`).
A host app — Rohy is the original target, but anything that has a
session/user/case context will fit — wires Oyon in with **two new
lines** in existing source plus one new component and one new
backend route.

**→ The complete step-by-step guide for adding Oyon to an existing
system — every integration mode, and routing the analytics into your
existing database or a separate one — is
[`docs/INTEGRATION_MANUAL.md`](docs/INTEGRATION_MANUAL.md).** If you
use Claude Code, the repo ships an agent skill that performs the
integration for you: [`.claude/skills/integrate-oyon/`](.claude/skills/integrate-oyon/SKILL.md).

A clickable mockup of how the integration looks visually is in
[`mock/rohy-integration.html`](mock/rohy-integration.html) —
open it in any browser, no server needed.

Quickstart:

```jsx
import { useRohyFer } from 'oyon/react';

function OyonMount() {
  const fer = useRohyFer({
    enabled: true,
    apiBaseUrl: '/api',
    getToken: () => localStorage.getItem('token'),
    getSession: () => ({
      sessionId: currentSession.id,
      userId: user.id,
      caseId: currentSession.case_id,
      tenantId: user.tenant_id,
    }),
  });
  return <YourPillOrChip status={fer.status}
                         onStart={fer.start}
                         onPause={fer.pause}
                         onStop={fer.stop} />;
}
```

See [`INSTALL.md`](INSTALL.md) for the full integration walkthrough.

## Documentation

All canonical reference docs live in [`docs/`](docs/) — start at the
**[documentation index](docs/README.md)**, which maps every doc by goal and
marks canonical vs. historical.

### Reference (current)

| Topic | Doc |
|---|---|
| **Documentation index** — every doc mapped by goal | [`docs/README.md`](docs/README.md) |
| **Compatibility & requirements** — supported/unsupported systems, browsers, CSP, licensing, checklist | [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) |
| **Integration manual** — add Oyon to an existing system, analytics into your DB or a separate one | [`docs/INTEGRATION_MANUAL.md`](docs/INTEGRATION_MANUAL.md) |
| Install + linkage strategies (workspace, git, npm, CDN) | [`INSTALL.md`](INSTALL.md) |
| Runtime asset model (CDN vs self-hosted, CLI, `assets-v1` release) | [`docs/ASSETS.md`](docs/ASSETS.md) |
| Production deployment (HTTPS, CSP, caching, monitoring, rollback) | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Integration recipes for any host (vanilla, React, Next.js, Vite, addon, CDN) | [`docs/INTEGRATION.md`](docs/INTEGRATION.md) |
| **Rohy integration contract** (canonical — schema, routes, logging, governance, production lessons) | [`docs/ROHY_INTEGRATION.md`](docs/ROHY_INTEGRATION.md) |
| Architecture & module layout | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Eye tracking design + engagement metric definitions | [`docs/EYE_TRACKING.md`](docs/EYE_TRACKING.md) |
| Standalone demo internals | [`docs/STANDALONE.md`](docs/STANDALONE.md) |
| Model selection rationale | [`docs/MODEL_SELECTION.md`](docs/MODEL_SELECTION.md) |
| Platform design overview | [`docs/PLATFORM_DESIGN.md`](docs/PLATFORM_DESIGN.md) |
| Design overview | [`docs/DESIGN_OVERVIEW.md`](docs/DESIGN_OVERVIEW.md) |
| Embedding the full app (`<oyon-app>`) | [`docs/EMBEDDING.md`](docs/EMBEDDING.md) |
| Testing strategy (unit chain, gates, browser E2E) | [`docs/TESTING.md`](docs/TESTING.md) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |

### Historical (preserved for context)

| Doc | Why kept |
|---|---|
| [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) | Original 5-phase rollout plan + four-surfaces logging table (referenced from ROHY_INTEGRATION.md) |
| [`docs/ROHY_ADDON_FALLBACK_PLAN.md`](docs/ROHY_ADDON_FALLBACK_PLAN.md) | Original stability contract + add-on slot model framing |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Pipeline-level plan from v0.1.0 |
| [`HANDOFF.md`](HANDOFF.md) | Current session handoff snapshot |
| [`bkp/2026-05-15/docs-HANDOFF-2026-05-08.md`](bkp/2026-05-15/docs-HANDOFF-2026-05-08.md) | Older handoff snapshot preserved for context |

## Architecture in one diagram

```
   Camera
     │
     ▼
  MediaPipe Face Landmarker  ◀── face crop, landmarks, quality
     │
     ▼
  ONNX Runtime Web (WASM, optional WebGPU)  ◀── EmotiEffLib MobileViT
     │
     ▼
  PredictionSmoother  (EWMA, hold-time, switch threshold)
     │
     ▼
  EmotionAggregator   (5–10 s window, valid-frame guard, missing ratio)
     │
     ├──── LocalEmotionTransport  → localStorage (standalone)
     └──── HttpEmotionTransport   → POST /api/sessions/:id/emotions/batch (attached)
```

The boxes are independent classes in `src/`. Swap any one of them
(e.g., switch to a different ONNX model, or replace the transport
with a websocket) without touching the rest.

## Privacy & governance

Oyon is built around four hard rules:

1. **No raw frames stored.** Validators on both ends (`src/validation/`
   and the example backend route) reject any payload containing
   `frame*`, `image*`, `video*`, `pixels`, `landmarks`, `blob`, or
   `base64`.
2. **No emotion labels shown to the learner during the case** by default.
3. **No grading or automated decisions** from Oyon outputs.
4. **Per-session opt-in, one-click stop, camera light follows actual capture.**

Read the [governance section of the integration
plan](docs/INTEGRATION_PLAN.md#10-governance-summary) before deploying.
See [`docs/PLATFORM_DESIGN.md`](docs/PLATFORM_DESIGN.md) for the
standalone logging, settings, storage, and analytics architecture.

## Status

Pre-alpha. The standalone demo is stable; the host integration is
specified and templated but not yet pulled into a host app. See
[`HANDOFF.md`](HANDOFF.md) for the latest work-state.

## License

MIT — see [`LICENSE`](LICENSE).

Bundled third-party model weights are distributed under their own
licenses. See [`NOTICE.md`](NOTICE.md).
