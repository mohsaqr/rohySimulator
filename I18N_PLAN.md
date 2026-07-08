# rohySimulator Internationalization Plan

**Goal:** ship Italian first, with an architecture where adding Finnish, Swedish,
or any further language is a *data change* (one registry entry + one translated
locale file + optional voice files) — never a code change.

**Status:** reviewed 2026-07-08 (findings folded in below) — **Phase A implemented**
(all tests green, build verified; live LLM smoke test pending — run
`node scripts/llm-language-smoke.mjs` against a dev server). Scope decision:
student-facing surfaces first; analytics + admin panels deprioritised (§6).
**Date:** 2026-07-08

---

## 1. Current state (audited 2026-07-08)

The app is effectively English-only. There is **no i18n framework, no locale
files, no language switcher**. What exists today:

| Asset | Location | State |
|---|---|---|
| i18n library | `package.json` | none (no i18next / react-intl / lingui) |
| Translation shim | `src/components/analytics/tna/laila/i18nShim.js` | fake `useTranslation()`/`t()`, English-only, **written to be swap-compatible with react-i18next** (~50 call sites, all in the laila subtree) |
| Language preference | `migrations/0001_initial.sql` (`user_preferences.language TEXT DEFAULT 'en'`) | column exists; `server/routes/users-routes.js` GET/PUT already persist it — **stored but never consumed** |
| Language settings UI | `src/components/settings/` | none — no field surfaces the `language` preference |
| UI strings | ~97 non-test components under `src/components/` | hardcoded inline in JSX (`App.jsx`, `ChatInterface.jsx` ~1,960 lines, etc.); only `src/constants/roleLabels.js` is centralized |
| STT languages | `src/components/settings/VoiceSettingsTab.jsx` (~lines 22–30) | hardcoded array: `en-US, en-GB, tr-TR, ar-SA, fr-FR, de-DE, es-ES` — no `it-IT`, `fi-FI`, `sv-SE` |
| TTS providers | `server/routes/proxy-routes.js:66` `VOICE_TTS_PROVIDERS = ['piper','kokoro','openai','google','browser']` | Piper voices installed: `en_GB-jenny_dioco`, `en_US-amy`, `en_US-ryan` only. `GOOGLE_VOICES` (`server/services/googleTts.js`) all `en-US`. OpenAI + browser providers are inherently multilingual. Kokoro is English-oriented. |
| LLM prompts | client: `src/components/chat/ChatInterface.jsx` (`buildPersonaBlocks`, `roleAnchor`), `src/utils/personaBlocks.js`, `src/utils/roleAnchor.js`; server: `server/services/systemPromptAssembly.js` | **no output-language directive anywhere** — the model defaults to English. Fallbacks like `'You are a patient.'` are hardcoded English |
| Clinical content | `Lab_database.json`, drug catalogue (`server/routes/catalogue.js`, migration `0007`), cases/scenarios in DB | English author-entered content — **out of scope** (see §8) |

**Key architectural fact:** most of what a student reads is *LLM-generated at
runtime*, not static UI text. A prompt directive translates the core experience
before a single string is extracted. The plan exploits this ordering.

---

## 2. Design principle: the language registry

One module is the single source of truth for every language the app knows:

```js
// src/i18n/languages.js
export const LANGUAGES = {
  en: {
    name: 'English', native: 'English',
    stt: 'en-US',
    llmDirective: null,                    // English is the model default
    dir: 'ltr',
  },
  it: {
    name: 'Italian', native: 'Italiano',
    stt: 'it-IT',
    llmDirective: 'Rispondi sempre in italiano, indipendentemente dalla lingua della domanda.',
    dir: 'ltr',
  },
  fi: {
    name: 'Finnish', native: 'Suomi',
    stt: 'fi-FI',
    llmDirective: 'Vastaa aina suomeksi riippumatta siitä, millä kielellä kysymys esitetään.',
    dir: 'ltr',
  },
  sv: {
    name: 'Swedish', native: 'Svenska',
    stt: 'sv-SE',
    llmDirective: 'Svara alltid på svenska, oavsett vilket språk frågan ställs på.',
    dir: 'ltr',
  },
}
```

