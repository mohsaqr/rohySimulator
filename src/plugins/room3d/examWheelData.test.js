import { describe, it, expect } from 'vitest';
import { BODY_REGIONS } from '../../data/examRegions';
import { SUPINE_REGIONS_3D } from './examRegions3d.js';
import { examsForRegion, supineRegionsWithExams } from './examWheelData.js';

describe('examWheelData', () => {
    it('maps every supine region onto its real model techniques', () => {
        supineRegionsWithExams().forEach((region) => {
            const model = BODY_REGIONS[region.id];
            expect(model, `${region.id} must exist in the exam model`).toBeDefined();
            expect(region.exams.map((exam) => exam.id)).toEqual(model.examTypes);
        });
        expect(supineRegionsWithExams().length).toBe(SUPINE_REGIONS_3D.length);
    });

    it('labels canonical techniques as verbs and keeps model names otherwise', () => {
        const chest = examsForRegion('chestAnterior');
        expect(chest.find((exam) => exam.id === 'auscultation')).toMatchObject({
            label: 'Auscultate',
            hint: 'Listen',
        });
        expect(chest.every((exam) => exam.tests === undefined)).toBe(true);
    });

    it('attaches the model special tests to the special wedge', () => {
        const abdomen = examsForRegion('abdomen');
        const special = abdomen.find((exam) => exam.id === 'special');
        expect(special.tests).toEqual(BODY_REGIONS.abdomen.specialTests);
        expect(special.tests.length).toBeGreaterThanOrEqual(2);
        expect(examsForRegion('unknownRegion')).toBeNull();
    });

    it('keeps every region inside the wheel contract (max 8 techniques, 7 tests)', () => {
        supineRegionsWithExams().forEach((region) => {
            expect(region.exams.length).toBeLessThanOrEqual(8);
            region.exams.forEach((exam) => {
                if (exam.tests) expect(exam.tests.length).toBeLessThanOrEqual(7);
                expect(exam.label.length).toBeGreaterThan(0);
            });
        });
    });
});
