# website/

Static public website for Rohy. Five pages are hand-written and need no build
step. `help.html` and everything under `docs/` are generated. No dependencies
beyond a Google Fonts `<link>` for Inter, plus `marked` (already in the
repository root `node_modules`) for the two generators.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Overview: hero, CRETIC context, the rooms at a glance, care team, physiology, analytics, Oyon, authoring, governance, install, author. |
| `rooms.html` | Every room in depth with a screenshot each. Five core rooms (Patient, Examination, Laboratory, Radiology, Consultant) and four plugin rooms (Bedside, 12-lead ECG, Pathology, PACS), in navigator order, plus navigation between rooms. The room list follows `RoomNavigator.jsx` and the plugin manifests, as the root README does. |
| `whats-new.html` | What changed from v1.0.0 to the current 3.0 beta, with a release arc. |
| `help.html` | **Generated.** The repository `README.md` rendered into the site shell: status, requirements, install, the rooms, features, screenshots, architecture, configuration, testing, documentation, development, roles, author, licence. This is the *public site's* help page. The application has its own **Help & Support** drawer (`src/help/`, 18 role-gated articles linking into the VitePress docs at `/rohy/docs/`); the two are separate surfaces and neither generates the other. |
| `about.html` | The author: photo, background, research context, licence, and profile links (saqr.me, UEF, Scholar, ORCID, ResearchGate, Scopus, Semantic Scholar, GitHub, LinkedIn, X). |
| `docs/**/*.html` | **Generated.** Every Markdown document in the repository rendered into the site shell: the 130 files under `docs/`, plus `CHANGELOG.md` as `docs/changelog.html` and `LICENSE` as `docs/license.html`. The output mirrors the source layout, so `docs/trainee/rooms.md` becomes `docs/trainee/rooms.html`. |

Shared files:

| File | Purpose |
|---|---|
| `site.css` | The one stylesheet. Header, footer, hero, pillar rows, cards, timeline, install grid, lightbox, and the `.md-body` rules the Help page uses. |
| `site.js` | Smooth in-page scrolling, reveal-on-scroll, screenshot lightbox. |
| `build-docs.mjs` | Generates `docs/**` from `../docs/**`, `../CHANGELOG.md` and `../LICENSE`. Exports the page shell, the Markdown pipeline and the slug function. |
| `build-help.mjs` | Generates `help.html` from `../README.md`, through the shell that `build-docs.mjs` exports. |

Every page carries the same header navigation (Overview · Rooms · What's new ·
Docs · Help · Install · About the author · GitHub) and the same footer (Pages ·
Project · Docs), so each page reaches every other page. In-page anchors live in
a labelled "On this page" row under each hero. The header holds page links
only.

The header and footer for `help.html` and for every page under `docs/` come
from one `shell()` function in `build-docs.mjs`. Editing the chrome on the
hand-written pages means editing that function in the same change, so the two
copies agree.

## Regenerate the generated pages

`help.html` and everything under `docs/` are generated. Edit the Markdown, then
run this from the repository root:

```bash
npm run website:build
```

That runs the two generators in order:

```bash
node website/build-docs.mjs     # docs/**, from ../docs, ../CHANGELOG.md, ../LICENSE
node website/build-help.mjs     # help.html, from ../README.md
```

Order matters. `build-docs.mjs` writes the pages that a README link into
`docs/` resolves to, and `build-help.mjs` points at a rendered page when the
file is there and at GitHub when it is absent.

`website/docs/**` is generated output. Edit the Markdown under `docs/` in the
repository root and re-run the build; a hand edit inside `website/docs/` is
overwritten on the next run. The same holds for `help.html`.

### What `build-docs.mjs` does

| Step | Behaviour |
|---|---|
| Layout | Mirrors the source tree. `docs/trainee/rooms.md` becomes `website/docs/trainee/rooms.html`. A directory with no `index.md` gets a generated index listing its pages. |
| Relative paths | `site.css`, `site.js`, `assets/` and every site page are addressed relative to the output file's depth, so the tree works from `file://`, from GitHub Pages, and from any sub-path. |
| Links | A VitePress clean URL (`/trainee/rooms`) and a `.md` link both resolve to the rendered page. A path outside the rendered set becomes a GitHub blob or tree link. Absolute URLs and `mailto:` are left alone. The build fails and lists any rewritten target that has no file. |
| Frontmatter | Stripped. `title` becomes the page title when it is present, otherwise the first H1 does. |
| Containers | `::: tip`, `::: info`, `::: warning` and `::: danger` become `<aside class="callout callout-KIND">`; `::: details` becomes a `<details>` block. |
| Raw tokens | A `<token>` in prose that names no HTML element is escaped so the browser prints it. The build log names the tokens per file. |
| Sidebar | Read from `themeConfig.sidebar` in `../docs/.vitepress/config.mjs`. Rendered pages absent from that tree land in an "Other documents" group. `docs/index.html` shows the same tree as cards. |
| Headings | H2, H3 and H4 carry slug ids from the same function the "On this page" row uses. A heading whose GitHub slug differs from its VitePress slug also carries the GitHub spelling as an alias anchor, so both spellings of a cross-page link land. |
| Tables | Wrapped in an `overflow-x: auto` container, so a wide table scrolls inside itself and the page does not. |
| Determinism | File lists are sorted and nothing carries a timestamp, so two runs over an unchanged source tree produce byte-identical files. | `build-help.mjs` is
deterministic, so an unchanged README produces a byte-identical file. It
converts the README with `marked`, rewrites `docs/images/screens/<name>.jpg`
image sources to `assets/<name>.jpg`, rewrites repository-relative links to
`https://github.com/mohsaqr/rohySimulator/blob/main/<path>`, strips the
`website/` prefix from links to sibling pages, leaves absolute URLs alone,
gives every H2 a slug id, builds the "On this page" pill row from those
headings, and wraps each table in an `overflow-x: auto` container. A README
image with no matching file in `assets/` stops the build.

