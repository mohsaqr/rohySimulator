# Authoring a case (wizard)

Build a complete clinical case — patient, presentation, vitals, labs,
imaging, exam findings, treatments and agents — with the step-by-step case
wizard.

Open **Settings → Cases**, then create a new case or edit an existing one to
enter the wizard. You can jump between steps freely using the step strip; the
draft auto-saves and shows a last-saved time.

## The 11 steps

The wizard has eleven steps. They are, in order:

1. **Demographics** — patient name, age, gender, weight, height/BMI and the
   identity fields the simulated patient uses.
2. **Avatar** — the patient's 3D head and its framing. See
   [Agent personas](/educator/agents) for how avatar precedence works.
3. **Story** — the case description and the patient's system prompt: who they
   are, their symptoms, history and personality. This is the narrative the
   patient agent speaks from.
4. **Scenario** — the keyframed vitals/state timeline. You can start from a
   built-in or public template. See [Scenario timelines](/educator/scenarios).
5. **Vitals** — the patient's starting vitals (HR, SpO₂, RR, temp, BP,
   EtCO₂). When a scenario is set, its first keyframe defines these; the
   wizard flags when manual vitals differ from the scenario's first frame.
6. **Labs** — the lab results the case exposes when a trainee orders them.
7. **Radiology** — imaging studies and their findings.
8. **Exam** — physical examination findings by system.
9. **Records** — the clinical record: chief complaint, present illness, risk
   factors, differential, management plan and structured history. History
   fields written here mirror into the canonical clinical record the runtime
   reads.
10. **Treatments** — the treatments available for this case and their
    configured effects.
11. **Agents** — the personas attached to the case (patient, discussant,
    consultant, etc.). Edit a persona from here to open the
    [Agent persona editor](/educator/agents).

::: tip
You do not have to fill every step before saving. Author the demographics,
story and scenario first, run the case yourself, then return to refine labs,
imaging, exam and treatments.
:::

## Quick start with persona defaults

The wizard can pre-fill a worked example (a 62-year-old angina presentation)
across demographics, story, vitals and records. Use it to see how a complete
case is shaped, then edit it into your own scenario rather than authoring
from a blank form.

## Templates

The **Scenario** step offers built-in deterioration/recovery templates plus
any public custom scenarios shared in your tenant. Picking a template seeds
the timeline; you can then edit keyframes. See
[Scenario timelines](/educator/scenarios).

## After authoring

- Assign the case to a class — see [Assigning cases](/educator/assigning-cases).
- A running session freezes the case at start time, so edits you make to a
  case do not bleed into a session already in progress
  ([Glossary — Case snapshot](/reference/glossary)).

::: warning
Rohy is a simulation for education. Authored cases are teaching artefacts,
not clinical guidance, and must never be used for real patient care.
:::

## Reference

- API: [cases endpoints](/reference/api/cases)
- Glossary: [Case, Scenario / timeline, Agent / persona](/reference/glossary)
