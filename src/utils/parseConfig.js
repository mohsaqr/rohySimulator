// Agent / case config columns are stored as JSON strings in SQLite but
// arrive as parsed objects from some endpoints. Always normalise via this
// helper so callers can read fields without guarding for type.
//
// Cleanup #23: when the input is already an object, we deep-clone it via
// structuredClone so the caller can safely mutate the result (e.g. apply
// dos/donts patches) without bleeding back into the source. The pre-clone
// shape was a foot-gun the audit (client-utils-data.md) flagged.

export function parseConfig(config) {
    if (!config) return {};
    if (typeof config !== 'string') {
        // Already an object — return a deep copy so mutations don't leak.
        // structuredClone is widely supported (Node 17+ / all modern
        // browsers); fall back to JSON round-trip for the rare runtime
        // that lacks it.
        if (typeof structuredClone === 'function') return structuredClone(config);
        try { return JSON.parse(JSON.stringify(config)); } catch { return {}; }
    }
    try { return JSON.parse(config); } catch { return {}; }
}
