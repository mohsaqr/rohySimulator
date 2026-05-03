# Standalone demo

`standalone.html` is a single-file vanilla-JS implementation of the kit's
talking-head pipeline. No React, no bundler, no build step — just an
HTML file with an importmap that pulls `three` and `wawa-lipsync` from
[esm.sh](https://esm.sh/).

It's intentionally **not** the production code path. It exists so you can
sanity-check the kit end-to-end before wiring the React components into
your real app.

## How to run

You need two things alive: a server with `/api/tts` (the kit's
`server/ttsRoute.js` is fine) and a static-file server that serves this
HTML plus the `glbs/` folder.

### Easiest setup — same origin, kit as canonical layout

If you've followed the kit's `INSTALL.md` and put the GLBs at
`public/avatars/heads/`, just serve this whole folder over HTTP. Vite's
dev server works:

```bash
# from the kit folder:
npx serve -p 5174 .         # any static server is fine; Vite/serve/http-server etc.
# in another terminal, run your /api/tts backend on :3000
```

Then open <http://localhost:5174/examples/standalone.html>, set the **API
base** field to `http://localhost:3000`, and the **Avatar GLB URL** to
`../glbs/avatarsdk.glb` (the default).

### Even easier — one server hosts both

If your `/api/tts` server also serves the kit's static files (e.g.
Express with `express.static('kits/talking-avatars')`), just open
`/examples/standalone.html` in the browser, leave the API base blank
(same origin), and click Speak.

## What it demonstrates

- A GLB load via `GLTFLoader` (the same loader `useGLTF` uses internally).
- The 15-viseme + blink morph-target driver — same critically-damped
  interpolation as `client/PatientAvatar.jsx`.
- The custom `application/x-rohy-pcm-stream` parser — same wire format
  as `client/voiceService.js`'s `readPcmFrames`.
- Web Audio scheduling onto a single timeline cursor (`nextStartTime`)
  for gapless multi-chunk playback.
- `wawa-lipsync` driven by the same `analyser` node the audio plays
  through — no MediaElement, no blob URLs.
- Procedural blink at 3.5–5.5 s intervals.

## What it leaves out (vs the React kit)

- No `VoiceContext` shared state.
- No `resolveAvatar` / `avatarFraming` priority chain — you pick the
  GLB by typing its URL into the input.
- No React lifecycle handling — `teardown()` does the cleanup the
  React effects do in the kit.
- No browser STT (`SpeechRecognition`) — speak-only.
- No retry / error-toast handling.

If everything works in this demo, the kit will work in your React app.
If something doesn't, the demo's `#log` panel will say what failed and
where.

## Caveats

- **First load downloads ~600 KB from esm.sh** (three.js + GLTFLoader +
  wawa-lipsync). After the browser caches them, reloads are instant.
  In an air-gapped environment, replace the import map URLs with
  bundled copies.
- **Kokoro's first call downloads ~330 MB on the server side.** If
  the server is fresh, the first Speak will hang ~30 s. Subsequent
  calls are instant.
- **The voice IDs in the dropdown are the kit's defaults.** If your
  Kokoro install has different voices, hit `/api/tts/voices?provider=kokoro`
  to see what's available, then either edit the HTML's `<option>` list
  or just type the voice ID into a real implementation.
