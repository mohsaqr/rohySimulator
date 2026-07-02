// Browser download helpers for the TNA analytics tabs (ported from
// chatoyon-plus's lib/analytics/{csv.mjs,exports.ts}). toCSV is pure and
// unit-tested in processMapUtils.test.js; the download* helpers are DOM
// side effects and no-op outside the browser.

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'string' ? value : String(value);
    // RFC-4180: quote when the field contains comma, double quote, or newline.
    if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
}

/**
 * Serialize rows to an RFC-4180 CSV string. Header row comes from `columns`
 * ({ key, header } pairs); cell values are read from row[col.key].
 */
export function toCSV(rows, columns) {
    const header = columns.map((c) => csvCell(c.header)).join(',');
    const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(','));
    return [header, ...body].join('\r\n');
}

/** Trigger a browser download of a CSV string. No-op outside the browser. */
export function downloadCSV(filename, csv) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Trigger a browser download from a data URL (e.g. a PNG). No-op outside the browser. */
export function downloadDataUrl(filename, dataUrl) {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
