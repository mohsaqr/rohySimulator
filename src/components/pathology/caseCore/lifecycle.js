import {
    CASE_SCHEMA_URI, CASE_SCHEMA_VERSION, REVISION_STATUS, RUBRIC_SCHEMA_URI,
} from './constants.js';
import { cloneCanonical } from './canonicalJson.js';
import { createId, isStableId } from './ids.js';
import { validateCaseDocuments } from './semanticValidation.js';

export class RevisionConflictError extends Error {
    constructor(message) { super(message); this.name = 'RevisionConflictError'; this.code = 'revision_conflict'; }
}

export class LifecycleError extends Error {
    constructor(message) { super(message); this.name = 'LifecycleError'; this.code = 'invalid_lifecycle_transition'; }
}

export class PublicationValidationError extends Error {
    constructor(issues) {
        super(`Case revision cannot be published: ${issues.filter((entry) => entry.severity === 'error').map((entry) => entry.message).join(' | ')}`);
        this.name = 'PublicationValidationError';
        this.code = 'publication_validation_failed';
        this.issues = issues;
    }
}

const defaultIdFactory = (kind) => createId(kind);
const defaultClock = () => new Date();

function instant(clock) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('clock must return a valid Date or date-time value');
    return date.toISOString();
}

function minted(idFactory, kind) {
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    const value = idFactory(kind);
    if (!isStableId(value)) throw new TypeError(`idFactory returned an invalid ${kind} id: ${JSON.stringify(value)}`);
    return value;
}

function actor(actorId) {
    if (typeof actorId !== 'string' || actorId.trim() === '') throw new TypeError('actorId must be a non-empty string');
    return actorId;
}

/** Construct matching empty public/private draft documents. */
export function createCaseDraft({ idFactory = defaultIdFactory, clock = defaultClock, actorId = 'local-author' } = {}) {
    const caseId = minted(idFactory, 'case');
    const revisionId = minted(idFactory, 'revision');
    const manifest = {
        $schema: CASE_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: caseId,
        revision: {
            id: revisionId,
            number: 1,
            status: REVISION_STATUS.DRAFT,
            parentRevisionId: null,
            createdAt: instant(clock),
            createdBy: actor(actorId),
        },
        title: '',
        clinical: { accession: '', specimenSummary: '' },
        specimens: [],
        blocks: [],
        assets: [],
        slides: [],
        activities: [],
        provenance: {},
    };
    const rubric = {
        $schema: RUBRIC_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        id: minted(idFactory, 'rubric'),
        caseId,
        caseRevisionId: revisionId,
        activities: [],
    };
    return { manifest, rubric };
}

function assertDocuments(documents) {
    if (!documents || typeof documents !== 'object' || !documents.manifest) {
        throw new TypeError('lifecycle operation needs {manifest, rubric?}');
    }
    return documents;
}

function assertBase(manifest, baseRevisionId) {
    if (manifest.revision.id !== baseRevisionId) {
        throw new RevisionConflictError(`Expected base revision ${JSON.stringify(manifest.revision.id)}, received ${JSON.stringify(baseRevisionId)}.`);
    }
}

function assertStatus(manifest, allowed, operation) {
    if (!allowed.includes(manifest.revision.status)) {
        throw new LifecycleError(`${operation} cannot run from status ${JSON.stringify(manifest.revision.status)}; expected ${allowed.join(' or ')}.`);
    }
}

function revise(documents, status, {
    baseRevisionId,
    idFactory = defaultIdFactory,
    clock = defaultClock,
    actorId = 'local-author',
} = {}) {
    assertDocuments(documents);
    const current = documents.manifest;
    assertBase(current, baseRevisionId);
    const nextRevisionId = minted(idFactory, 'revision');
    const createdAt = instant(clock);
    const manifest = cloneCanonical({
        ...current,
        revision: {
            id: nextRevisionId,
            number: current.revision.number + 1,
            status,
            parentRevisionId: current.revision.id,
            createdAt,
            createdBy: actor(actorId),
            ...(status === REVISION_STATUS.PUBLISHED ? { publishedAt: createdAt } : {}),
        },
    });
    const rubric = documents.rubric === null || documents.rubric === undefined ? null : cloneCanonical({
        ...documents.rubric,
        id: minted(idFactory, 'rubric'),
        caseId: manifest.id,
        caseRevisionId: nextRevisionId,
    });
    return { manifest, rubric };
}

/** Append another immutable draft snapshot. */
export function saveDraft(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.DRAFT], 'saveDraft');
    return revise(documents, REVISION_STATUS.DRAFT, options);
}

/** Move a structurally and semantically sound draft into review. */
export function submitForReview(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.DRAFT], 'submitForReview');
    const issues = validateCaseDocuments(documents.manifest, documents.rubric ?? null);
    if (issues.some((entry) => entry.severity === 'error')) throw new PublicationValidationError(issues);
    return revise(documents, REVISION_STATUS.REVIEW, options);
}

/** Return a review snapshot to a fresh draft revision. */
export function returnToDraft(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.REVIEW], 'returnToDraft');
    return revise(documents, REVISION_STATUS.DRAFT, options);
}

/** Publish a new immutable revision after strict publication checks. */
export function publishRevision(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.REVIEW], 'publishRevision');
    const candidate = revise(documents, REVISION_STATUS.PUBLISHED, options);
    const issues = validateCaseDocuments(candidate.manifest, candidate.rubric, { forPublication: true });
    if (issues.some((entry) => entry.severity === 'error')) throw new PublicationValidationError(issues);
    return candidate;
}

/** Fork published content into a new draft without mutating the publication. */
export function forkPublishedRevision(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.PUBLISHED], 'forkPublishedRevision');
    return revise(documents, REVISION_STATUS.DRAFT, options);
}

/** Retire a published revision while retaining its immutable history. */
export function retirePublishedRevision(documents, options) {
    assertDocuments(documents);
    assertStatus(documents.manifest, [REVISION_STATUS.PUBLISHED], 'retirePublishedRevision');
    return revise(documents, REVISION_STATUS.RETIRED, options);
}

