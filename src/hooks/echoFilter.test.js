import { describe, it, expect } from 'vitest';
import {
    BARGE_IN_MIN_NOVEL_WORDS,
    BARGE_IN_WINDOW_WORDS,
    normalizeWord,
    buildVocab,
    matchesVocab,
    detectInterruption,
    learnerTurnText,
} from './echoFilter';

const EN = 'I have had chest pain since yesterday morning. It gets worse when I climb stairs.';
const FI = 'Minulla on ollut rintakipua eilisaamusta asti. Kipu pahenee, kun nousen portaita.';
const DE = 'Ich habe seit gestern Morgen starke Schmerzen in der Brust. Es wird schlimmer, wenn ich Treppen steige.';
const ES = 'Me duele el pecho desde ayer por la mañana. Está peor cuando subo las escaleras.';

const detect = (final, interim, patientText) => detectInterruption({ final, interim, patientText });

describe('echoFilter constants', () => {
    it('needs 2 novel words among the newest 4', () => {
        expect(BARGE_IN_MIN_NOVEL_WORDS).toBe(2);
        expect(BARGE_IN_WINDOW_WORDS).toBe(4);
        expect(BARGE_IN_WINDOW_WORDS).toBeGreaterThanOrEqual(BARGE_IN_MIN_NOVEL_WORDS);
    });
});

describe('normalizeWord', () => {
    it('lowercases, strips punctuation and diacritics', () => {
        expect(normalizeWord('Está,')).toBe('esta');
        expect(normalizeWord('Schmerzen.')).toBe('schmerzen');
        expect(normalizeWord('Straße')).toBe('strasse');
        expect(normalizeWord("don't")).toBe('dont');
        expect(normalizeWord('Pähkinä!')).toBe('pahkina');
        expect(normalizeWord('—')).toBe('');
    });
});

describe('matchesVocab', () => {
    const vocab = buildVocab(EN);
    it('matches exactly, diacritic-insensitively and with small typos', () => {
        expect(matchesVocab('chest', vocab)).toBe(true);
        expect(matchesVocab('mourning', vocab)).toBe(true); // 1 edit from morning
        expect(matchesVocab('yes', vocab)).toBe(true); // cut-off "yesterday"
        expect(matchesVocab('where', vocab)).toBe(false);
        expect(buildVocab(ES).has(normalizeWord('esta'))).toBe(true);
    });
    it('is strict on short words: "is" is not "it"', () => {
        expect(matchesVocab('is', vocab)).toBe(false);
    });
    it('knows adjacent patient words written together', () => {
        expect(matchesVocab('sinceyesterday', vocab)).toBe(true);
    });
});

describe('detectInterruption — echo never interrupts', () => {
    it('ignores the patient\'s own words, exact or partial, final or interim', () => {
        expect(detect('', '', EN).interrupt).toBe(false);
        expect(detect('I have had chest pain', '', EN).interrupt).toBe(false);
        expect(detect('I have had chest pain since yesterday morning', 'it gets worse', EN).interrupt).toBe(false);
        expect(detect('', 'when I climb', EN).interrupt).toBe(false);
    });

    it('ignores garbled echo: misheard, split or merged words', () => {
        // "pane" for "pain", "yes terday" for "yesterday", "mourning".
        expect(detect('I have had chest', 'pane since yes terday mourning', EN).interrupt).toBe(false);
        // Two words merged, punctuation and case changed.
        expect(detect('i Have had Chest-pain', 'since Yesterday.', EN).interrupt).toBe(false);
    });

    it('ignores Finnish, German and Spanish echo, accents dropped included', () => {
        expect(detect('Minulla on ollut', 'rintakipua eilisaamusta', FI).interrupt).toBe(false);
        expect(detect('kipu pahenee kun', 'nousen portaita', FI).interrupt).toBe(false);
        expect(detect('Ich habe seit gestern Morgen', 'starke Schmerzen in der Brust', DE).interrupt).toBe(false);
        expect(detect('es wird schlimer wenn', 'ich treppen steige', DE).interrupt).toBe(false); // schlimer: 1 edit
        expect(detect('me duele el pecho desde ayer', 'por la manana esta peor', ES).interrupt).toBe(false);
    });

    it('needs two novel words: one stray word is not an interruption', () => {
        const d = detect('I have had chest pain since', 'yesterday banana', EN);
        expect(d.interrupt).toBe(false);
        expect(d.novel).toEqual(['banana']);
    });

    it('does not count one-letter words or bare numbers as novel', () => {
        expect(detect('I have had chest pain', 'a 3', EN).interrupt).toBe(false);
        expect(detect('chest pain since', 'x 12 y', EN).interrupt).toBe(false);
    });

    it('only looks at the newest words: old scattered garble does not add up', () => {
        // "banana" and "violin" are both novel, but far apart and old.
        const final = 'I have had banana chest pain since yesterday violin morning it gets worse when I climb stairs';
        expect(detect(final, '', EN).interrupt).toBe(false);
    });
});

