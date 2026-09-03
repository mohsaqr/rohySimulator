# Languages & multilingual cases

rohySimulator ships with English, German (Deutsch), Spanish (Español),
Italian (Italiano), Finnish (Suomi) and Swedish (Svenska). A student picks
their language in **My Profile → Language**; it is stored per user.

## What the language setting controls

| Surface | Behaviour |
|---|---|
| Patient dialogue | The AI patient **always replies in the student's language**, regardless of what language the case was authored in. A server-side directive is appended to every LLM request, so an untranslated case still gives a Finnish-speaking patient. |
| Interface | Student-facing screens (chat, monitor, examination, investigations, orders, treatments, debrief, login) are translated. Admin and analytics panels stay English. |
| Speech-to-text | The microphone recognizes the student's language automatically in non-English sessions. |
| Text-to-speech | The configured case voice is used as-is. If it speaks only a language other than the session's, educators and admins see a **loud mismatch warning** in the diagnostic bar, and the configured voice stands. OpenAI and browser voices follow the text language automatically. |
| Dates & numbers | Formatted per language (Finnish students see `8.7.2026` and decimal commas). |

## Authoring cases for multilingual courses

- **You can author in any language.** The output-language directive dominates:
  an English-authored case works for an Italian student. Authoring in the
  target language can still improve nuance (names, cultural details).
- **Case content stays as authored.** Chief complaints, exam findings, lab
  values, scenario text, and drug/lab names render exactly as you wrote them,
  with no machine translation. Lab and drug nomenclature (LOINC/RxNorm) is
  international practice and stays standard by design.
- **Voices:** if your course runs in Italian/Finnish/Swedish, pick a
  matching per-character voice in the case editor (Piper voice packs per
  language can be installed server-side), or use a multilingual provider
  (OpenAI / browser) which speaks whatever the patient writes.

## For translators / maintainers

UI strings live in `src/locales/<lang>/*.json` (English is canonical).
Machine-first translations are produced with `npm run i18n:translate` (uses
the pinned clinical glossary in `scripts/i18n-glossary.json`); native-speaker
review is the release gate per language. Reviewers work from XLIFF files
(`npm run i18n:status`, `npm run i18n:xliff:export`, `npm run
i18n:xliff:import`; see [Translation review (XLIFF)](/integrator/i18n-review)).
Adding a whole new language is a data change: one entry in
`server/shared/languages.js` plus a `src/locales/<code>/` folder. See
`docs/design/i18n-plan.md`.
