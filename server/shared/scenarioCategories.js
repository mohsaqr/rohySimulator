/**
 * The canonical scenario category vocabulary (`scenarios.category`).
 *
 * Lives under `server/shared/` because BOTH sides need it: the scenario
 * repository renders these as `<option value=…>` and filter entries, and
 * `cases-routes.js` canonicalises the submitted value before it is written.
 * (Server code importing from `src/` works locally and crashes in the Docker
 * image, which copies `server/` but not `src/` — hence this directory.)
 *
 * ---- the bug this module exists to prevent ----
 *
 * `scenarios.category` was free text. The repository UI carried its own
 * English list and translated it with a COMPUTED key —
 * `t(\`category_${id.toLowerCase()}\`, id)` — which the i18n parser cannot
 * see, so nothing guaranteed a catalogue entry existed; and because the server
 * accepted any string, an author on the Italian UI could store
 * 'Emergenza Neurologica / Terapia Intensiva', which then matched no filter,
 * counted under no category, and rendered raw in every other language.
 *
 * ---- ids ----
 *
 * The ids are the English words the repository already stored ('Cardiac',
 * 'Sepsis', …), because every existing row and every seeded built-in already
 * holds them — keeping them avoids a data migration. They are ids, not prose:
 * the eye sees `t(SCENARIO_CATEGORY_LABEL_KEYS[id])`. Every locale's label,
 * common clinical synonyms and the retired seed spellings ('Cardiovascular',
 * 'Allergic') are ALIASES that `resolveScenarioCategory()` repairs on write,
 * so a translated import self-heals. Values nothing recognises are stored as
 * written (legacy rows must keep saving) and reported as a non-fatal warning;
 * the editor shows them raw and keeps them selectable.
 */

import { buildLookup, foldSpelling, matchVocabulary } from './vocabularyMatch.js';

/**
 * Canonical category ids in authoring order. `labelKey` is a key in the
 * `authoring_scenarios` i18n namespace.
 */
export const SCENARIO_CATEGORIES = [
    { id: 'Cardiac', labelKey: 'category_cardiac' },
    { id: 'Respiratory', labelKey: 'category_respiratory' },
    { id: 'Sepsis', labelKey: 'category_sepsis' },
    { id: 'Metabolic', labelKey: 'category_metabolic' },
    { id: 'Neurological', labelKey: 'category_neurological' },
    { id: 'Trauma', labelKey: 'category_trauma' },
    { id: 'Toxicology', labelKey: 'category_toxicology' },
    { id: 'General', labelKey: 'category_general' },
    { id: 'Recovery', labelKey: 'category_recovery' },
    { id: 'Pediatric', labelKey: 'category_pediatric' },
];

/** The ids alone, in the same order. */
export const SCENARIO_CATEGORY_IDS = SCENARIO_CATEGORIES.map((category) => category.id);

/** The category a new or imported scenario gets when it names none. */
export const DEFAULT_SCENARIO_CATEGORY = 'General';

/**
 * Literal id → i18n key map (namespace `authoring_scenarios`), for the
 * enum-label rule: never `t(\`category_${x}\`)`, always a static map the
 * parser can see.
 */
export const SCENARIO_CATEGORY_LABEL_KEYS = Object.fromEntries(
    SCENARIO_CATEGORIES.map((category) => [category.id, category.labelKey]),
);

/**
 * Accepted spellings per id: the label each locale catalogue ships (so a
 * scenario exported from an Italian UI, or typed by hand in Finnish,
 * resolves instead of being rejected), clinical synonyms, and the two
 * spellings the admin seed route used to write ('Cardiovascular',
 * 'Allergic'). Matching is normalised — case, whitespace and punctuation are
 * ignored — so entries here are the human form.
 *
 * `tests/server/scenario-language.test.js` reads every locale's `category_*`
 * value and asserts it resolves; add the label here when you add a language.
 */
