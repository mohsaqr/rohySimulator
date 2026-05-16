# Platform settings

Platform settings are the deployment-wide knobs an admin controls in
**Settings → Platform**. They are stored in the `platform_settings` table
and every change is audited. This page covers what is actually
configurable; LLM and voice keys have their own pages.

All platform-settings writes require the **admin** role. Endpoints are in
the [admin API reference](/reference/api/admin).

## Investigation turnaround

"Turnaround" is the wall-clock time from ordering a lab or imaging study
to its result being available. The sim runs on compressed pacing, so the
platform default is short:

- **Default turnaround:** 3 minutes (`DEFAULT_TURNAROUND_MINUTES`).

Turnaround is resolved per order with a fixed priority (highest first):

1. Student clicked **Order instantly** (0 minutes — always wins).
2. The case is pinned to instant results by the educator.
3. An explicit per-order value.
4. A per-test value (the lab/radiology catalogue row).
5. The case-level default turnaround.
6. The platform default (3 minutes).

You set per-test defaults in the lab and medication editors
([Lab &amp; medication editors](/admin/catalogue-editors)); educators set
case-level and instant behavior in the case editor. There is no single
global override beyond the catalogue defaults — the platform value is the
final fallback only.

## Notification routing

Open **Settings → Platform → Notifications &amp; Alarms**. This is the
central control for every notification surface — there is no parallel
toast or banner system. What you can set:

- **Do Not Disturb** — silences every notification except clinical
  critical alarms.
- **Pause for…** — temporarily mute for a chosen interval.
- **Hide notifications below** a severity threshold.
- Per-source toggles (which notification sources are enabled).
- **Audio**, **Top banner**, and **Console (dev)** surfaces on/off.
- **Patient speaks alarm changes** and alarm **Volume**.
- Per-patient alarm **frequency**.
- Alarm **Default duration**.
- **Diagnostic bar** visibility.

There is a reset that restores notification preferences to defaults while
keeping snoozed and acknowledged state.

## User field configuration

Open the **user field configuration** under **Settings → Platform**. This
controls which profile fields are presented and required when accounts are
created. It is stored as the `user_field_config` platform setting and is
read by the user-creation screens.

## Facility / deployment identity

Rohy does not expose a free-form "facility name" platform setting. What
identifies a deployment is its **tenant** (slug + display name) — see
[Multi-tenant operations](/admin/multi-tenant) for creating and naming
tenants. Treat the tenant as the unit of deployment identity, not a
separate facility field.

## Where the values live

Every platform setting is a key in `platform_settings` with the admin who
last changed it and a timestamp. The full list is visible via the
platform-settings endpoint ([admin API reference](/reference/api/admin)).
Credential-bearing settings are redacted in audit output by
`server/redaction.js` — never paste a raw key into a support bundle.
