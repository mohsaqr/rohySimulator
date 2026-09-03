# Bedside

**Bedside** puts you at the patient's bedside. The case's patient lies
in bed in a three-dimensional room with the live monitor beside them, and
you can speak to them out loud, examine them by clicking their body, and
open their chart from the bedside table.

The bottom-bar button is labelled **Bedside · immersive patient view**, and it sits
second in the navigation bar, between **Patient** and **Examination**.

## The room is drawn over the Patient room

Bedside is an overlay. When you open it, the Patient screen stays
mounted underneath and keeps working:

- The patient monitor keeps running the physiology, so vitals, rhythms and
  alarms carry on while you are at the bedside.
- The chat conversation stays live. The monitor you see in Bedside
  mirrors the same heart rate, rhythm and ECG waveform as the monitor on the
  Patient screen.

## One patient conversation

There is a single conversation with the patient, shared between the Patient
room and Bedside:

- A question you type in the Patient room is answered here, and the answer
  appears as a caption over the bed.
- A question you speak here is sent through the same handler the chat uses,
  so it lands in the chat transcript your educator reviews, stamped as
  coming from Bedside.

Only one turn runs at a time. While the patient is thinking, the microphone
is disabled until the answer arrives.

## Speaking to the patient

1. The microphone sits at the centre of the bottom of the room, above the
   navigation bar.
2. Click it to start listening, or press the **Space** bar, which toggles
   the same microphone. Space is ignored while your focus is in a text
   field, on a button or link, or while the body map overlay is open.
3. Speak your question. Your words appear live in the caption band under
   **YOU** as they are recognised.
4. The patient's answer appears in the same caption band under their name,
   and is spoken aloud when the case has a voice configured and voice mode
   is enabled on the platform.

Tapping the microphone while the patient is mid-sentence cuts them off, so
you can interrupt the way you would at a bedside.

A **Voice** pill at the bottom left mutes and unmutes the patient's voice.
Clicking it while the patient is speaking stops that sentence. It reads
**Speaking** with a pulsing dot while a line is being spoken.

::: tip Captions carry both speakers
One caption band shows whoever is speaking: your live transcript while the
microphone is open, then the patient's answer once they reply. It holds up
to three lines.
:::

## Examining the patient

1. **Click a region of the patient's body.** A radial examination wheel
   opens over that region.
2. **Pick a technique** from the wheel. The wedges are **Inspect**,
   **Palpate**, **Percuss**, **Auscultate** and **Special**, and only the
   techniques the case model defines for that region are offered.
3. **Special** opens a sub-ring of the named special tests for that region.
4. The finding opens in a chart docked at the left of the room. The
   navigation wheel moves across to the right side while the chart is up,
   and returns when you close it.

The chart is the same finding display as the [Examination
room](/trainee/examination), so auscultation keeps its clickable listening
sites, per-point audio, play and pause, and volume. The square icon in the
chart header expands it to a full-screen reading surface, and **Escape**
leaves full screen or closes the chart.

Exams performed here are recorded exactly like exams performed in the
Examination room: the same finding, the same exam log, and the same entry in
the case summary your educator reads.

An abnormal finding makes the patient wince, tints the region, and prompts a
spoken line.

## The body map

The 3D patient lies supine, so the back is out of reach from the bedside.
Click the **Body map** pill at the bottom left to open the full Examination
room manikin over the room, with its front and back views, technique
selector, findings and exam log. **Escape** or the close button returns you
to the bed.

## Moving the camera

The navigation wheel sits at the left of the room:

1. Click the hub in the middle of the wheel to open it. Hovering over the
   wheel opens it too.
2. Pick a camera view: **Overview** (whole room), **Patient** (bedside
   close-up), **Airway** (head and airway), **Monitor** (vitals screen) or
   **Equipment** (the oxygen and IV side). Number keys **1** to **5** select
   the same five views in that order.
3. The four arrows around the hub step the camera around the bed: up moves
   toward the head, down toward the foot, and left and right walk around the
   bed. An arrow adjusts the view you are already in and leaves the wheel
   open, so you can keep nudging.

Beside the camera views the wheel carries three destinations: **Examine**
opens the examination wheel, **Records** opens the Records drawer, and
**Body map** opens the manikin.

The wheel can be dragged by its hub, and the monitor panel can be dragged by
its header. Both stay where you put them, clamped inside the room.

## The chart and the IV pole

Two objects in the room open the orders drawer:

- The **chart** on the bedside table opens the drawer on its **Records**
  tab.
- The **IV pole** and the **oxygen** station open the drawer on its
  **Treatments** tab.

These are the same drawers you use from the other rooms. See
[Ordering labs & imaging](/trainee/investigations) and
[Treatments & medications](/trainee/treatments).

## Leaving the room

Use the bottom navigation bar to move to any other room. Your conversation,
your exam log and your findings stay with the session, and the case timeline
keeps running.

## Next steps

- [The rooms](/trainee/rooms)
- [Physical examination](/trainee/examination)
- [Voice mode](/trainee/voice)
