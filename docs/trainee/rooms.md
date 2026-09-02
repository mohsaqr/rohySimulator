# The six rooms

The simulator is organised into six **rooms**. They are peers — none is
"deeper" than another, and moving between them does not lose your work.

## The rooms

| Room | Bottom-bar label | What it is for |
|---|---|---|
| Patient | **Patient** · chat | Talk to the patient and take the history |
| 3D Room | **3D Room** · at the bedside | Stand at the bed: the same patient in a 3D room, with the live monitor, and talk to them out loud |
| Examination | **Examination** · physical exam | Perform a physical examination on a body map |
| Laboratory | **Laboratory** · investigations | Order blood and other lab tests, read results |
| Radiology | **Radiology** · imaging | Order imaging studies, read reports |
| Consultant | **Consultant** · debrief | Reflect and review after the case ends |

The **Patient** room is where every case starts and where the patient
monitor and the **Treatments** controls live.

## The 3D Room

The **3D Room** is the same patient, seen from the bedside. It does not
replace the Patient room — it is drawn over it, so the monitor keeps
running and the conversation is the same one:

- Anything you type in the Patient room, or say at the bedside, is one
  conversation. A question asked here shows up in the chat transcript, and
  a reply typed there is captioned here.
- Tap the microphone (or press **Space**) to speak to the patient. The
  reply is spoken aloud when a voice is configured, and always captioned.
- Click a region of the body to open the examination wheel; the finding
  opens the same chart, with the same auscultation sounds, as the
  Examination room. Exams performed here count exactly like exams
  performed there.
- The chart on the bedside table and the IV pole open the **Records** and
  **Treatments** drawers.
- The wheel at the left changes the camera; the arrows at the top step
  around the bed.

Leave the room with the bottom bar, like any other room.

## Moving between rooms

A navigation bar sits along the bottom of the screen on every in-session
surface. It appears once your session has started.

1. Click any room button in the bottom bar to go there.
2. The current room is highlighted with its own accent colour and an
   underline.

Switching rooms never ends your session and never discards what you have
done. You can go to the Laboratory, come back to the Patient, examine them,
then check Radiology — in any order, as many times as you like.

::: tip Visiting the Consultant is not "ending"
Clicking **Consultant** in the bottom bar just navigates there. It does
**not** end the case — the patient's timeline keeps running and you can
navigate straight back. Ending the case is a separate, deliberate action:
**End & Debrief** on the patient screen. See [Debrief](/trainee/debrief).
:::

## The results badge

When a lab or imaging result becomes ready and you have not yet looked at
it, a small count badge appears on the **Laboratory** or **Radiology**
button in the bottom bar. It updates roughly every ten seconds, so you can
keep working in another room and still notice when results land. It clears
once you open the result. See
[Ordering labs & imaging](/trainee/investigations).

## What stays with you

Your session is tied to the case you loaded, not to the room you are in. If
you refresh the page or close and reopen the tab, the simulator brings you
back to the **same room** you were in, with the same case and the same
progress. A session ends only when you click **End & Debrief**, load a
different case, or your instructor ends it.

## Next steps

- [Taking a history](/trainee/history)
- [Physical examination](/trainee/examination)
- [Ordering labs & imaging](/trainee/investigations)
- [Debrief](/trainee/debrief)
