// Translations of the vendored lessons module (src/components/lessons/**).
//
// The module came from LAILA with its own i18n: each t() call carries its
// English inline (`{ defaultValue: '…' }`) and names LAILA's namespaces —
// `teaching`, `courses`, `navigation`, `common`, `authoring_lessons` — through
// rohy's one i18next instance (react-i18next's useTranslation). rohy never
// shipped those namespaces, so under a Finnish UI every course, lesson and
// survey string fell through to its English default (FI-0010 review F08).
//
// Rather than rewrite the module to house style, this supplies the catalogues
// it expects: ./<lang>.json, shaped { "<namespace>": { "<key>": "<ICU message>" } }.
// English needs no file — the defaultValues are the English.
//
// Layering mirrors plugin catalogues (src/i18n/pluginLocales.js): added with
// overwrite = false AFTER rohy's own bundles, so where the module borrows a
// rohy namespace (`common`) rohy's reviewed string wins. The key set is pinned
// against the module's t() calls by
// src/components/lessons/locales/lessonsLocales.test.js; regenerate the English
// source with `node scripts/i18n/lessons-catalogue.mjs`.

// Non-eager: each language is its own chunk, fetched on the first switch to it.
const catalogueModules = import.meta.glob('./*.json');

const PATH_SHAPE = /\/([\w-]+)\.json$/;

/** Languages that ship a lessons catalogue. */
export function lessonsLocaleLanguages() {
    return Object.keys(catalogueModules)
        .map((p) => p.match(PATH_SHAPE)?.[1])
        .filter(Boolean)
        .sort();
}

/**
 * Add one language's lessons strings to i18next, under whatever rohy has.
 *
 * @param {import('i18next').i18n} i18n
 * @param {string} lng  Registry language code (or en-XA).
 * @returns {Promise<boolean>} true when a catalogue was applied.
 */
export async function applyLessonsLocales(i18n, lng) {
    const entry = Object.entries(catalogueModules).find(([p]) => p.match(PATH_SHAPE)?.[1] === lng);
    if (!entry) return false;
    const table = (await entry[1]()).default;
    for (const [ns, messages] of Object.entries(table)) {
        // deep = true, overwrite = FALSE: rohy's own catalogue wins.
        i18n.addResourceBundle(lng, ns, messages, true, false);
    }
    return true;
}
