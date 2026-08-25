/**
 * The single source of truth for every licence Oyon redistributes.
 *
 * `sync-licenses.mjs` fetches each entry into `licenses/`;
 * `verify-licenses.mjs` asserts the embedded copies still match upstream AND
 * that `NOTICE.md` links every one of them. Adding a component means adding a
 * row here — nothing else discovers licences by scanning, precisely so a new
 * bundled dependency cannot slip in without a notice.
 *
 * ---- why the Carm licence is pinned to a TAG, not `main` ----
 *
 * The canonical repo publishes both `.../main/LICENSE.txt` ("always current")
 * and `.../v1.4/LICENSE.txt` (immutable). Syncing from `main` would mean a
 * routine `npm run build` could silently relicense the product the day a v1.5
 * lands — the build would succeed, the diff would be invisible in review, and
 * the shipped terms would have changed without anyone deciding to change them.
 *
 * Pinning to the tag keeps the fetch genuinely live (the bytes always come
 * from the canonical source, never a hand-edited local copy) while making a
 * version change a deliberate one-line edit here. `check-license-version.mjs`
 * reports when a newer version exists so the pin cannot rot unnoticed.
 *
 * Upstream projects that publish no per-version licence tag are pinned to
 * their default branch; their licence text is stable and any change is caught
 * by `verify-licenses.mjs` rather than absorbed silently.
 */

/** The Carm Research License version Oyon ships. Bump deliberately. */
export const CARM_LICENSE_VERSION = '1.4';

const CARM_REPO = 'https://raw.githubusercontent.com/mohsaqr/carm-license';

/**
 * The canonical licence, embedded at the repository root as `LICENSE`.
 *
 * `url` is PINNED to the version tag — that is what gets embedded at build
 * time, so the shipped terms never change without a deliberate edit.
 * `latest` is the always-current pointer, published alongside it so a reader
 * can always reach the newest version even when this copy is a release or two
 * behind. Embedded copy and live link are complementary, not alternatives:
 * the embedded text is what this artifact is licensed under, the link is where
 * the licence lives now.
 */
export const CARM_LICENSE = {
  id: 'carm-research-license',
  name: `Carm Research License v${CARM_LICENSE_VERSION}`,
  spdx: 'LicenseRef-Carm-Research-License',
  url: `${CARM_REPO}/v${CARM_LICENSE_VERSION}/LICENSE.txt`,
  latest: `${CARM_REPO}/main/LICENSE.txt`,
  path: 'LICENSE',
  source: 'https://github.com/mohsaqr/carm-license',
};

/**
 * The Carm ecosystem's own third-party notices. Carried because the licence
 * requires third-party notices to travel with every copy; it currently covers
 * ecosystem components (D3, linkedom, resvg) rather than Oyon's own, which is
 * why `THIRD_PARTY` below exists separately.
 */
export const CARM_THIRD_PARTY_NOTICES = {
  id: 'carm-ecosystem-notices',
  name: 'Carm ecosystem third-party notices',
  spdx: null,
  url: `${CARM_REPO}/main/THIRD-PARTY-NOTICES.txt`,
  path: 'licenses/carm-ecosystem-third-party-notices.txt',
  source: 'https://github.com/mohsaqr/carm-license',
};

/**
 * Every third-party component Oyon ships in its package, vendors into the
 * repository, or downloads onto a host at runtime. `runtime` records HOW the
 * component reaches a user, because that is what decides whether a licence
 * obligation attaches to the npm tarball, the host's bundle, or both.
 */
