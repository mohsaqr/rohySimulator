/**
 * Pure state transitions for the shared Case Studio.
 *
 * React never edits the manifest or protected rubric directly. Every change
 * comes through this module so hierarchy cascades, rubric references, asset
 * pinning, and legacy migration behave identically in standalone and plugin
 * hosts and can be tested without a browser.
 */

import {
    CASE_SCHEMA_URI,
    CASE_SCHEMA_VERSION,
    RUBRIC_SCHEMA_URI,
} from './caseCore/constants.js';
import { cloneCanonical } from './caseCore/canonicalJson.js';
import { createId, deterministicId } from './caseCore/ids.js';
import { nextSpecimenPart, specimenDisplayName } from './specimenNaming.js';
import { migrateCase } from './caseCore/migrate.js';
import { validateCaseDocuments } from './caseCore/semanticValidation.js';
import { toLegacyViewerCase } from './caseCore/viewerAdapter.js';
import { materializeSlideAsset, selectReadyRevision, validateCatalogAsset, verifiedOptics } from './assetCatalog.js';

const objectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entityArrays = Object.freeze({
    specimen: 'specimens',
    block: 'blocks',
    slide: 'slides',
    activity: 'activities',
});

function requireDocument(document, who = 'Case Studio operation') {
    if (!objectLike(document) || !objectLike(document.manifest)) {
        throw new TypeError(`${who}: expected {manifest, rubric}.`);
    }
    ['specimens', 'blocks', 'assets', 'slides', 'activities'].forEach((key) => {
        if (!Array.isArray(document.manifest[key])) throw new TypeError(`${who}: manifest.${key} must be an array.`);
    });
    if (!objectLike(document.rubric) || !Array.isArray(document.rubric.activities)) {
        throw new TypeError(`${who}: rubric.activities must be an array.`);
    }
    return document;
}

function idFrom(idFactory, kind) {
    const id = idFactory(kind);
    if (typeof id !== 'string' || id === '') throw new TypeError(`idFactory returned an invalid ${kind} id.`);
    return id;
}

function nextDocument(document, manifest, rubric = document.rubric) {
    return { ...document, manifest, rubric };
}

function findRequired(rows, id, label) {
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new RangeError(`${label} "${id}" does not exist.`);
    return row;
}

function defaultRubric(manifest) {
    return {
        $schema: RUBRIC_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: deterministicId('rubric', manifest.id),
        caseId: manifest.id,
        caseRevisionId: manifest.revision.id,
        activities: [],
    };
}

/** Create an empty canonical author document without inventing clinical data. */
export function createStudioDocument({
    idFactory = createId,
    now = () => new Date().toISOString(),
    createdBy = 'local-author',
} = {}) {
    if (typeof idFactory !== 'function' || typeof now !== 'function') {
        throw new TypeError('createStudioDocument(): idFactory and now must be functions.');
    }
    const caseId = idFrom(idFactory, 'case');
    const revisionId = idFrom(idFactory, 'revision');
    const manifest = {
        $schema: CASE_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: caseId,
        revision: {
            id: revisionId,
            number: 1,
            status: 'draft',
            parentRevisionId: null,
            createdAt: now(),
            createdBy,
        },
        title: '',
        clinical: { accession: '', specimenSummary: '', history: '' },
        specimens: [],
        blocks: [],
        assets: [],
        slides: [],
        activities: [],
        provenance: { authoredWith: 'Pathoyon Case Studio' },
    };
    // A case is created WITH its one specimen part.
    //
    // Adding a photograph or a slide used to conjure a part as a side effect,
    // which is how empty ghost parts appeared and why the next real one was
    // named "B". The part exists from the start instead, and — because a case
    // with one part has nothing to choose between — the editor never shows it.
    // Parts only become visible when an author explicitly adds a second.
    const opened = {
        manifest,
        rubric: { ...defaultRubric(manifest), id: idFrom(idFactory, 'rubric') },
    };
    return addStudioSpecimen(opened, {}, idFactory);
}

/**
 * Convert a legacy flat case deterministically into canonical v1 documents.
 * Missing scanner values stay missing so validation can surface them.
 */
export function migrateLegacyStudioCase(legacy) {
    return migrateCase(legacy);
}

