import { BODY_REGIONS, EXAM_TECHNIQUES } from '../../data/examRegions';
import { SUPINE_REGIONS_3D } from './examRegions3d.js';

// Adapts Rohy's exam model (BODY_REGIONS examTypes + specialTests) into the
// 3D room's exam-wheel contract: each region gets exams [{id, label, hint,
// tests?}] so the wheel renders REAL techniques for that region, and every
// wedge click round-trips through the same model ids the 2D examination
// room uses. No technique or test is invented here — this file only
// relabels what examRegions.js declares.

// Wedge copy per canonical technique: an imperative verb plus a one-word
// hint. Techniques outside the canon (the neuro set) fall back to the
// model's own display name so nothing is dropped.
const TECHNIQUE_WEDGES = {
    inspection: { label: 'Inspect', hint: 'Look' },
    palpation: { label: 'Palpate', hint: 'Feel' },
    percussion: { label: 'Percuss', hint: 'Tap' },
    auscultation: { label: 'Auscultate', hint: 'Listen' },
    special: { label: 'Special', hint: 'Maneuvers' },
};

/**
 * Exam-wheel definitions for one region, or null for a region the model
 * does not know. Special tests ride along on the special technique; the
 * room flattens a single test onto the main ring and sub-rings 2+.
 */
export function examsForRegion(regionId) {
    const region = BODY_REGIONS[regionId];
    if (!region) return null;
    return region.examTypes.map((typeId) => {
        const wedge = TECHNIQUE_WEDGES[typeId];
        const technique = EXAM_TECHNIQUES[typeId];
        const tests = typeId === 'special' && region.specialTests?.length
            // The wheel's sub-ring holds at most 7 named tests (8 wedges
            // with Back); the model's current maximum is 7, so the slice
            // only guards future content growth.
            ? { tests: region.specialTests.slice(0, 7) }
            : {};
        return {
            id: typeId,
            label: wedge?.label ?? technique?.name ?? typeId,
            hint: wedge?.hint ?? '',
            ...tests,
        };
    });
}

/**
 * The supine 3D regions with their real exams attached — the body_regions
 * value Exam3DScreen mounts the room with.
 */
export function supineRegionsWithExams() {
    return SUPINE_REGIONS_3D.map((region) => {
        const exams = examsForRegion(region.id);
        return exams ? { ...region, exams } : { ...region };
    });
}
