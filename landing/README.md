# landing/

Single-file marketing site for rohy. Static HTML, no build step, no
dependencies beyond a Google Fonts `<link>` for Inter.

## View it

```bash
open landing/index.html      # macOS
xdg-open landing/index.html  # Linux
```

Or serve it locally if you want absolute paths to behave:

```bash
python3 -m http.server -d landing 8080
# then visit http://localhost:8080
```

## Deploy it

`landing/` is hostable anywhere static:

- **GitHub Pages** — point Pages at this folder, or copy its contents to a
  `gh-pages` branch root.
- **Netlify / Vercel** — drag the `landing/` folder; no build command.
- **saqr.me** — `scp -r landing/* saqr@host:/var/www/rohy-landing/` (or
  whatever path the front-door nginx serves).

All image paths inside `index.html` are relative (`assets/<name>.png`), so
the folder is self-contained — no rewrites needed.

## Update screenshots

If a UI surface changes:

1. Capture the new screenshot at ~2× display resolution (Retina full
   window, then crop in Preview / macOS screenshot tool).
2. Save with the same filename in `landing/assets/`.
3. Update the `alt=""` on the matching `<img>` in `index.html` so the
   description stays accurate.

Current screenshots and what each illustrates:

| File | Surface | Section |
|---|---|---|
| `hero-chat.png` | Voice mode chat with cinema subtitle overlay + full monitor + room navigator | Hero |
| `examination.png` | Physical Examination — body silhouette + technique chooser + clinical narrative | Physical Examination pillar |
| `investigations.png` | Laboratory catalogue + report modal + worklist with READY / VIEWED pills | Investigations pillar |
| `debrief.png` | Case Debrief landing screen with patient + discussant + Start debrief CTA | Case Debrief pillar |
| `oyon.png` | Oyon analytics — capture timeline + emotion distribution + transition network | Oyon pillar |
