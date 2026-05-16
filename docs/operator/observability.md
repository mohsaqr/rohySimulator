# Observability

What Rohy emits at runtime — the NDJSON access log, slow-query
warnings, request-id correlation — and the env knobs that control it.

::: tip Reference
The `ROHY_LOG_*` and `ROHY_SLOW_QUERY_MS` env vars are single-sourced
in [Config & env](/reference/config/). Terms are locked in the
[Glossary](/reference/glossary).
:::

---

## NDJSON structured log

Rohy writes one JSON object per line to **stdout** (NDJSON). Each entry
carries a `timestamp`, `level`, `event`, and event-specific fields:

```json
{"timestamp":"2026-05-16T03:00:00.000Z","level":"warn","event":"slow_query","request_id":"...","operation":"all","duration_ms":142.5,"threshold_ms":100,"sql":"SELECT ... FROM ... WHERE ... = ?"}
```

On a systemd box this goes to the journal — read it with:

```bash
sudo journalctl -u rohy -f                 # follow
sudo journalctl -u rohy --output=cat       # raw NDJSON, pipe to a shipper
```

In Docker:

```bash
docker compose logs -f rohy
```

To ship it: pipe `journalctl --output=cat` to your SIEM / Loki / S3.
If you do **not** ship logs, set `ROHY_LOG_LEVEL=warn` so the box isn't
spending I/O on `info`/`debug` lines nobody reads.

---

## Log levels

`ROHY_LOG_LEVEL` controls the floor. Entries below the configured level
are dropped before serialization (cheap — no wasted work):

| Level | Numeric | Use |
|---|---|---|
| `debug` | 10 | Per-query SQL summaries. Noisy — dev / incident only. |
| `info` | 20 | Default. Lifecycle + notable events. |
| `warn` | 30 | Slow queries, degraded paths. Recommended prod floor if not shipping logs. |
| `error` | 40 | Failures only. |

An unrecognised value falls back to `info`.

---

## Slow-query log

Every SQLite query is timed. If a query exceeds the threshold a
`slow_query` warning is emitted with the **sanitized** SQL (string and
numeric literals replaced with `?`, whitespace collapsed, truncated to
500 chars — so the log never leaks row data), the duration, the
threshold, the operation, and the `request_id`.

Threshold resolution, in order:

1. `ROHY_SLOW_QUERY_MS` env var (if a finite number >= 0)
2. **Platform Settings** — `slow_query_ms` (then
   `observability_slow_query_ms`) in `platform_settings`
3. **Default: 100 ms**

Setting `ROHY_SLOW_QUERY_MS` pins the threshold and **disables** the
Platform-Settings override (env wins). Lower it temporarily during a
latency investigation, raise it back after.

---

## Request-id correlation

Every request gets an id (from the inbound `X-Request-Id` header if it
matches the expected pattern, otherwise a generated UUID). The id is:

- propagated back on the response so the caller can correlate,
- carried in an async-local context for the life of the request,
- stamped onto every `slow_query` and per-query debug log line as
  `request_id`.

So a slow page is one `grep` away from every SQL statement it ran:

```bash
sudo journalctl -u rohy --output=cat \
  | grep '"request_id":"<the-id>"'
```

Replace `<the-id>` with the id from the response header or the error the
user reported.

### Paths excluded from access logging

`ROHY_LOG_SKIP_PATHS` (default `/api/proxy/llm,/health`) is a
comma-separated list of paths excluded from the access log. The LLM
proxy is excluded by default because the request body contains the full
prompt — do not remove it from the skip list unless you have a redaction
shipper in front. A trailing `*` matches by prefix; otherwise the path
matches exactly or as a path segment.

---

## A quick health pulse

For "did the last deploy break something?" the in-memory Oyon health
endpoint gives per-endpoint 4xx/5xx counts for the last 5 min / 1 hour
without parsing logs:

```bash
curl -ksS https://your-host/rohy/api/addons/oyon/admin/health \
     -H "Authorization: Bearer $TOKEN" | jq
```

Detail and the operator-gate rules are in
[Deploy & harden § Live operator dashboard](/operator/deploy#deploy-verification-live-monitoring).

---

## Related

- [Deploy & harden](/operator/deploy#deploy-verification-live-monitoring) — the deploy verifier and health endpoint
- [Retention & purges](/operator/retention) — how the audit/log tables age out
- [Incident playbooks](/operator/incidents) — using request-id and slow-query during a latency incident
