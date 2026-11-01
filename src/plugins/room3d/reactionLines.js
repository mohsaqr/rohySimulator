// What the patient says in the 3D room when an exam finds something abnormal.
//
// The PATIENT is speaking, so these follow the CASE language, not the UI
// language: a Finnish case played with an English interface still has a
// Finnish patient (PRV-64, the same defect as the monitor-alarm lines in
// src/components/chat/alarmSpeechLines.js). They used to be `room3d`
// catalogue keys read through the UI-language translator — and the
// catalogues are lazy-loaded per UI language, so the Finnish lines were not
// even in memory for an English-UI learner.
//
// Every language in server/shared/languages.js must have a full set; the test
// next to this file enforces it.

// One line per exam region the room reacts to, plus a `fallback` for any
// other region.
export const EXAM_REACTION_LINES = {
    en: {
        chestAnterior: 'Ah— that is sore when you press there.',
        heart: 'I can feel my heart racing when you listen.',
        abdomen: 'That really hurts when you push on my belly.',
        fallback: 'Mm— that does not feel right.',
    },
    fi: {
        chestAnterior: 'Ai – tuohon sattuu, kun painatte.',
        heart: 'Tunnen sydämeni hakkaavan, kun kuuntelette.',
        abdomen: 'Tuo sattuu todella, kun painatte vatsaani.',
        fallback: 'Mm – tuo ei tunnu oikealta.',
    },
    sv: {
        chestAnterior: 'Aj – det gör ont när ni trycker där.',
        heart: 'Jag känner hur hjärtat rusar när ni lyssnar.',
        abdomen: 'Det gör verkligen ont när ni trycker på magen.',
        fallback: 'Mm – det känns inte rätt.',
    },
    de: {
        chestAnterior: 'Ah – da tut es weh, wenn Sie drücken.',
        heart: 'Ich spüre mein Herz rasen, wenn Sie abhören.',
        abdomen: 'Das tut richtig weh, wenn Sie auf meinen Bauch drücken.',
        fallback: 'Mm – das fühlt sich nicht richtig an.',
    },
    es: {
        chestAnterior: 'Ay… ahí me duele cuando aprieta.',
        heart: 'Siento el corazón acelerado cuando me ausculta.',
        abdomen: 'Eso duele mucho cuando aprieta la barriga.',
        fallback: 'Mm… eso no se siente bien.',
    },
    it: {
        chestAnterior: 'Ah… lì fa male quando preme.',
        heart: 'Sento il cuore che corre quando ascolta.',
        abdomen: 'Fa davvero male quando preme sulla pancia.',
        fallback: 'Mm… questo non va bene.',
    },
    fr: {
        chestAnterior: 'Aïe— c’est douloureux quand vous appuyez là.',
        heart: 'Je sens mon cœur s’emballer quand vous écoutez.',
        abdomen: 'Ça fait vraiment mal quand vous appuyez sur mon ventre.',
        fallback: 'Mm— ça ne va pas, là.',
    },
    kk: {
        chestAnterior: 'Аһ— сол жерді басқанда ауырады.',
        heart: 'Тыңдағаныңызда жүрегімнің жиі соғып тұрғанын сеземін.',
        abdomen: 'Ішімді басқанда шынымен қатты ауырады.',
        fallback: 'Мм— бір жері дұрыс емес сияқты.',
    },
};

/**
 * The line the patient says when an exam of `regionId` is abnormal, in the
 * case language.
 *
 * @param {string} regionId  a 3D exam region id (e.g. 'chestAnterior')
 * @param {string} language  the case language code; an unknown one speaks English
 * @returns {string}
 */
export function examReactionLine(regionId, language) {
    const lines = EXAM_REACTION_LINES[language] || EXAM_REACTION_LINES.en;
    return Object.hasOwn(lines, regionId) ? lines[regionId] : lines.fallback;
}
