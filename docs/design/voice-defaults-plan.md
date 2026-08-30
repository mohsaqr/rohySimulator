# Voice Defaults — Issue, History, and Implementation Plan

**Status:** PROPOSAL — awaiting audit by a second agent. Nothing implemented.
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

P1. **Mute patient on provider switch.** Every stored voice from the old
    provider is orphaned; each persona/case must be manually re-picked before
    voice mode works again. Students hit this before admins do.
P2. **Misleading error.** The `tier: 'invalid'` path reuses the
    `no_voice_configured_case` toast; the admin is told nothing is configured
    when the real problem is a provider mismatch.
P3. **Doc/code mismatch — masked template.** The comment above
    `resolveSpeakerVoice` (ChatInterface.jsx ~1010) claims an invalid case
    voice makes "the caller fall back to the template." It does not:
    `mergePatientVoiceConfig` merges case-over-template BEFORE validation, so
    an invalid case-level voice masks a valid template voice and the result
    is mute — not the documented precedence.
P4. **No default tier at all.** A fresh persona with no voice set is also
    mute (by design today), which conflates "never configured" with
    "misconfigured".

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
  show the substitution when one applies. The editor dropdown reads e.g.
  “af_bella — unavailable on google → default: Chirp3 HD-Aoede”; the
  DiagnosticBar wire capture continues to prove what was actually sent; the
  boot audit keeps naming stale rows (now as "will play the provider default"
  rather than "will 400").
