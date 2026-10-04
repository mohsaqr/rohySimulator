# Changelog

## 3.3.3 - 2026-10-04

### The capture pill speaks the host's language

`<oyon-app>` gains two attributes for the capture pill (`chrome="capture"` and
`"capture-analytics"`):

- **`lang`** — a BCP-47 tag (`de`, `de-DE`, `kk-KZ`; only the primary subtag
  counts). Built-in strings for `en`, `de`, `es`, `it`, `fi`, `sv`, `fr` and
  `kk`, the languages Rohy ships. Anything else falls back to English with a
  console warning.
- **`labels`** — a JSON object overriding any pill string by key (see
  `standalone/app/src/lib/pillStrings.js`). Unknown keys and non-string or
  blank values are dropped with a warning; invalid JSON is ignored and never
  throws.

Both apply live and are presentation-only: they live in the element's host
bridge, which the runtime never reads, so switching language mid-capture
re-renders the text without restarting the camera, the runtime or the
session. The emotion word in the headline is localised too; English keeps
the classifier's own wording. Translations are machine-assisted, written as
natural UI strings, and plural-free ("samples: 12", never "12 samples").
"Capture" is rendered as capture or measurement, never "recording": Oyon
keeps no video.

### The capture pill can be reached by keyboard and screen reader

- Every pill control has an accessible name (`aria-label`); its tooltip is
  kept as the description. Icons are `aria-hidden`.
- A control that is unavailable (↗ before a session exists, Start while the
  camera starts, Calibrate while calibrating) is `aria-disabled` rather than
  natively disabled, so it stays in the tab order and announces why it is
  unavailable. A click on it does nothing.
- Pill controls draw their own focus ring: a light cyan outline between dark
  halos, which reads on the dark glass and on any host background. Before
  this, the only ring was the global info blue, which was close to invisible
  against the pill.
- The headline is a polite live region. It announces Ready, Camera… and
  Error, and while capturing a steady "Capturing" or "Paused". The live
  emotion word is hidden from assistive tech, so it does not announce every
  change. The pill is a labelled group and carries the resolved `lang`, so
  screen readers pronounce it in the right language.

### The element bundle no longer depends on whether webgazer is installed

The element is one inlined module, so `await import('webgazer')` was
evaluated at its top level, and the result depended on the build machine:

- **webgazer absent** (a clean `npm ci`; it is an optional peer and not in
  the lockfile): Vite's missing-peer stub,
  `throw new Error('Could not resolve "webgazer" imported by "oyon".')`, ran
  on load and the element never defined. The 3.3.2 element shipped like
  this, and Rohy hand-patched its vendored copy.
- **webgazer present** (a stale install): the whole GPL-3.0 library, about
  1.3 MB, was inlined and executed on load in every host, whether or not the
  webgazer engine was selected.

The element build now always resolves `webgazer` to an empty module.
`WebGazerAdapter` treats an import that yields no usable WebGazer like a
failed import and falls back to its script tag (`scriptUrl`), so
`gaze-engine="webgazer"` still works in the element. The default mediapipe
engine never touches it. `build:element` now runs
`scripts/verify-element-bundle.mjs`, which fails the build if the bundle
contains any unresolved-import stub or inlined WebGazer code. The element
bundle is about 4.6 MB, down from 5.9 MB on a machine with webgazer
installed.

### Tests

- `tests/app-pill-a11y.test.js` (in `npm test`) covers the string table
  (every language, every key, matching placeholders, plural-free counts),
  `lang` normalisation, `labels` validation (bad JSON, non-objects, unknown
  keys, `__proto__`), overrides, emotion labels, source contracts for the
  pill, element and runtime, and the WebGazer fallback.
- `tests/e2e/embed-pill.spec.ts` checks the built element in Chromium: live
  `lang`/`labels` switching and fallbacks, an accessible name on every
  control, `aria-hidden` icons, the aria-disabled control staying in the tab
  order, the computed focus ring after a keyboard Tab, and a `lang` switch
  mid-capture. That last test checks there is no new `getUserMedia` call, no
  ended track, the same runtime controls object and no lifecycle transition.

- `tests/e2e/standalone-app.spec.ts` looks for the analytics tab by its
  current name, "Dynamics". It had been failing since the tab was renamed
  from "Affect dynamics". The new line is word for word the patch Rohy's
  `scripts/apply-oyon-patches.mjs` applies after each sync, so that script
  will now report it as unchanged.

The host contract version stays at `3.1`: both attributes are optional and
additive.

## 3.3.2 - 2026-07-26

### Every license now carries both an embedded text and a live link

The embedded copy and the upstream link answer different questions, so both
are published for every component rather than one standing in for the other:

- the **embedded text** is what *this artifact* is licensed under, frozen at
  build time so the shipped terms cannot change under a reader;
- the **latest link** is where that license lives *now*, so a reader can reach
  the current version when this copy is a release or two behind.

`NOTICE.md`'s index gains a "Latest upstream" column, and every panel on the
About page gains a "Latest upstream licence ↗" link beside its embedded text.
The Carm license card states plainly that its text comes from the pinned
`v1.4` tag and links the always-current version alongside it — that is the one
place where pinned and latest genuinely differ, so a reader had no way to see
they were behind.

Tests assert both halves: every manifest entry's upstream source must appear
in `NOTICE.md`, the Carm "latest" pointer must track `main`, and the embedded
Carm text must *not* — a build that silently followed `main` could relicense
the product without a release. All 10 published links were verified to
resolve.

## 3.3.1 - 2026-07-26

Release-packaging fix. The v3.3.0 tag exists but its workflow failed at
"Verify isolated consumer installation", so no v3.3.0 artifact was ever
published. Per `RELEASING.md` the tag is not moved — this is the corrected
release, and it contains everything listed under 3.3.0 below.

### `webgazer` is now an optional peer dependency

`npm audit --omit=dev --audit-level=high` in the isolated consumer failed on 8
high-severity advisories, every one of them reached through a single chain:

```
oyon → webgazer → @tensorflow-models/face-landmarks-detection
     → rimraf → glob → minimatch → brace-expansion@1.1.16
```

The advisory (GHSA-mh99-v99m-4gvg) covers `brace-expansion <=5.0.7`. An
`overrides` pin was tested and **rejected**: `1.1.16` is already the newest
1.1.x, and the only patched release, `5.0.8`, is a breaking API change — 1.x
exports a callable function, 5.x exports an object, so forcing it would break
`minimatch@3`, which calls it as a function.

The fix is packaging, not pinning. `webgazer` moves from `dependencies` to an
**optional** `peerDependencies` entry, so it is no longer installed for
everyone. This suits how it was already written: the adapter loads it with a
dynamic `await import('webgazer')`, falls back to a CDN script tag, and
already carried a `PEER_DEPENDENCY_HINT` constant for the missing-module case.
It is also already external in the rollup config. The plain `dependencies`
entry was the anomaly.

**No behaviour changes.** The default gaze engine is unchanged
(`gaze_engine: 'mediapipe'`). Only consumers who explicitly select
`gaze_engine: 'webgazer'` need to install it, and they now do so deliberately
rather than receiving a large copyleft dependency they never asked for.

### Notice correction

`NOTICE.md` and the About page described WebGazer as the "default gaze
engine". It is not, and never was in this version line — the default is
`mediapipe` (`src/settings/OyonSettings.js`), and unknown engine values fall
back to it. Both now say what the code does.

## 3.3.0 - 2026-07-26

The voice release, shipping together with the 3.2.0 typing/signal work below
and a licensing overhaul. 3.2.0 was developed but never cut as its own
artifact, so the 3.3.0 tarball is the first release containing any of it.

### Licensing: every license embedded, not linked

Oyon moves to the **Carm Research License v1.4** (from v1.3, which the
canonical repository marks superseded), and every third-party license Oyon
ships, vendors or downloads is now embedded in full under `licenses/`.

