# Scenario timelines

A **scenario** is the keyframed progression of a patient's vitals and state
over the run. You set it in the **Scenario** step of the
[case wizard](/educator/case-wizard).

## How a timeline works

A scenario has a **duration** (in minutes) and a **timeline**: an ordered
list of keyframes. Each keyframe carries:

- a **time** offset (seconds from the start of the run),
- a **label** describing what is happening clinically at that point,
- **params** — the target vitals at that time (`hr`, `spo2`, `rr`, `bpSys`,
  `bpDia`, `temp`, `etco2`),
- **conditions** — ECG/state flags such as ST elevation (`stElev`), PVCs
  (`pvc`), wide QRS (`wideQRS`), T-wave inversion (`tInv`) and waveform
  `noise`,
- optionally a **rhythm** (e.g. `NSR`) on the first keyframe.

The vitals engine interpolates between keyframes, so the patient drifts
smoothly from one clinical state to the next over the timeline rather than
jumping.

## Built-in templates

The wizard ships ready-made deterioration and recovery patterns you can start
from, including:

- **Septic Shock Progression** — vasodilation to severe hypotension and
  hypoxia.
- **STEMI Progression** — acute MI progressing to cardiogenic shock.
- **Hypertensive Crisis** — rapid BP rise toward end-organ damage.

…and others. Pick a template to seed the timeline, then edit any keyframe's
time, label, vitals and conditions to fit your case. Public custom scenarios
shared in your tenant also appear in the picker.

## Authoring guidance

- The **first keyframe** (time 0) defines the patient's starting state. The
  wizard flags when the case's manual **Vitals** step disagrees with this
  frame — keep them consistent so the case opens the way you intend.
- Use the **label** field generously: it is the clinical narrative of the
  deterioration and helps you reason about the curve you are building.
- Adjust the **duration** to match how long you expect the encounter to run.

## How it interacts with treatments

The live patient state is the scenario timeline **plus** the time-decaying
treatment effects a trainee applies. A manually pinned vital/rhythm/condition
is preserved across engine ticks (the override guard), so deliberate
instructor or trainee interventions are not silently overwritten by the
timeline.

## Reference

- Glossary: [Scenario / timeline, Treatment effects engine](/reference/glossary)
- Build the rest of the case: [case wizard](/educator/case-wizard)
