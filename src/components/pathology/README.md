# Rohy Pathology — integration spec

A drop-in Pathology room for Rohy: a sixth peer alongside Patient,
Examination, Laboratory, Radiology and Consultant.

**This package deliberately rebuilds nothing Rohy already owns.** Everything
below is reused, not reimplemented:

| Need | Rohy already provides | This package adds |
|---|---|---|
| Structured logging | `learning_events` (xAPI: verb / object_type / component / result / duration_ms / context / severity / category / room / plugin_id) | 23 pathology verbs (20 emitted, 3 planned), 9 object types, `Pathology*` components |
| Analytics / TNA | `analytics-routes`, `learningEventAggregates.js`, `clinicalStates.js` | rows for the three published extension maps |
| Assessment | `surveys`, `survey_questions`, `survey_responses` | read-process scoring, which surveys cannot express |
| Cohort tracking | `cohorts`, `cohort_members`, `cohort_cases`, `lesson_progress` | nothing — pathology cases attach as cohort cases |
| Instructor authoring | TipTap lesson editor + `EmbedNodeExtension` (`<lecture-embed>`) | an embeddable route, so a slide is just another embed |
| Auth / roles / tenancy | `auth-routes`, 5-rank hierarchy, `tenant_id` on every row | nothing |
| Proctoring signals | `LOST_FOCUS` / `RESUMED_FOCUS` verbs, `audit-chain.js`, session idle expiry | an `examMode` prop that suppresses hints |
| LLM access | `llmService` (local + cloud providers, keys, timeouts) | an injection point for undecided grades |

The one thing no existing Rohy component can do is score **how a slide was
read**. That is what `readAssessment.js` is for, and it is the reason this
package exists.

---

## Where this package lives

**Upstream is `~/Documents/Github/Pathoyon/pathoyon`** (its own git repo, its
own `npm test`, `INTEGRATION.md` / `VIEWER.md` / `CASE_FORMATS.md`). This folder
is a **byte-identical copy of its `src/`** plus two rohy-only files — this
README and `portability.test.js`. Do not edit the package here; edit upstream
and re-vendor:

```
npm run vendor            # every vendored package
npm run vendor -- pathology       # just this half
npm run vendor:check      # verify the stamps, and report staleness
```

`.vendor.json` in this folder records which upstream commit this is and a hash
of its contents. `tests/server/vendored-packages.test.js` fails the build if the
copy is edited in place or the stamp is missing — see **RPS-1 §16**.

> **The path moved once, and the old command was destructive.** Until v2.9.83
> this README documented an `rsync --delete` from
> `Pathoyon/rohy-pathology/src`, a path that the rename to Pathoyon had turned
> into a stray `.vite` cache — so the documented command **emptied this folder**.
> rsync has no notion of "this source looks wrong": an empty source is a valid
> instruction to empty the destination. The tool refuses to run unless the
> source actually holds the package.

Rohy's ESLint ignores this folder (like `OyonR/`) because its lint posture is
upstream's. Rohy's gate is `portability.test.js`: every import is a file inside
this folder or one of react / react-dom / openseadragon / lucide-react. Rohy's
services (`eventLogger`, `t`, the persistence callback) arrive as props through
the RPS-1 adapter in `src/plugins/pathology/`.

---

## The seam

Nothing in this package imports from Rohy. Rohy's services arrive as props:

```
PathologyRoom({ pathologyCase, eventLogger, llmService, examMode })
                                ^^^^^^^^^^^  ^^^^^^^^^^
                                injected, never imported
```

That is what makes the folder droppable: delete
`src/components/pathology/` and Rohy's module graph is untouched, because
nothing in Rohy points into it except the two wire-up sites below.

---

## Install

### 1. Copy the package

```bash
cp -r Path/rohy-pathology/src  rohySimulator/src/components/pathology
```

One new dependency — the only one:

```bash
npm i openseadragon        # and copy its images/ to public/openseadragon/images/
```

### 2. Merge the event vocabulary — `src/services/eventLogger.js`

