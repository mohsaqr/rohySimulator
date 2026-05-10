# Update strategy for rohy

> **Audience:** maintainers, contributors, future-you. The "why" behind
> the update tooling. Operators reading this for the first time should
> start at [`UPDATING.md`](UPDATING.md) — that's the manual; this is the
> design doc.

---

## Constraints that shaped this design

These came from the project owner explicitly and shape every other choice
below. If you disagree with one, the rest of the strategy needs revisiting.

| Constraint | Implication |
|---|---|
| Downtime of 1-2 hours per update is acceptable | No blue-green, no nginx retry magic, no canary. Standard restart is fine. |
| Backup is essential | Backup-before-everything, integrity-checked, retained per policy. Non-negotiable. |
| Single-instance deploy per site | No multi-writer DB concerns. SQLite stays. |
| No fleet operated by maintainer | No central control plane, no auto-update push. Operators pull. |
| But many third parties may self-host | Update tool must be operator-friendly: explicit, reversible, well-documented. Releases must be verifiable. |

This puts rohy in the **single-operator self-hosted app** category alongside
Mastodon, Plausible, Vaultwarden, Sentry self-hosted. Not in the
fleet-managed SaaS category (Tailscale clients, Chrome auto-update).

---

## Goals and non-goals

### Goals

1. **Operator confidence.** They press one command, the tool handles the
   rest, and they trust it because they understand it.
2. **Backup before mutation.** Every state-changing operation creates a
   verified, timestamped, restorable snapshot first.
3. **Atomic deploys.** Either the new version is fully running and verified,
   or the old version is fully running. Never half-way.
4. **One-command rollback.** From "this update was bad" to "I'm on the
   previous version" in under a minute.
5. **Forward-compatible migrations.** The previous release can always run
   against the schema produced by the next release, until at least one
   release later.

### Non-goals

1. **Zero-downtime.** Acceptable downtime budget is hours, not seconds.
2. **Fleet management.** No multi-site dashboard, no centralized rollout.
3. **Auto-update.** Operators decide when. No timer, no cron, no surprise.
4. **Telemetry.** Tool does not phone home about anything.
5. **Operating-system management.** Updating Node, Python, system packages
   is the host's distro responsibility.

---

## Subsystem architecture

Five subsystems, each with a single responsibility:

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                                                                 │
   │   bin/rohy-update         ← operator-facing CLI                 │
   │   ┌──────────────┐                                              │
   │   │ check        │  → reads git, MANIFEST.md                    │
   │   │ apply        │  → orchestrates everything below             │
   │   │ rollback     │  → reads /var/lib/rohy/rollback/last         │
   │   │ list/restore │  → reads $ROHY_BACKUP_DIR                    │
   │   └──────────────┘                                              │
   │         │                                                       │
   │         ↓                                                       │
   │   ┌──────────────────────────────────────────────────────┐      │
   │   │  scripts/rohy-backup.sh    ← backup automation       │      │
   │   │  - sqlite VACUUM INTO                                │      │
   │   │  - integrity_check                                   │      │
   │   │  - manifest.json + env + migrations.lst              │      │
   │   │  - retention sweep                                   │      │
   │   └──────────────────────────────────────────────────────┘      │
   │                                                                 │
   │   ┌──────────────────────────────────────────────────────┐      │
   │   │  migrations/MANIFEST.md   ← migration policy         │      │
   │   │  - per-migration: additive | destructive | unknown   │      │
   │   │  - destructive multi-release procedure documented    │      │
   │   └──────────────────────────────────────────────────────┘      │
   │                                                                 │
   │   ┌──────────────────────────────────────────────────────┐      │
   │   │  scripts/tech-test.sh     ← post-deploy verifier     │      │
   │   │  - readiness wait (60s)                              │      │
   │   │  - liveness, API surface, auth, security headers     │      │
   │   │  - non-zero exit fails the apply                     │      │
   │   └──────────────────────────────────────────────────────┘      │
   │                                                                 │
   │   ┌──────────────────────────────────────────────────────┐      │
   │   │  docs/UPDATING.md         ← operator manual          │      │
   │   │  - the page third parties actually read              │      │
   │   └──────────────────────────────────────────────────────┘      │
   │                                                                 │
   └─────────────────────────────────────────────────────────────────┘
