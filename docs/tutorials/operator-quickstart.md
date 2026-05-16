# Operator quickstart

Bring Rohy up on your laptop for local development in about ten minutes.
This is the local-dev happy path only. For single-machine, systemd, Docker
or air-gapped installs and for production hardening, follow the full
operator pages — links are below.

::: tip Reference
Env vars, CLI flags and exit codes are single-sourced in
[Config & env](/reference/config/) and [CLI & ops](/reference/cli/). Terms
like *additive migration* and *snapshot* are in the
[Glossary](/reference/glossary).
:::

## Prerequisites

- **Node.js 22.x** (npm 10.x is bundled).
- **curl** + network for the post-install Oyon model download (~93 MB).
- A modern browser.

Full prerequisite matrix and OS notes:
[Install → Prerequisites](/operator/install#prerequisites).

## 1. Clone and install

```bash
git clone https://github.com/mohsaqr/rohySimulator.git
cd rohySimulator
npm install
```

`npm install` also runs `postinstall`, which fetches the Oyon emotion
models (~93 MB). If it ran without network, fetch them later with:

```bash
npm run setup:oyon
```

## 2. Configure the environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at least `JWT_SECRET` — the server refuses to
start without it.

## 3. Run the app

```bash
npm run dev
```

This runs the backend (`npm run server`) and frontend (`npm run client`)
together.

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:3000`
- **Default seeded users**: `admin` / `admin123`, `student` / `student123`
  — refused in production unless `ALLOW_DEFAULT_USERS=1`. Change them before
  any real user touches the box.

The server runs migrations and seeders automatically on boot, so the
database is created, schema-applied and populated the first time it starts.
Full local-dev notes: [Install → Local development](/operator/install#local-development).

## 4. (Optional) Run migrations and seeders by hand

The server does both on boot, so you do not normally need this. To run them
as standalone steps — for example with `ROHY_NO_AUTO_SEED=1` on the server
process:

```bash
node scripts/migrate.js --dry-run    # prove pending migrations parse, zero writes
node scripts/migrate.js              # apply pending migrations
node scripts/seed.js                 # idempotent one-off seed
```

`node scripts/seed.js` is idempotent — every seeder is guarded, so running
it twice does not duplicate rows. To also seed the six acute scenarios:

```bash
node server/scripts/seed-acute-cases.cjs
```

See the [acute-cases walkthrough](/tutorials/walkthrough-acute-cases) for
what those cases contain. Migration dry-run, additive-vs-destructive policy
and the `ROHY_DB` override: [Migrations runbook](/operator/migrations).

## Going to production

This quickstart stops at local dev. For a real deployment:

- [Install](/operator/install) — single-machine, systemd, Docker, air-gap
- [Deploy & harden](/operator/deploy) — TLS, reverse proxy, security checklist
- [Updating](/operator/updating) — `bin/rohy-update` and rollback
- [Backup & restore](/operator/backup-restore) ·
  [Observability](/operator/observability) ·
  [Incident playbooks](/operator/incidents)