The canonical [carm-license](https://github.com/mohsaqr/carm-license)
repository states that *"redistributed copies of Carm must include the licence
text itself, not only a link"*, and v1.4 adds a THIRD-PARTY COMPONENTS clause
requiring third-party notices to travel with every copy. Linking was not
enough for either.

- `scripts/licenses.manifest.mjs` is the single source of truth: 11 entries,
  each recording its SPDX identifier, canonical URL, and **how the component
  reaches a user** (peer dependency, vendored bytes, or weights downloaded at
  runtime) — which is what decides whose obligation a license is.
- `npm run license:sync` refreshes every text from its canonical source and
  runs on each `npm run build`. `npm run license:verify` is the strict form
  and runs in `prepublishOnly`. `npm run license:latest` reports whether a
  newer Carm License version exists.
- The texts are **committed and shipped** in the package `files[]`, and
  imported into the About page as raw text rather than fetched — a runtime
  fetch would ship a link, break offline use, and be blocked by the CSP of
  the host pages the embeddable element targets.
- The Carm license is fetched from its **version tag**, not `main`, so a
  routine build cannot silently relicense the product; a version bump is a
  deliberate one-line edit.

### Fixes to license compliance

- **WebGazer shipped only the GPL *notice*, not the license.** Its
  `LICENSE.md` is 717 bytes ending "You should have received a copy of the GNU
  General Public License along with this program" — which was false. The full
  34 KB GPL-3.0 text is now embedded alongside it, and the copyleft default
  gaze engine is flagged as such on the About page.
- **Vendored `dynajs` had no license notice at all.** It was absent from
  `NOTICE.md` entirely despite shipping inside the built element. It is now
  recorded as **first-party Carm ecosystem code**, covered by `LICENSE`
  directly rather than carrying a second copy of identical terms.

  This corrected an inconsistency wider than Oyon: the canonical carm-license
  repo already declared `carm`, `carm-embed`, `carm-text`, `carm-ml`, `tnaj`,
  `snajs`, `psychaj` and `codynaj` to be Carm-licensed, while five of those
  packages declared `"license": "MIT"` and seven shipped no license file at
  all. All nine ecosystem repos (including `dynajs`) now carry the Carm v1.4
  text and `"license": "SEE LICENSE IN LICENSE"`.

  Oyon previously shipped an MIT notice for `dynajs` whose copyright line was
  written by hand, because no upstream published one. That text is gone, and
  the `AUTHORED` escape hatch in `scripts/sync-licenses.mjs` is now empty by
  policy: if a component needs license text no upstream publishes, the fix is
  upstream, not a notice invented here.
- **The emotion model weights are Apache-2.0**, not the unknown quantity
  `NOTICE.md` previously recorded as "Per upstream — verify before
  redistribution". Both EmotiEffLib and HSEmotion state explicitly that there
  is "no limitation for both academic and commercial usage"; their texts are
  embedded and the upstream wording is quoted.

### Verified

`--strict` passes on clean text and fails on tampered text; an unreachable
source warns and keeps the committed copy in a dev build but fails the release
gate; the built element and the npm tarball both carry all 10 license files
plus `LICENSE` and `NOTICE.md`; the About page renders every text offline with
zero network requests.

### ⚠ Measurement comparability

**Several fixes below deliberately changed reported values.** They are
correct now and were wrong before, but that means **data collected under
3.0.x is not comparable to data collected under 3.3.0** for these fields.
A study already in the field should either stay pinned to its current
version or re-derive:

| Field | Before | Now |
|---|---|---|
| `typing.product_ratio` | could exceed 1 (101 on a one-character edit to a 100-character draft) | bounded to `[0, 1]`, scoped to the episode's own production |
| `typing.chars_per_min*` / `words_per_min*` | over the whole document length | over the episode's net production |
| `typing.revision_distance_*` | `0` on a pure-insert episode | `null` — not measured |
| `voice.speech_ratio` | over wall-clock turn duration | over the learner (non-playback) timeline |
| `voice.clipped_coverage` / `muted_coverage` / `vad_coverage` | over all frames | over non-playback frames only |
| `voice.pitch_*` | any NSDF-voiced frame | VAD-gated — no pitch from frames the VAD called non-speech |
| discourse acts | first matching rule wins | earliest match position, family rank breaks ties (`"Explain this?"` is now `directive`, not `question`) |

The wire contract is unaffected: Oyon still emits `oyon-window-batch-v4`
and still accepts `v3`, so a host on the older batch schema keeps working.

### Correctness fixes across the new signal modalities

Found by an adversarial review of the modality work and verified by
re-running each probe against the fix.

- **The microphone could stay live after `dispose()`.** A `startTurn()` in
  flight when `dispose()` landed went on to activate and hold its track.
  `dispose()` and `stopTurn()` now cancel an in-flight start, which resolves
  as a refusal (`'disposed'` / `'stopped_during_start'`) and releases every
  acquired resource; a second concurrent start is refused outright
  (`'start_in_progress'`) rather than acquiring a second stream.
- **`product_ratio` could exceed 1** — 101 on a one-character edit to a
  100-character draft. Typing metrics are now scoped to an episode
  *baseline*: every fluency rate and every process-vs-product comparison
  uses the episode's own net production, not the whole document length.
- **A voice window could contradict its own event stream.** The legacy
  in-thread path attached no per-frame features, which the aggregator
  ignores entirely — events said `speech` while the window reported
  `speech_duration_ms: 0`. That path now ships a minimal time-domain
  features record, with everything it cannot measure left `null`.
- Voice aggregation: playback frames no longer affect learner-scoped
  coverages, pitch is VAD-gated (periodic energy during VAD-silence is hum,
  not speech), and an absent RMS is excluded rather than coerced to `0`.
- Adaptive pause thresholds are derived from the **complete** interval
  series; the `maxIntervals` cap is a transport bound, not a measurement
  bound.
- Corrections now count as revisions in **both** families — revision
  distance *and* R-burst closure — so the two views cannot disagree.
- Silero VAD `reset()` no longer races in-flight inference, so a previous
  turn's LSTM state cannot survive into the next turn.
- The event store drains repeatedly on `dispose()`, so an event written
  during teardown is written or reported, never silently stranded.
- A throwing host `onWindow` callback no longer leaks listeners.
- The worker's inbound frame queue is bounded instead of growing unbounded
  under backpressure.
- Discourse classification is now **earliest-match-wins with a family-rank
  tiebreak**: an interior hedge can no longer override a sentence-initial
  question or directive. Fallback sentence splitting no longer tears apart
  decimals, URLs, or `e.g.`.

### Voice analytics

- Four new charts: across-turn trends and per-turn time composition (the
  session as a trajectory rather than disconnected snapshots), plus a
  loudness envelope and a pitch distribution per turn. Each is pinned to the
  aggregator — the histogram's quartiles reproduce `pitch_iqr_hz` and the
  envelope's mean reproduces `rms_mean` — and each flags at render time when
  a stored frame series and its metrics disagree.
- `/analyze/voice` is restructured into session scope then turn scope; the
  session charts are click-to-select. Pause histograms render as bars, and
  device metadata folds away so the panel leads with measurement.
- The Live voice-test modal charts the turn it just recorded.

### Documentation

- `docs/TYPING.md`: the writing-process metric family on the window —
  episode baseline, null discipline, the P-/R-burst tie-break, and the
  adaptive pause threshold.
- `docs/DISCOURSE.md`: the rewritten classification rule and what it changed.
- `docs/VOICE.md`: the new refusal reasons, learner-scoped coverages, pitch
  VAD gating, and the legacy path's minimal features record.

## 3.2.0 - 2026-07-26

The typing and signal-modality release. Developed as its own milestone but
never cut as a separate artifact — it ships inside the 3.3.0 tarball. There
is no `v3.2.0` tag or release asset; pin `v3.3.0` to get this work.

### Five host-driven sensing modalities

Alongside the existing camera pipelines, plus a complete per-event log for
sequence analysis and the app surfaces to capture and analyse them.

- **typing** — `TypingAggregator` + `TypingComposerAdapter` at the
  `typing-v3` profile: P-/R-bursts, pause location, revision distance,
  fluency in the field's conventional units, product ratio, and adaptive
  per-writer pause thresholds. See `docs/TYPING.md`.
- **discourse** — per-sentence speech acts (thinking / request / question /
  directive / statement) with an audit trail naming the marker that fired.
  See `docs/DISCOURSE.md`.
- **interaction** — sampled pointer, click, scroll, selection and focus. The
  AOI join reuses the gaze geometry, so mouse and gaze are comparable
  streams rather than two incompatible coordinate systems.
- **ai_assist** — the host-fed suggestion cycle, without which accepted AI
  text is indistinguishable from fast typing.
- **voice** — a three-tier split: AudioWorklet framing, Worker-hosted Silero
  VAD + FFT + in-house NSDF pitch, main-thread aggregation. ORT cannot run
  in an AudioWorklet, and the camera pipelines already saturate the main
  thread. See `docs/VOICE.md`.

### Schema

- **Batch schema v4** — an explicit `modality` discriminator superseding the
  ad-hoc `<x>_only` booleans. **v3 stays accepted**, so existing hosts keep
  working without changes.
- Closed, versioned state vocabularies per modality, so transition matrices
  stay comparable across studies.
- **IndexedDB v3** — `signal_windows` (aggregates) and `signal_events` (the
  ordered per-event log). Windows are a convenience over the log, never a
  replacement for it.

### Orchestration and analysis

- `createSignalCapture` — a sibling to `EmotionRuntime`, which stays a
  camera orchestrator. One shared event log, so `sequence_index` is
  monotonic across modalities on a single timeline.
- `SignalEventLog.toSequences()` feeds dynajs `tna()` with no adapter code.
- App: Dynamics and Patterns gain a channel picker; new Typing and Voice
  analytics pages with writing-process charts (progression, production
  curve, IKI distribution, burst strip; pitch contour, speech strip);
  capture test modals on Live; Voice settings; diagnostics.

### Fixes

- The validator rejected `facial` / `gaze` / `heart_rate` / `posture`
  `*_only` windows over HTTP — only `engagement_only` was exempt.
- `exports-map` now asserts that every value declared in a `.d.ts` is
  genuinely exported at runtime; it immediately caught three `.d.ts` files
  promising missing exports.
- Revision distance was computed over all edits rather than revisions, so
  inserts at distance 0 swamped it.
- No `pause` is synthesized before the first edit — that gap is already
  `first_input_latency_ms`.

### Data policy

Per `CLAUDE.md`, signal is recorded and exposed, not withheld. Raw typing
intervals and per-frame voice features are retained; the validator is a
transport-shape check, not a privacy gate. The microphone default-off is an
activation gate on **hardware**, not on data.

### Not yet done

No validation corpus for VAD/pitch, no browser matrix, no real-microphone
capture, and the Silero SHA-256 is unpinned pending an assets mirror.

## 3.0.5 - 2026-07-24

### Embedded analytics privacy
- Lock every embedded analytics surface to the active or explicitly pinned
  `session-id`. Embedded viewers no longer default to browser history or
  enumerate records from other sessions; no active session renders zero
  windows instead of falling back to `All`.
- Replace the ineffective capture-pill ↗ memory-route navigation with the
  typed `oyon:open-analytics` host event carrying the exact active session.
- Keep retrospective `Current` / `Past` / `All`, session, and user filtering
  available only in the standalone research instrument.

## 3.0.4 - 2026-07-23

### About, identity, and licensing
- Add a standalone `/about` route and main-navigation entry with a
  scientific overview of Oyon, a grouped capability matrix, and
  release-verified package, host-contract, and window-schema identifiers.
- Display the complete repository license directly from the canonical
  `LICENSE` file so the application and package cannot drift.
- License Oyon v3.0.4 under the Carm Research License v1.3 and align the
  package manifest, lockfile, README, and source notice. Third-party
  components continue to retain their respective licenses in `NOTICE.md`.
- Add source and browser contracts covering About-page reachability,
  capability content, version identity, and the Carm license.

## 3.0.3 - 2026-07-23

### Host integration and compatibility
- Add explicit, live host controls for `oyon:sample` delivery:
  `sample-events="source|throttled|off"` plus `sample-event-hz`. Preserve the
  existing v3 source-rate default and the legacy `live-samples` attribute so
  Rohy and existing hosts do not change behavior.
- Expose exact runtime and host-contract versions on `<oyon-app>`, its data
  attributes, and every host event detail.
- Version HTTP window-batch envelopes with
  `schema_version: "oyon-window-batch-v3"` while continuing to validate
  unversioned v2/Rohy payloads.
- Export `domRectToGazeAoi` and `elementToGazeAoi` for semantic DOM targets,
  including window chrome, physical-screen offsets, semantic sub-regions, and
  minimum resolvable target sizing.
- Add `npx oyon host-check [public-dir] [--json]` to verify package identity,
  the prebuilt element contract, peer dependencies, and optional self-hosted
  assets.
- Add the v2→v3 migration guide, correct stale v2 CDN recipes, document
  viewer/capture coexistence, and expand fake-camera host-contract coverage.

## 3.0.2 - 2026-07-21

### Release infrastructure
- Treat npm as a credential-dependent distribution channel: publish only when
  `NPM_TOKEN` is configured and otherwise complete the verified GitHub Release
  with an explicit workflow notice.
- Pass the packed tarball to npm as a filesystem path so it cannot be parsed as
  a Git dependency specifier.

## 3.0.1 - 2026-07-21

### Release infrastructure
- Publish one verified tarball to both GitHub Releases and npm, accompanied by
  a SHA-256 checksum file and an isolated-consumer installation test.
- Keep GitHub release artifacts available even if the npm registry step fails,
  so self-hosted and private consumers always have an immutable package source.
- Make the package-manifest verifier resilient to lifecycle-hook diagnostics
  while preserving strict validation of every exported and executable target.
- Document the immutable-tag, patch-release and downstream-pinning policy.

## 3.0.0 - 2026-07-21

### Security and release hardening
- Recursively reject forbidden raw-media and eye-image keys anywhere in an
  event payload, including arbitrary nested extension objects and arrays.
- Return a stable generic `persist_failed` response without exposing database
  or infrastructure exception messages.
- Repair `install-assets` and `paths` discovery for peer packages that hide
  their manifests behind package export maps.
- Vendor the reviewed `webeyetrack@0.0.2` production bundle byte-for-byte,
  removing its unused vulnerable `mathjs` dependency graph from published
  installations. Full and production npm audits are clean.
- Add the missing pose-landmarker model to the existing `assets-v1` release
  URL and verify its release digest.
- Harden the npm release boundary with complete export/type checks, isolated
  tarball verification, declared React peers, and CI publish gating.

### Changed
- Added an explicitly **experimental Attention analytics** screen alongside
  the unchanged Engagement dashboard. It keeps measured focus,
  on-screen and gaze-validity traces separate from a documented descriptive
  state ribbon, adds episode/AOI summaries, and provides one compact,
  non-causal breathing/attention overlap card.
- Consolidated the full respiration time series under **Heart & breathing**;
  experimental Attention no longer duplicates it. Breathing headline numbers
  now sit in that page's top summary, and demo respiration stays around a
  realistic 12–13 br/min instead of fabricating emotion-linked spikes.
- Standardized Analytics pages around a numbers-first reading order. Sequence,
  Patterns, Comparison and Logs now join Affect, Engagement, Gaze, Position,
  Heart & breathing and experimental Attention in opening with aligned summary
  metrics; conditional and variable grids no longer leave orphan cards.
- Refined `/diagnostics` from nested metric grids into four equal sensor
  cards, each with one primary reading, one quality bar and compact evidence
  rows. Lighting quality now lives here with exposure, stability and clipping;
  missing measurements remain visibly absent, and the live AOI test and raw
  payload remain available.
- Fixed the Live **Heart rate & breathing** card so its header reflects both
  pipelines and the capture state. Heart-rate buffer readiness now reaches the
  UI: a full buffer with a rejected estimate reports **check signal** instead
  of remaining **acquiring** forever.
- Added a real-session **Sensor test** screen at `/diagnostics` for camera
  delivery, gaze fixation/AOI events and respiration/RGB corroboration. It can
  apply a live left/centre/right AOI preset and exposes the exact aggregate
  evidence behind every readout.
- Closing the camera dock is now temporary and reversible: **Preview** in the
  permanent top bar and a conspicuous bottom-left restore handle both reopen
  it. The hidden state is no longer persisted across reloads.
- Added privacy-safe camera capability and decoded-frame timing windows
  (`capture_quality`), plus explicit host constraint control. Device IDs,
  group IDs and labels are stripped and rejected by validation. Delivery
  shortfall is bounded against the selected camera FPS, avoiding impossible
  loss percentages from browser compositor-counter discontinuities.
- Gaze AOI dwell now uses actual callback timestamps, breaks sequences across
  long gaps, and adds aggregate AOI entries/revisits/transitions, coarse I-DT
  fixations, scanpath length and an explicit sampling-adequacy gate.
- Respiration v2 retains the conservative green low-band estimator and adds
  decoded-frame sampling gates plus optional RGB-share corroboration. Strict
  corroboration is opt-in; existing green estimates remain the default.
- WebGazer's obsolete plain-HTTP modal is suppressed during adapter startup.
  Its check only exempts the literal hostname `localhost`, so it warned on
  valid loopback development origins such as `127.0.0.1` and told users who
  were already running a local server to run one. Only that exact dependency
  alert is filtered; other alerts and real `begin()` failures still propagate.
- **One top bar.** The app chrome was five stacked bands — session-context
  pills, workflow nav, filter bar, page header, and (on Analyze) a row of nine
  domain tabs — roughly **194 px of permanent furniture before any content**,
  a third of a 960 px viewport. It is now a **single 45 px bar**, and content
  starts directly beneath it. The rule applied: a band earns permanent
  vertical space only if you look at it on most screens. Navigation qualifies;
  session provenance, filter scope and the page's own name do not.
  - `TopBar` (brand + 8 pills) → **Session** popover (`SessionContextPanel`).
    Participant is edited inline there rather than behind its own nested
    popover, which was a keyboard focus trap.
  - `FilterBar` (scope / sessions / users) → **Scope** popover. The window
    count stays on the trigger — it is the one number worth seeing unasked,
    because it says whether a filter is hiding data.
  - Sub-navigation stays **visible**, not hidden: a single horizontal `SubNav`
    row appears beneath the bar inside Analytics and Settings, listing that
    section's destinations side by side (with the per-pipeline on/off dots for
    Settings). Collapsing them into dropdowns cut the level count but hid the
    map — you could no longer see what a section contained without opening
    something. Two bands inside those sections, one everywhere else, against
    the five we started with.
  - **"Analyze" is now labelled "Analytics"** — it is a place you go to look at
    results, not an action. The route stays `/analyze`, so deep links keep
    working.
  - `TopBar.tsx` and `SettingsTabs.tsx` are deleted. The active settings
    section is now derived from the router hash rather than mirrored into
    local state, so deep links, the menu and browser Back cannot drift apart.
