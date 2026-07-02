// csvExport — one copy of the client-side CSV builder used by the log
// tables (MomentsTable always; ActivityTable when a view-only filter is
// active and the server-streamed export can't reproduce the view).
//
// Matches the server-side exports' conventions: CRLF line endings and a
// spreadsheet-injection guard on leading =,+,-,@,tab,CR characters.

export function csvEscape(value) {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
