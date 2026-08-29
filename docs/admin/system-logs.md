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

## Timestamps and time zones

**Every timestamp rohy stores is UTC**, in one shape:
`2026-08-29T12:34:56.789Z`. Every timestamp rohy *shows you* is in your own
browser's time zone. So the same event legitimately reads as 15:34 for an
administrator in Helsinki and 14:34 for one in Madrid — the record is identical,
only the rendering follows the reader.

Exports carry the stored UTC value, not the rendered local one, so a CSV opened
in another country is still the same instant.

### If you are looking at logs recorded before v2.9.93

Older rows were written in two different shapes. Both were UTC, but one of them
did not say so, and that had two visible effects:

- **Some rows rendered a few hours out.** How many hours depended on the reader's
  own zone and on whether the date fell inside daylight saving.
- **Rows could appear in the wrong order**, including rows a full day apart.

Both are fixed. The upgrade rewrote the stored values into the single shape — a
reformat only, not a reinterpretation: every instant is the same instant it
always was, and no value moved. If you had exported a log before upgrading and
noticed times that did not line up with the chat beside them, re-export it.

### One column is deliberately left alone

The audit log's own `timestamp` is inside its tamper-evident hash, so rewriting
it — even to a better format — would make every historical row fail
verification. The chain cannot tell a reformat from a forgery, and that is
exactly the property it exists to have. Audit rows therefore keep their original
text, and the audit view sorts and filters on a derived column instead. You will
not see a difference; the chain still verifies.

### Which clock recorded what

Two clocks contribute to the record, and rohy is explicit about which:

| | |
|---|---|
| **The server's clock** | authoritative for every stored timestamp |
| **The learner's device clock** | recorded alongside, in `client_time`, never used for ordering |

A browser's clock cannot be verified, and a device set a few hours wrong used to
drag a learner's whole session away from the chat turns beside it — which looked
exactly like a genuine overnight resume. Now the server times the record and
keeps the device's claim next to it, so a wrong device clock shows up as a
difference between two columns rather than as a plausible-looking session at the
wrong hour.

The *spacing* between a learner's actions is still theirs: each event reports how
long before it was sent it happened, and the server preserves those gaps exactly.
Time-on-task and sequence analysis read the gaps, and they are unaffected.

## Where Activity-view rows come from

The Activity view is a merge of fourteen sources, each labelled by its
`component` column, not a single table:

| Component | Source | What it tells you |
|---|---|---|
| `audit` | `system_audit_log` | security- and data-relevant actions (hash-chained) |
| `learning` | `learning_events` | everything a learner did, including plugin rooms |
| `client` | `client_logs` | errors and diagnostics reported by the browser |
| `auth` | `login_logs` | logins, failed logins, logouts |
| `config` | `settings_logs` | setting changes, with before/after |
| `chat` | `interactions` | raw chat turns |
| `alarm` | `alarm_events` | monitor alarms raised and acknowledged |
| `llm` | `llm_request_log` | model calls, tokens, cost, latency |
| `tts` | usage records | speech synthesis calls |
| `emotion` / `oyon` | `emotion_logs`, `oyon_emotion_records` | affect signals, where consented |
| `vitals` | `session_vitals` | every monitor sample |
| `scenario` | `scenario_events` | scenario beats fired by the engine |
| `plugin` | `plugin_jobs` | **server-side plugin work** — see below |

### Plugin activity

A plugin contributes in two distinct ways, and they land in different rows.

**What a learner does in a plugin room** — opening a slide, panning, submitting a
report — arrives as `learning` rows, exactly like a core room. The verbs come
from the plugin's own manifest, so a plugin adds vocabulary without any change to
rohy. Nothing special is needed to see them: filter on the room.

**What a plugin's server does** — importing and tiling a slide, and every failure
of one — arrives as `plugin` rows. Before v2.9.93 this half was invisible: an
import that ran for four minutes left a job record that no log view read, so the
only trace was the learner's click that started it. If an import has ever seemed
to vanish, this is the view that now shows you where it went, including the phase
it was in and the reason it failed.

Operational plugin work is deliberately **not** recorded as learner activity. An
administrator importing a slide is not a learner studying one, and counting it as
such would corrupt the analytics it was meant to enrich.

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
