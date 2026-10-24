// The on-call specialist's reply guard, against a Finnish case.
//
// Regression lock: FI-0010 journey review, finding F02 (2026-10-14). The
// guard extracted only the whole authored answer phrases and matched them as
// exact words, so with the FI-0010 pathology config every sentence below but
// the first reached the learner unchanged (`removed: 0`): the bare
// "adenokarsinooma", its inflected forms, "syöpä", and the English
// "adenocarcinoma". The all-removed fallback was an English question in a
// Finnish conversation. Each `it` in the first two blocks fails against that
// guard.

import { describe, it, expect } from 'vitest';
import {
    GUARD_FALLBACK_REPLIES,
    buildReplyGuard,
    createStreamReplyGuard,
    guardFallbackReply,
    guardHasTerms,
    guardSpecialistReply,
    isMalignantAnswer,
    normaliseForMatch,
    stemForGuard,
} from '../../server/services/specialistBrief.js';
import {
    GENERIC_WORDS,
    LEXICON_LANGUAGES,
    MALIGNANCY_TERMS,
} from '../../server/services/specialistGuardLexicon.js';
import { LANGUAGES } from '../../server/shared/languages.js';

// The answer-bearing fields of FI-0010 as imported (tmp/codex-fi-review/
// case.json), plus the learner-visible requisition wording the case shows.
const FI_CONFIG = Object.freeze({
    case_language: 'fi',
    diagnosis: 'Sigmasuolen adenokarsinooma (kolorektaalinen adenokarsinooma), joka kasvaa lihaskerroksen läpi '
        + 'suolta ympäröivään rasvakudokseen; CDX2-positiivisuus tukee suolistoperäistä alkuperää. Välikarsinan '
        + 'imusolmukkeissa antrakoosi ilman metastaaseja. Maksassa makrovesikulaarinen rasvoittuminen ilman '
        + 'metastaaseja. Etäpesäkkeitä ei osoiteta; jatkohoito moniammatilliseen kasvainkokoukseen.',
    pathology: {
        manifest: {
            title: 'Sigmasuolen resektaatti, välikarsinan imusolmukkeet ja maksabiopsia',
            specimens: [{
                part: 'A',
                label: 'Sigmasuolen resektaatti',
                description: 'Näytteenä on avattu paksusuolen (sigmasuolen) segmentti, pituus 24 cm.',
            }],
        },
        rubric: {
            activities: [{
                activityId: 'act-1',
                diagnosis: {
                    expected: 'Paksusuolen adenokarsinooma',
                    accept: ['kolorektaalinen adenokarsinooma', 'sigmasuolen adenokarsinooma',
                        'paksusuolen adenokarsinooma', 'koolonin adenokarsinooma'],
                    requireTerms: ['adenokarsinooma'],
                    rejectTerms: ['hyvänlaatuinen', 'divertikuliitti'],
                },
            }],
        },
    },
});

const FI_FALLBACK = 'Johtopäätös on sinun tehtäväsi. Voin kertoa vain, mitä löydökset osoittavat.';

describe('reply guard on FI-0010 (F02)', () => {
    const guard = buildReplyGuard('pathology', FI_CONFIG);

    // The exact guard inputs of the review (pure-evidence.json), plus the
    // other forms the same defect let through.
    it.each([
        'Kyseessä on paksusuolen adenokarsinooma.',
        'Kyseessä on adenokarsinooma.',
        'Löydös sopii adenokarsinoomaan.',
        'Tämä on syöpä.',
        'This is adenocarcinoma.',
        'Paksusuolen adenokarsinoomaa näkyy näytteessä.',
        'Adenokarsinooman kasvutapa on tyypillinen.',
        'Syövän solut ovat atyyppisiä.',
        'Muutos on pahanlaatuinen.',
        'Kyseessä on kolorektaalisen syövän tyyppinen muutos.',
        'It is a malignant lesion.',
        'Es handelt sich um ein Adenokarzinom.',
    ])('removes %j', (sentence) => {
        expect(guardSpecialistReply(sentence, guard)).toEqual({ text: FI_FALLBACK, removed: 1 });
    });

    it('drops only the naming sentence and keeps the teaching around it', () => {
        const reply = 'Katso ensin rauhasten muotoa. Löydös sopii adenokarsinoomaan. Mitä näet rasvakudoksessa?';
        expect(guardSpecialistReply(reply, guard)).toEqual({
            text: 'Katso ensin rauhasten muotoa. Mitä näet rasvakudoksessa?',
            removed: 1,
        });
    });

    it('builds stems for the answer words and the malignancy class, in Finnish', () => {
        expect(guard.language).toBe('fi');
        expect(guard.stems).toEqual(expect.arrayContaining(['adenokarsinoom', 'kolorektaal', 'koolon']));
        expect(guard.classRoots).toEqual(expect.arrayContaining(['karsinoom', 'syop', 'carcinom', 'cancer']));
    });
});

