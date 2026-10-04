/**
 * The canonical patient-demographic vocabularies a case carries.
 *
 * Lives under `server/shared/` because BOTH sides need it: the case editor
 * renders these as `<option value=…>`, and `cases-routes.js` validates the
 * submitted value before it reaches a CHECK-constrained column. (Server code
 * importing from `src/` works locally and crashes in the Docker image, which
 * copies `server/` but not `src/` — hence this directory.)
 *
 * ---- why these strings and not tidy lowercase keys ----
 *
 * They are the ENGLISH LABELS, and deliberately so:
 *
 *  - `PATIENT_GENDERS` must match the `cases.patient_gender` CHECK constraint
 *    literally — `CHECK(patient_gender IN ('Male', 'Female', 'Other'))`. Note
 *    the capitals: `'male'` violates it just as surely as `'Männlich'` does.
 *  - `PERSONA_TYPES` and `MARITAL_STATUSES` are read as PROSE, not as keys:
 *    the persona lands in the patient system prompt via `ChatInterface`
 *    (`config.persona_type` → "you are …"), and marital status is rendered
 *    into the case context. Changing them to slugs would change the text sent
 *    to the model.
 *  - The seeders already write exactly these strings.
 *
 * So a display label is translated for the eye only; the STORED value is
 * always the English string here.
 *
 * ---- the bug this module exists to prevent ----
 *
 * The editor's `<option>` elements carried a translated label and NO `value`
 * attribute. An option without a value submits its text content, so selecting
 * "Männlich" stored the literal string "Männlich" — which fails the CHECK and
 * returned HTTP 500 from `POST /api/cases` in every non-English locale.
 * English worked purely by coincidence, because `t('demo_gender_male')` is the
 * word "Male", which happens to satisfy the constraint.
 *
 * `tests/server/patient-demographics.test.js` now fails on any `<option>` that
 * has a `t(…)` label and no explicit `value`, so this cannot recur.
 */

/**
 * Mirrors `CHECK(patient_gender IN ('Male', 'Female', 'Other'))` on `cases`
 * (migration 0001). Changing this list means writing a migration.
 */
export const PATIENT_GENDERS = ['Male', 'Female', 'Other'];

/**
 * The catalogue key (in the `common` namespace) for showing a stored gender.
 *
 * The stored value is the English label (above), and three learner-facing
 * surfaces printed it raw — "55 v Male" under a Finnish UI (QA 2026-10-04,
 * PRV-33). Older seeds also wrote lowercase ("male"), hence the
 * case-insensitive match. An unrecognised value returns null and the caller
 * shows nothing rather than an untranslated word.
 *
 * @param {unknown} value  a stored gender, e.g. 'Male', 'female'
 * @returns {'gender_male'|'gender_female'|'gender_other'|null}
 */
export function genderDisplayKey(value) {
    if (typeof value !== 'string') return null;
    switch (value.trim().toLowerCase()) {
        case 'male': return 'gender_male';
        case 'female': return 'gender_female';
        case 'other': return 'gender_other';
        default: return null;
    }
}

/** Free-text in the DB (`config` JSON), but fixed here so it stops varying by locale. */
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];

/** Order matches the editor's dropdown; the first entry is the default. */
export const PERSONA_TYPES = [
    'Standard Simulated Patient',
    'Difficult/Angry Patient',
    'Anxious Patient',
    'Depressed Patient',
    'Elderly/Confused Patient',
    'Pediatric Proxy (Parent)',
    'Non-compliant Patient',
    'Drug-seeking Patient',
];

/** The persona applied when a case names none. */
export const DEFAULT_PERSONA_TYPE = PERSONA_TYPES[0];

/**
 * Localized gender labels → canonical value.
 *
 * These are the `demo_gender_male` / `demo_gender_female` / `demo_gender_other`
 * values from `src/locales/{de,es,it,fi,sv}/authoring_config.json` (the `en`
 * catalogue IS the canonical set; `en-XA` is pseudo-locale noise and skipped).
 * They are hardcoded rather than read from the catalogues because this module
 * runs in the Docker image, which ships `server/` without `src/`.
 *
 * Why accept them at all: an exported case carries `demographics.gender` as
 * whatever the editor stored, and cases authored before v2.9.15 stored the
 * TRANSLATED LABEL (see the module comment). Importing such a case — or one
 * hand-written in a German/Italian/… teaching team's own words — should land
 * as the canonical value, not bounce with a 400 the author cannot act on.
 *
 * Keys are lowercase (matching is case-insensitive). If a catalogue string
 * changes, add the new label here — old exports still carry the old one, so
 * never remove an entry.
 */
export const PATIENT_GENDER_ALIASES = Object.freeze({
    // de
    'männlich': 'Male', 'weiblich': 'Female', 'andere': 'Other',
    // es
    'masculino': 'Male', 'femenino': 'Female', 'otro': 'Other',
    // it
    'maschio': 'Male', 'femmina': 'Female', 'altro': 'Other',
    // fi
    'mies': 'Male', 'nainen': 'Female', 'muu': 'Other',
    // sv
    'man': 'Male', 'kvinna': 'Female', 'annat': 'Other',
});

/**
 * Resolve a submitted gender to its canonical form.
 *
 * Three outcomes, kept distinct on purpose — collapsing "absent" and
 * "unrecognised" into one is how a bad value gets silently written as NULL:
 *
 *   absent / blank      → { ok: true,  value: null }   nothing to store
 *   recognised          → { ok: true,  value: 'Male' } canonical, ready to store
 *   present but unknown → { ok: false, received }      caller should reject
 *
 * Matching is case-insensitive and trims, so a legacy or API client sending
 * `'male'` is repaired rather than rejected — that casing was never valid
 * against the constraint, and failing it would be pedantry rather than safety.
 * The localized editor labels ('Männlich', 'Maschio', …) are recognised as
 * aliases via `PATIENT_GENDER_ALIASES` and resolve to the canonical value;
 * anything else ('Homme', 'M', a typo) comes back `ok: false`.
 */
export function resolvePatientGender(value) {
    if (value === null || value === undefined) return { ok: true, value: null };
    const trimmed = String(value).trim();
    if (trimmed === '') return { ok: true, value: null };
    const needle = trimmed.toLowerCase();
    const match = PATIENT_GENDERS.find((gender) => gender.toLowerCase() === needle)
        || PATIENT_GENDER_ALIASES[needle];
    return match ? { ok: true, value: match } : { ok: false, received: trimmed };
}

/**
 * The body-map / manikin variant of a patient's sex.
 *
 * The anatomical assets are binary (`body_map_coordinates.gender` also allows
 * 'unisex', but `ManikinPanel` and `PhysicalExamEditor` only render male and
 * female), so 'Other' and anything unrecognised resolve to 'male'.
 *
 * That fallback is unchanged from the four hand-rolled
 * `gender.toLowerCase() === 'female' ? 'female' : 'male'` ternaries this
 * replaces — but those made it *invisible*: a German case with gender
 * "Weiblich" silently rendered a MALE body map, because "weiblich" is not
 * "female". Centralising it means the default is one documented decision
 * rather than four accidental ones — and, now that the resolver knows the
 * localized labels, "Weiblich" renders the female body map it always meant.
 */
export function bodyMapGender(value) {
    const resolved = resolvePatientGender(value);
    return resolved.ok && resolved.value === 'Female' ? 'female' : 'male';
}
