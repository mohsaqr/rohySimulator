// Reading the file an admin picked to import a case. Two importers use this:
// ConfigPanel's JSON "Import" (readCaseJsonFile) and CasePackages' "Import
// package" (readFileChunk).
//
// FI0010.AUTHOR.03: a 2.98 GB .rohycase picked in the JSON importer went
// straight to `file.text()`. Chrome will not make a string of a file that
// size and rejects with a NotReadableError whose text — "…permission problems
// that have occurred after a reference to a file was acquired" — the toast
// showed raw. Between ~512 MB and 2 GB it is worse: Chrome resolves with an
// EMPTY string. Both measured in Chromium 149 (tmp/probe-file-text.mjs).
//
// So a package is recognised before anything reads it whole, and a failed
// read becomes a CaseFileError with a code the component turns into words
// (static t() keys live in the components, where the parser can see them).

export const CASE_PACKAGE_EXTENSION = '.rohycase';

// A package is a POSIX tar: "ustar" at byte 257 of its first header.
const TAR_MAGIC = 'ustar';
const TAR_MAGIC_OFFSET = 257;

/** The DOMException names a browser raises when a picked file cannot be read. */
const UNREADABLE = new Set(['NotReadableError', 'NotFoundError']);

/**
 * A picked case file that cannot be imported. `code` is one of
 * `case_file_unreadable`, `case_file_is_package`, `case_file_invalid`.
 */
export class CaseFileError extends Error {
    constructor(code, cause) {
        super(code, cause === undefined ? undefined : { cause });
        this.name = 'CaseFileError';
        this.code = code;
    }
}

/** Whether `err` is the browser refusing to read a picked file (moved, changed, cloud placeholder, too large). */
export const isUnreadableFileError = (err) => UNREADABLE.has(err?.name);

/**
 * Read a Blob with FileReader (jsdom has no Blob.text/arrayBuffer; browsers
 * fail both ways identically). An unreadable file rejects with a
 * CaseFileError('case_file_unreadable'); any other failure is passed on.
 *
 * @param {Blob} blob
 * @param {'text'|'arraybuffer'} as
 * @returns {Promise<string|ArrayBuffer>}
 */
export function readBlob(blob, as) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => {
            const err = reader.error;
            reject(isUnreadableFileError(err) ? new CaseFileError('case_file_unreadable', err) : err);
        };
        if (as === 'text') reader.readAsText(blob);
        else reader.readAsArrayBuffer(blob);
    });
}

/** Whether `file` is a case package — by its name, or by its tar header if it was renamed. Reads 5 bytes at most. */
export async function isCasePackageFile(file) {
    if (String(file?.name ?? '').toLowerCase().endsWith(CASE_PACKAGE_EXTENSION)) return true;
    if (!(file?.size >= TAR_MAGIC_OFFSET + TAR_MAGIC.length)) return false;
    const head = await readBlob(file.slice(TAR_MAGIC_OFFSET, TAR_MAGIC_OFFSET + TAR_MAGIC.length), 'arraybuffer');
    return String.fromCharCode(...new Uint8Array(head)) === TAR_MAGIC;
}

/**
 * Read and parse a case exported as JSON. Throws CaseFileError:
 * `case_file_is_package` for a .rohycase (it belongs in Import package),
 * `case_file_unreadable` when the browser cannot read it,
 * `case_file_invalid` when it is not a case.
 *
 * @param {File} file
 * @returns {Promise<object>} the case, as exported
 */
export async function readCaseJsonFile(file) {
    if (await isCasePackageFile(file)) throw new CaseFileError('case_file_is_package');
    const text = await readBlob(file, 'text');
    // Chrome's answer for a file too big to be a string, instead of an error.
    if (file.size > 0 && text.length === 0) throw new CaseFileError('case_file_unreadable');
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new CaseFileError('case_file_invalid', err);
    }
    if (!data?.name || !data?.description) throw new CaseFileError('case_file_invalid');
    return data;
}

/**
 * The bytes of one upload chunk, read before they are sent: a fetch body that
 * cannot be read fails as a network error ("Failed to fetch") and would be
 * retried and reported as one. Read here, it is a CaseFileError instead.
 *
 * @param {File} file
 * @param {number} start
 * @param {number} end
 * @returns {Promise<ArrayBuffer>}
 */
export const readFileChunk = (file, start, end) => readBlob(file.slice(start, end), 'arraybuffer');
