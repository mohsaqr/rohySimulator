# `src/components/pacs/` — vendored, do not edit

This folder is a **byte-identical copy** of `src/` from the upstream Radoyon
package at `~/Documents/Github/Radoyon/radoyon`. Only two files here are rohy's:
this `README.md` and `portability.test.js`.

Editing anything else means the next re-vendor silently discards your change.

## Changing something

```
npm run vendor            # every vendored package
npm run vendor -- pacs            # just this one
npm run vendor:check      # verify the stamps, and report staleness
```

`.vendor.json` in this folder records which upstream commit this is and a hash
of its contents. `tests/server/vendored-packages.test.js` fails the build if the
copy is edited in place or the stamp is missing — see **RPS-1 §16**.

Radoyon also ships its own installer (`scripts/vendor.mjs`) on the principle
that a package knows how to install itself; `npm run vendor -- pacs` delegates
to it and then verifies the stamp it wrote. Either entry point produces the same
artefact.

Then in rohy: `npm run plugins:gen && npx vitest run && npm run build`.

## Why it is a package and not a component

Nothing under this folder imports anything only rohy can satisfy. rohy's
services arrive as **props** — `loadSeries`, `eventLogger`, `t`, the persistence
callbacks — never via import. `eventLogger` is `{ log: ctx.log }` (RPS-1 1.6);
the package wraps it in its own `createRadoyonLogger` and speaks
`log(verb, objectType, options)`. Radoyon 0.3 spoke the one-object form and
every PACS row was lost at ingest — `tests/client/plugins/pacs-room.test.jsx`
now pins the positional shape at the sink. `portability.test.js` enforces that, and also
enforces that no DICOM or imaging library creeps in: the parser, the modality
LUT and the VOI transform are the package's own, which is what keeps it off a
WASM codec and out of rohy's bundle weight.

ESLint ignores this folder (see `eslint.config.js`) — lint is owned upstream,
the same posture as `OyonR/` and `src/components/pathology/`.

## The adapter

The host half lives in `src/plugins/pacs/`. It imports from here and adapts
rohy's context onto the package's own prop vocabulary. If plugging something in
required editing it, it would not be plug-and-play.
