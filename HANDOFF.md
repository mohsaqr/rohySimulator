# Session Handoff — 2026-05-10 (camera + vendor + verify)

> **TL;DR:** Camera fallback rewritten (proactive enumeration, broader error
> catch, defensive cleanup, deviceId caching). Vendor/wasm population fixed
> at the install layer (`download-models.sh` now downloads from jsDelivr;
> previously gitignored with no automated source). `scripts/tech-test.sh`
> wired into `deploy.sh rohy` as a `POST_VERIFY` step so future deploys are
> self-checking. **Everything is in the working tree, nothing committed yet
> — operator must approve commit + push.**

## What changed (in working tree, uncommitted)

### `OyonR/src/capture/CameraController.js` — full rewrite

Replaces the reactive Continuity-Camera fallback (commit `56fe0d1`) with a proactive strategy:

1. **Permission-prime once** (`getUserMedia({video:true,audio:false})`, immediate stop) so `enumerateDevices()` returns populated labels. Skipped if labels are already populated from a prior session.
2. **Enumerate + rank**: non-Continuity cameras first, Continuity last (so an iPhone-only setup still works rather than refusing to start).
3. **Cached preferred device** from `localStorage['oyon.preferred-camera-id']` floats to the front of the ranked list.
4. **Try ranked devices in order** with `getUserMedia({video:{deviceId:{exact:id}}})` so macOS can't re-route to the paired iPhone.
5. **Broader retryable error set**: `NotReadableError`, `OverconstrainedError`, `AbortError`, `TrackStartError`. Hard-fail on `NotAllowedError`/`SecurityError` (which also clears the cached preferred id).
6. **Defensive cleanup**: any throw between `getUserMedia` resolving and `video.play()` returning stops every allocated track.
7. **Concurrency guard + abort-during-start** (added in Codex hardening pass): `start()` rejects double-invocation; `stop()` increments a generation counter and an in-flight `start()` that observes the mismatch throws `CameraStartAbortedError`, cleans up local refs, and never installs the partially-acquired stream on `this`. The commit point (`this.stream = acquired...`) is at the very end of `start()` — until then, all acquired state is local-only.
8. **Final fallback** to the original configured constraint if no enumerated device works.
9. Errors carry `err.cameras = [{deviceId,label}, ...]` for future picker UX.

Public API unchanged (`new CameraController(opts).start()` / `.stop()`). No callers needed updating.

### `OyonR/scripts/download-models.sh` — extended to populate `standalone/vendor/`

Previously: claimed in its echo line to populate vendor/, but only downloaded models. Vendor wasm/mjs was gitignored AND not in any dependency tree's install path AND not LFS-tracked. Every fresh clone (Mac or server) silently broke at runtime.

Now downloads from jsDelivr alongside the existing model fetches:
- ONNX Runtime Web 1.20.1: 10 files (6 required, 4 optional).
- MediaPipe tasks-vision 0.10.35 (peerDep range `^0.10.22` was unsatisfiable; jumped from 0.10.9 → 0.10.35 on npm): 7 files (5 required, 2 optional).
- Soft-fail on 404 for optional flavors (asyncify/jspi/module — ORT/MediaPipe load them dynamically and fall back when absent).
- **Atomic write pattern** (added in Codex hardening pass): downloads land at `<dest>.part`, get verified for non-zero size, then `mv`'d into place. Failed/aborted runs leave NO partial file at `$dest`, so the next idempotent run re-downloads instead of mistaking a truncated file for "already present".
- **Clean HTTP code capture**: `if http=$(curl ...); then ... fi` form keeps `set -euo pipefail` semantics intact AND yields a deterministic `$http` string (no merged stderr/progress noise).
- Versions overridable via `ORT_VERSION=...` `MP_VERSION=...` env vars.

**Verified empirically**: stashed `vendor/onnxruntime-web` and `vendor/mediapipe` to `/tmp/oyon-vendor-backup/`, re-ran the script from empty, confirmed all required files re-downloaded with expected sizes. Re-tested after atomic-write hardening: deleted a single file, re-ran, confirmed re-download succeeded with no `.part` residue. Stash kept until camera is confirmed working post-deploy.

