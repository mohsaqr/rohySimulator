import {
    ASSET_KINDS,
    CASE_SCHEMA_URI,
    CASE_SCHEMA_VERSION,
    PACKAGE_SCHEMA_URI,
    RENDITION_KINDS,
    REVISION_STATUSES,
    RUBRIC_SCHEMA_URI,
} from './constants.js';
import { isStableId } from './ids.js';

const objectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value) => Number.isInteger(value);

function issue(path, code, message) {
    return { severity: 'error', source: 'structure', path, code, message };
}

function collector() {
    const issues = [];
    const add = (path, code, message) => issues.push(issue(path, code, message));
    return { issues, add };
}

function guardValidation(name, fn) {
    try {
        return fn();
    } catch (error) {
        return [issue('$', 'malformed_document', `${name} could not be inspected safely: ${error?.message ?? String(error)}`)];
    }
}

function requireObject(value, path, add) {
    if (!objectLike(value)) {
        add(path, 'type_object', `${path} must be an object.`);
        return false;
    }
    return true;
}

function requireArray(value, path, add) {
    if (!Array.isArray(value)) {
        add(path, 'type_array', `${path} must be an array.`);
        return false;
    }
    return true;
}

function requireString(value, path, add, { nonEmpty = false } = {}) {
    if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
        add(path, 'type_string', `${path} must be ${nonEmpty ? 'a non-empty' : 'a'} string.`);
        return false;
    }
    return true;
}

function requireId(value, path, add) {
    if (!isStableId(value)) {
        add(path, 'invalid_id', `${path} must be a portable non-empty identifier.`);
        return false;
    }
    return true;
}

function requireFinite(value, path, add, { aboveZero = false, whole = false } = {}) {
    if (!finite(value) || (aboveZero && value <= 0) || (whole && !integer(value))) {
        add(path, 'type_number', `${path} must be ${whole ? 'an integer' : 'a finite number'}${aboveZero ? ' greater than zero' : ''}.`);
        return false;
    }
    return true;
}

function allowOnly(value, allowed, path, add) {
    if (!objectLike(value)) return;
    Object.keys(value).filter((key) => !allowed.includes(key)).forEach((key) => {
        add(`${path}.${key}`, 'unknown_property', `${path}.${key} is not part of case format 1.0.`);
    });
}

function validateStringArray(value, path, add) {
    if (!requireArray(value, path, add)) return;
    value.forEach((entry, index) => requireString(entry, `${path}[${index}]`, add));
}

function validateRect(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['x', 'y', 'w', 'h'], path, add);
    ['x', 'y', 'w', 'h'].forEach((key) => requireFinite(value[key], `${path}.${key}`, add));
}

function validateRevision(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'number', 'status', 'parentRevisionId', 'createdAt', 'createdBy', 'publishedAt'], path, add);
    requireId(value.id, `${path}.id`, add);
    requireFinite(value.number, `${path}.number`, add, { aboveZero: true, whole: true });
    if (!REVISION_STATUSES.includes(value.status)) {
        add(`${path}.status`, 'enum', `${path}.status must be one of ${REVISION_STATUSES.join(', ')}.`);
    }
    if (value.parentRevisionId !== null) requireId(value.parentRevisionId, `${path}.parentRevisionId`, add);
    if (requireString(value.createdAt, `${path}.createdAt`, add, { nonEmpty: true }) && Number.isNaN(Date.parse(value.createdAt))) {
        add(`${path}.createdAt`, 'date_time', `${path}.createdAt must be an ISO date-time.`);
    }
    requireString(value.createdBy, `${path}.createdBy`, add, { nonEmpty: true });
    if (value.publishedAt !== undefined && value.publishedAt !== null
        && requireString(value.publishedAt, `${path}.publishedAt`, add, { nonEmpty: true })
        && Number.isNaN(Date.parse(value.publishedAt))) {
        add(`${path}.publishedAt`, 'date_time', `${path}.publishedAt must be an ISO date-time.`);
    }
}

