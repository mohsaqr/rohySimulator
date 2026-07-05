# Treatments & medications

You order and give treatments from the **Treatments** panel on the patient
screen. Treatments act on the patient over time and feed into the vitals
engine, so what you give — and when — matters.

## Open the Treatments panel

On the **Patient** screen, a strip of buttons floats just above the bottom
navigation bar. Click **Treatments**. A drawer opens with the treatment
catalogue and your current orders.

## Order a treatment

1. Search or browse for the treatment you want and select it.
2. Fill in the order form:
   - **Dose** — a value and a unit (for example `5` and `mg`).
   - **Route** — how it is given (for example IV, oral, IM). A default
     route is suggested where the treatment defines one.
   - **Frequency** — for example once or a repeating schedule.
3. Submit the order. It appears in your active orders list with the status
   **Ordered**.

## Contraindication and high-alert warnings

When you order, the simulator checks the treatment against the patient.

- If the treatment may be **contraindicated** for this patient, you get a
  warning describing why. The order is still placed — the decision, and
  acting on the warning, is yours.
- **High-alert** medications show a caution to verify dose and route, and
  are flagged in the orders list.

::: tip Read the warning, don't just click through
A contraindication warning is part of the scenario's teaching. Note it,
decide deliberately, and be ready to explain your reasoning in the
[debrief](/trainee/debrief).
:::

## Administer and discontinue

An order moves through statuses you act on from the orders list:

- **Ordered** — placed but not yet given. Click **Administer** to give it.
  Administering is what starts the treatment's effect on the patient.
- **In progress** — being given; you can **Discontinue** it.

Watch the [monitor](/trainee/vitals) after you administer — the patient's
vitals respond to treatment over time, and a manually pinned vital set by
your instructor is preserved across those changes.

## Records and memory

The same floating strip has **Records** (the patient's existing clinical
records for this case) and **Memory** (what the patient record has captured
about your session so far). Use them to check what is already known before
you treat.

## Next steps

- [Vitals & alarms](/trainee/vitals)
- [Ordering labs & imaging](/trainee/investigations)
- [Debrief](/trainee/debrief)
