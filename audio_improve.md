# Audio Improvement — Per-Provider Default Voices (Plan v3)

> **SUPERSEDED (2026-07-09): see `VOICE2_PLAN.md`.** The owner reversed the
> §4 rejection of provider-follows-voice ("I want voice 2.0"): a voice now
> plays on its own engine whenever that engine is usable; the platform
> `tts_provider` is demoted to a default, not a router. This document
> remains the authoritative spec for the parts Voice 2.0 inherits verbatim —
> the per-provider default-voice safety net (§5–6), truth clause, headers,
> toasts, boot audit, race fix, and test rewrites — but its core routing
> rule (single active provider, everything else invalid) is retired.

**Status:** PROPOSAL v3 — revised after TWO adversarial audits.
- v1 audit (`VOICE_DEFAULTS_PLAN.md`, Codex session
  `019f485e-addf-7ce1-8d06-12e5975a61f9`): "reject as written, directionally
  right" — five required amendments, all incorporated and marked **[v2]**.
- v2 audit (Codex session `019f486c-d9f2-7a33-998d-4a04937239a7`): nominal
  "reject as written", but 4 of 6 High findings verify that the plan's targets
  are real, still-present gaps in the code (nothing is implemented yet — by
  design, implementation is on hold pending owner approval). The two genuine
  plan defects are fixed and marked **[v3]**: the migration carry-over
  conflict rule (§6) no longer silently prefers the female legacy value.
  The audit also POSITIVELY cleared: retiring `PERSONA_DEFAULT_VOICE_KEYS`
  from `/platform-settings/avatars` is safe (AvatarsSettingsTab ignores them,
  tests assert absence), and the global tenant scope is coherent with the
  schema.
- Third review (independent implementation-readiness read, 2026-07-09):
  verdict "sound, would implement". Its refinements are folded in and marked
  **[v3]**: tolerant PUT validation on catalogue-check errors (§7.1.1),
  headers-before-provider-branch + CORS exposure check (§7.1.3), seeding
  logic in one place with retirement-only SQL (§6.5), toast dedup scope
  pinned (§7.2.4), editor plumbing made explicit (§7.2.5), and staged
  server-first sequencing (§7 intro). Owner also considered and REJECTED a
  provider-follows-voice alternative (derive provider from voice-id shape,
  allow mixed engines) — single active provider stands.
**Date:** 2026-07-09
**Author:** Claude (session: voice-routing review → multilingual Google voices → provider-switch UX)
**Scope:** TTS voice resolution when the stored voice is missing or invalid for the active provider.

---

## 1. The issue (what the user hit)

