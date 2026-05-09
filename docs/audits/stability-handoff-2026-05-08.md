# Stability Handoff - 2026-05-08

Scope: stability only. This handoff summarizes the audit findings, fixes applied, verification status, and remaining work. Main audit document: `docs/audits/stability-audit-2026-05-08.md`.

## Current State

- Production build passes with the documented `/rohy/` base.
- Deploy smoke coverage was improved to catch frontend asset 404s, not just HTML 200s.
- Fresh/unconfigured TTS now defaults to Kokoro instead of Piper, matching the default deploy paths that do not install Piper.
- Explicit Piper settings still route to Piper and still require a Piper binary plus `.onnx` voices.
- Relevant Docker/Caddy deploy issues from `/Users/mohammedsaqr/Downloads/AGENT-NOTE-SQLITE-V6-UPGRADE-2026-05-08.md` were applied: internal TLS default, TTS subpath routing, and CORS origin normalization.
- The sqlite3 v6 Docker base-image item from that note was not applied because this checkout still declares `sqlite3: ^5.1.7`.
- Relevant low-risk cleanup from `/Users/mohammedsaqr/.gemini/tmp/rohysimulator/memory/AGENT-NOTE-VOICE-DEPLOY-2026-05-08.md` was applied: frontend voice/avatar demographic slot logic now uses one shared helper.
- Full stability gate is not green yet. Remaining blockers are documented below.

## Changes Made In This Handoff Window

### Asset-aware deploy smoke

File changed:
- `scripts/smoke.sh`

What changed:
- Keeps `/api/health` and `/api/ready` checks.
- Fetches frontend HTML.
- Extracts the first built JS and CSS asset references from `index.html`.
- Resolves relative assets against `BASE_URL`.
- Resolves absolute `/...` assets against the deploy origin.
- Fails smoke if referenced frontend assets return non-200.

Why:
- A direct Express run with a `/rohy/` build can return HTML 200 while JS/CSS 404 and the app is blank.
- The documented nginx/Caddy deploy strips `/rohy/` before Express, so local/direct test runs must either build with `--base=/` or use the deploy proxy shape.

### TTS default provider stability

Files changed:
- `server/routes/proxy-routes.js`
- `src/utils/voiceResolver.js`
- `src/components/settings/VoiceSettingsTab.jsx`
- `src/components/settings/AgentPersonaEditor.jsx`
- `src/components/settings/CaseAvatarVoicePicker.jsx`
- `src/utils/voiceResolver.test.js`
- `src/components/settings/CaseAvatarVoicePicker.test.jsx`

What changed:
- Added server `DEFAULT_TTS_PROVIDER = 'kokoro'`.
- `/api/tts/voices` now uses Kokoro when `tts_provider` is unset.
- `/api/tts` now uses Kokoro when `tts_provider` is unset and no request override is provided.
- Client voice resolution now defaults to Kokoro.
- Voice settings and persona/case editor UI now present Kokoro as the default/fallback path ahead of Piper.
- Tests were updated to lock the new contract.

Why:
- `deploy/local-install.sh` skips Piper by default.
- Docker compose defaults `INCLUDE_PIPER=0`.
- Piper has no built-in voice fallback because it depends on host-installed `.onnx` files.
- The previous implicit Piper default could point a fresh install at a missing engine.

### Audit documentation

Files changed:
- `docs/audits/stability-audit-2026-05-08.md`
- `docs/audits/stability-handoff-2026-05-08.md`

What changed:
- Added STAB-010 for the Piper default mismatch.
- Added STAB-011 for Docker Caddy TLS and TTS subpath routing.
- Added STAB-012 for `FRONTEND_URL` CORS origin normalization.
- Marked the smoke-check and TTS default fixes as implemented.

### Docker Caddy deploy fixes

Files changed:
- `deploy/docker/Caddyfile`

What changed:
- Removed invalid `auto_https {$ROHY_AUTO_HTTPS:on}` interpolation.
- Enabled `tls internal`, matching the compose default `ROHY_TLS_MODE=internal`.
- Changed `/rohy/api/tts*` from `handle_path` to `handle` plus `uri strip_prefix /rohy`.