> **Superseded (RPS-1 1.6).** rohy folds the vocabulary through the plugin
> manifest (`src/plugins/pathology/manifest.js`, `vocabulary.version: 2`) into
> the shared registry `server/shared/learningVerbs.js`; nothing is merged into
> `eventLogger.js` by hand, and the room logs through `ctx.log`. The snippet
> below describes the pre-RPS-1 wiring and is kept for the history of the
> design. Upstream's `tests/vocabulary.test.js` and `tests/logger-contract.test.js`
> pin the vocabulary and the call shape.

```js
import { PATHOLOGY_VERBS, PATHOLOGY_OBJECT_TYPES, PATHOLOGY_COMPONENTS,
         PATHOLOGY_VERB_METADATA } from '../components/pathology/pathologyEvents.js';

export const VERBS        = { ...EXISTING_VERBS,        ...PATHOLOGY_VERBS };
export const OBJECT_TYPES = { ...EXISTING_OBJECT_TYPES, ...PATHOLOGY_OBJECT_TYPES };
export const COMPONENTS   = { ...EXISTING_COMPONENTS,   ...PATHOLOGY_COMPONENTS };
const VERB_METADATA       = { ...EXISTING_VERB_METADATA, ...PATHOLOGY_VERB_METADATA };
```

No collisions exist today — `tests/integration.test.js` asserts that against
Rohy's real `eventLogger.js` (90 verbs parsed) and fails the build if a future
Rohy release introduces one.

### 3. Merge the TNA state rows — `src/components/analytics/tna/clinicalStates.js`

This is exactly the extension the file's own header documents.

```js
import { PATHOLOGY_VERB_FALLBACKS, PATHOLOGY_OBJECT_OVERRIDES,
         PATHOLOGY_INTERPRETATIONS } from '../../pathology/pathologyStates.js';

export const VERB_FALLBACKS         = { ...BASE_VERB_FALLBACKS,   ...PATHOLOGY_VERB_FALLBACKS };
export const OBJECT_OVERRIDES       = { ...BASE_OBJECT_OVERRIDES, ...PATHOLOGY_OBJECT_OVERRIDES };
export const DEFAULT_INTERPRETATIONS= { ...BASE_INTERPRETATIONS,  ...PATHOLOGY_INTERPRETATIONS };
```

Prefer `mergePathologyStates()` if you want the collision check at boot — it
throws on a duplicate key instead of silently changing how existing events
resolve.

Without this step nothing breaks: `resolveClinicalState()` falls through to the
literal `OPENED_SLIDE_slide`, which is visible but useless in the network.

### 4. Register the room

Add `Pathology` to the room navigator with the same badge-dot treatment as
Laboratory, and route it to `<PathologyRoom … />`. The room name is stamped on
every event by `createPathologyLogger`, so `learning_events.room` and the
existing `idx_learning_events_room` index work with no schema change.

### 5. Serve the tiles

Deep Zoom output from the existing pipeline:

```bash
vips dzsave archive_10x/my_s360_10x.tif public/slides/my_s360 \
  --tile-size 512 --overlap 1 --suffix '.jpg[Q=85]'
```

**No schema migration is required anywhere in this integration.**

---

## What flows back and forth

**Rohy → pathology:** the case, the signed-in user, the session, the tenant,
`llmService`, and the room context — all through props and the existing
`eventLogger.setContext()`.

**Pathology → Rohy:** rows in `learning_events`, and nothing else. No parallel
store, no second analytics path. Every row carries `session_id`, `user_id`,
`case_id`, `tenant_id` and `room` because Rohy's logger stamps them, which is
why a pathology read and a lab order appear in one TNA sequence and the
transition between them is visible.

### Vocabulary

| Verb | object_type | severity | TNA state |
|---|---|---|---|
| `OPENED_SLIDE` / `CLOSED_SLIDE` | `slide` | IMPORTANT / INFO | assessing |
| `PANNED_SLIDE` / `ZOOMED_SLIDE` / `DWELLED_REGION` | `slide_region` | DEBUG | examining |
| `CHANGED_OBJECTIVE` | `slide` | INFO | examining |
| `REACHED_ROI` / `MISSED_ROI` | `slide_roi` | IMPORTANT | examining |
| `ANNOTATED_SLIDE` / `MEASURED_SLIDE` / `COUNTED_FEATURE` | `slide_annotation` / `slide_measurement` | ACTION | documenting / examining |
| `VIEWED_SPECIMEN` | `specimen` | INFO | examining |
| `SUBMITTED_DIAGNOSIS` / `SIGNED_REPORT` | `pathology_report` | CRITICAL | documenting |
| `REVISED_DIAGNOSIS` | `pathology_report` | IMPORTANT | documenting |
| `REQUESTED_SECOND_OPINION` | `pathology_report` | IMPORTANT | communicating |
| `STARTED_SLIDE_TASK` / `COMPLETED_SLIDE_TASK` | `slide_task` | IMPORTANT | regulating |
| `REQUESTED_HINT` / `RECEIVED_FEEDBACK` | `slide_task` | ACTION / INFO | reflecting |