/** Accept `{manifest,rubric}`, a canonical manifest, or the legacy flat shape. */
export function toStudioDocument(input, options = {}) {
    if (input === undefined || input === null) return createStudioDocument(options);
    if (!objectLike(input)) throw new TypeError('toStudioDocument(): input must be an object.');
    if (objectLike(input.manifest)) {
        const migrated = migrateCase(input.manifest, { rubric: input.rubric ?? null });
        return healStudioSpecimenNames(ensureStudioSpecimen({
            manifest: migrated.manifest,
            rubric: migrated.rubric ?? defaultRubric(migrated.manifest),
        }));
    }
    const migrated = migrateCase(input);
    return healStudioSpecimenNames(ensureStudioSpecimen({
        manifest: migrated.manifest,
        rubric: migrated.rubric ?? defaultRubric(migrated.manifest),
    }));
}

/** Validate an author document safely. Malformed input is always an issue list. */
export function studioIssues(document, options = {}) {
    try {
        requireDocument(document, 'studioIssues()');
        return validateCaseDocuments(document.manifest, document.rubric, options);
    } catch (error) {
        return [{
            severity: 'error', source: 'studio', path: '$', code: 'malformed_document',
            message: `Case Studio could not inspect the document safely: ${error.message}`,
        }];
    }
}

export function studioCanPublish(document) {
    return !studioIssues(document, { forPublication: true }).some((issue) => issue.severity === 'error');
}

/** Update title/clinical metadata while preserving the protected rubric. */
export function updateStudioMetadata(document, patch) {
    requireDocument(document, 'updateStudioMetadata()');
    if (!objectLike(patch)) throw new TypeError('updateStudioMetadata(): patch must be an object.');
    const allowed = ['title', 'accession', 'specimenSummary', 'history'];
    const unknown = Object.keys(patch).find((key) => !allowed.includes(key));
    if (unknown) throw new RangeError(`updateStudioMetadata(): unknown field "${unknown}".`);
    const manifest = {
        ...document.manifest,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        clinical: {
            ...document.manifest.clinical,
            ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'title')),
        },
    };
    return nextDocument(document, manifest);
}

/** Blocks are numbered within their part: A1, A2, then B1. */
function nextBlockLabel(manifest, specimenId) {
    const part = manifest.specimens.find((entry) => entry.id === specimenId)?.part || 'A';
    const siblings = manifest.blocks.filter((entry) => entry.specimenId === specimenId).length;
    return `${part}${siblings + 1}`;
}

export { specimenDisplayName };

/**
 * Give every nameless part a letter.
 *
 * Parts created before naming was automatic are stored with `part: ''`, which
 * renders as "Part " and — worse — collides as a key when there is more than
 * one of them. Healing on load fixes the documents people already have rather
 * than only the ones they make next. Letters already in use are left alone.
 */
export function healStudioSpecimenNames(document) {
    requireDocument(document, 'healStudioSpecimenNames()');
    if (document.manifest.specimens.every((entry) => (entry.part ?? '') !== '')) return document;
    const specimens = document.manifest.specimens.reduce((named, entry) => {
        if ((entry.part ?? '') !== '') return [...named, entry];
        const part = nextSpecimenPart(named.concat(document.manifest.specimens.filter((other) => (other.part ?? '') !== '')));
        return [...named, {
            ...entry,
            part,
            label: (entry.label ?? '') === '' ? `Part ${part}` : entry.label,
        }];
    }, []);
    return nextDocument(document, { ...document.manifest, specimens });
}

export function addStudioSpecimen(document, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioSpecimen()');
    const part = fields.part ?? nextSpecimenPart(document.manifest.specimens);
    const specimen = {
        id: idFrom(idFactory, 'specimen'),
        part,
        label: fields.label ?? `Part ${part}`,
        description: fields.description ?? '',
        grossImageAssetIds: [],
    };
    return nextDocument(document, {
        ...document.manifest,
        specimens: [...document.manifest.specimens, specimen],
    });
}

