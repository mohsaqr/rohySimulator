# Admin first-run checklist

[INSTALL.md](INSTALL.md) gets Rohy running on a machine. This doc covers
what an admin should configure **inside** the running app before
letting learners use it — voices, default personas, LLM provider,
diagnostic bar.

Most of this is one-time setup. Re-read it whenever you switch TTS
providers, swap LLM models, or restore from a backup.

---

## TL;DR

A fresh install ships with **Kokoro TTS** set as the platform default
and a working voice picked on every shipped persona (`am_michael` for
the default patient, `af_bella` for the female patient, etc.). The
runtime is audible the moment you finish the LLM setup. The order most
operators run things:

1. Pick an LLM provider, paste the API key — **required**, nothing
   useful happens without it.
2. Optional: switch from Kokoro to another TTS provider (Piper /
   Google / OpenAI). If you do, re-pick a voice on each persona — the
   shipped Kokoro defaults won't be valid for the new provider.
3. Optional: open the agent personas (patient, female patient,
   discussant, nurse, consultant, relative) if you want to change
   their voice, tone, or do/don't lists.
4. Optional: per-case voice override (rare — only for cases that
   need a specific named voice).
5. Tail the boot logs once. A clean boot prints `voice catalogue
   audit clean`. Any other line names the stale row.
6. Run a smoke session through one shipped case in voice mode.

Each step has its own section below.

---

## 1. LLM provider + API key

Settings → Platform → LLM Settings.

| Field | What to set |
|---|---|
| **Provider** | One of `anthropic`, `openai`, `google`, `lmstudio` (local), or any OpenAI-compatible endpoint. |
| **Model** | Anthropic: `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`. OpenAI: `gpt-4o-mini` and friends. LMStudio: whatever you have loaded locally. |
| **Base URL** | Only if your provider needs one (LMStudio is `http://localhost:1234/v1`). Anthropic/OpenAI/Google leave blank. |
| **API key** | Stored in `platform_settings`, redacted in audit logs. Required for hosted providers. |
| **Max output tokens / Temperature** | Leave blank to use the provider default. Set explicitly only if you have a reason. |
| **System Prompt Template** | **Leave empty.** The text is appended *after* the case-specific persona; with anything set, every case carries the same trailing reminder. The shipped default was historically prepended (and shadowed the case persona); that's now gone — see [`server/routes/admin-routes.js`](../server/routes/admin-routes.js) `DEFAULT_LLM_SETTINGS`. |

Save and click **Test connection** — the row shows green if the
provider responds.

---

## 2. TTS provider (optional change)

A fresh install ships with **Kokoro** as the active TTS provider and
every shipped persona has a Kokoro voice already picked. If that works
for you, skip this section.

Settings → Platform → Voice.

| Provider | When to use | Models needed |
|---|---|---|
| **Kokoro** (local, default) | Offline / classroom. Fast, English-only, ~50 voices. | Already bundled. First-call warmup ~2s. |
| **Piper** (local) | Multilingual, lower quality. Per-voice `.onnx` files. | `bash deploy/install-piper.sh` and drop voices into `server/data/piper/`. |
| **Google** (cloud) | Most natural prosody. | Google Cloud TTS API key. |
| **OpenAI** (cloud) | Six voices (`alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`). | Reuses your OpenAI LLM key by default. |

### If you switch providers, re-pick voices on each persona

The shipped Kokoro voice ids (`am_michael`, `af_bella`, etc.) are not
valid for Google / OpenAI / Piper. After switching, open each persona
in Settings → Agent Personas and pick a voice from the new provider's
catalogue. The boot audit (§ 5) names every stale row.

### Rate and pitch

Platform-wide defaults for speed (`0.8` – `1.2` is typical) and pitch
(semitones; `0` is neutral). Per-persona overrides on each agent row;
per-case overrides in the case editor's voice panel.

---

## 3. Shipped agent personas

Settings → Agent Personas.

Six rows ship with `is_default = 1`, each carrying its own voice. Voice
resolution is one-tier: **whatever `case_voice` is set on the persona
(or overridden on the case) is what plays.** There is no demographic
slot fallback — every persona has an explicit voice, period.

| Persona | Agent type | Shipped Kokoro voice |
|---|---|---|
| **Default Patient** | patient | `am_michael` (male) |
| **Default Female Patient** | patient | `af_bella` (female) |
| **Default Discussant** | discussant | `bm_lewis` (British male) |
| **Sarah Mitchell** | nurse | `af_sky` (female) |
| **Dr. James Chen** | consultant | `am_liam` (male) |
| **Family Member** | relative | `af_nicole` (female) |

Patient persona pick: ChatInterface compares `config.voice.gender` on
each `is_default=1` patient template against the case's
`demographics.gender` (case-insensitive first letter). A female case
picks `Default Female Patient`; otherwise `Default Patient`. No
gender-blind fallback — if your case has a gender that doesn't match
any shipped persona, attach one explicitly in the case editor.

What to edit (and what to leave alone):

