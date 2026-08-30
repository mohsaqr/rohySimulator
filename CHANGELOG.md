# Changelog

All notable changes to rohy are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: bump versions with `npm version major|minor|patch` from the
repo root (this updates `package.json` + `package-lock.json` and creates a
tag in one step). Add a new section at the top of this file for every
release before tagging.

## [2.9.132] — 2026-08-30

### Fixed

- Release artifacts and CI checkouts pass the vendored-package stamp
  gate again (a Finder .DS_Store had been hashed into the ecg stamp);
  the vendor tool now ignores OS junk. Local-only knowledge-base tests
  skip on CI instead of failing on missing sources.

## [2.9.131] — 2026-08-30

### Fixed

- **The PACS room no longer crashes to the error boundary when switching
  studies while images are loading** — a missing frame renders as loading
  instead of throwing mid-render.
- Pending imaging orders announce their real state to screen readers.

## [2.9.130] — 2026-08-30

### Added

- **Ordering imaging now produces images.** Order a study in Radiology
  and the PACS room appears with that study — the case's changed
  version if the author configured one, otherwise the archive's normal
  example — honoring the turnaround clock, with a "View images in
  PACS" link on the radiology report. Studies without archive backing
  say so honestly.

## [2.9.129] — 2026-08-30

### Fixed

- **The ECG studio no longer demands a clinical-review sign-off** to
  publish, and no longer duplicates the case's patient details (age,
  vitals, history) inside the plugin — the case owns the patient.

## [2.9.128] — 2026-08-30

### Fixed

- **The ECG authoring studio can be saved, exited, and scrolled** — the
  host's Done/Discard controls now reach the studio's header slot, and
  the studio scrolls inside the authoring overlay.

## [2.9.127] — 2026-08-30

### Fixed

- A ~180 requests/minute `GET /api/patient-record` retry loop — the
  record-init effect no longer re-arms on every render.

## [2.9.126] — 2026-08-30

### Fixed

- **Radiology imaging works end to end.** The case editor lists rohy's
  full 74-study catalogue, relays the content origin's archive of real
  radiographs (with thumbnails), and the learner PACS room resolves and
  renders the authored study. Without a configured origin the editor
  says so instead of showing an empty catalogue. The series loader now
  accepts the origin's v2 indexes.

## [2.9.125] — 2026-08-30

### Fixed

- **You can exit the ECG and PACS rooms again, and the ECG room
  scrolls.** The workstation was viewport-sized inside a smaller pane,
  pushing the room navigator out of reach; the shell now takes its
  height from the host, the tracing stays put, and the interpretation
  rail scrolls in its own pane.

## [2.9.124] — 2026-08-30

### Fixed

- **`POST /api/sessions` dedup responses carry the full create shape**
  (id, case_id, user_id, student_name, tenant_id) plus the reuse note.
- e2e suite green end-to-end (91/0/14, three consecutive runs); new
  `ROHY_DISABLE_GENERAL_RATE_LIMIT` escape for test harnesses — never
  production.

## [2.9.123] — 2026-08-30

### Changed

- **Locale catalogues synced across all six languages**: review-session
  strings, 148 new PACS workstation keys (740 machine translations,
  flagged for native review in the status sidecars), and the ECG room
  vocabulary as ICU plurals.

## [2.9.122] — 2026-08-30

### Added

- **A 12-lead ECG reading room (Cardoyon) as the third RPS-1 plugin.**
  Educators author calibrated tracings from curated presets or uploads;
  learners record a structured read with notes and measurements; the
  rubric never reaches the learner's browser. Vendored and stamped like
  PACS and Pathology (`npm run vendor -- ecg` / `-- ecg-styles`).

## [2.9.121] — 2026-08-30

### Changed

- **PACS workstation lifted to Radoyon 0.3.1**: hanging layouts, real
  radiographs, compressed pixel decode (RLE/JPEG), reader's report pane,
  and the new two-library case editor.

## [2.9.120] — 2026-08-30

### Changed

- Pathology package re-vendored at upstream's hardening commit
  (`befc00c4`); stamps verified.

## [2.9.119] — 2026-08-30

### Added

- The help center and onboarding tour are fully localized (`help`
  namespace, six locales).

## [2.9.118] — 2026-08-30

### Fixed

- Oyon capture widget reports loading/local-only/error states honestly;
  the vendored element no longer throws at load when webgazer is absent.

## [2.9.117] — 2026-08-30

### Fixed

- **A rate-limited or 5xx token verify no longer logs you out** — only
  401/403 are definitive; everything else retries.
- Login/register errors carry status+code to the UI, localized.
- Profile password change enforces the same policy as the server.

## [2.9.116] — 2026-08-30

### Fixed

- Chat remembers the active agent tab; agent vs transport failures are
  distinguished in the banner.
- A failed tutor reply in the discussion room is surfaced as an alert
  instead of silently dropped.
- Config panel shows the effective discussant override.

## [2.9.115] — 2026-08-30

### Fixed

- TNA dashboard shows explicit empty states; the clusters spinner
  terminates when there is nothing to cluster.
- Patient-record context is memoised; storage registry dropped a dead key.

## [2.9.114] — 2026-08-30

### Fixed

- Patient monitor renders only vitals that exist — no NaN traces.
- Orders drawer dropped its retired labs surface (1142→267 lines).
- Treatment effects hook is referentially stable across ticks.
- Lab panel quick-search aliases use full test names (a bare "WBC"
  matched CSF tests into blood panels).

## [2.9.113] — 2026-08-30

### Fixed

- **Identity timestamps are UTC ISO** (migration 0052; automatic on boot,
  with the standard pre-migration backup).
- Students receive an allow-listed projection of agent templates — never
  educator prompt internals.
- Cohort member counts include only live student memberships.
- The model dropdown detects upstream catalogue additions.

## [2.9.112] — 2026-08-30

### Added

- **An error boundary around the app and each plugin room** — a render
  crash shows a localized retryable fallback instead of a white screen,
  and a plugin crash is contained to its room.

### Fixed

- Room-change events are stamped synchronously, so analytics ordering
  survives a crashing room.

## [2.9.111] — 2026-08-30

### Fixed

- Pale `-50` tint compatibility selectors no longer substring-match `-500`
  classes (24 selectors moved to whole-token `[class~=…]` matching).

## [2.9.110] — 2026-08-30

### Fixed

- **Alarm logging and notification persistence work again for
  cookie-authenticated users** — four dead pre-cookie token guards removed.
- Muting notifications (minSeverity, DND, source mutes) no longer stops
  backend persistence; "be quieter" is not "stop recording".

## [2.9.109] — 2026-08-30

### Fixed

- **A token refresh can no longer log you out.** Every JWT now carries a
  unique `jti`, and a refresh that cannot record its server-side session
  fails with 500 instead of silently revoking the caller's own token.
- The CSRF cookie TTL is derived from the same `authTtlSeconds` as the
  auth cookie (new `server/middleware/authTtl.js`).

## [2.9.108] — 2026-08-30

### Changed

- **The lab catalogue moved out of the repo root, and the Docker special case
  went with it.** `Lab_database.json` and `heart.txt` sat at the root only
  because that is where they were first written — `radiology_database.json`,
  `treatment_effects.json` and `lab_loinc_mapping.json` have always lived in
  `server/data/`. They are now `server/data/lab_database.json` and
  `server/data/lab_cardiac_tests.txt`.

  The point is what this deletes. The Dockerfile carried two explicit `COPY`
  lines for these files, added after a release shipped with an empty lab table:
  the directory-level `COPY … /server ./server` missed them because they were
  not under `server/`. Those lines are gone. The files now travel with the
  directory that already ships, so the failure mode is structurally impossible
  rather than prevented by a comment someone has to keep reading.

  Five readers updated (`labDatabase.js`, `seed-lab-tests-from-json.js`,
  `clamp-turnaround-defaults.js`, `orders-routes.js`, `admin-routes.js`).
  Verified from the new path: 222 tests across 33 groups, cardiac set merged.

- `codecov.yml` → `.github/codecov.yml`, a location Codecov reads natively.

### Fixed

- **`POST /api/admin/seed/lab-tests` has never worked.** It read
  `../../Lab_database.txt` — a file that has never existed in this repository —
  and then `JSON.parse`d it, so the endpoint returned 404 on every call since it
  was written. It now reads the catalogue the rest of the platform uses.

## [2.9.107] — 2026-08-30

### Changed

- **The repository root is readable again.** It carried four superseded planning
  documents, two setup scripts still branded with the pre-rename product name, an
  agent note that should never have been committed, and roughly twenty untracked
  scratch files — notes, screenshots, `.docx` exports, air-gap tarballs and a
  built docs site. The root is the first thing a contributor reads.

  Planning docs moved to `docs/design/` (`i18n-plan.md`, `voice-2.0-plan.md`,
  `voice-defaults-plan.md`, `audio-improvements.md`) and the demo case to
  `docs/examples/`. **42 files** referencing them were updated — they are cited
  from source comments, migrations, scripts and tests, not only from docs.

  `SETUP_ENV.sh` / `.bat` removed: unreferenced, and still printing "VipSim
  Authentication Setup" from before the rename. `server/.env.example` plus
  `docs/INSTALL.md` have covered this for a long time.

  Everything else is now ignored rather than deleted — the scratch files stay on
  disk, they just no longer appear in `git status`. `.dockerignore` gained the
  same entries, since a local `docker build` sees the working directory and not a
  clean clone.

  One reference was deliberately left stale: `0034_voice2_provider_follows_voice.sql`
  still names `VOICE2_PLAN.md` in a comment. Applied migrations are checksum-
  tracked and editing one throws at boot — rewriting that comment broke the whole
  suite until it was reverted. A stale name inside an immutable file beats a boot
  failure.

  `Lab_database.json` and `heart.txt` deliberately stay at the root: the runtime
  reads them from there, and a repo-root runtime file has to survive both the
  `.dockerignore` and the explicit `COPY` in the runtime stage. Moving them is
  the exact shape of a bug this project has already shipped twice.

## [2.9.106] — 2026-08-30

### Changed

- **README opens with what Rohy actually is.** Rohy combines the diagnostic depth
  of virtual patients with the time pressure of educational escape rooms: the
  patient can be diagnosed and treated, but only if the student works fast enough
  and in the right order. The intro now says that, credits the **CRETIC** project
  (Optimizing Clinical Reasoning in Time-Critical Scenarios, led by Sonsoles
  López-Pernas, funded by the Research Council of Finland), and explains the name
  — *Rohy* is the Egyptian Arabic word for soul or spirit.

  A new **"Instruments, not pictures of instruments"** section states the fidelity
  claim plainly: a real DICOM reading room driven by window width and level, whole-slide
  pathology measuring in microns from scanner metadata, a twelve-lead ECG
  workstation with calibrated paper and working calipers, and a bedside ECG that
  is generated rather than looped.

## [2.9.105] — 2026-08-30

### Changed

- **README: every count removed, and a screenshot tour added.** The counts had
  already drifted — it claimed *24 versioned migrations* against 51 on disk,
  *225 lab tests* in one place and *215* in two others, *65 tables* in one and
  *40+* in another. A number in a README is a promise to update it on every
  release, and that promise is never kept; each one is now replaced by the thing
  it stood in for. The two survivors are constraints, not inventories: the 1–5
  minute turnaround band, which is an actual clamp, and "3D".

  A new **A tour of the interface** section embeds thirteen screenshots in the
  order a learner meets them, with commentary on what each screen shows about the
  design rather than a caption of what is visible.

## [2.9.104] — 2026-08-30

### Fixed

- **"Last Active" in the Users tab was stale by the viewer's UTC offset.**
  `users.last_login` was written with `CURRENT_TIMESTAMP`, whose
  `YYYY-MM-DD HH:MM:SS` shape carries no zone marker although sqlite means UTC,
  and `usersUi.js` read it with `Date.parse`, which treats that shape as LOCAL.
  Reported from the field as "3 hours behind"; reproduced here at UTC+3 to the
  second. Migration 0050 never touched this column.

- **The order tables held both timestamp shapes at once — caused by 0050.**
  That migration normalised `investigation_orders` and `treatment_orders` rows
  but did not fix their writers, so every order since went back in as legacy.
  Worse than uniformly legacy: `ORDER BY available_at` is a string sort, so
  `' '` (0x20) puts every legacy row before every ISO row whatever the instants
  were; and `OrdersDrawer`'s `available_at + 'Z'` — correct while all rows were
  legacy — produced `...ZZ` and an **Invalid Date** for exactly the rows 0050
  had converted, breaking the worklist countdown on pre-existing orders.

  Ten writers fixed, including three INSERTs silently leaning on
  `DEFAULT CURRENT_TIMESTAMP` (a column default sqlite cannot alter without
  rebuilding the table, so the fix is to name the column). New `sqlNowPlus()`
  covers the deadline form. Three readers now use the shared `timeMs`, which
  accepts either shape — they must keep doing so while deployments catch up.

- **Migration 0051** normalises `users.{last_login,locked_until}`,
  `investigation_orders.{ordered_at,available_at,viewed_at}` and
  `treatment_orders.{ordered_at,administered_at,completed_at,discontinued_at}`.
  Same double guard as 0050, verified on a seeded database: `SUM(julianday)`
  byte-identical before and after, idempotent on re-run, and an unparseable row
  left exactly as it is rather than nulled.

### Changed

- **The time-contract test now scans `UPDATE`s.** It checked `INSERT INTO
  <table> ( … )` column lists, and an UPDATE names no column list — so
  `UPDATE users SET last_login = CURRENT_TIMESTAMP` was invisible to it *by
  construction*, not merely missed. Green suite, live bug, one line apart, for
  eleven releases. The new scanner is a curated (table, column) list rather
  than a blanket `CURRENT_TIMESTAMP` ban: ~40 `updated_at` / `deleted_at`
  writes remain and nothing renders them, and a rule that fires on those is
  noise that ends up disabled.

## [2.9.103] — 2026-08-30

### Fixed

- **Selected medications were unreadable in the Treatments room.** The row built
  its class name by interpolation — `` `bg-${color}-900/30` `` — and Tailwind's
  JIT only emits classes it can see written out in the source. The class was
  never generated, so the selected row had **no background at all** and its
  `text-white` label sat on whatever was behind it. It affected only the
  Medications tab because only that tab colours rows by category, exactly as
  reported.

  Nothing can catch this: the markup is valid, devtools shows the class, and
  there is no error. The repo already warned about the trap twice, in
  `RoomNavigator.jsx` and `AuscultationPanel.jsx` — `TreatmentPanel` predated
  both notes and violated it in three places, with a fourth in
  `CaseTreatmentConfig`.

  All four now read from `treatmentTheme.js`, where every class string is
  literal and complete. An unknown colour falls back to a plain visible style
  rather than to `''`, which would reproduce the bug for any category the
  palette has not met. A source scan fails the build if an interpolated colour
  utility returns. Reported against v2.9.82.

## [2.9.102] — 2026-08-30

### Fixed

- **Course self-check headers rendered `Q{{I}} OF {{N}}`.** rohy runs
  `i18next-icu` for **all** messages (Finnish and Swedish plurals need it), and
  ICU's placeholder is `{x}`. The lessons module was ported from LAILA, which
  used plain i18next `{{x}}` — so ICU found no placeholder and emitted the
  braces verbatim. Nothing can warn about this: to the parser it is literal
  text.

  One key was reported; **ten** were broken, including the shared table footer
  ("Showing {{from}}–{{to}} of {{total}}") on every paginated lessons table.
  All ten converted, and a source scan now fails the build if a `{{x}}`
  defaultValue reappears in that module.

  `{{count}} file(s)` became a real ICU plural while it was open, since
  avoiding "file(s)" is what ICU was turned on for. Reported against v2.9.82.

## [2.9.101] — 2026-08-30

### Fixed

- **The case summary showed learners `thighRight` and `upperBack`.** Debriefing
  is where a learner reviews what they examined, and the one surface that
  bypassed `regionLabel()` was that summary — `CaseSummaryModal` rendered the
  stored `body_region` id directly, while the exam room three clicks away said
  "Right Thigh" for the same finding. `exam_type` had the same problem.

  Both now go through the exam room's own `regionLabel` / `techniqueLabel`
  resolvers, which fall back to the raw id for author-defined regions — worse
  than a name, far better than blank. The resolvers live in the `examination`
  namespace, so the modal takes a second `tExam` hook, the same pattern
  `PhysicalExamEditor` uses. Reported against v2.9.82.

## [2.9.100] — 2026-08-30

### Fixed

- **Centrality tabs in the Network view read "Sna.m in strength".** The LAILA
  i18n shim humanises any key it has no override for — strip a `ns:` prefix,
  swap underscores for spaces, capitalise. That fallback keeps new upstream keys
  readable, but it does not strip a *dotted* prefix, so `sna.m_in_strength`
  became "Sna.m in strength" and the four visible tabs all named an internal
  key. Seven measures now have explicit labels, the same way the `sna.layout_*`
  family already did. Reported against v2.9.82.

## [2.9.99] — 2026-08-30

### Fixed

- **A saved per-case discussant override never displayed, and re-saving
  silently reverted it.** `GET /cases/:id/agents` returns the merged
  `{...template_config, ...config_override}` object as `config`, and sends **no**
  top-level `unlock_trigger` and no per-case `context_filter` — the top-level
  `context_filter` it does send is the *template's*. The editor read
  `editingAgent.unlock_trigger` and `editingAgent.context_filter`, so both
  controls showed the default however the case was actually configured. Opening
  the editor for any other reason and pressing Save then wrote those defaults
  back over the educator's real setting.

  Both now read `editingAgent.config?.<key>` first, which is where the value has
  always lived. Found while adding a third control to the same panel in v2.9.98
  — that one was written against `config` from the start, and would otherwise
  have inherited the same defect.

## [2.9.98] — 2026-08-30

### Added

- **An educator can show learners their own encounter record at debrief.** Off
  by default, per case. When on, the debrief screen offers a read-only "Your
  actions" panel — the same record the discussant is given, with the operator
  affordances removed: no force-sync, no raw sync error, no JSON export. A
  learner has no use for those and no business seeing them, so `readOnly`
  removes them rather than disabling them.

  Timing is the whole point of the setting. During the case the panel would be a
  checklist that does the remembering for the learner; after it, the same list
  is a reflection aid. Some educators will also want the learner to reconstruct
  the encounter unaided first, which is why it stays off unless asked for.

  Stored in the discussant's existing `case_agents.config_override` blob, so
  there is **no migration** — `cases.config` and `config_override` are JSON
  columns — and no new fetch: `GET /cases/:id/agents` already merges
  `{...template_config, ...config_override}` and `fetchDiscussantForCase` already
  carries the result to the client. The flag is read as `=== true`, so a truthy
  string or a stray `1` in the blob is not consent.

## [2.9.97] — 2026-08-30

### Added

- **The discussant is finally told what the learner actually did.** Every
  clinically relevant act has been logged to `patient_record_events` in eight
  verbs since the beginning — and nothing ever read them back. `toNarrative()`
  had exactly one call site: the debug panel retired in v2.9.96. Meanwhile the
  discussant's own case context ended by apologising for the absence of that
  data ("ask the learner about what they did rather than assuming"), a sentence
  that papered over the gap convincingly enough that nobody looked.

  `server/services/encounterRecord.js` renders those rows into a prompt block
  that `/proxy/llm` appends **server-side**, on the same terms as the
  observed-affect note: read from the database, never from client text. The
  browser holds the same record and could have sent it, but then a learner's
  own client would be dictating what their debriefing tutor believes they did —
  and the omission a learner most needs to discuss is the one they would most
  like to leave out.

  The block states that an absent action did not happen, because the gap is the
  teaching point: a model told only what *did* occur treats a short record as
  missing information and debriefs on nothing.

- **Rendering is per-verb, because the named columns are a lossy projection.**
  `patient-record-routes.js` writes nine named columns and then stores the whole
  event again as JSON in `details`. Four fields survive only there: `technique`
  (EXAMINED), `dose` and `route` (ADMINISTERED), `parameter`/`from`/`to`
  (CHANGED), and `test_name` (ELICITED). A generic renderer emits "gave Aspirin"
  and "observed change in heart_rate" — technically true, useless to debrief
  against. Each verb now has its own formatter.

- **Which agents receive it is an allowlist, not a denylist** — `discussant`,
  `nurse`, `consultant`, `pharmacist`, `technician`. A patient who can recite
  their own troponin is not a patient, and a relative does not know what was
  ordered from another room; either breaks the simulation in a way the learner
  cannot detect or challenge. An agent type nobody has considered yet therefore
  receives nothing until somebody decides it should.

  The type is read from `agent_templates` by the template id the client names,
  so the client chooses *which* agent and the server decides what that agent may
  know. A source-scanning test pins that the route still consults the gate — a
  gate nobody calls passes every unit test ever written.

## [2.9.96] — 2026-08-30

### Security

- **The "Memory" tab was a developer debug panel shipped to every learner.**
  `PatientRecordViewer` — whose own header said "can be hidden later but useful
  for development/debugging" — has been a floating pill in every student's
  session since 2026-01-15 (`c3f65d9`), carrying a force-sync button, a raw
  sync-error dump and a JSON export of their own session. It is now admin-only,
  gated by an `isAdmin` prop that fails closed when a call site omits it: an
  undefined prop is not permission.

  Nothing had gated it because nothing had been *written* to gate it. A React
  tab in an array is visible to everyone by default, and a default does not
  show up in review the way a wrong line does. The `isAdmin` prop already
  existed in `App.jsx` — it was passed to the component on the line above and
  never to `OrdersDrawer`. When auditing exposure, look for surfaces with no
  role predicate at all, not for ones with the wrong predicate.

  Learners meet the same record at debrief instead, read-only, when the
  educator turns it on for the case (v2.9.98).

## [2.9.95] — 2026-08-29

### Fixed