- **Starting the camera navigates to Live.** The camera dock is reachable from
  every route, so you could start a capture from Settings or a retrospective
  Analytics view and see nothing happen — signal flowing, every readout for it
  on another screen.
- **`PageHeader` collapsed to one line** — the eyebrow ("Workflow · Step 4")
  is gone entirely, and title and description share a row. The H1 is retained
  deliberately: it is visually quiet but still the heading screen readers jump
  to, and `tests/app-runtime-contracts.test.js` pins that.
- **Settings page rebuilt.** It had grown to twelve flat sections in a single
  ~3,800 px scroll — a one-toggle pipeline carried the same visual weight as
  heart rate's eleven controls, and there was no navigation, no search and no
  way to see which pipelines were on without scrolling the whole page. The
  structure now lives in `standalone/app/src/lib/settingsNav.ts` as data
  (three groups: Core, Sensing pipelines, Session), and `routes/settings.tsx`
  renders by walking that list instead of hard-coding a sequence in JSX.
  Exactly one section is mounted at a time — the page went from **3,767 px of
  scroll to 862 px**, and 12 of the 13 sections now fit the viewport with no
  scrolling at all (heart rate, with nine controls, is the one exception, and
  is ~170 px over after the chrome collapse). Section selection lives in the
  horizontal `SubNav` row, which keeps the per-pipeline on/off dots and the
  `N/M pipelines on` count.
  Every control, store key and section id is unchanged, so saved profiles
  still work and `#settings-*` deep links still resolve — they now *open* that
  section rather than scrolling to it. `tests/settings-nav.test.js` asserts the
  nav and the page cannot drift apart and freezes the anchor ids.
  Dropping the scroll also removed the need for scroll-position tracking,
  along with both defects an interim version of it carried: it listened to
  `window` instead of the real scroll container (`<main class="overflow-auto">`),
  and its viewport band could never highlight the final sections, so the
  highlight froze mid-page.
