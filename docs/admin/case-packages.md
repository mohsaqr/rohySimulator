# Case packages

A case package is one `.rohycase` file that moves a whole case to another Rohy
server: the case itself, its agents, its labs and imaging, its treatment rubric,
and the media it shows.

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

When the import finishes, the dialog lists anything the receiving server lacks.
Read the list before you publish the case.

## What travels

| Media | In the package |
|---|---|
| Images, videos and sounds uploaded in the case editor (radiology, examination) | Carried |
| Pathology slides from the [slide library](/admin/pathology-slides) | Carried: tiles, preview and calibration. The scanner's original file is not carried |
| Slides and PACS studies that ship with Rohy | Referenced by name and checksum, not copied |
| Slides served by your own content origin | Carried, and placed in the receiving server's slide library |
| PACS studies served by your own content origin | Referenced only: a receiving server has nowhere to store DICOM it did not ship |
| ECG recordings and photos embedded in a case | Already part of the case |

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

A file posing as an image (an HTML page renamed `.png`, say) is left out and
listed in the report. If the database write fails after files were placed, the
placed files are removed again.

An imported slide is never written over an existing slide. If its library id
is taken by a different slide, the import gives it a new id.

## Limits and settings

Three server variables set the size limit, the staging directory and the
free-space margin. They are listed in the
[configuration reference](/reference/config/), and the endpoints are in the
[case-packages API reference](/reference/api/case-packages).

Imported slides land in the slide library. They display only if that library is
served, which is the same condition as for slides imported from a link. When it
is not served, the import report says so.