Panning and zooming map to **examining**, not navigating. In pathology the
low-power screen followed by high-power confirmation *is* the examination —
the direct analogue of palpating a body region. Bucketing it as UI navigation
would erase the diagnostic act from the transition network.

`REACHED_ROI` and `MISSED_ROI` are the two rows a teacher's dashboard is built
on. `MISSED_ROI.result` carries the reason: `never_on_screen`,
`insufficient_magnification`, or `insufficient_dwell`.

---

## Read assessment

An answer key declares what the trainee was supposed to find, in **slide
(level-0) coordinates** so it survives re-exporting the tiles at any level:

```json
{
  "diagnosis": "invasive ductal carcinoma grade 2",
  "accept": ["IDC grade 2"],
  "requireTerms": ["carcinoma"],
  "rejectTerms": ["benign"],
  "screeningObjective": 5,
  "coverageObjective": 2,
  "tissueBounds": { "x": 20000, "y": 15000, "w": 70000, "h": 50000 },
  "roi": [
    { "id": "roi-invasion", "label": "Infiltrating nests",
      "x": 48000, "y": 39000, "w": 4000, "h": 4000,
      "minObjective": 10, "dwellMs": 2000, "critical": true }
  ]
}
```

`minObjective` is the load-bearing field: being *on* a focus at 2x is not
having seen it. `screeningObjective` splits low- from high-power time;
`coverageObjective` is the separate, lower floor at which a field counts
toward spatial coverage — 2x, because a pathologist screens at 2–4x but a
single 1x view spans most of the tissue and would score 100% without panning.

Measured on the bundled example case (`node demo.mjs`), two trainees giving
the **identical correct answer**:

```
                        Reader A            Reader B
                        (systematic)        (thumbnail guess)
answer                  CORRECT             CORRECT
key findings reached    3/3 (critical 2/2)  0/3 (critical 0/2)
slide coverage          90%                 28%
highest power           11.0x               3.0x
time to first critical  16.0s               never
READ SCORE              0.980               0.056
```

An answer-only grader cannot separate those two. Both critical findings for
Reader B are logged as `MISSED_ROI` with
`result: "insufficient_magnification"`.

Grading of the written diagnosis is deliberately conservative: an unlisted
phrasing returns `correct: null` — **undecided, not incorrect** — and is
escalated to Rohy's own `llmService` only if one is injected. A trainee is
never failed on a synonym the author did not anticipate.

---

## Instructor authoring — no new tool

A slide is embedded in a lesson with the editor Rohy already ships. Expose a
route (`/embed/pathology/:caseId`) and insert it as a `lectureEmbed`:

```html
<lecture-embed data-src="/embed/pathology/PATH-2026-0412" data-height="640"></lecture-embed>
```

Same-origin, so the session cookie applies and events log against the real
user. Pair it with an existing survey block for the written answer. Assignment
and progress are then `cohort_cases` and `lesson_progress` as usual.

## Proctored reads

`examMode` suppresses hints and revision. The integrity signal needs no new
code: Rohy's `LOST_FOCUS` / `RESUMED_FOCUS` verbs already record tab-switching
during the read, and `audit-chain.js` already makes the trail tamper-evident.

---

## Removing it

```bash
rm -rf src/components/pathology
```

Then drop the two spread-merges (steps 2 and 3) and the room registration.
Nothing else in Rohy references this package.

## Tests

```bash
node --test tests/*.test.js       # 55 tests
node demo.mjs                     # end-to-end, prints the table above
```

The two tests that read Rohy's source resolve it via `$ROHY_ROOT` (default
`~/Documents/Github/rohySimulator`) and skip cleanly when it is absent.