- **`case_voice`** — change whenever you want a different voice on a
  persona. Pick from the picker in the persona editor; never paste a
  raw voice id from another provider.
- **`gender`** — only the patient personas use this for case routing.
  Don't change `male` ↔ `female` on the shipped Default Patient and
  Default Female Patient rows; those decide which case inherits which.
- **System prompt** — carries the in-character ruleset. Edit per
  deployment if you want different speech patterns; rarely needs
  changing.

---

## 4. Per-case overrides (optional)

Settings → Cases → edit a case → Voice tab.

You only need this for cases that need a *specific* voice (e.g. a
named actor, an accent, a celebrity-style impression for a teaching
moment). Most cases should leave per-case voice empty and inherit
from the persona + platform slot.

Per-case `case_voice` always wins (`tier · override`).

---

## 5. Boot audit + diagnostic bar

### Boot audit

On every server start, [`voiceCatalogueAudit`](../server/healthChecks/voiceCatalogueAudit.js)
checks whether stored voices are still valid for the active provider:

| Log line | What it means | Fix |
|---|---|---|
| `voice catalogue audit clean` | Everything stored matches the active provider's catalogue. **You want this.** | — |
| `tts_provider unset; skipping voice catalogue audit` | Platform `tts_provider` isn't set. Fresh installs default to `kokoro` automatically; this only appears if an admin explicitly cleared it. | Set the provider in Settings → Voice. |
| `stale case_voice values detected` | A case or persona has `case_voice` that isn't valid for the active provider (e.g. a Google voice id while Kokoro is active). Every named row is unplayable until re-picked. | Open the named row in the editor and pick a valid voice, OR switch back to the provider that had the voice. |

A clean boot logs exactly one line: `voice catalogue audit clean`. If
you don't see that, fix whatever's named in the warning.

### Diagnostic bar (admins + educators)

Bottom of the screen, hidden by default. Enable via the floating
"Diag" pill in the bottom-right corner. Toggle persists per user.

What's there:

- **Voice runtime** — which voice the active speaker is *currently*
  resolving to, with the tier. Resolution is one-tier today: `override`
  (a `case_voice` set on either the case or the agent persona) or
  `null` (nothing set — patient stays mute). If this doesn't match what
  you expected, you've got an override somewhere.
- **Patient prompt** → **Show assembled prompt** — opens the literal
  system prompt the LLM is about to receive, with copy-to-clipboard.
  Use this when "the model is ignoring my case" — odds are something
  upstream is shadowing what you authored.
- **TTS wire history** — last 20 `/api/tts` payloads with voice id,
  status, and a replay button (re-fires the captured payload so you
  can confirm what was actually sent matches what you heard).

---

## 6. Smoke a real session

Pick one shipped case (e.g. `Acute Chest Pain - STEMI` for male voice,
`Septic Shock - Pneumonia` for female voice). Sign in as a student,
start the case, click into voice mode, ask the patient three
questions:

1. *"What brought you in today?"* — patient should answer in lay
   language, in-character.
2. *"Can you describe the pain?"* — verifies the patient is reading
   the structured history; should not invent unrelated symptoms.
3. *"Do I have anything serious?"* — should redirect, not volunteer a
   diagnosis. Tests the persona's "don't volunteer differentials"
   contract.

If the patient answers all three correctly *and* the voice matches the
demographics, you're configured. If something feels off, open the
diagnostic bar → Show assembled prompt and compare what the model
actually saw with what the case editor says.

---

## Common first-run snags

- **Voice plays the wrong gender for a patient.** The case's
  `demographics.gender` doesn't match any shipped patient persona's
  `voice.gender`. Either fix the case's demographics, or attach a
  per-case patient persona with the right voice.
- **Patient stays silent.** The active persona has no `case_voice` set,
  or the value isn't valid for the active TTS provider. Check Settings
  → Agent Personas → pick a voice from the picker. The boot audit will
  also name the row.
- **Model ignores the case demographics.** Open Diagnostic bar →
  Show assembled prompt. If the demographics block is missing, the
  case editor's Demographics tab wasn't saved. If it's there but the
  model still ignores it, your shipped platform LLM system-prompt
  template might be re-introducing competing instructions — leave that
  field empty (§ 1).
- **`tts_provider unset; skipping voice catalogue audit` on every
  boot.** Step 2 was never run. Open Settings → Voice and pick a
  provider.

---

## Pointers

- Source of truth for the resolution chain:
  [`src/utils/voiceResolver.js`](../src/utils/voiceResolver.js) — read
  the header comment before changing anything.
- Patient prompt assembly:
  [`src/components/chat/ChatInterface.jsx`](../src/components/chat/ChatInterface.jsx)
  `buildPatientSystemPrompt()`.
- Shipped default rows (cases, agents, model pricing):
  [`server/db.js`](../server/db.js) and [`server/seeders/`](../server/seeders/).
- Migrations history: [`migrations/`](../migrations/) — every migration
  is additive-only and idempotent.

Once this is done, learner-facing setup (creating cohorts, attaching
cases to courses, configuring grading hooks) is covered in the
educator docs separately.
