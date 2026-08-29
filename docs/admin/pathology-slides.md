# Pathology slides

Whole-slide images are large — a single scanned slide is gigabytes of pyramid
tiles — so Rohy never stores one inside the application. Slides live on a
**content origin**, and a case refers to one by name rather than by address.

There are two halves to a slide library, and they are independent. Either can
exist without the other.

| Half | Where it comes from | Who changes it |
|---|---|---|
| **Bundled** | a content bundle deployed to the origin (`./deploy.sh pathoyoncontent`) | whoever deploys content |
| **Managed** | imported from a link, downloaded and tiled by Rohy itself | an educator, from the case editor |

This page covers the managed half.

## What an educator does

Settings → Cases → *a case* → Plugins → **Open editor** → **Add slide from the
slide library** → **Import from link**.

Paste a URL to a whole-slide image and press Import. The card then moves through:

```
QUEUED         the request is accepted and waiting
DOWNLOADING    the file is being fetched, digest recorded
PROBING        its optics and pyramid levels are read
TILING         Deep Zoom tiles are generated
READY          it appears in the library like any bundled slide
```

Two endings are not `READY`:

- **NEEDS CALIBRATION** — the file carried no scanner optics. Rohy will not
  guess them: every measurement a reader makes is scaled by the magnification
  and the micrometres per pixel, so a plausible-looking default would make every
  measurement wrong by an unknown factor. The card offers **Add calibration**;
  type the two numbers once and the slide becomes `READY`.
- **FAILED** — the reason is shown on the card. **Remove** deletes the slide and
  everything derived from it.

An uncalibrated or failed slide is **not offered** when adding a slide to a
case. It is visible in the library so its state can be seen and acted on, but a
case cannot be built around a slide whose scale is unknown.

## What an admin configures

Settings → **Plugins** → Pathology. Nothing imports until two things are true:
imports are **enabled**, and at least one **host** is allowed. A fresh install
has neither, and that is the correct state of a server nobody has told where
slides may come from.

### Import policy

| Setting | Default | What it means |
|---|---|---|
| Allow importing slides from a link | **off** | the master switch; off hides the import field entirely |
| Hosts slides may be imported from | **none** | Rohy fetches from these and nowhere else |
| Largest slide that may be imported | 4 GiB | enforced while downloading, not just on the declared size |
| Accepted slide formats | svs, ndpi, tiff, tif, dzi, zip | an *allow* set; what a file actually is comes from reading it |
| Require scanner optics | **on** | off lets an uncalibrated slide go straight to `READY` |
| Keep the original file | **on** | keeps the source so a slide can be re-tiled later |

**You can only narrow, never widen.** The hosts you may choose from are set by
whoever runs the server (`ROHY_PLUGIN_IMPORT_ORIGINS`). Adding a host outside
that list is refused, naming the host. This is deliberate: choosing what the
*server* will download from is a decision about the machine's network position,
not about one tenant's teaching.

### Conversion

| Setting | Default | Notes |
|---|---|---|
| Magnification to tile at | 10× | never upsamples — a 10× target on a 20× slide uses 20× |
| Tile size | 512 | fewer, larger requests than the Deep Zoom default of 256 |
| Tile overlap | 1 | |
| JPEG quality | 85 | |
| How pixels are combined when shrinking | `mean` | `median` is for masks and erases single-cell detail on H&E |
| Preview longest edge | 1024 | the thumbnail on a library card |
| Give up on a conversion after | 120 min | |

Tiling reads a pyramid level the scanner already wrote, which is why it is fast:
a 2.1 GB slide converts in seconds. A file with **no pyramid** is declined up
front rather than attempted — decoding a full-resolution plane would exhaust the
server's memory, and a conversion killed part-way leaves tiles that look
complete.

### Imported slides

The table lists every imported slide, its state, its optics and any failure
reason, with **Remove**. Removing deletes the row and the files together.

## What an operator provisions

Three things, all outside the application:

1. **libvips** on the server — `apt install libvips-tools`. Without it an import
   fails with *"'vips' is not installed on this server"*.
2. **A library directory**, writable by the Rohy service user:
   `ROHY_PLUGIN_LIBRARY_DIRS="pathology=/srv/www/plugin-content/pathology/library"`.
   Unset means no imports, and the settings page says so rather than failing.
3. **An import allowlist**: `ROHY_PLUGIN_IMPORT_ORIGINS="pathology=https://slides.example.edu"`.
   A malformed value is fatal at boot — a typo must not degrade into "imports
   quietly stopped working".

Optionally `ROHY_PLUGIN_IMPORT_MAX_BYTES` caps every tenant's limit from above.

### The library shares the bundle's origin, and nothing else

`library/` sits beside `tiles/` and `gross/` on the content origin and is served
by the same nginx block. It belongs to **Rohy**, not to the content bundle:

- the content deploy's `rsync --delete` must **exclude `library/`**, or a
  content update erases every imported slide;
- `content-bundle.sh` refuses to build a bundle that contains `library/`.

### Checking it works

`GET /api/health/plugins` reports a `library` block per plugin — counts and
bytes only, no names or source hosts, so a deploy check needs no credentials:

```json
{ "library": { "assets": 12, "ready": 11, "needs_calibration": 1,
               "failed": 0, "bytes": 1642000000, "queued": 0, "running": 0 } }
```

A deployment with no library directory reports **no `library` block at all** —
"not configured" and "configured and empty" are different states.

## Limits

- **One conversion at a time.** Measured on the reference server, one conversion
  peaks around 370 MB; several at once is what turns a comfortable margin into
  an out-of-memory kill. Imports queue.
- **Restarting Rohy mid-import** re-runs that import from the beginning at the
  next boot rather than resuming it. A slide part-way through tiling cannot be
  told apart from a finished one, so it is redone rather than trusted.
- **Multi-file formats** (`.mrxs`, `.vms`) are not supported in this release.
  A single file, or a `.zip` containing one slide.
