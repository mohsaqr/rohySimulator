// Word lists for the on-call specialist's reply guard (specialistBrief.js).
//
// Kept apart from the guard itself because they are DATA a reviewer edits —
// a missing synonym, a word that over-blocks — without reading the matching
// code. Keyed by the case-language codes of server/shared/languages.js; a
// test asserts every registry language has an entry in each table, so adding
// a language there fails loudly until it is added here.
//
// Everything is written in normaliseForMatch() form: lowercase, no
// diacritics (ä -> a, ö -> o, é -> e), so "syöpä" is "syopa" and "cáncer" is
// "cancer". Cyrillic keeps its letters (қ, ө, і are letters, not accents);
// only a combining mark such as the breve of й is dropped (й -> и).

import { LANGUAGES } from '../shared/languages.js';

/**
 * Words that name the CLASS of a malignant diagnosis, per language. Added to
 * the guard only when the protected answer is itself malignant
 * (isMalignantAnswer), so a pathologist on a benign case can still say "no
 * malignancy" — and one on a carcinoma case cannot say "this is cancer".
 *
 *   roots — matched anywhere inside a word, because the class word is the
 *           tail of a compound: "adenokarsinooma", "rintasyöpä",
 *           "Adenokarzinom", "adenocarcinoma". Each root was checked against
 *           ordinary clinical vocabulary for false hits: that is why English
 *           has "sarcoma" (not "sarcom", which is inside "sarcomere") and
 *           "myeloma" (not "myelom", inside "myelomeningocele").
 *   words — matched as whole words only: too short or too common to search
 *           inside other words (French "malin", Kazakh "рак"), or a root
 *           that sits inside an ordinary word of ANOTHER language — Swedish
 *           and German "myelom" is inside "myelomeningocele", "blastom"
 *           inside "blastomere", French "sarcome" inside "sarcomere".
 *
 * The guard applies EVERY language's list, not just the case language's: a
 * model briefed in Finnish still reaches for "adenocarcinoma" (FI-0010 review,
 * F02), and none of these roots is an ordinary word in another language.
 *
 * Deliberately absent: tumour/kasvain/Tumor/tumore — the descriptive word a
 * pathologist uses for what the slide shows ("kasvainsoluja rasvakudoksessa"
 * is a finding); neoplasm/neoplasia — benign ones exist; metastasis — its
 * absence is a reportable finding ("imusolmukkeissa ei etäpesäkkeitä").
 */
export const MALIGNANCY_TERMS = Object.freeze({
    en: Object.freeze({
        roots: ['carcinom', 'cancer', 'malignan', 'sarcoma', 'lymphoma', 'melanoma', 'leukaemi', 'leukemi', 'myeloma', 'blastoma', 'mesothelioma'],
        words: [],
    }),
    fi: Object.freeze({
        // syöpä inflects with consonant gradation: syöpä, syöpää, syöpien
        // (syop…) but syövän, syövässä, syöväksi, syövissä (syov…).
        roots: ['karsinoom', 'syop', 'syova', 'syovi', 'maligni', 'pahanlaatui', 'sarkoom', 'lymfoom', 'melanoom', 'leukemi', 'myeloom', 'blastoom', 'mesoteliooma'],
        words: [],
    }),
    sv: Object.freeze({
        roots: ['karcinom', 'cancer', 'malign', 'elakartad', 'sarkom', 'lymfom', 'melanom', 'leukemi', 'mesoteliom'],
        words: ['myelom', 'myelomet', 'blastom'],
    }),
    de: Object.freeze({
        roots: ['karzinom', 'krebs', 'malign', 'bosartig', 'sarkom', 'lymphom', 'melanom', 'leukamie', 'mesotheliom'],
        words: ['myelom', 'myeloms', 'myelome', 'blastom', 'blastoms'],
    }),
    es: Object.freeze({
        roots: ['carcinoma', 'cancer', 'malign', 'sarcoma', 'linfoma', 'melanoma', 'leucemia', 'mieloma', 'blastoma', 'mesotelioma'],
        words: [],
    }),
    it: Object.freeze({
        roots: ['carcinom', 'cancro', 'malign', 'sarcoma', 'linfoma', 'melanoma', 'leucemi', 'mieloma', 'blastoma', 'mesotelioma'],
        words: [],
    }),
    fr: Object.freeze({
        roots: ['carcinom', 'cancer', 'malign', 'lymphome', 'melanome', 'leucemie', 'mesotheliome'],
        words: ['malin', 'malins', 'sarcome', 'sarcomes', 'myelome', 'myelomes', 'blastome', 'blastomes'],
    }),
    kk: Object.freeze({
        roots: ['карцином', 'қатерлі', 'обыр', 'саркома', 'лимфома', 'меланома', 'лейкоз', 'лейкемия', 'миелома', 'бластома'],
        words: ['рак', 'рагы', 'ракпен', 'ракқа', 'ракты'],
    }),
});

/**
 * Words that never become guarded on their own, even when an answer phrase
 * contains them: function words, and the generic modifiers that make up half
 * of every diagnostic label ("ANTERIOR stemi", "ACUTE appendicitis",
 * "FIRST degree av block"). Guarding them would censor the teaching ("look at
 * the anterior leads") without protecting anything — the whole phrase and
 * its distinctive words are still guarded.
 */
