// Regression lock: a Finnish case's patient said "I feel hot and unwell." in English every time the fever alarm fired (vprohy FI-0017, 2026-10-13)
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALARM_SPEECH_LINES, alarmSpeechLine } from './alarmSpeechLines';
import { LANGUAGES } from '../../../server/shared/languages.js';
import { SEVERITY, SOURCES } from '../../notifications/types';

const alarm = (key, severity, data = {}) => ({ source: SOURCES.CLINICAL, key: `alarm:${key}`, severity, data });

describe('alarmSpeechLine', () => {
    it('speaks the case language: a Finnish fever alarm is Finnish', () => {
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.WARNING), 'fi')).toBe('On kuuma ja huono olo.');
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.CRITICAL), 'fi')).toBe('Tuntuu kuin palaisin.');
    });

    it('keeps the English lines for an English case', () => {
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.WARNING), 'en')).toBe('I feel hot and unwell.');
        expect(alarmSpeechLine(alarm('hr_high', SEVERITY.CRITICAL), 'en')).toBe('My heart is racing and I feel much worse.');
    });

    it('reads vital and direction from the data when present', () => {
        expect(alarmSpeechLine(alarm('whatever', SEVERITY.WARNING, { vital: 'spo2', thresholdType: 'low' }), 'sv'))
            .toBe(ALARM_SPEECH_LINES.sv.spo2_low[0]);
    });

    it('uses the language fallback for an alarm without its own line', () => {
        expect(alarmSpeechLine(alarm('glucose_low', SEVERITY.CRITICAL), 'fi')).toBe(ALARM_SPEECH_LINES.fi.fallback[1]);
    });

    it('speaks English for an unknown or missing case language', () => {
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.WARNING), 'xx')).toBe('I feel hot and unwell.');
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.WARNING), undefined)).toBe('I feel hot and unwell.');
    });

    it('says nothing for notifications that are not voiced alarms', () => {
        expect(alarmSpeechLine(null, 'fi')).toBeNull();
        expect(alarmSpeechLine({ ...alarm('temp_high', SEVERITY.WARNING), source: 'system' }, 'fi')).toBeNull();
        expect(alarmSpeechLine({ ...alarm('temp_high', SEVERITY.WARNING), key: 'lab:ready' }, 'fi')).toBeNull();
        expect(alarmSpeechLine(alarm('temp_high', SEVERITY.ERROR), 'fi')).toBeNull();
    });
});

describe('ALARM_SPEECH_LINES', () => {
    const englishKeys = Object.keys(ALARM_SPEECH_LINES.en).sort();

    it.each(Object.keys(LANGUAGES))('has a full set of lines for case language %s', (code) => {
        const lines = ALARM_SPEECH_LINES[code];
        expect(lines, `no alarm lines for ${code}`).toBeDefined();
        expect(Object.keys(lines).sort()).toEqual(englishKeys);
        for (const key of englishKeys) {
            expect(lines[key]).toHaveLength(2);
            for (const text of lines[key]) expect(text.trim().length, `${code}.${key}`).toBeGreaterThan(0);
        }
    });

    it.each(Object.keys(LANGUAGES).filter((c) => c !== 'en'))('%s is translated, not a copy of the English', (code) => {
        const copied = englishKeys.flatMap((key) => ALARM_SPEECH_LINES[code][key].filter((text, i) => text === ALARM_SPEECH_LINES.en[key][i]));
        expect(copied).toEqual([]);
    });

    it('has no lines for a language rohy does not offer', () => {
        expect(Object.keys(ALARM_SPEECH_LINES).filter((c) => !(c in LANGUAGES))).toEqual([]);
    });
});

describe('ChatInterface wiring', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ChatInterface.jsx'), 'utf8');

    it('passes the case language to the alarm line', () => {
        expect(src).toMatch(/alarmSpeechLine\(notification, caseLanguage\)/);
    });
});
