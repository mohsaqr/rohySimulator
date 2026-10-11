# Building a pathology case

This guide takes a pathology case from scanned glass slides to a case your
learners read in the **Pathology** room: the slides, the gross specimen, the
task, the answer key, the course materials that open afterwards, and moving the
finished case to another server.

| Step | What you do | Where |
|---|---|---|
| 1 | Check that slide imports are switched on | your administrator, once |
| 2 | Put the slide files where the server can fetch them | a web folder |
| 3 | Write the patient case | the case wizard |
| 4 | Import the slides and build the pathology material | wizard → **Plugins** |
| 5 | Write the task and the protected answer key | the same editor |
| 6 | Check what the learner sees | **Learner preview** |
| 7 | Lock the teaching material behind the case, add questionnaires | wizard → **Course** |
| 8 | Assign, run, and share the case | Settings → Cases |

## 1. What your administrator sets up once

Slides are imported **from a link**. Rohy downloads the file, reads its scanner
optics, cuts it into zoomable tiles and files it in the slide library. You
cannot upload a slide from your browser.

Nothing imports until your administrator has done three things. Each is
described in [Pathology slides](/admin/pathology-slides):

- installed **libvips** on the server and given it a slide library directory
  ([What an operator provisions](/admin/pathology-slides#what-an-operator-provisions));
- named the hosts slides may come from (`ROHY_PLUGIN_IMPORT_ORIGINS`);
- in Settings → **Plugins** → Pathology, ticked **Allow importing slides from a
  link** and added the host
  ([Import policy](/admin/pathology-slides#import-policy)).

If the **Import from link** field is missing from the slide library, one of
these is not done yet. Ask your administrator.

## 2. Put the slide files where the server can fetch them

Accepted formats are `.svs`, `.ndpi`, `.tiff`, `.tif`, `.dzi` and a `.zip`
holding one slide. Multi-file formats such as `.mrxs` are not supported. The
default size limit is 4 GiB per slide.

Place each file at an `http://` or `https://` address on a host your
administrator allowed, for example a university file server. The address must
point at the file itself, not at a page that links to it.

::: tip Name the files neutrally
An import without a label is listed in the slide library under its file name.
A file named `colorectal_adenocarcinoma_HE.ndpi` tells anyone who sees the
library the answer. Rename it `A1_HE.ndpi` before you publish it, or give it a
neutral label when you import it.
:::

## 3. Write the patient case

Open Settings → **Cases** and create a case. The
[case wizard](/educator/case-wizard) walks through the patient, the story and
the records. A pathology-led case can keep the clinical story short: the
patient and the referral set the scene, and the work happens on the slides.

Keep the case **name** and **description** free of the diagnosis. Learners see
both before they start, so "Pentti, 75 – abdominal pain and fever" works, and
"Pentti, 75 (colon tumour)" gives the answer away. See
[Keep the answer out of sight](#keep-the-answer-out-of-sight).

## 4. Import the slides and build the pathology material

In the wizard, go to the **Plugins** step and select **Open editor** on
Pathology. This opens the **Pathology Case Studio**. Its **Case outline** down
the left lists the parts of the case:

- **Case overview**
- **Clinical metadata**: what every learner sees as context
- **Specimen parts**: each part of the specimen, with its gross photographs,
  its blocks and its slides
- **Learner activities**: the task and its protected answer key

### Import a slide

1. In a specimen part, select **Add slide** → **Add slide from the slide
   library** → **Import from link**.
2. Paste the slide's address, give it a neutral **Label (optional)** such as
   `A1 — HE`, and select **Import**.
3. Watch the card move through `QUEUED`, `DOWNLOADING`, `PROBING`, `TILING` and
   `READY`. Slides convert one at a time, so a second import waits for the
   first. Tiling reads the pyramid the scanner already wrote, so most slides
   finish within minutes.
4. When the slide is `READY`, preview it and add it to the case.

Two other endings are possible:

- **Needs calibration**: the file carried no scanner optics. Select **Add
  calibration** and enter the magnification it was scanned at and the µm per
  pixel. Rohy does not guess these, because every length and area a learner
  measures is computed from them. A slide without calibration cannot be added
  to a case.
- **Failed**: the card gives the reason. **Remove** deletes the slide.

A slide already in the library, imported for another case, can be added the
same way without importing it again: search the library, preview, add.

### Label each slide

Each slide has a **Slide label**, a **Stain** and a **Block**. The label and the
stain are what the learner sees in the slide list, so use the block name and
the stain only: `A1 — HE`, `A1 — CDX2`, `B1 — HE`.

A block is created automatically with your first slide. Add one yourself
(**Add block**, **Block label** such as `A1`) when you want to name it or when
several slides were cut from the same block.

### Specimen parts and gross photographs

A case with more than one specimen, such as a resection, a lymph node and a
liver biopsy, gets one **specimen part** each (**Add specimen part**). For each
part you can fill in:

- **Gross description**: what the specimen looked like, in words. Describe what
  is there ("a 4.5 × 3.8 cm firm, grey-white area"), not what it means.
- **Dimensions** and **Weight**.
- **Gross photographs**: drop JPEG, PNG, HEIC or WebP files on the part, or
  choose them. They are stored in the case and shown to the learner as a
  contact sheet in the order you set. Enter a **Plate width (mm)** to give the
  learner a scale bar.

You can also **reference** a photograph kept with your slides instead of
storing it in the case. A referenced photograph must be **pinned** before the
case can be published: select **Pin now** once its address is reachable.

### Clinical metadata

**Case title**, **Accession**, **Specimen summary** and **Clinical history**.
Every learner sees this as the referral. Write it as a clinician would fill a
request form: the history and the question, without the answer.

## 5. Write the task and the protected answer key

Under **Learner activities**, select **Add activity**.

**Learner activity** is public: the **Prompt** ("Examine the specimens and give
your diagnosis") and the **Instructions** the learner reads in the **Report**
tab.

Select **Create protected rubric** for the part learners never receive. The
server removes it from every copy of the case it sends to a learner. It holds:

- **Hints**, one per line. Learners reveal them one at a time with the **Hint**
  button, and each request is recorded. Under exam conditions there are none.
- **Expected diagnosis**, **Accepted synonyms**, **Required terms** and
  **Rejected terms**, used to judge the submitted report.

On each slide, **Add scoring for this slide** adds a **Per-slide rubric**:

- **Regions of interest**: each finding the learner must reach. Select **Add
  ROI** and give it a **Label**, its position (in level-0 slide pixels), the
  **Minimum objective (x)** it must be viewed at, how long it must stay in view
  (**Dwell (ms)**), and whether it is a **Critical finding**.
- **Screening (x)** and **Coverage (x)**: the power the slide should be screened
  at, and the coverage grid used to measure how much of it was screened.

After the learner submits a report, the room shows **How this slide was read**:
key findings reached, critical findings, how much of the slide was screened,
the highest power used and the time spent. A finding the learner missed is
listed with the reason: never on screen, insufficient magnification or
insufficient dwell. See
[Reading a pathology slide](/trainee/pathology#writing-the-report) for the
learner's side.

Select **Done** to close the editor, then save the case.

## 6. Check what the learner sees

The Case Studio has a **Learner preview**. It shows the case exactly as a
learner receives it, with the protected rubric removed. Events and work in the
preview are isolated and not saved.

In the wizard's **Rooms** step, check that **Pathology** is switched on. A case
built around a history and its slides can switch off the rooms it does not use,
such as labs or radiology. See [Choosing the rooms](/educator/case-wizard#choosing-the-rooms).

## Keep the answer out of sight

A learner sees a lot before they write a word, and each of these can give the
diagnosis away:

| Visible to the learner | Give away | Write instead |
|---|---|---|
| Case name and description | "(colon tumour)", "staging lymph nodes and liver" | "Abdominal pain and fever" |
| Slide label | "Colorectal adenocarcinoma, HE" | "A1 — HE" |
| Gross description | "tumour", "invasion", "no metastases" | sizes, colours, consistency |
| Clinical history | "for staging" | the presenting history and the question |
| Course lesson titles | "Colorectal adenocarcinoma" | lock the lesson (step 7) |
| Questionnaire options | a distractor such as "metastasis", which implies a cancer work-up | distractors from the same differential |
| Slide library names | `adenocarcinoma.ndpi`, "Colon tumour, HE" | `A1_HE.ndpi`, "A1 — HE" |

The answer belongs in four places only: the protected rubric, the case's
diagnosis and learning objectives, and course lessons locked behind the case.

## 7. Lock the teaching material behind the case

Lessons that teach the diagnosis can wait until the learner has worked the
case. In the wizard's **Course** step, set **Minutes after the learner starts
the case** and **Every pathology slide opened**, then tick the lessons that
wait.

The same step adds questionnaires: a pre-test and post-test with the same
questions, a reflection during the case, or a questionnaire after the lessons
open. Both are described in
[Course materials and questionnaires](/educator/course-and-questionnaires).

## 8. Assign, run and share the case

- Assign the case to a class: [Assigning cases](/educator/assigning-cases).
- Run it yourself as a learner before your class does.
- Learners' annotations and reports are saved with their session.

To move the finished case to another Rohy, export it as a **case package**
(Settings → **Cases** → **Export as a case package (case and media)**). The
package carries the case, its agents, its gross photographs and its imported
slides with their tiles, preview and calibration. It does not carry the
scanner's original file or the course lessons. Your administrator turns
packages on and imports them: see [Case packages](/admin/case-packages).

::: warning Keep your original scans
Slides are tiled at the magnification your administrator set, 10× by
default. A package carries those tiles, not the original scan, so keep the
original files if you may need full resolution later.
:::

## Related pages

- [Pathology slides](/admin/pathology-slides): the administrator's setup, import
  policy and conversion settings
- [Reading a pathology slide](/trainee/pathology): the room from the learner's
  side
- [Authoring a case (wizard)](/educator/case-wizard): every wizard step
- [Course materials and questionnaires](/educator/course-and-questionnaires)
- [Case packages](/admin/case-packages)
- [Assigning cases](/educator/assigning-cases)
