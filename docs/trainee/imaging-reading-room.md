# The PACS reading room

**PACS** is the imaging workstation: a worklist of studies, a series rail,
one to four image panes, window and level controls, measurement tools, and
a pane for the report you write. You order the study in the **Radiology**
room, described in [Ordering labs & imaging](/trainee/investigations), and
read its pixels here: the radiology information system carries the order
and the text report, the PACS carries the pictures, and you cross the same
boundary a clinician does.

## When the room appears

The room sits in the same bottom navigation bar as every other room, one
place after **Radiology**, labelled **PACS** with the subtitle
**workstation**. It appears when both of these hold:

- Your institution runs the `advanced` release channel. A `current`-channel
  install ships without the PACS room.
- The case has something for you to open: an educator wired imaging into
  the case, or you have ordered an imaging study in this session.

## Pick a study

The **Imaging worklist** fills the left column. Each row shows the study
description, a line of detail, and a two-letter modality badge such as
`CT`, `MR`, `XR`, `US` or `NM`. A green dot marks a study you can open, and
the first ready study opens on its own when you arrive. Where the worklist
runs past eight studies, a **Search studies** box appears above it and
filters on description, modality and accession.

The detail line on a row is its status:

- **Ordered**: the study is ready to read.
- **Reporting — images not released yet**: the order is still within its
  turnaround, so the row is dimmed. Wait it out, as you would a lab result.
- **No images for this study**: the archive holds no material for this
  study. The row is dimmed and carries a warning icon.

With no studies at all, the column reads
*No imaging has been ordered for this patient.*

## Series and panes

The **Series** rail on the right gives every series in the open study a
thumbnail, with its description, its plane or modality, the slice spacing,
and the number of images in the corner. A series already on screen carries
the number of the pane holding it, and two warnings can appear under a
stack: **Irregular slice spacing** and **Ordered by image number**. The
layout buttons at the right of the toolbar hang the study across one pane,
two side by side, or a two-by-two grid, filling them with the study's
series in order.

1. Click a pane to make it the active one; in a multi-pane layout it is
   outlined.
2. Click a thumbnail in the rail to load that series into the active pane.
3. The toolbar, the presets and the shortcuts act on the active pane.

## Move through a stack

The wheel scrolls the stack, the slider along the pane footer jumps
anywhere in it, and the track down the right edge of the image does the
same by dragging. The footer counts your position as `12/240` and, beside
it, the share of distinct slices you have reviewed. The play button runs
the stack as cine, and **Space** starts and stops it. With the image
focused, the arrow keys step one slice (hold **Shift** for ten), **Page
Up** and **Page Down** step ten, and **Home** and **End** jump to the ends
of the stack.

## Window width and level

Windowing decides which range of recorded values you see. **Window** is the
tool the room opens with: drag left and right for the width, up and down
for the level. The top-right corner of the image reads back `W` and `L` as
numbers. The **Image** panel carries the same two under **Window / level**,
each a slider with an editable number beside it: **Width**, hinted
*Narrower = more contrast*, and **Level**, hinted *Lower = brighter*.

**Window presets** sits in the toolbar, and each option prints its own
numbers. On CT they are absolute Hounsfield values: Lung, Mediastinum,
Abdomen, Liver, Bone, Brain, Stroke, Subdural and Angio. On modalities with
no absolute scale, such as radiographs, they are relative to the window the
study was stored with: As acquired, Soft tissue, High contrast, Bone and
Penetrated. Keys `1` to `9` apply the first nine directly, and once you
drag away from a preset the control reads **Custom**.

Under **Transfer function** you choose **Linear** or **Sigmoid** and set
**Gamma**; sigmoid rolls contrast off at both ends, holding the apices and
the abdomen of one film together. Under **Detail**, **Edge enhancement**
sharpens the picture and **Interpolate when zoomed out** smooths it below
1:1. **Reset to as acquired** returns the panel to the window the study
arrived with.

::: tip Display controls stop at the display
Edge enhancement, gamma and the window act on the picture you see, while
the values behind it stay as the scanner recorded them. The cursor readout
and both measurement tools report those acquired values whatever the panel
is set to: *Display only — measurements are unaffected*.
:::

## Look, and measure

The remaining tools are **Zoom** (`Z`), **Pan** (`P`), **Distance** (`D`)
and **Region** (`E`); **Window** is `W`. Beside them sit **Invert** (`I`),
**Rotate 90°** (`R`), **Flip horizontal** (`H`), **Flip vertical** (`V`)
and **Reset view** (`0`); double-clicking the image resets it too, and the
orientation letters at the edges follow every rotation and flip. Hovering
prints the pixel coordinates and the value under the cursor at the bottom
left, in the image's own units (`HU` on CT).

1. Choose **Distance** and drag a line. It reads in millimetres where the
   study declares its pixel spacing, and in pixels otherwise.
2. Choose **Region** and drag outward from the centre of the circle. It
   reads back the mean and standard deviation inside it.
3. Both land in the **Measurements** list at the bottom of the right panel,
   with the slice each was taken on and a control to delete it.

A click with no drag leaves nothing behind. Your measurements are saved
with the session and come back when you return to the room.

## Write the report

The **Report** section of the right panel takes two free-text fields:
**Findings** (*What you see*) and **Impression** (*What it means*). Under
them the room counts what it observed while you read: **Series opened**,
**Images reviewed** and **Measurements**, described on screen as *Attached
automatically — what the room observed, not what the report claims*.
**Copy** puts the whole composed report on your clipboard. Until one of the
two fields has text in it, an amber line notes that a report needs
findings, an impression, or both.

::: warning Keep a copy before you leave
Your measurements are held with the session; the text you type into
**Findings** and **Impression** lives in the panel while the room is open.
Press **Copy** once you are happy with it, and paste it where your
instructor expects it.
:::

## What the room withholds from you

An educator authors a case against an answer key: the expected findings,
the key images, the reading thresholds. The server strips that key from the
case document for every learner role, so it is absent from the room and
from anything the browser can be made to show. The archive of studies is
reduced the same way, to identity and series, keeping the pathology
library's names out of the one room where they would give the case away.

## The room is empty

Bulk imaging is large, so it lives on a content origin your operator
configures separately from the simulator. Where that content is absent, the
room still opens and reports what it has, study by study: rows dimmed with
**No images for this study**, or a pane reading *This study could not be
loaded.* Tell your instructor or administrator, who can check whether
imaging content is installed for this deployment.

## Next steps

- [Ordering labs & imaging](/trainee/investigations)
- [The rooms](/trainee/rooms)
- [Debrief](/trainee/debrief)
