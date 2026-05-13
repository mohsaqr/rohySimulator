// SQLite timestamp helpers.
//
// SQLite's CURRENT_TIMESTAMP renders as `YYYY-MM-DD HH:MM:SS` in UTC
// — no `T`, no fractional seconds, no `Z`. Two consequences this
// module exists to handle:
//
// 1. *Storage*: when we precompute a future timestamp in JS (e.g. the
//    paged-agent ETA), we have to write it in the SQLite shape, or
//    lexicographic comparisons against CURRENT_TIMESTAMP silently
//    misbehave — `'2026-05-13T12:01:00.000Z'` sorts after
//    `'2026-05-13 12:02:00'` because `T` (0x54) > space (0x20).
//    `toSqliteUtc(ms)` formats a JS millis value the same way SQLite
//    formats CURRENT_TIMESTAMP.
//
// 2. *Response shape*: when we send a SQLite timestamp back to a JS
//    client, the lack of `Z` makes V8's `new Date()` parse the value
//    as local time, which skews countdowns / progress bars by the
//    browser's TZ offset. `sqliteTsToIso(ts)` returns an ISO
//    `…T…Z` string the client can parse correctly in any zone.
//
// Both functions are pure and TZ-stable. Inputs/outputs are strings
// or numeric millis — no Date objects leak across the boundary.

export function toSqliteUtc(ms) {
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export function sqliteTsToIso(ts) {
    if (!ts) return null;
    if (typeof ts !== 'string') {
        // Numeric millis or a Date — normalise via toISOString.
        return new Date(ts).toISOString();
    }
    if (/T.*Z$/.test(ts)) return ts;            // already ISO, pass through
    return `${ts.replace(' ', 'T')}.000Z`;       // SQLite UTC → ISO
}