function validateClinical(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['accession', 'specimenSummary', 'history'], path, add);
    ['accession', 'specimenSummary', 'history'].forEach((key) => {
        if (value[key] !== undefined) requireString(value[key], `${path}.${key}`, add);
    });
}

function validateSpecimen(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'part', 'label', 'description', 'dimensions', 'weight', 'grossImageAssetIds'], path, add);
    requireId(value.id, `${path}.id`, add);
    ['part', 'label', 'description'].forEach((key) => requireString(value[key], `${path}.${key}`, add));
    ['dimensions', 'weight'].forEach((key) => {
        if (value[key] !== undefined) requireString(value[key], `${path}.${key}`, add);
    });
    if (requireArray(value.grossImageAssetIds, `${path}.grossImageAssetIds`, add)) {
        value.grossImageAssetIds.forEach((id, index) => requireId(id, `${path}.grossImageAssetIds[${index}]`, add));
    }
}

function validateBlock(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'specimenId', 'label', 'description'], path, add);
    requireId(value.id, `${path}.id`, add);
    requireId(value.specimenId, `${path}.specimenId`, add);
    requireString(value.label, `${path}.label`, add);
    if (value.description !== undefined) requireString(value.description, `${path}.description`, add);
}

function validateAsset(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'kind', 'source', 'metadata', 'renditions'], path, add);
    requireId(value.id, `${path}.id`, add);
    if (!ASSET_KINDS.includes(value.kind)) add(`${path}.kind`, 'enum', `${path}.kind is not supported.`);

    if (requireObject(value.source, `${path}.source`, add)) {
        allowOnly(value.source, ['kind', 'catalogAssetId', 'uri', 'revision', 'checksum'], `${path}.source`, add);
        if (!['catalog', 'external', 'embedded'].includes(value.source.kind)) {
            add(`${path}.source.kind`, 'enum', `${path}.source.kind is not supported.`);
        }
        if (value.source.catalogAssetId !== undefined) requireId(value.source.catalogAssetId, `${path}.source.catalogAssetId`, add);
        if (value.source.uri !== undefined) requireString(value.source.uri, `${path}.source.uri`, add, { nonEmpty: true });
        ['revision', 'checksum'].forEach((key) => {
            if (value.source[key] !== undefined && value.source[key] !== null) {
                requireString(value.source[key], `${path}.source.${key}`, add, { nonEmpty: true });
            }
        });
    }

    if (requireObject(value.metadata, `${path}.metadata`, add)) {
        allowOnly(value.metadata, ['widthPx', 'heightPx', 'nativeObjective', 'nativeMpp', 'downsample', 'scaleMm'], `${path}.metadata`, add);
        Object.entries(value.metadata).forEach(([key, entry]) => requireFinite(entry, `${path}.metadata.${key}`, add, { aboveZero: true }));
    }

    if (requireArray(value.renditions, `${path}.renditions`, add)) {
        value.renditions.forEach((rendition, index) => {
            const at = `${path}.renditions[${index}]`;
            if (!requireObject(rendition, at, add)) return;
            allowOnly(rendition, ['kind', 'uri', 'checksum'], at, add);
            if (!RENDITION_KINDS.includes(rendition.kind)) add(`${at}.kind`, 'enum', `${at}.kind is not supported.`);
            requireString(rendition.uri, `${at}.uri`, add, { nonEmpty: true });
            if (rendition.checksum !== undefined && rendition.checksum !== null) {
                requireString(rendition.checksum, `${at}.checksum`, add, { nonEmpty: true });
            }
        });
    }
}

