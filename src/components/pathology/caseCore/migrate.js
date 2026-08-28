import { CASE_SCHEMA_URI, CASE_SCHEMA_VERSION, RUBRIC_SCHEMA_URI } from './constants.js';
import { canonicalJSONStringify, cloneCanonical } from './canonicalJson.js';
import { deterministicId, isStableId, preserveOrDeriveId } from './ids.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asString = (value) => (typeof value === 'string' ? value : '');
const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function warning(path, code, message) {
    return { severity: 'warning', source: 'migration', path, code, message };
}

function deterministicTimestamp(legacy) {
    const candidates = [legacy.updatedAt, legacy.createdAt, legacy.exportedAt];
    const found = candidates.find((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    return found ? new Date(found).toISOString() : '1970-01-01T00:00:00.000Z';
}

function migratedStain(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { code: asString(value.code), display: asString(value.display), ...(value.system ? { system: asString(value.system) } : {}) };
    }
    const display = asString(value) || 'Unspecified';
    return { code: display.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24) || 'UNKNOWN', display };
}

function migrateGrossSpecimens(legacy, caseId, warnings) {
    const assets = [];
    const specimens = asArray(legacy.specimens).flatMap((entry, specimenIndex) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            warnings.push(warning(`$.specimens[${specimenIndex}]`, 'dropped_malformed_specimen', 'Malformed legacy gross specimen was not migrated.'));
            return [];
        }
        const specimenId = preserveOrDeriveId(entry.id, 'specimen', caseId, entry.part, specimenIndex);
        const grossImageAssetIds = asArray(entry.images).flatMap((image, imageIndex) => {
            if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.src !== 'string' || image.src.length === 0) {
                warnings.push(warning(`$.specimens[${specimenIndex}].images[${imageIndex}]`, 'dropped_malformed_image', 'Gross image without a usable source was not migrated.'));
                return [];
            }
            const assetId = preserveOrDeriveId(image.id, 'asset', caseId, specimenId, 'gross', imageIndex);
            assets.push({
                id: assetId,
                kind: 'gross-image',
                source: { kind: 'external', uri: image.src, revision: null, checksum: null },
                metadata: { ...(positive(image.scaleMm) ? { scaleMm: image.scaleMm } : {}) },
                renditions: [{ kind: 'image', uri: image.src, checksum: null }],
            });
            return [assetId];
        });
        return [{
            id: specimenId,
            part: asString(entry.part) || String(specimenIndex + 1),
            label: asString(entry.label) || `Part ${asString(entry.part) || specimenIndex + 1}`,
            description: asString(entry.description),
            ...(entry.dimensions !== undefined ? { dimensions: asString(entry.dimensions) } : {}),
            ...(entry.weight !== undefined ? { weight: asString(entry.weight) } : {}),
            grossImageAssetIds,
        }];
    });
    return { specimens, assets };
}

function migrateSlides(legacy, caseId, blockId, warnings) {
    const assets = [];
    const slides = asArray(legacy.slides).flatMap((entry, slideIndex) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            warnings.push(warning(`$.slides[${slideIndex}]`, 'dropped_malformed_slide', 'Malformed legacy slide was not migrated.'));
            return [];
        }
        const slideId = preserveOrDeriveId(entry.id, 'slide', caseId, slideIndex, entry.label);
        const assetId = deterministicId('asset', caseId, slideId, 'wsi');
        const uri = asString(entry.dzi);
        const metadata = {
            ...(positive(entry.slideWidthPx) ? { widthPx: entry.slideWidthPx } : {}),
            ...(positive(entry.slideHeightPx) ? { heightPx: entry.slideHeightPx } : {}),
            ...(positive(entry.nativeObjective) ? { nativeObjective: entry.nativeObjective } : {}),
            ...(positive(entry.nativeMpp) ? { nativeMpp: entry.nativeMpp } : {}),
            ...(positive(entry.downsample) ? { downsample: entry.downsample } : {}),
        };
        assets.push({
            id: assetId,
            kind: 'wsi',
            source: { kind: 'external', ...(uri ? { uri } : {}), revision: null, checksum: null },
            metadata,
            renditions: uri ? [{ kind: 'dzi', uri, checksum: null }] : [],
        });
        return [{ id: slideId, blockId, assetId, label: asString(entry.label), stain: migratedStain(entry.stain) }];
    });
    return { slides, assets };
}

