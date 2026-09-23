# Authoring a case (wizard)

The step-by-step case wizard builds a complete clinical case: patient,
presentation, vitals, labs, imaging, exam findings, treatments and agents.

Open **Settings → Cases**, then create a new case or edit an existing one to
enter the wizard. You can jump between steps freely using the step strip; the
draft auto-saves and shows a last-saved time.

## The steps

The wizard has up to thirteen steps. They are, in order:

1. **Demographics**: patient name, age, gender, weight, height/BMI and the
   identity fields the simulated patient uses.
2. **Avatar**: the patient's 3D head and its framing. See
   [Agent personas](/educator/agents) for how avatar precedence works.
3. **Story**: the case description and the patient's system prompt: who they
   are, their symptoms, history and personality. This is the narrative the
   patient agent speaks from.
4. **Scenario**: the keyframed vitals/state timeline. You can start from a
   built-in or public template. See [Scenario timelines](/educator/scenarios).
5. **Vitals**: the patient's starting vitals (HR, SpO₂, RR, temp, BP,
   EtCO₂). When a scenario is set, its first keyframe defines these; the
   wizard flags when manual vitals differ from the scenario's first frame.
6. **Labs**: the lab results the case exposes when a trainee orders them.
7. **Radiology**: imaging studies and their findings.
8. **Exam**: physical examination findings by system.
9. **Records**: the clinical record: chief complaint, present illness, risk
   factors, differential, management plan and structured history. History
   fields written here mirror into the canonical clinical record the runtime
   reads.
10. **Treatments**: the treatments available for this case and their
    configured effects.
11. **Agents**: the personas attached to the case, such as the patient, the
    discussant and a consultant. Edit a persona from here to open the
    [Agent persona editor](/educator/agents).
12. **Plugins**: material for plugin rooms such as Pathology, the ECG and
    PACS. The step appears only when an installed plugin has an editor.
13. **Rooms**: which rooms learners get on this case. See
    [Choosing the rooms](#choosing-the-rooms).

::: tip
You do not have to fill every step before saving. Author the demographics,
story and scenario first, run the case yourself, then return to refine labs,
imaging, exam and treatments.
:::

## Choosing the rooms

Every room is on by default except **Bedside**, the immersive 3D room. Bedside
examines the patient too, which duplicates the **Examination** room, so for now
a case gets it only when you switch it on. In the **Rooms** step you can switch
any room on or off except **Patient**, where the case is played. A case built around the
history and a set of slides, for example, can keep Patient and Pathology and
switch off everything else.

A room you switch off is hidden and locked for learners:

- It has no tab in the room bar and cannot be entered.
- The server refuses its actions. Lab and imaging orders, examination
  findings and the debrief conversation all answer with an error.
- Anything configured for it is kept. Switching the room back on restores it
  unchanged.

It also changes two things elsewhere:

- **The on-call phone.** The phone is on every case. A specialist whose rooms
  are all off is still listed, but does not answer: the call rings and ends
  with "No answer". The radiologist answers while either Radiology or PACS is
  on.
- **End & Debrief.** With the **Consultant** room off, End & Debrief ends the
  case and opens the case summary. A **Case summary** button then reopens it.

A plugin room such as Pathology also needs material to appear: switching it
on does not show an empty room. A session that is already running keeps the
rooms it started with.

## Quick start with persona defaults

The wizard can pre-fill a worked example (a 62-year-old angina presentation)
across demographics, story, vitals and records. Use it to see how a complete
case is shaped, then edit it into your own scenario.

## Templates

The **Scenario** step offers built-in deterioration/recovery templates plus
any public custom scenarios shared in your tenant. Picking a template seeds
the timeline; you can then edit keyframes. See
[Scenario timelines](/educator/scenarios).

## After authoring

- Assign the case to a class. See [Assigning cases](/educator/assigning-cases).
- A running session freezes the case at start time, so edits you make to a
  case stay out of a session already in progress
  ([Case snapshot in the glossary](/reference/glossary)).

## Reference

- API: [cases endpoints](/reference/api/cases)
- Glossary: [Case, Scenario / timeline, Agent / persona](/reference/glossary)
