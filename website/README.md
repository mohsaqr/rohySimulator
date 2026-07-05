# website/

Static public website for rohy. No build step. No dependencies beyond a Google
Fonts `<link>` for Inter.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page for the platform. |
| `whats-new.html` | Extensive "what's new since v1.0.0" product page. |

## View it

```bash
open website/index.html      # macOS
open website/whats-new.html  # macOS
xdg-open website/index.html  # Linux
```

Or serve it locally if you want absolute paths to behave:

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

All image paths inside `index.html` are relative (`assets/<name>.png`), so
the folder is self-contained — no rewrites needed.

## Update screenshots

If a UI surface changes:

1. Capture the new screenshot at ~2× display resolution (Retina full
   window, then crop in Preview / macOS screenshot tool).
2. Save with the same filename in `website/assets/`.
3. Update the `alt=""` on the matching `<img>` in `index.html` so the
   description stays accurate.

Current screenshots and what each illustrates:

| File | Surface | Section |
|---|---|---|
| `hero-chat.png` | Voice mode chat with cinema subtitle overlay + full monitor + room navigator | Hero |
| `examination.png` | Physical Examination — body silhouette + technique chooser + clinical narrative | Physical Examination pillar |
| `investigations.png` | Laboratory catalogue + report modal + worklist with READY / VIEWED pills | Investigations pillar |
| `debrief.png` | Case Debrief landing screen with patient + discussant + Start debrief CTA | Case Debrief pillar |
| `analytics-clusters.png` | Research-grade learning-analytics dashboard — sequence/event/state stats, three clusters with state distributions, transition networks, and temporal proportion plots | Analytics pillar |
| `oyon.png` | Real-time emotion-capture dashboard — capture timeline (valence + arousal), emotion distribution, transition network | Affect pillar |
| `cretic-icon.png` | CRETIC project emblem — red heart with inscribed ECG trace | CRETIC research-context band |
