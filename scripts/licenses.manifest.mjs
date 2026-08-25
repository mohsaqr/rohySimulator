/**
 * The single source of truth for every licence rohy redistributes.
 *
 * `sync-licenses.mjs` fetches each entry into `licenses/`;
 * `tests/server/license-contract.test.js` asserts the embedded copies exist,
 * are linked from `NOTICE.md`, and agree on the licence version. Adding a
 * bundled component means adding a row here — nothing discovers licences by
 * scanning, precisely so a new dependency cannot slip in without a notice.
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
 * ---- what is IN this manifest, and what is deliberately not ----
 *
 * IN: components rohy commits to this repository, bakes into a built artifact
 * (`dist/`, `frontend/`, the Docker image), or downloads onto a host at
 * runtime under rohy's own instruction.
 *
 * NOT IN, on purpose:
 *
 *  - **OyonR's third-party stack** (MediaPipe, ONNX Runtime, Silero VAD,
 *    WebGazer + the GPL, WebEyeTrack, EmotiEffLib, HSEmotion). `OyonR/` is
 *    vendored into this repo *with* its own `LICENSE`, `NOTICE.md` and nine
 *    embedded texts under `OyonR/licenses/`, all git-tracked and all COPYed
 *    into the runtime image. Those licences already travel with every copy of
 *    rohy. Re-embedding them at the root would create a second set to keep in
 *    sync, which is how a licence file goes stale. `NOTICE.md` links them in
 *    place; `FIRST_PARTY_VENDORED` below pins that arrangement so a future
 *    unvendoring of OyonR cannot silently take the notices with it.
 *
 *  - **Ordinary npm dependencies** (react, express, three, sqlite3, …). They
 *    are installed rather than vendored, and npm ships each package's own
 *    licence file inside `node_modules/`, which is what lands in the image.
 *    Enumerating several hundred transitive MIT texts here would add noise
 *    without adding a notice anyone lacks. `NOTICE.md` states this explicitly
 *    rather than leaving the omission to look like an oversight.
 */

/** The Carm Research License version rohy ships. Bump deliberately. */
export const CARM_LICENSE_VERSION = '1.4';

const CARM_REPO = 'https://raw.githubusercontent.com/mohsaqr/carm-license';

/**
 * The canonical licence, embedded at the repository root as `LICENSE`.
 *
 * `url` is PINNED to the version tag — that is what gets embedded at build
 * time, so the shipped terms never change without a deliberate edit.
 * `latest` is the always-current pointer, published alongside it so a reader
 * can always reach the newest version even when this copy is a release or two
 * behind. Embedded copy and live link are complementary, not alternatives.
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
 * The Carm ecosystem's own third-party notices.
 *
 * Carried at the root — not referenced inside `OyonR/` — because this is
 * rohy's obligation as a Carm ecosystem product in its own right, not one
 * inherited from the vendored addon. If OyonR were ever unvendored, rohy
 * would still owe this notice.
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
 * Every third-party component rohy commits, builds into an artifact, or
 * downloads onto a host at runtime. `runtime` records HOW the component
 * reaches a user, because that is what decides whether an obligation attaches
 * to the repository, the built bundle, the Docker image, or the operator's
 * own machine.
 */
