# Case packages

A case package is one `.rohycase` file that moves a whole case to another Rohy
server: the case itself, its agents, its labs and imaging, its treatment rubric,
the media it shows, and its course with the lessons.

Case packages are **off by default** and only admins can use them. Until you
turn them on, nothing in the case list changes. The existing **Export to JSON**
and **Import** buttons stay as they are either way. They move only the case's
own record, with none of the media and none of the related tables.

## Turn case packages on

Settings → **Platform** → **General** → **Case packages** → tick **Allow case
packages**. Do this on both servers: the one you export from and the one you
import into.

## Export a case

Settings → **Cases** → the package button on the case's row
(**Export as a case package (case and media)**).

Rohy gathers the case and its media, writes the package, and your browser
downloads it. The dialog says what was carried and what was only referenced.

## Import a case

Settings → **Cases** → **Import package** → choose the `.rohycase` file.

The file uploads in pieces, so a large package also works behind a proxy that
caps request size. The import always creates a **new** case, with its own id
and case code. It never changes an existing case.

After the upload the server reads, checks and places the media. A package with
whole-slide images holds tens of thousands of tile files, so these steps can
take minutes. The dialog shows each step with the files and bytes done so far
and the time elapsed.

- **Cancel import** stops the import. If the case has not been saved yet,
  nothing is created and the files already placed are removed. Once the case
  is saved, Cancel is refused and the import finishes.
- **Close — the import continues** only closes the dialog. The import keeps
  running on the server. The case list then shows **Import running — show**,
  and later **Import finished — show the result**, also after you leave
  Settings and come back. Do not import the same package again while it runs:
  every import creates another case.

When the import finishes, the dialog lists anything the receiving server lacks.
Read the list before you publish the case. Below it, **Next steps** says what
still has to happen before learners can play the case:

- the new case is **hidden from learners**. **Show to learners** makes it
  available;
- the new course has **no members**. **Open Courses** to add learners or a
  join code;
- how many lessons the course has and how many wait until the learner has
  played the case.

The report also says which slides and media files were already on this server
and which were copied.

## What travels

| Media | In the package |
|---|---|
| Images, videos and sounds uploaded in the case editor (radiology, examination) | Carried |
| Pathology slides from the [slide library](/admin/pathology-slides) | Carried: tiles, preview and calibration. The scanner's original file is not carried |
| Slides and PACS studies that ship with Rohy | Referenced by name and checksum, not copied |
| Slides served by your own content origin | Carried, and placed in the receiving server's slide library |
| PACS studies served by your own content origin | Referenced only: a receiving server has nowhere to store DICOM it did not ship |
| ECG recordings and photos embedded in a case | Already part of the case |
| Files used by the case's lessons (images, PDFs and other documents) | Carried |

## The course

A case linked to a course takes the course with it: every lesson, its sections
and their order, whether it is published, and which lessons are
[locked behind the case](/educator/course-and-questionnaires). The pre- and
post-tests and the questionnaires are part of the case and travel with it in any
case.

The import creates a **new course** with the same name, owned by the person who
imports, linked to the new case. Two courses never end up with the same name:
if the name carries the exported case's code (`… (FI-0010)`), the new case's
code replaces it (`… (FI-0011)`); if another course already has the name, the
new case's code is added. The course's settings record the name and case code
it was exported with. The same lessons are locked behind the new
case. The course has **no learners**: the learners of one server are not those
of another. Add them in **Courses** before you assign the case.

Not carried, and listed in the export's notes:

- a lesson locked behind a **different** case of the same course. Without that
  case it could never wait for anything and would open with the material it was
  holding back;
- the platform's **default course**, which holds the cases of every language.
  A case in it moves without a course.

A server older than 3.0.0-rc.40 refuses a package that carries a course, rather
than import the case and leave the course out.

Content that ships with Rohy is referenced because every server that installed
it has the same files. The import compares checksums. If the receiving server
lacks a referenced item, or has a different version of it, the report says so.
Install the shipped content with `npm run setup:content`, or point the plugin at
the same content origin.

Personas are matched by type, name **and prompt**. If the receiving server has a
persona with the same name but a different prompt, the import creates a copy
named `<name> (imported)` rather than attach the local one.

## What the import refuses

The import checks the whole package before it writes anything, and refuses it
when:

- the package contains anything but the case, its manifest and its declared
  media files
- a file does not match its checksum
- a slide file is not part of a deep-zoom layout
- the disk would be left with less free space than the configured margin
- the package carries slides or specimen photographs and this server has no
  slide library (`ROHY_PLUGIN_LIBRARY_DIRS`, see
  [Pathology slides](/admin/pathology-slides#what-an-operator-provisions)).
  A pathology case without its slides is not the case that was exported, so
  nothing is created (`case_package_no_library`). Set the library, restart
  Rohy and import the package again.
- Rohy cannot write to that slide library: the directory is missing and cannot
  be created, or belongs to another user (`case_package_library_unwritable`).
  The message names the directory. `GET /api/health/plugins` shows the same as
  `"writable": false`.
- the course has a lesson whose link is not a file of the package or a web
  address (`https://…`)

A file posing as an image (an HTML page renamed `.png`, say) is left out and
listed in the report. If the database write fails after files were placed, the
placed files are removed again.

An imported slide is never written over an existing slide. If its library id
is taken by a different slide, the import gives it a new id. A slide that is
already in this server's library (same files, same calibration, same tenant)
is reused, not copied again. Files an operating system leaves in a folder,
such as `.DS_Store`, `Thumbs.db`, `desktop.ini` and `._*`, are not part of a
slide: they are never exported or imported and do not stop a slide being
reused.

## Limits and settings

Three server variables set the size limit, the staging directory and the
free-space margin. They are listed in the
[configuration reference](/reference/config/), and the endpoints are in the
[case-packages API reference](/reference/api/case-packages).

Imported slides land in the slide library, and Rohy serves them from there.
A Docker install has a library by default; see
[Pathology slides](/admin/pathology-slides#what-an-operator-provisions).
