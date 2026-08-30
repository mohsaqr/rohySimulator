import { CASE_SCHEMA_VERSION, PACKAGE_SCHEMA_URI } from './constants.js';
import { canonicalJSONStringify } from './canonicalJson.js';
import { assertLearnerSafe, createLearnerManifest } from './learnerView.js';
import {
    validateManifestStructure, validatePackageIndexStructure, validateRubricStructure,
} from './structuralValidation.js';
import { validateCaseDocuments } from './semanticValidation.js';

const encoder = new TextEncoder();

/** A package path must remain relative and traversal-free after ZIP extraction. */
export function isSafePackagePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 500
        && !path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path)
        && !path.includes('\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** SHA-256 for raw bytes through the browser/Node Web Crypto contract. */
export async function sha256Bytes(bytes, subtle = globalThis.crypto?.subtle) {
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
        throw new TypeError('sha256Bytes(): bytes must be a Uint8Array or an ArrayBuffer');
    }
    if (!subtle || typeof subtle.digest !== 'function') throw new Error('sha256Bytes(): Web Crypto subtle.digest is unavailable');
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 for UTF-8 text through the browser/Node Web Crypto contract. */
export async function sha256Text(text, subtle = globalThis.crypto?.subtle) {
    if (typeof text !== 'string') throw new TypeError('sha256Text(): text must be a string');
    if (!subtle || typeof subtle.digest !== 'function') throw new Error('sha256Text(): Web Crypto subtle.digest is unavailable');
    return sha256Bytes(encoder.encode(text), subtle);
}

function assertFileMap(files) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new TypeError('package files must be an object map');
    Object.entries(files).forEach(([path, contents]) => {
        if (!isSafePackagePath(path)) throw new TypeError(`Unsafe package path ${JSON.stringify(path)}`);
        if (typeof contents !== 'string') throw new TypeError(`Package entry ${path} must be UTF-8 text`);
    });
}

async function fileRows(files, subtle) {
    return Promise.all(Object.keys(files).sort().map(async (path) => ({
        path,
        sha256: await sha256Text(files[path], subtle),
        bytes: encoder.encode(files[path]).byteLength,
    })));
}

/**
 * Build the interoperable contents of a .pathcase archive without choosing a
 * ZIP library. A host can hand this text map to its archive implementation.
 */
export async function createPackageFileMap({
    manifest,
    rubric = null,
    mode = 'educator',
    protectedAnnotations = {},
    extraFiles = {},
    subtle,
} = {}) {
    if (!['learner', 'educator'].includes(mode)) throw new TypeError('mode must be learner or educator');
    const manifestIssues = validateManifestStructure(manifest);
    if (manifestIssues.length > 0) throw new TypeError(`Cannot package invalid manifest: ${manifestIssues.map((entry) => entry.path).join(', ')}`);
    if (mode === 'educator') {
        const rubricIssues = validateRubricStructure(rubric);
        if (rubricIssues.length > 0) throw new TypeError(`Educator package needs a valid rubric: ${rubricIssues.map((entry) => entry.path).join(', ')}`);
        const semanticIssues = validateCaseDocuments(manifest, rubric).filter((entry) => entry.severity === 'error');
        if (semanticIssues.length > 0) throw new TypeError(`Educator package documents do not match: ${semanticIssues.map((entry) => entry.code).join(', ')}`);
    }
    assertFileMap(extraFiles);
    const reserved = new Set(['manifest.json', 'rubric.json', 'package.json', 'checksums.sha256']);
    Object.keys(extraFiles).forEach((path) => {
        if (reserved.has(path) || path.startsWith('protected/')) {
            throw new TypeError(`Extra file cannot replace reserved package entry ${JSON.stringify(path)}`);
        }
    });
    if (!protectedAnnotations || typeof protectedAnnotations !== 'object' || Array.isArray(protectedAnnotations)) {
        throw new TypeError('protectedAnnotations must be an object map keyed by slide ID');
    }

    const publicManifest = mode === 'learner' ? assertLearnerSafe(createLearnerManifest(manifest)) : manifest;
    const files = { ...extraFiles, 'manifest.json': canonicalJSONStringify(publicManifest) };
    if (mode === 'educator') {
        files['rubric.json'] = canonicalJSONStringify(rubric);
        Object.entries(protectedAnnotations).forEach(([slideId, collection]) => {
            const path = `protected/annotations/${slideId}.geojson`;
            if (!isSafePackagePath(path)) throw new TypeError(`Unsafe annotation slide id ${JSON.stringify(slideId)}`);
            files[path] = canonicalJSONStringify(collection);
        });
    }
    assertFileMap(files);
    const rows = await fileRows(files, subtle);
    const index = {
        $schema: PACKAGE_SCHEMA_URI,
        schemaVersion: CASE_SCHEMA_VERSION,
        kind: mode,
        caseId: manifest.id,
        caseRevisionId: manifest.revision.id,
        files: rows,
    };
    files['package.json'] = canonicalJSONStringify(index);
    const checksummed = await fileRows(files, subtle);
    files['checksums.sha256'] = `${checksummed.map((row) => `${row.sha256}  ${row.path}`).join('\n')}\n`;
    return files;
}