export function addStudioBlock(document, specimenId, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioBlock()');
    findRequired(document.manifest.specimens, specimenId, 'Specimen');
    const block = {
        id: idFrom(idFactory, 'block'),
        specimenId,
        label: fields.label ?? nextBlockLabel(document.manifest, specimenId),
        description: fields.description ?? '',
    };
    return nextDocument(document, { ...document.manifest, blocks: [...document.manifest.blocks, block] });
}

/** Turn a ready catalog revision into the canonical asset record a case pins. */
export function catalogAssetToCaseAsset(catalogAsset) {
    const checked = validateCatalogAsset(catalogAsset);
    const revision = selectReadyRevision(checked);
    const optics = verifiedOptics(revision.optics);
    const id = deterministicId('asset', checked.id, revision.id);
    const manual = checked.sourceId === 'manual';
    return {
        id,
        kind: 'wsi',
        source: manual
            ? {
                kind: 'external', uri: revision.derivatives.dzi.url, revision: revision.id,
                ...(revision.sourceChecksum ? { checksum: revision.sourceChecksum } : {}),
            }
            : {
                kind: 'catalog', catalogAssetId: checked.id, revision: revision.id,
                ...(revision.sourceChecksum ? { checksum: revision.sourceChecksum } : {}),
            },
        metadata: {
            ...(optics.slideWidthPx ? { widthPx: optics.slideWidthPx, heightPx: optics.slideHeightPx } : {}),
            nativeObjective: optics.nativeObjective,
            nativeMpp: optics.nativeMpp,
            downsample: optics.downsample,
        },
        renditions: [{
            kind: 'dzi', uri: revision.derivatives.dzi.url,
            ...(revision.derivatives.dzi.checksum ? { checksum: revision.derivatives.dzi.checksum } : {}),
        }],
    };
}

/** Create a ready manual catalog record; every optical value is explicit. */
export function manualStudioAsset({ id, label, url, nativeObjective, nativeMpp, downsample, slideWidthPx, slideHeightPx }) {
    const optics = verifiedOptics({
        nativeObjective, nativeMpp, downsample,
        ...(slideWidthPx === undefined && slideHeightPx === undefined ? {} : { slideWidthPx, slideHeightPx }),
        provenance: 'author-declared',
    }, 'manual slide optics');
    return validateCatalogAsset({
        id,
        label: label || id,
        status: 'ready',
        sourceId: 'manual',
        format: 'dzi',
        source: { uri: url },
        currentRevisionId: 'manual-v1',
        revisions: [{
            id: 'manual-v1', status: 'ready', sourceChecksum: null,
            derivatives: { dzi: { url } }, optics,
        }],
    });
}

export function addStudioSlide(document, blockId, catalogAsset, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioSlide()');
    findRequired(document.manifest.blocks, blockId, 'Block');
    const asset = catalogAssetToCaseAsset(catalogAsset);
    const existing = document.manifest.assets.find((entry) => entry.id === asset.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) {
        throw new RangeError(`Case asset "${asset.id}" already exists with different pinned data.`);
    }
    const slide = {
        id: idFrom(idFactory, 'slide'),
        blockId,
        assetId: asset.id,
        label: fields.label ?? catalogAsset.label ?? '',
        stain: {
            code: fields.stainCode ?? '',
            display: fields.stainDisplay ?? fields.stainCode ?? '',
        },
    };
    return nextDocument(document, {
        ...document.manifest,
        assets: existing ? document.manifest.assets : [...document.manifest.assets, asset],
        slides: [...document.manifest.slides, slide],
    });
}

export function replaceStudioSlideAsset(document, slideId, catalogAsset) {
    requireDocument(document, 'replaceStudioSlideAsset()');
    const slide = findRequired(document.manifest.slides, slideId, 'Slide');
    const asset = catalogAssetToCaseAsset(catalogAsset);
    const assets = document.manifest.assets.some((entry) => entry.id === asset.id)
        ? document.manifest.assets
        : [...document.manifest.assets, asset];
    const slides = document.manifest.slides.map((entry) => (
        entry.id === slide.id ? { ...entry, assetId: asset.id } : entry
    ));
    return pruneUnusedAssets(nextDocument(document, { ...document.manifest, assets, slides }));
}

