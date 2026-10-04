// Regression lock: count strings read "1 new results", "Ordered 1 test(s)", "1 study(s)" — they were not ICU plurals (QA 2026-10-04, PRV-33)
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import fs from 'node:fs';
import path from 'node:path';

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'sv', 'fi', 'kk'];
const KEYS = [
    'dashboard_ready_highlight_lab', 'dashboard_ready_highlight_radiology',
    'toast_ordered_lab', 'toast_ordered_lab_instant',
    'toast_ordered_radiology', 'toast_ordered_radiology_instant',
];
const load = (lang, ns) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../src/locales/${lang}/${ns}.json`), 'utf8'));
// The same pipeline the app uses (i18next + the ICU plugin), on one key.
const format = (msg, lang, count) => {
    const i18n = i18next.createInstance();
    i18n.use(ICU).init({ lng: lang, initImmediate: false, resources: { [lang]: { translation: { msg } } } });
    return i18n.t('msg', { count });
};

describe('count strings are plurals, not "(s)" hedges', () => {
    it.each(LOCALES)('%s carries no "(s)"-style hedge in the count strings', (lang) => {
        const inv = load(lang, 'investigations');
        KEYS.forEach((k) => {
            expect(inv[k], `${lang}:${k}`).toBeTruthy();
            expect(inv[k], `${lang}:${k}`).not.toMatch(/\((s|en|es|ar|e\)?s)\)/);
        });
    });

    it('English reads naturally for one and for many', () => {
        const inv = load('en', 'investigations');
        expect(format(inv.dashboard_ready_highlight_lab, 'en', 1)).toBe('1 new result');
        expect(format(inv.dashboard_ready_highlight_lab, 'en', 3)).toBe('3 new results');
        expect(format(inv.toast_ordered_lab, 'en', 1)).toBe('Ordered 1 test');
        expect(format(inv.toast_ordered_radiology, 'en', 1)).toBe('Ordered 1 study');
        expect(format(inv.toast_ordered_radiology, 'en', 2)).toBe('Ordered 2 studies');
    });

    it('Finnish and German inflect the singular', () => {
        expect(format(load('fi', 'investigations').toast_ordered_lab, 'fi', 1)).toBe('Tilattiin 1 koe');
        expect(format(load('fi', 'investigations').toast_ordered_lab, 'fi', 4)).toBe('Tilattiin 4 koetta');
        expect(format(load('de', 'investigations').dashboard_ready_highlight_lab, 'de', 1)).toBe('1 neues Ergebnis');
    });
});

// Regression lock: lab and radiology report headers still carried the old product name "VipSim Medical Center" (QA 2026-10-04, PRV-37)
describe('report header carries no retired product name', () => {
    it.each(LOCALES)('%s', (lang) => {
        expect(load(lang, 'investigations').medical_center).not.toMatch(/vipsim/i);
    });
});