function parseChecksumFile(text) {
    if (typeof text !== 'string') return null;
    const rows = text.trim().split('\n').filter(Boolean).map((line) => {
        const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
        return match ? { sha256: match[1], path: match[2] } : null;
    });
    return rows.some((row) => row === null) ? null : rows;
}

/** Verify package paths, index metadata, declared sizes, and every checksum. */
export async function verifyPackageFileMap(files, { subtle } = {}) {
    const issues = [];
    try { assertFileMap(files); } catch (error) {
        return [{ severity: 'error', source: 'package', code: 'unsafe_file_map', path: '$', message: error.message }];
    }
    let index;
    try { index = JSON.parse(files['package.json']); } catch {
        issues.push({ severity: 'error', source: 'package', code: 'invalid_package_index', path: 'package.json', message: 'package.json is missing or invalid JSON.' });
        return issues;
    }
    issues.push(...validatePackageIndexStructure(index).map((entry) => ({ ...entry, source: 'package', path: `package.json${entry.path.slice(1)}` })));
    const checksumRows = parseChecksumFile(files['checksums.sha256']);
    if (!checksumRows) {
        issues.push({ severity: 'error', source: 'package', code: 'invalid_checksums', path: 'checksums.sha256', message: 'checksums.sha256 is missing or malformed.' });
        return issues;
    }
    const expectedPaths = Object.keys(files).filter((path) => path !== 'checksums.sha256').sort();
    const listedPaths = checksumRows.map((row) => row.path).sort();
    if (JSON.stringify(expectedPaths) !== JSON.stringify(listedPaths)) {
        issues.push({ severity: 'error', source: 'package', code: 'checksum_file_set', path: 'checksums.sha256', message: 'Checksum file does not name every package entry exactly once.' });
    }
    const checksByPath = new Map(checksumRows.map((row) => [row.path, row.sha256]));
    await Promise.all(expectedPaths.map(async (path) => {
        const actual = await sha256Text(files[path], subtle);
        if (checksByPath.get(path) !== actual) {
            issues.push({ severity: 'error', source: 'package', code: 'checksum_mismatch', path, message: `Checksum mismatch for ${path}.` });
        }
    }));
    if (validatePackageIndexStructure(index).length === 0) {
        await Promise.all(index.files.map(async (row) => {
            if (!(row.path in files)) {
                issues.push({ severity: 'error', source: 'package', code: 'missing_declared_file', path: row.path, message: `Declared file ${row.path} is missing.` });
                return;
            }
            const bytes = encoder.encode(files[row.path]).byteLength;
            const digest = await sha256Text(files[row.path], subtle);
            if (bytes !== row.bytes || digest !== row.sha256) {
                issues.push({ severity: 'error', source: 'package', code: 'index_mismatch', path: row.path, message: `Package index metadata does not match ${row.path}.` });
            }
        }));
        if (index.kind === 'learner' && ('rubric.json' in files || Object.keys(files).some((path) => path.startsWith('protected/')))) {
            issues.push({ severity: 'error', source: 'package', code: 'learner_leak', path: '$', message: 'Learner package contains protected entries.' });
        }
    }
    return issues;
}