// --- Gross pathology ------------------------------------------------------
//
// A gross photograph is an ordinary image, not a scanned pyramid, so it has no
// scanner optics to pin. What it does carry is `scaleMm`: the real-world width
// the plate spans, which is the only thing that lets the room draw a true scale
// bar at any zoom. Everything else — kind, source, renditions — mirrors the
// shape the migrator already produces for legacy `specimen.images`, so an
// authored plate and a migrated one are indistinguishable downstream.

const grossImageUri = (asset) => (
    asset?.renditions?.find((entry) => entry.kind === 'image')?.uri ?? asset?.source?.uri ?? ''
);

function grossImageAsset(id, uri, scaleMm, checksum) {
    return {
        id,
        kind: 'gross-image',
        // A picture carried inside the case is embedded; one left at a URL is
        // external. The distinction is what tells a reader whether the case is
        // self-contained.
        source: { kind: uri.startsWith('data:') ? 'embedded' : 'external', uri, revision: null, checksum },
        metadata: scaleMm === undefined ? {} : { scaleMm },
        renditions: [{ kind: 'image', uri, checksum }],
    };
}

/**
 * Normalize author input once, so `scaleMm` is either absent or positive and
 * `checksum` is either a real digest or an explicit null. A published case may
 * only reference pinned content, so an unpinned plate stays visibly null rather
 * than borrowing a digest from whatever the URL served last.
 */
function verifiedGrossFields({ uri, scaleMm, checksum }, who) {
    if (typeof uri !== 'string' || uri.trim() === '') {
        throw new TypeError(`${who}: uri must be a non-empty image URL.`);
    }
    if (scaleMm !== undefined && scaleMm !== null && !(Number.isFinite(scaleMm) && scaleMm > 0)) {
        throw new RangeError(`${who}: scaleMm must be the plate width in millimetres, or null when it is unknown.`);
    }
    if (checksum !== undefined && checksum !== null && !(typeof checksum === 'string' && checksum.trim() !== '')) {
        throw new TypeError(`${who}: checksum must be a non-empty digest string, or null when the plate is not pinned.`);
    }
    return {
        uri: uri.trim(),
        scaleMm: scaleMm === null ? undefined : scaleMm,
        checksum: checksum === undefined || checksum === null ? null : checksum.trim(),
    };
}

function specimenGrossImage(document, specimenId, assetId, who) {
    const specimen = findRequired(document.manifest.specimens, specimenId, 'Specimen');
    if (!specimen.grossImageAssetIds.includes(assetId)) {
        throw new RangeError(`${who}: specimen "${specimenId}" does not show gross image "${assetId}".`);
    }
    const asset = findRequired(document.manifest.assets, assetId, 'Asset');
    if (asset.kind !== 'gross-image') {
        throw new RangeError(`${who}: asset "${assetId}" is ${asset.kind}, not gross-image.`);
    }
    return { specimen, asset };
}

/** Tidy read model for one specimen's contact sheet, in authored order. */
export function studioGrossImages(document, specimenId) {
    requireDocument(document, 'studioGrossImages()');
    const specimen = findRequired(document.manifest.specimens, specimenId, 'Specimen');
    return specimen.grossImageAssetIds.flatMap((assetId) => {
        const asset = document.manifest.assets.find((entry) => entry.id === assetId);
        return asset ? [{
            id: assetId,
            uri: grossImageUri(asset),
            scaleMm: asset.metadata.scaleMm,
            checksum: asset.source.checksum ?? null,
        }] : [];
    });
}

/** Attach one macroscopic photograph to a specimen part. */
export function addStudioGrossImage(document, specimenId, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioGrossImage()');
    const specimen = findRequired(document.manifest.specimens, specimenId, 'Specimen');
    const { uri, scaleMm, checksum } = verifiedGrossFields(fields, 'addStudioGrossImage()');
    const duplicate = studioGrossImages(document, specimenId).some((image) => image.uri === uri);
    if (duplicate) throw new RangeError(`Specimen "${specimenId}" already shows the gross photograph "${uri}".`);
    const asset = grossImageAsset(idFrom(idFactory, 'asset'), uri, scaleMm, checksum);
    return nextDocument(document, {
        ...document.manifest,
        assets: [...document.manifest.assets, asset],
        specimens: document.manifest.specimens.map((entry) => (entry.id === specimen.id
            ? { ...entry, grossImageAssetIds: [...entry.grossImageAssetIds, asset.id] }
            : entry)),
    });
}