function validateSlide(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'blockId', 'assetId', 'label', 'stain'], path, add);
    ['id', 'blockId', 'assetId'].forEach((key) => requireId(value[key], `${path}.${key}`, add));
    requireString(value.label, `${path}.label`, add);
    if (requireObject(value.stain, `${path}.stain`, add)) {
        allowOnly(value.stain, ['code', 'display', 'system'], `${path}.stain`, add);
        requireString(value.stain.code, `${path}.stain.code`, add);
        requireString(value.stain.display, `${path}.stain.display`, add);
        if (value.stain.system !== undefined) requireString(value.stain.system, `${path}.stain.system`, add);
    }
}

function validateActivity(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'kind', 'prompt', 'instructions'], path, add);
    requireId(value.id, `${path}.id`, add);
    requireString(value.kind, `${path}.kind`, add, { nonEmpty: true });
    requireString(value.prompt, `${path}.prompt`, add);
    requireString(value.instructions, `${path}.instructions`, add);
}

/** Validate the public manifest's JSON shape. This function never throws. */
export function validateManifestStructure(manifest) {
    return guardValidation('case manifest', () => {
        const { issues, add } = collector();
        if (!requireObject(manifest, '$', add)) return issues;
        allowOnly(manifest, ['$schema', 'schemaVersion', 'id', 'revision', 'title', 'clinical', 'specimens', 'blocks', 'assets', 'slides', 'activities', 'provenance', 'extensions'], '$', add);
        if (manifest.$schema !== CASE_SCHEMA_URI) add('$.$schema', 'schema_uri', `Manifest $schema must be ${CASE_SCHEMA_URI}.`);
        if (manifest.schemaVersion !== CASE_SCHEMA_VERSION) add('$.schemaVersion', 'schema_version', `Manifest schemaVersion must be ${CASE_SCHEMA_VERSION}.`);
        requireId(manifest.id, '$.id', add);
        validateRevision(manifest.revision, '$.revision', add);
        requireString(manifest.title, '$.title', add);
        validateClinical(manifest.clinical, '$.clinical', add);
        [['specimens', validateSpecimen], ['blocks', validateBlock], ['assets', validateAsset],
            ['slides', validateSlide], ['activities', validateActivity]].forEach(([key, validate]) => {
            if (requireArray(manifest[key], `$.${key}`, add)) {
                manifest[key].forEach((entry, index) => validate(entry, `$.${key}[${index}]`, add));
            }
        });
        requireObject(manifest.provenance, '$.provenance', add);
        if (manifest.extensions !== undefined) requireObject(manifest.extensions, '$.extensions', add);
        return issues;
    });
}

function validateDiagnosis(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['expected', 'accept', 'requireTerms', 'rejectTerms'], path, add);
    requireString(value.expected, `${path}.expected`, add);
    ['accept', 'requireTerms', 'rejectTerms'].forEach((key) => validateStringArray(value[key], `${path}.${key}`, add));
}

function validateRoi(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['id', 'label', 'x', 'y', 'w', 'h', 'minObjective', 'dwellMs', 'critical'], path, add);
    requireId(value.id, `${path}.id`, add);
    requireString(value.label, `${path}.label`, add);
    ['x', 'y', 'w', 'h', 'minObjective', 'dwellMs'].forEach((key) => requireFinite(value[key], `${path}.${key}`, add));
    if (typeof value.critical !== 'boolean') add(`${path}.critical`, 'type_boolean', `${path}.critical must be boolean.`);
}

function validateSlideCriteria(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['slideId', 'weight', 'screeningObjective', 'coverageObjective', 'coverageGrid', 'tissueBounds', 'rois'], path, add);
    requireId(value.slideId, `${path}.slideId`, add);
    ['weight', 'screeningObjective', 'coverageObjective'].forEach((key) => requireFinite(value[key], `${path}.${key}`, add));
    requireFinite(value.coverageGrid, `${path}.coverageGrid`, add, { whole: true });
    validateRect(value.tissueBounds, `${path}.tissueBounds`, add);
    if (requireArray(value.rois, `${path}.rois`, add)) {
        value.rois.forEach((roi, index) => validateRoi(roi, `${path}.rois[${index}]`, add));
    }
}

