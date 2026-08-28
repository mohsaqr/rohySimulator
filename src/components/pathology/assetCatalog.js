/**
 * Host-neutral slide asset catalog primitives.
 *
 * This module deliberately performs no I/O. A standalone app, a Rohy plugin,
 * or a test can obtain catalog records however it likes and run them through
 * the same validation, filtering, revision selection, and slide
 * materialisation rules.
 *
 * A ready revision is immutable and self-contained: its DZI derivative and
 * optical profile live on the revision, not on the mutable asset envelope.
 * That lets a published case pin `assetRevisionId` without silently changing
 * when the scanner source is processed again.
 */

export const ASSET_STATUSES = Object.freeze([
    'discovered', 'queued', 'processing', 'ready', 'failed',
]);

export const ASSET_REVISION_STATUSES = Object.freeze([
    'queued', 'processing', 'ready', 'failed',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function requireNonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${path} must be a non-empty string.`);
    }
    return value;
}

function clone(value) {
    return structuredClone(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

/**
 * Validate and copy an optical profile measured for one immutable derivative.
 *
 * Dimensions are optional because some pre-existing DZI catalogs do not carry
 * them. When supplied, however, they must arrive as a complete positive pair.
 * No defaults are invented: a plausible scanner value is still wrong data.
 *
 * @param {object} optics
 * @param {string} [path='optics']
 * @returns {object} a new, frozen optical profile
 */
export function verifiedOptics(optics, path = 'optics') {
    if (!isObject(optics)) throw new TypeError(`${path} must be an object.`);
    ['nativeObjective', 'nativeMpp', 'downsample'].forEach((field) => {
        if (!isPositive(optics[field])) {
            throw new TypeError(`${path}.${field} must be a finite positive number.`);
        }
    });

    const hasWidth = optics.slideWidthPx !== undefined;
    const hasHeight = optics.slideHeightPx !== undefined;
    if (hasWidth !== hasHeight) {
        throw new TypeError(`${path}.slideWidthPx and ${path}.slideHeightPx must be supplied together.`);
    }
    if (hasWidth && (!Number.isInteger(optics.slideWidthPx) || optics.slideWidthPx <= 0
        || !Number.isInteger(optics.slideHeightPx) || optics.slideHeightPx <= 0)) {
        throw new TypeError(`${path} slide dimensions must be positive integers.`);
    }

    return deepFreeze(clone(optics));
}

function validateRevision(revision, path) {
    if (!isObject(revision)) throw new TypeError(`${path} must be an object.`);
    requireNonEmptyString(revision.id, `${path}.id`);
    if (!ASSET_REVISION_STATUSES.includes(revision.status)) {
        throw new RangeError(`${path}.status must be one of ${ASSET_REVISION_STATUSES.join(', ')}.`);
    }

    if (revision.status === 'ready') {
        const dzi = revision.derivatives?.dzi;
        if (!isObject(dzi)) throw new TypeError(`${path}.derivatives.dzi must be present when a revision is ready.`);
        requireNonEmptyString(dzi.url, `${path}.derivatives.dzi.url`);
        verifiedOptics(revision.optics, `${path}.optics`);
    }
}

function validatePreview(preview, path) {
    if (!isObject(preview)) throw new TypeError(`${path} must be an object.`);
    requireNonEmptyString(preview.url, `${path}.url`);
    const hasWidth = preview.widthPx !== undefined;
    const hasHeight = preview.heightPx !== undefined;
    if (hasWidth !== hasHeight) {
        throw new TypeError(`${path}.widthPx and ${path}.heightPx must be supplied together.`);
    }
    if (hasWidth && (!Number.isInteger(preview.widthPx) || preview.widthPx <= 0
        || !Number.isInteger(preview.heightPx) || preview.heightPx <= 0)) {
        throw new TypeError(`${path} dimensions must be positive integers.`);
    }
}

/**
 * Validate one catalog asset without mutating it.
 *
 * @param {object} asset
 * @param {string} [path='asset']
 * @returns {object} a defensive copy
 */
export function validateCatalogAsset(asset, path = 'asset') {
    if (!isObject(asset)) throw new TypeError(`${path} must be an object.`);
    requireNonEmptyString(asset.id, `${path}.id`);
    if (!ASSET_STATUSES.includes(asset.status)) {
        throw new RangeError(`${path}.status must be one of ${ASSET_STATUSES.join(', ')}.`);
    }
    if (asset.label !== undefined) requireNonEmptyString(asset.label, `${path}.label`);
    if (asset.sourceId !== undefined) requireNonEmptyString(asset.sourceId, `${path}.sourceId`);
    if (asset.format !== undefined) requireNonEmptyString(asset.format, `${path}.format`);
    if (asset.preview !== undefined) validatePreview(asset.preview, `${path}.preview`);
    if (!Array.isArray(asset.revisions)) throw new TypeError(`${path}.revisions must be an array.`);

    asset.revisions.forEach((revision, index) => validateRevision(revision, `${path}.revisions[${index}]`));
    const revisionIds = asset.revisions.map((revision) => revision.id);
    const duplicateRevision = revisionIds.find((id, index) => revisionIds.indexOf(id) !== index);
    if (duplicateRevision) throw new RangeError(`${path} has duplicate revision id "${duplicateRevision}".`);

    const readyIds = new Set(asset.revisions
        .filter((revision) => revision.status === 'ready')
        .map((revision) => revision.id));
    if (asset.status === 'ready' && readyIds.size === 0) {
        throw new TypeError(`${path} is ready but has no ready revision.`);
    }
    if (asset.currentRevisionId !== undefined && !readyIds.has(asset.currentRevisionId)) {
        throw new RangeError(`${path}.currentRevisionId does not identify a ready revision.`);
    }

    return clone(asset);
}

/** Return a detached, frozen preview descriptor for a catalog card. */
export function catalogAssetPreview(asset) {
    const checked = validateCatalogAsset(asset);
    return checked.preview ? deepFreeze(clone(checked.preview)) : null;
}

/**
 * Validate a page returned by an asset service.
 *
 * @param {object} catalog `{version, assets, nextCursor?}`
 * @returns {object} a defensive copy
 */
export function validateAssetCatalog(catalog) {
    if (!isObject(catalog)) throw new TypeError('asset catalog must be an object.');
    if (catalog.version !== 1) throw new RangeError('asset catalog version must be 1.');
    if (!Array.isArray(catalog.assets)) throw new TypeError('asset catalog assets must be an array.');
    if (catalog.nextCursor !== undefined && catalog.nextCursor !== null
        && typeof catalog.nextCursor !== 'string') {
        throw new TypeError('asset catalog nextCursor must be a string or null.');
    }

    const assets = catalog.assets.map((asset, index) => validateCatalogAsset(asset, `assets[${index}]`));
    const ids = assets.map((asset) => asset.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate) throw new RangeError(`asset catalog has duplicate asset id "${duplicate}".`);
    return { ...clone(catalog), assets };
}

/**
 * Filter catalog records for an asset picker. Every filter is optional.
 *
 * Query matching covers the visible label plus stable source identifiers and
 * URIs. The original array and records are never changed.
 *
 * @param {Array<object>} assets
 * @param {object} [filters]
 * @returns {Array<object>}
 */
export function filterCatalogAssets(assets, filters = {}) {
    if (!Array.isArray(assets)) throw new TypeError('filterCatalogAssets(): assets must be an array.');
    if (!isObject(filters)) throw new TypeError('filterCatalogAssets(): filters must be an object.');

    const query = String(filters.query ?? '').trim().toLocaleLowerCase();
    const statuses = filters.status === undefined
        ? null
        : new Set(Array.isArray(filters.status) ? filters.status : [filters.status]);
    if (statuses && [...statuses].some((status) => !ASSET_STATUSES.includes(status))) {
        throw new RangeError(`filterCatalogAssets(): unknown status in ${JSON.stringify([...statuses])}.`);
    }

    return assets.filter((asset) => {
        if (statuses && !statuses.has(asset.status)) return false;
        if (filters.sourceId !== undefined && asset.sourceId !== filters.sourceId) return false;
        if (filters.format !== undefined && asset.format !== filters.format) return false;
        if (!query) return true;
        const haystack = [asset.id, asset.label, asset.sourceId, asset.source?.uri, asset.format]
            .filter((value) => typeof value === 'string')
            .join('\n')
            .toLocaleLowerCase();
        return haystack.includes(query);
    });
}

function revisionOrder(revision) {
    const time = Date.parse(revision.createdAt ?? '');
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/**
 * Select a ready immutable revision, explicitly when pinned and otherwise via
 * the asset's currentRevisionId (falling back to newest ready creation time).
 *
 * @param {object} asset
 * @param {string} [revisionId]
 * @returns {object} a detached, deeply frozen revision
 */
export function selectReadyRevision(asset, revisionId) {
    const checked = validateCatalogAsset(asset);
    const ready = checked.revisions.filter((revision) => revision.status === 'ready');
    const wanted = revisionId ?? checked.currentRevisionId;
    let selected = wanted === undefined
        ? [...ready].sort((a, b) => revisionOrder(b) - revisionOrder(a)
            || b.id.localeCompare(a.id))[0]
        : ready.find((revision) => revision.id === wanted);

    if (!selected) {
        const detail = wanted === undefined ? 'has no ready revision' : `has no ready revision "${wanted}"`;
        throw new RangeError(`asset "${checked.id}" ${detail}.`);
    }
    selected = clone(selected);
    return deepFreeze(selected);
}

/**
 * Bind an asset revision to a slide and copy its verified optics into the
 * runtime fields consumed by SlideCanvas.
 *
 * @param {object} slide current slide record
 * @param {object} asset catalog asset
 * @param {object} [options] `{revisionId}`
 * @returns {object} a new slide; inputs are untouched
 */
export function materializeSlideAsset(slide, asset, options = {}) {
    if (!isObject(slide)) throw new TypeError('materializeSlideAsset(): slide must be an object.');
    if (!isObject(options)) throw new TypeError('materializeSlideAsset(): options must be an object.');
    const checkedAsset = validateCatalogAsset(asset);
    const revision = selectReadyRevision(checkedAsset, options.revisionId);
    const optics = verifiedOptics(revision.optics, `asset ${checkedAsset.id} revision ${revision.id} optics`);

    const next = {
        ...slide,
        assetId: checkedAsset.id,
        assetRevisionId: revision.id,
        dzi: revision.derivatives.dzi.url,
        nativeObjective: optics.nativeObjective,
        nativeMpp: optics.nativeMpp,
        downsample: optics.downsample,
        ...(optics.slideWidthPx === undefined ? {} : {
            slideWidthPx: optics.slideWidthPx,
            slideHeightPx: optics.slideHeightPx,
        }),
        assetBinding: {
            revisionId: revision.id,
            sourceChecksum: revision.sourceChecksum ?? null,
            derivativeKind: 'dzi',
            opticsProvenance: optics.provenance ?? null,
        },
    };
    return next;
}
