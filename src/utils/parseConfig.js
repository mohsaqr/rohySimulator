// Agent / case config columns are stored as JSON strings in SQLite but
// arrive as parsed objects from some endpoints. Always normalise via this
// helper so callers can read fields without guarding for type.

export function parseConfig(config) {
    if (!config) return {};
    if (typeof config !== 'string') return config;
    try { return JSON.parse(config); } catch { return {}; }
}
