# Oyon emotion analytics

**Oyon** is the optional, browser-only emotion-capture add-on. When it is
enabled and a student has consented, Rohy records *aggregated* emotion
signals during a run and surfaces them to you as analytics. You read these
in **Settings -> Oyon Learning Analytics** (educator+).

## On-device and aggregated — the caveat first

::: warning
Emotion inference runs **in the student's browser**. Only aggregated
ten-second windows ever leave the device — never raw camera frames or facial
landmarks. The server hard-rejects raw frames. Treat the data as a
coarse-grained engagement signal a learner agreed to share, not a recording
of their face.
:::

There is no Oyon data unless the add-on is enabled for the tenant and the
student opted in. If the add-on is disabled you will see a clear disabled
message instead of analytics.

## The views

Four views, switched with the pills at the top:

- **Windows** — the raw stream of aggregated ten-second emotion windows.
- **Students** — per-student rollups.
- **Cases** — rollups by case.
- **Sessions** — per-session breakdown; open a session for its detail.

## Filtering

You can narrow by date range (**from**/**to**), dominant emotion
(multi-select), role, case, user and session, and tighten quality with
**minimum confidence** and **maximum missing-face ratio**. Apply the filters
to re-query; results are paged. Each window carries a quality verdict so you
can discard low-confidence or face-not-detected windows rather than reading
them as real signal.

## Reading it responsibly

- This is **aggregated affect over time**, not a per-moment emotional
  transcript. Use it to spot stretches where a class struggled or
  disengaged, then look at what they were doing then in
  [reporting](/educator/reporting).
- Low confidence or a high missing-face ratio means the signal is unreliable
  for that window — filter those out before drawing conclusions.
- It is for formative reflection and debrief, never for grading, ranking or
  any consequential decision about a student. Consent and the
  on-device/aggregation boundary are not optional.

## Reference

- API: [oyon endpoints](/reference/api/oyon)
- Glossary: [Oyon](/reference/glossary)
- Behaviour analytics: [TNA analytics](/educator/tna)
