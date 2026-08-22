# Third-party notices

rohy's source code is released under the **Carm Research License v1.4** — the
full text is embedded at [`LICENSE`](LICENSE), synced from the canonical
[mohsaqr/carm-license](https://github.com/mohsaqr/carm-license) repository.

That license requires third-party notices to travel with every copy of the
Software, and the canonical repository states plainly that *"redistributed
copies of Carm must include the licence text itself, not only a link."*
Accordingly, every license below is **embedded in full** — under
[`licenses/`](licenses/) for rohy's own components, and under
[`OyonR/licenses/`](OyonR/licenses/) for the vendored Oyon addon — not merely
linked, and refreshed from its canonical upstream source by
`npm run license:sync` on every build.

**Embedded text and live link are complementary, not alternatives.** The
embedded copy is what *this artifact* is licensed under, frozen at build time
so the shipped terms cannot change under you. The "latest" link is where that
license lives *now*, so a reader can always reach the current version even when
this copy is a release or two behind. Both are given for every component.

`scripts/licenses.manifest.mjs` is the single source of truth for this file.
Adding a bundled component means adding a row there;
`npm run license:verify` fails if a manifest entry is missing its embedded text
or its link here, so a new dependency cannot ship without a notice.

---

## rohy itself

| Component | License | Embedded text (this artifact) | Latest upstream |
|---|---|---|---|
| rohy | Carm Research License v1.4 | [`LICENSE`](LICENSE) | [always current](https://raw.githubusercontent.com/mohsaqr/carm-license/main/LICENSE.txt) · [repo](https://github.com/mohsaqr/carm-license) |
| Carm ecosystem notices | (various) | [`licenses/carm-ecosystem-third-party-notices.txt`](licenses/carm-ecosystem-third-party-notices.txt) | [always current](https://raw.githubusercontent.com/mohsaqr/carm-license/main/THIRD-PARTY-NOTICES.txt) |

Free for research, teaching, personal learning and non-profit use — including
industry-funded and collaboratively funded academic work, which v1.4 places
explicitly inside the free grant regardless of funding source. A paid license
is required for commercial use. Outputs you generate by running rohy on your
own data are entirely yours.

The Carm ecosystem notices are carried **here at the root**, not referenced
inside `OyonR/`, because they are rohy's own obligation as a Carm ecosystem
product in its own right. If the Oyon addon were ever unvendored, rohy would
still owe this notice.

## First-party Carm ecosystem code bundled in rohy

These carry **no separate license file**: the Carm Research License at
[`LICENSE`](LICENSE) applies to "Carm and all associated products, libraries,
tools, and components in the Carm ecosystem", which includes them. A second
copy of identical terms beside the first would be a copy to keep in sync, not
an additional grant.

They are listed rather than omitted because a reader needs to know what is
bundled, and because "no separate license" should be a recorded decision rather
than an absence that looks like an oversight.

| Component | Where it lives | How it reaches a user |
|---|---|---|
| [Oyon](https://github.com/mohsaqr/Oyon) 3.3.x | [`OyonR/`](OyonR/) — vendored in-tree, git-tracked | Express serves `/oyon/*` and `/standalone/*` from it; `COPY`ed into the Docker runtime image |
| [ladyna](https://github.com/mohsaqr/tna-js) 1.8.13 | resolved as the sibling dependency `file:../tna-js` | bundled into the client analytics build; copied to `/opt/tna-js` in the runtime image |

### Oyon's own third-party licenses are carried in place

The vendored `OyonR/` tree ships **with its own complete notice set**, all
git-tracked and all present in the runtime image. Those obligations are already
satisfied where they sit, so this file **links them rather than duplicating
them** — a second root-level copy would be a set of legal texts to keep in sync
with the first, which is how a license file goes stale.

| Component | License | Embedded text (carried in place) |
|---|---|---|
| Oyon itself | Carm Research License v1.4 | [`OyonR/LICENSE`](OyonR/LICENSE) · [`OyonR/NOTICE.md`](OyonR/NOTICE.md) |
| ONNX Runtime Web | MIT | [`OyonR/licenses/onnxruntime-web.LICENSE.txt`](OyonR/licenses/onnxruntime-web.LICENSE.txt) |
| `@mediapipe/tasks-vision` | Apache-2.0 | [`OyonR/licenses/mediapipe.LICENSE.txt`](OyonR/licenses/mediapipe.LICENSE.txt) |
| Silero VAD | MIT | [`OyonR/licenses/silero-vad.LICENSE.txt`](OyonR/licenses/silero-vad.LICENSE.txt) |
| WebEyeTrack | MIT | [`OyonR/licenses/webeyetrack.LICENSE.txt`](OyonR/licenses/webeyetrack.LICENSE.txt) |
| EmotiEffLib weights | Apache-2.0 | [`OyonR/licenses/emotiefflib.LICENSE.txt`](OyonR/licenses/emotiefflib.LICENSE.txt) |
| HSEmotion weights | Apache-2.0 | [`OyonR/licenses/hsemotion.LICENSE.txt`](OyonR/licenses/hsemotion.LICENSE.txt) |
| **WebGazer.js** | **GPL-3.0-or-later** | [`OyonR/licenses/webgazer.LICENSE.txt`](OyonR/licenses/webgazer.LICENSE.txt) + the full text at [`OyonR/licenses/GPL-3.0-or-later.txt`](OyonR/licenses/GPL-3.0-or-later.txt) |
| Carm ecosystem notices | (various) | [`OyonR/licenses/carm-ecosystem-third-party-notices.txt`](OyonR/licenses/carm-ecosystem-third-party-notices.txt) |

`tests/server/license-contract.test.js` asserts every one of those paths still
exists **and is still linked from this file**, so an unvendoring of Oyon cannot
silently take the notices with it and leave this section pointing at nothing.

Read [`OyonR/NOTICE.md`](OyonR/NOTICE.md) for the gaze-engine details,
including which engine is the default and what WebGazer's copyleft means for a
host application.

## Third-party components rohy ships itself

| Component | License | Embedded text (this artifact) | Latest upstream | How it reaches a user |
|---|---|---|---|---|
| [TalkingHead](https://github.com/met4citizen/TalkingHead) | MIT | [`licenses/talkinghead.LICENSE.txt`](licenses/talkinghead.LICENSE.txt) | [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead/blob/main/LICENSE) | six avatar head GLBs committed under `public/avatars/heads/`; built into `dist/` + `frontend/` and shipped in the image |
| [Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox) | MIT | [`licenses/microsoft-rocketbox.LICENSE.txt`](licenses/microsoft-rocketbox.LICENSE.txt) | [microsoft/Microsoft-Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) | twenty-two converted avatar head GLBs, same path and same build |
| [Kokoro / kokoro-js](https://github.com/hexgrad/kokoro) 1.2.1 | Apache-2.0 | [`licenses/kokoro.LICENSE.txt`](licenses/kokoro.LICENSE.txt) | [hexgrad/kokoro](https://github.com/hexgrad/kokoro/blob/main/LICENSE) | production dependency; the ~330 MB `onnx-community/Kokoro-82M-v1.0-ONNX` weights download to the host at first use |
| [Piper TTS](https://github.com/OHF-Voice/piper1-gpl) 1.4.2 | **GPL-3.0-or-later** | [`licenses/piper1-gpl.COPYING.txt`](licenses/piper1-gpl.COPYING.txt) | [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING) | optional; installed into a local venv by `npm run install:piper` — **and baked into the Docker image when built with `INCLUDE_PIPER=1`**. See the note below. |
| [Piper voices](https://huggingface.co/rhasspy/piper-voices) | MIT (repository) — **per-voice dataset licenses vary** | [`licenses/piper-voices.model-card.txt`](licenses/piper-voices.model-card.txt) | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) | ONNX voice models downloaded to the host by `install-piper.sh`; not committed here. See the note below. |

The avatar GLBs are the reason the two MIT texts above are load-bearing rather
than decorative: they are **committed binary assets** that get copied verbatim
into every build output and every container image, so the MIT attribution
requirement attaches to those artifacts, not merely to this repository.

### Piper is GPL-3.0, and one build variant redistributes it

`server/scripts/install-piper.sh` installs `piper-tts` (the
[OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) package, the
maintained successor to the archived `rhasspy/piper`) into a project-local
Python venv, and rohy invokes the resulting binary as a **separate process**.
Piper is not linked into rohy's own code, and neither the venv nor the voices
are committed to this repository — `.dockerignore` excludes
`server/data/piper/venv` and `server/data/piper/voices`.

That distinction stops mattering in one case. `deploy/docker/Dockerfile` runs
the install script inside a dedicated build stage when the image is built with
`INCLUDE_PIPER=1`, and copies the resulting venv into the runtime image. **An
image built that way redistributes GPL-3.0 software**, and the usual
obligations attach to *that image*: preserve the license and notices, and offer
the corresponding source to recipients on request. The full GPL text is
embedded at
[`licenses/piper1-gpl.COPYING.txt`](licenses/piper1-gpl.COPYING.txt) so it
travels with the image regardless.

This does **not** change rohy's own Carm Research License terms, and it does
not arise at all in the default build (`INCLUDE_PIPER` unset), where TTS runs
on Kokoro, Google, or OpenAI. If you are distributing rohy images and your
distribution is incompatible with copyleft, build without `INCLUDE_PIPER` and
let operators install Piper themselves.

### Piper voice licenses are per-voice, not blanket-MIT

The `rhasspy/piper-voices` repository declares `license: mit` in its model-card
frontmatter — embedded above, which is where that upstream states its terms,
since it publishes no separate license file. That declaration covers the
**repository**, not the speech corpora the individual voices were trained on.
Each voice ships a `MODEL_CARD` naming its own dataset and that dataset's
license, and several are **not** permissive: `en_US-lessac-*`, one of the ten
English voices `install-piper.sh` installs by default, points at the
[CSTR Blizzard 2013 license](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html),
which is research-restricted.

Before deploying rohy commercially with Piper voices, check the `MODEL_CARD`
of each voice you actually enable. The voices are downloaded per-deployment
rather than shipped here, so this is an operator decision and the platform
cannot make it for you.

## npm dependencies

rohy's runtime dependencies (React, Express, three.js, sqlite3, i18next,
TipTap, bcrypt, and their transitive graph) are **installed, not vendored**.
npm places each package's own license file inside `node_modules/`, and that is
what lands in the Docker runtime image, so every one of those notices already
travels with the artifact. They are deliberately not enumerated here:
several hundred transitive MIT and Apache-2.0 texts would add volume without
adding a notice anyone lacks.

This is a recorded decision, not an omission. The components listed above are
listed precisely because they are the exceptions — committed assets, copyleft
software, downloaded model weights, and licensed clinical data — where the
obligation attaches somewhere other than `node_modules/`.

## Clinical reference data

Every catalogue row in rohy carries a `data_source_id` into the `data_sources`
table (`migrations/0007_drug_lab_catalogue.sql`), which records each source's
release version and license. That registry is the runtime source of truth; this
table exists so the obligations are visible in the notice a redistributor
reads, not only in a database row they would have to query.

| Source | License | Commercial deployment |
|---|---|---|
| RxNorm (NLM drug vocabulary) | Public domain (U.S. National Library of Medicine) | unrestricted |
| openFDA drug label corpus | CC0 1.0 (public-domain dedication) | unrestricted |
| LOINC v2.82 laboratory codes | LOINC license — free to use, **attribution required** | permitted, with attribution |
| UCUM units of measure | Public, HL7/ISO | unrestricted |
| CALIPER paediatric reference intervals (2026) | **CC BY-NC-SA 4.0** | **not permitted — see below** |

### The CALIPER dataset is non-commercial

The paediatric reference intervals are published under CC BY-NC-SA 4.0, whose
non-commercial term is incompatible with a commercial deployment of rohy — the
one place where a bundled component's license is stricter than rohy's own.

This is isolable by design rather than by accident. The CALIPER ranges live in
their own `data_sources` row (`caliper_2026`) and every range that came from
them references it, so a commercial deployment can **drop that source cleanly**
without disturbing the adult ranges, the LOINC coding, or the rest of the
catalogue. Institutions deploying rohy commercially must do so, or obtain their
own license from the dataset's publisher.

## Unresolved provenance

The auscultation audio at `public/sounds/normal-heart.mp3` and
`public/sounds/normal-lung.mp3` is committed to this repository and shipped in
every build, but **its origin and license are not recorded anywhere** in the
repository or its history — the files arrived alongside the body-map assets
with no attribution.

It is listed here rather than quietly omitted because an unknown license is a
risk to a redistributor, and an empty row is more honest than an invented one.
Resolving it means either recovering the original source and adding it to
`scripts/licenses.manifest.mjs`, or replacing the files with audio of known
provenance. Until then, treat these two assets as unlicensed for
redistribution.

## Keeping this file honest

```bash
npm run license:sync     # refresh every embedded text from its canonical source
npm run license:verify   # fail if any text drifted, or is missing a notice here
npm run license:latest   # report whether a newer Carm License version exists
```

`license:sync` runs as part of `npm run build`. The strict form
(`license:verify`) is what a release must pass, where a drift is an error
rather than a silent rewrite — a release must never alter the terms it
publishes without a human reviewing the diff first.
`tests/server/license-contract.test.js` runs in the ordinary test suite and is
fully offline, so the contract holds on a machine with no network.

## Reporting issues

If you believe a bundled artifact's license is misrepresented above, open a
GitHub issue and we will correct it promptly.
