# Documentation style guide & docs-as-code contract

The rules every Rohy doc page and in-app help article follows. This is part
of the Stage 0 foundation; the QA stage (Stage 6) enforces it.

## Voice & audience

- Write to **one audience per page** — the audience of its IA section. Never
  mix trainee and admin instructions on the same page.
- Second person, present tense, imperative for steps ("Click **Order**",
  not "The user should click order").
- Lead with the task, not the feature. A page answers "how do I…", a
  reference entry answers "what is…".
- Every sentence should change what the reader knows or does next.

## Terminology

- The [Glossary](/reference/glossary) is the terminology lock. If a term is
  defined there, use it exactly; do not introduce synonyms.
- UI labels in **bold** as they appear on screen (the role is `educator`;
  the button says **Teacher**).
- Use the user-facing word in user guides ("class", "Teacher", "trainee")
  and the technical word in reference/integrator docs ("cohort",
  "educator", "student").

## Structure

- `#` H1 once per page, matching the sidebar title.
- `##`/`###` only in the on-this-page outline range.
- VitePress containers for callouts: `::: tip`, `::: warning`,
  `::: danger`. Use `::: danger` for anything that can lose data or harm a
  real workflow; use `::: warning` for the medical-education disclaimer.
- Code blocks are language-tagged and **runnable as written** — no
  pseudo-commands, no unexplained placeholders.

## Single-sourcing

- **Reference is generated, not authored.** Do not hand-write endpoint
  lists, schema tables, env vars or CLI flags — they come from source in
  Stage 2 and are regenerated. Edits to those belong in the generator.
- **Guides link into reference**, they do not restate it.
- In-app help (Stage 4) consumes the trainee/educator pages as its article
  source where feasible — keep those pages self-contained and link-light so
  they render cleanly in the Help drawer.

## Accuracy contract

- Every command, path, endpoint, role and config claim must be verified
  against source before it ships. Stage 6 re-verifies; Stage 7 CI fails the
  build on broken links and on a route change without a regenerated spec.
- Screenshots/media are reviewed by a human — the doc pipeline never
  self-certifies a visual.

## Cross-cutting product constraints (from `CLAUDE.md`)

These apply to the Stage 4 in-app help build, not just prose:

- No new toast/banner/alarm path — register through `src/notifications/`.
- The support/diagnostics bundle must pass through `server/redaction.js`.
- Keep the vitest coverage ratchet (raise, never lower); pass `--project`.
- ESM only; lint zero-error.

## File & nav conventions

- One page = one file under the audience section directory.
- Adding a page = add it to the sidebar in `docs/.vitepress/config.mjs`.
- Section landing page is `index.md` and gives the lay of the section.
- Do not commit VitePress build output (`.vitepress/cache|dist|.temp` are
  git-ignored). Do not commit session artifacts.