- **`heart_rate_target_fps` is now editable** (ROI sampling rate, 5–30 fps,
  default 16). The library has had this setting all along, but the app's
  settings store never carried it — so there was no control, it was absent
  from `settings_hash`, saved profiles did not record it, and the rate was
  silently pinned to the library default. `tests/app-runtime-contracts.test.js`
  now asserts every key in `DEFAULT_SETTINGS` is forwarded by
  `oyonSettingsInput()`, which is the check that would have caught it: the key
  could otherwise exist, render, and persist while never reaching
  `createOyonSettings`, with no type error anywhere.
- Heart rate's ad-hoc `<p>` sub-headers became a reusable `<FieldGroup>`
  (Signal / Quality gates / Cross-window tracker), so the spacing is decided
  in one place rather than copied to the next section that needs it.
- The Settings "Privacy" section is now **Transport contract**. Its field list
  is unchanged and still accurate, but the old framing claimed the validator
  protects privacy — which contradicts the project's authoritative data policy
  (the app is explicitly *not* a privacy gatekeeper, and the validator is
  transport-shape sanity, never a censor). It now states plainly why those
  names are rejected: a window batch is a JSON summary, not a media channel.

### Added
- **Centrality beside the transition network**, with optional node sizing.
  The centrality view used to sit in its own section far below the graph, so
  reading "which state is central?" against "central how?" meant holding four
  numbers per state in your head. It now renders in a card beside the network;
  choosing a measure ranks its horizontal bars AND resizes the nodes, so the
  ranking and the picture are visibly the same claim. Only the selected
  measure appears in the bars; the other measures remain available from the
  node-size selector rather than being printed under a bar that does not encode
  them. Bar fills use the same emotion palette as the network nodes.
  Sizing **defaults to off** — size is the first channel the eye reads, and a
  diagram encoding something the reader did not ask for misleads more than one
  encoding nothing. When on, node **area** (not radius) is proportional to the
  value: circles grow with r², so mapping value straight onto radius would make
  a state with twice the centrality look four times as important and contradict
  the number printed beside it. Identical/zero values fall back to uniform
  sizing with an explanation rather than magnifying rounding noise.
  `renderNetworkGraph` gained an optional `nodeRadii` array; edge endpoints,
  arrowheads, self-loops and the layout radius all resolve per node, since
  trimming by one global radius buries arrowheads inside large nodes. The
  network renderer now receives its card's measured width and height instead
  of a fixed 960×500 canvas, so the graph expands with the equal-height cards
  rather than leaving a large empty lower half when centrality is taller.
- **Attention monitor** now sits directly beneath the summary statistics in the
  existing Gaze analysis instead of using a separate Analytics tab. The old `/analyze/monitor` path redirects to
  `/analyze/gaze`, preserving saved links without keeping a duplicate view.
  It plots aggregate gaze centroids on a scale drawing of the screen and follows
  ChatOyon's centroid map: Oyon's centered `[-0.5, 0.5]` gaze coordinates are
  translated into screen positions, dot area reflects the gaze samples in the
  window, and the thirds grid matches the 3×3 gaze-zone reference. The single
  ChatOyon hue is replaced by Oyon's shared emotion palette, so each centroid
  is coloured by the dominant emotion from the same window. A companion map
  keeps the same positions but uses hollow, emotion-coloured hearts sized by
  the preferred per-window heart rate (`bpm_tracked`, then robust/raw fallback).
  A fixed 72 BPM reference gets the standard radius; circles shrink below and
  grow above it. The reference is deliberately small and faint, while larger
  deviations become brighter. Windows without a valid BPM are omitted from
  that map. The two maps use equal-height cards in the same full-width 50/50
  grid as every visualization row below, so all card edges align.
- The Affect dynamics transition-matrix and n-gram cards were removed; n-grams
  already have an authoritative, richer home in the Patterns tab. Responsive
  state-frequency bars now share a two-card row with TNA.js's transition
  sunburst, computed from the same session-safe sequence pool. This prevents
  the largest count/percentage label from clipping while giving the previously
  empty companion space a transition-focused view. Its equal-sector rose
  layout keeps low-frequency source states readable when one state dominates;
  colour uses bounded transition probability rather than a residual range that
  one extreme self-transition can wash out.
- The sequence index and state-distribution-by-timestep SVGs now share one
  responsive two-card row instead of each expanding across the full workspace.
  Their loose 200 px minimum-height wrappers were removed. Distribution x-axis
  ticks now show timestep 1 and then every 10 timepoints instead of labeling
  every stacked bar.
- **Position analytics was reduced from an instrumentation dump to a readable
  analysis page.** Six oversized KPIs became four compact non-duplicated
  measures; facing-screen percentage and head movement now have separate axes
  instead of dividing degrees by 30 to force unlike units together. The head
  orientation chart was completely rebuilt as a wide yaw × pitch density
  field: every valid window contributes to a bin, darker cells mean greater
  occupancy, and one crosshair marks the robust typical pose. A companion
  summary reports median yaw, pitch and roll, yaw/pitch pose-zone coverage, and
  excluded tracking extremes. A disclosed central-95% display range prevents
  one ±90° tracking failure from compressing the useful pattern into the
  origin; the separate facing-screen signal remains separate rather than being
  conflated with the pose-zone percentage. The default action-unit matrix shows the eight most
  active signals; all action units and raw blendshapes remain available in a
  collapsed advanced disclosure. The primary action-unit heatstrip fills its
  card; only the denser advanced heatstrips retain a width cap so their SVG text
  and row heights do not double in size. Duplicate posture KPIs were removed.
