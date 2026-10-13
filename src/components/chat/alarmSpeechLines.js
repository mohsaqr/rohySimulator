// What the patient says when a monitor alarm fires.
//
// These are the PATIENT speaking, so they follow the case language, not the
// UI language: a Finnish case played with an English interface still has a
// Finnish patient. That is why they live here and not in the i18n catalogues
// — those follow the UI language and are lazy-loaded per UI language, so the
// Finnish lines would not even be in memory for an English-UI learner.
//
// Every language in server/shared/languages.js must have a full set; the test
// next to this file enforces it, so adding a language fails loudly instead of
// leaving that case's patient speaking English.

import { SEVERITY, SOURCES } from '../../notifications/types';

// [warning, critical] per `${vital}_${thresholdType}`, plus a `fallback` pair
// for an alarm without a line of its own.
export const ALARM_SPEECH_LINES = {
    en: {
        hr_high: ['My heart feels like it is racing.', 'My heart is racing and I feel much worse.'],
        hr_low: ['I feel weak and a little lightheaded.', 'I feel very weak and lightheaded.'],
        spo2_low: ['I am getting more short of breath.', 'I feel much more short of breath.'],
        bpSys_low: ['I feel dizzy and lightheaded.', 'I feel like I might pass out.'],
        bpDia_low: ['I feel dizzy and lightheaded.', 'I feel like I might pass out.'],
        bpSys_high: ['My head is starting to pound.', 'My head is pounding and I feel worse.'],
        bpDia_high: ['My head is starting to pound.', 'My head is pounding and I feel worse.'],
        rr_high: ['It is getting harder to breathe.', 'I cannot catch my breath.'],
        rr_low: ['I feel unusually drowsy.', 'I feel very drowsy and it is hard to breathe.'],
        temp_high: ['I feel hot and unwell.', 'I feel like I am burning up.'],
        temp_low: ['I feel cold and shaky.', 'I am shivering and feel very cold.'],
        etco2_high: ['I feel more drowsy.', 'I feel drowsy and short of breath.'],
        etco2_low: ['I feel lightheaded.', 'I feel lightheaded and short of breath.'],
        fallback: ['I am starting to feel worse.', 'Something feels really wrong. I feel worse.'],
    },
    fi: {
        hr_high: ['Sydän tuntuu hakkaavan tosi kovaa.', 'Sydän hakkaa ja olo on paljon huonompi.'],
        hr_low: ['Olo on heikko ja vähän huimaa.', 'Olo on tosi heikko ja huimaa.'],
        spo2_low: ['Hengästyttää yhä enemmän.', 'Henkeä ahdistaa paljon enemmän.'],
        bpSys_low: ['Huimaa ja pyörryttää.', 'Tuntuu, että pyörryn kohta.'],
        bpDia_low: ['Huimaa ja pyörryttää.', 'Tuntuu, että pyörryn kohta.'],
        bpSys_high: ['Päätä alkaa jyskyttää.', 'Päätä jyskyttää ja olo on huonompi.'],
        bpDia_high: ['Päätä alkaa jyskyttää.', 'Päätä jyskyttää ja olo on huonompi.'],
        rr_high: ['Hengittäminen käy raskaammaksi.', 'En saa henkeä.'],
        rr_low: ['Väsyttää jotenkin oudosti.', 'Väsyttää kovasti, ja on vaikea hengittää.'],
        temp_high: ['On kuuma ja huono olo.', 'Tuntuu kuin palaisin.'],
        temp_low: ['Palelee ja vapisuttaa.', 'Tärisen ja minulla on tosi kylmä.'],
        etco2_high: ['Väsyttää yhä enemmän.', 'Väsyttää, ja henkeä ahdistaa.'],
        etco2_low: ['Päässä vähän huippaa.', 'Päässä huippaa ja henkeä ahdistaa.'],
        fallback: ['Olo alkaa mennä huonommaksi.', 'Nyt on jotain tosi pahasti vialla. Olo on huonompi.'],
    },
    sv: {
        hr_high: ['Det känns som att hjärtat rusar.', 'Hjärtat rusar och jag mår mycket sämre.'],
        hr_low: ['Jag känner mig svag och lite yr.', 'Jag känner mig väldigt svag och yr.'],
        spo2_low: ['Jag blir allt mer andfådd.', 'Jag är mycket mer andfådd nu.'],
        bpSys_low: ['Jag känner mig yr och vimmelkantig.', 'Det känns som att jag ska svimma.'],
        bpDia_low: ['Jag känner mig yr och vimmelkantig.', 'Det känns som att jag ska svimma.'],
        bpSys_high: ['Det börjar dunka i huvudet.', 'Det dunkar i huvudet och jag mår sämre.'],
        bpDia_high: ['Det börjar dunka i huvudet.', 'Det dunkar i huvudet och jag mår sämre.'],
        rr_high: ['Det blir svårare att andas.', 'Jag får ingen luft.'],
        rr_low: ['Jag känner mig ovanligt dåsig.', 'Jag är väldigt dåsig och har svårt att andas.'],
        temp_high: ['Jag känner mig varm och mår dåligt.', 'Det känns som att jag brinner upp.'],
        temp_low: ['Jag fryser och darrar.', 'Jag skakar och fryser väldigt mycket.'],
        etco2_high: ['Jag blir allt mer dåsig.', 'Jag är dåsig och andfådd.'],
        etco2_low: ['Jag känner mig lite yr.', 'Jag är yr och andfådd.'],
        fallback: ['Jag börjar må sämre.', 'Något är verkligen fel. Jag mår sämre.'],
    },
    de: {
        hr_high: ['Mein Herz rast.', 'Mein Herz rast und mir geht es viel schlechter.'],
        hr_low: ['Ich fühle mich schwach und etwas benommen.', 'Ich fühle mich sehr schwach und benommen.'],
        spo2_low: ['Ich bekomme immer schlechter Luft.', 'Ich bekomme viel schlechter Luft.'],
        bpSys_low: ['Mir ist schwindlig.', 'Ich habe das Gefühl, gleich ohnmächtig zu werden.'],
        bpDia_low: ['Mir ist schwindlig.', 'Ich habe das Gefühl, gleich ohnmächtig zu werden.'],
        bpSys_high: ['Mein Kopf fängt an zu pochen.', 'Mein Kopf pocht und mir geht es schlechter.'],
        bpDia_high: ['Mein Kopf fängt an zu pochen.', 'Mein Kopf pocht und mir geht es schlechter.'],
        rr_high: ['Das Atmen fällt mir schwerer.', 'Ich bekomme keine Luft.'],
        rr_low: ['Ich bin ungewöhnlich schläfrig.', 'Ich bin sehr schläfrig und das Atmen fällt mir schwer.'],
        temp_high: ['Mir ist heiß und ich fühle mich krank.', 'Ich habe das Gefühl zu glühen.'],
        temp_low: ['Mir ist kalt und ich zittere.', 'Ich zittere und mir ist furchtbar kalt.'],
        etco2_high: ['Ich werde immer schläfriger.', 'Ich bin schläfrig und bekomme schlecht Luft.'],
        etco2_low: ['Mir ist etwas schwindlig.', 'Mir ist schwindlig und ich bekomme schlecht Luft.'],
        fallback: ['Mir geht es langsam schlechter.', 'Irgendetwas stimmt gar nicht. Mir geht es schlechter.'],
    },
    es: {
        hr_high: ['Siento el corazón muy acelerado.', 'El corazón me va a mil y me encuentro mucho peor.'],
        hr_low: ['Me siento débil y un poco mareado.', 'Me siento muy débil y mareado.'],
        spo2_low: ['Cada vez me falta más el aire.', 'Me falta mucho más el aire.'],
        bpSys_low: ['Estoy mareado.', 'Siento que me voy a desmayar.'],
        bpDia_low: ['Estoy mareado.', 'Siento que me voy a desmayar.'],
        bpSys_high: ['Me empieza a latir la cabeza.', 'Me late la cabeza y me encuentro peor.'],
        bpDia_high: ['Me empieza a latir la cabeza.', 'Me late la cabeza y me encuentro peor.'],
        rr_high: ['Me cuesta cada vez más respirar.', 'No puedo recuperar el aliento.'],
        rr_low: ['Tengo un sueño muy raro.', 'Tengo mucho sueño y me cuesta respirar.'],
        temp_high: ['Tengo calor y me encuentro mal.', 'Siento que estoy ardiendo.'],
        temp_low: ['Tengo frío y estoy temblando.', 'Estoy tiritando y tengo muchísimo frío.'],
        etco2_high: ['Cada vez tengo más sueño.', 'Tengo sueño y me falta el aire.'],
        etco2_low: ['Estoy algo mareado.', 'Estoy mareado y me falta el aire.'],
        fallback: ['Empiezo a encontrarme peor.', 'Algo va muy mal. Me encuentro peor.'],
    },
    it: {
        hr_high: ['Sento il cuore che batte fortissimo.', 'Il cuore mi batte all’impazzata e sto molto peggio.'],
        hr_low: ['Mi sento debole e un po’ stordito.', 'Mi sento molto debole e stordito.'],
        spo2_low: ['Mi manca sempre più il fiato.', 'Mi manca molto di più il fiato.'],
        bpSys_low: ['Mi gira la testa.', 'Mi sembra di svenire.'],
        bpDia_low: ['Mi gira la testa.', 'Mi sembra di svenire.'],
        bpSys_high: ['La testa comincia a pulsarmi.', 'La testa mi pulsa e sto peggio.'],
        bpDia_high: ['La testa comincia a pulsarmi.', 'La testa mi pulsa e sto peggio.'],
        rr_high: ['Faccio sempre più fatica a respirare.', 'Non riesco a riprendere fiato.'],
        rr_low: ['Ho una strana sonnolenza.', 'Ho molto sonno e faccio fatica a respirare.'],
        temp_high: ['Ho caldo e mi sento male.', 'Mi sembra di bruciare.'],
        temp_low: ['Ho freddo e tremo.', 'Sto tremando e ho tantissimo freddo.'],
        etco2_high: ['Ho sempre più sonno.', 'Ho sonno e mi manca il fiato.'],
        etco2_low: ['Mi gira un po’ la testa.', 'Mi gira la testa e mi manca il fiato.'],
        fallback: ['Comincio a sentirmi peggio.', 'C’è qualcosa che non va. Sto peggio.'],
    },
    fr: {
        hr_high: ['J’ai le cœur qui s’emballe.', 'Mon cœur s’emballe et je me sens beaucoup plus mal.'],
        hr_low: ['Je me sens faible et un peu étourdi.', 'Je me sens très faible et étourdi.'],
        spo2_low: ['Je suis de plus en plus essoufflé.', 'Je suis beaucoup plus essoufflé.'],
        bpSys_low: ['J’ai la tête qui tourne.', 'J’ai l’impression que je vais m’évanouir.'],
        bpDia_low: ['J’ai la tête qui tourne.', 'J’ai l’impression que je vais m’évanouir.'],
        bpSys_high: ['Ma tête commence à cogner.', 'Ma tête cogne et je me sens plus mal.'],
        bpDia_high: ['Ma tête commence à cogner.', 'Ma tête cogne et je me sens plus mal.'],
        rr_high: ['J’ai de plus en plus de mal à respirer.', 'Je n’arrive pas à reprendre mon souffle.'],
        rr_low: ['Je me sens anormalement somnolent.', 'Je suis très somnolent et j’ai du mal à respirer.'],
        temp_high: ['J’ai chaud et je ne me sens pas bien.', 'J’ai l’impression de brûler.'],
        temp_low: ['J’ai froid et je tremble.', 'Je grelotte et j’ai très froid.'],
        etco2_high: ['Je suis de plus en plus somnolent.', 'Je suis somnolent et essoufflé.'],
        etco2_low: ['J’ai un peu la tête qui tourne.', 'J’ai la tête qui tourne et je suis essoufflé.'],
        fallback: ['Je commence à me sentir plus mal.', 'Quelque chose ne va vraiment pas. Je me sens plus mal.'],
    },
    kk: {
        hr_high: ['Жүрегім қатты соғып тұр.', 'Жүрегім қатты соғып, халім әлдеқайда нашарлады.'],
        hr_low: ['Әлсіздік бар, басым сәл айналады.', 'Қатты әлсіздік бар, басым айналады.'],
        spo2_low: ['Тынысым барған сайын тарылып барады.', 'Тынысым әлдеқайда тарылды.'],
        bpSys_low: ['Басым айналып тұр.', 'Есімнен танып қалатын сияқтымын.'],
        bpDia_low: ['Басым айналып тұр.', 'Есімнен танып қалатын сияқтымын.'],
        bpSys_high: ['Басым солқылдай бастады.', 'Басым солқылдап, халім нашарлады.'],
        bpDia_high: ['Басым солқылдай бастады.', 'Басым солқылдап, халім нашарлады.'],
        rr_high: ['Тыныс алу қиындап барады.', 'Демімді ала алмай жатырмын.'],
        rr_low: ['Ерекше ұйқым келіп тұр.', 'Қатты ұйқым келеді, тыныс алу қиын.'],
        temp_high: ['Ыстығым көтеріліп, халім нашар.', 'Күйіп бара жатқандаймын.'],
        temp_low: ['Тоңып, қалтырап тұрмын.', 'Қатты қалтырап, өте тоңып тұрмын.'],
        etco2_high: ['Ұйқым барған сайын келе түсуде.', 'Ұйқым келеді, тынысым тарылды.'],
        etco2_low: ['Басым сәл айналады.', 'Басым айналып, тынысым тарылды.'],
        fallback: ['Халім нашарлай бастады.', 'Бірдеңе қатты дұрыс емес. Халім нашарлады.'],
    },
};

/**
 * The line the patient says for an alarm notification, in the case language,
 * or null when the notification is not an alarm the patient should voice.
 *
 * @param {object} notification  a notification-center entry
 * @param {string} language      the case language code; an unknown one speaks English
 * @returns {string|null}
 */
export function alarmSpeechLine(notification, language) {
    if (notification?.source !== SOURCES.CLINICAL) return null;
    if (!notification.key?.startsWith('alarm:')) return null;
    if (![SEVERITY.WARNING, SEVERITY.CRITICAL].includes(notification.severity)) return null;

    const data = notification.data || {};
    const key = notification.key.replace(/^alarm:/, '');
    const vital = data.vital || key.split('_')[0];
    const kind = data.thresholdType || key.split('_').slice(1).join('_');
    const level = notification.severity === SEVERITY.CRITICAL ? 1 : 0;

    const lines = ALARM_SPEECH_LINES[language] || ALARM_SPEECH_LINES.en;
    return (lines[`${vital}_${kind}`] || lines.fallback)[level];
}