Every consumer — settings UI, prompt assembly, STT list, TTS voice resolver,
`<html lang dir>` attributes, `Intl` formatters — derives from this registry.
Nothing else may hardcode a language name or code.

**Definition of done for the architecture** (the acceptance test used in §7):
adding a new language touches (1) this registry, (2) a `locales/xx/` folder,
(3) optionally provider voice **catalogue data entries** (e.g. rows in
`GOOGLE_VOICES`) / Piper `.onnx` files. Catalogue rows count as data even
though they live in service files. No component edits, no *logic*
conditionals on language codes anywhere in `src/` or `server/`.

---

## 3. Layer 1 — Language preference plumbing

The cheapest layer; everything else keys off it.

1. **Settings UI**: add a language selector to the profile/settings panel in
   `src/components/settings/` (options generated from `LANGUAGES`, labelled by
   `native` name). Persist via the existing `PUT user_preferences` — the
   backend needs **zero changes**.
2. **Two fields, not one** (small now, painful to retrofit):
   - `uiLanguage` — interface chrome.
   - `caseLanguage` — patient dialogue + TTS/STT (defaults to `uiLanguage`).
   A Finnish program may want a Finnish UI with an English-speaking patient
   scenario, or vice versa. Store `caseLanguage` alongside session settings
   (`session_settings` / `sessions.llm_settings` already exist in
   `0001_initial.sql`); `uiLanguage` lives in `user_preferences.language`.
3. **React context**: a `LanguageProvider` exposing `{ uiLanguage,
   caseLanguage, setUiLanguage, setCaseLanguage }`, hydrated from the users
   API at login. Sets `document.documentElement.lang` / `dir` from the
   registry.

---

## 4. Layer 2 — LLM patient dialogue (highest value, lowest effort)

1. **Directive injection — server-side only**: append
   `LANGUAGES[caseLanguage].llmDirective` inside
   `server/services/systemPromptAssembly.js` when non-null, passing
   `caseLanguage` through the `/proxy/llm` request body. **Not** client-side
   in `buildPersonaBlocks` — the rich `## INSTRUCTIONS` block is built
   client-side (`ChatInterface.jsx:724`) and shipped as `system_prompt`,
   which `assembleSystemPrompt` then wraps (`proxy-routes.js:434`); injecting
   in both places would double the directive. Server-side covers the
   ChatInterface path *and* `src/services/llmService.js` and any future path.
2. **Prompt fragments**: role anchors (`src/utils/roleAnchor.js`) and
   fallbacks become locale-keyed strings so the scaffolding around the case
   prompt matches the dialogue language. Note `'You are a patient.'` is
   hardcoded in **three** places: `ChatInterface.jsx:725`,
   `llmService.js:54`, and `llmService.js:129` — all three must be covered.
   (The prompt *skeleton* headers like `## PERSONA` stay English — they are
   instructions to the model, not user-visible.)
3. **Case content interplay**: admin-authored `case.system_prompt` stays in
   whatever language the author wrote. The directive dominates output language
   regardless; document this behaviour for case authors in
   `docs/` (VitePress).