/**
 * Patch a plate's source, declared width, or pin. `scaleMm: null` clears the
 * width. Repointing the URL without supplying a new checksum drops the old one,
 * because a digest taken from the previous file cannot vouch for the new one.
 */
export function updateStudioGrossImage(document, specimenId, assetId, patch = {}) {
    requireDocument(document, 'updateStudioGrossImage()');
    const { asset } = specimenGrossImage(document, specimenId, assetId, 'updateStudioGrossImage()');
    if (!objectLike(patch)) throw new TypeError('updateStudioGrossImage(): patch must be an object.');
    const currentUri = grossImageUri(asset);
    const nextUri = patch.uri === undefined ? currentUri : patch.uri;
    const repointed = typeof nextUri === 'string' && nextUri.trim() !== currentUri;
    const merged = verifiedGrossFields({
        uri: nextUri,
        scaleMm: patch.scaleMm === undefined ? asset.metadata.scaleMm ?? null : patch.scaleMm,
        checksum: patch.checksum === undefined ? (repointed ? null : asset.source.checksum) : patch.checksum,
    }, 'updateStudioGrossImage()');
    return nextDocument(document, {
        ...document.manifest,
        assets: document.manifest.assets.map((entry) => (
            entry.id === assetId ? grossImageAsset(assetId, merged.uri, merged.scaleMm, merged.checksum) : entry
        )),
    });
}

/** Detach a plate; the asset itself is pruned once nothing references it. */
export function removeStudioGrossImage(document, specimenId, assetId) {
    requireDocument(document, 'removeStudioGrossImage()');
    specimenGrossImage(document, specimenId, assetId, 'removeStudioGrossImage()');
    return pruneUnusedAssets(nextDocument(document, {
        ...document.manifest,
        specimens: document.manifest.specimens.map((entry) => (entry.id === specimenId
            ? { ...entry, grossImageAssetIds: entry.grossImageAssetIds.filter((id) => id !== assetId) }
            : entry)),
    }));
}

/** Reorder the contact sheet. Moving past either edge is a no-op, not an error. */
export function moveStudioGrossImage(document, specimenId, assetId, delta) {
    requireDocument(document, 'moveStudioGrossImage()');
    if (!Number.isInteger(delta)) throw new TypeError('moveStudioGrossImage(): delta must be an integer.');
    const { specimen } = specimenGrossImage(document, specimenId, assetId, 'moveStudioGrossImage()');
    const from = specimen.grossImageAssetIds.indexOf(assetId);
    const to = from + delta;
    if (to < 0 || to >= specimen.grossImageAssetIds.length) return document;
    const ordered = [...specimen.grossImageAssetIds];
    ordered.splice(to, 0, ...ordered.splice(from, 1));
    return nextDocument(document, {
        ...document.manifest,
        specimens: document.manifest.specimens.map((entry) => (
            entry.id === specimen.id ? { ...entry, grossImageAssetIds: ordered } : entry
        )),
    });
}

/**
 * Where a new slide or plate should go when the author has not built a
 * hierarchy yet.
 *
 * A teaching case is about slides, so "add a slide" must not require the author
 * to first invent a specimen part and a paraffin block. The lineage is real and
 * stays in the document — it is just created for them, with names they can
 * rename, instead of being demanded up front. An existing hierarchy is never
 * reshaped: the most recently added block is the target, because that is where
 * the author was last working.
 */
export function ensureStudioSlideTarget(document, { specimenId = null } = {}, idFactory = createId) {
    requireDocument(document, 'ensureStudioSlideTarget()');
    const target = ensureStudioGrossTarget(document, { specimenId }, idFactory);
    const specimen = target.document.manifest.specimens.find((entry) => entry.id === target.specimenId);
    const blocks = target.document.manifest.blocks.filter((entry) => entry.specimenId === specimen.id);
    if (blocks.length > 0) {
        return { document: target.document, specimenId: specimen.id, blockId: blocks.at(-1).id, created: target.created };
    }
    const next = addStudioBlock(target.document, specimen.id, {}, idFactory);
    return { document: next, specimenId: specimen.id, blockId: next.manifest.blocks.at(-1).id, created: true };
}

