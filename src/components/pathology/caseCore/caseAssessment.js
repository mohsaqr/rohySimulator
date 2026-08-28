import { scoreRead } from '../readAssessment.js';
import { validateRubricStructure } from './structuralValidation.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function validateCaseSamples(samples) {
    if (!Array.isArray(samples)) throw new TypeError('scoreCaseRead(): samples must be an array');
    samples.forEach((sample, index) => {
        if (!sample || typeof sample !== 'object' || typeof sample.slideId !== 'string' || sample.slideId.length === 0) {
            throw new TypeError(`scoreCaseRead(): sample at index ${index} needs a non-empty slideId`);
        }
        if (!finite(sample.t)) throw new TypeError(`scoreCaseRead(): sample at index ${index} needs finite t`);
        if (index > 0 && sample.t < samples[index - 1].t) {
            throw new RangeError(`scoreCaseRead(): sample at index ${index} is out of time order`);
        }
    });
}

function activeSlideSamples(samples, slideId, tailMs) {
    const durations = samples.map((sample, index) => (
        index < samples.length - 1 ? samples[index + 1].t - sample.t : tailMs
    ));
    let activeTime = 0;
    let lastTailMs = 0;
    const compacted = [];
    samples.forEach((sample, index) => {
        if (sample.slideId !== slideId) return;
        compacted.push({ ...sample, t: activeTime });
        activeTime += durations[index];
        lastTailMs = durations[index];
    });
    return { samples: compacted, tailMs: compacted.length > 0 ? lastTailMs : 0 };
}

function rubricActivity(rubric, activityId) {
    if (activityId !== undefined) {
        const found = rubric.activities.find((activity) => activity.activityId === activityId);
        if (!found) throw new RangeError(`scoreCaseRead(): rubric has no activity ${JSON.stringify(activityId)}`);
        return found;
    }
    if (rubric.activities.length !== 1) {
        throw new RangeError('scoreCaseRead(): activityId is required unless the rubric has exactly one activity');
    }
    return rubric.activities[0];
}

/**
 * Score a whole case without mixing coordinate spaces between slides.
 *
 * Time while another slide is active is removed before invoking the proven
 * single-slide scorer. Otherwise filtering by slide would make one sample own
 * the entire gap until that slide was revisited and falsely award dwell.
 */
export function scoreCaseRead(samples, rubric, options = {}) {
    validateCaseSamples(samples);
    const rubricIssues = validateRubricStructure(rubric);
    if (rubricIssues.length > 0) {
        throw new TypeError(`scoreCaseRead(): invalid rubric: ${rubricIssues.map((entry) => entry.path).join(', ')}`);
    }
    const tailMs = options.tailMs ?? 0;
    if (!finite(tailMs) || tailMs < 0) throw new TypeError('scoreCaseRead(): tailMs must be finite and non-negative');
    const activity = rubricActivity(rubric, options.activityId);
    const criteriaIds = new Set(activity.slideCriteria.map((criteria) => criteria.slideId));
    const unscoredSlideIds = [...new Set(samples.map((sample) => sample.slideId).filter((id) => !criteriaIds.has(id)))];

    const perSlide = activity.slideCriteria.map((criteria) => {
        const active = activeSlideSamples(samples, criteria.slideId, tailMs);
        const answerKey = {
            roi: criteria.rois,
            screeningObjective: criteria.screeningObjective,
            coverageObjective: criteria.coverageObjective,
            coverageGrid: criteria.coverageGrid,
            tissueBounds: criteria.tissueBounds,
        };
        const score = scoreRead(active.samples, answerKey, {
            tailMs: active.tailMs,
            ...(options.objectiveEpsilon !== undefined ? { objectiveEpsilon: options.objectiveEpsilon } : {}),
        });
        const effectiveScore = score.readScore ?? score.slideCoverage;
        return { slideId: criteria.slideId, weight: criteria.weight, effectiveScore, ...score };
    });

    const weighted = perSlide.filter((entry) => entry.effectiveScore !== null);
    const weightTotal = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    const aggregate = {
        readScore: weightTotal > 0
            ? weighted.reduce((sum, entry) => sum + entry.effectiveScore * entry.weight, 0) / weightTotal
            : null,
        totalTimeMs: perSlide.reduce((sum, entry) => sum + entry.totalTimeMs, 0),
        roiTotal: perSlide.reduce((sum, entry) => sum + entry.roiTotal, 0),
        roiReached: perSlide.reduce((sum, entry) => sum + entry.roiReached, 0),
        criticalTotal: perSlide.reduce((sum, entry) => sum + entry.criticalTotal, 0),
        criticalReached: perSlide.reduce((sum, entry) => sum + entry.criticalReached, 0),
    };
    aggregate.roiCoverage = aggregate.roiTotal > 0 ? aggregate.roiReached / aggregate.roiTotal : null;
    return { activityId: activity.activityId, perSlide, aggregate, unscoredSlideIds };
}

/**
 * Safely upgrade historical samples only when one slide makes their identity
 * unambiguous. Multi-slide history without slideId remains unverifiable.
 */
export function assignLegacySampleSlide(samples, slideIds) {
    if (!Array.isArray(samples) || !Array.isArray(slideIds)) throw new TypeError('assignLegacySampleSlide(): arrays required');
    if (samples.every((sample) => typeof sample?.slideId === 'string' && sample.slideId.length > 0)) {
        return samples.map((sample) => ({ ...sample }));
    }
    if (slideIds.length !== 1) {
        throw new RangeError('assignLegacySampleSlide(): samples without slideId are unverifiable for a multi-slide case');
    }
    return samples.map((sample) => ({ ...sample, slideId: sample?.slideId ?? slideIds[0] }));
}

