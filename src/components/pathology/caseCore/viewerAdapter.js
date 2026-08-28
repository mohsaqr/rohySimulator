import { cloneCanonical } from './canonicalJson.js';
import { validateManifestStructure, validateRubricStructure } from './structuralValidation.js';
import { specimenDisplayName } from '../specimenNaming.js';

function firstRendition(asset, kinds) {
    return kinds.map((kind) => asset.renditions.find((entry) => entry.kind === kind)).find(Boolean) ?? null;
}

/**
 * Resolve a v1 manifest to the flattened shape consumed by today's viewer.
 * Protected data is excluded unless explicitly requested by an instructor
 * host, and multi-slide rubrics are refused because the legacy scorer cannot
 * represent them safely.
 */
export function toLegacyViewerCase(manifest, {
    rubric = null,
    includeProtected = false,
    resolveRendition,
} = {}) {
    const manifestIssues = validateManifestStructure(manifest);
    if (manifestIssues.length > 0) {
        throw new TypeError(`toLegacyViewerCase(): invalid manifest: ${manifestIssues.map((entry) => entry.path).join(', ')}`);
    }
    if (includeProtected) {
        const rubricIssues = validateRubricStructure(rubric);
        if (rubricIssues.length > 0) {
            throw new TypeError(`toLegacyViewerCase(): includeProtected needs a valid rubric: ${rubricIssues.map((entry) => entry.path).join(', ')}`);
        }
    }
    if (resolveRendition !== undefined && typeof resolveRendition !== 'function') {
        throw new TypeError('toLegacyViewerCase(): resolveRendition must be a function');
    }

    const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
    const slides = manifest.slides.map((slide) => {
        const asset = assetById.get(slide.assetId);
        const rendition = asset ? firstRendition(asset, ['dzi', 'iiif', 'ome-zarr', 'dicomweb']) : null;
        const uri = resolveRendition?.({ asset, rendition, slide }) ?? rendition?.uri ?? '';
        return {
            id: slide.id,
            label: slide.label,
            stain: slide.stain.display,
            dzi: uri,
            nativeObjective: asset?.metadata.nativeObjective,
            nativeMpp: asset?.metadata.nativeMpp,
            downsample: asset?.metadata.downsample,
            slideWidthPx: asset?.metadata.widthPx,
            slideHeightPx: asset?.metadata.heightPx,
        };
    });

    const specimens = manifest.specimens.map((specimen) => ({
        id: specimen.id,
        // One naming rule for the room and the editor, so the two screens never
        // disagree about what the author is looking at.
        name: specimenDisplayName(specimen),
        part: specimen.part,
        description: specimen.description,
        dimensions: specimen.dimensions,
        weight: specimen.weight,
        images: specimen.grossImageAssetIds.flatMap((assetId) => {
            const asset = assetById.get(assetId);
            const rendition = asset && firstRendition(asset, ['image']);
            return rendition ? [{
                id: asset.id,
                src: resolveRendition?.({ asset, rendition, specimen }) ?? rendition.uri,
                caption: specimenDisplayName(specimen),
                scaleMm: asset.metadata.scaleMm,
            }] : [];
        }),
    }));

    const activity = manifest.activities[0] ?? null;
    let task = activity ? {
        id: activity.id,
        prompt: activity.prompt,
        instructions: activity.instructions,
    } : undefined;
    if (includeProtected && task) {
        const privateActivity = rubric.activities.find((entry) => entry.activityId === activity.id);
        if (privateActivity?.slideCriteria.length > 1) {
            throw new RangeError('toLegacyViewerCase(): the legacy answerKey cannot safely represent multi-slide criteria');
        }
        const criteria = privateActivity?.slideCriteria[0];
        task = {
            ...task,
            hints: privateActivity?.hints ?? [],
            ...(privateActivity ? {
                answerKey: {
                    ...(privateActivity.diagnosis ? {
                        diagnosis: privateActivity.diagnosis.expected,
                        accept: privateActivity.diagnosis.accept,
                        requireTerms: privateActivity.diagnosis.requireTerms,
                        rejectTerms: privateActivity.diagnosis.rejectTerms,
                    } : {}),
                    ...(criteria ? {
                        screeningObjective: criteria.screeningObjective,
                        coverageObjective: criteria.coverageObjective,
                        coverageGrid: criteria.coverageGrid,
                        tissueBounds: cloneCanonical(criteria.tissueBounds),
                        roi: criteria.rois.map((roi) => ({ ...cloneCanonical(roi), slideId: criteria.slideId })),
                    } : { roi: [] }),
                },
            } : {}),
        };
    }

    return {
        id: manifest.id,
        accession: manifest.clinical.accession ?? '',
        specimen: manifest.clinical.specimenSummary ?? '',
        slides,
        ...(specimens.length > 0 ? { specimens } : {}),
        ...(task ? { task } : {}),
    };
}

