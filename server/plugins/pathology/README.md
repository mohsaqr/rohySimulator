# Pathology — the vendored server module (RPS-1 §11b)

**Upstream is `~/Documents/Github/Pathoyon/pathoyon/server`.** This folder is a
byte-identical copy plus two rohy-only files (this README and
`portability.test.js`). Do not edit here — edit upstream, run its tests
(`npm test` in `pathoyon/`, `node --test`), and re-vendor:

```
npm run vendor            # every vendored package
npm run vendor -- pathology-server  # just this half
npm run vendor:check      # verify the stamps, and report staleness
```

`.vendor.json` in this folder records which upstream commit this is and a hash
of its contents. `tests/server/vendored-packages.test.js` fails the build if the
copy is edited in place or the stamp is missing — see **RPS-1 §16**.

## What it is

The host mounts this at `/api/plugins/pathology/` and registers its job
handlers. It declares:

| Export | What the host does with it |
|---|---|
| `jobs.import_slide` | registered as `pathology:import_slide` on the host's single-worker queue |
| `routes(router, ctx)` | mounted between the host's own plugin routes and the content-proxy catch-all |

## The boundary

It imports **nothing** from rohy, and — unlike the client half — no peer
dependencies either. Every capability arrives as `ctx`:

- `ctx.download` instead of `fetch`/`node:http` — carries the operator's origin
  allowlist already resolved, caps bytes while streaming, digests, and refuses a
  destination outside `ctx.libraryDir`
- `ctx.runBinary` instead of `node:child_process` — allow-listed binary, argv
  only, never a shell
- `ctx.db`, `ctx.settings`, `ctx.guards`, `ctx.helpers`, `ctx.enqueue`

`portability.test.js` is what makes that a fact rather than an intention: it
fails on any import that is not a local file or a data-handling node builtin,
and it names the `ctx` member to use instead for the ones that are capabilities.

## Why the tiling is one stage

Measured 2026-08-29 (vips 8.18.6, 2.1 GB Hamamatsu NDPI, 40× → 10×):

| | wall | peak RSS | output |
|---|---|---|---|
| two-stage (`convert_10x.sh`: level → BigTIFF → dzsave) | 5.06 s | 299 MB | 137 MB tiles **+ 124 MB intermediate** |
| one-stage (`source[level=2]` → dzsave) | **4.44 s** | 373 MB | **137 MB tiles** |

Identical DZI descriptors, identical 3065 tiles. The intermediate archive exists
in `convert_10x.sh` because *archiving* is that script's purpose; it is not a
step tiling needs.
