/**
 * The time contract — RPS-1 §17.
 *
 * ONE rule: every instant rohy stores or transmits is a UTC ISO-8601 string
 * with an explicit `Z` and milliseconds — `2026-08-29T12:34:56.789Z`.
 *
 * This module lives under `server/shared/` because BOTH sides import it: the
 * server stamps with it, the client parses with it, and plugins receive it as
 * `ctx.now()`. A second definition on either side is how the two formats got
 * into one column in the first place.
 *
 * ## What went wrong, so it is not re-derived
 *
 * `learning_events.timestamp` held two formats at once. Events sent through
 * the batch route arrived as the browser's `toISOString()`; everything else
 * fell through to sqlite's `DEFAULT CURRENT_TIMESTAMP`, which is UTC but
 * writes `2026-08-29 12:34:56` — a space, no zone marker, no milliseconds.
 * Both are UTC and sqlite's own date functions read them identically
 * (`julianday(iso) - julianday(space)` is exactly 0), so the aggregation was
 * always right. Two things were not:
 *
 *   1. **Ordering.** The column has TEXT storage, so `ORDER BY timestamp` is a
 *      string sort, and `' '` (0x20) sorts before `'T'` (0x54):
 *          '2026-08-29 23:59:59' < '2026-08-29T00:00:01.000Z'  →  true
 *      A row a full day later sorted first. Measured on the development
 *      database: 2169 of 3119 rows sat in the wrong position.
 *
 *   2. **Browser parsing.** `new Date('2026-08-29 23:59:59')` is not an ISO
 *      string, so V8 falls back to local-time parsing and the row lands at the
 *      viewer's UTC offset — three hours out in Europe/Helsinki, a different
 *      number for every viewer, and a different number either side of a DST
 *      boundary.
 *
 * Both disappear the moment there is exactly one format. `toIsoZ()` is how a
 * value from anywhere — a legacy row, a browser, an epoch, a Date — becomes
 * that one format; `nowIso()` is how a new one is minted.
 *
 * @module server/shared/time
 */

/** A conforming instant: UTC, `T` separator, exactly three decimals, `Z`. */
export const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The legacy sqlite `CURRENT_TIMESTAMP` shape — UTC, but silent about it.
 * Kept because rows written before migration 0050 still look like this in any
 * database restored from an older backup.
 */
