# Vendored packages

Three of rohy's plugins are written in other repositories and **copied** into
this one:

| In rohy | Upstream | What it is |
|---|---|---|
| `src/components/pathology/` | `Pathoyon/pathoyon/src` | the pathology room and case editor |
| `server/plugins/pathology/` | `Pathoyon/pathoyon/server` | its server module — slide import |
| `src/components/pacs/` | `Radoyon/radoyon/src` | the DICOM reading room |

The normative contract is **RPS-1 §16** in
[`docs/design/plugin-standard.md`](../design/plugin-standard.md). This page is
how to work with it day to day.

## Why copies, not `file:` dependencies

rohy ships a **Docker image** and an **air-gap source bundle**. A
`file:../Radoyon/radoyon` dependency resolves on a developer's laptop and
nowhere else — not in CI, not in the image, not in the offline tarball. Other
projects in this workspace use `file:` deps happily because they never ship
offline.

## The three rules

1. **Never edit a vendored folder.** Edit upstream, run that repo's tests, then
   re-vendor. A fix made in rohy vanishes at the next copy, and the gate below
   will fail before that even happens.
2. **`README.md` and `portability.test.js` inside those folders are rohy's.**
   They are excluded from the copy and survive re-vendoring.
3. **`.vendor.json` is generated.** Don't hand-edit it.

## Commands

```bash
npm run vendor                    # re-vendor every registered package
npm run vendor -- pacs            # just one
npm run vendor:check              # verify stamps; report staleness
npm run plugins:gen && npx vitest run && npm run build   # after any re-vendor
```

If your checkouts are not in `~/Documents/Github/`, point the tool at them:

```bash
ROHY_VENDOR_RADOYON=~/src/Radoyon/radoyon npm run vendor -- pacs
```

## What the stamp does and does not tell you

`.vendor.json` records the package, version, upstream commit and a hash of the
copied contents.

- **Integrity** — `tests/server/vendored-packages.test.js` recomputes that hash.
  A folder edited in place is a failing test, not a surprise later.
- **Provenance** — "which radoyon is this?" is a file, not archaeology.
- **Currency** — *not* proven by the stamp. A copy three commits behind hashes
  perfectly against its own stamp. Only `vendor:check`, on a machine that has the
  upstream checkout, can say "upstream has moved".

That last distinction is the reason this machinery exists. rohy's PACS copy once
sat frozen while both repos advanced, and nothing in rohy said so or could have:
`portability.test.js` checks imports, not currency, and the room's own tests
stay green against stale code.

## Two refusals you may hit

**"has no `index.js` — that is not the package."** The upstream path exists but
holds no source. This guard is not theoretical: a documented `rsync --delete`
once pointed at a directory that had become a stray build cache, and *emptied
the vendored folder*. rsync has no notion of "this source looks wrong" — an
empty source is a valid instruction to empty the destination.

**"has uncommitted changes upstream."** A stamp naming a commit that does not
contain the code is a lie. Commit upstream first. `--force` exists for a local
experiment and should not reach a commit.

## Adding a package

Add an entry to `VENDORED` in `scripts/vendor-plugins.mjs`, then
`npm run vendor -- <id>`. The gate picks it up automatically.

A package may ship its own installer — radoyon does, on the principle that a
package knows how to install itself. Declare it as `installer` and rohy
delegates to it, then verifies the stamp it wrote. One contract, one gate, more
than one permitted implementation.

## Not covered

`OyonR/` and `src/components/lessons/` are also copies of code from elsewhere
but are not RPS-1 plugins — `OyonR` is an add-on with its own routes, and
`lessons` was ported from LAILA and has since diverged. The same discipline
would suit both; adding them is two lines in the registry once someone decides
what their upstreams are.
