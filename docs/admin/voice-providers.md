# Voice / TTS providers

Use this page to choose the text-to-speech provider, supply its key, and
keep voices valid after a provider switch. The controls are in
**Settings → Platform → Voice** and require the **admin** role.

## The four providers

| Provider | Type | Use when | What it needs |
|---|---|---|---|
| **Kokoro** | Local, in-process | Offline / classroom. The shipped default. Fast, English-only. | Bundled. ~2s first-call warmup. |
| **Piper** | Local subprocess | Multilingual, lower quality. | Install Piper on the server and drop voices into `server/data/piper/voices/`. |
| **Google** | Cloud | Most natural prosody. | Google Cloud TTS API key. |
| **OpenAI** | Cloud | Six fixed voices (`alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`). | Reuses the OpenAI key by default. |

A fresh install ships with **Kokoro** active and a valid voice already on
every shipped persona, so audio works immediately after the LLM is
configured.

## Switch provider

1. Open **Settings → Platform → Voice**.
2. Change the **TTS provider**.
3. **Save**.

If the provider is **Piper** and it is not installed on the server, the
tab shows a "Piper is not installed" warning until you install it.

::: danger Re-pick voices after a provider switch
Voice ids are provider-specific. The shipped Kokoro ids (for example
`am_michael`, `af_bella`) are **not valid** for Google / OpenAI / Piper.
After switching, open each agent persona under **Settings → Agent
Personas** and pick a voice from the new provider's catalogue. Any persona
left with a stale id is silent.
:::

## Provider keys

Keys are stored in `platform_settings` and redacted in audit logs. The
exact environment-variable names (`GOOGLE_TTS_API_KEY`, `OPENAI_API_KEY`,
and related signing material) are listed in the
[Config &amp; environment reference](/reference/config/). Never commit a
key, log it, or place it in a support bundle.

OpenAI TTS reuses the OpenAI LLM key by default — if you only set an LLM
key for a different provider, set the OpenAI key explicitly before
selecting OpenAI TTS.

## Default voice and the boot audit

Voice resolution is one-tier: whatever voice is set on the agent persona
(or overridden on the case) is what plays. There is no demographic
fallback. Set the default by picking a voice on each shipped persona.

On every server start the voice-catalogue audit checks stored voices
against the active provider and logs exactly one line on success:

```text
voice catalogue audit clean
```

| Log line | Meaning | Fix |
|---|---|---|
| `voice catalogue audit clean` | Stored voices match the active provider. This is what you want. | — |
| `tts_provider unset; skipping voice catalogue audit` | The provider was explicitly cleared. | Pick a provider in **Settings → Platform → Voice**. |
| `stale case_voice values detected` | A case or persona has a voice id invalid for the active provider. Those rows are silent. | Open each named row and pick a valid voice, or switch back to the provider that had it. |

## Rate and pitch

Platform-wide speed (typically `0.8`–`1.2`) and pitch (semitones; `0` is
neutral) defaults are set on this tab. Personas and cases can override
them. Endpoints for the TTS surface are in the
[proxy API reference](/reference/api/proxy).
