# Third-party notices

Oyon's source code is released under the **Carm Research License v1.4** —
the full text is embedded at [`LICENSE`](LICENSE), synced from the canonical
[mohsaqr/carm-license](https://github.com/mohsaqr/carm-license) repository.

That license requires third-party notices to travel with every copy of the
Software, and the canonical repository states plainly that *"redistributed
copies of Carm must include the licence text itself, not only a link."*
Accordingly, **every license below is embedded in full under
[`licenses/`](licenses/)** — not merely linked — and is refreshed from its
canonical upstream source by `npm run license:sync` on every build.

**Embedded text and live link are complementary, not alternatives.** The
embedded copy is what *this artifact* is licensed under, frozen at build time
so the shipped terms cannot change under you. The "latest" link is where that
license lives *now*, so a reader can always reach the current version even
when this copy is a release or two behind. Both are given for every component.

## Complete license index

| Component | License | Embedded text (this artifact) | Latest upstream | How it reaches a user |
|---|---|---|---|---|
| Oyon itself | Carm Research License v1.4 | [`LICENSE`](LICENSE) | [always current](https://raw.githubusercontent.com/mohsaqr/carm-license/main/LICENSE.txt) · [repo](https://github.com/mohsaqr/carm-license) | the package |
| Carm ecosystem notices | (various) | [`licenses/carm-ecosystem-third-party-notices.txt`](licenses/carm-ecosystem-third-party-notices.txt) | [always current](https://raw.githubusercontent.com/mohsaqr/carm-license/main/THIRD-PARTY-NOTICES.txt) | carried per the license's third-party clause |
| ONNX Runtime Web 1.25.1 | MIT | [`licenses/onnxruntime-web.LICENSE.txt`](licenses/onnxruntime-web.LICENSE.txt) | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) | peer dependency; WASM also ships in `standalone/app/dist-element` |
| `@mediapipe/tasks-vision` 0.10.35 | Apache-2.0 | [`licenses/mediapipe.LICENSE.txt`](licenses/mediapipe.LICENSE.txt) | [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) | peer dependency; WASM + `face_landmarker.task` fetched at runtime |
| Silero VAD v5.1.2 | MIT | [`licenses/silero-vad.LICENSE.txt`](licenses/silero-vad.LICENSE.txt) | [snakers4/silero-vad](https://github.com/snakers4/silero-vad/blob/master/LICENSE) | ONNX weights downloaded at runtime |
| WebGazer.js 3.5.3 | **GPL-3.0-or-later** | [`licenses/webgazer.LICENSE.txt`](licenses/webgazer.LICENSE.txt) + [`licenses/GPL-3.0-or-later.txt`](licenses/GPL-3.0-or-later.txt) | [brownhci/WebGazer](https://github.com/brownhci/WebGazer/blob/master/LICENSE.md) · [gnu.org GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.txt) | optional peer dependency (opt-in engine; default is `mediapipe`) — see the note below |
| WebEyeTrack 0.0.2 | MIT | [`licenses/webeyetrack.LICENSE.txt`](licenses/webeyetrack.LICENSE.txt) | [RedForestAi/WebEyeTrack](https://github.com/RedForestAi/WebEyeTrack) | vendored byte-for-byte into `vendor/webeyetrack.js`, shipped in the package |
| EmotiEffLib weights | Apache-2.0 | [`licenses/emotiefflib.LICENSE.txt`](licenses/emotiefflib.LICENSE.txt) | [sb-ai-lab/EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib/blob/main/LICENSE) | ONNX weights downloaded at runtime |
| HSEmotion weights | Apache-2.0 | [`licenses/hsemotion.LICENSE.txt`](licenses/hsemotion.LICENSE.txt) | [HSE-asavchenko/hsemotion-onnx](https://github.com/HSE-asavchenko/hsemotion-onnx/blob/main/LICENSE) | ONNX weights downloaded at runtime |

### First-party vendored code

| Component | License | Vendored at |
|---|---|---|
| ladyna 1.8.13 | Carm Research License v1.4 — covered by [`LICENSE`](LICENSE) | `standalone/vendor/ladyna` |

`ladyna` is Carm ecosystem code (the built dist of
[tnaj / ladyna](https://github.com/mohsaqr/tna-js)), so it carries **no separate
license file**: the Carm Research License at [`LICENSE`](LICENSE) applies to
"Carm and all associated products, libraries, tools, and components in the
Carm ecosystem", which includes it. A second copy of identical terms beside
the first would be a copy to keep in sync, not an additional grant.

It is listed rather than omitted because a reader needs to know what is
vendored, and because "no separate license" should be a recorded decision
rather than an absence that looks like an oversight — `ladyna` (then
named `dynajs`) was in fact
missing from this file entirely until 2026-07-26.

`scripts/licenses.manifest.mjs` is the single source of truth for this table.
Adding a bundled component means adding a row there; `npm run license:verify`
fails if a manifest entry is missing its embedded text or its link here, so a
new dependency cannot ship without a notice.

## Model weights (under `standalone/models/emotion/`)

| File | Source | Upstream license |
|---|---|---|
| `mobilevit_va_mtl.onnx` | [sb-ai-lab / EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Apache-2.0 |
| `mbf_va_mtl.onnx` | [sb-ai-lab / EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Apache-2.0 |
| `enet_b0_8_va_mtl.onnx` | [HSEmotion](https://github.com/HSE-asavchenko/hsemotion-onnx) | Apache-2.0 |

Both upstream projects state their position explicitly. EmotiEffLib: *"The
code of EmotiEffLib is released under the Apache-2.0 License. There is no
limitation for both academic and commercial usage."* HSEmotion states the
same for HSEmotionONNX. Note that both sentences speak of the **code**; the
weights are distributed from those repositories under the same Apache-2.0
terms, with no separate model license published as of 2026-07-26.

This replaces an earlier, more cautious note in this file that recorded these
as "Per upstream — verify before redistribution". They have now been verified,
and the Apache-2.0 texts are embedded above.

## Voice activity detection model (under `standalone/models/vad/`)

| File | Source | Upstream license |
|---|---|---|
| `silero_vad.onnx` | [snakers4 / silero-vad](https://github.com/snakers4/silero-vad), tag `v5.1.2` | MIT (verified against the `LICENSE` file at tag `v5.1.2`) |

Fetched by `scripts/download-models.sh` and `npx oyon download-models`
(into `<public>/oyon/models/vad/silero_vad.onnx`); pinned by tag, version,
and URL in `src/config/cdnDefaults.js` (`SILERO_VAD_MODEL_URL`,
`SILERO_VAD_MODEL_VERSION`). The pinned v5.1.2 artifact (2,327,524 bytes)
has SHA-256
`2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`
(computed 2026-07-25 from the pinned upstream URL); the
`SILERO_VAD_MODEL_SHA256` constant in `cdnDefaults.js` remains a
placeholder until the asset is mirrored into the `assets-v1` release and
hashed there. The MIT text is already embedded at
[`licenses/silero-vad.LICENSE.txt`](licenses/silero-vad.LICENSE.txt) and must
accompany the asset when it joins that release.

## Face landmark model

| File | Source | Upstream license |
|---|---|---|
| `standalone/models/mediapipe/face_landmarker.task` | [Google MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Apache 2.0 (per MediaPipe) |

## Runtime libraries (under `standalone/vendor/`)

| Path | Source | License |
|---|---|---|
| `vendor/mediapipe/wasm/*` | `@mediapipe/tasks-vision` | Apache 2.0 |
| `vendor/onnxruntime-web/*` | `onnxruntime-web` | MIT |
| `vendor/webgazer/face_mesh/*` | WebGazer-vendored FaceMesh assets | Apache 2.0 (FaceMesh) |
| `vendor/ladyna/*` | first-party, the built dist of [tnaj / ladyna](https://github.com/mohsaqr/tna-js) | Carm Research License v1.4 (see `LICENSE`) |

These are consumed at runtime by the standalone demo. The `peerDependencies`
entry in `package.json` lists the npm-installable equivalents for
attached-mode integration.

## Gaze engines (runtime distribution)

| Package | License | Notes |
|---|---|---|
| `webeyetrack@0.0.2` | MIT; bundled third-party notices are shipped in [`licenses/webeyetrack.LICENSE.txt`](licenses/webeyetrack.LICENSE.txt) | Optional gaze engine. Oyon vendors the reviewed upstream runtime bundle byte-for-byte and does not install its unused package dependency graph in production. |
| `webgazer@^3.5.3` | **GPL-3.0-or-later** | Opt-in engine — the default is `mediapipe`. Optional peer dependency, so it is not installed unless you ask for it. Its copyleft license has redistribution implications. See note below. |

### WebGazer license note for integrators

WebGazer.js is GPL-3.0-or-later. When you select the `webgazer` gaze
engine and ship Oyon as part of a host application, WebGazer's code
becomes part of the deployed bundle, and GPL-3.0-or-later obligations
attach to *that bundle* — typically: distribute source on request,
preserve the license notice, and ensure derivatives remain compatible.

WebGazer's own `LICENSE.md` is the GPL *notice* rather than the license: it
ends with "You should have received a copy of the GNU General Public License
along with this program." Shipping only that notice would leave the sentence
false, so the **full GPL-3.0 text is embedded** at
[`licenses/GPL-3.0-or-later.txt`](licenses/GPL-3.0-or-later.txt) alongside
the notice that elects it.

This does **not** change Oyon's own Carm Research License terms, nor does
it affect the default WebEyeTrack path. It does affect any combined
work that statically links WebGazer.

If your host application is itself proprietary or under a copyleft-
incompatible license, prefer the WebEyeTrack engine, or load WebGazer at
runtime from a separate page/iframe context with its own license disclosure.
We document the trade-off here rather than hide WebGazer behind an optional
install, because WebGazer's accuracy is a deliberate user-facing choice and
we want it to be easy to pick.

## Keeping this file honest

```bash
npm run license:sync     # refresh every embedded text from its canonical source
npm run license:verify   # fail if any text drifted, or is missing a notice here
npm run license:latest   # report whether a newer Carm License version exists
```

`license:sync` runs as part of `npm run build`; the strict form runs in
`prepublishOnly`, where a drift is an error rather than a silent rewrite — a
release must never alter the terms it publishes without a human reviewing the
diff first.

## Reporting issues

If you believe a bundled artifact's license is misrepresented above,
open a GitHub issue and we will correct it promptly.
