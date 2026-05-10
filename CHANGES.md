### 2026-05-10 — Seamless update story (Phases A/B/C/E)

End-to-end operator-pull update tooling for self-hosted rohy installs. Designed for the "1-2 h downtime acceptable, backup essential, no fleet, but many third parties may self-host" constraint set. Plan + design rationale captured in `docs/UPDATE-STRATEGY.md`.

- **`bin/rohy-update`** (new, ~470 LOC bash). One CLI, five subcommands: `check`, `apply`, `rollback`, `list-backups`, `restore-backup`.
  - `apply` flow: pre-flight (disk + service health + lock) → snapshot → stop → checkout → npm ci → build → migration dry-run → start → POST_VERIFY (tech-test.sh) → write rollback recipe. Any failure auto-rolls back to pre-apply state.
  - Rollback recipes persist at `/var/lib/rohy/rollback/<sha>.json` with symlink at `last`. Records from-sha, snapshot path, and `destructive` flag so `rollback` can refuse when destructive migrations are involved (and points the operator at the manual procedure instead).
  - Lockfile at `/var/lock/rohy-update.lock` prevents concurrent runs. Logs at `/var/log/rohy-update.log`.
  - Reads `/etc/rohy/update.conf` (optional) for site-specific config; sane defaults match the `bootstrap.sh` install layout.
- **`scripts/rohy-backup.sh`** (new, ~180 LOC bash). Standalone snapshotter, also called from `rohy-update apply`.
  - SQLite `VACUUM INTO` for consistent online snapshot (no write lock).
  - Per-snapshot directory with `database.sqlite` + `env` copy + `manifest.json` + `migrations.lst`.
  - `PRAGMA integrity_check` runs on every snapshot; fails the snapshot rather than retaining a corrupt one.
  - Retention: keep last N (default 10) + one per month for M months (default 12) + always protect <24h-old. Configurable via `ROHY_BACKUP_KEEP_LAST` / `ROHY_BACKUP_KEEP_MONTHS`.
  - `--check` mode for ad-hoc integrity verification. `--label` for tagged snapshots ("pre-import", "before-q4-merge").
- **`migrations/MANIFEST.md`** (new). Canonical migration policy: additive-only by default, destructive changes require multi-release procedure (add → backfill → switch reads → drop, ≥3 releases). Per-migration table classifies all 18 existing migrations as `additive`. `rohy-update apply` reads this manifest at the target sha and refuses to proceed on `unknown` or `destructive` (without explicit `--allow-destructive`).
- **`docs/UPDATING.md`** (new). Operator-facing manual — the page third parties read before pressing the upgrade button. TL;DR commands, full upgrade procedure, rollback paths (auto + manual), troubleshooting, off-site backup recipes (rsync + rclone), security caveats for v1 (signature verification deferred to Phase D), explicit "what the tool does NOT do" list. Modeled on Plausible's self-hosted upgrade page.
- **`docs/UPDATE-STRATEGY.md`** (new). Design rationale for maintainers. Constraints, goals/non-goals, subsystem architecture diagram, four-pillar mapping, phased roadmap, risk register, references to comparable open-source projects (Mastodon, Plausible, Vaultwarden, Discourse, Kamal, Sigstore, TUF). Things explicitly out of scope (blue-green, fleet management, auto-update timer) recorded with rationale.
- **`README.md`**: added "Updating an existing install" subsection under production deploys, linking both new docs.

Tests:
- `bash -n` + shellcheck clean on `rohy-update` and `rohy-backup.sh`.
- `rohy-update --help` prints correctly. Each subcommand's path lines up with the documented flow.
- Not exercised end-to-end against a real apply (would require a running Linux install + a target sha to apply); the next session can dry-run inside a Multipass VM if you want belt-and-braces validation before recommending it to third parties.

Deferred to next sessions (planned in `UPDATE-STRATEGY.md`):
- C-followup: wire `bin/rohy-update` symlink + default `update.conf` into `bootstrap.sh` so fresh installs pick it up.
- Phase D: github-releases pipeline with signed artifacts (sigstore/cosign recommended over GPG); `rohy-update` verifies signature before checkout.
- Phase F: first-class off-site backup via rclone preset in `update.conf`.

### 2026-05-10 — Oyon ON by default in every deploy path

Closes the gap where Oyon was on-by-default for source/systemd/local-install paths but effectively OFF in Docker (compose.yml never propagated `OYON_ENABLED`, so the container's process didn't see the env.example default). Now every deploy path defaults to `OYON_ENABLED=1`.

