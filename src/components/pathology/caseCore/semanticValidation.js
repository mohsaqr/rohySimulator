import { REVISION_STATUS } from './constants.js';
import { validateCaseStructure } from './structuralValidation.js';

const severityOrder = { error: 0, warning: 1, note: 2 };

function semanticIssue(severity, path, code, message) {
    return { severity, source: 'semantic', path, code, message };
}

const ids = (rows) => new Set(rows.map((row) => row.id));
const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
const validRect = (rect) => rect.w > 0 && rect.h > 0;

function duplicateIds(rows) {
    const seen = new Set();
    const duplicates = new Set();
    rows.forEach((row) => {
        if (seen.has(row.id)) duplicates.add(row.id);
        seen.add(row.id);
    });
    return [...duplicates];
}

function sortIssues(issues) {
    return [...issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
        || a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

/**
 * Cross-document pathology validation.
 *
 * Structural validation always runs first. Semantic checks only inspect a
 * shape proven safe, so malformed imports produce issues rather than runtime
 * exceptions.
 */
export function validateCaseDocuments(manifest, rubric = null, options = {}) {
    const structural = validateCaseStructure(manifest, rubric);
    if (structural.length > 0) return structural;

    try {
        const issues = [];
        const add = (severity, path, code, message) => issues.push(semanticIssue(severity, path, code, message));
        const forPublication = options.forPublication ?? false;
        const maxZoomPixelRatio = options.maxZoomPixelRatio ?? 1.1;
        if (!(typeof maxZoomPixelRatio === 'number' && Number.isFinite(maxZoomPixelRatio) && maxZoomPixelRatio > 0)) {
            return [semanticIssue('error', '$options.maxZoomPixelRatio', 'invalid_option', 'maxZoomPixelRatio must be a finite positive number.')];
        }

        [['specimens', manifest.specimens], ['blocks', manifest.blocks], ['assets', manifest.assets],
            ['slides', manifest.slides], ['activities', manifest.activities]].forEach(([name, rows]) => {
            duplicateIds(rows).forEach((id) => add('error', `$.${name}`, 'duplicate_id', `Two ${name} share id "${id}".`));
        });

        if (manifest.slides.length === 0 && manifest.specimens.length === 0) {
            add('error', '$.slides', 'empty_case', 'A case must contain at least one slide or specimen.');
        }

        const specimenIds = ids(manifest.specimens);
        const blockIds = ids(manifest.blocks);
        const assetIds = ids(manifest.assets);
        const activityIds = ids(manifest.activities);
        const slideIds = ids(manifest.slides);
        const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));

        manifest.blocks.forEach((block, index) => {
            if (!specimenIds.has(block.specimenId)) {
                add('error', `$.blocks[${index}].specimenId`, 'dangling_specimen', `Block "${block.id}" references missing specimen "${block.specimenId}".`);
            }
        });

        manifest.specimens.forEach((specimen, index) => {
            duplicateIds(specimen.grossImageAssetIds.map((id) => ({ id }))).forEach((id) => {
                add('error', `$.specimens[${index}].grossImageAssetIds`, 'duplicate_asset_reference', `Specimen "${specimen.id}" repeats gross image asset "${id}".`);
            });
            specimen.grossImageAssetIds.forEach((assetId, imageIndex) => {
                const asset = assetById.get(assetId);
                if (!asset) {
                    add('error', `$.specimens[${index}].grossImageAssetIds[${imageIndex}]`, 'dangling_asset', `Specimen "${specimen.id}" references missing asset "${assetId}".`);
                } else if (asset.kind !== 'gross-image') {
                    add('error', `$.specimens[${index}].grossImageAssetIds[${imageIndex}]`, 'wrong_asset_kind', `Specimen gross image "${assetId}" is ${asset.kind}, not gross-image.`);
                }
            });
        });

        manifest.assets.forEach((asset, index) => {
            const at = `$.assets[${index}]`;
            if (asset.renditions.length === 0) add('error', `${at}.renditions`, 'missing_rendition', `Asset "${asset.id}" has no usable rendition.`);
            if (asset.source.kind === 'catalog' && !asset.source.catalogAssetId) {
                add('error', `${at}.source.catalogAssetId`, 'missing_catalog_id', `Catalog asset "${asset.id}" needs catalogAssetId.`);
            }
            if (asset.source.kind === 'external' && !asset.source.uri && asset.renditions.length === 0) {
                add('error', `${at}.source.uri`, 'missing_source_uri', `External asset "${asset.id}" has no source URI.`);
            }
            if (asset.kind === 'wsi') {
                ['widthPx', 'heightPx', 'nativeObjective', 'nativeMpp', 'downsample'].forEach((field) => {
                    if (!(asset.metadata[field] > 0)) add('error', `${at}.metadata.${field}`, 'missing_wsi_metadata', `WSI asset "${asset.id}" needs positive ${field}.`);
                });
                if (!asset.renditions.some((rendition) => ['dzi', 'iiif', 'ome-zarr', 'dicomweb'].includes(rendition.kind))) {
                    add('error', `${at}.renditions`, 'missing_wsi_rendition', `WSI asset "${asset.id}" has no tiled WSI rendition.`);
                }
            }
            if (forPublication && !asset.source.revision && !asset.source.checksum) {
                add('error', `${at}.source`, 'unpinned_asset', `Published case assets must be pinned by a source revision or checksum; "${asset.id}" is mutable.`);
            }
        });

        manifest.slides.forEach((slide, index) => {
            const at = `$.slides[${index}]`;
            if (!blockIds.has(slide.blockId)) {
                add('error', `${at}.blockId`, 'dangling_block', `Slide "${slide.id}" references missing block "${slide.blockId}".`);
            }
            if (!assetIds.has(slide.assetId)) {
                add('error', `${at}.assetId`, 'dangling_asset', `Slide "${slide.id}" references missing asset "${slide.assetId}".`);
            } else if (assetById.get(slide.assetId).kind !== 'wsi') {
                add('error', `${at}.assetId`, 'wrong_asset_kind', `Slide "${slide.id}" must reference a WSI asset.`);
            }
        });

        if (manifest.revision.status === REVISION_STATUS.PUBLISHED && !manifest.revision.publishedAt) {
            add('error', '$.revision.publishedAt', 'missing_publication_time', 'A published revision needs publishedAt.');
        }
        if (manifest.revision.status !== REVISION_STATUS.PUBLISHED && manifest.revision.publishedAt) {
            add('error', '$.revision.publishedAt', 'unexpected_publication_time', 'Only a published revision may carry publishedAt.');
        }
        if (forPublication && manifest.provenance?.migration?.lineageNeedsReview === true) {
            add('error', '$.provenance.migration.lineageNeedsReview', 'lineage_needs_review', 'Legacy specimen/block lineage must be confirmed before publication.');
        }

        if (rubric) {
            if (rubric.caseId !== manifest.id) {
                add('error', 'rubric.caseId', 'case_mismatch', `Rubric caseId "${rubric.caseId}" does not match case "${manifest.id}".`);
            }
            if (rubric.caseRevisionId !== manifest.revision.id) {
                add('error', 'rubric.caseRevisionId', 'revision_mismatch', 'Rubric is attached to a different case revision.');
            }
            duplicateIds(rubric.activities.map((entry) => ({ id: entry.activityId }))).forEach((id) => {
                add('error', 'rubric.activities', 'duplicate_activity_rubric', `Activity rubric "${id}" appears twice.`);
            });

            rubric.activities.forEach((activity, activityIndex) => {
                const activityAt = `rubric.activities[${activityIndex}]`;
                if (!activityIds.has(activity.activityId)) {
                    add('error', `${activityAt}.activityId`, 'dangling_activity', `Rubric references missing activity "${activity.activityId}".`);
                }
                const criteriaSlideIds = activity.slideCriteria.map((criteria) => criteria.slideId);
                duplicateIds(criteriaSlideIds.map((id) => ({ id }))).forEach((id) => {
                    add('error', `${activityAt}.slideCriteria`, 'duplicate_slide_criteria', `Slide "${id}" has duplicate criteria in one activity.`);
                });

                activity.slideCriteria.forEach((criteria, criteriaIndex) => {
                    const at = `${activityAt}.slideCriteria[${criteriaIndex}]`;
                    if (!slideIds.has(criteria.slideId)) {
                        add('error', `${at}.slideId`, 'dangling_slide', `Criteria references missing slide "${criteria.slideId}".`);
                        return;
                    }
                    const slide = manifest.slides.find((entry) => entry.id === criteria.slideId);
                    const asset = assetById.get(slide.assetId);
                    if (!(criteria.weight > 0)) add('error', `${at}.weight`, 'invalid_weight', 'Slide scoring weight must be greater than zero.');
                    if (!(criteria.screeningObjective > 0)) add('error', `${at}.screeningObjective`, 'invalid_objective', 'screeningObjective must be greater than zero.');
                    if (!(criteria.coverageObjective > 0)) add('error', `${at}.coverageObjective`, 'invalid_objective', 'coverageObjective must be greater than zero.');
                    if (!(Number.isInteger(criteria.coverageGrid) && criteria.coverageGrid >= 2)) {
                        add('error', `${at}.coverageGrid`, 'invalid_grid', 'coverageGrid must be an integer of at least 2.');
                    }
                    if (!validRect(criteria.tissueBounds)) {
                        add('error', `${at}.tissueBounds`, 'empty_tissue_bounds', 'tissueBounds must have positive area.');
                    } else if (asset && !within(criteria.tissueBounds, { x: 0, y: 0, w: asset.metadata.widthPx, h: asset.metadata.heightPx })) {
                        add('error', `${at}.tissueBounds`, 'tissue_outside_slide', `tissueBounds falls outside slide "${criteria.slideId}".`);
                    }

                    duplicateIds(criteria.rois).forEach((id) => add('error', `${at}.rois`, 'duplicate_roi', `Two ROIs share id "${id}" on slide "${criteria.slideId}".`));
                    const ceiling = asset ? (asset.metadata.nativeObjective / asset.metadata.downsample) * maxZoomPixelRatio : null;
                    criteria.rois.forEach((roi, roiIndex) => {
                        const roiAt = `${at}.rois[${roiIndex}]`;
                        if (!validRect(roi)) add('error', roiAt, 'empty_roi', `ROI "${roi.id}" must have positive area.`);
                        if (!(roi.minObjective > 0)) add('error', `${roiAt}.minObjective`, 'invalid_objective', `ROI "${roi.id}" needs a positive minObjective.`);
                        if (!(roi.dwellMs > 0)) add('error', `${roiAt}.dwellMs`, 'invalid_dwell', `ROI "${roi.id}" needs a positive dwellMs.`);
                        if (asset && validRect(roi) && !within(roi, { x: 0, y: 0, w: asset.metadata.widthPx, h: asset.metadata.heightPx })) {
                            add('error', roiAt, 'roi_outside_slide', `ROI "${roi.id}" falls outside its slide "${criteria.slideId}".`);
                        }
                        if (validRect(criteria.tissueBounds) && validRect(roi) && !within(roi, criteria.tissueBounds)) {
                            add('warning', roiAt, 'roi_outside_tissue', `ROI "${roi.id}" lies outside tissueBounds for slide "${criteria.slideId}".`);
                        }
                        if (ceiling !== null && roi.minObjective > ceiling) {
                            add('error', `${roiAt}.minObjective`, 'unreachable_roi', `ROI "${roi.id}" requires ${roi.minObjective}x but slide "${criteria.slideId}" tops out at ${Math.round(ceiling * 10) / 10}x.`);
                        }
                    });
                    if (ceiling !== null && criteria.screeningObjective > ceiling) {
                        add('error', `${at}.screeningObjective`, 'unreachable_screening', `screeningObjective exceeds slide "${criteria.slideId}" ceiling.`);
                    }
                });
            });
        }

        return sortIssues(issues);
    } catch (error) {
        return [semanticIssue('error', '$', 'malformed_document', `Semantic validation could not inspect the case safely: ${error?.message ?? String(error)}`)];
    }
}

/** True only when combined validation contains no errors. */
export function isPublishable(manifest, rubric = null, options = {}) {
    return !validateCaseDocuments(manifest, rubric, { ...options, forPublication: true })
        .some((entry) => entry.severity === 'error');
}