export const THIRD_PARTY = [
  {
    id: 'onnxruntime-web',
    name: 'ONNX Runtime Web',
    spdx: 'MIT',
    version: '1.25.1',
    url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE',
    path: 'licenses/onnxruntime-web.LICENSE.txt',
    source: 'https://github.com/microsoft/onnxruntime',
    runtime: 'peer dependency; WASM binaries also ship inside standalone/app/dist-element',
  },
  {
    id: 'mediapipe-tasks-vision',
    name: '@mediapipe/tasks-vision (incl. the vendored FaceMesh assets)',
    spdx: 'Apache-2.0',
    version: '0.10.35',
    url: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE',
    path: 'licenses/mediapipe.LICENSE.txt',
    source: 'https://github.com/google-ai-edge/mediapipe',
    runtime: 'peer dependency; WASM + the face_landmarker task file are fetched at runtime',
  },
  {
    id: 'silero-vad',
    name: 'Silero VAD (model weights)',
    spdx: 'MIT',
    version: 'v5.1.2',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/LICENSE',
    path: 'licenses/silero-vad.LICENSE.txt',
    source: 'https://github.com/snakers4/silero-vad',
    runtime: 'ONNX weights downloaded at runtime by `npx oyon download-models`',
  },
  {
    id: 'webgazer',
    name: 'WebGazer.js — copyright notice',
    spdx: 'GPL-3.0-or-later',
    version: '3.5.3',
    // WebGazer's own LICENSE.md is the GPL "how to apply" NOTICE, not the
    // licence: 717 bytes ending in "You should have received a copy of the
    // GNU General Public License along with this program." Shipping only
    // this would leave that sentence false. The notice carries the copyright
    // holder and the version elected ("3 or, at your option, any later"), so
    // it is kept — and `gpl-3.0` below supplies the text it points at.
    url: 'https://raw.githubusercontent.com/brownhci/WebGazer/master/LICENSE.md',
    path: 'licenses/webgazer.LICENSE.txt',
    source: 'https://github.com/brownhci/WebGazer',
    runtime: 'production dependency — DEFAULT gaze engine; copyleft, see NOTICE.md',
    requires: 'gpl-3.0',
  },
  {
    id: 'gpl-3.0',
    name: 'GNU General Public License v3.0 (full text, for WebGazer)',
    spdx: 'GPL-3.0-or-later',
    version: '3',
    // gnu.org is not reliably reachable from every build environment, so the
    // text comes from the SPDX license-list-data repository — the same
    // canonical wording, on infrastructure the rest of this manifest already
    // depends on.
    url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-or-later.txt',
    path: 'licenses/GPL-3.0-or-later.txt',
    source: 'https://www.gnu.org/licenses/gpl-3.0.txt',
    runtime: 'the licence text WebGazer\'s notice requires to accompany the program',
  },
  {
    id: 'webeyetrack',
    name: 'WebEyeTrack',
    spdx: 'MIT',
    version: '0.0.2',
    url: null,
    localSource: 'vendor/webeyetrack.LICENSE.txt',
    path: 'licenses/webeyetrack.LICENSE.txt',
    source: 'https://github.com/RedForestAi/WebEyeTrack',
    runtime: 'vendored byte-for-byte into vendor/webeyetrack.js and shipped in the package',
  },
  {
    id: 'emotiefflib',
    name: 'EmotiEffLib (mobilevit_va_mtl / mbf_va_mtl weights)',
    spdx: 'Apache-2.0',
    version: null,
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/LICENSE',
    path: 'licenses/emotiefflib.LICENSE.txt',
    source: 'https://github.com/sb-ai-lab/EmotiEffLib',
    runtime: 'ONNX weights downloaded at runtime',
  },
  {
    id: 'hsemotion',
    name: 'HSEmotion (enet_b0_8_va_mtl weights)',
    spdx: 'Apache-2.0',
    version: null,
    url: 'https://raw.githubusercontent.com/HSE-asavchenko/hsemotion-onnx/main/LICENSE',
    path: 'licenses/hsemotion.LICENSE.txt',
    source: 'https://github.com/HSE-asavchenko/hsemotion-onnx',
    runtime: 'ONNX weights downloaded at runtime',
  },
];

/**
 * First-party code VENDORED into this repository. These carry no separate
 * licence file, because the Carm Research License at `LICENSE` already applies
 * to "Carm and all associated products, libraries, tools, and components in
 * the Carm ecosystem" — a second copy of the same terms beside the first would
 * be a copy to keep in sync, not an additional grant.
 *
 * They are listed rather than omitted because a reader needs to know what is
 * vendored, and because "no separate licence" must be a recorded, verifiable
 * decision rather than an absence that looks like an oversight. `ladyna` (formerly `dynajs`) was
 * genuinely missing from NOTICE.md before this file existed.
 */
export const FIRST_PARTY_VENDORED = [
  {
    id: 'ladyna',
    name: 'ladyna 1.8.13',
    version: '1.8.13',
    source: 'https://github.com/mohsaqr/ladyna',
    vendoredAt: 'standalone/vendor/ladyna',
    note: 'The tnaj/ladyna engine dist; Carm ecosystem, covered by LICENSE.',
  },
];

/** Every entry the sync writes and the verifier checks. */
export const ALL_ENTRIES = [CARM_LICENSE, CARM_THIRD_PARTY_NOTICES, ...THIRD_PARTY];
