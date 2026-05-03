# RocketBox → viseme-rigged GLB pipeline

Converts [Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox)
avatars into the viseme-rigged GLBs the patient/agent panel expects (15
Oculus visemes + `eyeBlinkLeft/Right`, with the morph targets in a fixed
canonical order so the lipsync runtime can index them positionally).

The 10 GLBs already in `public/avatars/heads/rb_*.glb` were produced by
this same pipeline; this script exists so adding the next 13 (or any
future avatars) is a one-command operation instead of a one-off scratch
script in `/tmp`.

## What it does

For each avatar listed in `avatars.json`:

1. Downloads `<Name>_facial.fbx` from the public Microsoft-Rocketbox
   GitHub repo (the `_facial` variant is the one carrying RocketBox's
   15 viseme + 48 FACS blendshapes — the plain `.fbx` has no morphs).
2. Runs FBX2glTF to convert FBX → raw GLB. The raw output has ~175
   morph targets, white placeholder PNGs (FBX2glTF can't decode TGA),
   and one PBR material per mesh region — typically `<prefix>_body`,
   `<prefix>_head`, `<prefix>_opacity`. The texture-set prefix
   (`f005_*`, `m002_*`, …) is NOT always derivable from the avatar
   name; the pipeline reads the actual material names from each
   per-avatar conversion.
3. For every material slot (`baseColor`, `normal`), downloads the
   matching TGA from the avatar's `Textures/` directory, decodes it
   via the `tga` package, downscales the raw RGBA pixels to 1024 px
   max with `sharp`, encodes PNG, and replaces the placeholder via
   `@gltf-transform`'s texture API.
4. Walks every PrimitiveTarget, identifies the source blendshape from
   the POSITION accessor's name (FBX2glTF leaves them as
   `blendShapeN.AA_VI_NN_xx` for the 15 visemes and
   `blendShapeN.AK_NN_<OculusName>` for the 48 FACS), maps to the
   canonical Oculus name (`viseme_PP`, `eyeBlinkLeft`, …), drops
   everything outside the 17-morph keep set, and reorders the
   keepers into the canonical Oculus order.
5. Runs `prune()` + `dedup()` from `@gltf-transform/functions` to
   garbage-collect orphaned accessors / bufferViews / textures /
   samplers and dedupe shared resources across the LOD primitives.
   This is what gets the output from the raw 12 MB down to the
   3-7 MB range the previously-shipped GLBs sit in.
6. Writes the result to `public/avatars/heads/<dstName>.glb`.

## Use

From this directory:

```bash
npm install                 # one-time, ~12 MB binary
npm run convert             # convert everything in avatars.json
npm run convert -- --only=rb_male_adult_04,rb_female_child_01
npm run convert -- --force  # re-convert even if dst already exists
```

The pipeline is **idempotent and additive**: by default it skips any
avatar whose final GLB already exists. The 10 GLBs already in
`public/avatars/heads/` are protected this way — passing `--force` is
the only way to overwrite them.

`VERBOSE=1` exposes FBX2glTF's stdout/stderr (useful when textures
are missing or material names look wrong).

## What's gitignored

- `node_modules/` — `fbx2gltf` ships a 12 MB Darwin binary in there
  that we don't want in the repo.
- `work/` — per-avatar scratch dir holding the downloaded FBX and the
  raw FBX2glTF output. Safe to delete; the pipeline re-downloads
  on demand and caches between runs while it exists.
- `package-lock.json` — re-derivable from `package.json`.

## Adding more avatars later

1. Find the avatar in `https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars`.
   Note its group (`Adults`, `Children`, `Professions`) and exact name.
2. Append an entry to `avatars.json`:
   ```json
   {
     "srcGroup": "Adults",
     "srcName":  "Female_Adult_12",
     "dstName":  "rb_female_adult_12",
     "label":    "Adult woman 12",
     "gender":   "female",
     "age":      "adult"
   }
   ```
3. Run `npm run convert -- --only=rb_female_adult_12`.
4. Add the same entry to
   `public/avatars/heads/manifest.json` under `all[]` and the
   appropriate gender/age bucket — the script does NOT touch the
   manifest; the runtime reads from the manifest, so picker changes
   are explicit.

## Known quirks

- **FBX2glTF 0.9.7 doesn't write `mesh.extras.targetNames`** — it
  stashes morph names on the per-target POSITION accessor as
  `blendShape1.AA_VI_…`. The previous one-off pipeline dealt with
  this by patching the GLB JSON chunk after writing. This pipeline
  handles it cleanly by setting `target.setName(oculusName)` on
  every `PrimitiveTarget` *before* writing — the `@gltf-transform`
  writer reads names from the targets themselves and emits a correct
  `mesh.extras.targetNames`, so no post-write patch is needed.
- **Texture-set prefixes don't always match avatar names.** E.g.
  `Adults/Male_Adult_01/Textures/m002_*.tga` — same texture set is
  shared with another avatar. This is why the pipeline reads
  material names from each per-avatar FBX2glTF output rather than
  hardcoding a prefix.
- **Missing textures don't abort the run.** If a TGA 404s, the
  pipeline keeps the FBX2glTF placeholder for that slot and logs a
  warning. Worth checking the warning before shipping the GLB.
- **No `--blend-shape-normals` / `--blend-shape-tangents`.** The
  runtime lipsync only reads POSITION deltas per viseme; including
  per-target normals/tangents inflates the output 3-4× for no
  visual gain.
- **macOS arm64**: the npm `fbx2gltf` package's Darwin binary is
  `x86_64` but Rosetta runs it natively-fast. No special install
  steps needed.