### `scripts/tech-test.sh` — now tracked (no longer untracked)

The 235-line deploy verifier from last session is no longer a session-only artifact. Already executable. Stays as-is content-wise.

### `JStats/website/sites.conf` + `JStats/website/deploy.sh` — POST_VERIFY hook

New generic mechanism: any service in `sites.conf` can declare `POST_VERIFY_<svc>="<command>"`. After the kind-specific deploy + restart succeeds, `run_one()` runs that command **locally on this Mac** and treats non-zero as a deploy failure (deploy is reported red, status flips to `warn` on the dashboard).

For rohy: `POST_VERIFY_rohy="ROHY_INSECURE=1 ~/Documents/Github/rohySimulator/scripts/tech-test.sh https://192.168.50.39:4001/rohy"`.

Other services see no behaviour change (no field set → no verification step).

Codex hardening: the `eval` runs in a subshell that `cd`s to `SCRIPT_DIR` first, so relative paths in POST_VERIFY are predictable regardless of the operator's cwd. Trust model documented inline (sites.conf is source-controlled — same boundary as the existing `eval`'d PULL_BUILD/RESTART/REMOTE_BUILD fields).

### `LEARNINGS.md` + `CHANGES.md`

Appended 2026-05-10 entries capturing eight findings:
1. `enumerateDevices()` returns empty labels until first permission grant.
2. macOS Continuity Camera routes default constraints to the paired iPhone.
3. `NotReadableError` isn't the only retryable getUserMedia failure.
4. Defensive cleanup separates "failed start" from "wedged camera".
5. `peerDependencies` don't auto-install in this repo's parent layout.
6. `@mediapipe/tasks-vision` skips most npm patch versions (0.10.10–0.10.34).
7. ORT wasm `asyncify` and `jspi` flavors aren't in 1.20.x npm dist.
8. `curl -fL ... -o "$dest"` leaves a partial file on HTTP error — `rm -f` after.
9. POST_VERIFY belongs in the deploy script, not "an operator habit".

## What's NOT done — operator continues here

### 1. Browser camera verification (PRIMARY — original goal)

Same as last session's open issue #1 but now with the more robust fix:
1. **Build + deploy** the changes: `cd ~/Documents/Github/JStats/website && ./deploy.sh rohy`. With POST_VERIFY wired, deploy.sh will refuse to report green if `tech-test.sh` fails post-restart.
2. **Hard-refresh** `https://192.168.50.39:4001/rohy/` (Cmd+Shift+R) so the post-rewrite bundle loads.
3. **DevTools → Console + Network → click camera button**.
4. Watch for the new error class (or success):
   - **Success**: `POST /api/addons/oyon/emotion-records` requests appear → camera is working, persistence is working, you can close this entire issue thread.
   - **`NotAllowedError`**: user permission was denied or revoked at the OS level. System Settings → Privacy & Security → Camera → enable for Chrome.
   - **`NotFoundError`**: no video input devices at all. Plug in a camera or check System Settings → Camera.
   - **Still `NotReadableError`** after the rewrite: extreme edge case — even the explicit-deviceId path failed. Open `localStorage` in DevTools and `delete oyon.preferred-camera-id` to clear a stale cached id, then retry. If that fails, the device-picker UX (deferred — see §3) becomes the next priority.
5. **Diagnostic snippet** if you want to enumerate manually:
   ```js
   navigator.mediaDevices.getUserMedia({video:true})
     .then(s => { s.getTracks().forEach(t => t.stop()); return navigator.mediaDevices.enumerateDevices(); })
     .then(ds => console.table(ds.filter(d => d.kind === 'videoinput').map(d => ({label: d.label, id: d.deviceId.slice(0,12)+'…'}))))
     .catch(e => console.error('FAIL:', e.name, '|', e.message))
   ```

### 2. Cron-based pulls don't trigger POST_VERIFY

`/opt/update-sites.sh` runs every 10 min on the server and handles `MODE=server-pull` and `MODE=both` services. It pulls + builds + restarts on the server but doesn't run any local-side verifier. This is fine for now (manual `./deploy.sh rohy` is the primary path and DOES verify) but worth knowing: a cron-pull deploy can land a broken release silently.

