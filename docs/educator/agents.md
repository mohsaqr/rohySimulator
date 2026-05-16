# Agent personas

An **agent** is an LLM-driven character — the simulated patient, the debrief
discussant, a consultant, a nurse, and so on — with its own identity, system
prompt, voice, avatar and behaviour. You edit them in the full-page **Agent
persona editor**, reachable from the **Agents** step of the
[case wizard](/educator/case-wizard) or from **Settings → Agent Personas**.

## Agent types

The editor supports these types:

| Type | Role |
|---|---|
| **Patient** | The simulated patient persona |
| **Discussant** | The case debrief tutor (post-case discussion) |
| **Nurse** | Bedside nursing staff |
| **Consultant** | Specialist physicians |
| **Family member** | Patient family members |
| **Pharmacist** | Pharmacy consultation |
| **Technician** | Lab / radiology technicians |
| **Other** | Custom agent type |

## What you configure

The editor groups every concern on one page:

- **Identity** — name and role title.
- **Avatar** — the 3D head used when this agent speaks.
- **Voice** — the speaking voice (preview it in the editor).
- **System prompt** — the instructions that define who the agent is and how
  it behaves. For a patient this is the case story; for a discussant it is
  how the debrief is run.
- **Dos / don'ts and behaviour** — communication style
  (**Professional**, **Educational**, **Emotional**, **Concise**) and
  conversational constraints.
- **LLM** — leave on **Use Platform Default**, or override the provider
  (**OpenAI**, **Anthropic**, **OpenRouter**, **Custom Endpoint**) and its
  endpoint/key for this persona.
- **Memory access** — which categories of what the trainee did the agent is
  allowed to "know": History (OBTAINED), Physical Exam (EXAMINED), Tests
  (ELICITED), Observations (NOTED), Orders (ORDERED), Administered, Changes
  (CHANGED), Communication (EXPRESSED). This is the "things the AI knows vs.
  things the trainee must discover" model — restrict it so an agent does not
  reveal findings the learner has not yet uncovered.
- **Context filter** — how much patient data the agent sees: **Full
  Context**, **History Only**, **Vitals Only**, or **Minimal**.
- **Unlock trigger** — when the agent becomes available: **After case ends
  (debrief)** or **Always available**. The discussant is the debrief carve-out.

## Voice precedence

An agent's configured voice is one tier of a five-tier resolution:
**platform → case → agent → session → user**. A per-case patient voice must
not leak into the discussant — this is a locked invariant. If a voice does
not sound as expected, check which tier is winning rather than only the
agent's own voice field.

## Defaults

Built-in (`is_default`) personas can be reset to their shipped definition
from the editor. The reset round-trips through a dedicated server endpoint so
the canonical defaults stay the single source of truth — your custom personas
are unaffected.

## Reference

- API: [agents endpoints](/reference/api/agents)
- Glossary: [Agent / persona, Case snapshot](/reference/glossary)
- Author the case around the persona:
  [case wizard](/educator/case-wizard)
