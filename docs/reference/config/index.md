# Config &amp; environment reference

Every environment variable Rohy reads, scanned **from source** across `server/**`, `bin/**`, and `scripts/**`, cross-referenced against `server/config/validateEnv.js` for required-ness and recommended-in-production hints.

::: tip Regenerate
This page is generated. Do not hand-edit. Re-run `npm run docs:gen:config` after changing env usage or the validator.
:::

::: warning Security-sensitive variables
The following variables carry credentials or signing material. Never commit them, log them, or expose them to the browser. Store them in the operator env file with restricted permissions:

- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_TTS_API_KEY`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `ROHY_ADMIN_PASSWORD`
- `ROHY_PASSWORD`
- `ROHY_TOKEN`
:::

## Core server

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `HTTPS_PORT` | No | — | HTTPS listen port (used when TLS cert/key are set). | `server/server.js:54` |
| `NODE_ENV` | No | `development` | Runtime mode; `production` tightens defaults and enables prod-only validation. | `server/logger.js:40`<br>`server/logger.js:41`<br>`server/middleware/csrf.js:50`<br>_+10 more_ |
| `PORT` | No | — | HTTP listen port. | `server/server.js:46` |

## Auth/security

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ALLOW_DEFAULT_USERS` | No | — | Bootstrap-only flag to seed default users on first boot. | `server/seeders/users.js:107` |
| `JWT_EXPIRY` | No | `4h` | Lifetime of issued JWTs. | `server/middleware/auth.js:321` |
| `JWT_SECRET` | Yes | — | Secret used to sign/verify auth + audit tokens. Fatal if unset. _Fatal if unset (validateEnv pushes an error)._ **⚠ secret — see security note above.** | `server/middleware/auth.js:16` |
| `ROHY_ADMIN_EMAIL` | No | — | Email for the provisioned first admin. Defaults to &lt;username&gt;@rohy.local. | `server/seeders/users.js:54` |
| `ROHY_ADMIN_NAME` | No | — | Display name for the provisioned first admin. Defaults to "System Administrator". | `server/seeders/users.js:55` |
| `ROHY_ADMIN_PASSWORD` | No | — | Password for the provisioned first admin. Must satisfy the normal password policy or the seeder refuses it. **⚠ secret — see security note above.** | `server/seeders/users.js:53` |
| `ROHY_ADMIN_USERNAME` | No | — | Provisions the first admin on first boot (with ROHY_ADMIN_PASSWORD). Applied only while the users table is empty. | `server/seeders/users.js:52` |
| `ROHY_DISABLE_AUTH_RATE_LIMIT` | No | — | Disables the auth-endpoint rate limiter (dev/test). | `server/routes/auth-routes.js:64` |
| `ROHY_TOKEN` | No | — | _see source_ **⚠ secret — see security note above.** | `scripts/llm-language-smoke.mjs:47`<br>`scripts/translate-locales.mjs:76` |
| `ROHY_TRUST_PROXY` | No | `loopback` | Express `trust proxy` setting (proxy hop count / IP / preset). | `server/server.js:63` |
| `TLS_CERT_PATH` | No | `'' (empty string)` | Path to TLS certificate; must be paired with `TLS_KEY_PATH`. _Conditionally required: if either of TLS_CERT_PATH / TLS_KEY_PATH is set, both must be._ | `server/routes/help-routes.js:130`<br>`server/server.js:55` |
| `TLS_KEY_PATH` | No | `'' (empty string)` | Path to TLS private key; must be paired with `TLS_CERT_PATH`. _Conditionally required: if either of TLS_CERT_PATH / TLS_KEY_PATH is set, both must be._ | `server/routes/help-routes.js:130`<br>`server/server.js:56` |