export const THIRD_PARTY = [
    {
        id: 'talkinghead',
        name: 'TalkingHead (avatar head GLBs + the Oculus viseme convention)',
        spdx: 'MIT',
        version: null,
        url: 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/LICENSE',
        path: 'licenses/talkinghead.LICENSE.txt',
        source: 'https://github.com/met4citizen/TalkingHead',
        runtime:
            'six GLB head models committed under public/avatars/heads/ and built into '
            + 'dist/ + frontend/, so they ship in the Docker image and any static deploy',
    },
    {
        id: 'microsoft-rocketbox',
        name: 'Microsoft RocketBox (converted avatar head GLBs)',
        spdx: 'MIT',
        version: null,
        url: 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/LICENSE.md',
        path: 'licenses/microsoft-rocketbox.LICENSE.txt',
        source: 'https://github.com/microsoft/Microsoft-Rocketbox',
        runtime:
            'twenty-two GLB head models committed under public/avatars/heads/, converted via '
            + 'scripts/rocketbox-convert/; built into dist/ + frontend/ and shipped in the image',
    },
    {
        id: 'kokoro',
        name: 'Kokoro / kokoro-js (local TTS engine)',
        spdx: 'Apache-2.0',
        version: '1.2.1',
        url: 'https://raw.githubusercontent.com/hexgrad/kokoro/main/LICENSE',
        path: 'licenses/kokoro.LICENSE.txt',
        source: 'https://github.com/hexgrad/kokoro',
        runtime:
            'production dependency (server/services/kokoroTts.js); the ~330 MB '
            + 'onnx-community/Kokoro-82M-v1.0-ONNX weights are downloaded onto the host at '
            + 'first use and cached in TRANSFORMERS_CACHE',
    },
    {
        id: 'piper1-gpl',
        name: 'Piper TTS — OHF-Voice/piper1-gpl (full GNU GPL v3 text)',
        spdx: 'GPL-3.0-or-later',
        version: '1.4.2',
        // piper1-gpl's COPYING is the FULL GPL text, not the short "how to
        // apply" notice — so unlike WebGazer inside OyonR, this entry needs no
        // separate companion file to make its own closing sentence true.
        url: 'https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/COPYING',
        path: 'licenses/piper1-gpl.COPYING.txt',
        source: 'https://github.com/OHF-Voice/piper1-gpl',
        runtime:
            'installed on demand into a local Python venv by server/scripts/install-piper.sh '
            + 'and invoked as a separate process — BUT baked into the Docker image when it is '
            + 'built with INCLUDE_PIPER=1, which is redistribution. See NOTICE.md.',
    },
    {
        id: 'piper-voices',
        name: 'Piper voice models (rhasspy/piper-voices)',
        // The HuggingFace repo declares MIT, but that covers the repository,
        // not the speech corpora the voices were trained on: each voice's
        // MODEL_CARD names its own dataset licence, and several are
        // research-only (en_US-lessac-* points at the CSTR Blizzard 2013
        // licence). Recording a blanket "MIT" here would be false for the
        // default voice set, so the SPDX field says what is actually true and
        // NOTICE.md sends the reader to the per-voice card.
        spdx: 'MIT (repository) — per-voice dataset licences vary, see MODEL_CARD',
        version: null,
        url: 'https://huggingface.co/rhasspy/piper-voices/raw/main/README.md',
        path: 'licenses/piper-voices.model-card.txt',
        source: 'https://huggingface.co/rhasspy/piper-voices',
        runtime:
            'ONNX voice models downloaded onto the host by install-piper.sh (ten English + '
            + 'the de/es/it/fi/sv i18n set); not committed to this repository',
        // Upstream publishes NO licence FILE — the model card's YAML
        // frontmatter (`license: mit`) is where it states its terms, so that
        // card is what gets embedded. Marking this a declaration rather than a
        // licence text keeps the notice honest: a reader who opens the file
        // finds a language list, and must be told in advance that this is the
        // upstream's licence STATEMENT, not the licence. Inventing an MIT text
        // with a copyright line we made up would be the alternative, and that
        // is precisely what the sync script's AUTHORED policy forbids.
        kind: 'declaration',
    },
];

/**
 * First-party code that ships inside rohy without a licence file of its own,
 * because the Carm Research License at `LICENSE` already applies to "Carm and
 * all associated products, libraries, tools, and components in the Carm
 * ecosystem" — a second copy of the same terms beside the first would be a
 * copy to keep in sync, not an additional grant.
 *
 * They are listed rather than omitted because a reader needs to know what is
 * bundled, and because "no separate licence" must be a recorded, verifiable
 * decision rather than an absence that looks like an oversight.
 *
 * `carriesOwnNotices` marks a component that brings its OWN third-party
 * notices into the tree. OyonR does: nine embedded texts under
 * `OyonR/licenses/`, including the full GPL-3.0 that WebGazer's notice
 * requires. Those are what `NOTICE.md` links in place rather than duplicating,
 * so the contract test asserts they are really present — an unvendoring of
 * OyonR that took the notices with it would otherwise leave `NOTICE.md`
 * pointing at nothing.
 */
