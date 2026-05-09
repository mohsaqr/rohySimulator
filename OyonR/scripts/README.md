# scripts/

Helpers for repo maintenance. None of these are run automatically; they
exist for the maintainer.

## `download-models.sh`

Fetches MediaPipe + ONNX model weights from their upstream sources into
`standalone/models/` and `standalone/vendor/`. Idempotent — skips files
that already exist.

```bash
bash scripts/download-models.sh           # only fetch missing files
bash scripts/download-models.sh --force   # re-download everything
```

This script is the fallback for two scenarios:

1. **Slim-clone setup.** If we ever remove the bundled weights from the
   repo (gitignore + ship a tiny repo), cloners run this once after
   `npm install` to pull the weights.
2. **Re-vendoring.** When upstream publishes a newer model version,
   update the URL in the script and re-run with `--force`.

The bundled emotion model URLs are pinned to the upstream EmotiEffLib
ONNX model directory.

---

## Migrating bundled binaries to Git LFS

The repo currently includes ~133 MB of binary assets (ONNX models +
WASM runtimes + MediaPipe `.task` file) committed normally. This is
fine for now — every individual file is under GitHub's 100 MB hard
limit — but the full clone is slow and `git push` of any new model
version uploads the whole binary again.

If/when this becomes painful, migrate to Git LFS in **one** clean commit:

```bash
# 1. Install LFS hooks once per machine
git lfs install

# 2. Tell LFS which paths to manage. This rewrites .gitattributes.
git lfs track "standalone/models/**/*.onnx"
git lfs track "standalone/models/**/*.task"
git lfs track "standalone/vendor/**/*.wasm"
git lfs track "standalone/vendor/**/*.mjs"

# 3. Rewrite history so existing blobs become LFS pointers.
#    --everything rewrites all branches and tags.
git lfs migrate import \
  --include="standalone/models/**/*.onnx,standalone/models/**/*.task,standalone/vendor/**/*.wasm,standalone/vendor/**/*.mjs" \
  --everything

# 4. Verify locally
git lfs ls-files | head

# 5. Push the rewritten history. This is a force-push of main —
#    coordinate with collaborators before doing it.
git push --force-with-lease origin main
git push --tags --force
```

Notes:

- After migration, GitHub's repo size for ordinary git history drops
  to a few MB; the LFS storage counter ticks up by ~270 MB.
- GitHub free tier includes 1 GB of LFS storage and 1 GB/month of LFS
  bandwidth. Beyond that you pay $5/month per 50 GB pack. For a
  single-team research repo this is usually free forever.
- Once migrated, contributors need `git lfs install` once per machine
  before `git clone` or they'll get pointer files instead of the real
  binaries.
- Don't migrate without taking a backup of the repo. Force-pushing
  rewritten history is irreversible without a backup.

The `.gitattributes` file in this repo intentionally **does not** declare
LFS filters today — adding them before running `migrate import` would
create an inconsistency between cloners with LFS installed and those
without.
