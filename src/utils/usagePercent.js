// Share of a daily limit used, for the usage bars (Settings → LLM). A limit of
// 0 or less means "no limit" — the honest default the server now returns
// (lane C, security audit 2026-10-26, F-24) — so the bar is empty, not
// used / 0 = Infinity rendered as a full one.
export function usagePercent(used, limit) {
    const u = Number(used);
    const l = Number(limit);
    if (!(l > 0) || !Number.isFinite(u)) return 0;
    return Math.min((u / l) * 100, 100);
}