- **One default for ALL personas** (owner's explicit simplification). Known
  trade-off, flagged and accepted: a male patient may fall back to a
  female-sounding default (or vice versa). Mitigations: ship neutral-leaning
  seeds; the substitution label makes it visible; admins can change the
  default. (NOTE FOR AUDITOR: the dormant DB schema supports per-gender
  defaults — see §6 — so upgrading later to per-gender is a settings-UI
  change, not a schema change. The plan keeps the resolver reading a single
  key per provider to honour the owner's ask.)

### Seeded defaults (proposed; all already in catalogues)

| Provider | Seed default | Rationale |
|---|---|---|
| kokoro | `af_bella` | existing de-facto patient default |
| google | `en-US-Chirp3-HD-Aoede` | best tier, female-neutral, free tier |
| openai | `alloy` | OpenAI's explicitly neutral voice |
| piper  | *(none seeded)* | voices are locally installed; can't assume any file exists. UI lets admin pick from installed list; until set, piper keeps today's loud-fail behaviour. |

## 6. Discovered dormant infrastructure (do not rebuild — revive)

- `platform_settings` already accepts `default_voice_<provider>_<gender>`
  keys with full validation via GET/PUT `/platform-settings/avatars`
  (`server/routes/admin-routes.js` ~1620–1700, `PERSONA_DEFAULT_VOICE_KEYS`).
- The UI fields were removed from AvatarsSettingsTab on 2026-05-12 (comment
  at `src/components/settings/AvatarsSettingsTab.jsx:28`) and the resolver
  stopped reading the keys. Rows in prod DBs may still exist ("no-op trap"
  warning in that comment). Current dev DB: no `default_voice_*` rows.
- Decision needed by auditor: **(a)** reuse `default_voice_<provider>_<gender>`
  writing the same value to all genders of a provider, or **(b)** introduce a
  new single key `tts_default_voice_<provider>` and deprecate the old keys.
  Author leans (b) — cleaner match to the owner's "one per provider", avoids
  resurrecting the no-op-trap keys with different semantics; the old keys
  stay dropped.

## 7. Implementation plan

### 7.1 Server

1. **Settings keys:** `tts_default_voice_<provider>` for
   `kokoro|google|openai|piper`. Extend GET/PUT `/platform-settings/voice`
   (admin-gated PUT already exists there; validation = must pass the same
   catalogue check as `/tts` uses, i.e. `resolveTtsVoice(provider, voice)` —
   NOT just a shape regex, so a typo'd default can't be saved).
2. **Seeding:** on boot, insert missing `tts_default_voice_*` rows with the
   §5 seeds (INSERT-if-absent; never overwrite an admin's value). Piper not
   seeded.
3. **`/api/tts` fallback tier:** in `handleTtsSynthesis`, when
   `resolveTtsVoice(provider, requestedVoice)` fails, look up
   `tts_default_voice_<provider>`; if set AND valid, synthesize with it and
   expose the substitution:
   - response header `X-Rohy-Voice-Substituted: <default>` (readable on both
     WAV and PCM-stream paths),
   - warn-level log with requested voice, default used, reason,
   - usage/cost recorded against the default actually synthesized.
   If no default configured (piper, or admin cleared it): keep today's 400.
4. **Boot audit:** message for stale rows changes from "returns 400 until
   re-picked" to "will play provider default <voice> until re-picked" when a
   default exists.

### 7.2 Client

5. **`resolveVoice()` gains a `defaultVoice` input** (from
   `voiceSettings.tts_default_voice` for the active provider) and a new tier:
   `case_voice` valid → `tier:'override'`; case invalid BUT template valid →
   template (`tier:'template'`, fixes P3 to match its own docs); else
   default → `tier:'default'`; else `file:null` (unchanged loud path).
   The one-tier header comment is rewritten to describe the new chain
   honestly.
6. **GET `/platform-settings/voice`** already feeds `voiceSettings` context;
   add `tts_default_voice` (resolved for the active provider) to its payload.
7. **ChatInterface:** on `tier:'default'`, show a ONE-TIME info toast
   ("Playing platform default voice <X> — the configured voice <Y> is not
   available on <provider>") — info, not error; speech proceeds. P2 fixed:
   `tier:'invalid'`+no-default gets its own honest message distinct from
   "nothing configured".
8. **Editors (Case picker + Persona editor):** when the saved voice fails
   `isVoiceValidForProvider`, render the substitution line under the
   dropdown (amber, mirrors the existing stale-avatar warning pattern):
   "«af_bella» is not available on google — the platform default
   «Chirp3 HD-Aoede» will play. Pick a google voice to override."
9. **VoiceSettingsTab:** "Default voice" select per provider (populated from
   that provider's catalogue via `/tts/voices?provider=`), with the existing
   TestVoiceButton for audition.
10. **DiagnosticBar:** wire entries already capture the literal voice sent;
    add the substituted-from info when the server header is present.

### 7.3 i18n

11. New keys (en + de/it/fi/sv + pseudo-locale regen): default-voice labels
    in settings; substitution warning in editors; info toast in chat;
    honest invalid-voice message.

### 7.4 Tests (all new behaviour locked in CI)

- Route: invalid voice + default set → 200, audio, `X-Rohy-Voice-Substituted`
  header, usage row charged to the default; invalid voice + no default → 400
  (piper regression); default itself invalid in settings PUT → 400.
- Seeding: fresh DB gets the three seeds; existing admin values untouched.
- Resolver: full tier matrix (override / template-after-invalid-case /
  default / null), incl. P3 regression (invalid case + valid template →
  template).
- Editors: substitution line renders when saved voice invalid for provider.
- Boot audit: message includes the default when configured.
- Existing invariants must keep passing: language-coverage contract,
  per-language tier ordering, no-silent-fallback tests get UPDATED to the new
  contract "no *invisible* fallback" (assert header/toast/label presence).

### 7.5 Explicitly out of scope

- No auto-routing by voice-id shape. `tts_provider` stays the single engine
  authority; main `/tts` keeps ignoring body provider.
- No rewriting of stored `case_voice` values (no migrations of case/persona
  rows).
- No per-language default keys (language matching remains a warning, not a
  routing input) — revisit only if the single default proves insufficient.

## 8. Risks for the auditor to weigh

R1. **Gender mismatch by design** (single default for all personas) — owner
    accepted; verify the substitution labels are prominent enough.
R2. **Reduced pressure to fix stale configs** — mute forced action; a working
    default may let stale rows rot. Counterweights: boot audit, editor amber
    warnings, chat info toast. Auditor: are these sufficient?
R3. **Key-name choice** (§6 a-vs-b) — resurrecting `default_voice_*` keys
    with changed semantics vs. new `tts_default_voice_*` keys next to
    dormant old ones. Author prefers (b); auditor should confirm and check
    nothing else still reads the old keys (grep found only the no-op
    endpoints + comments).
4. **Server-side substitution changes the "reject loudly" contract** that
    several tests assert. Each such test must be consciously rewritten to the
    new contract, not deleted.
R5. **Cost attribution:** substituted synthesis must be recorded under the
    voice/provider actually used (it is — usage keys off provider, not voice).
R6. **Streaming header timing:** `X-Rohy-Voice-Substituted` must be set
    before `flushHeaders()` in the PCM path.

## 9. Acceptance criteria

1. Kokoro-configured case + platform switched to Google ⇒ patient speaks
   (Google default), student unaffected; admin sees info toast in chat, amber
   note in editors, warn line in server log, substitution in DiagnosticBar.
2. Switch back to Kokoro ⇒ original `af_bella` plays; nothing was rewritten.
3. Fresh install, persona with no voice at all ⇒ speaks with provider default.
4. Admin can change each provider's default in Settings → Voice and audition it.
5. No surface anywhere shows a voice name that differs from what plays
   without also showing the substitution — the truth clause holds.
