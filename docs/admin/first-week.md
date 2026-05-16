# First-week checklist

This is the order to bring a fresh Rohy install into service. Steps 1–3 are
required before anyone can run a useful session; the rest harden and
populate the platform for a class.

Work top to bottom. Each step says where it lives in the app and what
"done" looks like.

::: warning Medical-education tool
Rohy is a simulation tool for training. It does not provide medical advice
and must not be used for real patient care. Make this clear to every
learner before you open the platform to a class.
:::

## 1. Set the LLM provider and key (required)

Open **Settings → Platform → LLM Settings**.

1. Pick a **Provider** — `anthropic`, `openai`, `google`, `lmstudio`, or
   any OpenAI-compatible endpoint.
2. Set the **Model** for that provider.
3. Set **Base URL** only if the provider needs one (LMStudio uses
   `http://localhost:1234/v1`; leave blank for Anthropic / OpenAI /
   Google).
4. Paste the **API key**. It is stored in `platform_settings` and redacted
   in audit logs.
5. Leave **System Prompt Template** empty unless you have a specific
   reason — any text here is appended to every case persona.
6. Click **Save**, then **Test connection**. The row turns green when the
   provider responds.

Nothing useful happens until this is done. The exact key names are in the
[Config &amp; environment reference](/reference/config/).

## 2. Confirm the voice runtime

A fresh install ships with **Kokoro TTS** as the platform default and a
working voice already picked on every shipped persona, so audio works the
moment step 1 finishes. To change providers, see
[Voice / TTS providers](/admin/voice-providers).

Tail the boot log once. A clean boot prints exactly one line:

```text
voice catalogue audit clean
```

Any other line names a stale row — fix what it names before opening to a
class. The audit reasons are documented in
[Voice / TTS providers](/admin/voice-providers).

## 3. Create the admin and educator accounts

The install seeds a first admin. Create the people who will actually run
classes:

1. Open **Settings → Users**.
2. Create one account per teacher with the **educator** role (surfaced in
   the UI as **Teacher**).
3. Hand each teacher their credentials out of band.

Full instructions, the rank model, and batch import are in
[Users &amp; roles (RBAC)](/admin/users-roles).

## 4. Set platform defaults

Open **Settings → Platform** and review:

- **LLM Settings** rate limits.
- **Notifications &amp; Alarms** routing defaults (see
  [Platform settings](/admin/platform-settings)).
- **User field configuration** — which profile fields are required at
  sign-up.

## 5. Review the clinical catalogue

The platform ships with a seeded lab and medication catalogue. Review and
extend it in **Settings → Lab Tests** and **Settings → Medications**. The
two surfaces (`/api/master` vs `/api/catalogue`) and the scope model are
explained in [Lab &amp; medication editors](/admin/catalogue-editors).

## 6. Smoke a real session

Sign in as a student, start a shipped case, enter voice mode, and ask the
patient three questions. If the patient answers in character and the voice
plays, the platform is configured. Use the diagnostic bar
(**Diag** pill, bottom-right; admins and educators only) to inspect the
assembled prompt if anything is off.

## 7. Hand off to teachers

Teachers create classes, attach cases, and invite students with join
codes. That workflow is in the educator guide, not here. Multi-tenant
deployments should also read [Multi-tenant operations](/admin/multi-tenant)
before onboarding a second organization.

## Re-run this when

- You switch TTS or LLM providers.
- You restore from a backup.
- You stand up a new tenant.