function migrateRoi(entry, caseId, slideId, index, warnings, path) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        warnings.push(warning(path, 'dropped_malformed_roi', 'Malformed legacy ROI was not migrated.'));
        return null;
    }
    const coords = ['x', 'y', 'w', 'h'].map((key) => finite(entry[key]));
    if (coords.some((value) => value === undefined)) {
        warnings.push(warning(path, 'dropped_malformed_roi', 'Legacy ROI without finite x/y/w/h was not migrated.'));
        return null;
    }
    return {
        id: preserveOrDeriveId(entry.id, 'roi', caseId, slideId, index),
        label: asString(entry.label),
        x: coords[0], y: coords[1], w: coords[2], h: coords[3],
        minObjective: positive(entry.minObjective) ?? 1,
        dwellMs: positive(entry.dwellMs) ?? 1000,
        critical: entry.critical === true,
    };
}

function defaultBounds(asset, warnings, path) {
    if (positive(asset?.metadata?.widthPx) && positive(asset?.metadata?.heightPx)) {
        warnings.push(warning(path, 'inferred_tissue_bounds', 'Missing tissue bounds were expanded to the whole slide and require author review.'));
        return { x: 0, y: 0, w: asset.metadata.widthPx, h: asset.metadata.heightPx };
    }
    warnings.push(warning(path, 'placeholder_tissue_bounds', 'Missing tissue bounds could not be inferred; a 1 × 1 placeholder requires author review.'));
    return { x: 0, y: 0, w: 1, h: 1 };
}

function migrateTask(legacyTask, manifest, caseId, revisionId, warnings) {
    if (!legacyTask || typeof legacyTask !== 'object' || Array.isArray(legacyTask)) {
        return { activities: [], rubricActivities: [] };
    }
    const activityId = preserveOrDeriveId(legacyTask.id, 'activity', caseId, 'legacy-task');
    const activity = {
        id: activityId,
        kind: 'diagnostic-report',
        prompt: asString(legacyTask.prompt),
        instructions: asString(legacyTask.instructions),
    };
    const hasAnswerKey = !!legacyTask.answerKey && typeof legacyTask.answerKey === 'object'
        && !Array.isArray(legacyTask.answerKey);
    const key = asObject(legacyTask.answerKey);
    const rawRois = asArray(key.roi);
    const slideIds = new Set(manifest.slides.map((slide) => slide.id));
    const primarySlideId = manifest.slides[0]?.id ?? null;
    const assignedSlideIds = [...new Set(rawRois.map((roi) => (
        roi && isStableId(roi.slideId) && slideIds.has(roi.slideId) ? roi.slideId : primarySlideId
    )).filter(Boolean))];
    if (hasAnswerKey && rawRois.length === 0 && primarySlideId) assignedSlideIds.push(primarySlideId);
    if (manifest.slides.length > 1 && rawRois.some((roi) => !roi?.slideId)) {
        warnings.push(warning('$.task.answerKey.roi', 'legacy_primary_slide_semantics', 'Untagged legacy ROIs retain the old behavior and are assigned to the first slide.'));
    }
    const assetBySlide = new Map(manifest.slides.map((slide) => [
        slide.id, manifest.assets.find((asset) => asset.id === slide.assetId),
    ]));
    const slideCriteria = assignedSlideIds.map((slideId) => {
        const rois = rawRois.flatMap((roi, index) => {
            const assigned = roi && isStableId(roi.slideId) && slideIds.has(roi.slideId) ? roi.slideId : primarySlideId;
            if (assigned !== slideId) return [];
            const migrated = migrateRoi(roi, caseId, slideId, index, warnings, `$.task.answerKey.roi[${index}]`);
            return migrated ? [migrated] : [];
        });
        const bounds = slideId === primarySlideId && key.tissueBounds && typeof key.tissueBounds === 'object'
            && ['x', 'y', 'w', 'h'].every((field) => finite(key.tissueBounds[field]) !== undefined)
            ? { x: key.tissueBounds.x, y: key.tissueBounds.y, w: key.tissueBounds.w, h: key.tissueBounds.h }
            : defaultBounds(assetBySlide.get(slideId), warnings, '$.task.answerKey.tissueBounds');
        return {
            slideId,
            weight: 1,
            screeningObjective: positive(key.screeningObjective) ?? 5,
            coverageObjective: positive(key.coverageObjective) ?? 2,
            coverageGrid: Number.isInteger(key.coverageGrid) ? key.coverageGrid : 12,
            tissueBounds: bounds,
            rois,
        };
    });
    const expected = asString(key.diagnosis);
    const diagnosis = expected || key.accept || key.requireTerms || key.rejectTerms ? {
        expected,
        accept: asArray(key.accept).filter((value) => typeof value === 'string'),
        requireTerms: asArray(key.requireTerms).filter((value) => typeof value === 'string'),
        rejectTerms: asArray(key.rejectTerms).filter((value) => typeof value === 'string'),
    } : undefined;
    return {
        activities: [activity],
        rubricActivities: [{
            activityId,
            hints: asArray(legacyTask.hints).filter((value) => typeof value === 'string'),
            ...(diagnosis ? { diagnosis } : {}),
            slideCriteria,
        }],
        revisionId,
    };
}