- **Respiration rate (rPPG low band)** — breathing rate from the 0.1-0.5 Hz
  band of the *same* facial-ROI colour stream heart rate already samples. No
  new sensor, no new model: `HeartRateRoiSampler` now fans one ROI read out to
  multiple consumers, so per-frame cost is unchanged. Scoped honestly as a
  learning-analytics trend, **not** a diagnostic measurement. The window is
  long by physics — frequency resolution is `1/T`, so telling 12 from 15
  breaths/min needs tens of seconds: 45 s analysis window, 25 s minimum, ~5 s
  updates. Recovers 10/14/18/22 br/min within 2 br/min against synthetic
  signals carrying a cardiac component it correctly ignores.
  `respiration_enabled` keeps the ROI sampler alive even when
  `heart_rate_enabled` is false. See `docs/RESPIRATION.md`.
- **Ambient illumination** (`illumination_enabled`, **on by default**) — not a
  signal about the learner but the covariate that says how far to trust every
  other signal, since rPPG, emotion confidence and gaze quality all degrade in
  poor light. One 32x18 canvas read per sample. Reports exposure, clipping,
  quality, and temporal **stability**; names two failure modes a
  mean-brightness check cannot see — `backlit` (crushed shadows *and* blown
  highlights averaging to a perfect mid-grey) and `unstable` (autoexposure
  hunting, which injects energy straight into the heart-rate band while
  looking fine on average).
- New public exports: `RespirationEstimator`, `RespirationAggregator`,
  `IlluminationEstimator`, `IlluminationAggregator`, `HeartRateRoiSampler`,
  plus the pure helpers `lumaStats`, `illuminationQuality`,
  `illuminationAssessment`, `sampleFrameLuma`, `meanDecimate`.
- App: **Position** and **Heart rate** are now separate Analyze tabs (they
  shared no axis, unit or reading); per-sample **Signals** tiles on Live;
  full settings for every sensing pipeline.

### Changed
- `heart_rate_target_fps` **20 → 16**. Comfortably above the 8 Hz Nyquist floor
  for a 240 BPM pulse, ~20% less CPU, and in this range rPPG accuracy is bound
  by lighting and motion long before frame rate.