export const FIRST_PARTY_VENDORED = [
    {
        id: 'oyon',
        name: 'Oyon (OyonR) 3.3.x',
        version: '3.3.x',
        source: 'https://github.com/mohsaqr/Oyon',
        vendoredAt: 'OyonR',
        carriesOwnNotices: [
            'OyonR/LICENSE',
            'OyonR/NOTICE.md',
            'OyonR/licenses/GPL-3.0-or-later.txt',
            'OyonR/licenses/webgazer.LICENSE.txt',
            'OyonR/licenses/webeyetrack.LICENSE.txt',
            'OyonR/licenses/mediapipe.LICENSE.txt',
            'OyonR/licenses/onnxruntime-web.LICENSE.txt',
            'OyonR/licenses/silero-vad.LICENSE.txt',
            'OyonR/licenses/emotiefflib.LICENSE.txt',
            'OyonR/licenses/hsemotion.LICENSE.txt',
            'OyonR/licenses/carm-ecosystem-third-party-notices.txt',
        ],
        note: 'Carm ecosystem, covered by LICENSE; carries its own third-party notices in place.',
    },
    {
        id: 'ladyna',
        name: 'ladyna (TNA analytics engine)',
        version: '1.8.13',
        source: 'https://github.com/mohsaqr/ladyna',
        // Not vendored in-tree: resolved as a sibling `file:../tna-js`
        // dependency and copied into the image at /opt/ladyna. There is no
        // committed path to assert, so the contract test checks only that
        // NOTICE.md names it.
        vendoredAt: null,
        installedFrom: 'file:../tna-js',
        shipsAs: '/opt/ladyna in the Docker runtime image',
        note: 'Carm ecosystem, covered by LICENSE. The tnaj/ladyna engine (formerly dynajs).',
    },
];

/**
 * Clinical reference data rohy imports or ships. Not software, but the same
 * question applies — under what terms may a deployment redistribute it — and
 * for one source the answer differs from rohy's own licence.
 *
 * These mirror the `data_sources` table seeded in
 * `migrations/0007_drug_lab_catalogue.sql`, which records a `license` column
 * per source. That registry is the runtime source of truth; this list exists
 * so the obligation is visible in the notice a redistributor reads, not only
 * in a database row they would have to query.
 */
export const DATA_SOURCES = [
    {
        key: 'rxnorm',
        name: 'RxNorm (NLM drug vocabulary)',
        license: 'Public domain (U.S. National Library of Medicine)',
        commercialOk: true,
    },
    {
        key: 'openfda',
        name: 'openFDA drug label corpus',
        license: 'CC0 1.0 (public-domain dedication)',
        commercialOk: true,
    },
    {
        key: 'loinc',
        name: 'LOINC v2.82 laboratory codes',
        license: 'LOINC licence — free to use, attribution required',
        commercialOk: true,
    },
    {
        key: 'ucum',
        name: 'UCUM units of measure',
        license: 'Public, HL7/ISO',
        commercialOk: true,
    },
    {
        key: 'caliper',
        name: 'CALIPER paediatric reference intervals (2026)',
        license: 'CC BY-NC-SA 4.0',
        // The one genuine conflict: rohy's own licence SELLS commercial use,
        // and this dataset forbids it. Isolable by design — every row carries
        // data_source_id, so a commercial deployment can drop this source
        // without touching the rest of the catalogue.
        commercialOk: false,
    },
];

/** Every entry the sync writes and the contract test checks. */
export const ALL_ENTRIES = [CARM_LICENSE, CARM_THIRD_PARTY_NOTICES, ...THIRD_PARTY];