export const SQLITE_TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * The same instant, expressed in SQL.
 *
 * Use this in an INSERT rather than relying on `DEFAULT CURRENT_TIMESTAMP`:
 * the default writes the legacy shape, and a column default cannot be altered
 * in sqlite without rebuilding the table. Interpolating it is safe — it is a
 * constant expression with no user input anywhere in it.
 *
 * `%f` is seconds with three decimals, so this is byte-identical in shape to
 * what `nowIso()` produces in JavaScript.
 */
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * Now, shifted by a sqlite modifier, as the contract.
 *
 * `datetime('now', '+30 minutes')` returns the legacy space-separated shape, so
 * every deadline written that way (an investigation's `available_at`, say)
 * re-introduced the second format into a column migration 0050 had already
 * normalised — leaving one column holding both shapes at once, which is worse
 * than uniformly legacy: `ORDER BY` mis-sorts it and any client that patches a
 * `Z` onto the end produces `...ZZ` and an Invalid Date.
 *
 * The modifier is a SQL fragment, not a value. Callers build it from a bound
 * `?` or a constant (`'+' || ? || ' minutes'`); it must never carry user input
 * spliced in as text.
 *
 * @param {string} modifier  a sqlite date modifier expression — NEVER user input
 * @returns {string}
 */
export function sqlNowPlus(modifier) {
    return `strftime('%Y-%m-%dT%H:%M:%fZ','now', ${modifier})`;
}

/**
 * A SQL expression normalising an existing column to the contract.
 *
 * Reads any shape sqlite's date functions accept and returns the canonical
 * one, or NULL for a NULL or unparseable input. Used by migration 0050 and by
 * any query that must still order a column not yet migrated.
 *
 * @param {string} column  a column name or expression — NEVER user input
 * @returns {string}
 */
export function sqlIsoZ(column) {
    return `strftime('%Y-%m-%dT%H:%M:%fZ', ${column})`;
}

/**
 * Now, as the contract.
 *
 * This is the server's clock. It is the authority for every stored instant:
 * a browser's clock is unverifiable, so what a client reports is kept beside
 * the server's reading (`learning_events.client_time`) rather than instead
 * of it.
 *
 * @returns {string} e.g. `2026-08-29T12:34:56.789Z`
 */
export function nowIso() {
    return new Date().toISOString();
}

/**
 * Epoch milliseconds for any instant rohy might hold, or null.
 *
 * Accepts the contract shape, the legacy sqlite shape (pinned to UTC, which
 * is the whole point), a `Date`, and a number. Anything else is null rather
 * than `NaN`, so a caller cannot accidentally propagate a silent `NaN` into
 * arithmetic and report it as a duration.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function timeMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const s = String(value).trim();
    // The legacy shape is UTC but says so nowhere; without the `Z` the engine
    // reads it as local time. This single substitution is the whole fix.
    const t = new Date(SQLITE_TS_RE.test(s) ? `${s.replace(' ', 'T')}Z` : s).getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * Any instant → the contract shape, or null.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {string|null}
 */
export function toIsoZ(value) {
    const ms = timeMs(value);
    return ms == null ? null : new Date(ms).toISOString();
}

/**
 * True when a value is already stored in the contract shape.
 *
 * Deliberately stricter than `toIsoZ(v) !== null`: this answers "is this row
 * conforming", which is what the migration test and the write-path guard ask.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoZ(value) {
    return typeof value === 'string' && ISO_Z_RE.test(value);
}

/**
 * Chronological comparator for rows carrying a `timestamp`.
 *
 * Rows whose time will not parse sort last rather than anywhere — an
 * unparseable value is a defect to see, not one to scatter through the middle
 * of a session. `id` breaks a tie so the order is stable across renders and
 * two events in the same millisecond do not swap between sorts.
 *
 * @param {{timestamp?: unknown, id?: unknown}} a
 * @param {{timestamp?: unknown, id?: unknown}} b
 * @returns {number}
 */
export function compareTime(a, b) {
    const ta = timeMs(a?.timestamp);
    const tb = timeMs(b?.timestamp);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if (ta == null && tb != null) return 1;
    if (ta != null && tb == null) return -1;
    if (ta == null && tb == null) {
        const sa = String(a?.timestamp ?? '');
        const sb = String(b?.timestamp ?? '');
        if (sa !== sb) return sa < sb ? -1 : 1;
    }
    const ia = Number(a?.id);
    const ib = Number(b?.id);
    if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib;
    return 0;
}

/**
 * Anchor a client-reported instant to the server's clock.
 *
 * A batched event carries how long before the flush it happened
 * (`offset_ms`), not just when the device thought it was. Subtracting that
 * offset from the server's receipt time keeps the *spacing* between events
 * exact — which is what time-on-task and transition analysis actually read —
 * while the *anchor* comes from a clock rohy controls. A device three hours
 * fast no longer drags its whole session three hours away from the chat turns
 * beside it.
 *
 * A missing or absurd offset degrades to the receipt time rather than
 * throwing: telemetry that cannot be placed perfectly is still worth more
 * than telemetry dropped.
 *
 * @param {number} receivedMs   server receipt, epoch ms
 * @param {unknown} offsetMs    client's `flushedAt - createdAt`, milliseconds
 * @param {number} [maxOffsetMs=86400000]  reject an offset beyond this
 * @returns {string} the contract shape
 */
export function anchorToServer(receivedMs, offsetMs, maxOffsetMs = 86_400_000) {
    const n = Number(offsetMs);
    if (!Number.isFinite(n) || n < 0 || n > maxOffsetMs) return new Date(receivedMs).toISOString();
    return new Date(receivedMs - n).toISOString();
}
