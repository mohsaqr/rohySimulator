# Reading a pathology slide

The **Pathology** room is a whole-slide viewer. You open a scanned slide,
move around it at the magnification you choose, measure and mark what you
find, and write a report on it.

## When the room appears

**Pathology** sits in the bottom navigation bar with the subtitle **slides**,
after the other rooms. It appears when two conditions hold: your Rohy install
runs the `advanced` release channel, and the case carries material you can
open, meaning a slide with a loadable source and scanner optics, or a gross
specimen photograph. For a case with neither, the room stays out of the bar.

A case carrying both kinds gets a tab strip at the top: **Microscopy** for
the scanned slides and **Gross** for specimen photography, each with a count.
The **Gross** tab lists the specimen parts down the left, shows the enlarged
plate with a contact sheet below it, and gives that part's description,
dimensions and weight on the right; a plate's scale bar comes from the width
it declares. The rest of this page is **Microscopy**.

## Opening a slide and moving around it

The case's slides are listed down the left with their labels and stains.
Click one to open it; the first opens by itself when you enter the room.

Drag to pan, scroll to zoom. `V` is the plain **Navigate** mode with no
drawing, and a thumbnail navigator at the bottom right shows where you are on
the whole slide (`N` hides and shows it). The magnification group carries the
objective ladder **1x**, **2x**, **4x**, **10x**, **20x** and **40x**, with
the current power read out beside it. `0` fits the whole slide, `[` and `]`
rotate, and `H` mirrors the view. `B` bookmarks the field you are looking at;
bookmarks appear under **Bookmarked fields** below the slide list, labelled
with their magnification, and clicking one returns you to that view.

Badges across the top left report the current objective (or **no
calibration** when the slide carries no scanner optics), a **scale bar** in
µm or mm, the **field** area of tissue on screen, the **x** and **y** of the
centre of the view, and any rotation or flip in force.

::: tip Greyed-out magnifications
A power the archive cannot resolve is disabled, and its tooltip says
`Nx is beyond this archive — it would be interpolated, not resolved`. A slide
tiled at 10x holds 10x of detail, so 40x would be an enlargement of those
same pixels. Push past the scanned resolution by hand and the badge adds the
word **interpolated**.
:::

## Keyboard shortcuts

Press `?` for the shortcut sheet. It lists these bindings. `Mod` is Cmd on
macOS and Ctrl elsewhere.

| Group | Keys | Does |
|---|---|---|
| Navigate | Arrow keys | Pan left, right, up, down |
| Navigate | Shift + arrows | Pan a whole field in that direction |
| Navigate | `0` | Fit the whole slide |
| Navigate | `[` / `]` / `H` | Rotate 90 degrees left / right, flip |
| Navigate | `N` / `B` | Show or hide the navigator / bookmark this field |
| Magnify | `1` `2` `3` `4` `5` `6` | Go to 1x, 2x, 4x, 10x, 20x, 40x |
| Magnify | `=` / `-` | Next objective up / down |
| Draw | `V` / `S` | Navigate with no drawing / Select and edit |
| Draw | `M` / `A` / `T` | Measure a distance / Arrow / Drop a marker |
| Draw | `R` / `E` / `P` | Rectangle / Ellipse / Polygon |
| Draw | `D` / `F` / `C` | Freehand / Free-form path / Counting frame |
| Edit | `Mod` + `Z` / `Mod` + `Shift` + `Z` or `Mod` + `Y` | Undo / Redo |
| Edit | `Delete`, `Backspace` | Delete the selection |
| Edit | `Esc` | Cancel drawing, then deselect, then close this sheet |
| Edit | `Enter` | Finish a polygon |
| Edit | `Space` / `Shift` + `Space` | Add one to / take one off the count |
| Edit | `?` | Show the shortcut sheet |

Shortcuts are ignored while you are typing in a text box, so a report can
contain the letter `r` and leave your tools alone.

## Marking and measuring

Rectangle, ellipse, arrow and the ruler are drawn by dragging. A polygon is
clicked out vertex by vertex and closed with `Enter` or a double-click.
Freehand and the free-form path are drawn by dragging along the shape. A
marker and a counting frame are placed with one click, and those two tools
stay selected so you can place a run of them; the others hand back to
**Select** once the shape is down.

