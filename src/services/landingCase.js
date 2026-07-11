// Which case does a student land on when they open the app with no active
// session? The demo course carries one case per interface language
// (EN/DE/ES/IT), so a learner should open the patient that speaks THEIR
// language. This is the single source of truth for that pick, kept pure so it
// can be unit-tested without mounting the whole app.
//
// Policy, in order:
//   1. the case whose case_language matches the student's UI language, else
//   2. the tenant default case (is_default), which is always present + visible.
// Returns null only when the case list is empty.
//
// `cases` are the objects returned by GET /api/cases (config already parsed to
// an object). `uiLanguage` is the bare language code from useLanguage().
export function pickLandingCase(cases, uiLanguage) {
    if (!Array.isArray(cases) || cases.length === 0) return null;
    const byLanguage = cases.find((c) => c?.config?.case_language === uiLanguage);
    if (byLanguage) return byLanguage;
    return cases.find((c) => c?.is_default) || null;
}