describe('reply guard: what it must NOT block', () => {
    const guard = buildReplyGuard('pathology', FI_CONFIG);

    it.each([
        'Limakalvolla näkyy rauhasrakenteita.',
        // Words the learner reads on their own requisition are not the answer.
        'Paksusuolen limakalvolla näkyy rauhasrakenteita.',
        'Näyte on otettu sigmasuolesta.',
        'Suolen seinämässä näkyy kasvainsoluja.',
        'Solut ovat atyyppisiä. Mitä itse näet?',
        'Imusolmukkeissa on antrakoosia.',
        'Suoli, näyte ja solu ovat tavallisia sanoja.',
        'Koko on 3.5 cm ja muutos on kiinteä.',
    ])('keeps %j', (sentence) => {
        expect(guardSpecialistReply(sentence, guard)).toEqual({ text: sentence, removed: 0 });
    });

    it('does not split long prose diagnoses into guarded words', () => {
        // lihaskerroksen, rasvakudokseen, imusolmukkeissa, antrakoosi … come
        // from config.diagnosis, a whole report: none may be a stem.
        expect(guard.stems.some((s) => /lihaskerro|rasvakudo|imusolmuk|antrakoo|metastaas/.test(s))).toBe(false);
    });

    it('adds no malignancy class terms when the answer is benign', () => {
        const benign = buildReplyGuard('pathology', {
            case_language: 'fi',
            pathology: { rubric: { activities: [{ diagnosis: { expected: 'Divertikuliitti' } }] } },
        });
        expect(benign.classRoots).toEqual([]);
        expect(guardSpecialistReply('Pahanlaatuisuudesta ei ole merkkejä.', benign).removed).toBe(0);
        expect(guardSpecialistReply('Löydökset sopivat divertikuliittiin.', benign).removed).toBe(1);
    });

    it('keeps generic modifiers of an English label unguarded on their own', () => {
        const ecg = buildReplyGuard('ecg', {
            ecg: { rubric: { activities: [{ expected: { accepted_diagnoses: ['Anterior STEMI'], rhythm: 'atrial_fibrillation' } }] } },
        });
        expect(guardSpecialistReply('Look at the anterior leads first.', ecg).removed).toBe(0);
        expect(guardSpecialistReply('Is atrial activity visible?', ecg).removed).toBe(0);
        expect(guardSpecialistReply('This is a STEMI.', ecg).removed).toBe(1);
        expect(guardSpecialistReply('That looks like fibrillation.', ecg).removed).toBe(1);
    });

    it('lets an English answer word grow by a plural ending, not into another word', () => {
        const en = buildReplyGuard('pathology', {
            pathology: { rubric: { activities: [{ diagnosis: { expected: 'Invasive ductal carcinoma', requireTerms: ['invasive'] } }] } },
        });
        expect(guardSpecialistReply('The nests show invasion.', en).removed).toBe(0);
        expect(guardSpecialistReply('These are carcinomas.', en).removed).toBe(1);
        expect(guardSpecialistReply('Several ductal profiles are seen.', en).removed).toBe(1);
    });
});

describe('fallback question in the case language', () => {
    it('has one for every registry language', () => {
        expect(Object.keys(GUARD_FALLBACK_REPLIES).sort()).toEqual(Object.keys(LANGUAGES).sort());
        Object.values(GUARD_FALLBACK_REPLIES).forEach((text) => expect(text.trim().length).toBeGreaterThan(10));
    });

    it('answers in the case language, English for an unknown one', () => {
        expect(guardFallbackReply('fi')).toBe(FI_FALLBACK);
        expect(guardFallbackReply('xx')).toBe(GUARD_FALLBACK_REPLIES.en);
        const sv = buildReplyGuard('pathology', { case_language: 'sv', diagnosis: 'Adenokarcinom' });
        expect(guardSpecialistReply('Det är ett adenokarcinom.', sv)).toEqual({ text: GUARD_FALLBACK_REPLIES.sv, removed: 1 });
    });

    it('takes the fallback language only when the case has none', () => {
        expect(buildReplyGuard('pathology', { diagnosis: 'x y' }, { fallbackLanguage: 'de' }).language).toBe('de');
        expect(buildReplyGuard('pathology', { case_language: 'fi' }, { fallbackLanguage: 'de' }).language).toBe('fi');
        expect(buildReplyGuard('pathology', null).language).toBe('en');
    });
});

