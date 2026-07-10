# Voice 2.0 — The Voice Owns Its Engine (Plan v1.1)

**Status:** ✅ IMPLEMENTED (2026-07-10), then AMENDED same day to **v1.4 —
SOVEREIGN CASE VOICES** (owner: "I want the case sound to be reigning
supreme"). v1.4 supersedes this document's fallback/substitution sections:

- **A configured voice is LITERAL.** If a case or persona names a voice, it
  plays on its own derived engine or the request fails with an honest error
  — no template stand-in, no default stand-in, no runtime retry onto
  another voice. The X-Rohy-Voice-* substitution headers and the server
  fallback tier described below were implemented and then REMOVED by v1.4.
- **Per-language defaults (`tts_default_voice_<lang>`) serve ONLY speakers
  with no voice configured at all** (client resolver tier 'default',
  announced via toast/editor note). Never cross-language, as before.
- **Rate/pitch freeze at authoring time:** picking a case voice pins the
  current platform rate/pitch into the case config, so later platform
  slider changes never alter an authored case.
- **Engine-off impact modal:** disabling an engine in Settings → Voice
  first shows the blast radius (GET /api/tts/voice-usage — every
  case/persona voiced on that engine, by name) with Disable-anyway/Cancel,
  because those voices will FAIL, not substitute.
- Cases also gained their own dialogue language (config.case_language →
  useCaseLanguageSync), which selects the default-voice row for
  unconfigured speakers and drives the LLM/STT language.

See CHANGES.md (2026-07-10 entries) for the file-by-file record. Original
proposal text below, kept as design rationale — read it with the v1.4
amendments above in mind.

Supersedes `audio_improve.md` (Plan v3) as the primary design. Carries v3's
truth clause and instrumentation forward; replaces v3's core routing rule
AND (v1.1) v3's settings model.
- **Codex adversarial audit (2026-07-09):** nominal "reject", all findings
  folded in as **[v1.2]**: complete `tts_provider` reader/writer table
  (§5.4 — High 1+2: server.js:274 boot seed, admin GET/PUT, five client
  hydration sites); disjointness contract lands as the first stage-1
  commit (Medium 2). Audit POSITIVELY cleared: `if_sara` ships in the
  installed kokoro-js (`node_modules/kokoro-js/voices/if_sara.bin`), and
  no `window.speechSynthesis` consumer exists — the `browser` provider is
  confirmed vestigial.
- **[v1.3] Owner clarification (2026-07-09):** the app is UNSHIPPED — no
  old clients exist, deployments update wholesale. All cross-version
  compatibility shims removed (the v1.2 stage-3 deferral of the key
  retirement, the served compatibility field, the R11 rollout windows);
  stages are PR ordering inside one release. The non-breaking obligation
  concentrates on the DB: idempotent migration + seeding, stored
  `case_voice` values keep working, zero manual steps on update (§5.4).
**Date:** 2026-07-09 (v1.1 — four owner directives; v1.2 — Codex audit
fixes; v1.3 — unshipped-app simplification)
**Owner directives, in the owner's words:**
1. *"If the case has local models, and they are installed, why would they
   fail? They are free. And if one has Google configured, why can't they
   just choose it?"* → provider-follows-voice routing (§4, §5.3).
2. *"Why do we have platform voice?"* → the platform engine setting
   (`tts_provider`) is **retired entirely** — no default-engine concept
   survives (§5.4).
3. *"I want defaults of kokoro, if paid ones fail"* + *"Configured voice
   providers, not a dropdown list"* → platform default voice(s) seeded
   from free local engines (Kokoro first), used whenever a paid engine
   fails — including at runtime, mid-class (§5.5); Settings → Voice shows
   providers as a configured-status list with on/off toggles, no selector
   (§6.4).
4. *"I am worried about the fail of paid ones, what if it is german?"* →
   the default is **per-language** and substitution **never crosses a
   language boundary**. Kokoro has no German/Finnish/Swedish; an English
   voice reading German text is garbled audio, worse than an honest error.
   A German case falls back to a German default voice (local Piper
   recommended) or fails loudly — never to `af_bella` (§5.5).

---

## 1. The pivot — what changes vs. Plan v3

Plan v3 (`audio_improve.md`) kept the May-2026 rule — one platform-wide
engine, everything else invalid — and softened its failure mode with four
per-provider default voices. Voice 2.0 rejects the premise:

- A Kokoro voice on an installed Kokoro is **free and playable**. Refusing
  to play `af_bella` because a dropdown says "google" is an artificial
  failure.
- A Google voice on a keyed deployment is **deliberately chosen and
  payable**. Forcing the whole platform onto Google to let one persona use
  a Chirp voice is an artificial restriction.

**Voice 2.0 rule: a voice plays on its own engine whenever that engine is
usable. There is no platform engine. There is one platform default voice —
a free local one — that plays whenever anything else can't.**

v1.1 note: v1 of this plan kept `tts_provider` as a demoted "default
engine" selecting among four per-provider default voices. The owner's
"why do we have platform voice?" exposed that as re-importing the concept
2.0 deletes. v1.1 replaces `tts_provider` + four per-**provider** defaults
with per-**language** defaults (`tts_default_voice_<lang>`, one per
registry language) — keyed by what the case actually needs (its language),
not by a dead engine concept. §4 of v3 records
the owner *rejecting* provider-follows-voice; that rejection was reversed
by the owner on 2026-07-09 ("I want voice 2.0"). This plan answers the
objections behind the original rejection head-on — §3.

## 2. Design principle

> **The voice owns its engine; the platform owns the wallet and the
> safety net.**

- **Routing** is derived from the voice id itself, by exact catalogue
  membership — never stored, never regex-in-production, never stale.
- **Policy** (cost control) is explicit: per-provider enable toggles.
  Local engines are free; cloud engines are badged and can be switched
  off platform-wide with one click.
- **Safety net:** one platform default voice **per registry language**,
  seeded from free local engines where one exists (Kokoro `af_bella` for
  en, `if_sara` for it), plays whenever the configured voice can't —
  including when a paid API fails mid-session. Substitution never crosses
  a language boundary: a language with no configured default fails loudly
  rather than playing garbled cross-language audio.
- **Truth clause** (unchanged from v3): any surface that shows a voice
  shows the engine it will play on, and any substitution is visible
  everywhere — headers, toast, editor labels, DiagnosticBar, boot audit.

## 3. Why this does not resurrect the saga

The 2026-05 collapse (migration `0022_voice_surface_collapse.sql`, resolver
header) blamed "too many places a voice/provider could be set". Autopsy of
the actual root causes, and how Voice 2.0 addresses each:

| Saga root cause | Voice 2.0 answer |
|---|---|
| Per-case/persona `tts_provider` **stored separately** from the voice id → the two went stale independently; old merge logic leaked dead engines | **No provider is stored anywhere, ever** — not per-case, not per-persona, and now not even at platform level. The engine is *derived* from the voice id at synthesis time by exact catalogue lookup. A value derived from the id cannot disagree with the id. Migration 0022's field-stripping stays in force. |
| **Silent substitution** — UI showed voice X, runtime played fallback Y, nothing admitted it | The runtime plays **exactly what the UI shows** in every healthy state. The unhealthy state (engine unusable or paid API down) uses v3's fully-instrumented substitution: `X-Rohy-Voice-Substituted` / `X-Rohy-Voice-Requested` headers, one-time toast, amber editor labels, requested→played in DiagnosticBar, boot audit. |
| **Regex as load-bearing router** (v1-audit objection to auto-routing) | The router is **exact catalogue membership** — the same per-provider validators `/api/tts` already uses for rejection (`resolveTtsVoice`, proxy-routes.js:1000). The id-shape regexes in `voiceResolver.js` remain a client-side pre-flight *hint* only. A CI contract asserts the catalogues are pairwise disjoint (§7.4). |
| **Cost leak** — a case bills Google while the admin believes the platform is free | Made explicit instead of impossible: per-provider **enable toggles** (§5.2); pickers badge every voice `free · local` / `paid · API`; per-provider usage rollups already exist (`tts_usage`, cost table at proxy-routes.js:972). No key ⇒ engine unusable ⇒ Google voices can't be picked or played. |
| **Multiple disagreeing validators** | One derivation function on the server (§5.1), reused by `/api/tts`, `/tts/voices`, the boot audit, and the settings PUT. The client consumes its *output* via the settings payload. |
| **"I changed it and nothing happened"** could recur as: admin flips the engine dropdown, nothing audibly changes (because voices keep their own engines) | **There is no engine dropdown to flip.** The setting that invited the stale mental model is gone (§5.4). The only voice-wide knob is "Default voice", whose copy says exactly when it plays. |

## 4. Behaviour matrix (the contract)

"Usable" = installed/keyed AND enabled (§5.2). "Default voice" = the
**language-matched** `tts_default_voice_<lang>` (§5.5): the language is
derived from the requested voice id (or the body `language` field when the
voice's language is underivable), and substitution never crosses it.

| Situation | Result |
|---|---|
| `af_bella` (kokoro) stored, kokoro installed | **Plays on Kokoro.** No toast, no substitution. The owner's headline case. |
| `en-US-Chirp3-HD-Aoede` (google) stored, google keyed+enabled | **Plays on Google.** Usage/cost recorded under google. Other personas in the same session keep their Kokoro voices. |
| google voice stored, google key removed or google disabled | Language-matched default plays; full visibility (headers, toast, amber label, boot audit). |
| en google/openai voice, engine usable, **API fails at request time** (quota, network, 5xx) | **Runtime fallback: en default (`af_bella`) plays** — same visibility chain, `substitutionReason:'provider_error'`. The class never stops. (§5.3 step 4.) |
| **`de-DE-…` google voice, google fails** (the owner's German worry) | de default plays (e.g. installed Piper `de_DE-thorsten`) with full visibility. **Never `af_bella`** — an English voice reading German text is garbled audio, not a fallback. |
| `de-DE-…` google voice fails, NO de default configured | Loud fail with an honest, language-aware message: "Google TTS failed and no German default voice is configured — install a Piper German voice or set one in Settings → Voice." Mute-with-truth beats nonsense audio. |
| kokoro voice stored, kokoro not installed / failed to load | Language-matched default plays (if playable on this box — §5.5 caveat) else today's loud fail. |
| voice in no catalogue (typo, removed voice) | Language from body `language` field → that default + visibility; none configured → loud 400 with `reason`. |
| nothing configured on persona/case | Case-language default, `substitutionReason:'not_configured'` (fixes v3's P4). |
| any voice via `/tts/preview` | Literal voice or error — preview never substitutes, never falls back. An admin auditioning a voice must hear THAT voice. |

## 5. Server design

### 5.1 Engine derivation — one function, exact membership

New `deriveVoiceProvider(voiceId)` in the TTS route layer (beside
`resolveTtsVoice`): checks the id against each provider's exact catalogue —
kokoro voice list, google list, openai list, piper installed `.onnx` files.
Returns `{ provider }` or `{ provider: null }` (unknown id).

- **Disjointness is a tested invariant**, not an assumption: kokoro
  `[abf][bfm]_name`, google `xx-XX-…`, openai closed lowercase list, piper
  `*.onnx`. CI contract in §7.4. (A hypothetical `af_bella.onnx` piper file
  stays disjoint from kokoro's `af_bella` — the suffix is part of the id.)
- **Tolerant on catalogue-check errors** (same stance as v3 §7.1.1): if a
  catalogue can't be checked (kokoro dynamic import fails on a box without
  it), that provider is unusable anyway — derivation falls through to the
  fallback tier, with the id-shape regex used only to *name* the likely
  provider in the log/toast message.
- Ordering: local catalogues first (cheap, no network); order is irrelevant
  for correctness given disjointness.

### 5.2 Provider usability + policy

Two orthogonal facts per provider, both surfaced to the client:

1. **Capability** (probed, not stored):
   - kokoro — model loads (`loadKokoro()` succeeds, not `KOKORO_DISABLED`);
     probe result cached process-lifetime (R10)
   - piper — `PIPER_BIN` exists and ≥1 `.onnx` installed
   - google — key present (`platform_settings.google_tts_api_key` or env
     `GOOGLE_TTS_API_KEY`; the `*_key_set` booleans already exist,
     admin-routes.js:1486)
   - openai — key present (env `OPENAI_API_KEY`, `openai_tts_api_key`, or
     platform LLM key when the LLM is OpenAI — openaiTts.js:51)
2. **Policy** (stored): new keys `tts_provider_enabled_<p>` for
   `kokoro|google|openai|piper`, flat scalars. **Seed: enabled (`1`)** —
   capability already gates cloud engines (no key ⇒ unusable), so the
   toggle's job is the deliberate "we're keyed for LLM work but voice must
   stay free" case. Global scope (v3's tenant declaration stands).

GET `/platform-settings/voice` gains
`providers: [{ id, capable, enabled, usable, reason }]` (usable = capable ∧
enabled; `reason` human-readable: "no API key", "model failed to load",
"disabled in settings"). This one payload drives pickers, resolver
validity, and editor labels — the client never re-probes.

### 5.3 `/api/tts` routing (the core change)

In `handleTtsSynthesis` (proxy-routes.js:1125), main route:

1. `deriveVoiceProvider(requestedVoice)` → provider found and usable →
   validate via existing `resolveTtsVoice`, synthesize **on that engine**.
   Existing synthesis branches are already parameterized by provider — the
   change is *which* provider is selected, not how synthesis works.
2. Provider missing/unusable → **fallback tier:** resolve the request's
   language — `voiceLanguage(requestedVoice)` (ported to
   `server/shared/` beside the language registry; it already derives
   `de` from `de-DE-…`, etc.), with the new optional body field
   `language` as the tiebreak when the voice's language is underivable
   (openai multilingual voices, unknown ids; clients already know the
   case language and start sending it in stage 2; absent ⇒ `en`). Then
   play `tts_default_voice_<lang>`, itself routed by derivation (it's
   just a voice). **Never substitute across languages.** Substitution
   headers `X-Rohy-Voice-Substituted` / `X-Rohy-Voice-Requested` set
   **before any provider branch** (v3 §7.1.3/R6); warn log; usage
   recorded for what actually played.
3. No default configured for that language, or the default itself
   unplayable → today's loud 400, body gains `reason:
   'no_default_for_language' | 'default_unplayable'` plus the language,
   so the client toast can say exactly what to fix.
4. **Runtime fallback (new in v1.1, owner directive):** when the chosen
   engine is a **paid API** (google/openai) and synthesis fails at request
   time, retry once with the **language-matched** default voice (same
   lookup as step 2) instead of erroring:
   - **WAV path:** the error is caught before any bytes are written (both
     catch blocks already check `res.headersSent`) — substitute and
     synthesize the default voice, headers + `provider_error` reason.
   - **Streaming path:** currently `pipePcmStream` flushes headers before
     the first upstream chunk exists, so a failure can't change course.
     Fix: **first-chunk pre-flight** — pull the first item from the
     provider's async iterator BEFORE flushing headers; on throw, swap to
     the default voice's stream. After the first chunk is flushed, a
     mid-stream failure ends the stream as today (can't unsay audio).
   - Retry is **once, to the default voice only** — no provider-hopping
     chains. If the default also fails, the existing error path stands.
   - The optimistic usage row for the failed paid call stays (Google/OpenAI
     bill on submission — comment at proxy-routes.js:1198); the fallback
     synthesis records its own $0 row.
5. Body `provider` stays ignored on the main route: the server derives the
   engine; the client cannot force one. `/tts/preview` keeps its explicit
   admin-only override (proxy-routes.js:1121) and is exempt from ALL
   fallback (§4 last row).

### 5.4 `tts_provider` is retired — complete site checklist

No default-engine concept survives. **[v1.3] Owner clarification: the app
has not shipped — there are no old clients in the wild, and deployments
update server+client wholesale.** So no cross-version compatibility shims
are needed; the three stages (§7.2) are PR ordering inside ONE release
that lands together before any deploy. What the Codex audit's blast-radius
list (High 1+2) remains as is a **completeness checklist** — every one of
these sites must be migrated or the release ships dead code / broken
hydration:

| Site | Role | Change |
|---|---|---|
| `proxy-routes.js:1145` (main route provider resolution) | routing | replaced by derivation |
| `proxy-routes.js:897` (`/tts/voices` no-arg fallback) | catalogue listing | replaced by all-providers response |
| `healthChecks/voiceCatalogueAudit.js:97` | audit's "active provider" | becomes per-voice derivation |
| `server.js:274` (boot seeding of the key) | seeding | removed; seeder now seeds `tts_default_voice_<lang>` + `tts_provider_enabled_<p>` instead |
| `admin-routes.js:1462/:1534` (voice settings GET/PUT) | settings contract | key dropped from both; new keys added |
| Client readers: `VoiceSettingsTab.jsx:63/121/177`, `AgentPersonaEditor.jsx:157/573/665`, `CaseAvatarVoicePicker.jsx:115`, `ChatInterface.jsx:1022`, `DiagnosticBar.jsx:362` | UI hydration | rewritten to providers payload + derivation |

**Non-breaking guarantee (owner directive):** existing *databases* are the
one deployed surface. The migration + boot seeder must be idempotent on
any current instance: stored `case_voice` values keep playing (better than
before — that's the feature), legacy settings rows are carried
over/retired automatically, and a DB from before this change boots into a
fully working state with zero manual steps. `tts_rate` / `tts_pitch` are
independent keys and stay. UI: no engine dropdown anywhere (owner
directive — §6.4).

The `browser` entry in `VOICE_TTS_PROVIDERS` appears vestigial: no
`window.speechSynthesis` call exists anywhere in `src/` (only
SpeechRecognition, for STT). Stage-1 checklist item: confirm by grep +
manual check, then drop `browser` from the provider list. If a real
consumer surfaces, it stays out of scope and unchanged.

### 5.5 Per-language default voices

One key per registry language: **`tts_default_voice_<lang>`** for every
language in `server/shared/languages.js` (today en/de/it/fi/sv), owned by
`/platform-settings/voice`. Rationale (owner's German worry): the fallback
must speak the case's language or not speak at all — Kokoro has NO
de/fi/sv, so a language-blind `af_bella` fallback would read German text
as English-shaped noise. Keys follow the registry: adding a language later
adds a row automatically, unseeded.

- **Seeds — only what a free local engine can actually SYNTHESIZE:**

  | Language | Seed | Why |
  |---|---|---|
  | en | `af_bella` (kokoro) | owner-directed; free, local |
  | it, de, fi, sv | *(none)* | **[implementation correction]** kokoro-js's runtime voice map is English-only (28 a/b-prefix voices) — the Italian `if_sara.bin` ships in the package but the model does NOT expose it, so the planned it seed was dropped (verified against a live model load, 2026-07-10). Can't assume Piper files either. Boot audit + settings row warn loudly (below); recommended fix is installing the Piper voice (`it_IT-riccardo`, `de_DE-thorsten`, `fi_FI-harri`, `sv_SE-nst` are the standard free ones) and picking it. |

  Seeding is INSERT-if-absent in the idempotent boot seeder (v3 §6.5
  home); never overwrites an admin's value. No computed "first installed
  voice" magic — stored values are always literal and inspectable.
- **Unseeded-language visibility:** for every registry language with no
  playable default, the boot audit emits `no_default_for_language`
  ("German cases have no fallback — a Google outage mutes them; install a
  Piper de_DE voice or set a default in Settings → Voice") and the
  settings row shows the same warning inline with the installed-Piper
  suggestion when one is detected. Loud and actionable, never silent.
- **Carry-over:** if legacy `default_voice_kokoro_female` /
  `default_voice_kokoro_male` rows exist (live keys per v3 §6): exactly
  one set, or both equal → carry into `tts_default_voice_en` instead of
  the seed; both set and different → seed + `tts_default_conflict`
  boot-audit warning (v3's rule; only the en seed can inherit a kokoro
  legacy value).
- **Migration SQL** (one file, ships with STAGE 3 per §5.4): DELETE legacy
  `default_voice_<provider>_<gender>` rows, DELETE `tts_provider`, and
  remove `PERSONA_DEFAULT_VOICE_KEYS` from the avatars endpoints
  (admin-routes.js:1439/:1636/:1685) — v3 §6 retirement, unchanged in
  spirit. Registered in `migrations/MANIFEST.md`. (Carry-over/seeding of
  the new keys is stage-1 boot-seeder logic and does not wait for this.)
- **PUT validation:** each default must be in SOME usable provider's
  catalogue AND speak its row's language (`voiceMatchesLanguage`; a
  definite mismatch rejects, `null`/unknown passes — same tolerance
  stance as v3 §7.1.1: "not found" rejects, "couldn't check" warns).
  Clearing (empty string) is allowed and restores loud-fail for that
  language. The settings UI nudges toward **local** voices: picking a
  paid voice as a safety net shows an inline hint ("a local voice makes
  the fallback immune to API outages") but is not blocked.
- **Caveat (R13):** on a box without Kokoro, even the seeded en default is
  unplayable — boot audit flags it (`default_unplayable`) and the settings
  row warns; behaviour is today's loud fail until the admin picks a
  playable default.
- **Boot audit** (v3 §7.1.5 adapted): audits every default against its own
  derived engine's catalogue, capability, and language match;
  stale-`case_voice` warnings say "will play default \"<X>\" until
  re-picked" when a playable language-matched default exists, else "has NO
  fallback (no <lang> default)".

### 5.6 `/tts/voices` — the multi-engine catalogue

Today it returns one provider's list (`?provider=` or platform setting,
proxy-routes.js:897). Change: **default response becomes all providers** —
`{ providers: [{ id, usable, reason, voices: [...] }] }`, unusable ones
included with empty `voices` and their `reason` so pickers render a
disabled group instead of a mystery absence. The single-provider
`?provider=` form stays for the settings tab's per-provider needs. (The
no-arg form's platform-setting fallback dies with `tts_provider`; grep for
consumers is a stage-1 checklist item.)

## 6. Client design

### 6.1 `resolveVoice()` — validity becomes "playable on any usable engine"

Same richer return shape as v3 §7.2.1 (`requestedFile`, `file`,
`substituted`, `substitutionReason`, `tier`), same template-tier fix for P3
(case invalid → template considered — validation inside the resolver, not
pre-merged at callsites). Changes vs v3:

- `provider` in the result = the **derived** engine of the resolved voice
  (from the settings payload's catalogue data), not a platform setting.
  Callers send voice-only payloads to `/api/tts` as today; the field is
  for display truth.
- Validity = "belongs to a usable provider" (usability from
  `voiceSettings.providers`, §5.2). `isVoiceValidForProvider` regexes stay
  as offline fallback pre-settings-load; the v3 §7.2.4 await-settings race
  fix applies verbatim.
- New tier: `tier:'default'` resolves to the **case-language** default
  (`tts_default_voice_<lang>` from the settings payload; the resolver
  gains a `language` input — callers already know the case language from
  the existing mismatch-warning work). No language-matched default →
  `tier:'invalid'` loud path with a language-aware message.
- Voice-mode sends add `language` to the `/api/tts` body (§5.3 step 2's
  tiebreak for multilingual/unknown voice ids).
- `substitutionReason` gains `'provider_error'` — set client-side only from
  the wire capture (the server decides runtime fallback; the client learns
  it from the response headers, §6.3).

Consumers (six + checklist grep): `ChatInterface.jsx`,
`useDiscussionEngine.js`, `DiagnosticBar.jsx`, `CaseAvatarVoicePicker.jsx`,
`AgentPersonaEditor.jsx`, test matrices.

### 6.2 Pickers — the "just choose it" experience

`CaseAvatarVoicePicker` and `AgentPersonaEditor` consume the all-providers
`/tts/voices` response:

- Voices grouped **Provider → Language**, engine badges: `Kokoro · free,
  on this server`, `Google · paid API`, etc.
- Unusable providers render as a disabled group with the `reason` line
  ("Google — add an API key in Settings → Voice to enable") —
  discoverable, not hidden.
- Picking a voice from any usable engine is a complete, valid choice. No
  platform change needed, no mute risk.
- The v3 amber substitution label appears only when the *saved* value's
  engine is currently unusable: "«en-US-Chirp3-HD-Aoede» can't play here
  (no Google API key) — the default voice «af_bella» will play."
- TestVoiceButton per row uses `/tts/preview` with the voice's derived
  provider — auditioning a Google voice works regardless of what other
  personas use.

### 6.3 Chat + wire truth — inherited from v3, one addition

Unchanged from `audio_improve.md`: one-time substitution info toast keyed
by `(requested, played, provider)` triple; honest error copy (P2);
`voiceService.ttsFetch()` wire-model extension reading both substitution
headers on streaming and WAV paths; DiagnosticBar requested→played
rendering. Additions:

- DiagnosticBar shows the **derived engine per request** (`af_bella →
  kokoro`), so mixed-engine sessions are legible at a glance.
- Runtime-fallback events (`provider_error`) get their own toast copy:
  "Google TTS is unavailable right now — playing the default voice
  af_bella." Same dedup triple.

### 6.4 VoiceSettingsTab — configured providers, not a dropdown

Owner directive. The tab becomes:

1. **"Configured voice providers"** — a status LIST (cards/rows), one per
   provider, no selector:
   - name + badge (`free · local` / `paid · API`),
   - capability line ("installed", "API key set", or the blocking reason
     with a link to fix it: key field, install hint),
   - enable toggle (`tts_provider_enabled_<p>`),
   - the existing key fields (google/openai) live inside their provider's
     card.
2. **"Default voices"** — one row per registry language (en/de/it/fi/sv),
   each a catalogue-populated select filtered to voices that speak that
   language (all usable engines, grouped, badged) + TestVoiceButton
   (preview-exempt). Copy: "Plays for <language> cases when the configured
   voice can't play on this server (missing engine, missing key, or a paid
   service outage). Platform-wide." Unconfigured rows show the §5.5
   warning + installed-Piper suggestion; inline hint favours local voices.
3. Rate/pitch controls unchanged.
4. `save()` builds its payload from the explicit field list
   (VoiceSettingsTab.jsx:118) — new keys added to state, payload, AND the
   GET-after-PUT round-trip test (v3's silent-drop trap).

The engine dropdown is deleted, and with it the "browser" option (§5.4).

## 7. Cross-cutting

### 7.1 i18n
v3 §7.3 keys, plus: engine badges, disabled-group reasons, enable-toggle
labels, provider-card status lines, default-voice copy + local-voice hint,
`provider_error` toast. en + de/it/fi/sv + pseudo-locale regen; existing
namespaces (chat.json, authoring_case.json, authoring_persona.json,
authoring_config.json).

### 7.2 Sequencing (three stages, tests green between)
**[v1.3]** The app is unshipped: the stages below are PR/commit ordering
inside ONE release (each with its tests green), not deployment phases —
nothing deploys between them, so no compatibility shims exist anywhere.
The whole release lands together; the only backward-compat surface is the
DB (§5.4 non-breaking guarantee).

1. **Server:** disjointness contract + `deriveVoiceProvider` land as the
   FIRST commit (the invariant exists before anything routes on it —
   Codex Medium 2), then usability probe + enabled keys, `/api/tts`
   re-route + fallback tier + runtime fallback (first-chunk pre-flight) +
   headers, `/tts/voices` all-providers shape, `tts_default_voice_<lang>`
   seeding/carry-over, boot audit, and the retirement migration (delete
   `tts_provider` + legacy gendered keys, §5.4 table server rows).
2. **Client resolver + consumers:** §6.1 shape, six consumers, race fix,
   toasts, wire-model extension, `language` body field on sends.
3. **UI + i18n:** pickers, VoiceSettingsTab rebuild, editor labels
   (§5.4 table client rows), translations, remaining test rewrites.

### 7.3 Explicitly out of scope
- No stored provider fields anywhere (migration 0022's strip is permanent).
- No qualified voice-id format (`kokoro:af_bella`) — derivation makes it
  redundant.
- No provider-hopping fallback chains — one retry, to the language-matched
  default voice.
- No per-tenant policy and no per-gender defaults — as v3. (Per-LANGUAGE
  defaults are now IN scope — §5.5, owner's German directive. Language
  remains a warning for *configured* voices; it becomes a hard boundary
  only for *substitution*.)
- No client-side (`browser`) TTS revival.

### 7.4 Tests
All of v3 §7.4 (nine contract rewrites — each rewritten to assert the new
truth obligation, never just deleting the old assertion — blind-spot
hardening, new coverage), adapted to one default voice, plus 2.0-specific:

- **Catalogue disjointness contract:** no id resolves to two providers.
  The invariant the router stands on.
- Route matrix over §4: kokoro voice + kokoro usable → 200 on kokoro
  (assert via branch spy/log), NO substitution headers; google voice + no
  key → default voice + headers; disabled = unusable; unknown id →
  fallback or honest 400 with `reason`.
- **Runtime fallback:** mocked google 500/timeout on WAV path → 200, kokoro
  default audio, both headers, `provider_error`; same on streaming path
  with the failure at first chunk (pre-flight) → default stream; failure
  AFTER first chunk → stream ends, no substitution (can't unsay audio);
  default-also-fails → original error semantics.
- **Language boundary (the German matrix):** failing `de-DE-…` voice + de
  default set → de default plays, headers present; de default NOT set →
  400 `no_default_for_language` with `language:'de'` — asserts `af_bella`
  is NEVER synthesized for a de request; underivable voice language
  (openai `alloy`) + body `language:'de'` → de lookup; body language
  absent → en lookup (legacy-client path); PUT rejects a definite
  language-mismatched default (en voice on the de row), accepts unknowns.
- Usage attribution: failed-paid-call row kept + $0 fallback row; mixed
  engines in one session record under each engine actually used.
- Seeding: fresh DB → `af_bella`; legacy kokoro gendered value carried
  over; conflict → seed + `tts_default_conflict`; admin value never
  overwritten; legacy rows + `tts_provider` deleted.
- `/tts/voices` all-providers shape: usable/unusable groups, reasons,
  `?provider=` back-compat.
- Picker: non-default-engine voice pickable, saves, round-trips, no warning
  while usable; warning appears when its engine is disabled.
- Resolver: full tier matrix incl. `tier:'default'` to the single default;
  validity via providers payload; regex fallback pre-settings.
- VoiceSettingsTab: no dropdown rendered; provider cards show
  capability/toggle; default-voice save/GET round-trip.

## 8. Risks (v3's R1–R7 still apply to the fallback tier)

R8. **Catalogue collision breaks derivation** — CI disjointness contract
    turns it into a build failure, not a runtime bug.
R9. **Cost surprise via mixed engines** — educator picks Google voices
    while the admin thinks voice is free. Mitigations: enable toggles,
    paid badges, per-provider usage rollups. Residual risk accepted by
    owner (this *is* the feature).
R10. **Kokoro cold-load latency** on the first fallback utterance (google
    outage → af_bella needs the model loaded). The capability probe must
    not force a full model load on every settings GET (cache
    process-lifetime); optionally warm the default voice's engine at boot
    since it IS the safety net — stage-1 decision.
R11. **[v1.3] Rollout-window risks are void** — the app is unshipped;
    server and client land as one release, so Codex High 2 (stale client
    hydration) and Medium 1 (missing `language` field on legacy sends)
    have no window to occur in. What survives of them: the §5.4 site
    checklist (every listed reader must be rewritten in-release, enforced
    by a repo-wide grep for `tts_provider` returning zero hits outside
    migrations/history at release end) and the `language`-absent server
    default (⇒ `en`) as a defensive path for direct API callers.
R12. **Runtime fallback masks a dying paid account** — quota exhaustion now
    sounds like a voice change instead of an outage. Counterweights: warn
    log per event, `provider_error` toast names the failing provider, boot
    audit + provider card show key status; usage dashboard shows the paid
    engine flatlining.
R13. **Default unplayable on kokoro-less boxes** — seeded `af_bella` can't
    play on a google-only deployment; loud fail persists there until the
    admin picks a playable default. Boot audit + settings warning name it
    explicitly (§5.5). Accepted: no silent computed defaults.
R14. **Unseeded languages (de/fi/sv) keep the mute-on-outage risk** until
    an admin installs a Piper voice or sets a default — the exact scenario
    the owner raised can still occur on an unconfigured deployment.
    Accepted trade-off vs playing cross-language garble; mitigations: the
    `no_default_for_language` boot audit fires from day one on every
    deployment with German content, the settings row shows the fix, and
    deployment docs gain a "multilingual = install Piper voices" step.
    The residual failure is honest (named language, named remedy), not
    silent.

## 9. Acceptance criteria

1. **The owner's sentence holds:** a case with `af_bella` on a box with
   Kokoro installed plays `af_bella` — no toasts, no substitutions, no
   admin action, regardless of any other setting.
2. A persona saved with a Google Chirp voice plays it whenever a Google key
   is configured and Google is enabled, while other personas keep their
   free Kokoro voices in the same session; the usage panel shows the split.
3. **Paid failure never mutes an English case:** kill the Google key
   mid-session (or mock a Google 500) ⇒ the patient's next utterance plays
   `af_bella`, with toast, headers, amber editor label, warn log, and
   requested→played in the DiagnosticBar. Restore the key ⇒ the Chirp
   voice returns. No DB row changed at any point.
4. **Paid failure never garbles a German case:** same outage on a
   `de-DE-…` case ⇒ the configured German default (e.g. Piper thorsten)
   plays with the same visibility; with no German default configured, the
   student sees the honest language-aware error — `af_bella` is never
   heard reading German. The boot audit had already named this gap at
   startup.
5. Fresh install, English persona with no voice ⇒ speaks with `af_bella`
   (`tier:'default'`, `'not_configured'`); Italian case likewise gets
   `if_sara`.
6. Settings → Voice shows provider status cards with toggles — **no engine
   dropdown exists anywhere in the app** — plus one Default-voice row per
   registry language whose values survive save/reload; unconfigured
   language rows carry the visible warning.
7. Preview always plays the literal requested voice or errors.
8. Discussion room behaves identically to patient chat under every row of
   the §4 matrix.
9. No provider value is stored in any case/persona row; deleting the new
   settings rows returns the platform to loud-fail-only behaviour.
10. The truth clause holds end-to-end: no surface shows a voice or engine
    that differs from what plays without also showing the substitution
    (wire-capture test, v3 AC7).
