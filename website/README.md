# website/

Static public website for Rohy. The pages are hand-written and need no build
step; `help.html` is the one generated page. No dependencies beyond a Google
Fonts `<link>` for Inter, plus `marked` (already in the repository root
`node_modules`) for the Help generator.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Overview: hero, CRETIC context, the rooms at a glance, care team, physiology, analytics, Oyon, authoring, governance, install, author. |
| `rooms.html` | Every room in depth with a screenshot each. Five core rooms (Patient, Examination, Laboratory, Radiology, Consultant) and four plugin rooms (3D Room, 12-lead ECG, Pathology, PACS), in navigator order, plus navigation between rooms. The room list follows `RoomNavigator.jsx` and the plugin manifests, as the root README does. |
| `whats-new.html` | What changed from v1.0.0 to the current 3.0 beta, with a release arc. |
| `help.html` | **Generated.** The repository `README.md` rendered into the site shell: status, requirements, install, the rooms, features, screenshots, architecture, configuration, testing, documentation, development, roles, author, licence. This is the *public site's* help page. The application has its own **Help & Support** drawer (`src/help/`, 18 role-gated articles linking into the VitePress docs at `/rohy/docs/`); the two are separate surfaces and neither generates the other. |
| `about.html` | The author: photo, background, research context, licence, and profile links (saqr.me, UEF, Scholar, ORCID, ResearchGate, Scopus, Semantic Scholar, GitHub, LinkedIn, X). |

Shared files:

| File | Purpose |
|---|---|
| `site.css` | The one stylesheet. Header, footer, hero, pillar rows, cards, timeline, install grid, lightbox, and the `.md-body` rules the Help page uses. |
| `site.js` | Smooth in-page scrolling, reveal-on-scroll, screenshot lightbox. |
| `build-help.mjs` | Generates `help.html` from `../README.md`. |

Every page carries the same header navigation (Overview · Rooms · What's new ·
Help · Install · About the author · GitHub) and the same footer (Pages · Project
· Docs), so each page reaches every other page. In-page anchors live in a
labelled "On this page" row under each hero, never in the header.

## Regenerate the Help page

`help.html` is generated. Edit `../README.md`, then run this from the repository
root:

```bash
node website/build-help.mjs
```

Do not edit `help.html` by hand: the next run overwrites it. The generator is
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