Why:
- Caddy does not accept `on` as an `auto_https` value.
- The default Docker deploy says internal TLS but did not activate Caddy's internal CA.
- `handle_path /rohy/api/tts*` strips too much path and can route backend TTS calls as `/voices` instead of `/api/tts/voices`.

Skipped from the downloaded note:
- `deploy/docker/Dockerfile` `bookworm-slim` to `trixie-slim` was not changed because this checkout still uses `sqlite3@5.1.7`, not `sqlite3@6`.

### CORS origin normalization

Files changed:
- `server/cors-config.js`
- `tests/server/cors-config.test.js`

What changed:
- `buildAllowedOrigins()` now converts `FRONTEND_URL` to `new URL(FRONTEND_URL).origin`.
- Added a regression test for a pathful `FRONTEND_URL` such as `https://rohy.example.com/rohy`.

Why:
- Browser `Origin` headers do not include path components, but `FRONTEND_URL` is documented as the full `/rohy` app URL.

### Voice/avatar demographic helper

Files changed:
- `src/utils/demographics.js`
- `src/utils/resolveAvatar.js`
- `src/utils/voiceResolver.js`
- `src/utils/voiceCatalogue.js`
- `src/components/settings/CaseAvatarVoicePicker.jsx`
- `src/components/chat/ChatInterface.jsx`

What changed:
- Added one shared frontend helper for female detection and demographic slot derivation.
- Routed voice resolution, avatar resolution, voice catalogue filtering, the case voice picker, and chat TTS slot selection through that helper.

Why:
- The voice deploy note flagged duplicated demographic bucketing as a drift risk. The logic was equivalent today, so this is a low-risk consolidation rather than a behavior change.

Skipped from the voice deploy note:
- Adding a backend endpoint for fallback voices was skipped because it is a larger API contract change.
- Mirroring stale avatar warnings into every editor was skipped because it is UI surface work, not a current stability failure.

## Verification Completed

Passed:

```bash
bash -n scripts/smoke.sh
npx vitest run --project=client src/utils/voiceResolver.test.js src/components/settings/VoiceSettingsTab.test.jsx src/components/settings/AgentPersonaEditor.test.jsx src/components/settings/CaseAvatarVoicePicker.test.jsx
npx vitest run --project=server tests/server/services/voiceFallbacks.test.js tests/server/audio/provider-smoke.test.js
npx vitest run --project=server tests/server/cors-config.test.js
npx vitest run --project=server tests/server/tts-route.test.js
npx vitest run --project=client src/utils/voiceResolver.test.js src/utils/avatarResolutionMatrix.test.js src/utils/voiceCatalogue.test.js src/components/settings/CaseAvatarVoicePicker.test.jsx src/components/chat/ChatInterface.test.jsx src/components/chat/ChatInterface.behavior.test.jsx
npm run build
```

Smoke behavior checked manually:
- Direct Express serving of `/rohy/` production build failed smoke because JS/CSS assets returned 404.
- Rebuilding with `npx vite build --base=/` and copying `dist/` to `frontend/` made direct Express smoke pass.
- Normal `npm run build` was rerun afterward to restore the standard `/rohy/` deploy artifact.

Build caveat:
- `npm run build` passes but still emits existing large chunk warnings for the main bundle and `PatientAvatar`.

Not verified locally:
- Caddyfile syntax/runtime was not validated with `caddy validate` because `caddy` is not installed in this environment.

## Known Remaining Stability Findings

### STAB-002 - Cookie auth CSRF/logout instability

Status: open.

Evidence from audit:
- E2E cookie refresh/logout tests saw 403 `"CSRF token missing"`.
- Logs also showed `active_sessions.token_hash` unique constraint warnings on repeated logins.

Next step:
- Reproduce with `tests/e2e/cookie-auth.spec.js`.
- Inspect refresh/logout CSRF token source and cookie clearing behavior.
- Make repeated login/session writes idempotent or de-duplicate token hashes.