## Database

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_DB` | No | — | Absolute path to the SQLite database file. _Recommended in production (validateEnv warns when unset)._ _Recommended in production (DB otherwise lives inside the repo tree)._ | `scripts/import-loinc-mapping.js:108`<br>`scripts/migrate.js:10`<br>`scripts/nuke-30-tats.js:34`<br>_+7 more_ |

## Observability

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `LOG_FORMAT` | No | — | Access-log output format. | `server/logger.js:38`<br>`server/logger.js:39` |
| `LOG_LEVEL` | No | — | Server log verbosity. | `server/logger.js:27` |
| `ROHY_LOG_LEVEL` | No | `info` | Server log verbosity (Rohy-prefixed alias). | `server/logger.js:27`<br>`server/observability.js:17` |
| `ROHY_LOG_SKIP_PATHS` | No | — | Comma-separated request paths excluded from access logging. | `server/observability.js:46` |
| `ROHY_ROUTE_TIMEOUT_MS` | No | — | Per-route request timeout (ms). | `server/middleware/routeTimeout.js:38` |
| `ROHY_SHUTDOWN_GRACE_MS` | No | — | Graceful-shutdown drain window (ms). | `server/server.js:353` |
| `ROHY_SLOW_QUERY_MS` | No | — | Threshold (ms) above which a DB query is logged as slow. | `server/observability.js:22`<br>`server/observability.js:29` |
| `VERBOSE` | No | — | Extra console diagnostics when truthy. | `scripts/rocketbox-convert/convert.mjs:135` |

## Frontend/CORS

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `FRONTEND_URL` | No | — | Public frontend origin; drives CORS allow-list. _Recommended in production (validateEnv warns when unset)._ _Recommended in production (CORS rejects non-localhost origins when unset)._ | `server/server.js:75` |

## LLM/TTS

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API credential (LLM). **⚠ secret — see security note above.** | `server/routes/proxy-routes.js:379` |
| `GOOGLE_API_KEY` | No | — | Google API credential. **⚠ secret — see security note above.** | `server/services/googleTts.js:127` |
| `GOOGLE_TTS_API_KEY` | No | — | Google Text-to-Speech API credential. **⚠ secret — see security note above.** | `server/routes/admin-routes.js:1631`<br>`server/routes/admin-routes.js:1656`<br>`server/routes/admin-routes.js:1657`<br>_+2 more_ |
| `OPENAI_API_KEY` | No | — | OpenAI API credential (LLM / TTS). **⚠ secret — see security note above.** | `server/routes/admin-routes.js:1658`<br>`server/routes/admin-routes.js:1659`<br>`server/routes/proxy-routes.js:385`<br>_+2 more_ |
| `PIPER_BIN` | No | — | Path to the Piper TTS binary. | `server/services/ttsProviders.js:35` |
| `ROHY_TEST_FAIL_GOOGLE_TTS` | No | — | _see source_ | `server/services/googleTts.js:164` |
| `ROHY_TEST_FAKE_GOOGLE_TTS` | No | — | Test hook: stub Google TTS instead of calling the API. | `server/services/googleTts.js:172` |
| `ROHY_TEST_FAKE_KOKORO_TTS` | No | — | _see source_ | `server/services/kokoroTts.js:136` |
| `ROHY_TEST_FAKE_OPENAI_TTS` | No | — | Test hook: stub OpenAI TTS instead of calling the API. | `server/services/openaiTts.js:74` |

## Oyon

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `OYON_ENABLED` | No | — | Mounts the Oyon emotion-capture addon as a live router (vs 503 stub). | `server/routes.js:35`<br>`server/routes/help-routes.js:129` |

## Retention

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `RETENTION_DAYS` | No | — | Data-retention window in days for the retention sweep. | `scripts/retention-sweep.js:42` |
| `RETENTION_SECONDS` | No | — | Data-retention window in seconds (overrides days when set). | `scripts/retention-sweep.js:40` |
| `ROHY_RETENTION_DAYS` | No | — | Data-retention window in days (Rohy-prefixed alias). | `scripts/retention-sweep.js:41` |
| `ROHY_RETENTION_SECONDS` | No | — | Data-retention window in seconds (Rohy-prefixed alias). | `scripts/retention-sweep.js:39` |

## Update/deploy

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_BACKUP_BEFORE_MIGRATE` | No | — | Toggles the pre-migration DB snapshot. | `server/db.js:514` |
| `ROHY_NO_AUTO_SEED` | No | — | Skips automatic seeders on boot. | `server/db.js:44` |

## Uncategorized

| Variable | Required | Default | Purpose | Source |
| --- | --- | --- | --- | --- |
| `ROHY_BASE_URL` | No | `http://localhost:3000` | _see source_ | `scripts/llm-language-smoke.mjs:26`<br>`scripts/translate-locales.mjs:34` |
| `ROHY_LANGS` | No | `'' (empty string)` | _see source_ | `scripts/llm-language-smoke.mjs:108` |
| `ROHY_PASSWORD` | No | — | _see source_ **⚠ secret — see security note above.** | `scripts/llm-language-smoke.mjs:49` |
| `ROHY_USERNAME` | No | — | _see source_ | `scripts/llm-language-smoke.mjs:48` |

---

_45 variables discovered. Generated by `scripts/docs-gen/gen-config.mjs` — regenerate with `npm run docs:gen:config`._