- Analyze tabs lead with **Affect**, then **Affect dynamics** (was "Emotion
  dynamics" first). Route ids are unchanged, so deep links still resolve.
- The Live attention heatmap is **on by default** and rendered through a
  bilinear + blur pass instead of one hard-edged rect per grid cell. The
  opt-in toggle contradicted the project data policy ("No signal gates. No
  opt-in flags, no default-off events").
- Heart-rate "confidence" is relabelled **signal quality** everywhere. The
  value is `clamp01((snr - 1) / 9)` — a bounded index that saturates at
  SNR 10 — so "confidence 100%" claimed certainty webcam rPPG cannot have.
  The maths is unchanged; rescaling would shift a gate already tuned against
  real captures.

### Fixed
- **Analyze dropped 7 of the 14 action units.** The Position tab hardcoded 7
  names while the extractor emits 14, silently omitting `eye_squint`,
  `mouth_press` and both `brow_raise` variants — so a session whose loudest
  expressions were exactly those rendered as a blank strip. Keys are now
  discovered from the payload, and the raw blendshapes (also always emitted,
  never displayed) get their own strip.
- **The emotion timeline laid bars out by array index**, so a dropped window or
  a paused session rendered flush against its neighbours — a dropout looked
  identical to a clean run, which is the one question that strip is scanned
  for. Bars now sit on a time axis; short dropouts leave holes, long pauses
  collapse to a labelled break. Cadence is derived from each window's own
  duration, not from inter-window deltas — the latter is circular, because the
  dropouts being detected are what inflate those deltas.
- **`/live` reported pipelines as "off" that were enabled.** Before the first
  `start()`, `runtime.settings` fell back to bare library defaults (where every
  v3 pipeline is off) rather than the user's settings.
- **`snapshotSettings()` hand-listed all 16 keys twice**, so a new setting
  silently vanished from saved profiles with no type error. Now enumerates
  `DEFAULT_SETTINGS`.
- Window-summary grid rendered 8 tiles in a 6-column grid (6 + 2 orphans). The
  column count is now derived from the tile count.
- The Live gaze tile truncated every readout to a single character
  (`QUALITY 1`, `STATE o…`) in a 3-up card; the posture figure drew an
  unmeasurable lean as a confident upright torso.


## 2.2.0 — 2026-06-29

### Added
- **Host-neutral integration front door** — Oyon now attaches to any host
  (LMS, analytics platform, anything with a session) without Rohy-shaped
  naming: `createOyonAttachment` (`oyon/attach`), the `useOyon` React hook
  (`oyon/react`), and `createOyonAddon` (`oyon/addon`). Unlike the Rohy
  factories, these **preserve arbitrary context keys** (`course_id`,
  `activity_id`, `cohort`, …) on every window instead of squeezing identity
  into four fixed fields — so a host keeps its own join taxonomy. The Rohy
  APIs (`createRohyFerAttachment`, `useRohyFer`, `createRohyOyonAddon`,
  `oyon/adapter`) are now thin **back-compat wrappers**;
  `createOyonAddon({ rohy: true })` selects Rohy's endpoint + session shape
  and the addon exposes a `variant` (`'oyon' | 'rohy'`). New
  `tests/oyon-attach.test.js` and `tests/oyon-addon.test.js` in the gate; a
  host-neutral Next.js recipe (client component + App-Router batch endpoint)
  in `examples/nextjs/`.
- **Compatibility doc** (`docs/COMPATIBILITY.md`): the durable
  supported/out-of-scope-by-construction matrix, browser table,
  secure-context + CSP requirements, gaze-engine licensing, and a
  pre-integration checklist — the honest "where Oyon runs" statement.
  **Documentation index** (`docs/README.md`) maps all docs by goal
  (canonical vs. historical). README gains a "Where it runs" requirements box.
- **Gaze Calibrate button** in the standalone app's camera dock
  (`CalibrateButton`): surfaces the 9-point calibration flow wherever capture
  is live and gaze is enabled (previously only reachable from Settings).
- **Integration manual** (`docs/INTEGRATION_MANUAL.md`): the end-to-end
  guide for adding Oyon to an existing system — mode selection (embed /
  React / headless / addon / CDN), the full window-payload schema, and
  four analytics destinations: local-only IndexedDB, the host's existing
  database (additive 3-table schema with a Postgres DDL translation,
  batch-endpoint contract, idempotency, consent, query examples), a
  separate analytics service (CORS/auth/ownership trade-offs spelled out),
  and event-stream ingestion. Plus assets/CSP, privacy checklist,
  verification steps, and a troubleshooting table. README and
  docs/INTEGRATION.md now point at it.
- **Claude Code agent skill** (`.claude/skills/integrate-oyon/SKILL.md`):
  a playbook that lets a Claude agent perform the integration in a host
  repo — survey the stack, drive the three decisions (mode, data
  destination, signals), implement per mode, and verify against the store
  rather than the UI, with the known pitfalls encoded.
- **Comprehensive test harness** (docs/TESTING.md): three layers — the
  33-suite node chain (now incl. `exports-map.test.js` packaging contract
  and a MediaPipe CDN-pin↔installed-version drift guard in
  `wasm-paths.test.js`), the build/typecheck gates, and a new **Playwright
  E2E suite** (`npm run test:e2e`, ~1 min) that runs real MediaPipe/ONNX
  inference in Chromium against a synthetic canvas face: standalone capture
  journey (identity stamping, IndexedDB persistence, camera release,
  restart = new session), FilterBar scoping over seeded multi-user data +
  session export, and the full `<oyon-app>` embed contract (host history/
  style isolation, late `getToken` auth against a mocked backend,
  session-id coherence, teardown on removal, local-first persistence under
  backend failure). `npm run test:all` runs everything.
  `@playwright/test` added as a dev-only dependency.

## 2.1.0 — 2026-06-11

### Added
- **`<oyon-app>` embeddable element** (`oyon/app-element` subpath +
  `standalone/app/dist-element/oyon-app.element.js`): the full branded Oyon
  app — capture dock, live view, every analytics dashboard, settings — as a
  single custom element. Shadow-DOM isolated (host styles stay out, Oyon
  styles stay in), memory-history router (host URL untouched), one script
  tag + one tag to integrate. Models/WASM load from public CDNs by default
  (no asset step); `asset-base` for self-hosted/CSP setups. Host API:
  `user-id`/`user-label`/`session-id`/`api-base-url`/`page` attributes,
  `getToken` property, `start()`/`stop()` methods, `oyon:window` /
  `oyon:status` composed events. Docs: `docs/EMBEDDING.md`; demo host page:
  `examples/embed-host.html`. Built by `npm run app:build:element`
  (`vite.element.config.ts` — additive; the standalone app build is
  untouched).
- **FilterBar — scope/session/user filtering for all dashboards.** Analyze
  and Sessions views now inherit a shared filter: scope `Current` (live
  session) / `Past` / `All` (aggregated), plus session and user
  multi-selects (user select appears when >1 distinct `user_id` exists).
  Pure filter logic in `standalone/app/src/lib/filterWindows.js`
  (node-tested), store in `filterStore.ts`, composition in
  `useFilteredWindows.ts` (enrich first, filter second — dynamics stay
  computed over the true timeline).
- **Identity capture.** New identity store; the runtime's contextProvider
  reads it live, so `user_id` is stamped per window (was hardcoded
  `'standalone-user'`). Standalone: the Participant pill in the TopBar is
  now editable. Embedded: the `user-id`/`user-label` attributes drive it.
- **Local-first optional sync.** When the element gets `api-base-url`
  (+ `getToken`), windows tee to `HttpEmotionTransport` wrapped in
  `FallbackEmotionTransport` — IndexedDB stays authoritative, remote
  failures never lose windows (`standalone/app/src/lib/syncTransport.ts`).
- Tests: `tests/app-filter-windows.test.js`, `tests/app-tna-pooling.test.js`,
  `tests/app-embed-contracts.test.js` (32-suite chain).

### Changed
- **Sequence/TNA pools per session.** The sequence dashboard builds one
  emotion-state chain per session and pools transition counts (dynajs
  `tna()` over multiple sequences) instead of merging all windows into one
  mega-sequence — aggregating distinct sessions no longer fabricates a
  transition between one session's last state and the next session's first.
  Multi-session transition counts/centralities change accordingly.
- Sessions view respects the FilterBar scope.

### Fixed
- `MEDIAPIPE_TASKS_WASM_CDN` pointed at `@mediapipe/tasks-vision@0.10.22`,
  which was never published as stable (only RCs) — the CDN default 404'd
  for any consumer that relied on it. Now pinned to 0.10.35 (the version
  this repo installs and the element bundles), with a drift-guard test
  asserting the pin matches the installed package.

### Fixed (post-review hardening, same release)
- **Element bundle no longer touches host history at import.** `router.ts`
  constructed a browser-history router at module level, which (inside the
  element bundle's import graph) called `history.replaceState` on the host
  page, monkey-patched `window.history.pushState/replaceState`, and added
  global listeners even when `<oyon-app>` was never mounted. Routers are
  now constructed only inside the entry points (verified live: fresh host
  page keeps `history.state === null` and native push/replaceState).
- **Trailing-slash WASM URL normalized in the library**
  (`MediaPipeFaceTracker.normalizeWasmBaseUrl`): zero-config consumers no
  longer fetch the 400-ing `wasm//vision_wasm_internal.js` (the prior fix
  only covered the app's own call site).
- **`asset-base` now matches the CLI layout** (`{base}/models/mediapipe/
  face_landmarker.task`) and `docs/EMBEDDING.md`'s recipe no longer doubles
  the `oyon/` segment; documented that WebGazer's vendor tree must be
  copied manually (the CLI doesn't produce it).
- **`getToken` is read lazily per request** — setting `el.getToken` after
  the element connects (the documented recipe) now works; previously the
  provider was snapshotted (and discarded) at connect time, silently
  sending unauthenticated sync requests.
- **`session-id` override is coherent**: resolved once at capture start
  into the same id used by stored windows, the `oyon:window` event, and the
  FilterBar's Current scope (previously windows carried the override while
  events/scope used the generated id). Documented as applying at next
  capture start.
- **Removing `<oyon-app>` from the DOM stops capture** (deferred via
  microtask so host re-parenting moves survive); previously the camera
  kept running with no handle left to stop it.
- **Session export matches the displayed row**: exports now use the same
  FilterBar-scoped windows and the same session-id derivation as the list
  (previously raw unfiltered data with a divergent predicate — wrong or
  empty bundles).
- `oyon paths` and the docs now print/reference the live CDN constants
  instead of hardcoded stale pins.
- Shadow stylesheet is parsed once and adopted idempotently (re-parenting
  no longer re-parses or accumulates duplicate sheets); shared
  enrichment/summary caches stop the FilterBar and routes from duplicating
  the full dynamics pass per window batch; `tnaPooling` now derives session
  identity from the same helper the filter layer uses.

## 2.0.0 — 2026-06-10

The **v2 line**: emotion + engagement + screen-point gaze, consolidated on
`main`. The emotion-only line lives on branch `v1` (1.0.0).

### Breaking
- **Default `gaze_engine` is now `'mediapipe'`** (was `'webgazer'`), and
  unknown engine names normalize to `'mediapipe'` (was `'webgazer'`). The
  MediaPipe landmark engine derives gaze from the face tracker the runtime
  already runs — one camera, one FaceMesh lifecycle, no WebGazer
  global-singleton state. WebGazer and WebEyeTrack remain fully supported as
  explicit opt-ins (`gaze_engine: 'webgazer' | 'webeyetrack'`); hosts that
  need calibrated screen-point accuracy should keep opting into WebGazer.
  Motivated by the chatoyon host-integration post-mortem: 2500+ persisted
  windows with emotion + engagement but zero gaze blocks while WebGazer was
  nominally "running".
- **Enabled-but-empty gaze windows now emit honest empty blocks.** When
  `gaze_tracking_enabled` is on and the pipeline is available, in-loop window
  boundaries always attach a `gaze` block — a dry window carries
  `n_points: 0, total_frames: 0, valid_frame_ratio: 0` instead of silently
  omitting the key. Consumers that treated the absence of `gaze` as "gaze
  off" should check `n_points` instead. (The stop()-flush window still omits
  an empty block — no gaze-only noise at shutdown.)
- Gaze windows now carry an engine-accurate `model_version`
  (`mediapipe-landmarks` / `webgazer` / `webeyetrack-0.0.2`) instead of
  always `webeyetrack-0.0.2`.

### Added
- `MediaPipeLandmarkGazeAdapter` (`oyon/gaze/mediapipe-adapter`):
  calibration-free gaze from MediaPipe iris landmarks. Implements the
  standard adapter contract plus `handleFace(face, ts)`, `diagnostics()`
  (`adapterStatus`, `rawFrames`, `validSamples`, `invalidSamples`,
  `lastSampleAt`, `lastError`, `calibrationRuns`), and
  `requiresCalibration: false` (bypasses the runtime's
  `gaze_calibration_required` gate — the capability travels with the
  adapter, so host-injected face-derived adapters work without settings
  coordination). `dispose()` is idempotent and non-terminal: same-instance
  restart (stop → start → gaze flows again) is supported and tested.
- `EmotionRuntime.sampleOnce()` feeds every face-tracker result to any gaze
  adapter exposing `handleFace()` (capability-detected). Single-pipeline
  design: `CameraController → MediaPipeFaceTracker → emotion + engagement + gaze`.
- Structured absence logging: `oyon.gaze.persistent_empty` (warn, after 3
  consecutive empty windows, includes adapter diagnostics) and
  `oyon.gaze.gated_awaiting_calibration` (info, once, when the calibration
  gate suppresses gaze).
- `GazeAggregator.flush(end, meta, { emitEmpty })` — empty buffer can yield
  an honest zero window instead of null.
- `MockFaceTracker` accepts `irisOffsets: { l, r }` (+ `setIrisOffsets()`)
  and then returns a full 478-point landmark array whose geometry makes
  `extractEyeFeatures()` recover exactly those offsets.
- Tests: `tests/mediapipe-gaze-adapter.test.js` (lifecycle, mapping,
  clamping, blink rules, diagnostics, callback-error isolation, mock
  geometry round-trip) and `tests/runtime-mediapipe-gaze.test.js`
  (default-engine e2e without calibration, honest-empty + persistent-empty
  warning, gate logging, same-instance restart).
- Demos: both the vanilla demo and the React app expose the `mediapipe`
  engine in their gaze-engine selectors. The demos keep WebGazer as their
  own explicit default (calibrated screen-point accuracy + persistent
  calibration); the library default is `mediapipe`.

### Also shipped in 2.0.0 — gaze stages 5–8 (previously unreleased)

- Stage 5 of the screen-point gaze pipeline: a default calibration UI so hosts
  that just want to drop Oyon in don't have to render one themselves.
  - `GazeCalibrationDriver` in `src/ui/` — pure-JS state machine that walks
    through the 9-point sequence (configurable). Injected `clickDispatcher` /
    `setTimer` / `clock` keep it testable in Node without a DOM shim.
  - `<oyon-gaze-calibration>` custom element in `src/ui/GazeCalibrationOverlay.js`
    — full-viewport overlay that renders the moving target dot, dispatches
    synthetic `MouseEvent('click')` at each dot's pixel position to drive
    `webeyetrack@0.0.2`'s click-based calibration anchor, and emits
    `calibration:{start,show,capture,progress,complete,aborted}` DOM events.
    Esc aborts cleanly.
  - `GazeCalibrationPanel` in `src/react/` — thin React mirror over the
    custom element. Forwards DOM events as props; exposes `start()` /
    `abort()` via `useImperativeHandle`.
  - New subpath exports: `oyon/ui/gaze-calibration`,
    `oyon/ui/gaze-calibration-driver`, `oyon/react/gaze-calibration`.
  - Main entry re-exports `defineGazeCalibrationOverlay`,
    `GazeCalibrationDriver`, and `DEFAULT_CALIBRATION_POINTS`.
- Tests: `tests/gaze-calibration-overlay.test.js` (9 cases — order /
  click coords / abort / hook-throw / runtime failure surfacing).
- Stage 7 of the screen-point gaze pipeline: combined preview UI and
  React panel surface.
  - `standalone/preview.html` (new) — combined engagement + gaze demo
    with synthetic input. Adds a 'Gaze' panel (3x3 zone heatmap, status
    badges, live moving dot inside a synthetic viewport box) and a
    'Calibrate (overlay demo)' button that runs the Stage 5 overlay
    against the runtime + `MockWebEyeTrackAdapter`. Drives a scripted
    gaze sample per tick via `mockAdapter.emitSample(...)` so gaze
    blocks accompany every engagement window.
  - `standalone/engagement-preview.html` — turned into a meta-refresh
    redirect to `preview.html`; existing bookmarks keep working.
  - `src/react/EmotionCapturePanel.js` — extended with two compact
    subpanels (engagement headline + gaze histogram). Surface is
    additive: consumers not running engagement / gaze see the same
    minimal panel as before. Uses `useRohyFer`'s existing `lastWindow`
    hook, no new React surface.
- Tests: `tests/standalone-preview-data.test.js` (4 cases — locks in
  the preview's data path so a refactor that breaks it catches at
  `npm test` rather than in a browser nobody opens in CI; case D is a
  real-time regression for the runtime fix below).

### Fixed
- `EmotionRuntime` was dropping the gaze window that
  `GazeAggregator.consumeFrame()` returns when wall-clock crosses
  `aggregate_window_ms`. The runtime then called `flush()` at the
  emotion-window boundary, found the buffer empty (already drained by
  the auto-flush), and emitted windows without a `gaze` block. The bug
  hid behind synchronous tests because wall clock barely advances in a
  tight `for` loop — only a `setInterval`-paced consumer (any real-time
  demo, including `standalone/preview.html`) triggered it. Fix:
  `_handleGazeSample()` now captures the auto-flushed window and stashes
  it; the three emission paths (`sampleOnce`, `addMissingSample`,
  `stop`) drain the stash via a new `_consumeGazeWindow(ts)` helper
  before falling back to an explicit `flush()`. Regression covered by
  case D of `tests/standalone-preview-data.test.js`, which uses real
  `setTimeout` to advance wall clock.

### Notes
- The real `WebEyeTrackAdapter.calibrate()` still returns
  `'upstream_calibration_requires_click_events'`; the overlay is the
  workaround that drives the worker via synthetic clicks. When
  `webeyetrack` ships a programmatic calibration API, the adapter can be
  simplified and the overlay can become optional rather than required.

## 0.4.0 — 2026-05-13

Opt-in screen-point gaze pipeline. When enabled and the user has calibrated,
each aggregate window payload gains a `gaze` block describing where on the
screen the user looked during the window — as aggregate statistics
(centroid, dispersion, zone proportions, AOI dwell), never raw points.

### Added
- Screen-point gaze pipeline (opt-in via `gaze_tracking_enabled` setting).
  - `WebEyeTrackAdapter` in `src/inference/` wrapping the optional peer
    `webeyetrack@^0.0.2` (MIT, Vanderbilt + Trinity + St. Mary's, 2025;
    arXiv:2508.19544). Lazy-imports the dep at `init()` so it remains
    truly optional.
  - `MockWebEyeTrackAdapter` in `src/mocks/` implementing the full
    adapter contract for tests, demos, and runtime smoke checks.
  - `GazeSmoother` in `src/smoothing/` — EWMA on (x, y) with a quality
    gate; below-threshold or blink samples pass through with
    `smoothed: false` and do not advance state.
  - `GazeAggregator` in `src/aggregation/` — window roll-up emitting
    `{ n_points, centroid, dispersion, zone_proportions (3x3 named or
    NxN indexed), aoi_dwell_ms, calibration_age_ms, calibration_quality,
    valid_frame_ratio, off_screen_ratio, model_version }`. Scalar-only
    buffer, no upstream object references retained.
  - `EmotionRuntime` wiring: adapter callback → smoother → aggregator;
    force-flush at the emotion window boundary so all blocks describe
    the same window. New `runtime.calibrateGaze(points)` programmatic
    API; new status events `gaze:calibrating`, `gaze:calibrated`,
    `gaze:calibration_failed`; new logs/metrics
    (`oyon.gaze.window`, `oyon.gaze.calibration_quality`,
    `oyon.gaze.dispersion`).
  - New subpath exports `oyon/gaze` → `GazeAggregator` and
    `oyon/gaze/adapter` → `WebEyeTrackAdapter` (types from
    `types/gaze.d.ts`).
  - Main entry re-exports `GazeSmoother`, `GazeAggregator`,
    `WebEyeTrackAdapter`, and `normalizeGazeResult`.
- Eight new settings (all default-off / opt-in):
  `gaze_tracking_enabled`, `gaze_window_share`,
  `gaze_calibration_required`, `gaze_min_calibration_samples`,
  `gaze_min_quality_score`, `gaze_zone_grid`, `gaze_aois` (validated
  rectangles, max 32), `gaze_drop_off_screen`. Toggling
  `gaze_tracking_enabled` changes `settings_hash`.
- Validator (`oyon/validation`):
  - New `validateGazeBlock` enforcing the aggregate-only contract.
  - Top-level deny `gaze_points_raw` (already in 0.3.0); inside the
    `gaze` block adds explicit denies for `gaze_raw`, `gaze_trace`,
    `points`, `points_raw`, `eye_patch`, `eye_image`.
  - Naming-convention deny for any `gaze.*_array|*_trace|*_raw` key.
  - Array length cap (≤100) inside `gaze` as defense in depth.
  - Validates centroid range `[-0.6, 0.6]`, zone-proportion keys (all
    3x3 named or all `r<n>c<n>`), AOI dwell shape, ratio fields.
- Optional peer dep: `webeyetrack` (`peerDependenciesMeta.webeyetrack.optional`).
- `docs/SCREEN_POINT_GAZE.md` — reference doc covering payload, settings,
  privacy invariants, AOI configuration, calibration, host integration,
  known limitations, and "bring your own adapter" extension path.

### Compatibility
- Default-off invariant: `gaze_tracking_enabled: false` (the default) is
  byte-equivalent to v0.3.0 window output. No required changes for
  existing consumers.

### Tests
- 20 suites pass (added `web-eye-track-adapter`, `gaze-smoother`,
  `gaze-aggregator`, `runtime-gaze`; extended `validation` and `settings`).

## 0.3.0 — 2026-05-13

Opt-in eye-tracking pipeline. Per-window engagement metrics (blink rate, eye
openness, head-pose-normalized gaze entropy, gaze zone proportions, derived
focus score) alongside the existing affect signals.

### Added
- Eye tracking pipeline (opt-in via `eye_tracking_enabled` setting).
  - `EyeFeatureExtractor`, `EyeSmoother`, `EngagementAggregator` in
    `src/inference/`, `src/smoothing/`, `src/aggregation/`.
  - New subpath export `oyon/engagement` resolving to
    `src/aggregation/EngagementAggregator.js` (types from
    `types/engagement.d.ts`).
  - Main entry re-exports `extractEyeFeatures`,
    `normalizeIrisByHeadPose`, `classifyGazeZone`, `EyeSmoother`, and
    `EngagementAggregator` for hosts that import from `oyon` directly.
  - Per-window `engagement` block carrying blink rate, eye openness
    (mean + std), head-pose-normalized gaze entropy, gaze zone
    proportions, and a weighted focus score. The composite score's
    component values are emitted alongside it.
  - MediaPipe blendshapes + facial transformation matrix surfaced on
    the tracker result (always; cost is negligible).
- Settings: `eye_tracking_enabled`, `blink_mask_threshold`,
  `gaze_zone_neutral_deg`, `engagement_window_share`,
  `blink_rate_baseline_hz`, `gaze_entropy_grid_n`,
  `focus_score_weights`.
- Validator: rejects `iris_landmarks_raw`, `gaze_points_raw`,
  `pupil_diameter_px`, and any key starting with `eye_image_` — both
  at the top of an event and inside the `engagement` sub-object.
- TypeScript declarations: `types/engagement.d.ts` (new) and
  re-exports from `types/index.d.ts`. `EmotionWindow.engagement` is
  now typed as optional.
- Docs: `docs/EYE_TRACKING.md` covering pipeline, metric formulas,
  head-pose normalization, blink masking, settings, and limitations.
- Example backend: server-side validator stub in
  `examples/rohy-backend/emotion-routes.template.js` mirrors the new
  client deny-list.
- Example addon migration: optional `engagement_metrics JSONB`
  column appended to `examples/rohy-addon/001_oyon_addon.sql`.

### Notes
- `eye_tracking_enabled` defaults to `false`. Existing v0.2.2
  consumers see no behavior or payload change.
- Hosts that persist windows server-side may want a JSON column for
  the new `engagement` field; the column type, retention policy, and
  indexing are the host's choice. Oyon does not prescribe a schema.

## 0.2.2 — 2026-05-09

Self-hosted asset URLs available as opt-in alongside public CDN defaults.

### Added
- `assets-v1` GitHub Release on `mohsaqr/Oyon` mirrors all 17 runtime
  asset files (WASM bundles + ONNX model weights, ~163 MB total).
- New exports from the main entry: `SELF_HOSTED_ONNX_RUNTIME_WASM`,
  `SELF_HOSTED_MEDIAPIPE_TASKS_WASM`,
  `SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL`,
  `SELF_HOSTED_EMOTION_MODEL_*_URL`,
  `SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL`, and `SELF_HOSTED_DEFAULTS`
  (frozen object holding the full set). Hosts pass these explicitly to
  swap from public CDNs to the self-hosted release.
- `OYON_ASSETS_BASE` env var lets `npx oyon download-models` pull from
  any base URL, including the self-hosted release once available.

### Unchanged
- Default `cdnDefaults.js` URLs still point at the public CDNs
  (jsDelivr / Google Storage / raw.githubusercontent). The repo is
  currently private, so release-asset URLs require auth — flipping
  the default to self-hosted requires the repo to be public first.

### Why "keep both"
- Public CDNs work today, zero-config, no auth.
- Self-hosted release is ready for the day the repo flips to public —
  at that point switching the runtime default is a one-line change in
  `cdnDefaults.js` (or hosts can opt in already by passing
  `SELF_HOSTED_DEFAULTS` to `EmotionRuntime`).
- GitHub Releases bandwidth is unlimited and free, unlike Git LFS
  (1 GB/mo on the free tier).

### Asset release strategy
- The asset tag (`assets-vN`) is bumped only when underlying WASM or
  model versions change, NOT on every code release.

## 0.2.1 — 2026-05-09

Zero-config defaults — `npm install oyon` is now sufficient to run.

### Added
- `src/config/cdnDefaults.js` — single source of truth for fallback CDN
  URLs (jsDelivr for WASM, Google Storage for MediaPipe model, GitHub raw
  for emotion models). Exported from the main entry as
  `ONNX_RUNTIME_WASM_CDN`, `MEDIAPIPE_TASKS_WASM_CDN`,
  `MEDIAPIPE_FACE_LANDMARKER_URL`, `DEFAULT_EMOTION_MODEL_URL`, etc.

### Changed
- `MediaPipeFaceTracker` defaults `wasmBaseUrl` and `modelAssetPath` to
  CDN URLs instead of `'/models/mediapipe/...'`.
- `OnnxEmotionClassifier` defaults `wasmPaths` and `modelUrl` to CDN
  URLs; default labels and indices now match the HSE B0 8-class MTL
  model (was a stale 7-class FER list pointing at a non-existent path).
- All four model config files (`HSE_*`, `EMOTIEFF_MOBILEVIT_*`,
  `EMOTIEFF_MBF_*`) now reference the CDN constants instead of
  `/standalone/models/...` repo-relative paths.

### Migration
- Hosts that already self-host assets and pass explicit `wasmBaseUrl` /
  `modelUrl` options are unaffected.
- Hosts that relied on the (broken) default `'/models/emotion/fer.onnx'`
  path now get a real working model on first start.
- For CSP-restricted hosts that need to block third-party CDNs:
  `npx oyon install-assets ./public && npx oyon download-models ./public`,
  then pass `mediaPipe.wasmBaseUrl: '/oyon/vendor/mediapipe/wasm/'` etc.

## 0.2.0 — 2026-05-09

Packaging release — Oyon is now consumable as a published npm package.

### Added
- **Distributable build** via Rollup: `dist/oyon.esm.js` (single-file ESM,
  ~70 KB), `dist/oyon.umd.js` and `dist/oyon.umd.min.js` (~42 KB minified)
  for `<script>`-tag CDN use. Source maps included.
- **TypeScript declarations** under `types/` for every subpath export,
  enabling IntelliSense and module resolution from TS hosts.
- **CLI** (`npx oyon …`): `install-assets <dir>` copies MediaPipe + ONNX
  Runtime WASM from peer-installed `node_modules/` into the host's public
  dir; `download-models <dir>` fetches model weights from upstream;
  `paths` prints resolved peer-dep asset locations.
- **CDN example** at `examples/cdn/index.html` showing UMD + jsDelivr
  consumption with no build step.
- **Conditional `exports`** map: each subpath now resolves `types`,
  `import`, and `default` properly across Node, bundlers, and TS.
- **GitHub Action** at `.github/workflows/publish.yml` — tag-triggered
  publish with provenance and `prepublishOnly` gates (check + tests +
  build).
- **`/bundle` subpath** export that points at the single-file ESM build,
  for environments that can't follow the multi-file source tree.
- `unpkg` and `jsdelivr` package manifest fields for CDN auto-routing.

### Changed
- `package.json` — removed `private: true`; added `module`, `types`,
  `unpkg`, `jsdelivr`, `bin`, `sideEffects`, `engines`, `homepage`,
  `bugs`, `publishConfig`. React peer dep relaxed from `^19` to `>=18`.
- `files` array trimmed: `standalone/`, `mock/`, `tests/`, `docs/`, and
  `examples/` no longer ship in the npm tarball. Tarball drops from
  ~157 MB → 170 KB compressed (760 KB unpacked).
- Added `.npmignore` as belt-and-suspenders against accidental publishes
  of the asset tree.

### Migration
- Hosts using the workspace install today don't need to change anything;
  imports remain `import { useRohyFer } from 'oyon/react'`.
- Hosts that were copying `standalone/vendor/*` should switch to either
  `npx oyon install-assets ./public` (copies from peer deps) or point
  Oyon's runtime at the jsDelivr CDN URLs.

## 0.1.0 — 2026-05-08

Initial public extraction from the rohySimulator workspace.

### Added
- Standalone browser demo with MediaPipe + ONNX Runtime Web pipeline.
- EmotiEffLib MobileViT emotion model with MediaPipe face tracking.
- EmotiEffLib MobileFaceNet MTL as an experimental alternative profile.
- HSEmotion EfficientNet-B0 MTL as the default benchmark-backed profile.
- Live UI: face overlay (DOM-positioned), affect circumplex, valence/
  arousal trace timeline (60 s rolling), settings drawer, FPS / latency
  / sample telemetry strip.
- React hook (`oyon/react`) and adapter (`oyon/adapter`) for attaching
  to a host app.
- Payload validator (`oyon/validation`) that rejects raw frame fields.
- Backend templates for an Express host: SQL migration + emotion-routes
  module, in `examples/rohy-backend/`.
- Documentation: design overview, implementation plan, integration plan,
  model selection rationale, host-side integration mock.

### Privacy / governance posture
- No raw frames stored; validators on both ends enforce the rule.
- Per-session opt-in; one-click pause / stop releases the camera.
- EU AI Act Art. 5 caveats documented in the integration plan.