/**
 * Convert the versionless flattened format into canonical public/private v1
 * documents. The same input always produces the same IDs and timestamp.
 */
export function migrateLegacyCase(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('migrateLegacyCase(): expected a legacy case object');
    }
    const legacy = input;
    const warnings = [];
    if (!Array.isArray(legacy.slides)) warnings.push(warning('$.slides', 'missing_slides_array', 'Legacy slides was not an array and was migrated as empty.'));

    let fingerprint;
    try { fingerprint = canonicalJSONStringify(legacy, 0); } catch { fingerprint = `${legacy.id ?? ''}|${legacy.accession ?? ''}|${legacy.specimen ?? ''}`; }
    const caseId = preserveOrDeriveId(legacy.id, 'case', fingerprint);
    const revisionId = deterministicId('revision', caseId, fingerprint, CASE_SCHEMA_VERSION);
    const migratedGross = migrateGrossSpecimens(legacy, caseId, warnings);
    const unassignedSpecimenId = deterministicId('specimen', caseId, 'unassigned-legacy-lineage');
    const unassignedBlockId = deterministicId('block', caseId, 'unassigned-legacy-lineage');
    const needsLineage = asArray(legacy.slides).length > 0;
    const specimens = needsLineage
        ? [...migratedGross.specimens, {
            id: unassignedSpecimenId,
            part: '?',
            label: 'Unassigned legacy specimen',
            description: asString(legacy.specimen),
            grossImageAssetIds: [],
        }]
        : migratedGross.specimens;
    const blocks = needsLineage ? [{ id: unassignedBlockId, specimenId: unassignedSpecimenId, label: 'Unassigned legacy block' }] : [];
    if (needsLineage) warnings.push(warning('$.slides', 'lineage_needs_review', 'Legacy slides had no specimen/block links and were attached to explicit unassigned placeholders.'));

    const migratedSlides = migrateSlides(legacy, caseId, unassignedBlockId, warnings);
    const manifest = {
        $schema: CASE_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: caseId,
        revision: {
            id: revisionId,
            number: 1,
            status: 'draft',
            parentRevisionId: null,
            createdAt: deterministicTimestamp(legacy),
            createdBy: 'legacy-migration',
        },
        title: asString(legacy.title) || asString(legacy.accession) || asString(legacy.specimen) || caseId,
        clinical: { accession: asString(legacy.accession), specimenSummary: asString(legacy.specimen) },
        specimens,
        blocks,
        assets: [...migratedGross.assets, ...migratedSlides.assets],
        slides: migratedSlides.slides,
        activities: [],
        provenance: {
            migration: {
                from: 'legacy-versionless',
                lineageNeedsReview: needsLineage,
                warnings: warnings.map((entry) => entry.code),
            },
        },
    };
    const migratedTask = migrateTask(legacy.task, manifest, caseId, revisionId, warnings);
    manifest.activities = migratedTask.activities;
    manifest.provenance.migration.warnings = warnings.map((entry) => entry.code);
    const rubric = {
        $schema: RUBRIC_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: deterministicId('rubric', caseId, revisionId),
        caseId,
        caseRevisionId: revisionId,
        activities: migratedTask.rubricActivities,
    };
    return { manifest, rubric, warnings, migrated: true };
}

/** Route a supported case document to the necessary migration. */
export function migrateCase(input, { rubric = null } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('migrateCase(): expected a case object');
    }
    if (input.schemaVersion === undefined) return migrateLegacyCase(input);
    if (input.schemaVersion === CASE_SCHEMA_VERSION) {
        return { manifest: cloneCanonical(input), rubric: rubric === null ? null : cloneCanonical(rubric), warnings: [], migrated: false };
    }
    const major = String(input.schemaVersion).split('.')[0];
    if (major !== CASE_SCHEMA_VERSION.split('.')[0]) {
        throw new RangeError(`migrateCase(): unsupported future schema major ${JSON.stringify(input.schemaVersion)}`);
    }
    throw new RangeError(`migrateCase(): no migration path from schemaVersion ${JSON.stringify(input.schemaVersion)}`);
}