## Writing style

Copy is declarative and states facts. Headlines name what a thing is. Avoid
contrastive framings of the form "X, not Y" and hedges such as "never" or
"rather than"; say what the platform does. The audit used while writing:

```bash
python3 - <<'EOF'
import re, html
for p in ["index.html", "rooms.html", "whats-new.html", "about.html"]:
    s = re.sub(r'<(style|script).*?</\1>', '', open(p).read(), flags=re.S)
    s = re.sub(r'alt="[^"]*"', '', s)
    t = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s)))
    for m in re.finditer(r"(,\s*not\b|\bnever\b|\brather than\b|\binstead of\b|n't\b|\bnot\b)", t, re.I):
        print(p, "…", t[max(0, m.start()-60):m.end()+40])
EOF
```

The full scan, with the whole banned list and the `<title>` text included, runs
from the repository root over any set of pages:

```bash
node tmp/verify-docs-style.mjs website/*.html
```

It reports 0 for the five pages of the site itself. Pages under `website/docs/`
carry the wording of the Markdown they are generated from, so a hit there is
fixed in the Markdown.

## View it

```bash
open website/index.html      # macOS
xdg-open website/index.html  # Linux
```

Or serve it locally:

```bash
python3 -m http.server -d website 8080
# then visit http://localhost:8080
```

## Deploy it

`website/` is hostable anywhere static:

- **GitHub Pages** — point Pages at this folder, or copy its contents to a
  `gh-pages` branch root.
- **Netlify / Vercel** — drag the `website/` folder; no build command.
- **saqr.me** — `scp -r website/* saqr@host:/var/www/rohy-website/` (or
  whatever path the front-door nginx serves).

All paths are relative (`assets/<name>.jpg`, `site.css`, `site.js`), so the
folder is self-contained.

## Update screenshots

The screenshots are the same files as `docs/images/screens/` in the repository
root, copied here so the folder stays self-contained. `room-3d.jpg` is a
capture of the 3.0 bedside room.

If a UI surface changes:

1. Capture the new screenshot at ~2× display resolution.
2. Save with the same filename in `website/assets/` (and in
   `docs/images/screens/` so the README and the site agree).
3. Update the `alt=""` and `<figcaption>` on the matching `<img>` so the
   description stays accurate. The alt text describes what is visible,
   including the numbers on screen.

| File | Surface | Used on |
|---|---|---|
| `patient-room.jpg` | Patient room: avatar, chat, live monitor, latched alarm, room navigator | index hero, rooms |
| `room-3d.jpg` | 3D bedside room with the live monitor, camera wheel and caption | rooms |
| `physical-exam.jpg` | Body map, technique chooser, auscultation point picker, examination log | rooms |
| `laboratory.jpg` | Catalogue, hospital-style report, worklist with Ready and Viewed | rooms |
| `radiology-worklist.jpg` | Imaging catalogue, ready/pending/viewed counters, pending worklist | rooms |
| `radiology-pacs.jpg` | DICOM reading room: dual coronal MRI viewports, series rail, window/level | rooms |
| `ecg-workstation.jpg` | 12-lead ECG workstation with calipers, lead map, retained measurements | rooms |
| `pathology-slide.jpg` | Whole-slide H&E viewer with scale bar, ellipse area, display-only panel | rooms |
| `debrief.jpg` | Case debrief with the discussant listening in voice mode | rooms |
| `tna-clusters.jpg` | Transition network analysis: three clusters, networks, state distributions | index |
| `oyon-signals.jpg` | Live Oyon signals: emotions, gaze heat map, rPPG, head pose, posture | index |
| `affect-analytics.jpg` | Post-session affect: co-occurrence map, heat strip, affect plane, dynamics | index |
| `gaze-analytics.jpg` | Screen zones, gaze centroids, gaze maps by room | index |
| `admin-cases.jpg` | Manage Cases with English, German, Spanish and Italian cases in one course | index |
| `cretic-icon.png` | CRETIC project emblem | index |
| `author.jpg` | Portrait of the author, fetched from saqr.me (`/assets/img/prof_pic.jpg`) | index, about |