/**
 * The same courtesy for a gross photograph, which needs only a part.
 * Naming a `specimenId` targets that part; omitting it uses the first, and
 * creates one only when the case has none.
 */
export function ensureStudioGrossTarget(document, { specimenId = null } = {}, idFactory = createId) {
    requireDocument(document, 'ensureStudioGrossTarget()');
    if (specimenId !== null && specimenId !== undefined && typeof specimenId !== 'string') {
        throw new TypeError('ensureStudioGrossTarget(): specimenId must be a specimen id string or null.');
    }
    if (specimenId !== null && specimenId !== undefined) {
        return { document, specimenId: findRequired(document.manifest.specimens, specimenId, 'Specimen').id, created: false };
    }
    const existing = document.manifest.specimens[0];
    if (existing) return { document, specimenId: existing.id, created: false };
    // Only a document that predates this rule, or one edited by hand, arrives
    // here with no part at all.
    const next = addStudioSpecimen(document, {}, idFactory);
    return { document: next, specimenId: next.manifest.specimens.at(-1).id, created: true };
}

/** A case that lost its only part — migrated or hand-edited — gets one back. */
export function ensureStudioSpecimen(document, idFactory = createId) {
    requireDocument(document, 'ensureStudioSpecimen()');
    return document.manifest.specimens.length > 0
        ? document
        : addStudioSpecimen(document, {}, idFactory);
}

/**
 * Move a slide to a specimen part.
 *
 * A slide's stored parent is its block, but the question an author asks is
 * "which part did this come from" — and the editor previously offered only the
 * block, so a slide could not be reassigned to a part at all without building
 * a block there first. This does that building: a part with no block gets one,
 * named the usual way, and the slide lands in it.
 *
 * @returns {object} the document, unchanged when the slide is already there
 */
export function moveStudioSlideToSpecimen(document, slideId, specimenId, idFactory = createId) {
    requireDocument(document, 'moveStudioSlideToSpecimen()');
    const slide = findRequired(document.manifest.slides, slideId, 'Slide');
    const target = ensureStudioSlideTarget(document, { specimenId }, idFactory);
    if (target.blockId === slide.blockId) return document;
    return updateStudioEntity(target.document, 'slide', slideId, { blockId: target.blockId });
}

export function addStudioActivity(document, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioActivity()');
    const id = idFrom(idFactory, 'activity');
    return nextDocument(document, {
        ...document.manifest,
        activities: [...document.manifest.activities, {
            id, kind: fields.kind ?? 'report', prompt: fields.prompt ?? '', instructions: fields.instructions ?? '',
        }],
    }, {
        ...document.rubric,
        activities: [...document.rubric.activities, { activityId: id, hints: [], slideCriteria: [] }],
    });
}

/** Patch an entity without permitting its stable id to change. */
export function updateStudioEntity(document, kind, id, patch) {
    requireDocument(document, 'updateStudioEntity()');
    const key = entityArrays[kind];
    if (!key) throw new RangeError(`updateStudioEntity(): unsupported kind "${kind}".`);
    if (!objectLike(patch)) throw new TypeError('updateStudioEntity(): patch must be an object.');
    if (patch.id !== undefined && patch.id !== id) throw new RangeError('Stable entity ids cannot be changed.');
    findRequired(document.manifest[key], id, kind[0].toUpperCase() + kind.slice(1));
    if (kind === 'block' && patch.specimenId !== undefined) {
        findRequired(document.manifest.specimens, patch.specimenId, 'Specimen');
    }
    if (kind === 'slide') {
        if (patch.blockId !== undefined) findRequired(document.manifest.blocks, patch.blockId, 'Block');
        if (patch.assetId !== undefined) findRequired(document.manifest.assets, patch.assetId, 'Asset');
    }
    return nextDocument(document, {
        ...document.manifest,
        [key]: document.manifest[key].map((entry) => (entry.id === id ? { ...entry, ...patch, id } : entry)),
    });
}

