# Vitals & alarms

The patient monitor fills the right side of the **Patient** screen. It runs
the patient's vital signs in real time and raises alarms when a vital goes
out of range — exactly the signal you act on during the case.

::: warning Training only
The monitor and its alarms are simulated. Waveforms and numbers are
generated for the scenario and are not medical advice.
:::

## Reading the monitor

The monitor shows the patient's vital signs, typically:

- **HR** — heart rate, with an ECG waveform
- **BP** — blood pressure
- **SpO2** — oxygen saturation
- **RR** — respiratory rate
- **Temp** — temperature
- **EtCO2** — end-tidal CO2 (when the case uses it)

Which fields are shown can depend on the case and your instructor's
platform settings, so a given case may not display every one.

The monitor also runs a cardiac **rhythm** (for example normal sinus rhythm,
atrial fibrillation, a ventricular rhythm, or asystole). The ECG waveform is
drawn from the current heart rate and rhythm.

Vitals are **live**. They follow the case timeline, respond to
[treatments](/trainee/treatments) you administer, and any vital your
instructor has manually pinned is held steady even as other effects play
out.

## Alarms

When a vital crosses its threshold, an alarm fires through the simulator's
central notification system. You will see it as an on-screen alert (and hear
it, unless alarms are muted). Critical breaches are louder than warnings.

An alarm **latches** — it stays visible while the vital is still out of
range so you do not miss it, rather than flickering on and off.

## Acknowledging an alarm

In the monitor's alarm controls each active alarm has an action:

1. Open the alarm controls on the monitor (the alarm/bell control).
2. For a single alarm, click **Acknowledge**. To clear them together, use
   **Acknowledge All**.
3. You can also **snooze** (silence) an alarm for a period, or toggle the
   monitor's overall **mute**.

Acknowledging or snoozing only silences the *alert* — it does not fix the
patient. The vital is still abnormal until you treat the underlying problem;
a silenced-but-still-abnormal alarm stays listed so you remember it is
outstanding.

::: tip Acks are per case
Acknowledgements and snoozes belong to the current case. Starting a
different case clears them, so an alarm you silenced earlier will not stay
silent in a new patient. Refreshing the page keeps your current case's acks
intact.
:::

## What is recorded

Alarms firing and your acknowledgements are part of the session record your
instructor reviews. How quickly you notice and respond to a deteriorating
patient is part of the picture the [debrief](/trainee/debrief) reflects on.

## Next steps

- [Treatments & medications](/trainee/treatments)
- [Voice mode](/trainee/voice)
- [Debrief](/trainee/debrief)
