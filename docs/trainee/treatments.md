# Treatments & medications

You order and give treatments from the **Treatments** panel on the patient
screen. Treatments act on the patient over time and feed into the vitals
engine, so both what you give and when you give it matter.

## Open the Treatments panel

On the **Patient** screen, a strip of buttons floats above the bottom
navigation bar. Click **Treatments**. A drawer opens with the treatment
catalogue and your current orders.

## Order a treatment

1. Search or browse for the treatment you want and select it.
2. Fill in the order form:
   - **Dose**: a value and a unit (for example `5` and `mg`).
   - **Route**: how it is given (for example IV, oral, IM). A default
     route is suggested where the treatment defines one.
   - **Frequency**: for example once or a repeating schedule.
3. Submit the order. It appears in your active orders list with the status
   **Ordered**.

## Contraindication and high-alert warnings

When you order, the simulator checks the treatment against the patient.

- If the treatment may be **contraindicated** for this patient, you get a
  warning describing why. The order is still placed. The decision, and
  acting on the warning, is yours.
- **High-alert** medications show a caution to verify dose and route, and
  are flagged in the orders list.

::: tip Read the warning before you click through
A contraindication warning is part of the scenario's teaching. Note it, make
a considered decision, and be ready to explain your reasoning in the
[debrief](/trainee/debrief).
:::

## Give and stop a treatment

An order moves through statuses you act on from the orders list:

- **Ordered**: placed and awaiting administration. Click **Give** to give
  it. Giving it starts the treatment's effect on the patient.
- **In progress**: being given; click **Stop** to discontinue it.

Watch the [monitor](/trainee/vitals) after you give a treatment. The
patient's vitals respond over time, and a manually pinned vital set by your
instructor is preserved across those changes.

Under the monitor, the **Active Treatments** panel lists each drug acting on
the patient with its own change to the vital signs, for example
`Atropine HR +12`. When more than one is active, the sum is shown underneath.

## Records

The same floating strip has **Records**: the patient's existing clinical
records for this case. Use it to check what is already known before you
treat.

## Next steps

- [Vitals & alarms](/trainee/vitals)
- [Ordering labs & imaging](/trainee/investigations)
- [Debrief](/trainee/debrief)