- **`kb -- stale` reported "0 of 7 open bugs" while all seven were invisible to
  it.** A bug that cites no file was skipped by a bare `continue`, so a set it
  had never examined printed as a clean result — "0 of 7 have later work" reads
  as *checked and clear* when it meant *not checked at all*. It now lists what
  it could not check and says why. A tool that filters silently will eventually
  report an empty set as an all-clear.

- **The bug parser never scanned the Verdict column**, which is where the pilot
  triage puts its reasoning and every file it names — its remaining column is
  only `Effort: ½ day`. All 13 of that report's findings therefore carried no
  code references at all, which is what made them invisible to `stale`.

- **`statusOf` classified prose by substring, and the words overlap.**
  `CONFIRMED (design gap)` (an open defect) and `DESIGN/GAP — …` (an undecided
  question) collided, and an `ALREADY` rule swallowed "the data model already
  allows it". Rewritten as ordered rules — fixed, then nothing-to-build, then
  confirmed-defect, then undecided — because the order is what disambiguates
  words that legitimately appear inside one another. `EXISTS` (the reporter
  asked for something already shipped) and a bare `DESIGN` are now classified
  instead of falling through to `unknown`, which read as "nobody looked".

## [2.9.94] — 2026-08-29

### Added

- **A knowledge base for the repository.** `npm run kb:build` derives one
  SQLite file from what the repo already holds — 536 commits, 128 releases and
  the 330 individual changes inside them, 41 triaged bugs, 318 learnings, 50
  migrations, 36 agent notes and memory files, and 140 documents — with FTS5
  search across all 1,579 of them. `npm run kb -- search "audit chain"`,
  `-- file server/routes/orders-routes.js`, `-- bugs --status open`,
  `-- release 2.9.93`, `-- stats`. Modelled on Carm's `data/knowledge.db`.

  Two deliberate differences from the original:
  - **Derived, never authored.** Every row is parsed from git or from markdown
    already in the repo, and the build drops and rebuilds from scratch in about
    three seconds. There is no second source of truth to forget to update.
  - **Never committed.** Carm's equivalent was re-committed on every update and
    now accounts for 6.24 GB of that repo's history, with its website copies
    adding 2.6 GB more — recorded in its own `AGENT-NOTE-git-bloat.md`. Ours is
    gitignored.

- **`npm run kb -- stale`** — open bugs with later work on the files they
  blamed. A triage report is a snapshot: it records what was true the day it was
  written and is almost never edited when the fix ships, so `bugs --status open`
  over-reports. This lists each still-open bug beside the later commits that
  touched exactly the files it cited. It does not claim anything is fixed — a
  confidently wrong record is worse than a stale one — it is a prompt to
  re-triage. It currently flags **14 of 21** open bugs.

- Documentation: `docs/integrator/knowledge-base.md`.

### Fixed

- Three defects the tool found in itself while being built, each caught by a
  view rather than by a crash:
  - **The table parser read 32 of `MANIFEST.md`'s 50 migration rows** and
    reported success. Strict markdown ends a table at the first blank line;
    that file spaces its rows out for readability. Blank lines inside a table
    are now tolerated, and a test asserts the parser reads exactly as many rows
    as the file contains.
  - **Prose citations never resolved to a module.** Reports and learnings cite
    `orders-routes.js:1745`, not the full path, so 17 of 41 bugs and 99 of 318
    learnings classified as "unclassified" while the modules they were plainly
    about read zero. Basenames now resolve through an index learned from every
    path in git history, ambiguity broken by frequency and then alphabetically
    so rebuilds stay deterministic. Unclassified bugs: 17 → 1; learnings:
    99 → 35.
  - **Root-level files had no home.** Every version bump touches
    `package.json`, so "unclassified" was the single largest module in the repo
    at 182 commits and told nobody anything. They are `repo:meta` now.

## [2.9.93] — 2026-08-29

### Fixed

- **Two timestamp shapes lived in the same columns, and the ordering was wrong
  because of it.** Anything a browser wrote arrived as
  `2026-08-29T12:34:56.789Z`; anything falling through to sqlite's
  `DEFAULT CURRENT_TIMESTAMP` was written as `2026-08-29 12:34:56` — also UTC,
  but with a space, no zone marker and no milliseconds. sqlite's own date
  functions read the two identically (`julianday(iso) - julianday(space)` is
  exactly `0.0`), so every `julianday()` and `date()` filter was always correct,
  which is why this survived so long. Two things were not correct:
  - **Ordering.** These columns have TEXT storage, so `ORDER BY <ts>` is a
    *string* sort, and `' '` (0x20) sorts before `'T'` (0x54) — a row a full day
    later sorted first. Measured on the development database: **2169 of 3119
    `learning_events` rows sat in the wrong position**, from only 107 legacy rows
    among 3012 conforming ones. A minority shape is enough to scramble the
    majority. After migration 0050: 0.
  - **Rendering.** `new Date('2026-08-29 12:34:56')` is not an ISO string, so
    browsers parse it as *local* time and every server-stamped row rendered at
    the viewer's UTC offset — three hours out in Europe/Helsinki, a different
    number per viewer, and a different number across a DST boundary.
    `interactions`, `login_logs` and `emotion_logs` were 100% server-stamped, so
    in the unified Activity view every chat turn sat hours away from the learning
    events between which it belonged.

  Migration 0050 rewrites the legacy shape across nineteen tables. It is a
  reformat, not a reinterpretation — verified by `SUM(julianday(timestamp))`
  being byte-identical before and after — and each statement skips rows that
  already conform and rows sqlite cannot parse, so an unexpected value is left
  alone rather than nulled.

- **The correct parser already existed and nothing imported it.**
  `eventTimeMs()` in `activityTime.js` had handled this exactly right, with a
  comment naming the bug, and was used by its own file and nowhere else. It is
  now `timeMs()` in `server/shared/time.js`, the one definition both sides use.
  Twelve analytics call sites that parsed naively now go through it, including
  six byte-identical private copies of the same `fmtTime` helper — one bug
  written six times — replaced by `src/utils/formatTime.js`.

- **The cross-source merge in the Activity view was a string sort too**
  (`localeCompare` on the raw value, across fourteen tables). It now sorts on
  parsed time, so it cannot silently mis-order the day a fifteenth source
  arrives carrying something else.

- **A subprocess-free defect in the vendored pathology plugin**: it wrote
  `plugin_assets` timestamps by omitting `created_at` from its INSERT and by
  naming `CURRENT_TIMESTAMP` in three UPDATEs — a plugin quietly choosing a
  second shape in a host table. Fixed upstream (pathoyon `a2c9b14`) and
  re-vendored; the package now pins the rule with its own source-scanning tests
  so the author sees the failure before the host does.

### Changed

- **The server owns the clock; the learner's device is recorded, not trusted.**
  `/learning-events/batch` used to persist whatever the browser put in
  `timestamp`, unverified — so a device set a few hours wrong dragged a whole
  session away from the chat turns beside it, indistinguishable afterwards from
  a genuine overnight resume. The server now stamps `timestamp` itself and keeps
  the browser's reading in the new `learning_events.client_time`, which turns
  clock skew from an invisible corruption into a measurable per-event column.
  Spacing is preserved exactly: each event reports how long before the flush it
  happened and the server subtracts that from its own receipt time, so the gaps
  time-on-task and TNA actually read are unaffected. A client that sends neither
  field still works.

- **`system_audit_log` is deliberately excluded from the rewrite.** Its
  `timestamp` is inside the tamper-evident hash (`canonicalRow()` emits it as
  `ts`), so reformatting it would make all 509 historical rows fail verification
  — the chain cannot tell a reformat from a forgery, and that is the property it
  exists to have. It gains `ts_utc`, a VIRTUAL generated column plus an index;
  ordering and date filtering moved to it. Verified by
  `scripts/verify-audit-chain.js` producing byte-identical output with and
  without the column.

### Added

- **RPS-1 §17 "Time"** — one contract for every instant rohy stores or transmits,
  with rules R31 (a plugin takes every instant from `ctx.now()`) and R32 (an
  INSERT into a shared plugin table names its time column, because a column
  DEFAULT cannot be altered in sqlite and the guarantee rests entirely on the
  statement). Both pinned by source-scanning tests in the host *and* in the
  package, so a plugin author fails in their own repo first.

- **`ctx.now()` and `ctx.emit()` on the plugin server context.** A plugin's
  server work had no way into analytics: a slide import that ran for four
  minutes wrote `plugin_jobs` rows and not one learning event. `ctx.emit()`
  writes a server-side learning event, restricted to verbs the plugin declared
  in its manifest — the same rule the ingest route applies to a browser — with
  the trinity derived from the session and the timestamp taken from the server,
  so a plugin can say what happened but never when.

- **`plugin_jobs` as the fourteenth source in the Activity view.** Operational
  plugin work is not learner activity and is deliberately not dressed as a
  learner verb; it now appears beside `system_audit_log`, carrying the job's
  phase and its failure reason.

- Documentation: `docs/admin/system-logs.md` gains "Timestamps and time zones"
  and "Where Activity-view rows come from" (all fourteen sources, and how the
  two halves of plugin telemetry differ).

## [2.9.92] — 2026-08-29

### Fixed

- **A race in the PACS room test, surfaced by re-vendoring.** It waited for the
  series rail to appear and then read the logged analytics verbs *synchronously*.
  Those are two independent async effects, and assuming an order between them is
  a race — radoyon's lazy-loading path (vendored at `029e4e1` in 2.9.91) moved
  the emit later, so it passed on a fast machine and failed in CI with
  `expected [] to include 'OPENED_STUDY'`. The verb assertions are now awaited.
  A vendored upgrade changing *when* something happens is exactly the class of
  break the stamp makes visible; the test just had to stop assuming.

## [2.9.91] — 2026-08-29

### Added

- **RPS-1 §16 — the vendoring contract, one standard for every vendored plugin.**
  rohy carries byte-identical copies of `pathoyon` (client and server halves) and
  `radoyon`, because it ships a Docker image and an air-gap bundle and a
  `file:../Radoyon` dependency resolves on a laptop and nowhere else. Vendoring
  was never the mistake; *untracked* vendoring was.
  - **`.vendor.json`** in each vendored folder records the package, version,
    upstream commit and a content hash. Rules **R27–R30**.
  - **`npm run vendor`** / `npm run vendor -- <id>` / **`npm run vendor:check`**
    replace the pathology-only shell script. The registry lives in
    `scripts/vendor-plugins.mjs`; a package may ship its own installer (radoyon
    does) and the host delegates to it, then verifies the stamp it wrote. One
    contract, one gate, more than one permitted implementation.
  - **`tests/server/vendored-packages.test.js`** fails the build on a missing
    stamp or a copy edited in place. Honest about its limits: a stamp proves
    provenance and integrity, not *currency* — a copy three commits behind hashes
    perfectly against its own stamp, so staleness is reported by `vendor:check`
    where the upstream checkout exists.
  - `docs/integrator/vendored-packages.md` for the day-to-day workflow.
  - This closes a real gap: `src/components/pacs/` had sat frozen at one commit
    while both repos advanced, and nothing in rohy said so or could have —
    `portability.test.js` checks imports, not currency, and the room's own tests
    stay green against stale code. rohy's copy is now current with radoyon
    `029e4e1` and stamped.

### Fixed

- **A conversion job could starve the server it runs on.** libvips uses every
  core by default; measured on the 4-core target server, one `dzsave` took
  **301% CPU for 21 seconds**. `ctx.runBinary` now bounds image tools to half the
  machine's cores (`ROHY_PLUGIN_VIPS_CONCURRENCY` overrides). This also keeps the
  measured peak RSS honest, since libvips' memory scales with thread count.
- **A subprocess inherited every secret rohy holds.** `runBinary` passed the
  parent environment straight through, so `vips` ran with `JWT_SECRET` and every
  provider API key readable. The child now gets an allowlist — `PATH`, `HOME`,
  `LANG`, `VIPS_CONCURRENCY` — built by `childEnv()`, which is exported so the
  policy is testable rather than buried in a spawn call.
- `gen-config.mjs` listed `PATH`, `HOME` and `LANG` as rohy configuration once
  the spawner read them. They are the operating system's, not knobs an operator
  sets; inherited names are now skipped unless `ROHY_`-prefixed.

## [2.9.90] — 2026-08-29

### Fixed

- **`npm run build` failed on `main`: the frozen plugin manifest was missing
  `pacs`.** `server/shared/plugins/manifests.generated.js` is the snapshot the
  SERVER reads, and it had been regenerated from a working tree in which
  `src/plugins/pacs/` was still untracked — so once that plugin was committed,
  the generated file listed only `pathology`. `plugins:check` correctly reported
  drift, `prebuild` runs it, and the Docker "Install from scratch" workflow
  failed. Regenerated with both plugins; additive only, no manifest content
  changed.

## [2.9.89] — 2026-08-29

### Added

- **Settings → Plugins.** The admin surface for RPS-1 1.4's settings slot, and
  the last piece of slide import. The host renders it **generically from the
  schema each manifest declares**: one card per declared group, one control per
  field type (`boolean`, `int`, `bytes`, `enum`, `enumList`, `origins`). A second
  plugin gets an admin page by adding a `settings` block to its manifest, not by
  anyone writing another React screen — which is the difference between closing
  §14.4's gap and closing it once. A plugin without the slot is simply not
  listed.
  - **Save sends only the keys that changed.** The PUT is a key-presence merge,
    so sending every field would overwrite a value another admin edited between
    the page loading and the click.
  - An `enum` sends the value **in the type the schema declared**. A `<select>`
    hands back a string, a `tileSize` is a number, and `"1024"` would be refused
    by the server's own validator.
  - The server's field-level error is shown verbatim, because it names which of
    the four cards is wrong.
  - An **Imported slides** table lists every managed asset whatever state it is
    in, with its failure reason and Remove. It renders nothing at all until it
    knows whether this deployment has a managed library — "no library" and "an
    empty library" are different, and a header that appears then vanishes is
    worse than one that arrives a beat late.
- **`docs/admin/pathology-slides.md`** — the educator, admin and operator
  workflow end to end: the five states, why an uncalibrated slide is not offered,
  the two halves of a library, the three things an operator provisions, and the
  limits (one conversion at a time, an interrupted import restarts, no
  multi-file formats yet).
- Plugin standard **§7a.2 — the managed library**: the prefix table, the three
  rules that keep the host's `/library` and the bundle's prefixes from
  destroying each other, and why the two halves fail independently.

### Fixed

- **The end-to-end import test was order-dependent.** Its cases shared one
  asset, so the re-import case reset the calibration the case before it had just
  set — invisible in isolation, intermittent under full-suite load. Each case now
  imports its own slide.

### Notes

- The 29 new admin-settings strings are English in de/es/fi/it/sv, recorded in
  `src/locales/.status/*.json` as `state: 'new'`. `translate-locales.mjs` runs
  through the app's own LLM proxy, which needs a live server and a provider key;
  the keys are seeded so the locale key sets stay identical (which
  `locales-integrity` requires) and the translation pass is visible as
  outstanding rather than silently missing.

## [2.9.88] — 2026-08-29

### Added

- **An educator can paste a link and get a tiled slide.** The editor half of
  slide import, and the end of the chain the last three releases built.
  `hostAssetService` gains `importUrl`, `pollJob`, `cancelJob`, `remove` and
  `calibrate`; Case Studio's slide library grows an **Import from link** panel
  with the live phase, plus Remove on a failed import and a calibration form on
  a slide whose file carried no optics.
  - `available` stays **false** even though the service now writes. It is not a
    general "can this do things" flag — in the editor it gates the *scan/process*
    panel specifically, and a host has no source to scan. Setting it true would
    render a "Scan source" button that can only ever answer *"Scanning requires a
    configured asset service."* The import panel is gated on `importUrl` being
    present, which is the capability it actually needs.
  - `list()` merges the catalog with the plugin's own `/assets`, so a slide that
    is still importing or has **failed** is visible. Without it an author who
    pasted a link had no way to see what became of it. A 404 or 503 from
    `/assets` reads as "there is no managed half"; a 403 is re-thrown, because
    showing an empty library and calling it normal hides a real problem.
  - A failed import **rejects** the poll promise with the server's reason rather
    than resolving with a sad object — the editor's `catch` is what puts the
    reason in front of the author.
  - New `DELETE /api/plugins/pathology/assets/:assetId`. The directory removal
    is the **host's** (`ctx.removeAssetDirectory`), not the plugin's: the asset
    id arrives from a URL parameter, and unlike a bad read a bad recursive
    delete cannot be undone by retrying. Two checks — the id must have the shape
    the host generates, and the resolved path must still be inside the library.
  - A full end-to-end test drives the whole stack against **real libvips** and a
    real slide over HTTP: enable → allow an origin → import → tile → calibrate →
    offer → remove. Skipped where `vips` is absent, which is honest: the feature
    genuinely does not work without it.

### Fixed

- **A deployment that imports slides but ships no content bundle had an
  invisible library.** `GET /catalog` answered 503 the moment no content origin
  was configured, because before 1.4 the bundle was the only source there was —
  so slides on disk, with rows in the database, were reported to the editor as
  "this plugin has no catalog". The two halves now fail independently: the
  bundle's absence is *named* in the response (`bundleUnavailable`) so the editor
  can say which half is missing, and 503 is reserved for having genuinely
  nothing to show. Found by the end-to-end test, not by review.

## [2.9.87] — 2026-08-29

> Released as 2.9.87 rather than 2.9.86: this work and the PACS room below were
> developed in parallel and the PACS commit absorbed these files, so the two
> shipped in one commit under 2.9.86 while `package.json` had already moved to
> 2.9.87. Kept as separate sections because they are separate features.

### Added

- **Pathology can import a slide from a link.** The first user of the server
  slot: Pathoyon's `server/` module is vendored into `server/plugins/pathology/`
  the same way its `src/` already is, and the host mounts it at
  `/api/plugins/pathology/` (`POST /imports`, `GET /jobs/:id`,
  `POST /jobs/:id/cancel`, `GET /assets`, `PUT /assets/:id/calibration`).
  - **The managed library shares the bundle's origin and nothing else.**
    `/library` joins `/tiles` and `/gross` in the manifest's `remote.paths`, so
    an imported slide is addressed as `remote:library/<assetId>/slide.dzi` —
    host-agnostic, exactly like a bundled one. `GET /catalog` now merges the two
    halves so the editor asks one endpoint: *which half did this slide come
    from* is an operator's question, not an author's.
  - Only `ready` assets reach the catalog. A slide still importing, failed, or
    awaiting calibration is real but not usable, and offering it would let an
    author build a case around a slide whose scale is unknown.
  - `GET /api/health/plugins` gains a `library` block — counts and bytes only.
    The route is public so a deploy verify needs no token, and what a tenant has
    imported is not public information. A deployment with no library directory
    reports **no block at all** rather than zeroes, so "not configured" and
    "configured and empty" stay distinguishable.
  - `npm run pathology:vendor` now vendors **both** halves, each guarded by its
    own sentinel, and `server/plugins/pathology/portability.test.js` is the
    server half's gate. It allows *no* peer dependencies — and specifically
    refuses `node:child_process` and `node:http`, naming `ctx.runBinary` and
    `ctx.download` as what to use instead: those two are precisely the powers
    the allowlist and the byte cap exist to mediate.

### Fixed

- **`tiling.regionShrink` shipped a value libvips rejects.** The design note
  called the default `average`; libvips calls it `mean`, and `dzsave` exits 1
  with *"enum 'VipsRegionShrink' has no member 'average'"*. Caught by running
  the real tiler. The field now mirrors libvips' own enum
  (`mean, median, mode, max, min, nearest`) — a settings field that feeds a
  tool's flag mirrors that tool's spelling, or it is a validated value that
  fails at the one place validation was supposed to protect.
- **Five API endpoints were undocumented.** A plugin's server module declares
  real routes, and `gen-api.mjs` scanned only `server/routes/*.js`. It now scans
  `server/plugins/*/index.js` under the `/plugins/<id>` prefix, reports each
  route's true source file, and understands `ctx.guards.educator` as the
  `requireEducator` it actually is — without that, every plugin route was
  documented as unauthenticated.
- **The db-adapter boundary test flagged `ctx.db`.** RPS-1 hands `dbAdapter` to
  a plugin *as* `ctx.db`, precisely so a plugin cannot open its own handle;
  flagging it pushed authors toward importing `dbAdapter` directly, which the
  portability gate then forbids — leaving no legal way to write a query.
- **Both portability gates read comments as imports.** A JSDoc
  `@param {import('express').Router}` is a type reference, not a dependency.
  Comments are now stripped before scanning, in the client gate too.

## [2.9.86] — 2026-08-29

### Added

- **PACS — a DICOM reading room (RPS-1 plugin `pacs`).** Radiology could order a
  study and read a paragraph; there was no image anywhere. A learner can now
  read the actual pixels, on a workstation that behaves like the one they will
  sit at afterwards.
  - **Why `pacs` and not `radiology`.** R3 rejects a plugin claiming a core room
    key, and the constraint turned out to describe the real division of labour:
    the RIS is where a study is ordered and its report read, the PACS is where
    the images are read. Radiology keeps ordering, `turnaround_minutes` and the
    text report exactly as they were; this room is where the study opens. A
    learner crosses the same boundary a clinician does.
  - **Real DICOM, and therefore real Hounsfield units.** The vendored package
    reads Implicit VR LE, Explicit VR LE and Explicit VR BE, sequences of any
    nesting, and multi-frame images, and applies the modality LUT — so a CT is
    in HU, not stored integers, and window presets, HU probing and ROI density
    are quantitatively right rather than approximately right. Compressed pixel
    data is located and refused *by error code*; transcoding belongs at ingest,
    not in every learner's browser.
  - **A normal archive, and cases authored by substitution.** A case starts from
    a complete normal examination and the author says only what is *different*.
    Everything untouched stays normal, so finding the abnormality means
    excluding a real study. Whole-series substitution is geometrically
    self-consistent; a slice-range splice is permitted and *geometry-checked*,
    because spliced material at a different matrix or spacing makes every
    measurement across the seam wrong.
  - **Studies are addressed, never embedded** (§7a `remote:`, `/dicom` and
    `/thumbs` via `ROHY_PLUGIN_ORIGINS`), for the same reason slide pyramids
    are: one chest CT is ~150 MB and has no business in the Docker image, the
    backups, or the air-gap bundle.
  - **The rubric never reaches the learner.** `learnerDocument()` rebuilds each
    entry without the field rather than deleting it from a copy, and the
    manifest declares `document.learnerOmit: ['rubric']` so the server strips
    the path from every read below reviewer. Two defences, not one.