function removeCriteriaForSlides(rubric, slideIds) {
    const removed = new Set(slideIds);
    return {
        ...rubric,
        activities: rubric.activities.map((activity) => ({
            ...activity,
            slideCriteria: activity.slideCriteria.filter((criteria) => !removed.has(criteria.slideId)),
        })),
    };
}

function pruneUnusedAssets(document) {
    const used = new Set(document.manifest.slides.map((slide) => slide.assetId));
    document.manifest.specimens.forEach((specimen) => specimen.grossImageAssetIds.forEach((id) => used.add(id)));
    return nextDocument(document, {
        ...document.manifest,
        assets: document.manifest.assets.filter((asset) => used.has(asset.id)),
    });
}

/** Remove an entity and every dependent reference in one immutable cascade. */
export function removeStudioEntity(document, kind, id) {
    requireDocument(document, 'removeStudioEntity()');
    const key = entityArrays[kind];
    if (!key) throw new RangeError(`removeStudioEntity(): unsupported kind "${kind}".`);
    findRequired(document.manifest[key], id, kind[0].toUpperCase() + kind.slice(1));
    let manifest = document.manifest;
    let rubric = document.rubric;

    if (kind === 'activity') {
        manifest = { ...manifest, activities: manifest.activities.filter((entry) => entry.id !== id) };
        rubric = { ...rubric, activities: rubric.activities.filter((entry) => entry.activityId !== id) };
        return nextDocument(document, manifest, rubric);
    }

    const blockIds = kind === 'specimen'
        ? manifest.blocks.filter((block) => block.specimenId === id).map((block) => block.id)
        : kind === 'block' ? [id] : [];
    const slideIds = kind === 'slide'
        ? [id]
        : manifest.slides.filter((slide) => blockIds.includes(slide.blockId)).map((slide) => slide.id);
    const removedSlides = new Set(slideIds);
    const removedBlocks = new Set(blockIds);
    manifest = {
        ...manifest,
        specimens: kind === 'specimen' ? manifest.specimens.filter((entry) => entry.id !== id) : manifest.specimens,
        blocks: manifest.blocks.filter((entry) => !removedBlocks.has(entry.id)),
        slides: manifest.slides.filter((entry) => !removedSlides.has(entry.id)),
    };
    rubric = removeCriteriaForSlides(rubric, slideIds);
    return pruneUnusedAssets(nextDocument(document, manifest, rubric));
}

function rubricActivity(document, activityId) {
    findRequired(document.manifest.activities, activityId, 'Activity');
    const rubric = document.rubric.activities.find((entry) => entry.activityId === activityId);
    if (!rubric) throw new RangeError(`Rubric for activity "${activityId}" does not exist.`);
    return rubric;
}

/** Add the protected half for an existing public activity when it is absent. */
export function ensureActivityRubric(document, activityId) {
    requireDocument(document, 'ensureActivityRubric()');
    findRequired(document.manifest.activities, activityId, 'Activity');
    if (document.rubric.activities.some((entry) => entry.activityId === activityId)) return document;
    return nextDocument(document, document.manifest, {
        ...document.rubric,
        activities: [...document.rubric.activities, { activityId, hints: [], slideCriteria: [] }],
    });
}

export function updateActivityRubric(document, activityId, patch) {
    requireDocument(document, 'updateActivityRubric()');
    rubricActivity(document, activityId);
    if (!objectLike(patch)) throw new TypeError('updateActivityRubric(): patch must be an object.');
    return nextDocument(document, document.manifest, {
        ...document.rubric,
        activities: document.rubric.activities.map((entry) => (
            entry.activityId === activityId ? { ...entry, ...patch, activityId } : entry
        )),
    });
}

/** Ensure one activity has scoring criteria for one slide. */
export function ensureSlideCriteria(document, activityId, slideId) {
    requireDocument(document, 'ensureSlideCriteria()');
    const activity = rubricActivity(document, activityId);
    findRequired(document.manifest.slides, slideId, 'Slide');
    if (activity.slideCriteria.some((criteria) => criteria.slideId === slideId)) return document;
    const criteria = {
        slideId,
        weight: 1,
        screeningObjective: 5,
        coverageObjective: 2,
        coverageGrid: 12,
        tissueBounds: { x: 0, y: 0, w: 0, h: 0 },
        rois: [],
    };
    return updateActivityRubric(document, activityId, {
        slideCriteria: [...activity.slideCriteria, criteria],
    });
}