describe('streamed replies are guarded sentence by sentence', () => {
    const guard = buildReplyGuard('pathology', FI_CONFIG);
    const run = (deltas) => {
        const g = createStreamReplyGuard(guard);
        const written = deltas.map((d) => g.push(d));
        written.push(g.end());
        return { written, text: written.join(''), removed: g.removed };
    };

    it('never hands back any part of a naming sentence, however it is chunked', () => {
        const reply = 'Katso rauhasia. Löydös sopii adeno';
        const out = run([reply.slice(0, 7), reply.slice(7, 20), reply.slice(20), 'karsinoomaan. Mitä näet?']);
        expect(out.text).toBe('Katso rauhasia. Mitä näet?');
        expect(out.removed).toBe(1);
        expect(out.written.some((chunk) => /adeno|karsino/i.test(chunk))).toBe(false);
    });

    it('holds an open sentence back until it ends', () => {
        const g = createStreamReplyGuard(guard);
        expect(g.push('Tämä on ')).toBe('');
        expect(g.push('syöpä')).toBe('');
        expect(g.push('. ')).toBe('');
        expect(g.end()).toBe(FI_FALLBACK);
        expect(g.removed).toBe(1);
    });

    it('passes a clean reply through unchanged', () => {
        const reply = 'Limakalvolla näkyy rauhasrakenteita.\nMitä itse näet? Koko on 3.5 cm';
        const out = run(reply.split(/(?<=\s)/));
        expect(out.text).toBe(reply);
        expect(out.removed).toBe(0);
    });

    it('matches the non-streamed guard on every FI-0010 probe (invariant)', () => {
        ['Kyseessä on adenokarsinooma. Katso tumia.', 'This is adenocarcinoma.', 'Limakalvolla näkyy rauhasrakenteita.']
            .forEach((reply) => {
                const streamed = run([...reply]);
                const whole = guardSpecialistReply(reply, guard);
                expect(streamed.removed).toBe(whole.removed);
                expect(streamed.text.trim()).toBe(whole.text);
            });
    });
});

describe('lexicon coverage and helpers', () => {
    it('covers every registry language in every table', () => {
        const codes = Object.keys(LANGUAGES).sort();
        expect([...LEXICON_LANGUAGES].sort()).toEqual(codes);
        expect(Object.keys(MALIGNANCY_TERMS).sort()).toEqual(codes);
        expect(Object.keys(GENERIC_WORDS).sort()).toEqual(codes);
    });

    it('detects a malignant answer inside a compound word', () => {
        expect(isMalignantAnswer(['Paksusuolen adenokarsinooma'])).toBe(true);
        expect(isMalignantAnswer(['Adenokarzinom des Kolons'])).toBe(true);
        expect(isMalignantAnswer(['Divertikuliitti', 'acute appendicitis'])).toBe(false);
        // "sarcomere" and "myelomeningocele" are not malignancies.
        expect(isMalignantAnswer(['sarcomere disarray', 'myelomeningocele'])).toBe(false);
    });

    it('no malignancy word of any language hits an ordinary descriptive word (invariant)', () => {
        const guard = buildReplyGuard('pathology', { diagnosis: 'adenocarcinoma' });
        const ordinary = [
            'sarcomere', 'myelomeningocele', 'blastomere', 'suoli', 'näyte', 'solu', 'kasvain', 'kasvainsoluja',
            'tumour', 'Tumorzellen', 'limakalvo', 'rauhanen', 'imusolmuke', 'stroma', 'nucleus', 'mitosis',
            'necrosis', 'nekroosi', 'invasion', 'metastasis', 'etäpesäke', 'lymph', 'melanin', 'melanosis',
        ];
        ordinary.forEach((word) => expect(guardSpecialistReply(`${word}.`, guard).removed, word).toBe(0));
    });

    it('normalises diacritics the same way on every side', () => {
        expect(normaliseForMatch('Syöpä — CÁNCER!')).toBe('syopa cancer');
        expect(stemForGuard('adenokarsinooma', 'fi')).toBe('adenokarsinoom');
        expect(stemForGuard('kolorektaalinen', 'fi')).toBe('kolorektaal');
        expect(stemForGuard('carcinoma', 'en')).toBe('carcinom');
        expect(stemForGuard('suoli', 'fi')).toBe('suoli');
    });

    it('reports an empty guard as having nothing to look for', () => {
        expect(guardHasTerms(buildReplyGuard('radiology', {}))).toBe(false);
        expect(guardHasTerms(buildReplyGuard('pathology', FI_CONFIG))).toBe(true);
        expect(guardHasTerms(null)).toBe(false);
    });
});