describe('detectInterruption — the learner interrupts', () => {
    // Regression lock: one-word stop/wait commands work in every case language without treating patient commands as learner speech.
    it.each(['Stop!', 'Wait', 'Stopp', 'Warte', 'Para', 'Espera', 'Ferma', 'Aspetta', 'Arrête', 'Attends', 'Seis', 'Odota', 'Stanna', 'Vänta', 'Тоқта', 'Күт'])('accepts the exact command %s', (command) => {
        const d = detect('I have had chest pain', command, EN);
        expect(d.interrupt).toBe(true);
        expect(learnerTurnText({ final: 'I have had chest pain', interim: command, patientText: EN, ...d })).toBe(command);
        expect(detect('', command, `I said ${command}`).interrupt).toBe(false);
    });

    // Regression lock: a long interim's first learner words are outside the four-word detection window.
    it('keeps the whole learner sentence, including a shared opening phrase', () => {
        const final = 'I have had chest pain';
        const interim = 'Chest pain, where exactly does it radiate and how long does it last?';
        const d = detectInterruption({ final, interim, patientText: EN, echoFinal: final });
        expect(d.interrupt).toBe(true);
        expect(learnerTurnText({ final, interim, ...d })).toBe(interim);
        expect(learnerTurnText({ final: `${final} ${interim}`, interim: '', ...d })).toBe(interim);
    });

    it('two novel words at the tail interrupt', () => {
        const d = detect('I have had chest pain since yesterday', 'where exactly', EN);
        expect(d.interrupt).toBe(true);
        expect(d.novel).toEqual(['where', 'exactly']);
    });

    it('in Finnish, German and Spanish', () => {
        expect(detect('Minulla on ollut rintakipua', 'missä kohtaa', FI).interrupt).toBe(true);
        expect(detect('Ich habe seit gestern', 'Moment bitte', DE).interrupt).toBe(true);
        expect(detect('Me duele el pecho', 'perdone usted', ES).interrupt).toBe(true);
    });

    it('when the learner\'s words are mixed with echo still arriving', () => {
        expect(detect('I have had chest pain', 'since sorry yesterday doctor', EN).interrupt).toBe(true);
    });

    it('cutFinal counts the final tokens before the learner\'s first word', () => {
        expect(detect('I have had chest pain since yesterday', 'where exactly', EN).cutFinal).toBe(7);
        // Learner words already finalised.
        expect(detect('I have had chest pain where exactly', '', EN).cutFinal).toBe(5);
    });
});

describe('learnerTurnText', () => {
    const turn = (final, interim, cutFinal) => learnerTurnText({ final, interim, patientText: EN, cutFinal });

    it('drops the leading echo and keeps everything from the first own word', () => {
        expect(turn('I have had chest pain since yesterday', 'where exactly is it', 7)).toBe('where exactly is it');
        // The interim echo got finalised later: still stripped by content.
        expect(turn('I have had chest pain since yesterday morning where exactly is', 'it', 7)).toBe('where exactly is it');
    });

    it('keeps the learner\'s casing and punctuation, and later patient words', () => {
        expect(turn('I have had chest pain', 'Where exactly is the pain?', 5)).toBe('Where exactly is the pain?');
    });

    it('is empty when only echo was heard', () => {
        expect(turn('I have had chest pain', '', 0)).toBe('');
    });

    it('works in Finnish, German and Spanish', () => {
        expect(learnerTurnText({ final: 'Minulla on ollut rintakipua', interim: 'missä kohtaa tarkalleen', patientText: FI, cutFinal: 4 }))
            .toBe('missä kohtaa tarkalleen');
        expect(learnerTurnText({ final: 'Ich habe seit gestern Morgen', interim: 'Moment, wo genau?', patientText: DE, cutFinal: 5 }))
            .toBe('Moment, wo genau?');
        expect(learnerTurnText({ final: 'me duele el pecho', interim: 'perdone, ¿dónde exactamente?', patientText: ES, cutFinal: 4 }))
            .toBe('perdone, ¿dónde exactamente?');
    });

    it('agrees with detectInterruption on the same text (invariant)', () => {
        const samples = [
            ['I have had chest pain since yesterday', 'where exactly is it'],
            ['I have had chest pain', 'since sorry yesterday doctor'],
            ['I have had chest pain where exactly', ''],
        ];
        for (const [final, interim] of samples) {
            const d = detect(final, interim, EN);
            const text = learnerTurnText({ final, interim, patientText: EN, cutFinal: d.cutFinal });
            expect(text).not.toBe('');
            // The turn starts with a word the patient did not say.
            expect(matchesVocab(normalizeWord(text.split(/\s+/)[0]), buildVocab(EN))).toBe(false);
        }
    });
});

