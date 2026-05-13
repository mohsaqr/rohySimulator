# Admin first-run checklist

[INSTALL.md](INSTALL.md) gets Rohy running on a machine. This doc covers
what an admin should configure **inside** the running app before
letting learners use it — voices, default personas, LLM provider,
diagnostic bar.

Most of this is one-time setup. Re-read it whenever you switch TTS
providers, swap LLM models, or restore from a backup.

---

## TL;DR

A fresh install ships with sensible defaults for everything except the
LLM. The order most operators run things:

1. Pick an LLM provider, paste the API key — **required**, nothing
   useful happens without it.
2. Verify the active TTS provider matches the voices you intend to
   ship — local (Kokoro / Piper) or cloud (Google / OpenAI).
3. Confirm the platform voice slots for that provider are filled — at
   least `male` and `female`. Add `child` if you have pediatric cases.
4. Sanity-check the two shipped patient personas (`Default Patient`,
   `Default Female Patient`) and the discussant.
5. Tail the boot logs once. The voice-catalogue audit names every
   stale config row in plain English.
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

## 2. TTS provider + platform voice slots

Settings → Platform → Voice.

### Pick a provider

| Provider | When to use | Models needed |
|---|---|---|
| **Kokoro** (local) | Default for offline / classroom. Fast, English-only, 28 voices. | `npm run install-kokoro` once after install. |
| **Piper** (local) | Multilingual, lower quality than Kokoro. Per-voice `.onnx` files. | `bash deploy/install-piper.sh` and drop voices into `server/data/piper/`. |
| **Google** (cloud) | Most natural prosody. Requires a Google Cloud TTS API key. | API key in `GOOGLE_APPLICATION_CREDENTIALS` env or the Voice settings panel. |
| **OpenAI** (cloud) | Six voices (`alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`). Cheap and good. | Reuses your OpenAI LLM key by default. |

### Fill the slots — required

Every patient case falls back to `voice_<provider>_<demographic-slot>`
when no per-case `case_voice` is set. These slots **must** be configured
for the active provider or female / pediatric patients go silent.

Settings → Voice → "Platform voice slots":

| Slot | Maps to | Example (Google) |
|---|---|---|
| `voice_<provider>_male` | Male patients aged 13+ | `en-US-Chirp3-HD-Charon` |
| `voice_<provider>_female` | Female patients aged 13+ | `en-US-Neural2-F` |
| `voice_<provider>_child` | Patients aged <13 (any gender) | `en-US-Chirp-HD-O` |

The diagnostic bar (admins / educators only — see § 5) shows which
slot resolved for the active speaker as `tier · platform-slot`. If
you see `tier · null` and the patient stays mute, the slot for that
demographic is unset or invalid.

### Rate and pitch

Platform-wide defaults for speed (`0.8` – `1.2` is typical) and pitch
(semitones; `0` is neutral). Per-case overrides live in the case
editor's voice panel.

---

## 3. Shipped agent personas

Settings → Agent Personas.

Three rows ship with `is_default = 1`:

| Persona | When it's used |
|---|---|
| **Default Patient** | Picked for any case whose demographics aren't female (`gender !~ /^f/i`). Voice falls through to `voice_<provider>_male`. |
| **Default Female Patient** | Picked when the case's `demographics.gender` starts with `f`. Voice falls through to `voice_<provider>_female`. |
| **Default Discussant** | Used in case debriefs. |

What to check:

- **Each row's voice config has `case_voice` unset.** If `case_voice` is
  set on a patient persona that is_default=1, every inheriting case
  silently plays that one voice — including for the wrong demographic.
  This was the cause of a three-week "wrong voice everywhere" bug. The
  boot audit (§ 5) names this footgun on every start.
- **`gender`** on the persona's voice config decides which gender of
  case picks it. `Default Patient` ships with `male`, `Default Female
  Patient` with `female`. Don't change these unless you understand the
  consequences for case routing.
- **System prompt** carries the in-character ruleset. Edit per
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
checks three classes of misconfig and logs to journalctl /
`docker compose logs`:

| Warning | What it means | Fix |
|---|---|---|
| `tts_provider unset; skipping voice catalogue audit` | Step 2 not done yet. | Set the provider. |
| `stale case_voice values detected` | A case or persona has `case_voice` that isn't valid for the active provider (e.g. a Google voice id while Kokoro is active). Every named row is unplayable until re-picked. | Open the named row in the editor and pick a valid voice, OR switch back to the provider that had the voice. |
| `patient persona is_default carries case_voice override` | A default patient template forces every inheriting case to one voice and shadows the platform slots. Almost always a footgun. | Clear `case_voice` on the named persona in Settings → Agent Personas, OR delete it via SQL: `UPDATE agent_templates SET config = json_remove(config, '$.voice.case_voice') WHERE id = <id>;` |
| `platform voice slot misconfigured` | A `voice_<provider>_<slot>` setting is unset or stores an invalid voice id. Patients of that demographic go silent. | Set the slot in Settings → Voice. |

**A clean boot logs exactly one line:** `voice catalogue audit clean`.
If you don't see that, fix whatever's named above.

### Diagnostic bar (admins + educators)

Bottom of the screen, hidden by default. Enable via the floating
"Diag" pill in the bottom-right corner. Toggle persists per user.

What's there:

- **Voice runtime** — which voice the active speaker is *currently*
  resolving to, with the tier (`override` / `platform-slot` / `null`).
  If this doesn't match what you expected, you've got an override
  somewhere.
- **Patient prompt** → **Show assembled prompt** — opens the literal
  system prompt the LLM is about to receive, with copy-to-clipboard.
  Use this when "the model is ignoring my case" — odds are something
  upstream is shadowing what you authored.
- **TTS wire history** — last 20 `/api/tts` payloads with voice id,
  status, and an A/B play button (replays the request next to the
  configured platform slot for the same gender, so you can hear
  whether the wire matches the configured voice).

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

- **Voice plays a male voice for a female patient.** A patient persona
  template has `case_voice` set (almost always to a Google voice id
  carried over from a different provider). § 5 names the row; clear
  it.
- **Patient stays silent.** Either tier 2 has nothing to read
  (`voice_<provider>_female` unset — § 2) or the active provider is a
  cloud one with no API key (§ 1).
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
