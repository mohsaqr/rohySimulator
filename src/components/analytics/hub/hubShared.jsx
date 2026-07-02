// hubShared — tiny shared presentation atoms for the AnalyticsHub tabs
// (TurnsTab / MomentsTab / DataTab). Dark-theme idiom copied from the
// existing analytics tables (TurnsTable / MomentsTable / WindowsView) so
// the hub reads as one surface with the rest of src/components/analytics/.
//
// Color + number formatting truth stays in ../../oyon/emotionLogShared —
// this file only composes it into the chip/cell shapes the hub tables use.

import { emotionColor, signed } from '../../oyon/emotionLogShared';

// Humanized labels for the canonical 3×3 gaze zone keys — same map as the
// System Logs TurnsTable.
export const ZONE_LABEL = {
    middle_center: 'center', top_center: 'top', bottom_center: 'bottom',
    middle_left: 'left', middle_right: 'right',
    top_left: 'top-left', top_right: 'top-right',
    bottom_left: 'bottom-left', bottom_right: 'bottom-right',
};
export const zoneLabel = (z) => (z ? ZONE_LABEL[z] ?? z : null);

/** Dominant-emotion chip (estimate framing; dash when capture was off). */
export function EmotionChip({ label }) {
    if (!label) return <span className="text-neutral-600">—</span>;
    return (
        <span
            className="px-1.5 py-0.5 rounded font-medium text-[11px] text-neutral-900"
            style={{ background: emotionColor(label) }}
        >
            {label}
        </span>
    );
}

/** Signed, colored valence value (green ≥ 0, red < 0), dash when unknown. */
export function ValenceCell({ value }) {
    if (!Number.isFinite(value)) return <span className="text-neutral-600">—</span>;
    return (
        <span className="font-mono" style={{ color: value >= 0 ? '#34d399' : '#f87171' }}>
            {signed(value)}
        </span>
    );
}

/** Loading / error / empty notice blocks shared by all three tabs. */
export function StateNotice({ kind = 'info', children }) {
    if (kind === 'error') {
        return (
            <div className="p-3 rounded border border-red-800 bg-red-950/40 text-red-300 text-sm">
                {children}
            </div>
        );
    }
    return (
        <div className="p-6 rounded-lg border border-neutral-800 bg-neutral-900/60 text-center text-sm text-neutral-500">
            {children}
        </div>
    );
}

/** Cyan export/action button used by every tab's toolbar. */
export function ToolbarButton({ onClick, disabled, title, children }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1 disabled:opacity-50"
        >
            {children}
        </button>
    );
}

/** Truncate long free text for table cells; the expand panel shows it all. */
export function summarise(s, n = 120) {
    const str = s == null ? '' : String(s);
    return str.length <= n ? str : str.slice(0, n) + '…';
}

/** Trigger a browser download of a text payload (CSV or JSON). */
export function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