function validateActivityRubric(value, path, add) {
    if (!requireObject(value, path, add)) return;
    allowOnly(value, ['activityId', 'hints', 'diagnosis', 'slideCriteria'], path, add);
    requireId(value.activityId, `${path}.activityId`, add);
    validateStringArray(value.hints, `${path}.hints`, add);
    if (value.diagnosis !== undefined) validateDiagnosis(value.diagnosis, `${path}.diagnosis`, add);
    if (requireArray(value.slideCriteria, `${path}.slideCriteria`, add)) {
        value.slideCriteria.forEach((criteria, index) => validateSlideCriteria(criteria, `${path}.slideCriteria[${index}]`, add));
    }
}

/** Validate the protected rubric's JSON shape. This function never throws. */
export function validateRubricStructure(rubric) {
    return guardValidation('protected rubric', () => {
        const { issues, add } = collector();
        if (!requireObject(rubric, '$', add)) return issues;
        allowOnly(rubric, ['$schema', 'schemaVersion', 'id', 'caseId', 'caseRevisionId', 'activities'], '$', add);
        if (rubric.$schema !== RUBRIC_SCHEMA_URI) add('$.$schema', 'schema_uri', `Rubric $schema must be ${RUBRIC_SCHEMA_URI}.`);
        if (rubric.schemaVersion !== CASE_SCHEMA_VERSION) add('$.schemaVersion', 'schema_version', `Rubric schemaVersion must be ${CASE_SCHEMA_VERSION}.`);
        ['id', 'caseId', 'caseRevisionId'].forEach((key) => requireId(rubric[key], `$.${key}`, add));
        if (requireArray(rubric.activities, '$.activities', add)) {
            rubric.activities.forEach((activity, index) => validateActivityRubric(activity, `$.activities[${index}]`, add));
        }
        return issues;
    });
}

/** Validate a package index file without trusting nested file rows. */
export function validatePackageIndexStructure(index) {
    return guardValidation('package index', () => {
        const { issues, add } = collector();
        if (!requireObject(index, '$', add)) return issues;
        allowOnly(index, ['$schema', 'schemaVersion', 'kind', 'caseId', 'caseRevisionId', 'files'], '$', add);
        if (index.$schema !== PACKAGE_SCHEMA_URI) add('$.$schema', 'schema_uri', `Package $schema must be ${PACKAGE_SCHEMA_URI}.`);
        if (index.schemaVersion !== CASE_SCHEMA_VERSION) add('$.schemaVersion', 'schema_version', `Package schemaVersion must be ${CASE_SCHEMA_VERSION}.`);
        if (!['learner', 'educator'].includes(index.kind)) add('$.kind', 'enum', '$.kind must be learner or educator.');
        requireId(index.caseId, '$.caseId', add);
        requireId(index.caseRevisionId, '$.caseRevisionId', add);
        if (requireArray(index.files, '$.files', add)) {
            index.files.forEach((file, i) => {
                const at = `$.files[${i}]`;
                if (!requireObject(file, at, add)) return;
                allowOnly(file, ['path', 'sha256', 'bytes'], at, add);
                requireString(file.path, `${at}.path`, add, { nonEmpty: true });
                if (!(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))) {
                    add(`${at}.sha256`, 'sha256', `${at}.sha256 must be 64 lowercase hexadecimal characters.`);
                }
                requireFinite(file.bytes, `${at}.bytes`, add, { whole: true });
                if (finite(file.bytes) && file.bytes < 0) add(`${at}.bytes`, 'minimum', `${at}.bytes cannot be negative.`);
            });
        }
        return issues;
    });
}

/** Validate a manifest and optional rubric, always returning a flat issue list. */
export function validateCaseStructure(manifest, rubric = null) {
    return [
        ...validateManifestStructure(manifest),
        ...(rubric === null ? [] : validateRubricStructure(rubric).map((entry) => ({ ...entry, path: `rubric${entry.path.slice(1)}` }))),
    ];
}
