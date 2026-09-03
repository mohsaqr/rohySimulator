# Oyon emotion analytics

**Oyon** is the optional, browser-only emotion-capture add-on. When it is
enabled and a student has consented, Rohy records *aggregated* emotion
signals during a run and surfaces them to you as analytics. You read these
in **Settings -> Oyon Learning Analytics** (educator+).

## On-device and aggregated

::: warning
Emotion inference runs **in the student's browser**. Aggregated ten-second
windows are the only thing that leaves the device; raw camera frames and
facial landmarks stay in the browser, and the server hard-rejects raw frames.
Treat the data as a coarse-grained engagement signal a learner agreed to
share.
:::

Oyon data appears once the add-on is enabled for the tenant and the student
has opted in. A disabled add-on shows a clear disabled message in place of
analytics.

## The views

Four views, switched with the pills at the top:

- **Windows**: the raw stream of aggregated ten-second emotion windows.
- **Students**: per-student rollups.
- **Cases**: rollups by case.
- **Sessions**: per-session breakdown; open a session for its detail.

## Filtering

You can narrow by date range (**from**/**to**), dominant emotion
(multi-select), role, case, user and session, and tighten quality with
**minimum confidence** and **maximum missing-face ratio**. Apply the filters
to re-query; results are paged. Each window carries a quality verdict, so you
can discard low-confidence and face-not-detected windows.

## Reading it responsibly

- This is **aggregated affect over time**. It reads at the scale of stretches
  of a run, so use it to spot where a class struggled or disengaged, then look
  at what they were doing then in [reporting](/educator/reporting).
- Low confidence or a high missing-face ratio marks the signal for that window
  as unreliable. Filter those out before drawing conclusions.
- Use it for formative reflection and debrief. Keep it out of grading,
  ranking and any consequential decision about a student. Consent and the
  on-device aggregation boundary are mandatory.

## Reference

- API: [oyon endpoints](/reference/api/oyon)
- Glossary: [Oyon](/reference/glossary)
- Behaviour analytics: [TNA analytics](/educator/tna)
