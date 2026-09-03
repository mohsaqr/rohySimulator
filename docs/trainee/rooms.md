# The rooms

The simulator is organised into **rooms**. They are peers, so none is
"deeper" than another, and moving between them keeps your work.

Five rooms are part of every install. The others are plugin rooms, and they
appear when the case includes the material they present.

## The rooms

| Room | Bottom-bar label | What it is for | Type | When it appears |
|---|---|---|---|---|
| Patient | **Patient** · chat | Talk to the patient and take the history | Core | Always |
| 3D Room | **3D Room** · at the bedside | Stand at the bed with the same patient in 3D, speak to them out loud, examine them | Plugin | When the case enables it |
| Examination | **Examination** · physical exam | Perform a physical examination on a body map | Core | Always |
| Laboratory | **Laboratory** · investigations | Order blood and other lab tests, read results | Core | Always |
| Radiology | **Radiology** · imaging & tests | Order imaging studies, read reports | Core | Always |
| 12-lead ECG | **12-lead ECG** · interpretation | Read and interpret a 12-lead ECG | Plugin | When the case enables it |
| Pathology | **Pathology** · slides | Read histology slides | Plugin | When the case enables it |
| PACS | **PACS** · workstation | Read imaging studies on a viewer | Plugin | When the case enables it |
| Consultant | **Consultant** · debrief | Reflect and review after the case ends | Core | Always |

The bottom bar lists them in this order.

The **Patient** room is where every case starts, and where the patient
monitor and the **Treatments** controls live.

## The 3D Room

The **3D Room** is the same patient, seen from the bedside. It is drawn over
the Patient room, so the monitor keeps running underneath and the
conversation is the same one: a question you type in the chat is answered at
the bedside, and a question you speak at the bedside appears in the chat
transcript. Clicking a body region opens an examination wheel, and the
findings count exactly like Examination-room findings.

See [The 3D Room](/trainee/room-3d) for the full walkthrough.

## Plugin rooms

The 3D Room, 12-lead ECG, Pathology and PACS are plugin rooms. A plugin room
appears in the bottom bar only when the case you are running includes that
material. A case built around an ECG shows the **12-lead ECG** room; a case
with no slides leaves **Pathology** out of the bar.

So a missing **PACS**, **Pathology** or **12-lead ECG** button means the
current case has nothing for that room to show. Those three rooms also ship
only on the `advanced` release channel, so an install on the stock `current`
channel shows the five core rooms plus the 3D Room.

::: tip A missing room is a case detail
A room you saw in one case and miss in the next is a property of the case,
so there is nothing to report and nothing to fix. Ask your instructor if you
expected a study or a slide that the case does not carry.
:::

- [The 3D Room](/trainee/room-3d)
- [Reading imaging in PACS](/trainee/imaging-reading-room)
- [Pathology slides](/trainee/pathology)
- [12-lead ECG](/trainee/ecg)

## Moving between rooms

A navigation bar sits along the bottom of the screen on every in-session
surface. It appears once your session has started.

1. Click any room button in the bottom bar to go there.
2. The current room is highlighted with its own accent colour and an
   underline.

Switching rooms keeps your session running and keeps everything you have
done. You can go to the Laboratory, come back to the Patient, examine them,
then check Radiology, in any order and as many times as you like.

::: tip Visiting the Consultant is not "ending"
Clicking **Consultant** in the bottom bar just navigates there. It does
**not** end the case. The patient's timeline keeps running and you can
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

Your session is tied to the case you loaded, and it follows you between
rooms. If you refresh the page or close and reopen the tab, the simulator
brings you back to the **same room** you were in, with the same case and the
same progress. A session ends when you click **End & Debrief**, load a
different case, or your instructor ends it.

## Next steps

- [The 3D Room](/trainee/room-3d)
- [Taking a history](/trainee/history)
- [Physical examination](/trainee/examination)
- [Ordering labs & imaging](/trainee/investigations)