```

Each subsystem is independently usable. Operators can run
`scripts/rohy-backup.sh` ad-hoc without `rohy-update`. Maintainers can
classify migrations in `MANIFEST.md` without changing the CLI.
`tech-test.sh` runs standalone (and already does, as the deploy.sh
`POST_VERIFY` hook on the SaqrServer hub).

---

## The four pillars and how each is delivered

| Pillar | Mechanism | Subsystem |
|---|---|---|
| **Atomicity** | Transactional steps; any failure rolls back automatically; lockfile prevents concurrent runs | `rohy-update apply` |
| **Backup** | `sqlite3 VACUUM INTO` consistent snapshot + manifest + integrity check | `scripts/rohy-backup.sh` |
| **Reversibility** | Per-apply rollback recipe (`/var/lib/rohy/rollback/<sha>.json`) recording from-sha + snapshot path | `rohy-update apply` writes; `rollback` reads |
| **Verifiability** | Migration dry-run before real apply; `tech-test.sh` after restart; auto-rollback on either failure | `migrate.js --dry-run` + `tech-test.sh` |

---

## Migration safety policy

Lives in `migrations/MANIFEST.md`. Summary:

- **Default: additive-only.** Adding tables, columns (with default/null),
  indexes — always allowed.
- **Destructive changes** (DROP, RENAME, type narrow, add NOT NULL without
  default): split across **at least three releases** so any release can run
  against any adjacent release's schema.
- **The CLI enforces the manifest:** `apply` refuses if a pending migration
  isn't classified, and refuses destructive without `--allow-destructive`
  + interactive confirmation.

This is the same approach Mastodon uses (see their
[v4 destructive migration notes](https://github.com/mastodon/mastodon/blob/main/CHANGELOG.md))
and what Postgres-shop SREs call ["expand and contract"](https://martinfowler.com/bliki/ParallelChange.html).

---

## Trust and supply-chain

### What v1 does

- Operator's local repo tracks `origin/main` (or pinned ref via
  `ROHY_UPDATE_BRANCH`).
- `apply` does `git fetch + checkout <target>` inside that already-trusted
  clone.
- `npm ci` is lockfile-strict — exact versions from `package-lock.json`,
  no surprise upgrades.
- If the github remote is compromised, the operator gets compromised code.

### What v2 (Phase D) will add

- Releases tagged on github (`v0.4.2`, etc.) instead of "always main."
- Each release ships:
  - `rohySimulator-vX.Y.Z.tar.gz` — full source archive
  - `*.sha256` — checksum
  - `*.sig` — detached signature (GPG or sigstore)
  - `RELEASE_NOTES.md` — human-readable changes + migration notes
  - `MANIFEST.json` — version metadata, min-supported-from-version
- `rohy-update apply` verifies signature + sha256 before checkout.
- Maintainer publishes their public key once; operators pin it in
  `/etc/rohy/update.conf`.

This blocks the `event-stream` / `xz-utils` / `eslint-scope` class of
supply-chain attack: a compromise of the github remote OR npm registry
won't propagate to operators with signature verification on.

**Decision deferred to Phase D**: GPG vs sigstore. GPG is more familiar to
ops audiences; sigstore is keyless (no long-lived private key for
maintainer to protect). Recommendation: **sigstore + cosign**, with a fallback
to GPG only if there's a specific operator audience that requires it.

---

## Phased roadmap

| Phase | Scope | Status (2026-05-10) |
|---|---|---|
| **A** | `scripts/rohy-backup.sh` + retention | ✅ delivered |
| **B** | `migrations/MANIFEST.md` policy + classification | ✅ delivered (all 18 existing migrations classified) |
| **C** | `bin/rohy-update` v1: check / apply / rollback / list / restore | ✅ delivered |
| **C-followup** | Wire `update.conf` into `bootstrap.sh` so fresh installs include the symlink + a default config | ⏳ next session |
| **D** | Github Releases pipeline: tags + signed artifacts + `MANIFEST.json` per release; `rohy-update` verifies | ⏳ planned |
| **E** | `docs/UPDATING.md` — operator manual | ✅ delivered |
| **F** | Off-site backup integration in `update.conf` (rclone preset) — optional | ⏳ documented in `UPDATING.md`, not yet first-class |
| **G** | In-app release-notes display ("a new version is available — see release notes") | ⏳ future |
| **H** | Litestream for continuous DB replication (point-in-time recovery, not just per-deploy) | ⏳ optional luxury |

Done in this session: A, B, C, E.

Recommended next: C-followup + D, in that order. C-followup is half a day
of `bootstrap.sh` editing; D is 1-2 days of github-actions + signing setup.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Operator runs `apply` on a sick install | Medium | Pre-flight checks `is-active --quiet`; refuses if not |
| Disk fills mid-apply | Medium | Pre-flight requires 3× DB size free at backup dir |
| Migration dry-run passes, real apply fails | Low | Auto-rollback on any failure including post-restart verify; rollback restores DB snapshot |
| Concurrent `rohy-update` invocations | Low | `flock` on `/var/lock/rohy-update.lock` |
| Bad release tag on github | Medium | v1: human reviews `rohy-update check` output; v2: signed releases catch tampering, not bugs |
| Operator skips multiple releases | High | `MANIFEST.json` per release will carry `min_supported_from_version`; v1 refuses unknown migrations |
| Maintainer key compromise (Phase D+) | Catastrophic | sigstore-keyless removes long-lived key; rotation procedure in docs |
| Operator runs `rollback` after destructive migration | High if not gated | `rollback` reads `destructive` flag from rollback recipe, refuses; `restore-backup` is the explicit alternative |

---

## Reference implementations consulted

These shaped concrete decisions, not just inspiration:

| Project | What we borrowed |
|---|---|
| **[Plausible self-hosted](https://plausible.io/docs/self-hosting)** | The "one upgrade page, three commands" UX shape. UPDATING.md aims for this length and tone. |
| **[Mastodon admin docs](https://docs.joinmastodon.org/admin/upgrading/)** | The "before you upgrade" framing; migration-notes-per-release pattern in MANIFEST.md. |
| **[Vaultwarden](https://github.com/dani-garcia/vaultwarden/wiki/Updating-the-vaultwarden-image)** | Single-binary update story — keep the operator surface minimal. |
| **[Discourse upgrade procedure](https://meta.discourse.org/t/upgrade-discourse-to-the-latest-version/3805)** | The "explicit destructive-action acknowledgment" pattern (`--allow-destructive` + filename confirmation). |
| **[Litestream](https://litestream.io/)** | The model for SQLite continuous backup (Phase H, when ready). |
| **[Kamal](https://kamal-deploy.org/)** | The transactional-deploy step ordering (snapshot → stop → checkout → build → migrate → start → verify → rollback-on-fail). |
| **[Sigstore](https://www.sigstore.dev/how-it-works)** | The keyless signing pattern for Phase D. Used by Kubernetes, npm provenance. |
| **[The Update Framework (TUF), §3](https://theupdateframework.io/specification/latest/)** | Threat model framing for Phase D risk register. |
| **[Sentry self-hosted install.sh](https://github.com/getsentry/self-hosted/blob/master/install.sh)** | Reference for "what a real-world install/upgrade script for a multi-component app looks like." |

---

## Things explicitly NOT in this strategy

These have come up in discussions; recording why they're out:

1. **Blue-green deploy** — solves zero-downtime, which isn't a goal.
   Adds significant complexity (two systemd units, nginx upstream
   shuffling, SQLite read-only-inactive coordination). Skip.
2. **Auto-update timer** — operator-driven only. A self-hosted app pushing
   updates without consent burns trust faster than the convenience saves
   anyone time.
3. **Multi-site fleet dashboard** — out of scope per the constraints.
   If/when rohy gets used in a coordinated multi-site way, revisit.
4. **Postgres migration** — SQLite is the right call for the target
   deployment shape. Reconsider only when forced (multi-writer concurrency
   or replication needs that aren't covered by Litestream).
5. **Container-image-based updates** (a la Kamal) — deferred. The current
   docker path uses `compose` with `image: rohy:latest`; switching to
   immutable-image-per-release is a separate redesign. Note the implication:
   today's docker users effectively get rolling builds, not signed releases,
   until Phase D resolves how docker fits in.
6. **Rolling secret rotation** — JWT_SECRET rotation, API key rotation —
   these are operationally important but not the same problem as code/schema
   updates. Separate doc when ready.

---

## Glossary

- **Apply**: a state-changing run of `rohy-update apply`, going from one
  git sha to another, with associated migrations.
- **Snapshot**: a point-in-time copy of the DB + env + version metadata,
  living under `/var/backups/rohy/`.
- **Manifest** (two senses):
  - `migrations/MANIFEST.md` — the migration policy doc.
  - `<snapshot>/manifest.json` — metadata about a specific snapshot.
- **Rollback recipe**: the JSON at `/var/lib/rohy/rollback/<sha>.json`
  recording what an apply did, used to undo it.
- **Additive migration**: schema change such that previous-release code can
  still run unchanged.
- **Destructive migration**: schema change that breaks previous-release code.
- **Forward-compatible**: a migration is forward-compatible if both the
  previous AND the next release can read its post-state.

---

*Last updated: 2026-05-10. Phase A/B/C/E delivered. Next priority: C-followup
(bootstrap integration) and D (signed releases).*
