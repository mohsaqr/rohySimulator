# `src/components/pacs/` — vendored, do not edit

This folder is a **byte-identical copy** of `src/` from the upstream Radoyon
package at `~/Documents/Github/Radoyon/radoyon`. Only two files here are rohy's:
this `README.md` and `portability.test.js`.

Editing anything else means the next re-vendor silently discards your change.

## Changing something

```bash
cd ~/Documents/Github/Radoyon/radoyon
# edit, then:
npm test

rsync -rc --delete --exclude README.md --exclude portability.test.js \
  ~/Documents/Github/Radoyon/radoyon/src/ \
  ~/Documents/Github/rohySimulator/src/components/pacs/

diff -rq ~/Documents/Github/Radoyon/radoyon/src \
         ~/Documents/Github/rohySimulator/src/components/pacs
# only README.md and portability.test.js may differ
```

Then in rohy: `npm run plugins:gen && npx vitest run && npm run build`.

## Why it is a package and not a component

Nothing under this folder imports anything only rohy can satisfy. rohy's
services arrive as **props** — `loadSeries`, `eventLogger`, `t`, the persistence
callbacks — never via import. `portability.test.js` enforces that, and also
enforces that no DICOM or imaging library creeps in: the parser, the modality
LUT and the VOI transform are the package's own, which is what keeps it off a
WASM codec and out of rohy's bundle weight.

ESLint ignores this folder (see `eslint.config.js`) — lint is owned upstream,
the same posture as `OyonR/` and `src/components/pathology/`.

## The adapter

The host half lives in `src/plugins/pacs/`. It imports from here and adapts
rohy's context onto the package's own prop vocabulary. If plugging something in
required editing it, it would not be plug-and-play.