### STAB-003 - SQL static guard failure

Status: open.

Evidence from audit:
- `tests/server/sql-injection-guard.test.js` fails on `server/routes/analytics-routes.js:1603`.
- The flagged pattern is `where: \`WHERE ${clauses.join(' AND ')}\`` in `buildLearningEventWhere()`.

Important:
- `server/routes/analytics-routes.js` already had uncommitted user changes before this stability work. Do not revert those changes.

Next step:
- Rewrite the helper so the guard can prove the query shape is safe, or add a narrow allowlist only if the interpolated clauses are server-controlled placeholders.

### STAB-004 - E2E auth rate-limit interference

Status: open.

Evidence from audit:
- RBAC/tenant e2e specs failed with 429 auth rate limits.

Next step:
- Under `NODE_ENV=test`, isolate auth rate-limit buckets or relax limits for Playwright runs.
- Rerun RBAC and tenant specs after the change.

### STAB-005 - Scenario HR read failed under invalid asset serving mode

Status: needs rerun.

Evidence from audit:
- `readHR(page)` returned `null` during a local e2e run that also had frontend asset 404s.

Next step:
- Rerun with the CI build shape:

```bash
npx vite build --base=/
rm -rf frontend
mkdir -p frontend
cp -r dist/* frontend/
npm run test:e2e
```

### STAB-006 - Explicit Piper TTS request timed out

Status: partially mitigated.

What changed:
- Unset provider now defaults to Kokoro.

Still open:
- Explicit Piper requests still depend on local Piper install and voice files.
- E2E path that explicitly sets `tts_provider='piper'` should be revisited to ensure missing/slow Piper returns a controlled response inside the test budget.

### STAB-007 - Full test run contention-sensitive timeouts

Status: open.

Evidence:
- `tests/server/catalogue-0007.test.js` and `tests/server/db-direct-access.test.js` timed out in full run but passed isolated.

Next step:
- Rerun full test without concurrent lint/build.
- If still flaky, increase timeout or split slow DB/static-analysis tests into a less contended project.

### STAB-009 - Lint gate too noisy

Status: open.

Evidence:
- `npm run lint` failed with 952 errors and 44 warnings during audit.

Next step:
- Either scope lint configs correctly for server/scripts/tests or burn down the backlog until lint can protect stability again.

## Worktree Notes

Uncommitted changes that were present before this stability work and should not be reverted:
- `server/routes/analytics-routes.js`
- `src/components/analytics/tna/tnaUtils.js`
- `src/components/analytics/tna/tnaUtils.test.js`
- `tests/server/analytics-tna.test.js`
- `src/components/analytics/tna/tnaREquivalence.test.js`

Changes from this stability work:
- `deploy/docker/Caddyfile`
- `scripts/smoke.sh`
- `server/cors-config.js`
- `server/routes/proxy-routes.js`
- `src/components/chat/ChatInterface.jsx`
- `src/components/settings/AgentPersonaEditor.jsx`
- `src/components/settings/CaseAvatarVoicePicker.jsx`
- `src/components/settings/CaseAvatarVoicePicker.test.jsx`
- `src/components/settings/VoiceSettingsTab.jsx`
- `src/utils/demographics.js`
- `src/utils/resolveAvatar.js`
- `src/utils/voiceCatalogue.js`
- `src/utils/voiceResolver.js`
- `src/utils/voiceResolver.test.js`
- `tests/server/cors-config.test.js`
- `docs/audits/stability-audit-2026-05-08.md`
- `docs/audits/stability-handoff-2026-05-08.md`

## Recommended Next Order

1. Fix STAB-003 so server test gate can go green despite the analytics route change.
2. Fix STAB-002 cookie refresh/logout and repeated-login session warning.
3. Isolate e2e auth rate limits under test mode.
4. Rerun browser e2e with `--base=/` build shape.
5. Recheck explicit Piper e2e behavior and decide whether the test should install Piper, skip if missing, or assert a controlled 503.