describe('Codex review 2026-11-02: commands, numbers and units', () => {
    // Regression lock: a truncated echo of a longer patient word became a stop command ("I was waiting" heard as "I was wait", fi "Odotan lääkettä" heard as "odota") and cut the patient off.
    it.each([
        ['I was waiting for the nurse', 'I was', 'wait'],
        ['Odotan lääkettä vielä', '', 'odota'],
        ['The pain stopped after an hour', 'the pain', 'stop'],
        ['Ich warte schon lange', 'ich', 'warte'],
        ['Estoy esperando al médico', 'estoy', 'espera'],
    ])('a command word that truncates or nearly matches the patient\'s own word is echo: %s', (patient, final, interim) => {
        expect(detect(final, interim, patient).interrupt).toBe(false);
    });

    it('a command the patient did not say (nor anything like it) still interrupts', () => {
        expect(detect('I was waiting for the nurse', 'stop', 'I was waiting for the nurse').interrupt).toBe(true);
        expect(detect('Odotan lääkettä', 'seis', 'Odotan lääkettä vielä').interrupt).toBe(true);
    });

    // Regression lock: the patient saying "25 mg" was recognised as "twenty five milligrams" — three novel words — and the patient interrupted itself.
    it.each([
        ['I take 25 mg of aspirin every day.', 'I take', 'twenty five milligrams of aspirin'],
        ['My temperature was 38.5° this morning.', 'my temperature was', 'thirty eight point five degrees'],
        ['My pulse was 110 bpm and my pressure 150/90 mmHg.', 'my pulse was', 'one hundred and ten beats per minute'],
        ['Oxygen was 92% at home.', 'oxygen was', 'ninety two percent'],
        ['Ich nehme 25 mg täglich.', 'ich nehme', 'fünfundzwanzig Milligramm'],
        ['Tomo 25 mg al día.', 'tomo', 'veinticinco miligramos'],
        ['Prendo 25 mg al giorno.', 'prendo', 'venticinque milligrammi'],
        ['Je prends 25 mg par jour.', 'je prends', 'vingt-cinq milligrammes'],
        ['Otan 25 mg päivässä.', 'otan', 'kaksikymmentäviisi milligrammaa'],
        ['Jag tar 25 mg om dagen.', 'jag tar', 'tjugofem milligram'],
        ['Мен 25 мг ішемін.', 'мен', 'жиырма бес миллиграмм'],
    ])('spoken numbers and units echo the patient\'s digits and unit symbols: %s', (patient, final, interim) => {
        expect(detect(final, interim, patient).interrupt).toBe(false);
    });

    it('number and unit words are novel when the patient said no number or unit', () => {
        expect(detect('I have had chest pain', 'twenty five milligrams', EN).interrupt).toBe(true);
    });

    it('a learner sentence over a dosed reply still interrupts, and starts at the learner\'s first word', () => {
        const patient = 'I take 25 mg of aspirin every day.';
        expect(detect('I take 25 mg', 'sorry doctor which pharmacy', patient).interrupt).toBe(true);
        const final = 'I take twenty five milligrams';
        const interim = 'sorry doctor which pharmacy';
        const d = detectInterruption({ final, interim, patientText: patient, echoFinal: 'I take' });
        expect(d.interrupt).toBe(true);
        expect(learnerTurnText({ final, interim, ...d })).toBe(interim);
    });

    // Regression lock: polite and plural commands (fi "odottakaa", fr "attendez", es "espere", kk "тоқтаңыз") were ignored.
    it.each([
        'Warten', 'Stoppen', 'Espere', 'Esperen', 'Paren', 'Aspetti', 'Si fermi', 'Aspettate', 'Fermatevi',
        'Attendez', 'Arrêtez', 'Odottakaa', 'Lopeta', 'Lopettakaa', 'Stoppa', 'Тоқтаңыз', 'Күтіңіз', 'Тоқтаңдар', 'Күтіңдер',
    ])('accepts the polite or plural command %s', (command) => {
        const d = detect('I have had chest pain', command, EN);
        expect(d.interrupt).toBe(true);
        expect(detect('', command, `I said ${command}`).interrupt).toBe(false);
    });
});