**Possible follow-up:** add a server-side `IN_SERVER_VERIFY_<svc>` field that `update-sites.sh` runs from localhost (e.g., `curl -fsSk https://localhost:4001/rohy/api/health`) — separate from POST_VERIFY which assumes Mac-side execution.

### 3. Device-picker UX (deferred)

`CameraController.js` now attaches `err.cameras = [...]` to throws but the widget doesn't surface it. Adding a "pick camera" dropdown in `OyonCaptureWidget.jsx` on first-error would let a user without DevTools knowledge switch to a USB webcam manually. Left out of this round (bigger surface change, tests required) — the structured error sets it up.

### 4. Cross-tab camera mutex (deferred from last session)

Pill widget + standalone iframe + a second rohy tab all race for the camera. Not addressed here. Same priority as last session.

### 5. Vendor backup at `/tmp/oyon-vendor-backup/`

Rollback safety net. Delete after camera is confirmed working (the backup contains asyncify/jspi flavors that the new vendor doesn't, but the rewrite doesn't need them — ORT falls back).

```sh
rm -rf /tmp/oyon-vendor-backup    # only after browser-side verification
```

## Files modified / created in working tree

| File | State | Notes |
|---|---|---|
| `OyonR/src/capture/CameraController.js` | modified, uncommitted | Full rewrite. Public API unchanged. |
| `OyonR/scripts/download-models.sh` | modified, uncommitted | Now populates vendor/ from jsDelivr. |
| `scripts/tech-test.sh` | newly tracked, uncommitted | Was untracked at session start. |
| `LEARNINGS.md` | modified, uncommitted | 2026-05-10 entry appended. |
| `CHANGES.md` | modified, uncommitted | 2026-05-10 entry prepended. |
| `HANDOFF.md` | overwritten, uncommitted | This file. |
| `OyonR/standalone/vendor/onnxruntime-web/` | working-tree state different from before | 6 files (gitignored — won't be in commit). |
| `OyonR/standalone/vendor/mediapipe/` | working-tree state different from before | 7 files (gitignored — won't be in commit). |
| `JStats/website/sites.conf` | **DIFFERENT REPO**, modified, uncommitted | Added `POST_VERIFY_rohy`. |
| `JStats/website/deploy.sh` | **DIFFERENT REPO**, modified, uncommitted | Generic `POST_VERIFY_<svc>` handling in `run_one`. |

## Operator action plan (in order)

1. **Codex review the diff** (per saved memory: every delivery gets Codex review). The changes are scoped to:
   - `git diff OyonR/src/capture/CameraController.js OyonR/scripts/download-models.sh LEARNINGS.md CHANGES.md HANDOFF.md` (in rohySimulator)
   - `git diff sites.conf deploy.sh` (in JStats)
   - Newly-tracked: `scripts/tech-test.sh`
2. **Commit + push the rohySimulator diff** (CameraController + download-models + tech-test + 3 docs). Do NOT include the vendor/ binaries — they're gitignored, that's intentional.
3. **Commit + push the JStats/website diff** (sites.conf + deploy.sh).
4. **Deploy**: `cd ~/Documents/Github/JStats/website && ./deploy.sh rohy`. The new POST_VERIFY step will run tech-test.sh after the server restart; deploy goes red if anything fails.
5. **Browser-verify the camera** (§1 above).
6. **On success**: `rm -rf /tmp/oyon-vendor-backup`, mark this session done.
7. **On failure**: report the error class from §1's table; the rewrite makes the failure mode actionable.

## Per saved memory / global CLAUDE.md

- "Survey state, propose, wait for approval" — followed: proposal accepted via AskUserQuestion before any edits.
- "Every delivery gets Codex review" — done. Codex flagged 2 blockers + 4 important items. All addressed before this handoff (concurrency guard + atomic-write + cd-subshell). Findings + resolutions captured in CHANGES.md.
- Never run git commands without explicit ask — followed; nothing has been staged, committed, or pushed.
- Never add `Co-Authored-By: Claude` — applies to any commit message the operator writes.

— end of handoff —
