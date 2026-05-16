# Walkthrough: acute cases

A teaching tour of the six acute emergency scenarios shipped by the
acute-cases seeder (`server/scripts/seed-acute-cases.cjs`). These are
additive — they are not part of the default seed. An operator adds them with:

```bash
node server/scripts/seed-acute-cases.cjs
```

See the [operator quickstart](/tutorials/operator-quickstart) for where this
fits in local bring-up.

::: warning Training only
Every patient, presentation, lab and treatment below is simulated for
teaching. Nothing here is medical advice or clinical guidance.
:::

Each case is listed with its exact name and one-line presentation as defined
in the seeder, then a short note on what it teaches and suggested learner
objectives. Run any of them with the
[trainee quickstart](/tutorials/trainee-quickstart); assign them to a class
with [Assigning cases](/educator/assigning-cases).

## The six acute cases

### 1. Massive Pulmonary Embolism

> 42-year-old female with sudden onset severe dyspnea, chest pain, and
> near-syncope 5 days post-op from knee surgery. High-risk PE with
> hemodynamic instability.

**What it teaches.** Recognising high-risk PE in a post-operative,
immobilised patient and acting on hemodynamic instability rather than
waiting for confirmation.

**Suggested objectives.** Elicit the post-op and risk-factor history; build
a pre-test probability before imaging; recognise the instability that
escalates management; justify the treatment decision in the
[debrief](/trainee/debrief).

### 2. Acute Left MCA Stroke - tPA Window

> 71-year-old male with sudden onset right-sided weakness, facial droop, and
> aphasia. Last known well 90 minutes ago. Atrial fibrillation not on
> anticoagulation.

**What it teaches.** Time-critical stroke assessment inside a therapeutic
window, and the bearing of an untreated atrial-fibrillation history.

**Suggested objectives.** Pin down "last known well" precisely; localise the
deficit; sequence assessment against the clock; reason about the
anticoagulation history when planning treatment.

### 3. Diabetic Ketoacidosis - Severe

> 19-year-old female college student with Type 1 DM presents with nausea,
> vomiting, abdominal pain, and altered mental status. Stopped insulin when
> she ran out.

**What it teaches.** Severe DKA with altered mental status, and an
adherence/access trigger that the history must surface.

**Suggested objectives.** Take a history that uncovers the missed insulin;
order and interpret the relevant labs in the
[Laboratory](/trainee/investigations); prioritise initial management; defend
the order of interventions at debrief.

### 4. Opioid Overdose - Fentanyl

> 24-year-old male found unresponsive in bathroom at a party. Suspected
> fentanyl overdose with severe respiratory depression.

**What it teaches.** Recognition and management of life-threatening
respiratory depression in a found-unresponsive patient with a collateral
history only.

**Suggested objectives.** Work a case where the patient cannot give a
history; recognise the respiratory-depression pattern; choose and time the
reversal treatment; monitor the response on the
[vitals monitor](/trainee/vitals).

### 5. Complete Heart Block - Symptomatic

> 67-year-old male with recurrent syncope, profound bradycardia, and
> near-arrest. Requires emergent pacing.

**What it teaches.** Symptomatic high-grade bradyarrhythmia and the
escalation toward emergent pacing.

**Suggested objectives.** Connect recurrent syncope to the rhythm; read the
bradycardia on the monitor; recognise the near-arrest trajectory and act
before deterioration; explain the escalation path at debrief.

### 6. Flash Pulmonary Edema

> 74-year-old female with acute onset severe dyspnea, orthopnea, and pink
> frothy sputum. History of heart failure with new-onset atrial
> fibrillation.

**What it teaches.** Acute decompensated heart failure with a new
precipitant (new-onset atrial fibrillation), and rapid stabilisation of
severe dyspnea.

**Suggested objectives.** Tie the heart-failure history and the new
arrhythmia together; recognise the flash-edema presentation; prioritise
rapid stabilising treatment; reflect on the precipitant in the debrief.

## Using these in teaching

- **As a trainee:** run any case through the
  [trainee quickstart](/tutorials/trainee-quickstart). The diagnosis is not
  shown in the header — you work it out.
- **As a Teacher:** assign the cases relevant to your block via
  [Assigning cases](/educator/assigning-cases), share the join code
  ([educator quickstart](/tutorials/educator-quickstart)), and read
  performance in [Reporting & analytics](/educator/reporting).
- **Authoring your own:** these scenarios are a model for structure — build
  more with the [case wizard](/educator/case-wizard).