export const GENERIC_WORDS = Object.freeze({
    en: ['with', 'without', 'and', 'from', 'into', 'type', 'grade', 'stage', 'degree', 'first', 'second', 'third',
        'acute', 'chronic', 'subacute', 'primary', 'secondary', 'left', 'right', 'bilateral', 'anterior', 'posterior',
        'inferior', 'superior', 'lateral', 'medial', 'proximal', 'distal', 'upper', 'lower', 'early', 'late',
        'severe', 'moderate', 'mild', 'focal', 'diffuse', 'multiple', 'single', 'invasive',
        'atrial', 'ventricular', 'supraventricular', 'junctional', 'sinus', 'cardiac'],
    fi: ['ilman', 'sekä', 'jossa', 'joka', 'tyyppi', 'tyypin', 'aste', 'asteen', 'vaihe', 'akuutti', 'akuutin',
        'krooninen', 'kroonisen', 'primaari', 'oikea', 'oikean', 'vasen', 'vasemman', 'molemminpuolinen',
        'ylempi', 'alempi', 'lievä', 'vaikea', 'paikallinen', 'diffuusi', 'useita', 'invasiivinen'],
    sv: ['utan', 'samt', 'med', 'typ', 'grad', 'akut', 'kronisk', 'primär', 'vänster', 'höger', 'bilateral',
        'främre', 'bakre', 'övre', 'nedre', 'lindrig', 'svår', 'fokal', 'diffus'],
    de: ['ohne', 'und', 'mit', 'typ', 'grad', 'stadium', 'akut', 'akute', 'akuter', 'chronisch', 'chronische',
        'primär', 'links', 'rechts', 'beidseitig', 'vorder', 'hinter', 'ober', 'unter', 'leicht', 'schwer', 'fokal', 'diffus'],
    es: ['con', 'sin', 'tipo', 'grado', 'estadio', 'aguda', 'agudo', 'cronica', 'cronico', 'primario', 'primaria',
        'izquierdo', 'izquierda', 'derecho', 'derecha', 'bilateral', 'anterior', 'posterior', 'inferior', 'superior',
        'leve', 'grave', 'focal', 'difuso', 'difusa'],
    it: ['con', 'senza', 'tipo', 'grado', 'stadio', 'acuta', 'acuto', 'cronica', 'cronico', 'primario', 'primaria',
        'sinistro', 'sinistra', 'destro', 'destra', 'bilaterale', 'anteriore', 'posteriore', 'inferiore', 'superiore',
        'lieve', 'grave', 'focale', 'diffuso', 'diffusa'],
    fr: ['avec', 'sans', 'type', 'grade', 'stade', 'aigu', 'aigue', 'chronique', 'primitif', 'primitive', 'gauche',
        'droit', 'droite', 'bilateral', 'anterieur', 'posterieur', 'inferieur', 'superieur', 'leger', 'severe',
        'focal', 'diffus', 'diffuse'],
    kk: ['және', 'жоқ', 'түрі', 'дәрежесі', 'жедел', 'созылмалы', 'біріншілік', 'сол', 'оң', 'алдыңғы', 'артқы',
        'жоғарғы', 'төменгі', 'жеңіл', 'ауыр'],
});

/**
 * Sent when the guard removed every sentence of a reply. In the CASE
 * language, because it is the specialist speaking: an English question in a
 * Finnish conversation was the FI-0010 review's "English GUARD fallback"
 * finding. Dialogue lives in a per-language table, like the patient's alarm
 * lines (alarmSpeechLines.js), not in the UI catalogues: the reply follows
 * the case, not the learner's interface language.
 */
export const GUARD_FALLBACK_REPLIES = Object.freeze({
    en: "What do you make of it yourself? Tell me what you've seen and what supports it.",
    fi: 'Mitä itse ajattelet löydöksistä? Kerro, mitä olet havainnut ja mihin tulkintasi perustuu.',
    sv: 'Vad tror du själv om fynden? Berätta vad du har sett och vad din tolkning bygger på.',
    de: 'Was denken Sie selbst über die Befunde? Sagen Sie mir, was Sie gesehen haben und worauf Ihre Einschätzung beruht.',
    es: '¿Qué piensas tú de los hallazgos? Cuéntame qué has visto y en qué basas tu interpretación.',
    it: 'Che cosa ne pensi tu dei reperti? Dimmi che cosa hai osservato e su che cosa si basa la tua interpretazione.',
    fr: "Qu'en pensez-vous vous-même ? Dites-moi ce que vous avez observé et sur quoi repose votre interprétation.",
    kk: 'Табылған өзгерістер туралы өзіңіз не ойлайсыз? Не көргеніңізді және пайымдауыңыз неге сүйенетінін айтыңыз.',
});

/**
 * Languages whose words take long suffix chains (case endings, possessives,
 * clitics), so a guarded word is matched as a PREFIX of any length:
 * "adenokarsinoom" catches adenokarsinoomaan, adenokarsinoomaa,
 * adenokarsinooman, adenokarsinoomien. Everywhere else a guarded word may
 * only grow by a plural/genitive-sized ending (see specialistBrief.js).
 */
export const AGGLUTINATIVE_LANGUAGES = Object.freeze(['fi', 'kk']);

/** The registry codes every table above must cover (asserted in a test). */
export const LEXICON_LANGUAGES = Object.freeze(Object.keys(LANGUAGES));
