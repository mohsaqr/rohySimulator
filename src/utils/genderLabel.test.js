// Regression lock: patient headers printed the stored English gender ("55 v Male") under a Finnish UI (QA 2026-10-04, PRV-33)
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { genderLabel } from './genderLabel.js';
import { genderDisplayKey } from '../../server/shared/patientDemographics.js';
import fiCommon from '../locales/fi/common.json';
import enCommon from '../locales/en/common.json';

const tFor = (lang, common) => {
    const i18n = i18next.createInstance();
    i18n.init({ lng: lang, initImmediate: false, resources: { [lang]: { common } } });
    return i18n.t.bind(i18n);
};

describe('genderLabel', () => {
    it('translates the stored English label, whatever its case', () => {
        const t = tFor('fi', fiCommon);
        expect(genderLabel(t, 'Male')).toBe('Mies');
        expect(genderLabel(t, 'female')).toBe('Nainen');
        expect(genderLabel(t, ' Other ')).toBe('Muu');
    });

    it('shows nothing for a missing or unknown value rather than an untranslated word', () => {
        const t = tFor('en', enCommon);
        expect(genderLabel(t, null)).toBe('');
        expect(genderLabel(t, 'X')).toBe('');
        expect(genderDisplayKey(42)).toBeNull();
    });

    it('every UI language has all three labels', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.resolve(__dirname, '../locales');
        const langs = fs.readdirSync(dir).filter((l) => l !== 'en-XA' && fs.existsSync(path.join(dir, l, 'common.json')));
        langs.forEach((l) => {
            const common = JSON.parse(fs.readFileSync(path.join(dir, l, 'common.json'), 'utf8'));
            ['gender_male', 'gender_female', 'gender_other'].forEach((k) => expect(common[k], `${l}:${k}`).toBeTruthy());
        });
    });
});