A case (or persona) stores a voice id from provider A (e.g. Kokoro's `af_bella`).
An admin switches the platform TTS engine to provider B (e.g. Google).
Result today: **the patient goes mute** in front of the student, with an error
toast — and the toast text is misleading ("No voice configured" when a voice
IS configured, just from the wrong provider).

The owner's verdict: *"failing loudly is not a good option"* — a mute patient
mid-class is itself a failure, arguably worse for the learner than a
wrong-sounding voice. The requested design: **one default voice per provider
(the 3–4 main ones), used for all personas** whenever the stored voice can't
play on the active engine. Never mute.

## 2. History — why the system is the way it is (the "saga")

Chronology reconstructed from code comments and git history:

1. **Original design (pre-2026-05):** multi-tier fallback. Per-character
   `tts_provider` fields, per-gender demographic voice slots
   (`voice_<provider>_<gender>`), per-provider persona defaults
   (`default_voice_<provider>_<gender>`), and hardcoded
   `PROVIDER_FALLBACK_VOICE` constants.
2. **The failure mode:** admins changed a voice (or the provider) and *heard
   no change* — some hidden tier silently substituted something else. The
   persona dropdown showed voice X while the runtime played voice Y. Root
   causes: per-character provider fields leaking stale engines into the
   runtime, and silent fallbacks masking dead configs. Documented in
   `src/utils/voiceResolver.js` header as "three weeks of 'I changed it and
   nothing happened'".
3. **2026-05-12/13 remediation (the pendulum swing):** resolution collapsed
   to ONE tier — `case_voice` (case override → persona template) or nothing.
   All fallbacks deleted. Provider reads from `platform_settings.tts_provider`
   only; the main `/api/tts` route ignores body provider. Invalid/missing
   voice ⇒ mute + toast. Guards added since: client-side id-shape validator
   (`isVoiceValidForProvider`), server-side catalogue check (400
   `invalid_voice`, no substitution), boot-time stale-voice audit
   (`server/healthChecks/voiceCatalogueAudit.js`), DiagnosticBar live wire
   capture (last 12 literal `/api/tts` payloads + replay).
4. **2026-07-09 (this session):** Google catalogue extended to de/it/fi/sv
   (16 verified Chirp 3 HD voices); pickers grouped by language; runtime
   language↔voice mismatch toast; CI contract that every registry language
   has ≥1 female + ≥1 male Google voice. Commit `a110774` on `lang_dev`.

**The lesson that must survive any change:** the saga was not caused by
fallbacks per se — it was caused by fallbacks that *lied* (UI showed one
thing, runtime played another, and nothing admitted the substitution).

## 3. Problems with the current (post-May) design

All four were **CONFIRMED by the v1 audit** with file:line evidence.

P1. **Mute patient on provider switch.** Every stored voice from the old
    provider is orphaned; each persona/case must be manually re-picked before
    voice mode works again. Students hit this before admins do.
    (Confirmed: `proxy-routes.js:1000/:1178`, `ChatInterface.jsx:1069/:1077`.)
P2. **Misleading error.** The `tier: 'invalid'` path reuses the
    `no_voice_configured_case` toast; the admin is told nothing is configured
    when the real problem is a provider mismatch.
    (Confirmed: `ChatInterface.jsx:1077`, `locales/en/chat.json:42`.)
P3. **Doc/code mismatch — masked template.** The comment above
    `resolveSpeakerVoice` claims an invalid case voice makes "the caller fall
    back to the template." It does not: `mergePatientVoiceConfig` merges
    case-over-template BEFORE validation, so an invalid case-level voice masks
    a valid template voice and the result is mute.
    (Confirmed: `ChatInterface.jsx:195/:1019`; DiagnosticBar merges the same
    way at `DiagnosticBar.jsx:284`.)
P4. **No default tier at all.** A fresh persona with no voice set is also
    mute (by design today), which conflates "never configured" with
    "misconfigured". (Confirmed: `voiceResolver.js:110`.)

## 4. Options considered and rejected

- **Auto-route by voice-id shape** (send `af_bella` to Kokoro even when the
  platform says Google): REJECTED. Re-legalises mixed engines — the exact
  ambiguity that caused the saga. Also: silent cost leaks (one case billing
  Google under a "free Kokoro" setting), per-case coupling to key validity,
  regex becomes a load-bearing router.
- **Guided bulk re-map on provider switch** (admin confirms a suggested
  mapping, DB rows rewritten): REJECTED by owner. Bulk writes need undo;
  still manual; owner wants zero-intervention behaviour.
- **Computed gender+language-matched substitute** (algorithmic nearest
  voice): SUPERSEDED by owner's simpler ask. A matching algorithm is a black
  box; an explicit default table is inspectable. Rejected in favour of §5.

## 5. Chosen design (owner-approved direction)

**One default voice per provider, set in platform settings, applied to all
personas** whenever `case_voice` is missing OR invalid for the active
provider. Never mute. Every substitution is visible.

Key properties:

- **Deterministic & inspectable:** the fallback is a literal setting an admin
  can read in one place — not computed, not hidden in code.
- **Non-destructive:** stored `case_voice` values are never rewritten. Switch
  back to Kokoro and `af_bella` plays again. The substitution is resolved at
  play time, not persisted.
- **Truth clause (anti-saga invariant):** any surface that shows a voice must
  show the substitution when one applies. The editor dropdowns read e.g.
  "af_bella — unavailable on google → default: Chirp3 HD-Aoede"; the
  DiagnosticBar wire capture shows both the requested and the substituted
  voice (see §7.2.6 — this requires a wire-model extension); the boot audit
  names stale rows as "will play the provider default <X>" and audits the
  defaults themselves (§7.1.5).
- **One default for ALL personas** (owner's explicit simplification). Known
  trade-off, flagged and accepted: a male patient may fall back to a
  female-sounding default (or vice versa). Mitigations: neutral-leaning
  seeds; the substitution label makes it visible; admins can change the
  default. Per-gender granularity can be added later as a settings-UI change
  (the resolver signature in §7.2.1 takes an opaque `defaultVoice` string, so
  a future per-gender lookup changes only the callers' lookup, not the tiers).

### Seeded defaults (all already in catalogues)

| Provider | Seed default | Rationale |
|---|---|---|
| kokoro | `af_bella` | existing de-facto patient default |
| google | `en-US-Chirp3-HD-Aoede` | best tier, female-neutral, free tier |
| openai | `alloy` | OpenAI's explicitly neutral voice |
| piper  | *(none seeded)* | voices are locally installed; can't assume any file exists. UI lets admin pick from installed list; until set, piper keeps today's loud-fail behaviour. |

### **[v2] Tenant scope — explicit decision**

Defaults are **GLOBAL (platform-wide), by declaration.** `platform_settings`
has no `tenant_id` column (`migrations/0001_initial.sql:174`), and the engine
selector itself (`tts_provider`) is already a global setting read through the
same helpers (`server/routes/_helpers.js:1075`). A per-tenant default with a
global engine would be incoherent: the engine decision the default serves is
global. If tenant-scoped voice policy is ever needed, it must arrive together
with a tenant-scoped `tts_provider` as one design — out of scope here. The
settings UI copy will say "platform-wide" explicitly so no admin assumes
tenant isolation.

## 6. Existing infrastructure — corrected status **[v2]**

The v1 claim that `default_voice_<provider>_<gender>` was "dormant / no-op
endpoints only" was **wrong** and is corrected here: those keys are **live**
today — `GET/PUT /platform-settings/avatars` reads and writes them
(`admin-routes.js:1638/:1685`). What IS true: the resolver ignores them (the
2026-05-12 comment at `AvatarsSettingsTab.jsx:28` calls editing them "a no-op
trap") and the Avatars tab no longer renders fields for them, so the only way
to set them today is a hand-crafted PUT.

**Decision (endorsed by v1 audit): option (b) — new keys
`tts_default_voice_<provider>`**, one per provider, owned by
`/platform-settings/voice`. The old gendered keys are retired in the same
change (see migration below) rather than left as a second, semantically
different defaults family.

### **[v2] Migration & compatibility path for the old keys**

New migration `migrations/00XX_tts_default_voices.sql` + boot seeding:

1. **Carry-over (unambiguous only) [v3]:** for each provider `p`, if
   `tts_default_voice_p` is absent and legacy `default_voice_p_female` /
   `default_voice_p_male` rows exist and are non-empty:
   - exactly ONE legacy row set, or both set to the SAME value → copy it into
     `tts_default_voice_p` (preserves a deliberate admin choice that survived
     the May removal);
   - both set and they DIFFER → do NOT silently pick either. Fall through to
     the §5 seed and emit a boot-audit warning naming the provider and both
     legacy values (`tts_default_conflict`), so the admin resolves the
     conflict explicitly in the Voice tab. Rationale (v2 audit finding):
     "female wins" was an arbitrary tiebreak that could silently preserve
     the wrong user-authored value.
2. **Seed:** for each provider still missing a value after carry-over, insert
   the §5 seed (INSERT-if-absent; never overwrite). Piper not seeded.
3. **Retire:** delete `default_voice_<provider>_<gender>` rows and remove
   `PERSONA_DEFAULT_VOICE_KEYS` from the `/platform-settings/avatars`
   endpoints (`admin-routes.js:1439/:1636/:1685`), so exactly ONE defaults
   family exists. The avatars endpoints keep their flat
   avatar/rate/pitch keys unchanged.
4. Migration is registered in `migrations/MANIFEST.md`; steps 1–2 run as
   idempotent boot logic (like other platform-setting seeds) so fresh
   installs and docker images behave identically.
5. **[v3] Single source of truth for steps 1–2:** the carry-over, seeding,
   and `tts_default_conflict` detection live ONLY in the idempotent boot
   seeder — the natural home of the boot-audit warning. The SQL migration
   file handles step 3 (retirement: DELETE the legacy
   `default_voice_<provider>_<gender>` rows) and nothing else. Duplicating
   carry-over logic in both SQL and boot code invites drift between the
   two implementations (third-review finding).

## 7. Implementation plan

**[v3] Sequencing (third-review recommendation):** land in three
self-contained stages, each with its tests green before the next starts —
(1) server: keys, boot seeding, `/tts` fallback + headers, boot audit;
(2) client resolver + its five consumers (the riskiest chunk — a stable
server contract underneath de-risks it); (3) settings UI + editors +
i18n + remaining test rewrites.

### 7.1 Server

1. **Settings keys:** `tts_default_voice_<provider>` for
   `kokoro|google|openai|piper` — **four scalar keys, one per provider**
   (the v1 text that implied a single `tts_default_voice` scalar is
   corrected; there is no single scalar anywhere in the design **[v2]**).
   Extend GET/PUT `/platform-settings/voice`:
   - GET returns all four raw keys (`tts_default_voice_kokoro`, …) AND a
     convenience field `tts_default_voice` = the value for the currently
     active `tts_provider` (derived, never stored) for client consumption.
   - PUT accepts the four raw keys; validation = the same catalogue check
     the `/tts` route uses (`resolveTtsVoice(provider, voice)`), NOT a shape
     regex — a typo'd default cannot be saved. Clearing (empty string) is
     allowed and restores loud-fail for that provider.
   - **[v3] Tolerant validation on catalogue-check ERRORS:** hard-400 only
     when the voice is definitively NOT in the provider's catalogue. If the
     catalogue check itself errors (e.g. the kokoro-js dynamic import is
     unavailable on a Google-only deployment, or piper's filesystem check
     fails), ACCEPT the save and return a `warnings` field naming the
     unverifiable key — otherwise an admin cannot save a kokoro default on
     a box where kokoro is not installed. "Not found" rejects;
     "couldn't check" warns.
2. **Seeding + migration:** per §6 (carry-over → seed → retire).
3. **`/api/tts` fallback tier:** in `handleTtsSynthesis`, when
   `resolveTtsVoice(provider, requestedVoice)` fails, look up
   `tts_default_voice_<provider>`; if set AND itself valid per
   `resolveTtsVoice`, synthesize with it and expose the substitution:
   - response header `X-Rohy-Voice-Substituted: <default>` plus
     `X-Rohy-Voice-Requested: <requestedVoice>`, set **before**
     `flushHeaders()` on the PCM-stream path and before `res.end(wav)` on
     the WAV path (v1 risk R6). **[v3] Set them in `handleTtsSynthesis`
     immediately after resolution, BEFORE dispatching to any provider
     branch** — both the kokoro streaming path and `pipePcmStream`
     (proxy-routes.js:1070) flush headers internally. **[v3] CORS check:**
     if the API is ever served cross-origin, the two headers must be added
     to `Access-Control-Expose-Headers` or `response.headers.get()` on the
     client silently returns null; verify at implementation time (same-origin
     today, so likely a no-op, but the dedicated header test must read the
     headers through fetch, not supertest internals, to prove exposure),
   - warn-level log `{ requested_voice, substituted_voice, provider, reason }`,
   - usage/cost recorded with the voice actually synthesized (provider is
     unchanged either way, so `recordTtsUsage`/`recordUsage` semantics hold).
   If no default is configured or the default itself fails validation:
   today's 400 `invalid_voice` stands (piper's shipped state).
   The 400 body gains `reason: 'no_default_configured'` vs the current
   generic text so clients can distinguish.
4. **`/tts/preview` is exempt** from substitution — an admin auditioning a
   specific voice must hear THAT voice or an error, never a stand-in.
5. **Boot audit (`voiceCatalogueAudit.js`) — two extensions [v2]:**
   a. It also audits the four `tts_default_voice_*` rows: each default is
      validated against ITS OWN provider's catalogue (not just the active
      one), so a stale default (e.g. a removed Google voice) is named at
      boot even before that provider is activated.
   b. The stale-`case_voice` warning message changes from "returns 400 until
      re-picked" to "will play provider default \"<X>\" until re-picked"
      when a valid default exists for the active provider.

### 7.2 Client

1. **`resolveVoice()` — new tiers AND richer return shape [v2].**
   New input: `defaultVoice` (string|null — the active provider's default,
   from voiceSettings). New chain:
   - `case_voice` valid → `tier:'override'`
   - case set but invalid, template `case_voice` valid → template file,
     `tier:'template'` (fixes P3 — code finally matches its own docs; the
     validation-aware fallback happens INSIDE the resolver, so
     `mergePatientVoiceConfig` at every callsite is passed unmerged
     case+template configs or the resolver gains the template as a separate
     argument — implementation detail: `resolveVoice({ voice, templateVoice,
     voiceSettings, defaultVoice, isValid })`, replacing the pre-merge at
     callsites so DiagnosticBar and ChatInterface cannot diverge)
   - neither valid/set, `defaultVoice` valid → `tier:'default'`
   - else `file:null, tier:'none'|'invalid'` (loud path, unchanged).
   **Return shape gains truth-clause metadata:** `requestedFile` (what the
   config asked for, null if nothing configured), `file` (what will play),
   `substituted: boolean`, `substitutionReason:
   'provider_mismatch'|'not_configured'|null`. Every consumer renders from
   this one shape — no surface computes its own story.
   The one-tier header comment in `voiceResolver.js` is rewritten to
   describe the new chain honestly, including WHY each tier exists and the
   truth-clause obligation on consumers.
2. **All `resolveVoice()` consumers updated — five, enumerated [v2]:**
   `ChatInterface.jsx` (patient chat + alarm-speech paths),
   `useDiscussionEngine.js` (discussion room — missed by v1),
   `DiagnosticBar.jsx`, `CaseAvatarVoicePicker.jsx`,
   `AgentPersonaEditor.jsx`. A repo-wide grep for `resolveVoice(` is part of
   the implementation checklist; any future consumer found during
   implementation joins this list in the PR description.
3. **`voiceSettings` payload:** GET `/platform-settings/voice` (already the
   source of the client's `voiceSettings` context) adds
   `tts_default_voice` (active provider's default, derived) and the four raw
   keys for the settings tab.
4. **ChatInterface:**
   - `tier:'default'` → ONE-TIME info toast per (requested→default) pair:
     "Playing platform default voice <X> — the configured voice <Y> is not
     available on <provider>." Info styling, speech proceeds.
     **[v3] Dedup scope pinned:** a module-level Set keyed by the
     `(requestedVoice, playedVoice, provider)` triple, page lifetime — a
     re-render or repeated utterance never re-toasts, but a genuine
     mid-session provider flip (new triple) surfaces again.
   - `tier:'invalid'` with no default → its own honest message (P2 fix):
     "The configured voice <Y> belongs to a different TTS provider than the
     active one (<provider>). Re-pick it in the case editor or Agent
     Personas." Distinct key from `no_voice_configured_case`.
   - **First-render race [v2]:** `resolveSpeakerVoice` depends on
     `voiceSettings`, which loads async on mount (`ChatInterface.jsx:331`).
     Fix: the mount-time fetch stores its promise; the voice-mode send path
     `await`s that promise (already-resolved after first load, so zero cost
     in the steady state) before opening a speech session. A send fired
     before settings arrive waits the few ms instead of taking the mute
     path. Covered by a regression test with a delayed settings mock.
5. **Editors (Case picker + Persona editor):** when `substituted` is true
   for the currently-saved value, render the substitution line under the
   dropdown (amber, mirrors the existing stale-avatar warning pattern):
   "«af_bella» is not available on google — the platform default
   «Chirp3 HD-Aoede» will play. Pick a google voice to override."
   **[v3] Hidden plumbing made explicit:** neither editor currently consumes
   `/platform-settings/voice` at all — rendering these labels requires
   fetching (or receiving via context) the four `tts_default_voice_*` keys
   plus the active provider. Budget this wiring; it is not free.
6. **`voiceService.ttsFetch()` wire-model extension [v2]:** wire entries gain
   `substitutedVoice` and `requestedVoice`, read from the
   `X-Rohy-Voice-Substituted` / `X-Rohy-Voice-Requested` response headers on
   BOTH the streaming and WAV paths (headers are readable on the fetch
   `Response` before the body is consumed). Without this the DiagnosticBar
   physically cannot display the substitution — v1's fatal gap. The
   `rohy:tts-request` CustomEvent and ring buffer carry the new fields;
   DiagnosticBar renders "requested X → played Y" on any entry where they
   differ, and its own static resolver line uses the §7.2.1 shape.
7. **VoiceSettingsTab:** a "Default voice (platform-wide)" section — one
   catalogue-populated select per provider (via `/tts/voices?provider=`),
   each with the existing TestVoiceButton (which uses `/tts/preview` and is
   therefore substitution-exempt, §7.1.4). **[v2]** `save()` builds its
   payload from an explicit field list (`VoiceSettingsTab.jsx:118`) — the
   four new keys are added to state, payload, AND a round-trip test that
   asserts a saved default survives GET-after-PUT (v1's silent-drop trap).

### 7.3 i18n

New keys (en + de/it/fi/sv + pseudo-locale regen):
- settings: section heading, per-provider default labels, "platform-wide"
  scope note;
- editors: substitution warning line;
- chat: `voice_default_substituted` info toast, `voice_wrong_provider`
  honest error (P2);
- all following the existing namespace conventions (chat.json,
  authoring_case.json, authoring_persona.json, authoring_config.json).

### 7.4 Tests

**[v2] Contract-rewrite list (from the v1 audit — each consciously rewritten
from "rejects loudly" to "no *invisible* fallback", asserting the
header/toast/label instead of the 400/mute):**
- `tests/server/tts-route.test.js`
- `tests/server/tts-gender-provider-matrix.test.js`
- `src/utils/voiceResolver.test.js`
- `src/utils/voiceResolutionMatrix.test.js`
- `src/utils/inheritOverrideAuditMatrix.test.js`
- `src/hooks/useDiscussionEngine.test.js`
- `src/components/settings/CaseAvatarVoicePicker.test.jsx`
- `src/components/debug/DiagnosticBar.test.jsx`
- `tests/server/healthChecks/voiceCatalogueAudit.test.js`

**[v2] Blind-spot hardening (tests that would falsely pass today):**
- `AgentPersonaEditor.test.jsx` mocks `resolveVoice` to a fixed file — add an
  unmocked case exercising the real resolver with an invalid saved voice.
- `ChatInterface.test.jsx` only proves the override path — add default-tier
  and wrong-provider-toast cases, plus the delayed-settings race test.
- `VoiceSettingsTab.test.jsx` — add the save/GET round-trip for the four new
  keys (the silent-drop trap).
- `AvatarsSettingsTab.test.jsx` — assert the retired gendered keys are gone
  from its endpoints' accepted set.

**New coverage:**
- Route: invalid voice + default set → 200, audio bytes, BOTH substitution
  headers present (WAV and PCM-stream paths separately — header-before-flush
  is the R6 risk); invalid voice + no default → 400 with
  `reason:'no_default_configured'`; PUT with an invalid default → 400;
  preview route never substitutes.
- Migration/seeding: fresh DB gets the three seeds; legacy gendered value is
  carried over in preference to the seed; existing new-key values never
  overwritten; legacy rows deleted after carry-over.
- Resolver: full tier matrix — override / template-after-invalid-case (P3
  regression) / default / invalid-no-default / nothing-configured — plus the
  truth metadata (`requestedFile`, `substituted`, `substitutionReason`) on
  every branch.
- Wire capture: mocked fetch with substitution headers → ring-buffer entry
  carries `requestedVoice`/`substitutedVoice`; DiagnosticBar renders both.
- Boot audit: flags an invalid `tts_default_voice_google` even when the
  active provider is kokoro; stale-row message names the default when set.
- Existing invariants keep passing: language-coverage contract, per-language
  tier ordering, googleTts service contracts.

### 7.5 Explicitly out of scope

- No auto-routing by voice-id shape. `tts_provider` stays the single engine
  authority; main `/tts` keeps ignoring body provider.
- No rewriting of stored `case_voice` values on cases/personas (the only DB
  writes are in `platform_settings`: the new default keys + retirement of
  the legacy gendered default keys, §6).
- No per-language or per-gender default keys (language matching remains a
  warning, not a routing input) — revisit only if the single default proves
  insufficient; §5 notes the resolver signature already permits it.
- No per-tenant defaults (§5 tenant-scope declaration).

## 8. Risks

R1. **Gender mismatch by design** (single default for all personas) — owner
    accepted; substitution labels + info toast make it visible everywhere.
R2. **Reduced pressure to fix stale configs** — mute forced action; a working
    default may let stale rows rot. Counterweights: boot audit (now covering
    defaults too), editor amber warnings, chat info toast, DiagnosticBar
    requested→played display.
R3. **Legacy-key retirement breaks an unknown consumer** — mitigated: v1
    audit + repo grep found only the avatars endpoints and comments; the
    migration test asserts the endpoints reject the retired keys so any
    hidden client fails loudly in CI, not silently in prod.
R4. **Contract-rewrite scope** — nine test files change meaning; each rewrite
    must assert the *new* truth obligation (header/label/toast), never just
    delete the old assertion (checklist in §7.4).
R5. **Cost attribution** — substituted synthesis records the voice actually
    used; provider (the billing axis) is unchanged by substitution.
R6. **Streaming header timing** — substitution headers must be set before
    `flushHeaders()` on the PCM path; dedicated test on both paths.
R7. **[v2] Race on first send** — closed by awaiting the settings promise
    (§7.2.4) with a regression test; residual risk is a failed settings
    fetch, which falls through to the existing loud path (never a wrong
    voice).

## 9. Acceptance criteria

1. Kokoro-configured case + platform switched to Google ⇒ patient speaks
   (Google default), student unaffected; admin sees info toast in chat, amber
   note in both editors, warn line in server log, and requested→played in the
   DiagnosticBar wire history.
2. Switch back to Kokoro ⇒ original `af_bella` plays; no case/persona row was
   rewritten.
3. Fresh install, persona with no voice at all ⇒ speaks with provider default
   (`tier:'default'`, `substitutionReason:'not_configured'`).
4. Discussion room (useDiscussionEngine) behaves identically to patient chat
   under substitution — same tiers, same visibility.
5. Admin can set/clear each provider's default in Settings → Voice, audition
   it (preview plays the literal voice, never a substitute), and the values
   survive a save/reload round-trip.
6. Piper with no default configured behaves exactly as today (loud 400).
7. No surface anywhere shows a voice name that differs from what plays
   without also showing the substitution — the truth clause holds, verified
   end-to-end by the wire-capture test.
