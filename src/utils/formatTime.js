/**
 * Rendering an instant for a human — the display half of the time contract.
 *
 * `server/shared/time.js` owns what an instant IS (always UTC, always
 * `2026-08-29T12:34:56.789Z`). This module owns how it LOOKS, and the split
 * matters: storage and comparison must be zone-free, display must be in the
 * viewer's own zone. A learner in Helsinki and a reviewer in Madrid should see
 * the same event at different wall-clock times — that is correct, and it is
 * the one place a local zone belongs.
 *
 * This existed as six byte-identical private `fmtTime` copies — in
 * ActivityTable, ChatLogTable, MomentsTable, SessionsTable, SystemLogTable and
 * TurnsTable — each calling `new Date(ts)` directly. That parse reads sqlite's
 * `2026-08-29 12:34:56` as LOCAL time, so every server-stamped row rendered at
 * the viewer's UTC offset: three hours out in Helsinki, a different number for
 * every viewer, and a different number across a DST boundary. Six copies meant
 * six places to forget. There is one now, and it parses through the contract.
 */

import { timeMs } from '../../server/shared/time.js';

/**
 * An instant as `<date> <hh:mm:ss>` in the viewer's locale and zone.
 *
 * Returns the raw input unchanged when it will not parse, rather than the
 * string "Invalid Date" — an unreadable value in a log cell should still show
 * what was actually stored, so the defect is visible instead of erased.
 *
 * @param {string|number|Date|null|undefined} ts
 * @returns {string} '' for a null/empty input
 */
export function fmtTime(ts) {
    if (!ts) return '';
    const ms = timeMs(ts);
    if (ms == null) return String(ts);
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

/**
 * Clock time only — `hh:mm`, viewer's zone. For dense rows where the date is
 * already established by a grouping header.
 *
 * @param {string|number|Date|null|undefined} ts
 * @returns {string}
 */
export function fmtClock(ts) {
    const ms = timeMs(ts);
    if (ms == null) return '';
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
