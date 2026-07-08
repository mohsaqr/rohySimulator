# Languages & multilingual cases

rohySimulator ships with English, Italian (Italiano), Finnish (Suomi), and
Swedish (Svenska). A student picks their language in **My Profile →
Language**; it is stored per user.

## What the language setting controls

| Surface | Behaviour |
|---|---|
| Patient dialogue | The AI patient **always replies in the student's language**, regardless of what language the case was authored in. A server-side directive is appended to every LLM request — you do not need to translate your case to get a Finnish-speaking patient. |
| Interface | Student-facing screens (chat, monitor, examination, investigations, orders, treatments, debrief, login) are translated. Admin and analytics panels stay English. |
| Speech-to-text | The microphone recognizes the student's language automatically in non-English sessions. |
| Text-to-speech | The configured case voice is used as-is. If it can only speak a different language than the session's, educators/admins see a **loud mismatch warning** in the diagnostic bar — the voice is never silently substituted. OpenAI and browser voices follow the text language automatically. |
| Dates & numbers | Formatted per language (Finnish students see `8.7.2026` and decimal commas). |

## Authoring cases for multilingual courses

- **You can author in any language.** The output-language directive dominates:
  an English-authored case works for an Italian student. Authoring in the
  target language can still improve nuance (names, cultural details).
- **Case content is never machine-translated.** Chief complaints, exam
  findings, lab values, scenario text, and drug/lab names render exactly as
  you wrote them. Lab and drug nomenclature (LOINC/RxNorm) is international
  practice and intentionally stays standard.
- **Voices:** if your course runs in Italian/Finnish/Swedish, pick a
  matching per-character voice in the case editor (Piper voice packs per
  language can be installed server-side), or use a multilingual provider
  (OpenAI / browser) which speaks whatever the patient writes.

## For translators / maintainers

UI strings live in `src/locales/<lang>/*.json` (English is canonical).
Machine-first translations are produced with `npm run i18n:translate` (uses
the pinned clinical glossary in `scripts/i18n-glossary.json`); native-speaker
review of the git diff is the release gate per language. Adding a whole new
language is a data change — one entry in `server/shared/languages.js` plus a
`src/locales/<code>/` folder; see `I18N_PLAN.md`.