### Notes

- `src/components/pacs/` is a byte-identical vendored copy of
  `~/Documents/Github/Radoyon/radoyon/src` — edit upstream and re-vendor, never
  here. Rohy's gates on the folder are its own `portability.test.js` (which also
  fails if any DICOM or imaging library creeps in: the parser, the modality LUT
  and the VOI transform are the package's own, and its only peers are react,
  react-dom and lucide-react) and `tests/client/plugins/pacs-room.test.jsx`,
  which renders the real room with synthetic DICOM through the real descriptor.
- Four new `common.json` keys are English in every locale pending translation.

## [2.9.85] — 2026-08-29

### Added

- **RPS-1 1.4 — the server slot (§11b).** Everything before this was a plugin
  running in a browser. Whole-slide import is not: it downloads gigabytes, runs
  a tiler for minutes, and writes to a directory only the server can see. A
  plugin may now ship `server/plugins/<id>/index.js` exporting `{ jobs, routes }`,
  mounted by the host exactly as its room and editor are.
  - **Peaceful exclusion, preserved on the server.** Discovery is a directory
    read plus a dynamic `import()` in a try/catch: a module that is absent,
    throws, or has no manifest is *reported* unavailable and rohy boots. A plugin
    that can take the server down at boot is not a plugin, it is a dependency.
  - **A persisted job queue** (`plugin_jobs`, migration 0049) with exactly one
    worker. Not a knob: measured this session, `openslideload --level 2` on a
    2.1 GB NDPI peaks at 252 MB RSS and `dzsave` at 299 MB against a 3 GB budget
    — four workers turn that margin into an OOM kill, and an OOM-killed tiler
    leaves a partial pyramid nothing distinguishes from a complete one.
  - **A job found `running` at boot is requeued from the START**, never resumed
    from its recorded phase: the owning process is gone, so `phase` is the last
    phase *announced*, not the one reached. Trusting it is how a half-downloaded
    file gets tiled. Past three attempts it is abandoned with a message saying so.
  - **Cancellation is cooperative**, checked at phase boundaries — a `dzsave`
    killed mid-write leaves a directory of tiles that looks exactly like a
    finished one.
  - **`ctx` narrows everything a server module could otherwise reach**:
    `download` (allowlist pre-resolved, byte cap enforced while streaming,
    sha256, path containment), `runBinary` (allow-listed argv, **never a
    shell**), `libraryDir` (the one writable directory), `registerJob`
    (namespaced `<id>:<kind>`), `settings`, plus rohy's own `guards` and
    `helpers` so a plugin does not hand-roll an auth check that loses CSRF and
    revocation.
  - **Route ordering is part of the contract** (§11b.4): host specific routes →
    plugin routes → the content-proxy catch-all. Mounted in any other order a
    plugin's `GET /plugins/pathology/jobs/:id` is answered as an undeclared
    content path. The slot router is created synchronously so the async module
    load cannot land it behind the catch-all.
  - New operator variables, both fatal at boot if malformed:
    `ROHY_PLUGIN_IMPORT_ORIGINS` (the outer allowlist a tenant admin narrows and
    can never widen — a tenant admin is not the server operator) and
    `ROHY_PLUGIN_LIBRARY_DIRS` (plural and per-plugin, because a singular
    variable cannot serve a second plugin).
  - Migration `0049_plugin_jobs_assets.sql` (additive). Rules **R24–R26**, two
    conformance rows, §14.2 narrowed. 28 tests.

### Fixed

- **The API reference was silently omitting 7 endpoints.** `gen-api.mjs` matched
  route registrations only on the literal identifier `router`, so a file
  declaring a second Express router documented none of its routes —
  `catalogue.js:556` has a `groupRouter` with 7 live endpoints that had never
  appeared in `docs/reference/api/`. The scanner now *discovers* which
  identifiers in a file are `express.Router()` rather than assuming the name,
  and understands the mixed `import x, { y } from` form. Discovered rather than
  loosened to `<anything>.get(`, which would match `dbAdapter.get('SELECT …')`
  and invent endpoints out of SQL.

## [2.9.84] — 2026-08-29

### Added

- **RPS-1 1.4 — the settings slot (§11c).** A plugin's material is per-case;
  its *policy* is per-deployment, and until now there was nowhere to put it.
  §14.4 recorded the gap as "no per-tenant enable/disable" and named
  `oyon_settings` as the pattern to copy — but copying that literally (a column
  per knob) means **a migration per plugin**, which solves it for pathology and
  leaves the second plugin exactly where the first one was. So the host now
  renders and stores plugin settings **generically from a schema the manifest
  declares**: `settings: { groups, fields }` with types `boolean`, `int`,
  `bytes`, `enum`, `enumList`, `origins`.
  - `GET`/`PUT /api/plugins/:pluginId/settings`. The PUT is a **key-presence
    merge** (like `/platform-settings/voice`, deliberately not the full replace
    `/addons/oyon/settings` is), and storage is a **flat map of dotted keys**
    because "which keys did the caller send" has exactly one answer on a flat
    map and several defensible ones on a nested one.
  - Gating is per **field**, not per route — one page holds an admin-only import
    policy and an educator-readable library table. A field with no stated
    `minRole` is admin: the strictest reading of an omission.
  - `ceilingEnv` lets a numeric field bind to a deployment-wide operator limit
    (`ROHY_PLUGIN_IMPORT_MAX_BYTES`). A tenant admin may set a value below it and
    never above it. The list of bindable ceilings is **closed and host-owned**
    (`HOST_CEILING_ENVS`), so a manifest cannot declare a ceiling nothing reads.
  - A **default is validated against its own field** at `plugins:gen` time (R21).
    This is the load-bearing check: `{ max: 16 GiB, default: 64 GiB }` would ship
    64 GiB to every tenant that never opened the settings page, while the page
    itself refused to save it — a schema that fails open.
  - An unknown key in a PUT is **refused, not ignored** (a silently dropped typo
    is how an operator believes a limit is in force that nothing reads); on read,
    a key the schema no longer declares is dropped and a value it now rejects
    falls back to the default — what a plugin upgrade looks like from the DB.
  - Pathology declares the first schema: 14 fields across import policy,
    conversion and job retention. Every default makes a fresh install do nothing
    surprising — **imports off, allowlist empty**, so enabling them is two
    deliberate acts.
  - Migration `0048_plugin_settings.sql` (additive). Rules **R21–R23**, two new
    conformance rows, §14.4 marked closed. 36 tests.
- **One definition of "a host rohy's server may talk to."** The `origins`
  setting type and `ROHY_PLUGIN_ORIGINS` now share `normalizeOrigin()` in
  `server/shared/pluginSettings.js`. Two copies of that rule was two chances to
  refuse a userinfo segment in one place and accept it in the other.

## [2.9.83] — 2026-08-29

### Fixed

- **The documented re-vendor command had become destructive.** The README in
  `src/components/pathology/` told you to
  `rsync -rc --delete ~/Documents/Github/Pathoyon/rohy-pathology/src/ …`, but the
  upstream "Rename to Pathoyon" commit moved the package to `pathoyon/` and left
  `rohy-pathology/` behind as a stray `.vite/deps` cache. rsync has no notion of
  "this source looks wrong" — an empty source is a valid instruction to empty the
  destination — so the command as written **deleted the vendored package**.
  `portability.test.js` would not have caught it either: it walks whatever files
  exist and passes vacuously on none.
  Replaced with `npm run pathology:vendor` (`scripts/vendor-pathology.sh`), which
  refuses to run unless the source actually contains the package and then asserts
  the copy is byte-identical apart from the two rohy-only files — the same
  discipline as `content-bundle.sh` refusing a bundle with no `.dzi` in it. The
  stale path is corrected in `docs/design/plugin-standard.md` too.

## [2.9.82] — 2026-08-29

### Fixed

- **The pathology editor's slide library was empty on rohy.** The editor asks
  an injected `assetService.list()` for its catalog; the standalone app
  builds one from `slides/library.json`, rohy passed none. The catalog is now
  part of the content contract (RPS-1 §7a.1): the bundle ships
  `catalog.json` with every URL a `remote:` reference, rohy relays it to
  authoring roles (`GET /api/plugins/<id>/catalog` — gated on
  `authoring.minRole`, JSON only, 4 MB cap, any non-`remote:` URL rejected),
  and a host asset service hands it to the editor with references resolved.
  The adapter now resolves the stored document on the way into the editor
  and un-resolves it on every change (`unresolveRemoteRefs`, the exact inverse
  of `resolveRemoteRefs`), so the case never stores a host address.
  `/api/health/plugins` reports `has_catalog`.

## [2.9.81] — 2026-08-29

### Fixed

- **Case wizard step strip truncated every label at desktop widths.** With a
  twelfth step (Plugins, 2.9.73) the desktop-only equal-width row shrank each
  label to two letters — "De…", "Av…", "Sc…". The strip now wraps at every
  width with content-sized buttons (as it already did below `xl`), so labels
  are always readable; a second row is cheaper than an unreadable first one.
  Hovering a step shows its full name.

## [2.9.80] — 2026-08-29

### Added

- **A plugin's content origin is a deployable contract, not a hand-made
  nginx block (RPS-1 §7a.1).** `GET /api/health/plugins` probes every
  `ROHY_PLUGIN_ORIGINS` entry for its `content.json` — the self-description
  every plugin content bundle serves at its root — and reports `reachable`,
  `content_version`, `file_count`, and a mismatch when the origin serves
  another plugin's bundle; 503 when any configured origin is dark. Public
  like `/health` so the deploy hub can gate on it without credentials, and
  therefore never echoes the origin URL. `scripts/tech-test.sh` (the hub's
  `POST_VERIFY`) fails a deploy on 503; `deploy/preflight.sh` checks each
  origin before a restart; `deploy/systemd/rohy.service.example` and
  `server/.env.example` say where the variable goes. The bundle script lives
  in Pathoyon (`scripts/content-bundle.sh`) and the `KIND=plugin-content`
  recipe in the deploy hub (`./deploy.sh pathoyoncontent`).

## [2.9.79] — 2026-08-29

### Fixed

- **Re-vendored upstream: the pathology editor's publish lifecycle and slide
  scoring both worked against the author.** Publish was offered on a draft and
  threw every time (the model requires `review`), and after Submit review the
  editor was stranded with no control that could return the revision to draft.
  The permitted transitions now come from the model and the header renders them.
  Separately, "Add scoring for this slide" seeded a zero `tissueBounds`, which
  validation calls an error — one click made a case permanently unpublishable,
  with nothing to remove the criteria again.

  Neither reaches rohy's own code; both are in the vendored package. Listed here
  because the vendored copy moved and because the wizard's Plugins card shows
  `validate()` output, which the third fix below changes: `empty_case` required
  zero slides AND zero specimens, but every case carries one specimen part, so a
  completely empty case used to validate clean. It now reports itself, and the
  card says so.

## [2.9.78] — 2026-08-29

### Fixed

- **A plugin's answer key no longer reaches a learner's browser.** The
  pathology room rendered the package's learner projection, but `GET /cases`,
  `GET /cases/:id` and every endpoint returning `sessions.case_snapshot` sent
  the whole `config.pathology` — `rubric` included: every expected answer,
  ROI and dwell threshold — to the student being assessed with it. The
  manifest now declares `document.learnerOmit = ['rubric']` (validated
  strictly, since a typo fails open) and the server strips those paths for
  every role below reviewer at all five read sites (`/cases`, `/cases/:id`,
  `/sessions/:id`, `/analytics/sessions`, `/analytics/sessions/:id`).
  Educators and above receive the whole document. Spec §11a.2a.
- **The wizard's Plugins card showed raw i18n keys** (`room_pathology_author`,
  `pathology_summary_slides`): a plugin's keys live in the `common` namespace,
  the step's own strings in `authoring_config`. Plugin keys are now resolved in
  `common` explicitly.
- Pressing *Done* on a never-edited new case wrote `config.<plugin> = null`;
  it now removes the key, as *Remove* does. The Plugins step index is derived
  from `WIZARD_STEP_KEYS` rather than the literal 12.

## [2.9.77] — 2026-08-29

### Fixed

- **Analytics "Minutes" tile showed the calendar span of the dataset, not
  time spent.** It was `max(timestamp) − min(timestamp)` over every filtered
  event — right for one session, meaningless for a cohort (147,585 min = 102
  days on a local DB). It is now **Active minutes**: idle-capped time on task
  (Kovanović et al., 2015) — per session, the sum of gaps between consecutive
  events with each gap capped at 5 minutes, the last event earning nothing;
  rolled up per learner and in total, grouped exactly as TNA groups sequences.
  The detail line shows session minutes (first → last event) and the median
  active minutes per session. A new **Time on task** panel lists every
  learner (sessions, events, active, session, median) with the idle cap
  selectable (2 / 5 / 10 / 30 min) so the sensitivity is visible rather than
  assumed. `sessions.duration` was not used: most sessions are never
  explicitly ended, so it is NULL or stale.
- **TNA sequences could be mis-ordered.** `learning_events.timestamp` holds
  two formats — the client's ISO string and sqlite's zone-less
  `CURRENT_TIMESTAMP` fallback — and `eventsToSequences` sorted by string, so
  a server-stamped row sorted before client rows of the same day. Both now
  sort by numeric time (the sqlite form pinned to UTC), through one shared
  comparator and one shared grouping rule (`activityTime.js`).

## [2.9.76] — 2026-08-29

### Added

- **Gross photographs can be referenced instead of carried, which is what makes
  a photographic pathology case storable at all.** A case now says
  `remote:gross/case42/a.jpg` and the host resolves it, exactly as slide
  pyramids already work. Measured: one 438x320 photograph embedded as a `data:`
  URL puts a case document at 34 KB and two put it at 83 KB, past the 64 KB cap
  v2.9.72 enforces; the same photographs referenced leave the whole case at
  **2.2 KB**, verified in a browser end to end.

- `resolveRemoteRef(uri, pluginId)` split out of `resolveRemoteRefs` in
  `src/plugins/context.js`, and handed to the editor through `authorProps`. The
  ROOM never needed it — `createPluginContext` resolves `ctx.data` up front —
  but the EDITOR is given the raw stored document, so without this an author
  referencing a photograph sees a placeholder where their own picture should be
  and cannot tell a correct reference from a typo.

### Note

- The upstream package gained a `resolveRef` prop on `CaseStudio`,
  `CaseAuthor`, `PathologyRoom` and `PathologyScreen`, plus `src/remoteRef.js`.
  Deliberately no `/api/...` prefix lives in any of them: resolution is the
  host's rule, and a package that knew rohy's mount could not be dropped into
  anything else. Vendored copy re-synced and byte-identical.

## [2.9.75] — 2026-08-29

### Changed

- **RPS-1 1.3 is implemented, and the spec says so.** Status header moved to
  "1.0–1.3 implemented (rohy v2.9.59–v2.9.74)"; every *(1.3, proposed)* marker
  removed; §11's "rohy has no case-config write path yet" replaced with how the
  path actually works; §12 step 5 now describes the wizard's Plugins step rather
  than editing `config` by hand. **§14 item 4 — "No store behind the authoring
  seam" — is deleted**, which was the whole point of the exercise: it was the
  gap that kept the authoring slot from being end-to-end.

- **§11a.1 now states what the 64 KB cap costs, with measurements.** An empty
  canonical pathology case is 1.0 KB and a text case with slides, ROIs and prose
  stays near it — but one 438x320 gross photograph embedded as a `data:` URL
  takes the document to 34 KB and two take it to 83 KB, past the cap. Case
  Studio bounds photographs at 1600px, several times larger again. The section
  already said bulk bytes belong behind the remote proxy; it now says what
  ignoring that costs, and that closing it properly needs the upload path §14.2
  records as missing.

## [2.9.74] — 2026-08-29

### Added

- **The plugin authoring surface, and the write path it closes (RPS-1 §11a.3(2),
  §11a.4).** "Open editor" on the Plugins step now opens the plugin's editor
  full-viewport; **Done** hands the whole document back into the wizard's
  `config[<pluginId>]` and the ordinary case save persists it. That closes the
  loop the standard describes — wizard → editor → `PUT /cases` →
  `case_snapshot` → `available(ctx)` — and with it the last gap that kept the
  authoring slot from being end-to-end. §14 item 4 is gone.

  Done and Discard live in the plugin's OWN header, through the `topBarControls`
  slot the package exposes. A host header stacked above the plugin's would be
  the second header the surface exists to avoid. Discard is guarded once the
  draft is dirty: authored material is expensive to recreate.

### Changed

- The wizard's "Save & Finish" test now targets the final step rather than
  naming Agents, and a sibling test asserts Next still appears on the step
  before it. Agents stopped being last in 2.9.73; the invariant that matters is
  that exactly one step ends the linear path.

### Note

- **Deviation from `todo/pathology-authoring-plan.md` WP4, deliberate.** The
  plan put the surface behind an `App.jsx` early-return like
  `personaEditorTarget`. That works for the persona editor because it saves
  through its own endpoint; this one must hand its document back to a wizard
  that is still mounted and holding the draft (§11a.3(3): the ordinary case save
  and nothing else). Unmounting ConfigPanel would tear that draft down and
  restore it from the localStorage stash — showing "Resumed draft from …"
  immediately after the author pressed Done on their own edit. Mounted from
  CaseWizard instead, the wizard owns the draft throughout and no handoff prop
  is needed.
- **The adapter still mounts `CaseAuthor`, not controlled `CaseStudio`**, also
  deliberately. A controlled mount needs a NORMALISED document to render, and
  the host cannot produce one for a blank case without knowing what a pathology
  document is — `toStudioDocument(null)` mints a fresh document per render and
  would reset the editor mid-keystroke. `CaseAuthor` is upstream's uncontrolled
  wrapper for exactly this. Switching would need a `blankDocument()` descriptor
  hook the standard does not define.

## [2.9.73] — 2026-08-29

### Added

- **A "Plugins" step in the case wizard (RPS-1 §11a.3(1)).** One card per
  plugin that ships an editor this role may open, showing the plugin's own
  one-line summary and its own validation issues, with **Open editor** and
  **Remove** (confirmed). Before this, a plugin's material could only reach a
  case by hand-pasting its editor's JSON export into `config` — the authoring
  slot was real in the standard and imaginary in the product.

  `src/components/settings/CasePluginsStep.jsx` knows nothing about pathology:
  the label comes from `authoring.labelKey`, the summary from `summarize(doc)`
  and the problems from `validate(doc)`. A second plugin with an editor appears
  here with no change to the file, which is the whole test of the standard. Its
  tests drive a fake plugin through a mocked registry for that reason — if they
  needed the real descriptor, the component would have failed it.

  The step is hidden when `registry.authors(role)` is empty, and it is filtered
  out of what RENDERS rather than out of `WIZARD_STEP_KEYS`: that list is what
  `wizardStepNumber()` resolves deep links against, so dropping a key would
  silently renumber every later step and send an existing `wizardStep=11` link
  to the wrong page — the same trap as bug report 2.9.15 #2. The footer's
  last-step test now derives from the visible list rather than the full one.

  Removal deletes the key rather than setting it to `undefined`: an explicit
  `undefined` survives a spread and still reads as present to anything checking
  with `in`, so the room would stay lit on a case whose material was removed.

  Errors are listed before warnings, and neither blocks saving — a half-finished
  case is the normal state of an unfinished one (§11a.2). A descriptor whose
  `validate()` throws is reported as one unreadable-material issue rather than
  taking the wizard down.

## [2.9.72] — 2026-08-29

### Added

- **A plugin's case document is guarded on write (RPS-1 §11a.3(4)).**
  `normaliseCaseForStorage` now checks `config[<pluginId>]` for every manifest
  in the frozen snapshot that declares `authoring`: it must be a plain object
  within the plugin's cap, and every `remote:` reference in it must fall under
  one of that plugin's declared `remote.paths`. Anything else is
  `400 { error, code: 'invalid_plugin_config' }` — never a 500. Absent and
  `null` both mean "no material" and are left alone, as are config keys no
  manifest claims: policing those would make this a gate on the whole case
  shape. New `server/shared/pluginDocument.js`; driven entirely by the manifest
  snapshot, so a second authoring plugin needs no change here.

  The cap defaults to 64 KB and a plugin may raise it with
  `document: { maxBytes }` in its manifest — per plugin, never globally, so one
  plugin's appetite cannot enlarge every request rohy accepts. `validateManifest`
  checks that block, because a typo there fails OPEN: a manifest saying
  `maxbytes` would silently keep the default and the author would meet a
  rejection the manifest appears to have prevented.

  The `remote:` check is deliberately duplicated from the proxy, which already
  403s an undeclared prefix at read time. Failing at authoring time tells the
  AUTHOR which field is wrong; failing at read time tells a LEARNER their slide
  is broken.

### Note

- **The 64 KB cap and inline gross photography cannot both stand.** Measured
  through Pathoyon's real canvas pipeline: an empty canonical case is 1.0 KB, one
  438x320 gross photograph takes it to 34 KB, and **two take it to 83 KB** —
  already over. Case Studio bounds photographs at 1600px, several times larger
  again, so no cap below express's 256 KB body limit makes a photographic case
  fit. The cap was left at the specified 64 KB rather than inflated to a number
  that still would not work: a text pathology case (slides, ROIs, prose) measures
  about 1 KB, so the limit only bites on embedded images, which belong behind the
  remote proxy. Closing this needs an upload path (§14.2), which does not exist.

