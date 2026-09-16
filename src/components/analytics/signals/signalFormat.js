// Formatting for the Text and Voice analytics tabs — plain functions, kept out
// of SignalUi.jsx so that file exports only components (react-refresh).

export const DASH = '—';

export function fmtNum(v, digits = 0) {
    return typeof v === 'number' && Number.isFinite(v)
        ? v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
        : DASH;
}

export function fmtPct(share, digits = 0) {
    return typeof share === 'number' && Number.isFinite(share) ? `${fmtNum(share * 100, digits)}%` : DASH;
}

export function fmtSeconds(ms, digits = 1) {
    return typeof ms === 'number' && Number.isFinite(ms) ? `${fmtNum(ms / 1000, digits)} s` : DASH;
}

/** "median (q1–q3)" — or just the median when the quartiles collapse. */
export function fmtMedianIqr(s, format = (v) => fmtNum(v)) {
    if (!s || s.median === null) return DASH;
    if (s.n < 2 || s.q1 === null || s.q3 === null || s.q1 === s.q3) return format(s.median);
    return `${format(s.median)} (${format(s.q1)}–${format(s.q3)})`;
}

export function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}


/** Query string for GET /addons/oyon/signal-windows, mirroring the emotion-records filters. */
export function signalWindowsQuery({ modality, caseId, userId, startDate, endDate, limit, offset }) {
    const params = new URLSearchParams();
    params.set('modality', modality);
    if (caseId) params.set('case_id', caseId);
    if (userId) params.set('user_id', userId);
    if (startDate) params.set('from', startDate);
    if (endDate) params.set('to', endDate);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return params.toString();
}