const CORE_ALIASES = {
    Cardiac: [
        'Cardiovascular', 'Cardiology', 'Heart', 'Kardial', 'Kardiologie',
        'Kardiologisch', 'Cardíaco', 'Cardíaca', 'Cardiaco', 'Cardiaca', 'Cardiología', 'Cardiologico', 'Cardiologica',
        'Cardiologia', 'Sydän', 'Kardiologia', 'Kardiell', 'Kardiologi',
    ],
    Respiratory: [
        'Respiration', 'Pulmonary', 'Pulmonology', 'Respiratorisch', 'Atmung',
        'Pulmonologie', 'Respiratorio', 'Respiratoria', 'Neumología', 'Pneumologia',
        'Hengitys', 'Keuhko', 'Respiratorisk', 'Lung',
    ],
    Sepsis: [
        'Septic', 'Septic Shock', 'Infection', 'Septisch', 'Infektion',
        'Séptico', 'Séptica', 'Infección', 'Sepsi', 'Settico', 'Settica',
        'Infezione', 'Septinen', 'Infektio', 'Septisk',
    ],
    Metabolic: [
        'Metabolism', 'Endocrine', 'Metabolisch', 'Stoffwechsel', 'Metabólico',
        'Metabólica', 'Metabolico', 'Metabolica', 'Metabolinen', 'Aineenvaihdunta', 'Metabol',
    ],
    Neurological: [
        'Neurology', 'Neuro', 'Neurologisch', 'Neurologie', 'Neurológico',
        'Neurológica', 'Neurología', 'Neurologico', 'Neurologica', 'Neurologia', 'Neurologinen',
        'Neurologisk',
    ],
    Trauma: ['Traumatology', 'Injury', 'Traumatologie', 'Traumatología', 'Traumatologia', 'Vamma'],
    Toxicology: [
        'Toxicological', 'Poisoning', 'Overdose', 'Toxikologie', 'Toxikologisch',
        'Vergiftung', 'Toxicología', 'Toxicológico', 'Toxicológica', 'Tossicologia',
        'Tossicologico', 'Tossicologica', 'Toksikologia', 'Myrkytys', 'Toxikologi',
    ],
    General: [
        'Other', 'Misc', 'Miscellaneous', 'Allergic', 'Anaphylaxis',
        'Allgemein', 'Sonstige', 'Generale', 'Altro', 'Yleinen', 'Muu',
        'Allmän', 'Övrigt',
    ],
    Recovery: [
        'Post-resuscitation', 'Erholung', 'Genesung', 'Recuperación',
        'Recupero', 'Toipuminen', 'Återhämtning',
    ],
    Pediatric: [
        'Pediatrics', 'Paediatric', 'Paediatrics', 'Pädiatrisch', 'Pädiatrie',
        'Pediátrico', 'Pediátrica', 'Pediatría', 'Pediatrico', 'Pediatrica', 'Pediatria', 'Lasten',
        'Lapset', 'Pediatrisk', 'Pediatrik',
    ],
};

/**
 * French and Kazakh spellings, added when those two languages joined the
 * registry.
 *
 * Their own block rather than edits inside CORE_ALIASES, because a Cyrillic
 * label shares no letters with its canonical id: `foldSpelling` lowercases
 * and strips punctuation but does NOT transliterate, so 'Сепсис' has to be
 * listed even though the id is already 'Sepsis'. Every catalogue LABEL in
 * src/locales/{fr,kk}/authoring_scenarios.json appears here — a label that
 * does not resolve means a scenario authored in that UI language fails on
 * import (tests/server/scenario-language.test.js pins exactly that).
 */
const LATER_LANGUAGE_ALIASES = {
    Cardiac: ['Cardiaque', 'Cardiologie', 'Cardio', 'Кардиологиялық', 'Кардиология', 'Жүрек'],
    Respiratory: ['Respiratoire', 'Pneumologie', 'Poumon', 'Респираторлық', 'Пульмонология', 'Тыныс алу', 'Өкпе'],
    Sepsis: ['Septique', 'Infection', 'Сепсис', 'Септикалық', 'Инфекция'],
    Metabolic: ['Métabolique', 'Métabolisme', 'Endocrinologie', 'Метаболикалық', 'Метаболизм', 'Эндокринология'],
    Neurological: ['Neurologique', 'Neurologie', 'Неврологиялық', 'Неврология', 'Жүйке'],
    Trauma: ['Traumatisme', 'Травма', 'Жарақат'],
    Toxicology: ['Toxicologie', 'Intoxication', 'Токсикология', 'Улану'],
    General: ['Général', 'Générale', 'Жалпы'],
    Recovery: ['Récupération', 'Réadaptation', 'Convalescence', 'Қалпына келтіру', 'Оңалту'],
    Pediatric: ['Pédiatrie', 'Pédiatrique', 'Педиатрия', 'Балалар'],
};

/** Every spelling of every category, in one map. */
export const SCENARIO_CATEGORY_ALIASES = Object.fromEntries(
    Object.entries(CORE_ALIASES).map(([id, spellings]) => [id, [...spellings, ...(LATER_LANGUAGE_ALIASES[id] || [])]])
);

// Built once: folded id or alias → canonical id.
const LOOKUP = buildLookup(SCENARIO_CATEGORY_IDS, SCENARIO_CATEGORY_ALIASES, foldSpelling);

/**
 * Resolve a submitted category to its canonical id.
 *
 * Three outcomes, kept distinct on purpose (mirrors `resolveRhythm`):
 *
 *   absent / blank      → { ok: true,  value: null }       nothing to store
 *   recognised          → { ok: true,  value: 'Cardiac' }  canonical id
 *   present but unknown → { ok: false, received }          caller keeps it verbatim
 *
 * "Recognised" covers the ids themselves, case/whitespace/punctuation
 * variants, every alias above, and qualified prose that CONTAINS exactly one
 * id/alias as a whole word run ('Emergenza Neurologica / Terapia Intensiva'
 * → 'Neurological'; longest wins, two different ids at the same length is
 * ambiguous and stays unknown). Unknown is advisory: the routes store the
 * string as written and report it in a `warnings` array — legacy rows hold
 * free text and must keep saving.
 */
export function resolveScenarioCategory(value) {
    if (value === null || value === undefined) return { ok: true, value: null };
    const trimmed = String(value).trim();
    if (trimmed === '') return { ok: true, value: null };
    const match = matchVocabulary(foldSpelling(trimmed), LOOKUP);
    return match ? { ok: true, value: match } : { ok: false, received: trimmed };
}