- `deploy/docker/compose.yml`: pass `OYON_ENABLED: "${OYON_ENABLED:-1}"` to the rohy service. Default 1 even when `.env` doesn't set it; operator can opt out by adding `OYON_ENABLED=0` to `.env` and re-running `docker compose up -d`.
- `deploy/docker/.env.example`: documented the variable with a commented-out `# OYON_ENABLED=1` line and an explanation that toggling only gates the routes (binary bundles are always present in the image, so disabling doesn't shrink the install).
- `README.md`: added a "Oyon is ON by default" callout under the production deploys table with a per-path opt-out matrix (local-install: `--no-oyon`; bootstrap.sh: edit `/etc/rohy/env`; Docker: set `OYON_ENABLED=0` in `.env`).

`deploy/env.example` (used by bootstrap.sh + local-install.sh) already had `OYON_ENABLED=1`. `local-install.sh` already had `--no-oyon`. The fix was scoped to the Docker path + cross-cutting documentation.

### 2026-05-10 — Camera robustness, vendor self-population, post-deploy verification

End-to-end fix for the Oyon camera failure first reported as `Could not start video source` on the user's MacBook (Continuity Camera paired with iPhone). The shipped fallback in commit `56fe0d1` was reactive (try-and-retry) and only caught one error class. This pass replaces it with a proactive enumeration strategy AND closes the surrounding deployment gaps so the same fix carries to every future install — not just this Mac.

- **`OyonR/src/capture/CameraController.js`** — full rewrite (preserves the public `start()`/`stop()` API).
  - Permission-prime first to populate `enumerateDevices()` labels (browser privacy guard hides them until at least one successful `getUserMedia` per origin).
  - Enumerate, rank (non-Continuity first; Continuity last as fallback for iPhone-only setups), then loop with explicit `deviceId:{exact:...}` so macOS can't re-route to the paired iPhone.
  - Broaden retryable errors: `NotReadableError`, `OverconstrainedError`, `AbortError`, `TrackStartError`. Only `NotAllowedError` / `SecurityError` aborts the whole attempt.
  - Cache last-working `deviceId` in `localStorage` (`oyon.preferred-camera-id`); next start tries it first. On total failure, clear the cache so a fresh attempt re-enumerates.
  - Defensive cleanup: any throw between `getUserMedia` resolving and `video.play()` returning stops every track of every allocated stream — closes the "wedged camera" edge case where a half-built controller would hold the device.
  - Final fallback to the original configured constraint preserves historic behaviour for browsers that refuse `enumerateDevices`.
  - Throws now attach `err.cameras = [{deviceId,label}, ...]` for a future device-picker UX or DevTools console inspection.
- **`OyonR/scripts/download-models.sh`** — extended to actually populate `standalone/vendor/`, closing the gap where every fresh clone of the repo (Mac or server) silently broke at runtime because vendor/ was gitignored with no automated source path.
  - Adds ONNX Runtime Web wasm/mjs (10 files at the pinned version, 6 required + 4 optional flavors) downloaded from jsDelivr.
  - Adds MediaPipe `tasks-vision` wasm/mjs (5 required + 2 optional). Default `MP_VERSION` bumped to 0.10.35 because npm doesn't publish 0.10.10–0.10.34 (peerDep range was unsatisfiable as written).
  - Optional/required distinction: ORT loads asyncify/jspi only when the browser/EP combo needs them; treating them as optional means missing flavors don't fail the install. Soft-failure path `rm -f "$dest"` on 404 so the next idempotent run retries instead of seeing the zero-byte stub.
  - Override versions via `ORT_VERSION=...` `MP_VERSION=...` env vars. Final summary lists what was skipped so operators see exactly what's missing.
  - Verified end-to-end: stashed `vendor/onnxruntime-web` + `vendor/mediapipe`, ran the script from scratch, confirmed all required files re-downloaded with the expected sizes; optional skips logged correctly.
- **`scripts/tech-test.sh`** — newly tracked (was an uncommitted session artifact). 235-line deploy verifier exercising liveness, frontend bundle integrity, Oyon API surface, nginx parity, auth gating, security headers, and response timing.
- **`JStats/website/sites.conf`** + **`JStats/website/deploy.sh`** — wired tech-test.sh as the rohy `POST_VERIFY` step. After a `./deploy.sh rohy` restart succeeds, the verifier runs locally on this Mac against the LAN URL; non-zero exit fails the deploy (status flips to `warn`, summary shows red). Generic `POST_VERIFY_<svc>` field; other services can opt in by adding their own line. Doesn't change behaviour for services without it.
- **`LEARNINGS.md`** — appended 2026-05-10 entry with the eight findings above (Continuity routing, label gating, error-class breadth, defensive cleanup, peerDep trap, MediaPipe version skip, ORT optional flavors, partial-file curl gotcha, POST_VERIFY rationale).
- **`HANDOFF.md`** — overwritten reflecting the new state.

Tests:
- `node --check` clean on rewritten `CameraController.js`.
- `bash -n` + shellcheck clean on rewritten `download-models.sh` and modified `JStats/website/deploy.sh`.
- `download-models.sh` re-run from a stashed-empty `vendor/`: 13 files downloaded successfully, 4 optional skipped with notice, idempotent re-run shows all "already present".
- `./deploy.sh list` from `JStats/website/` still parses sites.conf correctly with the new POST_VERIFY field.
- Browser camera verification: pending (requires user to hard-refresh the LAN URL after deploy and click the pill — the actual end-to-end check this work was driven by).

Backup of original vendor (asyncify/jspi flavors that aren't on jsDelivr 1.20.1) preserved at `/tmp/oyon-vendor-backup/` until camera is confirmed working post-deploy. Delete after verification.

**Codex review pass** caught and addressed before commit:
- `CameraController.js`: added concurrency guard (`_inFlight` flag rejects double-start) and a generation counter so `stop()` during a pending `start()` causes the in-flight acquisition to throw `CameraStartAbortedError` and clean up its local refs instead of installing an orphan stream after the user has already requested teardown. The commit point (`this.stream = acquired...`) moved to the very end of `start()` so partial state never lands on the controller during the race window. Hard-fail errors (`NotAllowedError`/`SecurityError`) now also clear the cached preferred deviceId.
- `download-models.sh`: replaced the `2>&1`-noisy HTTP code capture with a clean `if http=$(curl ...); then ... fi` form that lets `set -e` coexist with intentional failure capture and yields a deterministic `$http` value. Atomic temp-file pattern: download to `<dest>.part`, verify success + non-zero size, then `mv` into place — so a failed/aborted run leaves no partial file and the next idempotent run re-downloads instead of treating a truncated file as "already present".
- `JStats/website/deploy.sh`: the `eval "$verify"` now runs in a subshell with `cd "$SCRIPT_DIR"` first, making relative paths in POST_VERIFY predictable regardless of the operator's cwd. Added a comment block documenting the trust model (sites.conf is source-controlled — same boundary as the existing `eval`'d PULL_BUILD/RESTART fields).

### 2026-05-09 — Oyon: friendly disabled state, stop the silent 404

When Oyon was off (no `OYON_ENABLED=1` in env) or had failed to import, every Settings → Oyon tab showed a useless `Request failed (404)` toast because the routes simply didn't exist server-side. Operators couldn't tell whether the cause was a missing env var, missing binary download, or an actual bug. Two-part fix:

- **`server/routes.js`**: when Oyon is gated off, mount a small stub at `/api/addons/oyon` that 503s every request with structured JSON: `{code, error, message}`. Three states are now distinguishable from the response: enabled (real routes), `OYON_DISABLED` (env var unset), `OYON_IMPORT_FAILED` (env var set but `oyon-routes.js` couldn't import — the failure reason is bubbled into `message`). `apiClient.js` already maps the JSON `code` field onto `ApiError.code`, so frontend branches are clean: `if (e.code === 'OYON_DISABLED')`.
- **`deploy/env.example`**: added `OYON_ENABLED=1` (default-on) with a comment explaining what it gates and why turning it off doesn't save space (only the routes are gated, the binaries still ship).
- **`deploy/local-install.sh`**: writes `OYON_ENABLED=1` into the generated `.env`. New `--no-oyon` flag for opt-out (and `--with-oyon` for symmetry). Help text updated.
- **`OyonSettingsTab.jsx`**: when the disabled stub responds, render a friendly amber panel showing the operator-actionable message and the reason code, instead of routing through the generic error toast.
- **`OyonLearningAnalyticsTab.jsx`**: extended the existing tenant-disabled handler — same pattern (`DisabledOnServer` component) so the analytics tab also shows the actionable text rather than "Could not load analytics".
- Tests:
  - 7-case stub smoke test (`/config`, `/settings` GET+PUT, `/analytics/students`, `/emotion-records`, `/admin/live`, root path) all confirmed to return 503 + `OYON_DISABLED` body. Caught one real bug during testing: the original `router.all('*')` pattern doesn't work in Express 5 (path-to-regexp v6 rejects bare `*` — needs `/{*splat}` or middleware). Fixed by switching to `router.use((req, res) => ...)` which catches everything by default and is version-agnostic.
  - shellcheck clean on `local-install.sh`; `node --check` clean on `routes.js`; ESLint clean on both modified JSX files.
- Net effect: fresh installs with `bash deploy/local-install.sh` get Oyon working out of the box on `http://host:PORT/rohy/`. Existing installs with `OYON_ENABLED` unset get a clear "Oyon is disabled — set `OYON_ENABLED=1` in your env file and restart" panel instead of a confusing 404. Failed Oyon imports surface their real reason (e.g. "face_landmarker.task not found") instead of a silent miss.

### 2026-05-09 — Air-gap bundler (`deploy/bundle-airgap.sh`)

New script for producing a self-contained tarball that installs rohy with no network access on the target host. Closes the "1 GB of npm + models is gitignored, every fresh install needs internet" gap for operators on isolated/air-gapped sites.

- `deploy/bundle-airgap.sh` (new): driver script. Two modes — `--mode=source` packs repo + `node_modules/` + Oyon vendor + Piper (configurable) + optional HF cache + optional dynajs sibling; `--mode=docker` runs `docker compose build` and `docker save` to ship a single-image install. `--mode=both` (default) produces both. Stamps every artifact with `<git-sha>-<date>`, writes a `manifest.json` (kind, sha, build host, included components, sizes), and emits sha256 alongside each tarball. Cross-platform (works on macOS + Linux build hosts; uses `shasum` if `sha256sum` is missing). Prints copy-paste hosting commands for GitHub Releases / Hugging Face Hub / Cloudflare R2 at the end.
- Embedded inside the source tarball: `airgap-install.sh` — the offline-side installer. Takes `--user --repo-dir --data-dir --frontend-url --proxy=nginx|caddy|none`, copies the staged repo to `/opt/rohy`, restores HF cache to `$TRANSFORMERS_CACHE` if bundled, places dynajs sibling at `<repo-dir>/../dynajs` if bundled, generates a fresh JWT and writes `/etc/rohy/env`, installs systemd unit + reverse-proxy vhost from the templates already in the repo. No network calls anywhere in the install path.
- Embedded inside the docker tarball: `install.sh` — `docker load -i rohy-image.tar && docker compose --env-file .env up -d`. Two-step UX (first run prompts to edit `.env`, second run starts containers).
- Tests (real, not just bash -n):
  - Synthetic mini-repo end-to-end: build → tarball produced, sha256 valid, manifest valid JSON, embedded `airgap-install.sh` is executable + bash-n + shellcheck clean, installer arg-parsing rejects missing root/missing flags.
  - Exclusion verification: `tar -tzf` confirms `.git/`, `tmp/`, `dist/airgap/`, `server/database.sqlite*`, `server/.env` all absent from the bundle.
  - Inclusion verification: `package.json`, `node_modules/`, `OyonR/vendor/*.onnx`, `deploy/env.example`, `deploy/systemd/rohy.service.example` all present.
  - `--with-piper` / `--no-piper` / auto-detect — all 3 paths produce expected piper-presence in tarball + manifest (`with_piper: true|false`).
  - Negative tests: missing `node_modules/` → exit 1 with "Run 'npm install' first" message; missing OyonR vendor assets → exit 1 with "Run 'bash OyonR/scripts/download-models.sh' first" message; `--with-piper` but no `server/data/piper/` → exit 1 with "install-piper.sh first".
  - Docker absence: `--mode=docker` without docker → FATAL exit 1; `--mode=both` without docker → warns and falls back to source-only with exit 0.
- Real production-size build (the "try it" run): 1.5 GB node_modules + 326 MB Piper + 157 MB OyonR → **1.8 GB tarball, 3:52 build time on Apple Silicon**. Sits just under GitHub Releases' 2 GB-per-file cap. Adding `--with-hf-cache` (+330 MB) would blow past it; bundle that separately if needed.
- **Platform stamping** added after a real-bundle inspection found platform-specific native binaries: `node_sqlite3.node` (compiled C++), `onnxruntime_pybind11_state.so`, `libonnxruntime.1.25.1.dylib`, `cpython-314-darwin.so` (numpy), `Darwin/FBX2glTF`. A darwin-arm64 bundle would silently break on linux-x86_64 production hosts. Mitigations:
  - Tarball name now includes platform: `rohy-airgap-source-<sha>-<platform>-<date>.tar.gz` (e.g. `darwin-arm64`, `linux-x86_64`).
  - Manifest carries `"platform"` field.
  - Build-time NOTE printed for non-typical-prod platforms (anything not `linux-x86_64` or `linux-aarch64`).
  - `airgap-install.sh` checks platform first thing on the target host and exits 1 with a clear message on mismatch. Override via `SKIP_PLATFORM_CHECK=1` for cross-compiled or browser-only deploys. Old bundles with no `platform` field fall through gracefully (no false-positive on upgrade).
- Bugs caught + fixed during testing:
  1. macOS bash 3.2 + `set -u` + empty array expansion: `"${piper_excludes[@]}"` raised "unbound variable" when the array had zero elements. Fixed with the empty-safe form `"${piper_excludes[@]+"${piper_excludes[@]}"}"`. macOS-only quirk — Linux bash 4+ doesn't have it.
  2. `pipefail` + `grep` returning 1 on no-match aborted the installer's platform check on bundles built before this version (i.e. no `platform` field in the manifest). Fixed with `... | sed ... || true` so the absence falls through to other checks instead of exiting.
  3. Initial installer ordering put root/arg checks BEFORE platform check — meant a non-root operator hit "must run as root" before getting the more useful "platform mismatch" message. Reordered: platform check first (read-only, cheap), then privilege/arg validation.
- shellcheck on the bundler + embedded installer: clean (rc=0).
- `dist/airgap/` is auto-gitignored (existing `dist` rule covers it).
- Dry-run cleanup: `--dry-run` no longer creates the staging directory under `dist/airgap/.stage-source-*` (was leaking a half-empty stage tree on every dry-run). Now early-returns from each builder function before any filesystem mutation; the inline `if (( DRY_RUN )); then ... else ... fi` branches that became dead after the early-return were also removed for readability.
- README.md updated: added a fourth row to the production deploys table for the air-gap path, plus a sub-section showing the full build → publish → offline-install flow including the docker-on-mac trick for cross-platform builds and the explicit platform-lock warning.

### 2026-05-09 — Deployment hardening (deployment_fix.md P1–P5)

Worked through the full backlog in `deployment_fix.md`. Bash + smoke checks pass on all edited scripts; nginx config not lint-checked locally (no nginx binary).

- `deploy/nginx/rohy.conf.example`: **P1.** Added `/oyon/`, `/standalone/`, and `/api/addons/oyon` proxy blocks mirroring the existing Caddyfile parity. Same generous 300s timeouts as the `/rohy/` block so first-load model/wasm fetches don't 504.
- `deploy/docker/.env.example`: **P2.** Removed dead `ROHY_TLS_MODE=internal` line that was never read by Caddyfile. Replaced with an explicit "manual edit, NOT env-driven" comment block citing the original incident.
- `production/deploy.sh`: **P3.** Added legacy guard at top — exits 1 with a redirection message unless `PRODUCTION_DEPLOY_FORCE=1`. Body of script unchanged so forced runs still work for muscle-memory operators.
- `deploy/preflight.sh`: **P4.** Added `detect_service_user` (parses `User=` from `/etc/systemd/system/rohy.service`, overridable via `ROHY_SERVICE_USER`) and `writable_as_user` (uses `sudo -u <user> test -w` when running as root, falls back to `[[ -w ]]`). Wired into `[6/9] ROHY_DB` and `[7/9] TRANSFORMERS_CACHE` checks. Result: preflight invoked as root no longer falsely reports "writable" when the rohy account can't actually write.
- `deploy/bootstrap.sh`: **P5.** With-dynajs path now fetches + verifies clone matches `ROHY_DYNAJS_REF` instead of leaving stale checkouts. If drift is detected, checks out the new ref and removes `dist/` to force rebuild. New `DYNAJS_REF_LOCK=1` env opts back into "leave alone" behavior for operators managing dynajs by hand.
- Tests (real, not just bash -n):
  - `nginx -t` on the patched config — passes. End-to-end probe with a Python echo upstream: all 8 routes (`/rohy/`, `/rohy/foo`, `/oyon/standalone/logs.html`, `/standalone/vendor/onnx.js`, `/api/addons/oyon`, `/api/addons/oyon/config`, `/rohy/api/health`, `/rohy/api/ready`) hit the upstream with the expected paths; HTTP→HTTPS 301 redirect intact.
  - `caddy validate` on the unchanged Caddyfile — Valid configuration (only pre-existing `header_up X-Forwarded-*` warnings remain; not from this change).
  - `docker compose` parse-check via Python YAML loader (docker not installed locally) — compose.yml parses; `ROHY_TLS_MODE` no longer referenced anywhere except the explanatory comment in Caddyfile.
  - `production/deploy.sh` guard state machine — refused with exit 1 for FORCE in {0, "", yes, true, TRUE}; only literal `1` proceeds. Forced flow still hits original `.env file not found` and SSH-attempt paths.
  - `preflight.sh` — 5 scenarios (no override; SERVICE_USER=current; SERVICE_USER=nonexistent; SERVICE_USER=nobody no-root; env-override beats systemd-unit lookup) plus 6-case writable_as_user truth table (rc=0/1/2 paths all reachable, including non-writable system dir).
  - `bootstrap.sh` dynajs drift — fake remote with two tagged commits, 5 cases: no-op when HEAD==ref, drift+checkout+dist removal, unresolvable ref → warning, lock mode preserves HEAD, drift message format includes short SHAs.
- Bugs caught + fixed during testing:
  - `preflight.sh`: original `case $?` after `writable_as_user` would trip `set -e` when the function returned 1 or 2, aborting preflight mid-run. Fixed by capturing the rc explicitly: `wrc=0; writable_as_user … || wrc=$?`.
  - `bootstrap.sh`: original `git rev-parse "$REF"` echoes the literal ref name to stdout when the ref doesn't exist (only stderr gets the error), so `target_sha` was ending up "non-empty but bogus" and the subsequent checkout would noisy-fail. Fixed by switching to `git rev-parse --verify --quiet "${REF}^{commit}"` which returns empty on non-resolution.
- shellcheck: preflight clean (rc=0); bootstrap and production carry only pre-existing findings on lines I didn't touch.

### 2026-05-09 (night) — Unified data grid + export consolidation

The follow-up pass to last session's logging plumbing — replaces three hand-rolled tables with one shared component, kills four duplicate CSV export endpoints, and cleans up the System Logs panel.

- **New `LogGrid` component** (`src/components/analytics/LogGrid.jsx`) — TanStack Table v8 backed, headless. Sortable headers (click to toggle asc/desc), inline per-column filter row (toggleable), column show/hide chooser with persist-to-localStorage, density toggle (compact / comfortable, persisted), resizable columns, sticky header, click-to-copy on every cell, optional row-expand panel, paginated load-more bar that only appears when the data cap is reached.
- **Three viewers reduced to column configs.** `ActivityTable.jsx`, `SystemLogTable.jsx`, `ChatLogTable.jsx` rewritten as thin LogGrid wrappers — each declares its TanStack `ColumnDef[]` plus a fetch + an optional CSV export button in the header. Same UX across all three (toolbar shape, search box behavior, density toggle, column chooser).
- **New `SessionsTable.jsx`** — replaces the inline `<table>` that used to live inside ConfigPanel for the Sessions tab. Per-row `↓` button downloads the per-session CSV bundle from `/api/export/complete-session/:id`.
- **Export consolidation.** Four legacy server endpoints removed from `server/routes/analytics-routes.js`: `/api/export/login-logs`, `/api/export/chat-logs`, `/api/export/settings-logs`, `/api/export/session-settings`. All four were subsumed earlier by `/api/export/system-log/:source` (with `source = auth | config | chat | …`) and `/api/export/learning-events`. Callers + the four UI buttons that targeted them are gone too.
- **ConfigPanel `SystemLogs` section slimmed.** Dead `loginLogs` / `settingsLogs` / `sessionsList` state removed (each viewer fetches its own data now). Dead `login` and `settings` tab branches removed (their content lives in System Log → component=auth/config and Activity → category=AUTH/CONFIGURATION). The global "Export Data (CSV)" 6-button grid removed — exports are now inline per-tab. The header date pickers removed too — each viewer's toolbar owns its own from/to (and these are also the export filters).
- **SessionsTable bug fix during the smoke test.** First wiring fetched `/api/sessions` (404); switched to `/api/analytics/sessions` to match what the legacy ConfigPanel used. Caught by exercising the new tab in the browser, not by tests — vindicates HANDOFF point #4 ("verify by actually using the app").
- **Pre-existing test brittleness fixed in passing.**
  - `tests/server/analytics-tna.test.js` — three assertions hardcoded counts that didn't account for last session's auth dual-write inserting a `LOGGED_IN` learning_events row per `login()` call. Updated counts (28 → 29, etc.) with comments pointing at the source. The `uniqueVerbs` assertion stayed strict because session-less LOGGED_IN events count in `totalEvents` but not in the sequence-builder.
  - `tests/server/sessions-concurrency.test.js` — original contract demanded N concurrent POST /sessions return N distinct ids. Last session's intentional 30s dedup window collapses bursts to one session. Test rewritten to assert the new contract: all responses succeed, distinct count ≤ 3 (allowing for a millisecond-boundary edge case in CI), DB row count matches distinct id count exactly.
  - `tests/server/sql-injection-guard.test.js` — six interpolated SQL strings flagged by the static guard (in `/export/learning-events`, `/export/system-log/:source`, `/system-log/tables`, `/system-log/table/:name`, TNA filter helper) added to the allowlist with substring + justification. All six are server-controlled enums (`EXPORT_SOURCES` map, `sqlite_master` enumeration, hardcoded order columns) with values parameterised; no user input touches the interpolated identifier.
- **New regression test.** `tests/server/exports-unification.test.js` (8 tests) — pins that the four retired endpoints return 404, the four survivors return 200 with `Content-Type: text/csv`, and `/api/export/system-log/:source` rejects unknown sources with 404.

Files touched:
- `src/components/analytics/LogGrid.jsx` (new) — 280 lines, the shared grid.
- `src/components/analytics/ActivityTable.jsx` — rewritten as a 200-line column config + fetch + CSV header button.
- `src/components/analytics/SystemLogTable.jsx` — rewritten with a per-source export dropdown in the toolbar.
- `src/components/analytics/ChatLogTable.jsx` — rewritten with row-expand panel showing full content + provenance.
- `src/components/analytics/SessionsTable.jsx` (new) — replaces the inline ConfigPanel table.
- `src/components/settings/ConfigPanel.jsx` — `SystemLogs` function gutted: removed dead state, dead tab branches, the export grid, and the global date picker. Net −430 lines.
- `server/routes/analytics-routes.js` — four `/export/*` route registrations removed (~190 lines), replaced with a comment block documenting the canonical surface.
- `package.json` — `@tanstack/react-table` added.
- `tests/server/analytics-tna.test.js`, `tests/server/sessions-concurrency.test.js`, `tests/server/sql-injection-guard.test.js` — pre-existing brittleness fixed.
- `tests/server/exports-unification.test.js` (new) — 8-test regression guard.

Tests: full server suite `npx vitest run --no-coverage tests/server/` → 545 passing | 11 skipped | 0 failing. ConfigPanel.test.jsx → 17/17. New exports-unification → 8/8. Build green (`npx vite build`).

Smoke test: started `OYON_ENABLED=1 npm run dev`, logged in `admin/admin123`, opened Settings → System Logs, cycled all four viewers (Activity, Sessions, System Log, Chat Log), confirmed the chat-blank bug from HANDOFF #5 is no longer reproducible (chat panel + monitor both stay rendered after sending a message). The SessionsTable wrong-endpoint bug above was caught here, fixed, and re-verified.

Out of scope (deliberate):
- True server-side cursor pagination — current LogGrid still uses load-more increments (100 → 500 → 2000 → 10000) over the existing limit-based endpoints. Migrating to `WHERE id < cursor LIMIT N` is straightforward but every endpoint has different sort keys and would need its own contract.
- Reflection Questionnaire migration to LogGrid — its row shape is a variable-length nested object, not a flat row, so the current expand-on-click `<table>` stays.

### 2026-05-09 (late evening) — Unified learning-analytics logging (PLAN_LOGGING.md)

Two parallel event-logging systems coexisted — `event_log` (legacy, near-empty) and `learning_events` (modern xAPI, populated). The user reported "no student actions in the logs"; root cause was that the ConfigPanel "Event Log" tab read the empty legacy table while the populated modern table was on a sibling tab. PLAN_LOGGING.md folds both into one canonical pipeline with server-enforced trinity invariant. Codex round-1 flagged 3 issues (server-vs-client trinity authority, real CSV endpoint, legacy writer migration); round-2 flagged 5 fresh ones (drop-accounting contract, export DoS cap, regression-guard scope). Both reviews folded into v2 of the plan before code.

- **Phase 1 — server-enforced trinity.** New `resolveSessionTrinity(sessionId, tenant_id)` in `server/routes/_helpers.js`. `POST /api/learning-events` and `POST /api/learning-events/batch` now derive `(user_id, case_id)` from the sessions row; client-supplied values are ignored. Cross-tenant `session_id` is dropped, not silently mislabeled. Batch response shape: `{ inserted, dropped, total, dropped_reasons: { cross_tenant, missing_required_field, db_error } }`. `BackendSurface.js` strips `user_id`/`case_id` from the payload and surfaces drops via `console.warn` when `resp.dropped > 0`. Race fix: switched the batch insert loop to `Promise.all(runPromises).then(finalize)` so the response counter is correct.
- **Phase 2 — legacy writer migration.** Removed all production `INSERT INTO event_log`. Migrated `orders-routes.js:1383 lab_value_edited` to `learning_events` with new verb `EDITED_LAB_VALUE` (added to both server `LEARNING_VERBS` allowlist and client `VERBS`/`VERB_METADATA`). Dropped redundant dual-write at `orders-routes.js:1170 investigation_ordered`. Deleted obsolete `apiPost('/events/batch', …)` from `ChatInterface.jsx:749`. Retired the `POST /events/batch` route handler; kept the table itself for `_helpers.js` purge code. New regression guard `tests/server/event-log-deprecation.test.js` greps for any new `INSERT INTO event_log` outside an explicit allowlist.
- **Phase 3 — bug fixes + minor instrumentation.** `eventLogger.js:319 caseLoaded()` now calls `setContext({ caseId })` so mid-session case switches re-stamp the singleton. `BackendSurface` flushes immediately on `ENDED_SESSION` and on cleanup so logout / NotificationProvider re-key doesn't drop the last batch. Added `EventLogger.log('CLICKED', 'button', …)` on the logout button so the act of logging out is itself recorded.
- **Phase 4 — single canonical viewer.** Deleted `src/components/monitor/EventLog.jsx`. Removed the `events` tab from `ConfigPanel.jsx` (button, content branch, session selector state, `EventLog` import, test mock). Renamed `Activity Log` tab to `Learning Analytics` — `<SessionLogViewer showAllSessions={true} />` is now the single surface for every recorded action.
- **Phase 5 — real CSV export endpoint.** New `GET /api/export/learning-events` (admin → tenant-wide, non-admin → self). Filters: `from`, `to`, `user_id`, `case_id`, `session_id`, `verb`. Soft cap 50k rows; admin override `?confirm_large=1` raises to 200k; beyond that returns `413` with a hint. `Content-Disposition: attachment` and `Content-Type: text/csv`. RFC-4180-compliant CSV serializer (`csvEscape` helper). Joins `users`/`cases` for `username`/`case_name` so the CSV is self-contained. New "Learning Analytics (xAPI)" button added to the export grid in `ConfigPanel.jsx`; `downloadCSV()` updated to use `from`/`to` (instead of `start_date`/`end_date`) for this endpoint and to surface the structured `hint` from 413 responses.
- **Phase 6 — tests.** 12 new tests covering the trinity invariant, CSV completeness, RFC-4180 escaping (incl. embedded newline), tenant scoping, deprecation guard. Adjacent suites (`oyon-routes`, `retention-purge`, `analytics-tna`, `ConfigPanel.test.jsx`) all green at 70/70.

Codex round-3 (post-implementation diff review) returned `ship-with-fixes` with 5 findings; all folded in:
- **Access policy alignment** — `/api/export/learning-events` now uses `canReadAcrossUsers` (reviewer+) instead of admin-only, matching the existing `/api/learning-events/all` rule.
- **Try/finally around the batch insert** — `dbAdapter.prepare` + `Promise.all(runPromises)` + `stmt.finalize` are wrapped so a thrown promise can no longer leak the prepared statement nor leave the request hanging.
- **`sendBeacon` fallback** — when `navigator.sendBeacon` returns `false` (queue full or payload too large), `BackendSurface.js` now falls back to a `fetch` with `keepalive: true` so the last batch on logout/unload isn't dropped silently.
- **Tenant predicates on JOINs + spreadsheet-injection guard** — CSV export's `LEFT JOIN users` and `LEFT JOIN cases` now require matching `tenant_id`; `csvEscape` prefixes a single quote when a cell starts with `=`, `+`, `-`, `@`, `\t`, or `\r` (Excel/Calc/Numbers formula safety).
- **Wording correction** — `PLAN_LOGGING.md` now distinguishes the user's quoted goal phrasing from the honest concrete scope (~50 already-instrumented + ~25 listed verbs, not literally every keystroke).

Files touched:
- `server/routes/_helpers.js` — `resolveSessionTrinity` helper.
- `server/routes/analytics-routes.js` — single + batch endpoints rewritten; export endpoint added; `/events/batch` route deleted; `LEARNING_VERBS` extended.
- `server/routes/orders-routes.js` — `lab_value_edited` migrated to `learning_events`; redundant `event_log` dual-write dropped.
- `src/notifications/surfaces/BackendSurface.js` — payload trimmed; ENDED_SESSION immediate-flush; flush-on-unmount.
- `src/services/eventLogger.js` — `caseLoaded` re-stamps context; `EDITED_LAB_VALUE` verb added.
- `src/components/chat/ChatInterface.jsx` — redundant `/events/batch` POST removed.
- `src/components/settings/ConfigPanel.jsx` — events tab deleted; activity tab renamed; xAPI export button added; `downloadCSV` extended.
- `src/components/settings/ConfigPanel.test.jsx` — stale `EventLog` mock removed.
- `src/App.jsx` — logout click logged.
- `tests/server/learning-events-trinity.test.js` (new), `tests/server/learning-events-export.test.js` (new), `tests/server/event-log-deprecation.test.js` (new).
- `src/components/monitor/EventLog.jsx` — **deleted**.

Out of scope (deferred to follow-up): the remaining ~20 nice-to-have UI instrumentation points (scenarioStarted/Paused/Stepped, recordOpened/Edited, settingsOpened, etc.); dropping the `event_log` table itself; promoting `dbAdapter` to support `each` for true streaming exports.

Tests: `npx vitest run --no-coverage tests/server/learning-events-{trinity,export}.test.js tests/server/event-log-deprecation.test.js` → 12/12 passing. Adjacent regression: `oyon-routes`, `retention-purge`, `analytics-tna`, `ConfigPanel.test.jsx` → 70/70 passing.

### 2026-05-09 (evening) — Oyon: Learning Analytics surface + Codex audit fixes (round 2 + round 3)

Round 2 closed Codex's first 8 enterprise-review findings:
- Consent ownership: `POST /consent` and `POST /emotion-records` now require `String(session.user_id) === String(req.user.id)`. Educators/admins can no longer write into student sessions.
- Worker claim removed from `vite.config.js` and widget comments — inference is honestly main-thread until a worker path lands. `DEFAULT_RUNTIME.sample_interval_ms` reverted 333→500. Migration `0015` flips existing 333 rows.
- `OyonR/src/core/EmotionRuntime.js` gained `dispose()` (releases ONNX, MediaPipe, nulls refs). Widget calls it in `CaptureSession.stop()`. Overlay snapshot.
- `Dockerfile` copies `OyonR/` before `npm install` and into the runtime stage. `Caddyfile` adds `handle /oyon/*`, `handle /standalone/*`, `handle /api/addons/oyon*` so the `/rohy/` SPA base doesn't break root-absolute Oyon URLs.
- Migration `0016` partial unique index `(tenant_id, session_id, record_id) WHERE record_id IS NOT NULL`. Insert uses `ON CONFLICT … DO NOTHING`. Response shape `{ ok, inserted, skipped }`.
- Widget passes the full runtime config (`aggregate_window_ms`, `min_valid_frames`, `smoothing_alpha`, `min_hold_ms`, `switch_confidence`) to `EmotionRuntime`, not just model + interval.
- `consent_version` on every record is server-authoritative (uses the consent row's value, ignores client).

Round 3 closed Codex's follow-up 4 findings:
- `insertEmotionRecord` now derives a stable `record_id` from `sha1(tenant|session|window_start|window_end)` when the client omits one — replays from the runtime/widget actually dedupe (the partial unique index was previously dormant on null-id rows). 2 new tests cover the no-record_id replay path.
- `Caddyfile` rewritten honestly: it's internal-only, with manual-edit instructions for auto/off. The misleading multi-mode env claim removed from both Caddyfile and `compose.yml`.
- `OyonR/standalone/standalone-demo.js` adds `rohyFetch` helper that copies `rohy_csrf` cookie into `X-CSRF-Token` for non-GET requests (consent + emotion-records POSTs). Overlay updated.
- Standalone runtime teardown switched from `runtime.stop()` to `runtime.dispose()` + null in both replace and final-stop paths. Overlay updated.

### 2026-05-09 — Oyon: emotion-pill latency root-causes (Codex review pass)

- `src/components/oyon/OyonCaptureWidget.jsx`: live pill word now derived from `topLabel(p.probabilities)` per sample. Previous code read `p.dominant`, a field the runtime never emits — the displayed word only updated when a 10s `window` event arrived. Result: emotion label now updates at sample cadence (~3 Hz) like the rest of the live stats.
- `OyonR/src/inference/OnnxEmotionClassifier.js` + `scripts/oyon-overlay/src/inference/OnnxEmotionClassifier.js`: `configureOrt` now picks `min(4, navigator.hardwareConcurrency)` wasm threads when `crossOriginIsolated`, instead of forcing `numThreads = 1`. Without this, WebGPU-disabled hardware silently fell back to single-threaded wasm even after we enabled SharedArrayBuffer. Snapshotted into the overlay tree so `npm run oyon:update` keeps it.
- `server/security-headers.js`, `vite.config.js`: added `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` on every response. Required for SharedArrayBuffer (and therefore multi-threaded ONNX wasm). Vite dev server mirrored.
- `server/routes/oyon-routes.js` `ensureSettings()`: now INSERTs every runtime field from `DEFAULT_RUNTIME` instead of relying on the SQL column DEFAULTs from migration 0012. Prevents fresh tenants from regressing to the laggy 1Hz sampling default that 0013 only patched in existing rows.
- `migrations/0013_oyon_settings_default_interval.sql`: new — bumps existing rows from `sample_interval_ms = 1000` → `333` (only touches rows still on the old default).
- `server/routes/oyon-routes.js` `DEFAULT_RUNTIME`: `sample_interval_ms` lowered from 1000 → 333.
- Tests: build green; benchmark via Playwright + ORT direct shows per-inference 23–76ms (avg 36ms) on the HSE model with 4 wasm threads + WebGPU + cross-origin isolation.

### 2026-05-09 — Oyon: tenant-level capture-engine config + idempotent upstream sync

- `migrations/0012_oyon_settings_runtime.sql`: new — adds `model_profile`, `sample_interval_ms`, `window_ms`, `min_valid_frames`, `smoothing_alpha`, `min_hold_ms`, `min_switch_confidence` to `oyon_settings` with safe defaults.
- `server/routes/oyon-routes.js`: surfaces `runtime` block in `GET /config`; accepts + clamps the new fields in `PUT /settings`; structured logging on every route.
- `src/components/oyon/modelProfiles.js`: new — single source of truth for the model profile registry (HSE / MobileViT / MBF). Used by miniature + admin dropdown.
- `src/components/oyon/clientLogger.js`: new — tagged client-side logger (`[oyon]`) used across the integration.
- `src/components/oyon/OyonCaptureWidget.jsx`: waits for `/config.runtime` before preload; picks model + sample interval from tenant settings; consent POST gated on `localStorage['oyon.defaultConsent']`; structured `oyonClientLog` calls throughout.
- `src/components/settings/OyonSettingsTab.jsx`: new "Capture engine" admin subsection with Model dropdown + 6 numeric knobs (sample interval, window, min valid frames, smoothing α, min hold, switch confidence). Imports `CONSENT_PREF_KEY` from the widget for single-source-of-truth.
- `src/components/oyon/OyonAnalyticsView.jsx`, `oyonCaptureWorker.js`: deleted (dead code).
- `OyonR/standalone/standalone-demo.js`: `applyRohyTenantConfig()` now fetches `/api/addons/oyon/config` and overrides locally cached settings, locking the in-page model dropdown when `?source=rohy`.
- `scripts/apply-oyon-patches.mjs`: new — copies overlay files from `scripts/oyon-overlay/` into `OyonR/`. Idempotent; fails loud if upstream restructured destination dirs.
- `scripts/oyon-overlay/`: new tree — `standalone/index.html`, `standalone/standalone-demo.js`, `standalone/logs-dashboard.js`, `src/inference/MediaPipeFaceTracker.js`.
- `scripts/update-oyonr.sh`: rsync now excludes `/standalone/vendor` (so 64MB of MediaPipe/ONNX bundles survive the sync) and calls the overlay patcher post-rsync.
- Tests: build green; migration runner + cors + logger tests 43/43; migration 0012 applies cleanly to dev DB and adds defaults.
