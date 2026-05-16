# Media kit

Standards and checklists for the screenshots, diagrams and videos that
support this documentation.

::: danger Media is produced and reviewed by a human
The documentation pipeline never self-certifies a visual. It cannot view an
image and confirm it is correct, free of PII, or current. Every screenshot,
diagram and video on this site is captured, redacted and reviewed by a
person before it ships. This page tells that person exactly what to capture
and how.
:::

## Screenshot & diagram standards

| Aspect | Standard |
|---|---|
| **Resolution** | Capture at 1440×900 logical (2× retina if available). Crop to the relevant UI region; do not ship full-desktop screenshots. |
| **Theme** | Light theme, default zoom (100%). Use one theme consistently across a section. |
| **Browser** | Chrome or Edge, no extensions visible, no bookmarks bar, no dev tools. |
| **State** | Use seeded data only (the acute cases and default seed users). Never capture real student or patient data. |
| **PII redaction** | Before capture, sign in as a seeded account, not a real user. If any real name, email, username, join code or token is visible, blur or block it out **before** the file leaves the machine — never commit an unredacted original. |
| **Annotation** | If you must annotate, use a single accent colour and keep labels short. Prefer capturing the real UI state over drawing callouts. |
| **Format** | PNG for UI screenshots, SVG (or PNG export) for diagrams. |
| **Naming** | `docs/public/img/<section>-<topic>.png` — for example `docs/public/img/trainee-history.png`, `docs/public/img/educator-roster.png`. Lowercase, hyphenated, section prefix matches the IA section. |

::: warning Join codes and tokens are PII-equivalent
A join code lets anyone enrol in a class; a token grants access. Treat both
as secrets in any capture — rotate the code after capturing, or redact it.
:::

## Scripted capture list

A checklist a human runs. Capture each item using seeded data only, then
redact and review before committing.

### Trainee

- [ ] `trainee-signin` — the Sign In screen (no credentials typed).
- [ ] `trainee-case-picker` — Settings → Cases list.
- [ ] `trainee-patient-room` — Patient room with the chat panel and monitor,
      one exchange visible.
- [ ] `trainee-history` — a short history exchange in the chat transcript.
- [ ] `trainee-laboratory` — Laboratory room: catalogue, viewer, worklist
      with one pending and one ready order.
- [ ] `trainee-result` — an opened lab report in the viewer.
- [ ] `trainee-treatments` — the Treatments drawer with the order form.
- [ ] `trainee-warning` — a contraindication / high-alert warning on order.
- [ ] `trainee-vitals` — the monitor responding after an administered
      treatment.
- [ ] `trainee-end-debrief` — the End & Debrief confirmation dialog.
- [ ] `trainee-consultant` — the Consultant room with Start debrief visible.

### Educator

- [ ] `educator-classes` — Settings → Classes list.
- [ ] `educator-create-class` — the create form with details expanded.
- [ ] `educator-join-code` — the Manage tab Join code controls (code
      **redacted**).
- [ ] `educator-assign-cases` — the Add cases library picker.
- [ ] `educator-roster` — the Reports tab Roster (student names
      **redacted**).
- [ ] `educator-grid` — the Completion grid.
- [ ] `educator-analytics` — the Analytics view KPI band and a chart.
- [ ] `educator-live-feed` — the Live feed.

### Operator

- [ ] `operator-dev-running` — terminal showing `npm run dev` with the two
      local URLs.
- [ ] `operator-migrate-dryrun` — terminal output of
      `node scripts/migrate.js --dry-run`.
- [ ] `operator-seed-acute` — terminal output of
      `node server/scripts/seed-acute-cases.cjs`.

## Video outlines

Short, scene-by-scene scripts. Keep each video under ~2 minutes. Open with
the training-only disclaimer on screen. Use seeded data; redact nothing
real because nothing real should appear.

### Trainee intro (≈ 90 s)

1. **Title (0:00–0:05)** — "Rohy: running your first case." On-screen:
   *Training only — the patient is simulated.*
2. **Sign in (0:05–0:15)** — sign in with a seeded student account.
3. **Pick a case (0:15–0:25)** — open Settings → Cases, open a case.
4. **First message (0:25–0:40)** — type the first question; note "your
   first message starts the session."
5. **Order & treat (0:40–1:05)** — order one lab, read it, give one
   treatment, show the monitor respond.
6. **End & debrief (1:05–1:25)** — End & Debrief, confirm, land in the
   Consultant room.
7. **Close (1:25–1:30)** — point viewers to the
   [trainee quickstart](/tutorials/trainee-quickstart).

### Educator intro (≈ 90 s)

1. **Title (0:00–0:05)** — "Rohy: set up a class." On-screen:
   *Training only.*
2. **Create a class (0:05–0:25)** — Settings → Classes, name it, Create.
3. **Join code (0:25–0:40)** — generate the code, show Copy; note that it
   is redacted in the published cut.
4. **Assign a case (0:40–1:00)** — Settings tab → Add cases → Assign.
5. **Read the roster (1:00–1:20)** — Reports tab → Roster, drill into a
   student (names redacted).
6. **Close (1:20–1:30)** — point viewers to the
   [educator quickstart](/tutorials/educator-quickstart).

## Where files live

Commit reviewed, redacted media to `docs/public/img/` using the naming
convention above. Reference it in pages as `/img/<section>-<topic>.png`
(VitePress serves `docs/public/` at the site root). Do not commit
unredacted originals anywhere in the repo.
