# System logs

Use this page to find what happened, who did it, and to prove the record
has not been tampered with. All log access requires the **admin** role and
is tenant-scoped — you see only your own tenant's records.

Endpoints are in the [users API reference](/reference/api/users) (audit)
and the [analytics API reference](/reference/api/analytics) (chat).

## Activity / audit log

The audit log records security- and data-relevant actions: user
create/edit/delete/purge, tenant create and assignment, platform-setting
changes, force-logout, exports, and more. Each entry carries the actor,
the action, the resource, before/after values where relevant, the source
IP, and a timestamp.

View it under the admin tools (the audit-log view). It is served by the
`/api/admin/audit-log` and `/api/system-audit-log` endpoints — the second
is an alias for audit scripts and enterprise integrations.

### Verify the audit chain

The audit log is a tenant-scoped hash chain. To prove it has not been
altered, run the verify action (`/api/admin/audit/verify`). It returns:

- **ok** — whether the chain is intact.
- **lastVerifiedId** — the last row that verified.
- **brokenAt** — the first row where the chain breaks, if any.

A non-`ok` result with a `brokenAt` means rows were modified or deleted
out of band. Treat that as an integrity incident.

## Chat log

The chat-log feed surfaces patient/agent conversation activity for review.
It is admin-only and served by `/api/chat-log/feed`
([analytics API reference](/reference/api/analytics)). Use it to review
how trainees interacted with the simulated patient and to spot prompt or
content issues.

## API / usage logs

Rohy keeps usage records for the metered surfaces:

- **LLM usage** (`llm_usage`) — per-call model usage.
- **TTS usage** (`tts_usage`) — per-call voice synthesis usage.

These back the analytics views and are anonymized when a user is purged
(target `user_id` set to NULL) and finally removed by the retention
sweep. Operational request logging (NDJSON access log, slow-query,
request-id correlation) is an operator concern — see the Operator section
for observability.

## Exports

Every export is recorded in `export_records` with the user who ran it, the
export type and format, the resource type and ids, record count, file
name and size, the filters applied, and a timestamp.

- View export history at `/api/admin/export-records`.
- A new export is registered at `/api/admin/export-records`
  ([users/admin API reference](/reference/api/admin)).

Use the export history to answer "who downloaded what, when, with which
filters" during an audit.

## Redaction

Anything that leaves the server — including log responses and support
bundles — passes through `server/redaction.js`. Credential and
scope-controlled PII fields are stripped centrally. Never reintroduce a
raw key or token into an export or bundle by hand; if a new sensitive
field exists, it must be registered in the redaction policy, not deleted
at the call site. The redaction policy is documented in the Security
section.
