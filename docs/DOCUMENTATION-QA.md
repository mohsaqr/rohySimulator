# Documentation QA — Stage 6

Build-excluded report (`srcExclude` in `docs/.vitepress/config.mjs`). Not part
of the published site. Records the four Stage-6 QA jobs and their outcomes.

Date: 2026-05-16
Final state: docs site builds clean with `ignoreDeadLinks: true`; all
`src/help/` tests passing (19/19).

---

## Q1 — Generator drift

**Generators are deterministic. The drift seen against the committed tree is a
real, expected content change — NOT a generator non-determinism bug, and NOT
something to be masked.**

Procedure:

1. Ran all four generators:
   `docs:gen:api`, `docs:gen:data`, `docs:gen:config`, `docs:gen:cli`.
2. Ran them a **second** time and byte-compared the two output trees:
   `diff -rq` reported **identical** output. The generators are deterministic.
3. `git status --porcelain docs/reference` was **not** empty:

   | File | Change |
   |---|---|
   | `docs/reference/api/help.md` | **new** — generated `help` API page |
   | `docs/reference/api/index.md` | routers 18→19, endpoints 275→277, `help` row added |
   | `docs/reference/api/openapi.json` | +70 lines: 2 new `/api/help/*` operations |
   | `docs/reference/config/index.md` | `NODE_ENV` default now `development`; `TLS_*`/`OYON_ENABLED` source lists include `help-routes.js`; `routes.js` line shift 32→33 |

Root cause: the committed reference docs predate commit `6109c82`
("docs(stage-4): in-app Help & Support system"), which added the tracked file
`server/routes/help-routes.js` (2 endpoints) and additional env-var reference
sites. The generators correctly reflect current source. This is **stale
committed output**, not a generator defect.

Verification of determinism: two consecutive full regenerations produced
byte-identical trees (`diff -rq` clean). No randomness, timestamps, or
unordered-map iteration in output (sorts use `localeCompare`).

Action taken: none committed (parent owns commits, per Stage-6 rules). The
generator change below (Q2) is a link-correctness fix, not a drift mask, and is
itself deterministic.

---

## Q2 — Dead-link sweep

Set `ignoreDeadLinks: false`, ran `DOCS_BASE=/ npm run docs:build`.

**Dead links found: 1. Fixed at source: 1.**

| # | File | Dead link | Cause | Fix |
|---|---|---|---|---|
| 1 | `docs/reference/data/index.md` | `./../../../migrations/MANIFEST` (`[...](../../../migrations/MANIFEST.md)`) | Markdown link pointing to a repo file **outside** the VitePress root; VitePress resolves it as a missing page | Source is the generator `scripts/docs-gen/gen-data.mjs:382`. Changed the markdown link to inline code `` `migrations/MANIFEST.md` `` — consistent with every other repo-file reference in the generated docs (all use backticks, never links). Regenerated `docs/reference/data/`. |

This is a link-target correction at the true source (the generator), exactly as
Q2 requires — **not** a per-link `ignoreDeadLinks` silencing, and **not** a
drift mask (the generator output is still deterministic; only the one broken
link representation changed).

VitePress collects all dead links in a single render pass and fails at
`renderStart` with the complete list; the first build reported exactly this one
link. After the fix, `DOCS_BASE=/ npm run docs:build` with
`ignoreDeadLinks: false` **passes with zero dead-link/anchor warnings**.

`ignoreDeadLinks` was then reverted to `true` (Stage 7 owns flipping it on in
CI). The explanatory comment above it was left intact.

---

## Q3 — Accessibility (WCAG 2.2 AA basics)

Audited `src/help/HelpCenter.jsx` and `src/help/OnboardingTour.jsx`.

### HelpCenter.jsx

| Check | Status |
|---|---|
| Dialog semantics: `role="dialog"` + `aria-modal="true"` | PASS (already present) |
| Accessible name | PASS — `aria-label="Help and support"` |
| Close control is a real `<button>` with accessible name | PASS — `aria-label="Close help"` |
| Tabs: `role="tablist"` + `role="tab"` + `aria-selected` | PASS (already present) |
| Tab ↔ panel association (`aria-controls` / `role="tabpanel"` / `aria-labelledby`) | **FIXED** — added `id="help-tab-<id>"` + `aria-controls="help-tabpanel"` on each tab; added `role="tabpanel"`, `id="help-tabpanel"`, `aria-labelledby` on the content region |
| Keyboard dismiss (Escape) — WCAG 2.1.2 | **FIXED** — added `keydown` Escape → `onClose()` while open (was mouse-only via backdrop / close button) |
| Color-only signalling | PASS — active tab carries `aria-selected` (programmatic) plus a border, not color alone |
| Tabbable controls are real buttons | PASS — all `<button type="button">`; external links are real `<a>` with `rel="noopener noreferrer"` |
| Icons | Decorative lucide SVGs adjacent to text labels; the actionable controls have text or `aria-label`. Acceptable; not changed (surgical scope). |