export function updateSlideCriteria(document, activityId, slideId, patch) {
    requireDocument(document, 'updateSlideCriteria()');
    const activity = rubricActivity(document, activityId);
    if (!activity.slideCriteria.some((entry) => entry.slideId === slideId)) {
        throw new RangeError(`Slide criteria "${slideId}" does not exist.`);
    }
    if (!objectLike(patch)) throw new TypeError('updateSlideCriteria(): patch must be an object.');
    return updateActivityRubric(document, activityId, {
        slideCriteria: activity.slideCriteria.map((entry) => (
            entry.slideId === slideId ? { ...entry, ...patch, slideId } : entry
        )),
    });
}

export function addStudioRoi(document, activityId, slideId, fields = {}, idFactory = createId) {
    requireDocument(document, 'addStudioRoi()');
    const activity = rubricActivity(document, activityId);
    const criteria = activity.slideCriteria.find((entry) => entry.slideId === slideId);
    if (!criteria) throw new RangeError(`Slide criteria "${slideId}" does not exist.`);
    const roi = {
        id: idFrom(idFactory, 'roi'),
        label: fields.label ?? '',
        x: fields.x ?? 0,
        y: fields.y ?? 0,
        w: fields.w ?? 0,
        h: fields.h ?? 0,
        minObjective: fields.minObjective ?? 0,
        dwellMs: fields.dwellMs ?? 0,
        critical: fields.critical === true,
    };
    return updateSlideCriteria(document, activityId, slideId, { rois: [...criteria.rois, roi] });
}

export function updateStudioRoi(document, activityId, slideId, roiId, patch) {
    requireDocument(document, 'updateStudioRoi()');
    const activity = rubricActivity(document, activityId);
    const criteria = activity.slideCriteria.find((entry) => entry.slideId === slideId);
    if (!criteria) throw new RangeError(`Slide criteria "${slideId}" does not exist.`);
    findRequired(criteria.rois, roiId, 'ROI');
    if (!objectLike(patch)) throw new TypeError('updateStudioRoi(): patch must be an object.');
    if (patch.id !== undefined && patch.id !== roiId) throw new RangeError('Stable ROI ids cannot be changed.');
    return updateSlideCriteria(document, activityId, slideId, {
        rois: criteria.rois.map((roi) => (roi.id === roiId ? { ...roi, ...patch, id: roiId } : roi)),
    });
}

export function removeStudioRoi(document, activityId, slideId, roiId) {
    requireDocument(document, 'removeStudioRoi()');
    const activity = rubricActivity(document, activityId);
    const criteria = activity.slideCriteria.find((entry) => entry.slideId === slideId);
    if (!criteria) throw new RangeError(`Slide criteria "${slideId}" does not exist.`);
    findRequired(criteria.rois, roiId, 'ROI');
    return updateSlideCriteria(document, activityId, slideId, {
        rois: criteria.rois.filter((roi) => roi.id !== roiId),
    });
}

/**
 * Public canonical projection for a preview. Selecting an activity never
 * carries protected rubric content into the learner-facing manifest.
 */
export function studioPreviewManifest(document, activityId = document?.manifest?.activities?.[0]?.id) {
    requireDocument(document, 'studioPreviewManifest()');
    const activity = document.manifest.activities.find((entry) => entry.id === activityId);
    return cloneCanonical({
        ...document.manifest,
        activities: activity ? [activity] : [],
    });
}

/** Runtime projection used only by a legacy host; protected data is omitted. */
export function studioReaderCase(document, activityId = document?.manifest?.activities?.[0]?.id) {
    requireDocument(document, 'studioReaderCase()');
    return toLegacyViewerCase(studioPreviewManifest(document, activityId));
}

/** Materialize one canonical slide through the same asset-catalog seam. */
export function materializedStudioSlide(document, slideId, catalogAsset) {
    requireDocument(document, 'materializedStudioSlide()');
    const slide = findRequired(document.manifest.slides, slideId, 'Slide');
    return materializeSlideAsset({ id: slide.id, label: slide.label, stain: slide.stain.display }, catalogAsset);
}
