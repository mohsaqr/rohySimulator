/** Canonical Pathoyon case-core format identifiers. */
export const CASE_SCHEMA_VERSION = '1.0.0';
export const CASE_SCHEMA_URI = 'https://pathoyon.org/schemas/pathology-case-1.0.schema.json';
export const RUBRIC_SCHEMA_URI = 'https://pathoyon.org/schemas/pathology-rubric-1.0.schema.json';
export const PACKAGE_SCHEMA_URI = 'https://pathoyon.org/schemas/pathology-package-1.0.schema.json';

export const REVISION_STATUS = Object.freeze({
    DRAFT: 'draft',
    REVIEW: 'review',
    PUBLISHED: 'published',
    RETIRED: 'retired',
});

export const REVISION_STATUSES = Object.freeze(Object.values(REVISION_STATUS));
export const ASSET_KINDS = Object.freeze(['wsi', 'gross-image', 'attachment']);
export const RENDITION_KINDS = Object.freeze(['dzi', 'iiif', 'ome-zarr', 'dicomweb', 'image', 'file']);