### OnboardingTour.jsx

| Check | Status |
|---|---|
| Dialog semantics: `role="dialog"` + `aria-modal="true"` | PASS (already present) |
| Accessible name | PASS — `aria-label="Getting started"` |
| Skip / Next are real buttons | PASS |
| Keyboard dismiss (Escape) — WCAG 2.1.2 | **FIXED** — added `keydown` Escape → `skip()` (same action as the Skip button) while open. The "dismissible at any step" claim was previously click-only. |
| Color-only signalling | PASS — step text ("Step N of M") plus button labels; no color-only state |

### Fixes applied (surgical, no redesign)

- `src/help/HelpCenter.jsx`: Escape-to-close `useEffect`; tab/tabpanel ARIA
  association (`id`/`aria-controls`/`role="tabpanel"`/`aria-labelledby`).
- `src/help/OnboardingTour.jsx`: Escape-to-dismiss `useEffect` (delegates to
  the existing `skip` action).

### Test result

`npx vitest run src/help/ --project=client` → **4 files, 19 tests, all pass**
after the edits.

### Known residual (reported, not silently fixed — out of surgical scope)

- Neither dialog implements a focus **trap** or initial-focus move. WCAG 2.4.3
  (Focus Order) / 2.1.2 (No Keyboard Trap) are not violated (Escape now exits;
  focus can leave), but a stricter AA modal pattern would move focus into the
  dialog on open and contain Tab within it. Adding a focus-trap is a behavioural
  change beyond "minimal, surgical" and is flagged here for a dedicated task
  rather than bundled into Stage-6 QA.

---

## Q4 — i18n readiness

English-only at launch is acceptable; this is a readiness assessment, not a
translation deliverable.

### Docs site (VitePress)

- **Translation-ready in principle.** VitePress has first-class i18n via the
  `locales` config key (per-locale `lang`, `label`, `link`, theme strings).
- Currently single-locale: `docs/.vitepress/config.mjs` sets `lang: 'en-US'`
  with **no `locales` map**. Adding locales is additive and non-breaking.
- **Blockers for a future locale:**
  1. **`docs/reference/**` is machine-generated** from source code by
     `scripts/docs-gen/*.mjs`. These pages (API tables, env-var purposes, CLI
     help, schema docs) embed English prose strings hard-coded in the generator
     `.push(...)` calls. A localized reference section would require either (a)
     a translation layer over generator output, or (b) accepting that the
     reference section stays English while only hand-authored guides translate.
     Recommended: keep generated reference English-only; translate guides only.
  2. **Hand-authored guide content** is plain Markdown — fully translatable by
     duplicating into `docs/<locale>/` per the VitePress directory convention.
  3. **Source-derived English** (env-var "Purpose" text, route descriptions)
     lives in code comments / route definitions, not a string catalogue. Not a
     docs-site concern but means generated docs can never be auto-translated
     without translating the source annotations.

### In-app strings (Help components)

- **Not currently externalized.** No i18n library in `package.json`
  (`react-i18next`, `i18next`, `react-intl`, `lingui` — none present). UI copy
  in `HelpCenter.jsx` / `OnboardingTour.jsx` / `helpContent.js` is hard-coded
  English JSX literals.
- **Externalizable, but work is required.** Strings are short, static, and
  centralizable; `helpContent.js` already centralizes article titles/groups
  (a good seam). A future locale needs: an i18n provider, extraction of literal
  strings to a message catalogue, and locale-aware `docsUrl()` so in-app help
  links target the localized docs path.
- **Concrete blockers to a future app locale:**
  1. No i18n runtime or message catalogue exists — must be introduced.
  2. Hard-coded JSX string literals throughout (tab labels, headings,
     "Loading…", error fallbacks, notification titles/messages).
  3. `docsUrl(a.path)` builds links to the English docs tree; a locale switch
     must also switch the docs base path.
  4. Release-notes / diagnostics content comes from server APIs
     (`/api/help/release-notes`, `/api/help/diagnostics`) — server-side text
     (CHANGELOG parsing, section names) would also need localization or an
     explicit "untranslated technical content" policy.

### Summary

| Surface | Translation-ready today | Effort to add a locale |
|---|---|---|
| VitePress docs site (config) | Yes (config supports `locales`) | Low — additive config |
| Hand-authored guides | Yes (Markdown) | Medium — translate + mirror dirs |
| Generated reference docs | No (English baked into generators/source) | High — recommend keep English |
| In-app Help components | No (no i18n runtime, literal strings) | Medium — add i18n lib + extract |

No regressions introduced for the English launch. The above is a forward-looking
gap list, not a launch blocker.
