// Axis helpers for the Text and Voice charts: a nice, rounded value axis whose
// labels carry their unit and only the decimals the step needs ("50%", not
// "50.0"; "0.5 s", not "0.50"). Pure — tested in chartAxis.test.js.

const STEPS = [1, 2, 5, 10];

/** The round step (1, 2 or 5 × 10^k) that splits `span` into about `count` intervals. */
export function niceStep(span, count = 4) {
    if (!(span > 0) || !Number.isFinite(span)) return 1;
    const raw = span / Math.max(1, count);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / magnitude;
    const factor = STEPS.find((s) => norm <= s * (1 + 1e-9)) ?? 10;
    return factor * magnitude;
}

/** Decimals a label needs to tell ticks `step` apart: 20 → 0, 0.5 → 1, 0.25 → 2. */
export function stepDecimals(step) {
    if (!(step > 0) || !Number.isFinite(step)) return 0;
    for (let d = 0; d <= 6; d += 1) {
        const scaled = step * 10 ** d;
        if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
    }
    return 6;
}

/**
 * A rounded axis covering [lo, hi]. A flat series (lo === hi) is padded so its
 * line sits mid-plot instead of on an edge. `floor` / `ceil` clamp the domain —
 * a percent axis never runs below 0 or above 100. `minStep` keeps a count
 * axis on whole numbers.
 *
 * @returns {{ domain: [number, number], ticks: number[], step: number, decimals: number }}
 */
export function niceAxis(lo, hi, { count = 4, floor = -Infinity, ceil = Infinity, minStep = 0 } = {}) {
    let a = Number.isFinite(lo) ? lo : 0;
    let b = Number.isFinite(hi) ? hi : a;
    if (a > b) [a, b] = [b, a];
    if (a === b) {
        const pad = Math.max(1, Math.abs(a) * 0.1);
        a -= pad;
        b += pad;
    }
    const step = Math.max(minStep, niceStep(b - a, count));
    const round = (v) => Number(v.toFixed(10));
    const d0 = Math.max(floor, round(Math.floor(a / step + 1e-9) * step));
    const d1 = Math.min(ceil, round(Math.ceil(b / step - 1e-9) * step));
    const first = Math.ceil(d0 / step - 1e-9);
    const last = Math.floor(d1 / step + 1e-9);
    const ticks = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => round((first + i) * step));
    return { domain: [d0, d1], ticks, step, decimals: stepDecimals(step) };
}

/** A tick label: the value at the axis's decimals, with an optional unit suffix ("%", " Hz", " s"). */
export function formatTick(value, decimals = 0, unit = '') {
    if (!Number.isFinite(value)) return '';
    const text = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });
    return `${text === '-0' ? '0' : text}${unit}`;
}
