# How imaging and slides reach a deployment

The pipeline from "someone found an open dataset" to "a learner in another
country opens the study". Follow it for every asset; the gates in it are the
reason the archive can be shipped at all.

## The rule the whole thing rests on

**Provenance is recorded at ingest, because that is the only moment the person
who knows is present.** Once the pixels are on disk, the terms are invisible: a
folder of DICOM and a tile pyramid look exactly the same whether they may ship
in a release or may not leave the building.

Every gate below is a consequence of that one sentence.

## 1. Find it, and check the licence yourself

The exact-match allow-lists are deliberate. A Creative Commons licence carrying
a NonCommercial or NoDerivatives clause is a different answer from CC BY, and
substring matching cannot tell them apart.

| verdict | meaning |
|---|---|
| `permitted` | CC0, public domain — ships outright |
| `attribution_only` | CC BY, CC BY-SA — ships **only with its notice** |
| `local_only` | usable on site, must not be redistributed |
| `unknown` | never bundled |

Things that look open and are not: a CC BY badge on a *record page* is not a
licence on the pixels; "open access" with a data-use agreement is not
redistributable; a per-user research agreement does not permit organisational
redistribution. All three were met while building the cardiac set.

## 2. Ingest it, with a named reviewer

Imaging, in `Radoyon/radoyon`:

```bash
node scripts/tcia-sources.mjs --collection … --reviewed-by "your name"
node scripts/commons-sources.mjs --files "File:…" --id abnormal/… --reviewed-by "your name"
node scripts/cap-sources.mjs --patient SCD… --id normal/… --reviewed-by "your name"
node scripts/fetch-archive.mjs --only <entry-id>
```

Slides, in `Pathoyon`:

```bash
node scripts/ingest-image-slide.mjs --manifest scripts/<set>.json --reviewed-by "your name"
```

Every one of these **refuses to write without a licence and a reviewer**.
`fetch-archive.mjs` refuses to download an unreviewed source at all.

Two honesty constraints the tools enforce, not preferences:

- **No fabricated calibration.** A transcoded loop gets no `PixelSpacing`; a
  published micrograph is ingested `measurable: false`, displayed with the
  ruler and counting frame withheld. A plausible value is still wrong data, and
  a wrong measurement carries the full authority of a number on a screen.
- **Burned-in identifiers are a human's job, and ingest now refuses without
  one.** Ingest de-identifies headers, but no header operation touches text
  rendered into the *pixels*. `burnedInAnnotationRisk()` flags the modalities
  that routinely carry it (US, XA, SC, OT, ES, NM), and an at-risk study
  **will not ingest** unless you pass
  `--pixels-reviewed "<who looked, when, what was masked>"`, which is recorded
  in the entry's `provenance.pixelsReviewed`.

  This used to be a warning printed at the end of a successful run. On
  2026-09-01 a review of the shipped starter bundle found four full patient
  names, two hospital names, a probable date of birth and four accession
  numbers burned into eleven ultrasound entries — every one of them correctly
  flagged at ingest, every flag cleared by nobody. A warning nothing blocks on
  is a warning that ships.

  **Reviewing means max-projecting every frame, not looking at the first
  one.** Burned-in text changes within a loop: in one stress echo the patient's
  name was in frame 0 and the acquisition date appeared only after frame ~350.
  Take the per-pixel maximum across all frames of a series, and any text that
  ever appears shows up in one image. Mask, then re-project the masked output
  to confirm nothing survives.

  The masks applied to the current starter bundle are recorded in
  [`burned-in-masks.json`](./burned-in-masks.json) — geometry and categories
  only. It deliberately does not record the strings that were removed: writing
  them down re-creates the disclosure the masking exists to undo.

## 3. Build the origins

```bash
cd Radoyon/radoyon && npm run content-bundle    # ships only redistributableEntries()
cd Pathoyon        && bash scripts/content-bundle.sh
```

## 4. Build, pack and publish

```bash
cd rohySimulator
npm run starter-content   # selects from the origins BY LICENCE
npm run pack:content      # archives + checksums; prints GitHub's 2 GB ceiling
```

`starter-content` names every asset it excludes and why. An asset dropped for
want of a licence is something to go and establish, not a number to notice
later.

Then attach the archives to a release on `mohsaqr/rohy-content` and record the
new checksums in `scripts/content-sources.json`.

## 5. A deployment installs it

```bash
npm run setup:content                          # from the published release
npm run setup:content -- --from /media/usb/…   # air-gapped, or a shared drive
```

Checksum-verified before anything is written, so a truncated transfer, the
wrong archive and an HTML error page saved with the right filename are one
clear failure at install rather than three confusing ones later.

## Before cutting a release

- [ ] `archiveIssues()` reports no errors
- [ ] every `attribution_only` entry has an attribution
- [ ] burned-in annotation reviewed for every ultrasound and angiographic entry
      — max-projection of **every frame**, and `provenance.pixelsReviewed` set
- [ ] `npm run starter-content` excluded nothing you expected to ship
- [ ] checksums in `scripts/content-sources.json` match the published assets
- [ ] a clean `npm run setup:content` installs and the rooms render

## Why selection is never by name

The bundler once selected slides by an id prefix. It gave the right answer only
because the unshippable slides happened to be called `local-*`, and it would
have failed silently in both directions the moment anything was renamed. Both
bundlers now ask the licence, and both name what they exclude.

Three slides in the pathology library still cannot ship: they carry a sha256, a
stain and a calibration, and nothing about who may use them. That is precisely
the failure this document exists to prevent, preserved as an example of it.