## [2.9.71] — 2026-08-29

### Changed

- **Pathology reads through the document contract (RPS-1 1.3, read side).**
  The adapter no longer decides anything about a pathology case itself; it
  asks upstream's `hostDocument.js` (vendored with this release, package
  renamed `pathoyon`). `available()` was the `ctx.data != null` anti-pattern
  R20 names — a saved-but-empty document lit the room onto its own empty
  state; it now asks `caseDocumentIsServable()`. The room is handed
  `learnerCase(doc)`, the published projection, instead of the author's
  document — which carried the rubric, every expected answer and ROI, into
  the browser of the learner being assessed with it. `validate()` (R19) and
  `summarize()` are on the descriptor for the host's wizard card; the editor
  opens on `readCaseDocument()` so a legacy flat case comes back canonical,
  rubric included. 16 client tests.
- Summary strings are ICU (`{count, plural, …}`) in all six locales; the
  first cut used i18next-v1 `{{count}}`/`_plural` and only English.

## [2.9.70] — 2026-08-28

### Documentation

- **RPS-1 1.3 draft — the document contract.** A plugin is part editor, part
  room; 1.1 named both halves and gated them, and this draft says what travels
  between them. New §11a: the plugin's slice of the case is one opaque JSON
  document at `config[<id>]`, handed back whole (§8 applied to authoring),
  capped at 64 KB, judged by the plugin's own `validate(doc)` (required, R19)
  and `summarize(doc)` (optional); `available()` must judge the document, not
  the key (R20); the host owes the editor half a discoverable entry point, a
  full-page surface, persistence only through the case save, and a
  manifest-driven server guard. Every new section is marked *(1.3, proposed)*
  — nothing here is implemented yet, and §14 item 4 stays until it is.
  Implementation plan: `todo/pathology-authoring-plan.md`.

## [2.9.69] — 2026-08-28

### Fixed

- **Pathology: re-vendored from the real upstream, and the record set
  straight.** 2.9.68 said the package's upstream checkout was retired and the
  rohy folder canonical. Wrong: upstream is
  `~/Documents/Github/Pathoyon/rohy-pathology` (its own repo, 429 tests), and
  rohy's `src/components/pathology/` is a **byte-identical copy of its `src/`**
  — `INTEGRATION.md` "Copy the package". The copy was also behind: this
  release brings in `CaseStudio` (the controlled editor `CaseAuthor` now
  wraps), `caseCore/` (structural + semantic validation, packaging), asset
  catalogue / slide source / thumbnail modules and previews. Verified
  `diff -rq` clean apart from the two rohy-only files.
- ESLint now ignores the vendored folder like it does `OyonR/` — its lint
  posture is upstream's — while rohy's own `portability.test.js` stays linted
  and now walks subfolders and allows `react-dom`, matching upstream's
  `ALLOWED` list. README rewritten with the re-vendor procedure.

## [2.9.68] — 2026-08-28

### Changed

- **The pathology package is now a package, and the tree is its home.**
  `PathologyScreen` used to call `useTranslation()` — a reach for a host React
  context that made it render only inside rohy. It now takes `t` as a prop
  (defaulting to the fallback string); the RPS-1 adapter passes `ctx.t`, so
  nothing visible changes. `CaseAuthor` gains the same `topBarControls` header
  slot the room already had. A new `index.js` barrel is the package's public
  surface for all three ways of consuming it (standalone app, npm dependency,
  vendored). `portability.test.js` fails the build on any import that is not a
  sibling file or react / openseadragon / lucide-react — the promise the
  barrel makes, now enforced. The separate upstream checkout is retired;
  `src/components/pathology/` is canonical (README: "Where this package lives").

## [2.9.67] — 2026-08-28

### Added

- **A case can offer alternative evolutions** (QA ISSUE-0012, from 5th-year
  students). Besides its own scenario, a case may carry
  `scenario.alternatives[]` — named trajectories the instructor starts from
  the monitor's Scenarios tab or switches to mid-case. They never
  auto-start. Authored in the case wizard's scenario step (add from the
  repository or a built-in template, remove); the primary can be replaced
  or removed without losing them, and a case may have alternatives with no
  primary at all. Stored inside the existing scenario JSON, so the session
  snapshot, export/import and case versions carry them unchanged.
  Server-side: at most 8, name required, timeline validated and rhythms
  canonicalised like the primary; bad input is a 400
  (`invalid_scenario_alternatives`).
- Not built on purpose: chaining one evolution after another, and running
  two at once (two state timelines cannot be superimposed; overlays are what
  treatment effects already do).

## [2.9.66] — 2026-08-28

### Added

- **Logout is one click away on every screen** (QA ISSUE-0018). It used to
  exist only as the last item of the top-bar dropdown, below Language,
  Analytics and Setup, and pilot testers could not find it. A direct
  Logout button now sits beside the menu trigger, and the full-page
  Settings header — which has no top-bar menu at all — gets a Logout
  button beside "Back to Simulation". The menu item stays.

## [2.9.65] — 2026-08-28

### Fixed

- **An ended case kept "living" on the monitor** (QA ISSUE-0015). After
  End & Debrief → back to the patient room, the session clock, scenario
  engine, vitals jitter and waveforms all kept running, because
  `PatientMonitor` derived "alive" from `sessionId`, which the host keeps
  so the debrief can query it. The monitor now takes `caseEnded` /
  `caseEndedAt`: the clock freezes at the instant the case ended, every
  loop holds its last frame, and a "Case ended — vitals frozen" badge
  says so. The chat composer and mic are disabled with an "ended"
  placeholder.
- The debrief's "Back to Cases" button is now **"Back to patient"** — it
  returns to the patient room; there was never a case list behind it.

## [2.9.64] — 2026-08-28

### Fixed

- **First-run wizard: the Emotion-capture pill said "Off" while its checkbox
  was ticked** (QA ISSUE-0014). The tenant's `oyon_settings` row is created
  lazily by the first reader; the wizard sidebar read the table raw (no row
  → Off) while the step body read through `ensureSettings()` (inserts the
  default → On). The two only agreed after one toggle. `/setup/status` now
  reads through the same `ensureSettings()`, which moved to
  `server/lib/oyonSettings.js` so it is reachable when the Oyon router is
  not loaded (`OYON_ENABLED` unset). Regression lock in
  `tests/server/first-run-setup.test.js`.
- `docs/reference/**` regenerated (line-number drift in `admin-routes.js`).

## [2.9.63] — 2026-08-28

### Fixed

- **"Detect models" in the first-run wizard was unreadable** (QA ISSUE-0017).
  The button carried `rohy-btn-secondary`, a light-theme class that paints a
  white surface, under the dark-only wizard's grey text. It now uses the
  same plain dark classes as its sibling buttons.

## [2.9.62] — 2026-08-26

### Fixed

- **`npm ci` rejected the lockfile, so CI and Docs both failed at the install
  step.** v2.9.59 added a real dependency (`openseadragon`, for the pathology
  slide viewer) and the lockfile was refreshed with
  `npm install --package-lock-only` under npm 11 / Node 25. That pruned nested
  entries a Node 22 `npm ci` still expects — `@docsearch/js`'s own react@18.3.1
  and friends, which vitepress pulls in — leaving `package.json` and
  `package-lock.json` out of sync from npm 10's point of view. Nothing was
  wrong with the dependency set; the lockfile was simply written by the wrong
  npm.
- Regenerated from the last CI-green lockfile using Node 22.17 / npm 10.9, the
  version CI pins, and verified with `npm ci --dry-run`. **Refresh this
  lockfile with the Node version in `.github/workflows/ci.yml`, not whatever
  node is on PATH** — a newer npm silently produces a lockfile that only a
  newer npm will accept, and the failure surfaces on a runner rather than
  locally.

## [2.9.61] — 2026-08-26

### Added

- **A plugin's bulk content can now live on another server** (RPS-1 1.2, the
  `remote` capability). A whole-slide pyramid is gigabytes; carrying it in
  rohy's Docker image, its backups and its air-gap bundle was never a packaging
  inconvenience so much as a different product. A plugin declares
  `capabilities: ['remote']` plus a `remote` block naming the path prefixes and
  content types it needs; a case then writes `remote:tiles/case42/slide1.dzi`
  and the browser is handed `/api/plugins/pathology/tiles/case42/slide1.dzi` —
  same origin, so rohy's CSP never has to hear about the slide host.
- `GET /api/plugins/:pluginId/*`, the read-only relay behind it. This is also
  the first plugin surface rohy's *server* renders, and therefore the first
  place `minRole` is enforced server-side rather than declared and trusted.
- `ROHY_PLUGIN_ORIGINS`, a `<pluginId>=<origin>` allowlist. Unset — the default
  — means no plugin has a remote origin and every proxy route answers 503: a
  fresh install talks to nothing. A malformed entry stops the server booting,
  because the failure that matters is an operator believing slides come from a
  host rohy never contacts.

### Security

- **The origin is operator configuration and nothing else.** A manifest naming
  `remote.origin` is rejected outright, and a case config cannot name a host at
  all — it picks a path. rohy has already paid for the alternative once:
  `proxy-routes.js` accepts a client-supplied `endpoint` and then deliberately
  ignores it, because honouring it was an SSRF and API-key exfiltration hole. A
  plugin proxy is the same risk wearing a friendlier name.
- The proxy does not follow redirects. `fetch`'s default is `follow`, and with
  it an origin allowlist is advisory: the configured slide host could return a
  302 to the cloud metadata endpoint and rohy would fetch it with the server's
  own network position. A 3xx is a 502.
- A path outside the manifest's declared prefixes is refused **before the
  upstream is contacted** — a check applied to the response would already have
  fetched whatever it was refusing.
- Traversal is stopped in both of its spellings, which turn out to be caught by
  different checks: `%2e%2e/` is normalised away by Express before routing and
  fails the prefix test, while `..%2f` survives as a single decoded segment
  containing a separator and fails the segment test. Dropping either check
  leaves one spelling live.
- An undeclared content type is a 502. Relaying `text/html` from the configured
  origin would serve attacker-controlled markup from rohy's own origin — an
  HTML-injection primitive handed out by a well-meaning image proxy.
- GET only; 32 MB and 15 s upstream budgets; client cookies, `Authorization` and
  query strings are not forwarded upstream and upstream `Set-Cookie` is not
  returned. The two sides share a path and nothing else.

### Changed

- The plugin proxy is exempt from `generalLimiter` and carries its own limiter
  at 2000/min keyed by (tenant, user). `generalLimiter` is 600/min keyed by IP,
  and a deep-zoom pan is hundreds of requests in seconds — in a teaching lab
  behind one NAT address, one student reading a slide would otherwise spend the
  whole building's budget.
- `remote:` references are resolved by the HOST, in `createPluginContext`, and
  only for a plugin that requested the capability. The pathology adapter needed
  no code for any of this, which is the test that the seam is real: resolving it
  per-descriptor would have made every future plugin reimplement the same walk,
  differently.

## [2.9.60] — 2026-08-26

### Security

- **A learning event can no longer be forged into another learner's session.**
  `resolveSessionTrinity()` verified that a `session_id` belonged to the
  caller's tenant, but never that it belonged to the *caller*. Because the
  server deliberately derives `(user_id, case_id)` from the sessions row rather
  than trusting the client, that gap did more than let a forged row through — it
  stamped the row with the victim's identity, producing activity that is
  indistinguishable from the real thing in every analytics surface, export and
  TNA sequence rohy builds. Any authenticated user could do it by counting
  upward through integer session ids. The resolver now takes an optional
  `principal`; both `POST /api/learning-events` (403) and
  `POST /api/learning-events/batch` (dropped, counted as `not_owner`, and logged
  with the offending session ids) pass it. Rank does not widen this — a bypass
  for staff would let an educator author learner activity, and no feature needs
  that. Server-derived writes that legitimately act on the owner's behalf, such
  as the instructor lab-value edit in `orders-routes.js`, omit `principal` and
  are gated by their own educator guard.
- Session lookups in the resolver now exclude soft-deleted rows
  (`deleted_at IS NULL`). Writing a fresh event against an erasure tombstone
  re-created analysable activity for someone who had asked to be forgotten,
  after the purge that would have collected it had already run.

### Fixed

- **`learning_events.severity` and `.category` are actually written.** Both
  columns exist, both carry `CHECK` constraints, and the client faithfully sent
  both — but neither `INSERT` listed them, so every row ever ingested through
  the canonical endpoints landed NULL in both. The verb→metadata map moved from
  `src/services/eventLogger.js` to `server/shared/learningVerbs.js`, next to the
  verb whitelist it belongs with, so the server can *derive* severity and
  category from the verb instead of depending on the client to supply them.
  Plugin manifests already declare metadata per verb (RPS-1 rule R7); that
  declaration now reaches the database.
- A caller may still override either value — `LAB_RESULT_READY` is genuinely
  `IMPORTANT` for an abnormal result and `INFO` otherwise — but only within the
  enum. An out-of-enum value used to be impossible to send at all (the column
  was dropped); now it is rejected as `invalid_event_metadata` rather than
  coerced silently or left to fail the `CHECK` constraint, where it would have
  surfaced as an infrastructure `db_error` and hidden the client bug.
- EventLogger stamps the exact xAPI severity into the notification payload.
  It previously survived the round trip only through the lowercase notification
  severity, which is lossy: `ACTION` collapsed into `info` and came back `INFO`.

### Changed

- `POST /api/learning-events/batch` now caps a batch at 500 events
  (`batch_too_large`), matching BackendSurface's own queue cap, and runs behind
  a per-user rate limiter at 240/min. The endpoint was not unlimited before —
  `routes.js` mounts a 600/min general limiter over all of `/api` — but that one
  is keyed by IP, and rohy is deployed to teaching labs where a room of students
  shares one NAT address. The highest-volume endpoint in the product was
  spending a budget it shared with every other request from the building. A
  legitimate client sends roughly 12 batches a minute.
- `dropped_reasons` on the batch response gains `not_owner` and
  `invalid_metadata`. Folding either into `cross_tenant` or `db_error` would
  have hidden the two failures most worth seeing.

## [2.9.59] — 2026-08-26

### Added