Measurements come from the scanner's own metadata, so shapes report in
physical units:

- Lengths in µm, switching to mm past 1,000 µm; areas in µm², switching to
  mm² past 1 mm².
- The ruler measures a straight distance. The free-form path measures along
  the curve you drew, which is what a depth of invasion or a distance to a
  margin asks for.
- A counting frame is placed at a fixed area, chosen from **1 mm²**,
  **2 mm²** or **3 mm²** while that tool is active. Count into it with
  `Space` and `Shift` + `Space`, or with the plus and minus buttons on the
  selected frame, and it reports a figure per mm². When the markers you
  dropped inside the frame disagree with the counter, the panel says so.

The **class** button names what your next shape is called: **Tumour**,
**Stroma**, **Necrosis**, **Normal**, **Inflammation**, **Vessel**,
**Mitosis**, **Artefact**, or **Unclassified**. Each has its own colour, and
every shape is drawn with its class name attached. The **Marks** tab lists
every shape with its measurements: select a row to add a note, change its
classification or adjust a counting frame, and use the target button to jump
the view to that shape or the bin button to delete it. A footer totals the
annotated **Area by class**. On the slide itself, `S` selects a shape,
dragging moves it, dragging a handle reshapes it, and a badge beside it
deletes it. The toolbar's file group takes a **snapshot** of the field as a
PNG with the scale bar included, **exports** annotations as QuPath-readable
GeoJSON, **imports** a GeoJSON file, and **clears** the slide's marks.

## Brightness, contrast, gamma and saturation

The sliders button opens **Brightness**, **Contrast**, **Gamma** and
**Saturation**, with **Reset to the scanned image** below them. The panel
states the rule it follows:

> `Display only. These change what you see, never the measurements — those
> come from scanner metadata.`

Every length, area and per-mm² figure is derived from the microns per pixel
the scanner recorded, so moving these sliders leaves your numbers untouched.
The filter is applied to the tissue underneath your marks, which keeps the
marks legible at any setting.

## Writing the report

The **Report** tab on the right holds the case task and your reports. The
task brief sits at the top with its prompt and instructions; when the case
offers hints, a **Hint** button reveals them one at a time and records each
request, and under exam conditions the hints are absent.

1. Click **Add report** for a blank one.
2. Give it a **Title** and write the body: what you examined, what you found,
   and your conclusion.
3. With measurements on the slide, **Insert N measurements** appends them to
   what you have already written.
4. **Save draft** keeps the report open and editable.
5. **Submit report** locks and time-stamps it, and it is then shown as a
   record marked **Submitted**.

Submit tells you when something is missing: a report with no title, an empty
body, or one already submitted says so when you press the button. After you
submit, the report shows **How this slide was read**: how many key findings
you reached, how many of the critical ones, how much of the slide you
screened, the highest power you used, and your time on it. Any key finding
you passed over is listed with the reason.

::: tip Your work is saved with the session
Annotations and reports are stored against your session as you go, per slide.
Leaving the room and coming back, or reloading the page, brings them with
you, and your instructor sees them in the session record.
:::

Cases also carry an answer key: the expected findings, the regions of
interest and the dwell thresholds behind that read feedback. The key is
stripped from every copy of the case sent to a learner, so it is absent from
the room and from the page's data. Your instructor holds it.

## When the room is empty

**No pathology material is attached to this case** means the case document
carries nothing to open, and **No slides in this case** or **No gross
specimen has been photographed for this case** means that half of it is
empty. A slide that stays blank, or a badge reading **no calibration**,
points at the slide library, which is configured outside the viewer: slides
live on a content origin an administrator installs, and a slide with unknown
optics is held back from cases so that measurements taken on it cannot be
wrong by an unknown factor. Report an empty or blank room to your instructor,
who has [Pathology slides](/admin/pathology-slides) for that side.

## Next steps

- [The rooms](/trainee/rooms)
- [Ordering labs & imaging](/trainee/investigations)
- [Debrief](/trainee/debrief)
