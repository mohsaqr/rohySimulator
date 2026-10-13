// caseImportFile.js — reading the file an admin picked to import a case.
//
// jsdom's FileReader reads real Blobs but never fails, so a browser's refusal
// (NotReadableError / NotFoundError) and Chrome's empty-string answer for a
// file too large to be a string are simulated by stubbing the read call.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    CaseFileError,
    isCasePackageFile,
    isUnreadableFileError,
    readCaseJsonFile,
    readFileChunk,
} from './caseImportFile.js';

// Chrome's own text for NotReadableError, verbatim from the Prova report.
const CHROME_TEXT = 'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.';

const jsonFile = (value, name = 'case-chest-pain.json') => new File([JSON.stringify(value)], name, { type: 'application/json' });

/** A tar the way the package writer makes one: a 512-byte header with "ustar" at byte 257. */
function tarBytes() {
    const header = new Uint8Array(1024);
    header.set(new TextEncoder().encode('case.json'), 0);
    header.set(new TextEncoder().encode('ustar\u000000'), 257);
    return header;
}

/** Make the next FileReader `method` call fail the way the browser does. */
function failRead(method, name, message = CHROME_TEXT) {
    return vi.spyOn(FileReader.prototype, method).mockImplementation(function fail() {
        Object.defineProperty(this, 'error', { value: new DOMException(message, name) });
        this.onerror?.();
    });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('readCaseJsonFile', () => {
    it('returns the exported case', async () => {
        const data = await readCaseJsonFile(jsonFile({ name: 'Chest pain', description: 'd', config: { pages: [] } }));
        expect(data).toEqual({ name: 'Chest pain', description: 'd', config: { pages: [] } });
    });

    it('turns a file the browser cannot read into case_file_unreadable, never its raw text', async () => {
        // Regression lock: FI0010.AUTHOR.03 raw NotReadableError shown on case import
        failRead('readAsText', 'NotReadableError');
        const err = await readCaseJsonFile(jsonFile({ name: 'x', description: 'y' })).catch((e) => e);
        expect(err).toBeInstanceOf(CaseFileError);
        expect(err.code).toBe('case_file_unreadable');
        expect(err.message).not.toContain('permission problems');
        expect(err.cause?.name).toBe('NotReadableError');
    });

    it('treats NotFoundError (file moved or deleted after it was chosen) the same way', async () => {
        failRead('readAsText', 'NotFoundError', 'A requested file or directory could not be found.');
        await expect(readCaseJsonFile(jsonFile({ name: 'x', description: 'y' }))).rejects.toMatchObject({ code: 'case_file_unreadable' });
    });

    it('treats an empty read of a non-empty file as unreadable (Chrome, files of ~512 MB to 2 GB)', async () => {
        vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function emptyString() {
            Object.defineProperty(this, 'result', { value: '' });
            this.onload?.();
        });
        await expect(readCaseJsonFile(jsonFile({ name: 'x', description: 'y' }))).rejects.toMatchObject({ code: 'case_file_unreadable' });
    });

    it('passes on a read failure that is not the file being unreadable', async () => {
        failRead('readAsText', 'AbortError', 'aborted');
        const err = await readCaseJsonFile(jsonFile({ name: 'x', description: 'y' })).catch((e) => e);
        expect(err).not.toBeInstanceOf(CaseFileError);
        expect(err.name).toBe('AbortError');
    });

    it('refuses a .rohycase without reading it whole — it belongs in Import package', async () => {
        // The FI-0010 package is 2.98 GB; reading it as text is what failed.
        const readText = vi.spyOn(FileReader.prototype, 'readAsText');
        const pkg = new File([tarBytes()], 'case-FI-0017.rohycase');
        await expect(readCaseJsonFile(pkg)).rejects.toMatchObject({ code: 'case_file_is_package' });
        expect(readText).not.toHaveBeenCalled();
    });

    it('recognises a renamed package by its tar header', async () => {
        const readText = vi.spyOn(FileReader.prototype, 'readAsText');
        await expect(readCaseJsonFile(new File([tarBytes()], 'case.json'))).rejects.toMatchObject({ code: 'case_file_is_package' });
        expect(readText).not.toHaveBeenCalled();
    });

    it('calls a file that is not JSON, or not a case, invalid', async () => {
        await expect(readCaseJsonFile(new File(['{not json'], 'x.json'))).rejects.toMatchObject({ code: 'case_file_invalid' });
        await expect(readCaseJsonFile(jsonFile({ name: 'no description' }))).rejects.toMatchObject({ code: 'case_file_invalid' });
        await expect(readCaseJsonFile(jsonFile(null))).rejects.toMatchObject({ code: 'case_file_invalid' });
    });
});

describe('isCasePackageFile', () => {
    it('is true by extension in any case, and by tar header; false for JSON and for tiny files', async () => {
        expect(await isCasePackageFile(new File(['x'], 'CASE.ROHYCASE'))).toBe(true);
        expect(await isCasePackageFile(new File([tarBytes()], 'renamed.bin'))).toBe(true);
        expect(await isCasePackageFile(jsonFile({ name: 'x', description: 'y', padding: 'p'.repeat(400) }))).toBe(false);
        expect(await isCasePackageFile(new File(['{}'], 'tiny.json'))).toBe(false);
    });
});

describe('readFileChunk', () => {
    it('returns exactly the bytes of the range, and the ranges tile the file', async () => {
        const file = new File(['0123456789'], 'p.rohycase');
        const pieces = await Promise.all([[0, 4], [4, 8], [8, 12]].map(([a, b]) => readFileChunk(file, a, b)));
        const text = pieces.map((buf) => new TextDecoder().decode(buf));
        expect(text).toEqual(['0123', '4567', '89']);
        expect(pieces.reduce((n, buf) => n + buf.byteLength, 0)).toBe(file.size);
    });

    it('rejects with case_file_unreadable when the browser refuses the chunk', async () => {
        failRead('readAsArrayBuffer', 'NotReadableError');
        await expect(readFileChunk(new File(['0123'], 'p.rohycase'), 0, 4)).rejects.toMatchObject({ code: 'case_file_unreadable' });
    });
});

describe('isUnreadableFileError', () => {
    it('matches only the two DOMException names a picked file fails with', () => {
        expect(isUnreadableFileError(new DOMException('m', 'NotReadableError'))).toBe(true);
        expect(isUnreadableFileError(new DOMException('m', 'NotFoundError'))).toBe(true);
        expect(isUnreadableFileError(new DOMException('m', 'AbortError'))).toBe(false);
        expect(isUnreadableFileError(null)).toBe(false);
    });
});