- **RPS-1, a plugin standard: a room, a vocabulary and a session, declared not
  hardcoded.** Installing the Pathology room previously meant hand-editing five
  shared files (`App.jsx`'s `ROOM_KEYS`, `RoomNavigator`'s `ROOM_DEFS`,
  `eventLogger.js`, `clinicalStates.js`, and the server's verb whitelist), each
  carrying a "delete this if you remove the folder" comment. A plugin now
  declares itself in a manifest and rohy names no individual plugin anywhere.
  - `src/plugins/<id>/manifest.js` (pure data: room, vocabulary, states,
    capabilities) + `index.jsx` (component, availability gate, prop adapter).
  - Manifests are frozen into `server/shared/plugins/manifests.generated.js` via
    `npm run plugins:gen`, with `npm run plugins:check` failing on drift — the
    server needs a plugin's verb list and the Docker runtime stage copies
    `server/` but not `src/`.
  - Discovery uses `import.meta.glob`, so deleting a plugin directory still
    leaves a bootable app instead of becoming a build failure.
  - Spec: `docs/design/plugin-standard.md`.
- **Plugin state is persisted by the host.** `ctx.store` (async,
  localStorage-backed, registered as `rohy_plugin` with a `session` lifetime).
  Pathology annotations, draft reports and diagnoses now survive leaving and
  re-entering the room; previously `onAnnotationsChange` was never wired at the
  mount site and every annotation was discarded on unmount.

### Fixed

- **Plugin verbs were accepted or rejected depending on which endpoint the
  client used.** `POST /learning-events` validated against a hardcoded
  `LEARNING_VERBS` array containing zero pathology verbs, while
  `POST /learning-events/batch` checked only that a verb was present. Pathology
  events survived solely because `EventLogger` batches; any single-event post
  returned 400. Both paths now validate against one registry
  (`server/shared/learningVerbs.js`), and batch reports an `unknown_verb` drop
  reason.
- **A plugin vocabulary collision was silent.** Plugin verbs and TNA state rows
  were merged with a raw object spread, so a future rohy verb colliding with a
  plugin verb would have overwritten it and quietly changed what existing
  `learning_events` rows meant. All merges now go through `mergeNamespace()`,
  which throws — plugin-vs-rohy and plugin-vs-plugin alike. The vendored
  pathology package shipped a throwing `mergePathologyStates()` for exactly this
  and the integration had bypassed it.
- **A case with no pathology material no longer shows a Pathology tab.** Plugins
  gate themselves via `available(ctx)`; the navigator hides a declined room
  rather than opening onto an empty state.

## [2.9.58] — 2026-08-26

### Fixed

- **A test server that died mid-run was invisible.** `startTestServer` only
  watched the child until readiness; after that nothing did. When the process
  died mid-file every later request failed `ECONNREFUSED` in ~1 ms, so the run
  reported a pile of unrelated-looking assertion failures, and the child's
  stderr was dumped only in `afterAll` — far from the failing test, and
  truncated in CI logs. The handle now reports an unexpected exit the moment it
  happens, with the exit code, signal and full stderr, and states plainly that
  the failures below it are consequences rather than causes. It also exposes
  `getExitInfo()` (null while healthy) and `pid`.
  - This is a **diagnosability** fix, not a fix for the underlying crash. It was
    written while chasing the intermittent `cohorts-routes.test.js` failure
    (CI run 32849292369): six tests went red including one that shares no state
    with the others, which is what revealed the server had died rather than the
    assertions being wrong. The crash itself is still unidentified — the
    captured stderr points into `phonemizer` (a `kokoro-js` dependency, pulled
    in by the static import in `kokoroTts.js`) about 7 s after boot, but the CI
    log truncates at the error text and the failure did not reproduce across
    five full local runs.

## [2.9.57] — 2026-08-25

### Fixed

- **`package-lock.json` claimed rohy was MIT.** rohy is licensed under the
  **Carm Research License v1.4** ("all rights reserved"), and `package.json`
  correctly says `SEE LICENSE IN LICENSE` — but the lockfile's ROOT entry still
  carried a stale `"license": "MIT"` from before that change. npm only rewrites
  the field when the lockfile is regenerated, so it survived indefinitely, and
  the lockfile ships: it was a false licensing statement about a proprietary
  product. Regenerated; the only change is that one line. (`../dynajs` already
  read correctly, and `MIT` on actual third-party packages is untouched and
  right.)
- **A test now pins it.** `tests/server/license-contract.test.js` checked
  embedded licence FILES, NOTICE links and the Docker image, but nothing checked
  what rohy declares about *itself* — which is why this sat unnoticed. It now
  locks `package.json`'s licence field, the LICENSE file being the Carm Research
  License, and the lockfile root matching `package.json`.

## [2.9.56] — 2026-08-25

### Added

- **Body Map silhouettes can be reset to the bundled default** (bug report
  2.9.37 #4). An admin could replace a silhouette but had no way back. There is
  nothing to "reset" in a database — `useBodyImage()` probes
  `/uploads/bodymap/<type>.png` → `.svg` → the bundled `/<type>.png`, so the new
  admin-only `DELETE /api/body-image/:type` removes the uploaded override and
  the reader falls through to the default on its own. Both extensions go: either
  one left behind would keep shadowing. Idempotent — resetting an already-default
  slot is a 200 with `wasCustom: false`, not a 404 — and audited as
  `reset_body_image`. The four hand-copied slot blocks in the Body Map editor
  were collapsed into one `BodyImageSlot` component so the new action exists
  once rather than four times; the type allowlist is now shared with the upload
  route so the two cannot disagree. Strings in all six languages.

## [2.9.55] — 2026-08-25

### Added

- **Lesson authors get an inline preview of an attached image** (bug report
  2.9.37 #3). `FileCard` already offered a "View" action that opens the file in
  a new tab, but an author checking a lesson before publishing should not have
  to leave the page to confirm they attached the right scan. The lesson editor
  now renders the image above the file card. Deliberately editor-only — the
  student-facing card is unchanged — and image-only, since a PDF in an `<img>`
  is a broken-image icon, which is worse than the card alone. This adds the
  first tests to the vendored `src/components/lessons/**` module.

## [2.9.54] — 2026-08-25

### Fixed

- **The Chat Log now names the speaker for `learning_events` rows** (bug report
  2.9.37 #5). `speakerFor()` resolved a speaker for `interaction`, `agent` and
  `team` rows but returned nothing for `event` rows, so a feed dominated by them
  read as a wall of bare `assistant` against a "—" speaker. Those rows now
  resolve too, split by `le.component`: the patient thread (`ChatInterface`) and
  the debrief discussant (`DiscussionScreen`) are no longer conflated. Non-chat
  verbs (`TTS_PLAYED`, `EXPRESSED_EMOTION`, `STT_RESULT`…) arrive with `role` set
  to the verb itself and correctly stay blank rather than being swept into
  "patient". Client-only — no schema, API or docs change.
  - Note: the `role` column itself is unchanged and must stay that way. `role`
    is the LLM wire protocol (`user`/`assistant`/`system`); rewriting it to
    `patient`/`consultant` as the report suggested would corrupt the payload
    sent to the model. Supporting agents were already correctly named — they
    write to `agent_conversations` with an `agent_type`, never to `interactions`.

## [2.9.53] — 2026-08-25

### Fixed

- **The horn button on the Alarm System panel now silences a sounding alarm**
  (bug report 2.9.37 #6). `routeNotification()` runs once at `notify()` time and
  its result is frozen onto `notification.routedSurfaces`; `AudioSurface`
  filtered on that snapshot, so flipping `prefs.audioMuted` while an alarm was
  already sounding never reached it — the oscillator kept beeping until the
  breach was acknowledged or resolved. `AudioSurface` now re-checks
  `prefs.audioMuted` live. This mirrors `routing.js` rather than widening it:
  `audioMuted` is the one mute applied unconditionally there (it is *not*
  bypassed by critical clinical, unlike DND / minSeverity / mutedSources), so
  muting is meant to silence even a life-threatening alarm. Unmuting pages
  again while the breach is still active. Acknowledge/Snooze were never
  affected — they remove the notification from `active`.
- **`AudioSurface` has tests for the first time.** It was previously untestable:
  the shared `tests/setup.js` AudioContext stub has no `createOscillator()`, so
  the surface threw on mount. The new suite supplies its own instrumented
  AudioContext instead of widening the global stub, and includes a control test
  (ack silences) so a mute failure cannot be mistaken for a blind harness.

## [2.9.52] — 2026-08-16

### Added

- **Educators can narrow the radiology catalogue** (bug report 2.9.15 #5,
  the last open item of that triage). `GET /sessions/:id/available-radiology`
  used to return the full 74-study master DB unconditionally — labs had
  `investigations.defaultLabsEnabled`, radiology had no counterpart, so a
  first-year case could not stop offering a PET-CT. New
  `investigations.defaultRadiologyEnabled` (absent = true, so every existing
  case is unchanged): when off, the student catalogue is only the studies
  configured on the case (matched by `studyId`, or by name for entries
  authored before ids were stamped) plus custom studies, and the response
  carries the flag. Unlike labs, the narrowing is also **enforced at order
  time**: `POST /order-radiology` refuses a hidden master study with 409
  `RADIOLOGY_UNAVAILABLE` (`unavailable_ids` listed, nothing inserted) —
  same shape as `TREATMENT_UNAVAILABLE`. The Radiology & Diagnostics editor
  gains the same header toggle as the labs editor, with the empty-catalogue
  warning when it is off and nothing is configured. Strings in all six
  languages + pseudo-locale (registered as `machine` in the review
  sidecars). Server round-trip test + editor tests.

## [2.9.51] — 2026-08-16

### Changed

- **Kokoro TTS is loaded lazily and unloaded when idle.** The ~330 MB
  Kokoro-82M model used to be warmed at boot and held resident for the
  life of the process — ~400 MB on a 3.7 GiB production box whether or
  not anyone used voice mode. It now loads on the first synthesis and is
  released after `ROHY_KOKORO_IDLE_UNLOAD_MIN` minutes without one
  (default 10; `0` restores always-resident + boot warmup). Measured on
  the production host: `dispose()` returns ~380 MB (667 → 285 MB RSS);
  the remaining ~200 MB is the ORT runtime and only leaves with the
  process. An in-flight synthesis or an open stream always pins the model
  (an early-closed response releases the pin via the generator's
  `finally`), and a request arriving mid-dispose waits for the teardown
  before reloading. Cost: one warm reload (~1.7 s with a persistent
  `TRANSFORMERS_CACHE`) on the first voice reply after a quiet spell.
  Voice listing and the capability probe already worked from the static
  package catalogue when the model is not resident, so nothing else
  changes. `server/.env.example` documents both `TRANSFORMERS_CACHE` and
  the new variable; the config reference is regenerated.

## [2.9.50] — 2026-08-16

### Changed

- **Release notes come from the CHANGELOG.** The Release workflow now
  writes the tag's `## [x.y.z]` section above the install-path text
  instead of publishing boilerplate only (heredoc is quoted so the code
  fences are never command-substituted; owner/repo/tag are substituted
  afterwards).

## [2.9.49] — 2026-08-16

### Fixed

Adversarial review (Codex, range v2.9.12 → v2.9.48; 12 findings, 9 fixed,
1 rejected, 2 by decision — full report in `reports/`):

- **Case versions were not tenant-scoped.** `GET /cases/:id/versions` and
  `POST /cases/:id/restore/:versionId` resolved the case and version by
  global id; an admin of tenant A could read tenant B's snapshots and
  restore over its live case. Both now resolve the case with
  `tenant_id` first (404 otherwise).
- **Version snapshots held pre-validation data and restore skipped
  validation.** Snapshots now equal what was stored (clamped vitals,
  canonical rhythms, gender write-back); restore runs the same
  normalisation as PUT and re-derives every denormalised column
  (chief_complaint, difficulty_level, patient_*), respecting the
  immutable case language.
- **`POST /scenarios/seed` wrote into tenant 1 and duplicated on repeat.**
  Seeds into the caller's tenant, per-tenant idempotent (`skipped`).
- **Treatment ordering ignored hidden treatments and re-awarded points on
  every repeat.** `case_treatments.is_available = 0` → 409
  `TREATMENT_UNAVAILABLE`; a name unknown to both the case rubric and the
  visible catalogue → 404 `TREATMENT_UNKNOWN`; points are awarded once per
  (session, treatment) — repeats return `repeat: true` with 0 points, so
  the debrief total can no longer be farmed.
- **Debrief used the live rubric.** The case's treatment rubric is pinned
  at session start into `session_settings.settings_snapshot` (server-only
  — not into `case_snapshot`, which the learner can read) and used by
  listing, ordering and debrief alike; older sessions fall back to live.
- **XLIFF import path traversal.** `target-language` is validated against
  the language registry + strict shape, namespaces against `en/`, and the
  resolved path must stay under `<root>/<lang>/`; a stripped provenance
  note no longer bypasses stale-source detection (unit skipped unless
  `--allow-missing-note`, and then capped at *reviewed*).
- **RxNorm enrichment amplification.** Bounded proxy cache (2000 entries,
  expiry sweep), enrichment cap 10 → 6 and only for hits missing name or
  term type, 4 s upstream timeouts + abort on client disconnect, and a
  per-user 30/min limit on the search endpoints (429 `RATE_LIMITED`).
- **Default course renamed before the 2.9.41 upgrade** was not flagged and
  the seeder would recreate "Basic course". Migration 0047 flags the
  lowest-id `auto_enroll` cohort in tenants without a default.
- **Unrecognised rhythm is now visible** on the monitor (admin rhythm
  panel) instead of silently rendering sinus.

Rejected: "migration 0042 erased agent delays" — deliberate 2.9.19
decision, already applied. By decision: unknown rhythms are kept verbatim
+ warned (non-breaking policy); tenant treatment rows keep the global
`UNIQUE(name, route)` (table rebuild deferred, documented in MANIFEST).

## [2.9.48] — 2026-08-16

### Added

- **Curated treatment formulary widened 101 → 264 rows** (204 medications,
  16 IV fluids, 13 oxygen/airway, 31 nursing procedures): a realistic
  teaching formulary — antibiotics incl. the meningitis set
  (dexamethasone, ampicillin, acyclovir, cefotaxime, gentamicin,
  linezolid, penicillin G), osmotherapy (mannitol 20 %, hypertonic saline
  3 %), oral cardiovascular / endocrine / GI staples, antiemetics,
  anticoagulants, sedation/ICU drugs, antidotes, blood products, NIV/HFNC
  devices and ward nursing procedures (isolation precautions, head-of-bed
  30°, neuro obs, seizure precautions …). Every medication carries an
  RxCUI looked up live against RxNav and a DailyMed/RxNav evidence link;
  drugs without acute haemodynamic effect are orderable and scored with
  zero vital effects. Existing rows unchanged except four RxCUI
  corrections (Flumazenil carried fentanyl's; three nulls resolved). The
  medications mirror now links sublingual and rectal rows too.

## [2.9.47] — 2026-08-16

### Fixed

- **Treatments library: "Show deactivated" read as a no-op.** The
  checkbox only mixed deactivated rows, faintly styled, into the active
  list. Replaced by an explicit **Active | Deactivated | All** status
  view with counts, badge and Restore in the Deactivated view; the
  deactivate confirmation uses the translated dialog.

### Added

- **Add from RxNorm / openFDA** inside the Treatments library: search the
  full drug universe through the existing proxy, see term type
  (ingredient / clinical drug / brand / FDA label) and RxCUI, pick a hit
  to open the add form prefilled (name, RxCUI, route guess, effects none)
  — hits already in the library say so and open the row instead. The
  RxNorm proxy now returns `tty`, fills empty names from
  `/rxcui/{id}/properties`, and sorts ingredients first (cached 24 h).
  The case editor's treatment tab links to *Manage library*.

## [2.9.46] — 2026-08-16

### Added

- **XLIFF 1.2 review pipeline (phase 1).** Human translation review now
  has a place to live: a committed per-language status sidecar
  (`src/locales/.status/<lang>.json` — source hash, state
  new/machine/reviewed/approved, reviewer, clinical-risk level derived
  from the namespace) plus three npm commands. `i18n:status` classifies
  every key (new / stale / machine / reviewed / approved / removed, with
  an opt-in `--check` release gate for clinical keys); `i18n:xliff:export
  <lang>` writes an incremental XLIFF 1.2 file per language pair (one
  `<file>` per namespace, states mapped, glossary in the header, ICU
  argument names in notes); `i18n:xliff:import <file>` validates (ICU
  compiles and keeps the same arguments, braces balanced, glossary
  renderings honoured — fail on clinical, warn on low, stale source hash
  skipped) and writes the reviewed targets back into the existing JSON
  catalogues without changing their structure. All five languages
  bootstrapped as `machine`. Docs: `docs/integrator/i18n-review.md`.

## [2.9.45] — 2026-08-16

### Added

- **Treatments library.** Settings → Libraries → *Treatments* (next to
  Medications) edits the list students actually order from —
  medications, IV fluids, oxygen and nursing procedures with their
  onset/peak/duration and per-vital effects, RxCUI and evidence links.
  Until now that table (`treatment_effects`) could only be changed by
  editing the seed JSON and reseeding. New audited routes
  `POST/PUT/DELETE /treatment-effects` (+ `/restore`); educators add
  rows for their own tenant, admins manage platform rows. Migration
  0046 adds `scope`/`tenant_id`/`created_by`/`updated_at` (additive,
  defaults keep every existing row platform-wide and visible exactly as
  before). The Medications reference catalogue is unchanged.

## [2.9.44] — 2026-08-16

### Added

- **Scenario language.** Repository scenarios carry a language
  (migration 0045, default `en`): language select on create/edit,
  language filter and flag badge in the list, `?language=` on
  `GET /scenarios`, round-tripped by export/import.

### Changed

- **Scenario categories are a shared vocabulary** with translated labels
  (`server/shared/scenarioCategories.js`) instead of free text with a
  computed translation key. **Non-breaking by design:** on save and
  import, recognised values and every locale's labels — including prose
  that contains one unambiguous label ("Emergenza Neurologica / Terapia
  Intensiva" → Neurological) — are canonicalised; anything else is
  stored verbatim and reported in an additive `warnings` array, never
  rejected. The same leniency now applies to ECG rhythms on
  `POST/PUT /cases` and `/scenarios` (the 400 introduced in 2.9.40 is
  gone; "Bradicardia Sinusale Marcata" → Sinus Bradycardia, unknown kept
  + warned). Unknown stored values stay visible and selectable in the
  editor.

## [2.9.43] — 2026-08-16

### Changed

- **"Radiology" is now "Radiology & diagnostics".** The 12-lead ECG,
  Holter, echo and the other *Cardiac* studies were always orderable
  through the radiology pipeline (image/video upload included) but
  nobody looked for them there. The student room, its tab and the case
  editor tab are relabelled in all six languages; an *All | Imaging |
  Diagnostics* filter (Diagnostics = Cardiac today; EEG/spirometry
  later) sits above the study list in both the student catalogue and
  the case editor; modality names show translated labels while stored
  values stay the English data strings. The editor's modality dropdown
  now comes from a shared list that includes DEXA and Mammography (both
  present in the data, missing from the old hardcoded list — a
  data-drift test now locks the two together). Internal room key
  unchanged.

## [2.9.42] — 2026-08-16

### Fixed

- **Importing a case whose gender is written in the UI language works.**
  `resolvePatientGender()` now accepts every locale's own labels
  (Femmina, Weiblich, Mujer, Nainen, Kvinna, …) as aliases for the three
  canonical values, so a hand-authored Italian JSON no longer stops at
  `invalid_patient_gender`. `POST/PUT /cases` also fall back to the
  top-level `patient_gender` an export carries when
  `config.demographics.gender` is absent (that was the "gender doesn't
  show after import" symptom), and write the canonical value back into
  the config so column and config agree. Version restore now re-derives
  `patient_name/gender/age`; the lab reference-range lookup routes
  through the resolver instead of `|| 'Male'`.

## [2.9.41] — 2026-08-16

### Fixed

- **The default course is now flagged, not named.** Migration 0044 adds
  `cohorts.is_default` (backfilled from the seeded "Basic course",
  unique per tenant among live rows). Seeders, language-case linking
  and the cases list key on the flag, so renaming the default course
  (e.g. to "Corso base") no longer makes the next boot create a second
  "Basic course". While the seeded English name is untouched, the Cases
  and Courses screens show it through the UI language ("Corso base",
  "Grundkurs", …) with a "Default" badge; a renamed course shows its
  own name.

## [2.9.40] — 2026-08-16

### Fixed

- **One ECG rhythm vocabulary.** The case editor, the scenario
  repository and the monitor engine each had their own rhythm strings —
  "Atrial Fibrillation" chosen in the case editor never reached the
  monitor's AFib waveform, and an imported scenario with
  "Tachicardia sinusale" silently rendered as sinus. New
  `server/shared/rhythms.js`: ten canonical ids, `resolveRhythm()` with
  aliases (long English names, common abbreviations, every locale's
  labels), translated labels in all six languages. Case and scenario
  save/import canonicalise on the way in and reject unknown values with
  `400 invalid_rhythm`; the monitor canonicalises every external entry
  point (case load, scenario frames, persisted vitals, settings import).

## [2.9.39] — 2026-08-16

### Fixed

- **Posterior body-map hit-areas land on the limbs again.** The
  coordinate editor drew the silhouette letterboxed inside a fixed
  500×900 box while the SVG overlay filled the whole box, so every
  polygon traced there was in letterbox space; the viewer (correctly)
  uses the image's own aspect ratio, so on the narrow posterior PNGs the
  arms, forearms and hands were pulled ~6–11 points toward the spine
  (female most visibly, male latently). Editor now uses the same
  intrinsic-ratio canvas as the viewer; posterior x-coordinates were
  re-derived and verified against the PNG pixels; the browser cache of
  regions is versioned so stale local copies are discarded.
- **Body-map editor and Exam tab fully translated.** The editor had no
  i18n at all (title, buttons, hints, toasts, region names, a raw
  `confirm()`); the Exam tab showed region and technique names
  ("Left Forearm", "Inspection", "Palpation") in English. Both now use
  the existing region/technique key maps.

## [2.9.38] — 2026-08-16

### Fixed

- **Confirm dialogs no longer show an English "Cancel"/"Confirm" in
  other languages.** `ToastContext` hardcoded the fallback labels and
  ~15 call sites only passed a confirm label; the defaults are now
  `common:cancel` / `common:confirm`, resolved at render time. The
  notification-preferences reset also moved from `window.confirm` to
  the translated dialog.

## [2.9.37] — 2026-08-09

### Fixed

- **Uploaded body-map images now survive image redeploys.** They were
  written into the container layer (`public/uploads/`), which every
  redeploy discards. New named volume `rohy-uploads` mounted at
  `/opt/rohy/public/uploads`; the runtime image pre-creates the
  directory node-owned so the volume inherits correct ownership (a
  volume mounted over a nonexistent path is created root-owned and
  breaks writes). Additive for existing stacks — the volume starts
  empty, matching what a redeploy would have left anyway.

## [2.9.36] — 2026-08-09

### Fixed

- **Empty lab catalogue — the last open item of the 2.9.15 tester
  report (#3) — closed with wire evidence.** Reproduced against a live
  server: "All labs by default" ON + Instant Results + configured tests
  returns the full catalogue (201 labs — the tester's claimed conflict
  does not exist), and default OFF + configured tests returns exactly
  those tests. The ONLY way to an empty catalogue is default OFF with
  no tests persisted — and since the toggle ships checked, "selecting"
  it actually turns it off. The Labs editor now shows a red warning the
  moment that combination exists ("Students will see NO lab tests…"),
  in all six languages.

## [2.9.35] — 2026-08-09

### Fixed

Three defects surfaced by an adversarial (Codex) review of the
v2.9.20–v2.9.34 series:

- **A revoked session could keep a zombie UI forever.** The
  verify-before-logout path added in v2.9.20 expected
  `AuthService.verifyToken()` to throw on rejection — but it returned
  `null` for both a real rejection and a network blip (and deleted the
  bearer token on the blip). The contract is now explicit: user on
  success, null + token cleared on definitive rejection (→ logout),
  THROW with token kept on network failure (→ retry, never logout).

- **Switching sessions could silence an identical alarm.** The v2.9.21
  alarm fire-state restore only *overwrote* the refs when the new
  session had stored state; a fresh session inherited the previous
  session's fired keys and suppressed the same breach for up to the
  5-minute refresh window. Refs now reset when no stored state exists.

- **End & Debrief was a cheat flow.** Ordering was not terminal at
  session end: a learner could end the session, read the
  missed-expected list from the debrief, then order the revealed
  treatments into the ended session to farm their points. Treatment
  orders on an ended session now return 409 `SESSION_ENDED`.

Also reviewed and accepted as designed: the order response's
`is_expected`/`points_awarded` fields (they power the intentional
points toast and CI warning; per-order probing reveals only what the
learner has already committed to).

## [2.9.34] — 2026-08-09

### Fixed

- **The Playwright e2e suite runs again** (it left CI on 2026-05-17 and
  quietly rotted: 20 of 88 tests failed on the current app for harness
  reasons, none of them app defects). Repairs: global-setup now
  completes the first-run gates that shipped after the suite was
  written (the admin Platform-setup wizard and the student welcome page
  were occluding every assertion on a fresh e2e DB); the e2e server
  disables the auth rate limiter like CI's audit server (login-heavy
  specs and back-to-back local runs blew the 10/15-min cap and
  cascade-429'd); the canary's login sentinel matched a heading that no
  longer exists ("Sign In" → "Welcome back"); cookie-auth tests logged
  in through the isolated `request` fixture and then read cookies from
  the browser context — two different jars, so they could never have
  passed as written (now `context.request`); and multi-tab tests waited
  on a `/admin/i` sentinel the in-session UI no longer renders — they
  now anchor on "End & Debrief", which also guarantees the restored
  session has validated before the storage-event assertions run.
  Result: 73/74 running tests pass (14 skipped); the one residual
  failure (voice-runtime lock 2) passes 8/8 in isolation and fails only
  from inter-spec state bleed on the shared server — the suite's known
  pre-existing weakness, documented for a dedicated isolation pass.

## [2.9.33] — 2026-08-08

### Fixed

- **"View full case summary" was missing History, Initial vital signs,
  and Examination findings** (tester bug report 2.9.15 #16). Three
  independent causes: (1) the modal read history keys nothing ever
  wrote — it now resolves through a shared `resolveCaseHistory()` built
  on the prompt builder's existing alias table, covering both
  `structuredHistory` and `clinicalRecords.history` shapes; (2) the
  vitals section implemented none of the monitor's fallback chain —
  it now mirrors it (initialVitals → earliest scenario frame → legacy
  flat config); (3) exam findings were fetched from an endpoint no
  client ever wrote to — performing an exam now persists the finding
  (best-effort, non-blocking) and the renderer reads the real
  `body_region`/`finding` columns. ManikinPanel previously never even
  knew the session id; it is now threaded through PhysicalExamScreen.

## [2.9.32] — 2026-08-08

### Added

- **Students can finally see the classes they belong to** (tester bug
  report 2.9.15 #18). Joining a class only fired a toast — no
  student-facing endpoint listed memberships, so a successful join was
  indistinguishable from a failed one. New `GET /cohorts/mine` (live,
  tenant-scoped memberships) and a "My classes" list in the join panel
  that refreshes after each join. A join code from a soft-deleted class
  now answers "That class has been closed" (`COHORT_DELETED`) instead
  of the generic not-found — the exact confusion that produced this bug
  report, since every seeded per-case course is soft-deleted.
  Cross-tenant codes still get the generic 404 (no existence leak).

## [2.9.31] — 2026-08-08

### Removed

- **The permanently-grey Records → Radiology stub** (tester bug report
  2.9.15 #6, product decision: delete rather than implement). The
  student tab and the authoring AI-access checkbox gated a field —
  `clinicalRecords.radiology` — that no UI could ever populate. The
  data reads stay: imported or hand-authored case JSON containing past
  radiology records still feeds the AI prompt and radiology order
  resolution.

## [2.9.30] — 2026-08-08

### Added

- **Treatment debrief in "View full case summary"** (tester bug report
  2.9.15 #10). Points were written per order and never summed; feedback
  texts were stored and never rendered; nothing computed "expected but
  not ordered". A new `GET /sessions/:id/treatment-debrief` returns the
  session's total points, each order's feedback, and the missed-expected
  list with `feedback_if_missed` — with a server-side gate: the missed
  list (which names the answers) is sealed until the session has ended,
  since the consultant room is reachable mid-session. The case summary
  renders the new section (six new i18n keys; en + pseudo shipped,
  de/es/it/fi/sv machine translations pending — English fallback until
  then).

### Fixed

- **Every treatment name in the case summary rendered blank** — the
  renderer read `treatment_name` but the `treatment_orders` column is
  `treatment_item` (the row callback was also named `t`, shadowing the
  i18n function on the same line).

## [2.9.29] — 2026-08-08

### Fixed

- **Configured lab tests ignored the case's default wait time, and the
  catalogue disagreed with the worklist about pending times** (tester
  bug report 2.9.15 #4). Three causes, all fixed: (1) every added lab
  was eagerly stamped with a concrete 3-minute turnaround, so the case
  default could never apply — unset is now stored as NULL ("follow the
  case default") and the editor shows the effective default as a
  placeholder; (2) an author's per-test "Immediate" (0) was silently
  discarded by the resolver — an explicit 0 now means instant,
  end-to-end; (3) the catalogue rendered the stored raw value while the
  worklist rendered the server-computed remainder — available-labs now
  returns `effective_turnaround_minutes` from the same resolver the
  order path uses, and both surfaces render it.

- **Ordering a lab stamped the order-time resolved wait into the shared
  case row** — including a student's "Order instantly" 0, which under
  the new contract would have made that test instant for every future
  learner. Materialization now stores the author's value (or NULL), and
  migration 0043 resets historical stamped 0s to NULL (no authored 0
  ever produced instant behavior, so nothing real is lost).

## [2.9.28] — 2026-08-08

### Fixed

- **Students received the treatment answer key** (tester bug report
  2.9.15 #7, plus #8 and #9). The available-treatments payload carried
  `is_expected`, `is_contraindicated`, points and both feedback texts to
  every authenticated caller — readable in DevTools even without the
  "Expected"/"CI" badges the panel also rendered. Below educator rank
  the payload now drops the grading fields AND hidden treatments
  (#9 — `is_available` was authored, stored, transmitted and then
  ignored); the badges and pre-order row tinting are gone, which also
  kills the stray "00" (React renders integer SQLite booleans — two
  adjacent `{0 && …}` guards printed literal zeros).

- **Hide + Expected/Contraindicated could be selected together**
  (#8). The three flags are now a mutually exclusive status in the
  authoring UI, enforced server-side by a normalization guard on save:
  hidden clears both statuses; if expected and contraindicated both
  arrive, the safety flag (contraindicated) wins.

## [2.9.27] — 2026-08-08

### Fixed

- **Selecting a scenario from Browse Repository dropped the teacher on
  the Story step** (tester bug report 2.9.15 #2). The return step was a
  hard-coded index that went stale when the Avatar step was inserted.
  Wizard step indices are now derived from a single ordered key list the
  step table itself is built from, so deep-links can't drift again —
  locked by source-contract tests banning numeric step literals.

- **Body Map image upload reported success but the image never appeared
  — anywhere, ever** (tester bug report 2.9.15 #13). The server wrote
  the file into the repo's `public/` root, which is never served (the
  SPA's assets come from `frontend/`; only `/uploads/*` maps to
  `public/`). Uploads now land in `public/uploads/bodymap/` and every
  reader (config previews, BodyMap, BodyMapDebug) probes the uploaded
  image first with a cache-busted fallback to the bundled default.
  Note for ops: uploaded silhouettes survive container restarts but not
  image redeploys — a volume for `public/uploads` is a follow-up.

## [2.9.26] — 2026-08-08

### Fixed

- **Emotion-questionnaire answers were stored but invisible everywhere**
  (tester bug report 2.9.15 #19). Both admin log feeds queried
  `el.created_at` — the `emotion_logs` column is `timestamp` — and the
  feed helper silently converted the SQL error into an empty result, so
  the source vanished with no trace. Columns fixed in both feeds; the
  helper now logs swallowed subquery failures; and the emotion-logs
  endpoints are tenant-scoped (the GET was a cross-tenant read, and the
  POST now stamps the caller's tenant so scoped reads keep seeing new
  rows).

- **Virtual patient and consultant were indistinguishable in Logs →
  Chat log — both just "assistant"** (tester bug report 2.9.15 #20).
  The persona was stored and returned all along but hidden behind a
  default-hidden column labeled "model". A visible "speaker" column now
  shows patient / student / the agent's role (e.g. consultant).

## [2.9.25] — 2026-08-08

### Fixed

- **Lesson-editor image/video/file uploads always failed with "Something
  went wrong"** (tester bug report 2.9.15 #12). The vendored lessons
  module's auth shim was stubbed to `null` (wrongly assuming rohy is
  cookie-only), so its raw upload XHR carried no `Authorization` and no
  `X-CSRF-Token` — the cookie path then failed CSRF with a 403 the toast
  swallowed. The shim now reads the real bearer token, the XHR attaches
  both headers, endpoints resolve through `apiUrl()` (base-path safe
  under `/rohy/`), and the server's actual error message reaches the
  toast. Seven regression tests lock the wire shape.

## [2.9.24] — 2026-08-08

### Fixed

- **"Brunette — middle-aged" and "Brunette — elderly" were the same 3D
  head** (tester bug report 2.9.15 #1). `brunette-t.glb` is a
  texture-reduced copy of `brunette.glb` with identical geometry — not
  an older person — and it was also the only entry in the
  `female.elderly` auto-pick bucket, giving every elderly female patient
  a mislabeled face. It is now labeled honestly ("middle-aged, light
  textures", kept so saved cases referencing it don't lose their
  avatar), and `female.elderly` falls back to the full-quality
  `brunette.glb` — mirroring how the male side already handles the
  missing-elderly-head gap. Four manifest-integrity regression tests
  now lock bucket/label consistency.

## [2.9.23] — 2026-08-08

### Fixed

- **The monitor's "Alarm" bell and "Monitor settings" gear opened the
  exact same window for students** (tester bug report 2.9.15 #17).
  Non-admins have exactly one drawer tab (alarms), so the gear was a
  duplicate of the bell; it is now rendered for admins only, where it
  opens on the rhythm tab. A source-contract test locks the rule.

## [2.9.22] — 2026-08-08

### Fixed

- **Enabled AI agents showed "Not Available" during simulation — no Call
  button, dead composer** (tester bug report 2.9.15 #11). The
  session-agents endpoint's hand-built projection never included
  `enabled`; the client treats an absent field as disabled, so every
  agent was unreachable even though the SQL only returns enabled ones.
  The projection now emits `enabled: true` and a server regression test
  pins the field; the 2.9.19 paging test's fixture (which hardcoded a
  shape the server never produced, masking this) now matches the real
  wire format.

## [2.9.21] — 2026-08-08

### Fixed

- **The session clock reset to 0 on every room switch, and the vital-sign
  scenario replayed from the beginning** (tester bug report 2.9.15 #14).
  `PatientMonitor` unmounts whenever the learner leaves the patient room,
  and both the clock and the scenario position were plain counters inside
  it. Both are now wall-clock anchored and *recomputed* each tick instead
  of incremented: the clock anchors to the server's `sessions.start_time`,
  and the scenario timeline persists an anchor
  (`{sessionId, scenarioId, startMs, offsetSec, playing}` — see
  `src/utils/sessionAnchors.js`, declared in the storage registry) so
  room switches, page refreshes, pause/resume, and background-tab timer
  throttling all land on the true position. Anchor reads are
  sessionId-scoped, so stale anchors from ended sessions are inert.

- **Alarms re-fired their audio every time the learner returned to the
  patient room.** `useAlarms` fire-state died with the unmount, so every
  still-breaching vital counted as a brand-new breach. Fire-state now
  parks per session in sessionStorage (per-tab, self-pruning) and is
  restored on mount — only genuinely new breaches sound.

## [2.9.20] — 2026-08-08

### Fixed

- **Logins collapsed after 4 idle hours — and a laptop sleeping through
  the refresh window got logged out mid-case.** The login lifetime was
  hardcoded in three places that silently had to agree: the JWT's `exp`,
  the `rohy_auth` cookie's maxAge, and the `active_sessions` row. All
  three now derive from one source, `authTtlSeconds()` (`JWT_EXPIRY`
  env; default raised to **7 days** — safe because every request
  re-checks server-side revocation, so logout/force-logout/password
  change still invalidate a token instantly).

  Separately, the client's "refresh 5 minutes before expiry" timer does
  not run while the machine sleeps and is throttled in hidden tabs, so
  it could fire *after* expiry — and any failed refresh (including a
  transient network error at wake) hard-logged the user out.
  `AuthContext` now also refreshes on tab wake/focus/reconnect when the
  token is inside its last hour, and a failed refresh consults
  `/auth/verify` before ending the session: only a definitive rejection
  logs out. Logout additionally clears the scenario anchor introduced
  in 2.9.21.

## [2.9.19] — 2026-08-07

### Fixed

- **Paging an agent did nothing visible, and the agent never arrived.**
  `agents` is fetched once per session and never written again;
  `agentStates` is the live layer the paging flow and the ETA-convergence
  loop keep current. `currentAgent` read straight off the stale array, so
  `agentStatus` — which gates the countdown card, the Call button *and*
  the composer's `disabled` attribute — never moved off its page-load
  value.

  From the learner's chair: you press "Call Dr. Chen" and nothing
  changes, so you press it again, which re-stamps the ETA and pushes the
  arrival further away. When the consultant does arrive, the convergence
  loop refreshes `agentStates` only — so the tab dot turns green next to
  a chat box that still refuses to accept input. The one escape was
  leaving the room and coming back, which remounted the chat and
  refetched the list. Status now reads through a single live overlay.

- **"Instant" was unreachable, and asking for it gave the longest wait
  in the system.** The page handler computed
  `Math.max(60, Math.min(180, configuredMinSec || 60))`. Two defects in
  one line: `|| 60` treats a configured **0 as absent** because 0 is
  falsy, and `Math.max(60, …)` floors it there again regardless. The
  ceiling had the mirror flaw, turning a configured max of 0 into 180.

  Net effect: `0/0` — the setting that asks for **no** wait — produced a
  uniform random 60–180 second wait, the widest band the system could
  generate, so configuring instant was strictly worse than configuring
  1–2 minutes. Wait times are now honoured literally. What remains is a
  15-minute ceiling, and it is a typo guard rather than pacing policy.

- **Instant is now a distinct state, not a zero-length countdown.** An
  instant page writes `present` with no `arrives_at`, so no wait card
  renders and nothing has to converge — the two mechanisms most likely
  to strand a learner are simply not involved.

### Changed

- **Agent arrival is instant by default.** Every seeded persona ships
  `response_time 0/0`, and migration `0042` zeroes existing rows plus the
  seeded consultant's template config (which shipped 2–5 minutes, i.e.
  2–3 minutes of every training session spent on a progress bar). A
  delay is now a deliberate teaching device a case author opts into —
  and, for the first time, one that behaves as configured. The
  consultant stays `on-call`: deciding to ask for help is still a
  decision the learner makes, it just no longer costs wall-clock.

- **`On-call · responds in 1–3 minutes` → `On-call · answers when you
  call`** across all six languages and the pseudo-locale. The old string
  described the removed clamp.

### Removed

- **`AgentService.calculateWaitTime()`** — a second, client-side
  implementation of the arrival delay that only its own unit tests ever
  called. It returned *minutes* where the live server path returns
  *seconds* and applied none of the clamping, so wiring it up would have
  shipped a wait an order of magnitude off. Its tests passed for the
  entire period the real feature was broken.

### Added

- **`docs/design/agent-behaviour-model.md`** — the four-axis model
  (availability · knowledge · stance · initiative) for supporting agents,
  what each proposed scenario needs, the `briefed` knowledge source that
  would make a handoff mean something, the learner-role gap behind
  nurse-student cases, and honest effort estimates. Includes a post-mortem
  of the delay bug above.

- **Coverage for `POST /sessions/:id/agents/:type/page`**
  (`tests/server/agent-page-wait.test.js`) and the client paging contract
  (`src/components/chat/ChatInterface.paging.test.jsx`). The endpoint had
  none, which is why the bug shipped and survived. Both suites were
  confirmed to fail against the pre-fix code.

## [2.9.18] — 2026-08-06

### Fixed

- **`docker compose up` no longer fails on the compose file itself.**
  Since v2.9.12 the file set

  ```yaml
  FRONTEND_URL: "${FRONTEND_URL:-https://${ROHY_HOSTNAME:-localhost}/rohy}"
  ```

  which puts one interpolation inside another's default. Compose has no
  nested interpolation and rejects the whole file:
  `invalid interpolation format for services.rohy.environment.FRONTEND_URL`.
  Every Docker deploy was dead on arrival, and nothing in the repo ran
  this file, so lint, tests and CI all stayed green.

  The composition itself is the documented contract — `.env.example` has
  always said `FRONTEND_URL` is derived from `ROHY_HOSTNAME` — so it moved
  to `entrypoint.sh`, where a shell can express a fallback and a test can
  execute it. Compose now passes both variables through unmodified.

  Note for anyone who patched this locally: escaping to
  `$${ROHY_HOSTNAME:-localhost}` makes the error go away but is worse than
  the error. `$$` is Compose's literal-dollar escape, so the container
  receives the text `https://${ROHY_HOSTNAME:-localhost}/rohy` verbatim
  and uses it, unexpanded, as its public origin.

- **Setting no hostname is now fatal instead of silently wrong.** The old
  default resolved to `https://localhost/rohy` whenever `ROHY_HOSTNAME`
  was unset, which defeated the entrypoint's own guard against booting
  production without a known origin. An unset hostname now reaches that
  guard and the container refuses to start, naming both ways to fix it.

### Changed

- **Documented the compose project name.** With no `name:` in the file,
  Compose derives the project from its directory — `deploy/docker/` — so
  resources land under the generic project `docker` (the DB volume is
  `docker_rohy-db`). A leftover volume of that name from an unrelated
  stack gets adopted by this one, which shows up as a container that
  never turns healthy rather than as a collision error. `.env.example`
  now ships `COMPOSE_PROJECT_NAME=rohy`, the quickstart uses `-p rohy`,
  and `docs/DEPLOY.md` explains why it must be chosen before the first
  run — plus how to move the volume if it wasn't. The default is
  unchanged, so no existing deploy loses sight of its database.

### Added

- **`tests/server/docker-compose-contract.test.js`** — nine checks that
  parse `compose.yml`, reject nested interpolation and `$$`-escaped
  values in any environment block, and execute the real `entrypoint.sh`
  to confirm the derivation, the explicit-override precedence, and the
  production refusal. The interpolation bug shipped because the only
  detector was a human typing `docker compose up`; this is that detector.
  Verified to fail against the v2.9.12 file.

## [2.9.17] — 2026-08-06

### Fixed

- **The patient room no longer clips the monitor on an iPad in portrait.**
  The chat column and the monitor column carried 350px and 600px minimum
  widths inside a viewport that never scrolls, so on any screen under
  950px the right-hand edge of the monitor — including part of the vitals
  column — was cut off with no way to reach it. Below 1024px the two now
  stack: conversation on top, vitals underneath. Desktop layout unchanged.
- **Vitals boxes no longer shrink and clip their own readings.** Each box
  in the monitor's vitals column is a fixed-height flex child that hides
  its overflow, but none of them declared `shrink-0`. In a column shorter
  than their combined height the browser squeezed them instead of
  scrolling — the heart-rate box rendered at 25px against its declared
  96px, showing the bottom half of "110" as if it were the whole reading.
  A clipped vital that still looks like a number is the worst failure in
  this list. Reproduced on any short window, not only tablets.
- **The lab and radiology rooms are usable on a tablet.** Their three
  columns left the report viewer about 280px wide in portrait, enough to
  wrap a one-line empty state over ten lines and to overlap the
  READY/PENDING/VIEWED counters. Below 1024px the panes stack full-width.
- **Room headers no longer run underneath the capture pill.** The Oyon
  pill is a fixed overlay centred at the top of the viewport; on a
  tablet-width header the case title ran beneath it. Titles now stop short
  of the centre, and "End & Debrief" collapses to its icon.
- **The body-map legend no longer clips.** Four keys in one non-wrapping
  row need ~330px and had ~250px; the first and last were cut mid-word.
- **The case wizard no longer strands an author mid-way.** The step strip
  put eleven equal-width buttons in one non-shrinking row, so on anything
  narrower than a desktop the later steps overflowed off-screen; the row
  now wraps below 1280px. The footer separately treated step 9 as the last
  (it was, before two steps were added), so "Next" disappeared after
  Records and Treatments/Agents offered only "Save & Finish" — the last
  step is now derived from the step list. Regression-locked in
  `ConfigPanel.test.jsx`.
- **The physical exam editor stacks below 1024px.** The body map at a
  third of a tablet's content column was too small to hit a region
  reliably, and its 500px inner scroller became a scroll trap once
  stacked.

### Added

- `npm run test:e2e:tablet` — Playwright checks every student-facing room
  at 820x1180 and 1180x820, asserting no horizontal overflow (the failure
  mode above: content pushed outside a clipped container is unreachable,
  not merely ugly) and writing a screenshot per room per viewport to
  `test-results/tablet-layout/`. Requires `npm run build` first; like the
  rest of the Playwright suite it is not in CI.

## [2.9.16] — 2026-08-06

### Fixed

- **The Voice settings tab no longer claims the default voice is a
  fallback.** It said the per-language default plays "when a configured
  voice can't — missing engine, missing key, or a paid-service outage".
  That is the opposite of how the platform behaves: a character whose case
  or persona names a voice keeps that voice, and goes silent with an error
  if it cannot play. Admins who changed the default expecting a broken
  cloud voice to be replaced got silence instead. The tab now states the
  real rule — a default speaks only for a character with no voice
  configured at all — and points at the case editor and persona editor.

### Changed

- **The case wizard's second step is now labelled "Avatar & Voice"**
  (was "Avatar") in all six languages. The patient's voice picker has
  always lived there; the label hid it, so authors looked for a voice
  setting in the case editor and did not find one.
- **Voice diagnostics now name where a voice is configured.** The resolver
  reports a `source` (`case`, `persona template`, `platform default`)
  alongside the existing tier, and the diagnostic bar shows it on the
  speaker table, the runtime panel and the compact one-liner. A case voice
  and a persona-template voice both reported tier `override`, which left
  "why did changing the platform default do nothing?" unanswerable without
  reading the database.

## [2.9.15] — 2026-07-31

### Fixed

- **Saving a case no longer fails when the interface is not in English.**
  Creating or updating a case returned a server error in German, Spanish,
  Finnish, Italian and Swedish. Authors could edit a case but never save it;
  English was unaffected, so the fault only appeared once someone worked in
  another language.

  The patient-gender dropdown stored whatever it displayed. Because the
  displayed text is translated, choosing "Männlich" tried to store the word
  "Männlich" in a column that only accepts `Male`, `Female` or `Other`, and the
  save was rejected at the last possible moment. English worked purely by
  coincidence — its label for that option is the word "Male", which the column
  happens to accept.

  Every dropdown of this kind now stores a fixed English value and translates
  only what you see. The same fault affected the marital-status and persona
  dropdowns; those did not fail visibly, but they did store the label in
  whatever language the author happened to be using, so the persona instruction
  sent to the model changed with the interface language. Both now store a
  stable value. A case saved before this fix keeps its old value and still
  shows it in the dropdown rather than appearing blank.

- **A patient's sex is no longer read as male whenever the value is
  unfamiliar.** The body map and examination manikin decided sex by testing
  whether the stored value was exactly the English word "female". Anything else
  — including a correct value in another language — silently produced a male
  body map, with no error to notice. That decision now lives in one place, and
  the male default applies only where there genuinely is no distinct anatomy.

- **A rejected save now explains itself.** The failure surfaced as an internal
  server error carrying raw database text, which said nothing useful and
  exposed schema internals. Both the create and update paths now check the
  value first and answer with a plain message naming the accepted values.
  A value that is merely lower-case (`male`) is corrected rather than refused,
  so older API clients and imported cases keep working.

### Added

- **A guard so this class of bug cannot return.** The patient-demographic
  vocabularies live in one shared module (`server/shared/patientDemographics.js`)
  used by both the editor and the server. A new test fails on any dropdown whose
  label is translated but whose stored value is left implicit — the exact shape
  of this bug, which is invisible in review and in every English-language test
  run. A second test drives a real server in all five languages and locks the
  rejection behaviour for both create and update.

## [2.9.14] — 2026-07-31

### Changed

- **rohy is now licensed under the Carm Research License v1.4**, replacing MIT
  and bringing it in line with the rest of the Carm ecosystem (Oyon, ChatOyon,
  Carm, LAILA). It is free for research, teaching, personal learning and
  non-profit use — including industry-sponsored and collaboratively funded
  academic work, which v1.4 places explicitly inside the free grant regardless
  of funding source. Commercial use requires a paid license. Anything you
  produce by running rohy on your own data remains entirely yours.

  MIT was not merely a different choice, it was an inaccurate one. rohy
  git-tracks the vendored `OyonR/` addon — 658 files including its own
  `LICENSE`, `NOTICE.md` and nine third-party texts — which is licensed under
  the Carm Research License and forbids sublicensing and resale. The root
  `LICENSE` was simultaneously granting permission to "sublicense, and/or sell"
  that same tree. The two statements could not both be true.

  The license text is fetched from the canonical
  [carm-license](https://github.com/mohsaqr/carm-license) repository at its
  **version tag**, never `main`, so a routine build cannot silently relicense
  the product; adopting a future version is a deliberate one-line edit.

### Added

- **`NOTICE.md` — a complete index of everything rohy redistributes**, with
  every license embedded in full rather than linked, as the Carm license
  requires. `scripts/licenses.manifest.mjs` is its single source of truth;
  `npm run license:sync` refreshes every text from its canonical upstream on
  each build, `npm run license:verify` is the strict release form, and
  `npm run license:latest` reports when a newer Carm License version exists.

- **`tests/server/license-contract.test.js`** — 54 fully offline assertions
  covering the whole contract: every manifest entry has real committed text,
  every text is linked from `NOTICE.md` alongside its live upstream, the
  version string agrees in every file that names it, the Carm license is
  pinned to a tag rather than a branch, and the Docker image genuinely
  carries `LICENSE`, `NOTICE.md` and `licenses/`.

### Fixed

- **The container image no longer ships without its license.**
  `deploy/docker/Dockerfile` labelled images `MIT` and copied no license file
  at all. It now copies `LICENSE`, `NOTICE.md` and `licenses/` into the
  runtime stage, and `.dockerignore` re-includes `NOTICE.md` past the blanket
  `*.md` exclusion — the same two-gate trap that previously shipped broken
  images for `Lab_database.json`, `heart.txt` and `CHANGELOG.md`.

### Disclosed

Three obligations that were already true but written down nowhere. None of
them change how rohy runs; all three matter before you deploy it.

- **Building the image with `INCLUDE_PIPER=1` redistributes GPL-3.0 software.**
  Piper TTS is `OHF-Voice/piper1-gpl`, and that build variant bakes it into the
  image. The default build does not, and rohy's own terms are unaffected. The
  full GPL text now ships at `licenses/piper1-gpl.COPYING.txt`.

- **The default Piper voices are not uniformly MIT.** The voice repository
  declares MIT, but each voice's `MODEL_CARD` names its own dataset license and
  several are research-restricted — `en_US-lessac-*`, installed by default,
  is trained on the CSTR Blizzard 2013 corpus. Check the card for each voice
  you enable before deploying commercially.

- **The CALIPER paediatric reference ranges are CC BY-NC-SA**, whose
  non-commercial term is incompatible with a commercial deployment. They are
  isolated behind their own `data_sources` row by design, so that source can be
  dropped cleanly without disturbing the adult ranges or the LOINC coding.

`NOTICE.md` also records one unresolved item: the auscultation audio in
`public/sounds/` is committed and shipped, but its origin and license are not
recorded anywhere in the repository or its history. It is listed as unresolved
rather than omitted, because an unknown license is a risk to a redistributor
and an empty row is more honest than an invented one.

## [2.9.13] — 2026-07-31

### Fixed

- **The dark strip below the Oyon dashboard is gone.** The panel stopped short
  of the bottom of the window, leaving a dead band of empty space. It now fills
  the room properly.

## [2.9.12] — 2026-07-30

### Fixed

- **The container image builds again.** The v2.9.11 image build failed outright:
  the Oyon asset verifier added in "build: harden Oyon asset installation" runs
  during `npm install`, but the Docker builder did not copy `scripts/` until
  after that step, so the install aborted and no image was produced. The air-gap
  tarball was unaffected. Operators should use v2.9.12; the v2.9.11 release has
  no container image.

## [2.9.11] — 2026-07-30

### Fixed

- **The Oyon dashboard no longer goes blank after a page refresh.** It used to
  render on the way in and then show "No stored windows yet" on reload. The
  embedded Oyon viewer only ever displays one session at a time — a deliberate
  privacy boundary — and with no session selected it shows nothing at all. The
  dashboard now names the session it is showing and offers a picker for the
  others, so a refresh lands on real data instead of an empty panel.
- The same fault meant only the live session was ever reachable; every earlier
  session in the fetched pool was invisible. All of them can now be opened.

## [2.9.10] — 2026-07-30

### Added

- An end-to-end test covering the whole signal path — real capture engine, real
  window shapes, real validation — so a break in the joins between capture and
  storage is caught before it reaches a learner.

## [2.9.9] — 2026-07-30

### Added

- **Typing rhythm is now actually recorded** for tenants that enabled it: pauses,
  bursts, revisions and whether a message was sent or abandoned — never the
  words themselves. Consented learners only.
- Interaction signals (pointer, scroll, focus, idle) record alongside it.

### Fixed

- Signal capture no longer depends on the camera being switched on. Consent for a
  session is registered once and shared, so a tenant running Oyon without the
  camera gets typing analytics instead of silence.

## [2.9.8] — 2026-07-30

### Added

- The plumbing that carries the new Oyon signals to the server, loaded only when
  a tenant has enabled them and the learner has consented.

### Changed

- The Oyon signal engine is loaded on demand, keeping it out of the main
  application bundle: startup is unchanged for everyone.
- Excluded an unused inference runtime from the browser bundle, cutting about
  48 MB from the shipped build and the container image. Nothing that runs in the
  browser needed it — the same runtime is already served alongside Oyon's models.

## [2.9.7] — 2026-07-30

### Added

- **A consent prompt for the widened capture scope.** Learners who previously
  agreed to camera-based emotion capture are now asked once, plainly, about the
  additional signals: typing rhythm (pauses and bursts, never the words),
  on-screen interaction, and the style of the messages they send. Saying no
  leaves their existing emotion-capture choice untouched, and either choice can
  be changed later under Settings → Oyon.
- The consent version a learner actually saw is recorded when they answer, so a
  future change of scope asks again rather than assuming.

### Changed

- Learners who declined are not asked again, and learners who have never
  answered continue to see the first-run consent card rather than this prompt.

## [2.9.6] — 2026-07-30

### Added

- **Consent version 2, covering the non-camera signals.** Typing dynamics,
  interaction telemetry, discourse analytics and AI-assistance cycles are new
  categories of personal data rather than more camera-derived affect, so they
  are not covered by the original consent. Rohy now records **which consent
  version each learner actually accepted**, and refuses to store any of the new
  signals for a learner whose accepted version predates it. Camera-derived
  signals are unaffected and continue to work under the original consent.
- Administrators get switches for typing, interaction, discourse and
  AI-assistance under Settings → Oyon → Signals. They stay dormant until a
  learner accepts the new consent, whatever the switches say.

### Changed

- Tenants still using the original default consent version are moved to the new
  one. An administrator who set a custom consent version keeps it.

### Security

- The consent check runs on the server at ingest, not only as a prompt in the
  browser, so an out-of-date client cannot record signals a learner never agreed
  to. A client that does not state which consent version it displayed is treated
  as having shown the original one, and so cannot grant itself the new scope.

## [2.9.5] — 2026-07-30

### Added

- **Administrator control over Oyon's signal families.** Settings → Oyon now has
  a Signals section with a switch per family: facial signals, eye/engagement,
  gaze, illumination, learner heart rate, learner respiration, dynamical
  features, body posture, and whether signals travel on one window or their own.
  These signals were already being recorded by the capture component's own
  defaults, and the platform previously had no way to switch any of them off —
  this closes that gap, so the settings now reflect what actually runs.
- Heart rate and respiration are labelled explicitly as camera-derived research
  estimates about the **learner** — never clinical measurements, and unrelated to
  the simulated patient's vital signs.

### Changed

- Body posture is **off by default**. Its pose model is not bundled with rohy, so
  switching it on makes the browser download the model from an external CDN,
  which breaks the guarantee that air-gapped installations never reach the
  internet. The toggle is labelled accordingly and stays available for
  administrators who accept that trade-off.

## [2.9.4] — 2026-07-30

### Added

- **A named Oyon dashboard for educators and administrators.** A new full-page
  surface, reachable from the top-bar menu, that renders Oyon's own Analyze
  dashboards over the platform's stored windows. It sits beside the existing
  Emotion Analytics view rather than replacing it: Emotion Analytics remains
  Rohy's own dashboard, while this surface shows the engine's, so newly enabled
  signals appear here as the engine gains support for them. Access uses the
  existing Oyon permission — educator or administrator, subject to the
  per-role tenant setting — and all authorisation stays on the server.
- Window-shared signal blocks captured under Oyon 3 (facial, posture, heart
  rate, respiration, illumination, capture quality) are now passed through to
  the dashboards, so the new signals can be displayed as they start arriving.

### Changed

- The German, Spanish, Italian, Finnish and Swedish strings for the new
  dashboard are provisional and awaiting native review.

## [2.9.3] — 2026-07-30

### Fixed

- Regenerated the `en-XA` pseudo-locale for `authoring_config`, which had been
  stale since the 2.7.x registration/approval-queue work: 25 keys existed in
  `src/locales/en/authoring_config.json` with no pseudo counterpart, so
  `?pseudo=1` rendered them as plain English and could not flag them as
  translated-but-unverified or catch truncation.

## [2.9.2] — 2026-07-30

### Added

- **Storage and a read API for Oyon 3's new signal modalities** — the groundwork
  that makes enabling them safe, landed before any capture flag is turned on.
  Migration `0039` adds an `oyon_signal_windows` table for standalone
  modality-only windows and host-bounded episodes (typing, voice, interaction,
  discourse, ai-assist), plus six nullable columns on `oyon_emotion_records` for
  the blocks that ride on the emotion window. New `GET /addons/oyon/
  signal-windows` sits behind the existing Oyon read policy (role + per-role
  tenant flag, tenant scoping, redaction) and reports which modalities hold data.

### Fixed

- **Oyon 3 window blocks were discarded on ingest.** Every `*_window_share`
  setting defaults on, so `facial`, `posture`, `heart_rate`, `respiration`,
  `illumination` and `capture_quality` arrive as extra keys on the ordinary
  emotion window — and `insertEmotionRecord` had no columns for them, so they
  were dropped without a trace. This is the same defect migration `0028` records
  about v1 discarding `gaze` and `engagement`, repeated for the v3 signals.
- **A standalone modality window failed its whole batch.** With
  `*_window_share` off (and on stop/flush) Oyon emits `facial_only` /
  `posture_only` / `heart_rate_only` events that carry no emotion data and keep
  `valid_frames` inside the modality block. Routed into `oyon_emotion_records`
  that bound NULL into a NOT NULL column, so the insert threw and the entire
  batch was rejected — losing the emotion windows travelling with it.

### Changed

- Ingest now splits on Oyon's own `isModalityOnlyEvent` seam, so emotion windows
  keep their existing path unchanged. `inserted` / `skipped` still count emotion
  records only; new modality counts are reported separately as
  `signals_inserted` / `signals_skipped`. Existing dashboards, queries and
  response shapes are untouched — the new rows live in a separate table that
  legacy SQL cannot address.

## [2.9.1] — 2026-07-30

### Fixed

- Regenerated `docs/reference/cli/index.md`, which had drifted since 2.9.0: the
  release added `scripts/verify-oyon-install.mjs` and the `verify:oyon` script
  (and chained it into `setup:oyon`) without regenerating the CLI reference, so
  `npm run docs:check` failed on a clean 2.9.0 checkout. No workflow runs on
  release branches, so nothing caught it.

## [2.9.0] — 2026-07-29

### Changed

- Upgraded the isolated 2.9 release line from vendored Oyon 2.2.0 to the
  immutable Oyon 3.3.2 release, retaining Rohy's existing capture, consent,
  same-origin asset, session identity, and database integration contracts.
- Added Oyon v3's sensing, typing, voice, interaction, discourse, and analytics
  modules and its versioned `tnaj` bundle without enabling new capture
  modalities by default.
- Pinned Oyon updates to version 3.3.2 and narrowed runtime-asset preservation
  so future syncs refresh versioned source vendors without deleting downloaded
  MediaPipe, ONNX Runtime, or model assets.
- Hardened fresh installs with atomic, checksummed model downloads and a
  fail-fast verifier covering peer-version runtime copies, models, workers,
  WASM, the multi-file element artifact, and Rohy's persistent sync overlays.
- Rohy now sends the explicit `oyon-window-batch-v4` envelope and requests
  source-rate live sample events from the v3 web component.

## [2.8.0] — 2026-07-29

This is the first published release of the development line previously
versioned as 2.6.x and 2.7.x. The detailed 2.7.x milestone entries remain
below for traceability; they were not published as separate GitHub releases.

### Added

- **Courses, lessons, and surveys.** Educators can organise learners into
  courses, author rich lessons, assign cases, collect surveys, and run the
  student classroom experience from the same platform.
- **Six-language experience.** German, Spanish, Italian, Finnish, and Swedish
  join English across the learner and instructor UI, with language-aware cases,
  voices, and local Piper voice packs.
- **Voice 2.0.** Case-owned voice identity, multilingual Google TTS, improved
  Kokoro and Piper routing, provider-aware settings, and clearer voice controls.
- **First-run onboarding.** Administrators get a platform setup checklist;
  learners and teachers get role-appropriate welcome flows and saved language,
  microphone, voice, and consent choices.
- **Registration governance.** Open, closed, invite-only, and
  administrator-approval modes; email-domain rules; revocable invitation links
  and codes; course auto-enrolment; and an approval queue that stores only
  password hashes.
- **Consent-bound affect routing.** When explicitly enabled, fresh local Oyon
  affect signals can inform the AI patient's in-character response without
  exposing raw camera data or claiming to measure emotion.

### Changed

- Redesigned LLM settings, consolidated top-bar controls, expanded course and
  case browsing, immutable case languages and codes, and plain-text response
  support.
- Fresh installations default to closed registration while preserving a safe
  first-admin claim or explicit `ROHY_ADMIN_*` provisioning path. Existing
  installations retain their prior open behavior until configured.
- Brought forward the verified 2.5 release pipeline: required Oyon asyncify and
  MediaPipe assets are packaged and probed across Docker, air-gap, and
  published-image installation paths.

### Fixed

- Corrected course co-teacher visibility, availability-window updates,
  join-code normalisation, course case-move authorization, affect-setting error
  logging, and a broken lesson survey response action.
- Corrected account lockout timestamp handling east of UTC, refused suspended
  accounts before token creation, and aligned client/server password rules.
- Corrected hard deletion of auto-enrolled users by removing their course
  membership inside the same cleanup transaction.
- Corrected LLM error-message namespace extraction so the i18n gate no longer
  creates empty duplicate keys in the shared catalogue.
- Added regression coverage for registration pathways, course administration,
  first-run bootstrap, runtime assets, and session-running authorization.

### Security

- Closed session and order IDOR paths, enforced session ownership and tenant/case
  binding for lab results, examinations, treatments, and staff access, and made
  order administration atomic.
- Enforced target-rank ceilings so administrators cannot edit, reset, or delete
  peer administrators through direct API calls.

## [2.7.14] — 2026-07-15

### Changed

- Regenerated the `docs/reference/**` reference from source now that the new
  registration/approval routes and migration 0038 have landed (adds the
  registration API page and refreshes the data/schema and config references), and
  synced the i18n catalogues with the approval-queue UI strings. Keeps the
  `docs:check` and `i18n:check` gates green.

## [2.7.13] — 2026-07-15

### Added

- **Server regression tests locking the audit fixes.** New pathway suites:
  `session-running-pathways` (lab-results IDOR, order-labs case binding, exam
  tenant/case trinity), `course-admin-pathways` (co-teacher visibility, window
  read-merge, join-code normalisation, case-move authorisation), and the
  registration/approval-queue pathways (park/approve/reject/re-apply, invite
  skips queue, closed-admits-invite, lockout east of UTC, suspended login).
  Shared `tests/utils/authHttp.js` helper for HTTP + DB seeding.

## [2.7.12] — 2026-07-15

### Fixed

- The affect-settings load/update handlers now log the error before returning
  500 — the failure was previously swallowed, leaving a 500 with no trace. Also
  dropped an unused `getAllProviderStatus` import from the proxy routes.

## [2.7.11] — 2026-07-15

### Fixed

- **Course-administration defects (audit).** A co-teacher now sees the courses
  they co-teach in `GET /cohorts` — the list filtered on `owner_user_id` alone,
  so a course a co-teacher could PATCH and assign cases to never appeared for
  them. The cohort-case window PATCH now read-merges: sending only
  `available_until` no longer wipes `available_from` (which quietly re-opened the
  case earlier than the teacher set). Join codes are normalised on the way in
  (case-folded, separators dropped), so `RKM7-PQ2H` and `rkm7pq2h` are the same
  code. Moving a case out of a course you don't manage is refused (403) — the
  permission was checked on the course the case moved *to* and on nothing it
  moved out of, so any educator could strip another teacher's case from theirs.

## [2.7.10] — 2026-07-15

### Added

- **Registration approval queue (migration 0038).** `approval` mode was
  selectable and advertised by the public probe, but `/auth/register` had no
  branch for it — it behaved exactly like `open`, admitting everyone with a token.
  It now parks an applicant in `registration_requests` (hashed at request time,
  never a user row) and an admin approves or rejects from the Users workspace; on
  approval the hash moves into the new `users` row untouched, so the applicant
  signs in with the password they chose. A valid invite skips the queue.

### Fixed

- **Auth-entry hardening (audit).** Account lockout compared a SQLite UTC
  timestamp parsed as local time, so on a server east of UTC the lock was always
  already "in the past" and did nothing (unlimited guessing) — it now converts
  correctly. Suspended/deleted accounts are refused before bcrypt instead of
  minting a token that immediately stops working. A valid invite now opens a
  `closed` door (closed governs strangers, not admin-issued invitees).

## [2.7.9] — 2026-07-15

### Fixed

- **Session-running IDOR and tenant escapes (audit).** `GET
  /sessions/:id/lab-results` now requires session ownership — it previously
  carried `authenticateToken` and nothing else, so any logged-in student could
  walk session ids and read another learner's results (the graded answer key).
  Lab orders are bound to the session's own case (`AND case_id = ?`), so a client
  can no longer order another case's — or tenant's — investigations. Exam findings
  and treatment orders now persist the caller's `tenant_id` (they defaulted to
  tenant 1, silently moving a tenant-2 learner's data out of their own tenant and
  out of reach of the erasure purge), and take `case_id` from the session rather
  than the request body. `verifySessionOwnership` scopes staff access to their own
  tenant. Administering an order is now a compare-and-swap (409 on a double-fire)
  and the client-supplied turnaround override is clamped, so `Infinity` can no
  longer permanently brick an investigation.

## [2.7.8] — 2026-07-15

### Fixed

- **ESLint is back to zero errors.** Cleared 12 pre-existing errors that were
  blocking a clean lint gate: unused imports/props in `App.jsx`,
  `InvestigationWorklist.jsx`, `LanguageContext.jsx`, a server test, and the
  vendored `lessons/**` editors; one unnecessary regex escape in the lessons
  `sanitize.js` URI allow-list (semantically identical); and a real bug in the
  lessons `SurveyManager` — the injected `onViewResponses` handler was destructured
  by the parent but never threaded to `SurveysTable`, so the "Responses" row action
  referenced an undefined variable (a `ReferenceError` on click, masked only because
  it fell through to the LAILA URL). The handler is now passed down. Warnings are
  untouched; behaviour is otherwise unchanged.

## [2.7.7] — 2026-07-14

### Added

- **A front door worth arriving at.** The logged-out screens now sit in a split layout:
  a brand panel that says what Rohy is — AI patients, an AI care team, real labs and
  radiology, consent-bound affect capture, process analytics — beside the sign-in card.
  The language picker moved into that panel, so it is chosen once and the whole
  login/register flow follows.
- **The invite code has a home on the login card.** "Register with an invitation code"
  opens the register form with the code field already expanded. A code is one artifact
  with two deliveries — a link and something you can read down the phone — so the box
  is now reachable in *every* mode that permits registration, not only invite-only.
  Left collapsed behind a one-line prompt otherwise, and marked optional when it is.

### Fixed

- **The register form no longer accepts passwords the server rejects.** It asked for six
  characters; the server demanded eight with an uppercase letter, a lowercase letter and
  a number, and refused the account after the fact. The rules are now shown as a live
  checklist as you type, from `src/utils/passwordRules.js` — the client mirror of the
  server's `validatePassword()`. Password fields can be revealed.

## [2.7.6] — 2026-07-14

### Added

- **Invites — a link and a code, and they are the same thing.** An administrator
  can mint an invite in Settings → Users → Invites, choose the role and the course
  it grants, cap how many people may use it, and set when it expires. Share it as
  a link (`/register?invite=…`) or read the code out loud — both are the same
  token, so there is nothing to keep in sync. Anyone who uses it lands in the
  course automatically.
- **Invite-only registration.** With the mode set to *Invite only*, an invite is
  required to sign up. A valid invite also gets someone in when self-registration
  is otherwise closed — that is what an invite is: a named exception to the rule
  on the front door.
- Invites are revocable (people who already joined keep their accounts), and every
  redemption is recorded. The code itself never reaches the audit log.

### Fixed

- **Invite links would have 404'd in production.** Only `/` ever served the app,
  so any path-based link died at the web server — invisible in development, where
  Vite's history fallback quietly covers it. `/register` is now served explicitly
  (not by a wildcard, which would have swallowed the docs site).

### Notes

- Rohy still cannot send email, so an invite is a copy-paste artifact — like the
  course join codes teachers already share. The dialog puts the link and the code
  in front of you, ready to copy, rather than making you hunt for them.

## [2.7.5] — 2026-07-14

### Added

- **Registration is no longer always open.** An administrator now chooses how
  people get accounts, in Settings → Platform → Users: **Open** (anyone who can
  reach the page signs up — what Rohy has always done) or **Closed** (only
  administrators create accounts). *Approval required* and *Invite only* appear
  in the picker and land next.
- **Allowed email domains.** Restrict self-registration to your institution's
  domains. Accounts an administrator creates are never restricted.
- **A message for people who can't sign up.** With registration closed the login
  screen no longer shows a dead "Create Account" link; it shows who to ask, using
  the text you set.

### Changed

- **A brand-new install is now closed by default.** Previously any freshly
  deployed instance was open to whoever found the URL. **Existing installs are
  untouched** — with no setting stored, registration stays open exactly as before,
  and upgrading changes nothing.
- **The first account still claims a fresh instance**, in every mode. The
  bootstrap is resolved before the policy is consulted and bypasses it entirely,
  so shipping an instance as closed can never leave it with no way to reach a
  first administrator.
- The register screen no longer tells every visitor that "the first user will
  automatically become an administrator" — it says so only while that is actually
  true.

## [2.7.4] — 2026-07-14

### Security

- **An admin could take over another admin's account.** `PUT /users/:id` and
  `DELETE /users/:id` checked the *requested* role against the caller but never
  the *target's* rank — unlike `PATCH /users/:id/status` and
  `POST /users/bulk-action`, which both refuse a target at or above the caller.
  So any admin could open a peer admin in the edit form and set a new password.
  The Users table hid the Delete button for peers but rendered **Edit**
  unconditionally, and a hidden button is not a security boundary: the API is
  reachable directly. Both routes now carry the same target-rank guard as their
  siblings (editing *yourself* is still allowed), and the client only offers Edit
  where the server would accept it.

## [2.7.2] — 2026-07-14

Ports the two fixes released as 2.5.2 on the 2.5.x line (see below); both bugs
were present here too.

### Fixed

- **A fresh install can reach an admin again.** Production refuses to seed the
  well-known `admin`/`admin123` account and `/auth/register` forced every signup
  to `student`, so a freshly pulled image had no path to an admin at all — and
  the first-run setup wizard assumes you already are one. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin with
  your own password, or leave them unset and the first account registered through
  the UI claims the instance.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access ships as opt-in (`enforce_cohort_case_access`, default OFF), but
  the case catalog, the direct case read and the session launch gate all applied
  it to every student unconditionally — the flag was read by nobody, so the admin
  toggle (and the setup wizard's step 6) was a no-op, and students on every
  install have been restricted to the default case plus course assignments since
  migration 0030. All three sites now share one `caseAccessEnforcedFor()` gate.

## [2.7.1] — 2026-07-12

### Added

- **First-run setup for administrators.** New admins land in a six-step
  setup checklist: connect the AI engine (with a live connection test —
  students can't chat until it passes, and the wizard says so), pick the
  platform's default language, confirm the default course and case, enable
  voice, enable emotion capture, and choose who sees which cases. Every step
  is optional and everything stays editable later — the checklist can be
  dismissed and reopened any time from the menu → **Platform setup**.
- **A welcome screen for students and teachers.** On first login you pick
  your language, see the case you'll start with, choose whether you want to
  talk to the patient out loud (with a microphone check), and — where the
  camera-based emotion capture is enabled — see and decide the consent that
  was previously set silently. Teachers get a pointer to case authoring.
  Choices are saved to your account, so they follow you across devices.
- **Platform default language.** Administrators can now set the language new
  users start in (previously always English). Each user's own choice still
  wins.

### Fixed

- Your "talk to the patient" preference now survives a page reload instead
  of resetting to off every time.

## [2.7.0] — 2026-07-12

### Added

- **The patient senses how you're doing.** When an administrator enables
  affect routing, the AI patient is told each turn how you currently appear
  (from the consent-gated Oyon emotion capture) and reacts in character — a
  frightened patient settles when you seem calm, and gets more distressed
  when you seem flustered. The patient never claims to see or measure your
  emotions. Off by default, admin-configurable (signal type, confidence and
  freshness thresholds), and restricted to local AI providers unless
  explicitly widened. Nothing is routed without your capture consent.

## [2.5.6] — 2026-07-19

### Fixed

- **Release verification now checks the real MediaPipe model path.** The
  published image correctly ships
  `standalone/models/mediapipe/face_landmarker.task`, but the release-only
  probe omitted the `mediapipe/` directory and falsely reported a 404. The
  published-image gate now mirrors the complete fresh-install asset list, and
  a regression test keeps both workflows aligned.

## [2.5.5] — 2026-07-19

### Fixed

- **Published-image release verification now reaches the Oyon probes.** The
  verifier booted the production container without its required
  `FRONTEND_URL`, so the entrypoint correctly stopped before `/api/health` and
  the release workflow could not inspect the assets it had just published.
  The verifier now supplies the same explicit localhost origin used by the
  fresh-install Docker gate, with a regression assertion covering the boot
  contract.

## [2.5.4] — 2026-07-19

### Fixed

- **Oyon emotion capture now starts on fresh installs.** The browser-side
  ONNX Runtime selects `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` for the
  classifier, but the 2.5.x installer copied only the plain SIMD/threaded
  pair. Both asyncify companions are now provisioned from the installed
  `onnxruntime-web` package in npm, Docker, local, bootstrap, and air-gap
  installation paths.
- Fresh-install, deployed-host, air-gap, and release-image checks now treat
  both asyncify files as required assets, preventing the same 404 regression
  from reaching another release.

## [2.5.2] — 2026-07-14

### Fixed

- **A fresh install can reach an admin again.** In `NODE_ENV=production` the
  seeder refuses to create the well-known `admin`/`admin123` account, and
  `/auth/register` forced every signup to `student` — so a freshly pulled
  Docker image had no path to an admin at all. Settings showed only three
  tabs, the case list showed one case, and case authoring was invisible,
  which read as a broken build rather than a permissions state. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin
  with your own password (works in production, no default credential ever
  exists), or leave them unset and the first account registered through the
  UI claims the instance. Both apply only while the `users` table is empty.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access is documented and shipped as opt-in (`enforce_cohort_case_access`,
  default OFF), but the case catalog, the direct case read, and the session
  launch gate all applied it to every student unconditionally — the flag was
  read by nobody and the admin toggle was a no-op. Since 0030 that has quietly
  restricted students on every install to the default case plus whatever a
  course assigned them. All three sites now consult the flag through one shared
  `caseAccessEnforcedFor()` gate, so an install that never opts in behaves as
  documented: students see every available case.

### Added

- `ROHY_ADMIN_USERNAME` / `ROHY_ADMIN_PASSWORD` / `ROHY_ADMIN_EMAIL` — provision
  the first admin at boot. Wired through `deploy/docker/compose.yml`; the
  entrypoint now announces which bootstrap path is live. A weak password is
  refused loudly rather than seeding an account nobody can log into.
- DEPLOY.md gains a "Getting the first admin" section, including how to promote
  an existing account that got stuck as a student.

## [2.5.0] — 2026-07-04

### Added

- **The patient makes eye contact and follows you.** When Oyon capture is
  running, the patient's (and debrief discussant's) eyes and head track
  your movements via the webcam face stream, glance at the vitals monitor
  when an alarm fires, and settle back into eye contact when you're still.
  He never looks down, and only rarely (and slightly) up.
- Monitor header redesign: the Oyon capture pill gets a reserved dock in
  the center, the Rohy wordmark leads the header, and the patient's name
  now captions the avatar.
- Settings sidebar is flat (no collapsing sections) and ordered by how
  often each area is used; reference catalogues (Body Map, Lab Database,
  Medications) live under Libraries near the bottom.

## [2.3.10] — 2026-05-17

### Changed

- **Removed the Playwright E2E job from CI.** It is a pre-existing
  brittle/flaky UI harness (many specs maintainer-marked
  `SKIP … brittle`; failures span unrelated files; headless render
  timeouts; several pass only on retry). It was red on `main` before
  this branch and gave no reliable signal as a blocking gate, so it
  blocked an otherwise-green pipeline. The suite still exists and runs
  locally via `npm run test:e2e`; CI now gates on lint + build + Vitest
  + HTTP audit (all green). E2E stabilisation is tracked separately.

## [2.3.9] — 2026-05-17

Patch release. Kokoro is the default everywhere on a clean install.

### Changed

- **`audit-voices.sh` now defaults to `kokoro`**, matching the
  clean-install `tts_provider` the server already seeds
  (`server.js` → `setSettingIfEmpty('tts_provider','kokoro')`, idempotent;
  `platform_settings.setting_key` is UNIQUE so it holds). Auditing
  piper/google/openai is now explicit opt-in via
  `ROHY_AUDIT_TTS_PROVIDERS` for operators who configured them, rather
  than a CI-only env override. A base install (CI or fresh deploy)
  audits the engine it actually runs — kokoro — with no special-casing.

## [2.3.8] — 2026-05-17

Patch release. Last pre-existing CI audit failure.

### Fixed

- **`audit-voices.sh` failed in CI** because it asserted HTTP 200 from
  `/api/tts` for piper (no binary/voices) and google/openai (no API
  keys) — providers CI doesn't provision. kokoro (in-process) already
  passed. The provider list is now `ROHY_AUDIT_TTS_PROVIDERS`-overridable
  (default = full set locally); the CI audit step sets it to `kokoro`.
  Not a regression — asserting an unconfigured provider works was wrong.

## [2.3.7] — 2026-05-17

Patch release. Pre-existing CI failures (red on main before this branch).

### Fixed

- **`JWT_SECRET` killed in-process server tests.** `server/middleware/
  auth.js` `process.exit(1)`s at import if `JWT_SECRET` is unset; CI has
  no `server/.env`, so any test importing an auth-touching module
  in-process (e.g. `help-routes.test.js`) silently killed the vitest
  worker. Added `tests/server-setup.js` (server project `setupFiles`)
  that sets a test `JWT_SECRET` (and default `NODE_ENV`) before imports.
  Fixes the Vitest and Docs `help-system` jobs; also fixes local runs
  without a `server/.env`.
- **Audit job same root cause.** `scripts/audit-retention.sh` spawns
  `retention-sweep.js`, which imports `auth.js`; the "Run audit scripts"
  CI step didn't pass `JWT_SECRET` (per-step env). Added it.
- **`DiscussionScreen` loading placeholder.** The discussant-name slot
  rendered nothing while loading; restored the `…` placeholder so the
  header doesn't reflow and the loading state is observable
  (DiscussionScreen.test CONTRACT 1).

### Notes

- E2E remains red: a **pre-existing** brittle/flaky UI suite (many specs
  are maintainer-marked `SKIP … brittle`; failures span unrelated files;
  some pass on retry; rest are headless render timeouts). Untouched by
  the 16.5.2026 bug fixes; needs a dedicated stabilization effort.

## [2.3.6] — 2026-05-17

Patch release. Regenerated API reference (docs drift gate).

### Fixed

- **Generated reference was stale vs source.** The Bug 5/6 changes to
  `server/routes/orders-routes.js` (tenant_id on order rows, turnaround
  default) changed the orders API surface, so `docs:gen:api` output
  drifted from the committed `docs/reference/api/orders.md` +
  `openapi.json` (+ a config line). Regenerated and committed so the
  Docs workflow's drift gate passes.

## [2.3.5] — 2026-05-17

Patch release. The actual fix for red CI — npm-version lockfile skew.

### Fixed

- **`package-lock.json` was generated by npm 11 (local Node 25); CI,
  server and Docker run npm 10 (Node 22).** An npm-11 lock omits part of
  the React transitive closure (`react@18.3.1`, `react-dom@18.3.1`,
  `@types/react@18.3.28`, `scheduler@0.23.2`, `@types/prop-types`) that
  npm 10's `npm ci` recomputes and requires, so every clean `npm ci` on
  Node 22 failed with `EUSAGE … Missing: …`. 2.3.4's regen didn't help
  (still npm 11). The lockfile is now regenerated with **npm 10.9.3**
  (the project's target toolchain — CI matrix 22.x, server, Docker);
  `npm@10 ci --dry-run` exits 0. Always regenerate the lock with Node 22 /
  npm 10, not a newer npm.

## [2.3.4] — 2026-05-17

Patch release. Fixes red CI / broken clean installs (root cause of the
2.3.1–2.3.3 deploy pain).

### Fixed

- **`package-lock.json` was structurally out of sync with
  `package.json`** since the docs/teacher-cohorts stages. Any `npm ci`
  on a clean checkout (GitHub Actions, fresh server, Docker) failed with
  `EUSAGE … Missing: react@18.3.1, @types/react@18.3.28, scheduler@0.23.2
  …`. Earlier `npm install --package-lock-only` regens were run from a
  machine whose `node_modules` already satisfied the tree, so npm saw
  "up to date" and never wrote the missing closure. The lockfile has now
  been regenerated from a **pristine** state (no `node_modules`, no
  prior lock); `npm ci` validates clean (`--dry-run` exit 0). This is the
  actual fix — `npm install` fallbacks in deploy paths (2.3.1–2.3.3) were
  papering over this; they remain as defence-in-depth.

## [2.3.3] — 2026-05-17

Patch release. Operator update path made consistent with install paths.

### Fixed

- **`bin/rohy-update` used `npm ci`** while every fresh-install path
  (`deploy/docker/Dockerfile`, `deploy/bootstrap.sh`,
  `deploy/local-install.sh`) already uses `npm install`. Because rohy's
  `file:` siblings (`dynajs`, `oyon`) make `npm ci`'s strict lock check
  environment-fragile, the first `rohy-update` on an otherwise-healthy
  install would fail (and could trigger a needless rollback). All three
  `npm ci` invocations (update, rollback, hard-rollback) now use
  `npm install`; `--silent` dropped so a failure is visible, not hidden.

## [2.3.2] — 2026-05-17

Patch release. Docs site reachable behind the prefix-stripping reverse proxy.

### Fixed

- **In-app Help article links 404'd in production.** The VitePress docs
  were mounted only at `/rohy/docs`, but the deploy reverse proxy strips
  the `/rohy/` prefix before forwarding (public `/rohy/docs/X` → backend
  `/docs/X`). The docs dist is now served at **both** `/rohy/docs` (local
  dev / non-stripping proxies) and `/docs` (nginx-stripped production), so
  Help links resolve regardless of front-proxy prefix handling.

## [2.3.1] — 2026-05-17

Patch release. Release-packaging fixes so a clean deploy actually works.

### Fixed

- **`npm ci` failed on clean installs.** `package-lock.json` was out of
  sync with `package.json` (the docs/VitePress devDependency closure was
  never fully locked after stage-0). Regenerated the lockfile; `npm ci`
  now succeeds on a pristine machine (the production deploy path).
- **`build` no longer hard-fails without the docs toolchain.** A failed
  `docs:build` (e.g. missing `vitepress`) previously aborted the entire
  app build before the frontend was produced. It is now fail-soft: the
  app frontend builds regardless; the docs site is built when available.

## [2.3.0] — 2026-05-16

Minor release. Teacher cohorts, the enterprise documentation site with
in-app Help & Support, and a full triage pass over the 16.5.2026 bug
report.

### Added

- **Teacher cohorts.** Teacher-owned classes with join codes, roster and
  completion-grid views, cohort-scoped analytics (summary, timeline,
  hourly, stats, TNA sequences), per-cohort case assignment and
  co-teachers (migrations 0025–0027).
- **Documentation site.** VitePress site (trainee → educator → admin →
  operator → integrator → security) with local search, served at
  `/rohy/docs/`, plus an in-app **Help & Support** drawer (role-filtered
  articles, parsed release notes, redacted diagnostics bundle).

### Fixed

- **Investigations.** Default labs no longer hardcode a 30-minute
  turnaround; lab/radiology order rows now persist `tenant_id` so
  non-default-tenant sessions actually receive results; the worklist no
  longer mislabels pending tests "Ready" (UTC parsing).
- **Educational integrity.** The authoring case title (which names the
  diagnosis) is no longer shown to students; only educators+ see it.
- **Physical exam.** Posterior body-map regions (upper/lower back,
  buttocks) resolve again; special-test chips are clickable.
- **Debrief.** The discussant conversation no longer bleeds into the
  patient chat; clinical alarms stop sounding after End & Debrief.
- **Misc.** Body Map Editor opens for admins in production; the duplicate
  "Default Patient" chat tab is gone; the avatar FOV control affects the
  preview; Help/diagnostics requests use the correct API path and the
  docs site is served + linked correctly.
- **Cohort analytics.** Out-of-order or failed scoped reloads no longer
  render the previous scope's stats.

## [2.1.0] — 2026-05-14

Minor release. Per-persona LLM routing and a global version badge.

### Added

- **Per-persona LLM routing.** Patient, discussant, and every agent
  (nurse, consultant, family, etc.) now route through the LLM
  configured on their `agent_template` row (`llm_provider`,
  `llm_model`, `llm_api_key`, `llm_endpoint`, `llm_temperature`,
  `llm_max_tokens`). Resolution is two-tier: template → platform
  default. No per-case, per-session, or per-user overlay — the voice
  5-tier resolver taught us what that costs.
  - `LLMService.streamMessage` accepts a new `agentTemplateId` option;
    when set, the body carries `agent_llm_config: { agent_template_id }`.
  - Patient chat (`ChatInterface.handleSendToPatient`) and discussant
    (`useDiscussionEngine.sendMessage`) now both forward their
    `patientTemplate.templateId` / `discussant.templateId`.
  - `AgentService.sendAgentMessage` consolidated to send the same
    minimal `{agent_template_id}` payload instead of the previous
    bigger payload that included the client-redacted `llm_api_key`
    (which would have triggered the server's "trust client config"
    branch and called the LLM with the literal string `'[redacted]'`).
- **Global version badge.** A small centred "Rohy <major>.<minor>"
  pill sits at the top of every screen — login, chat, exam,
  investigations, debrief, settings, persona editor. Reads the
  version from `package.json` so `npm version` is the only place a
  release number lives. Mounted once at the entry point
  (`src/main.jsx`) alongside `<App />`.

### Changed

- **`AgentService.sendAgentMessage` payload.** No longer forwards
  `provider`, `model`, `api_key`, or `endpoint` from the client.
  Sends `{agent_template_id}` only; server reads the rest from the
  database. Same shape as the patient and discussant paths now use.

## [2.0.0] — 2026-05-14

Second major release. Three feature platforms land at once — voice, on-device
emotion capture, and multi-room navigation — alongside the multi-agent care
team, real physiologic monitor, the case-debrief surface, and a multi-stage
enterprise hardening pass.

### Added

- **Voice & avatars.** Four TTS providers behind `/api/tts`: Google,
  OpenAI, Kokoro (in-process ONNX), Piper (subprocess; voices
  auto-discovered from `server/data/piper/voices/`). 28 GLB avatar heads
  with 17 morph targets in canonical Oculus order, viseme-driven lipsync
  via `wawa-lipsync`. 5-tier voice precedence (platform → case → agent →
  session → user) implemented in `src/utils/voiceResolver.js`. Per-case
  voice overrides, Patient persona default voice.
- **Multi-agent care team.** Per-case agent rosters covering patient,
  nurse, consultant, family member, and case-debrief tutor. Page/Call
  flow with 1–3 min server-anchored arrival ETAs that survive page
  reloads. End & Debrief flow with a Socratic discussant that opens the
  retrospective.
- **Multi-room navigation.** Five peer rooms (Patient, Physical
  Examination, Laboratory, Radiology, Consultant) consolidated into a
  single `currentRoom` source of truth in `src/App.jsx`. RoomNavigator
  with badge dots for unviewed activity. Every `learning_events` row
  now carries the active room (migration 0021).
- **Emotion capture (Oyon).** Vendored sub-library mounted at
  `/api/addons/oyon/*`. Browser-side inference via MediaPipe + ONNX Web;
  only aggregated 10-second windows leave the device. Three production
  models, single canonical emotion-label list, frozen-at-write
  visibility flags for analytics.
- **Investigations.** 225 labs across 33 groups, 74 radiology studies,
  67 exam regions, gender-specific reference ranges. Pill-stack viewer
  for cumulative report viewing, 1–5 minute turnarounds.
- **Patient monitor.** Physiologic ECG generator, 7 vitals, 5 rhythms,
  9 modifiers, treatment effects engine with 33 default treatments and a
  Stage-5 override guard that preserves manually-pinned vitals across
  engine ticks.
- **xAPI-style event log.** 130+ canonical verbs through
  `src/services/eventLogger.js`. Room-stamped, vitals-enriched session
  activity feed.
- **Case snapshot binding.** Session start freezes `cases.config` + 
  `cases.scenario` into `sessions.case_snapshot` so admin edits during
  a live session don't bleed into the running monitor.
- **Landing site.** Static one-page scientific site at `landing/` —
  hostable anywhere, no build step.
- **Operator update CLI.** `bin/rohy-update` reads
  `migrations/MANIFEST.md` to decide whether a migration is additive
  (auto-apply) or destructive (refuse without `--allow-destructive`).

### Changed

- **Enterprise prompt stability across case switches** (this release):
  cross-case LLM role bleed eliminated via three defence-in-depth
  layers. New `src/utils/roleAnchor.js` block leads every assembled
  system prompt (patient, discussant, every agent type). Case-id
  stamps on `patientTemplate` (`ChatInterface.jsx`) and the resolved
  discussant (`discussionService.js`) detect cross-case state mismatch.
  `useDiscussionEngine.sendMessage` and `buildPatientSystemPrompt` both
  refuse-or-drop on mismatched stamps. Opening sentinel for the
  discussant changed from `"Hello."` to `"[System: open the case
  debrief now.]"` — small voice-mode models no longer mirror back as
  the learner.
- **Notification dispatch consolidated.** All toast/banner/alarm
  producers now route through `src/notifications/`; the four parallel
  systems are retired.
- **Tenant scoping enforced via middleware** rather than ad-hoc
  `WHERE tenant_id =` in each handler. Role checks use rank comparison
  (`requireRole(RANKS.educator)`) rather than string equality.
- **TTS gender-based voice substitution removed.** The server plays the
  voice the client asks for; admins pick gender-appropriate voices in
  Settings → Voice or the case editor.

### Fixed

- **Cross-case prompt assembly** (`patientTemplate` retaining the prior
  case's value during the case-switch async window).
- **Discussant lazy-init hydration race** — replaced with an effect on
  `[sessionId]` plus a `hydrated` gate that prevents the initial empty
  render from clobbering the new session's localStorage history.
- **Stale TTS engine routing** — `engine` is now forwarded from
  `voiceResolver` to `/api/tts` so a Piper-configured case actually
  plays Piper instead of silently falling back to the platform default.
- **Kokoro voice case mismatch** — `kokoro-js` emits Title-Case gender;
  the rest of rohy expects lowercase. Now normalised in
  `listKokoroVoices` so every voice surfaces instead of collapsing to
  two defaults.
- **Lab database missing in deployed image** — `Lab_database.json` +
  `heart.txt` now copied into the runtime stage of the Docker image.
- **Snapshot binding** — admin edits to a case mid-session no longer
  bleed into the running monitor (regression-locked at unit + e2e).

### Security

- **May-2026 audit cycle.** Ownership + tenant gates added on
  agent/orders/labs/radiology/treatment session-scoped routes. Oyon
  row-level visibility enforced via role-keyed columns instead of
  blanket `(admin_can_view OR educator_can_view)`. Migration 0022
  reclassified additive → destructive in MANIFEST.md. Response
  redaction centralised in `server/redaction.js`.
- **Tests for silent-failure paths.** `silent:true` interactions path,
  rate-limit branches, and rejected cross-provider voice IDs now have
  unit coverage.

### Removed

- Stale tests locking retired behaviour: OrdersDrawer "Ordered Tests"
  panel, InvestigationsScreen two-step pill flow, TTS `body.provider`
  override on the main `/api/tts` route (preview path still honours it,
  gated by `requireAdmin`).

## [1.0.0] — 2026-04 (previous release)

Initial public release. Virtual-patient text chat with case-bound system
prompts, basic monitor, single-room layout, session persistence, admin
case editor, multi-tenant auth.

[2.1.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.1.0
[2.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.0.0
[1.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v1.0.0
[2.8.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.8.0
[2.5.6]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.6
[2.5.5]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.5
[2.5.4]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.4