4. **Verification**: scripted smoke test per language — send a fixed probe
   question through `/proxy/llm` with each registry directive; assert the
   reply is in the target language (trivial check: LLM self-reports, or
   franc/langdetect-style heuristic). Covers Claude *and* OpenAI providers.
   Probe the **first** assistant turn as well as multi-turn drift. Also A/B
   the directive phrasing once: target-language directive (current registry)
   vs an English directive naming the target language ("Always respond in
   Italian…") — keep whichever holds better; English-phrased directives keep
   the registry reviewable by non-speakers.

---

## 5. Layer 3 — Speech (STT + TTS)

### STT
- Replace the hardcoded array in `VoiceSettingsTab.jsx` with a list generated
  from the registry (`LANGUAGES[*].stt`), preserving the existing extra
  dialects (en-GB etc.) as registry data.
- Default the STT language to `caseLanguage` while keeping the manual
  override.

### TTS — language tagging + mismatch warning (NOT a fallback chain)

**Reconciliation with the existing design (review finding, 2026-07-08).**
`src/utils/voiceResolver.js` is the single source of truth for voice
resolution, and it is deliberately **one tier, no fallbacks**: per-persona
`case_voice` only, collapsed 2026-05-12/13 after three weeks of voice churn
caused by cross-provider voice leakage. An earlier draft of this plan
proposed a language-based fallback chain (Piper → Google → OpenAI/browser →
English) — that would reintroduce exactly the resolver architecture this
repo tore out, and split resolution across a second (server-side) resolver.
**Dropped.** Instead, language is a *validation* concern layered on the
existing one-tier design:

1. **Tag every voice with a BCP-47 language** in each provider catalogue
   (data, not resolution logic):
   - `server/services/googleTts.js` `GOOGLE_VOICES` → add `it-IT`, `fi-FI`,
     `sv-SE` Google voices (the file's own comment invites this).
   - `server/services/kokoroTts.js` already exposes per-voice `language`
     (default `'en'`) — keep; Kokoro has no usable it/fi/sv packs and will
     simply never match non-English.
   - Piper: voice language is derivable from the model name
     (`it_IT-…`, `fi_FI-…`, `sv_SE-…`) — the resolver's own
     `VOICE_ID_PATTERNS` comment already cites `fi_FI-harri-medium.onnx`.
   - OpenAI + `browser`: `multilingual: true` (they follow input text;
     browser voices are enumerated client-side via
     `speechSynthesis.getVoices()` filtered by lang).
2. **Language-mismatch warning, not substitution**: a
   `voiceLanguage(voiceId, provider)` helper beside the resolver derives the
   voice's language; when it conflicts with the session's `caseLanguage`
   (and the voice is not multilingual), surface a **loud diagnostic-bar
   warning** and an authoring-time nudge to pick a matching `case_voice`.
   The voice actually used never silently changes — same "loud failure over
   silent fallback" ethos as §10, without resurrecting fallback chains.
   If per-language personas become common, the escape hatch is per-language
   `case_voice` maps on the persona (still one tier), not a chain.
3. **Piper voice packs** (offline TTS, matters for the Docker deploy):
   download `it_IT-riccardo`/`it_IT-paola`, `fi_FI-harri`, `sv_SE-nst` `.onnx`
   models into `server/data/piper/`. **Deployment note:** verify the
   Dockerfile runtime stage copies these (repo has prior history of runtime
   files missing from the image — see LEARNINGS on `Lab_database.json` and
   `CHANGELOG.md`); note `server/data/piper/` also contains a stray `venv/`
   directory that COPY globs must not drag in. Decide whether large `.onnx`
   files ship in the image or are fetched/mounted at deploy time.

---

## 6. Layer 4 — UI strings (the long tail)

### Framework
- **react-i18next + i18next**, with **ICU message format** (`i18next-icu`).
  ICU is required, not nice-to-have: Finnish/Swedish plural and inflection
  rules ("1 tulos / 2 tulosta") break naive `count === 1 ? … : …` string
  code.
- Replace `laila/i18nShim.js` with the real library — **deferred to the
  analytics tail (§ migration order), and not a one-import swap** (review
  finding): the shim *humanises unknown keys* (`network_density` → "Network
  density") while real i18next renders the raw key. The swap requires first
  materialising the shim's `OVERRIDES` map plus the humanised output of all
  52 `t()` call sites (8 files) into `en/analytics.json`, and fixing the
  `t('key') || 'fallback'` idiom (e.g. `ProcessMap.jsx:126`) — with real
  i18next a missing key returns the key itself (truthy), silently killing
  the `||` fallback. Use `t('key', 'Default text')` instead.

### Structure
```
src/locales/
  en/chat.json  en/monitor.json  en/settings.json  en/investigations.json …
  it/…          fi/…             sv/…
```
- **Namespaces mirror component domains** (`chat`, `monitor`, `settings`,
  `investigations`, `treatments`, `examination`, `orders`, `analytics`,
  `auth`, `common`), **lazy-loaded** so students never download admin-panel
  strings.
- `en/` is the canonical source. **English is the global fallback** — a
  missing Finnish key renders English, never a raw key.

### Tooling (what makes 97 components tractable)
- **`i18next-parser`** in the repo: scans JSX for `t()` calls, keeps `en/*.json`
  in sync automatically. Extraction becomes CI-verified, not a manual audit.
- **CI checks**: (a) parser output is clean (no unextracted keys drift),
  (b) key-set diff across locales — every locale's missing-key count is
  visible per PR.
- **Pseudo-locale `en-XA`** (accented + ~40% lengthened strings, generated
  from `en/`): running the app in `en-XA` exposes hardcoded strings and
  layout truncation *before* paying for translation. Swedish/Finnish run
  ~30% longer than English; the monitor and chat layouts are the overflow
  hotspots.

### Migration order (incremental, by student value)

**Scope decision (2026-07-08): student-facing surfaces are the priority.
Analytics and admin/instructor panels are explicitly deprioritised** — they
are instructor/researcher-facing, English is acceptable there indefinitely,
and `settings/` alone is 18.8k lines (46% of all component JSX). English
fallback makes partial coverage invisible-safe, so the tail can trail
releases forever without harm.

1. `chat/` + `monitor/` (the student-facing core, ~4.6k lines)
2. `investigations/`, `treatments/`, `examination/`, `orders/`,
   `discussion/`, `patient/` (student workflow, ~6.3k lines)
3. `auth/`, `common/`, student-visible parts of `App.jsx`
4. **Deferred, no target date**: `settings/` admin panels, `analytics/`
   (laila shim swap included), `debug/`, `oyon/` — pick up only if a
   language gains non-English-reading instructors.

Each domain migrates in its own PR with the pseudo-locale check passing.

---

## 7. Layer 5 — Translation production workflow

- **First pass by LLM, through the app's own `/proxy/llm`**: a script
  (`scripts/translate-locales.mjs`) diffs new/changed keys in `en/*.json`,
  translates them with a pinned **clinical glossary** (vitals, lab, drug
  terminology per language) and ICU-syntax-preservation instructions, and
  writes `it/ fi/ sv/` files. Deterministic keys → re-runs only touch deltas.
- **Native review as git diff review**: reviewers see only changed strings
  per PR, never a from-scratch spreadsheet. For Finnish/Swedish you have
  native-speaker colleagues in the UEF orbit; treat their sign-off as the
  release gate per language.
- **TMS deferred**: self-hosted Tolgee/Weblate only if non-developer
  translators need a web editor later. For a research project the
  LLM-script + git-review loop is leaner; revisit if a language gains a
  dedicated non-technical maintainer.

### Acceptance test (run when adding Swedish, after Italian + Finnish exist)
Adding `sv` must require exactly:
1. one entry in `src/i18n/languages.js`;
2. `npm run translate -- sv` → generated `src/locales/sv/`;
3. optional: Google voice entries + Piper `sv_SE` `.onnx`.

If any component, route, or service needs editing, that's an architecture
bug — fix the abstraction, not the instance.

---

## 8. Layer 6 — Formatting, RTL-readiness, and scope fences

- **`Intl` everywhere**: dates via `Intl.DateTimeFormat(locale)`, numbers via
  `Intl.NumberFormat(locale)` — Finnish/Swedish use `7.7.2026` and decimal
  commas. Sweep hotspots: monitor vitals, lab result tables, timestamps in
  chat/session logs. One shared `formatters.js` keyed off `uiLanguage`;
  ban ad-hoc `toLocaleString()`/`toFixed()`+concat in reviewed code.
- **RTL-readiness (cheap now, expensive later)**: Arabic is already in the
  STT list, so the request will come. Do *not* retrofit; just stop digging:
  new/touched code uses Tailwind logical utilities (`ms-*`/`me-*`,
  `ps-*`/`pe-*`), and `dir` is already set from the registry (§3).
- **Clinical content stays out of scope**: `Lab_database.json`, the
  RxNorm/LOINC drug-lab catalogue, and case/scenario text are author-entered
  data. Lab/drug nomenclature should remain standard (LOINC/RxNorm names are
  international practice); case translation is a per-case authoring feature —
  if wanted later, it's an authoring-UI feature ("duplicate case in
  language X" with LLM assist), not part of this i18n effort.

---

## 9. Delivery phases

### Phase A — Multilingual skeleton (≈1 session)
Registry · settings selector + LanguageProvider · LLM directive injection
(server-side) · STT list from registry · TTS voice tagging + resolver with
visible-fallback warning · per-language LLM smoke test.
**Milestone:** an Italian (or Finnish/Swedish) student converses with a
patient who replies — and speaks via OpenAI/browser TTS — in their language.
No UI strings extracted yet.

### Phase B — i18n framework + tooling (≈1 session)
react-i18next + ICU · locale folder structure · i18next-parser + CI checks ·
pseudo-locale `en-XA` · migrate `chat/` + `monitor/`. (Laila shim swap moved
to the deferred analytics tail — see §6.)

### Phase C — String migration, student-facing domains (2–3 sessions, parallelizable)
Student-workflow domains per §6 migration order, one PR per domain.
Independent domains can be run as parallel agent tasks. The deferred tail
(settings/analytics/admin) is out of scope until explicitly re-prioritised.

### Phase D — Translation production (≈1 session + review latency)
`translate-locales.mjs` + glossary · generate `it`, `fi`, `sv` · native
review gates · `Intl` formatting sweep.

### Phase E — Per-language polish (as needed)
Piper `.onnx` packs + Dockerfile/runtime-image verification · Google voice
entries · docs page for case authors on `caseLanguage` behaviour ·
deploy to SaqrServer and verify in the deployed image (repo history: runtime
assets have been silently dropped by `.dockerignore`/COPY gates twice).

### Ordering rationale
Phase A alone delivers most pedagogical value because the core experience is
LLM-generated dialogue, not static UI. Phases B–D are mechanical and gated by
tooling built once. Phase C is the only genuinely long phase and can trail
behind releases indefinitely — untranslated components safely fall back to
English throughout.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM drifts back to English mid-conversation (long chats, English case prompts) | Directive in *system* prompt (server-assembled), not first user turn; re-assert in the instructions block; smoke test with multi-turn probes |
| Clinical terminology mistranslated by machine pass | Pinned per-language glossary in the translation script; native review is the release gate |
| Layout breakage from longer strings | Pseudo-locale `en-XA` in CI/manual QA before any real translation |
| Locale files drift out of sync | i18next-parser + key-diff CI check per PR |
| Piper `.onnx` files missing from Docker runtime image | Explicit Dockerfile COPY verification step in Phase E (two prior incidents of exactly this failure mode) |
| Wrong-language TTS served silently | Language-mismatch validation on the one-tier resolver — diagnostic bar warning + authoring nudge; the voice is never silently substituted (no fallback chains, per `voiceResolver.js` design) |
| Scope creep into clinical content translation | Fenced in §8; requires its own decision |

---

## 11. Success criteria

1. Student can select Italiano/Suomi/Svenska and get: translated UI (Phase C
   coverage), patient dialogue in that language, STT recognizing it, TTS
   speaking it.
2. Adding Swedish after Finnish satisfied the §7 acceptance test (data-only).
3. English-only users see zero behaviour change.
4. All CI checks (extraction, key-diff, tests) green; per-language LLM smoke
   tests pass on both OpenAI and Anthropic providers.
