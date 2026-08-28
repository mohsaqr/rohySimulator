/**
 * Recursively sort object keys and reject values JSON cannot represent
 * faithfully. The result is suitable for stable diffs and checksums.
 */
export function canonicalize(value, path = '$', seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
        return value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
        seen.add(value);
        const result = value.map((entry, index) => {
            if (entry === undefined) throw new TypeError(`${path}[${index}] is undefined`);
            return canonicalize(entry, `${path}[${index}]`, seen);
        });
        seen.delete(value);
        return result;
    }
    if (typeof value === 'object') {
        if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
        seen.add(value);
        const result = {};
        Object.keys(value).sort().forEach((key) => {
            const entry = value[key];
            if (entry !== undefined) result[key] = canonicalize(entry, `${path}.${key}`, seen);
        });
        seen.delete(value);
        return result;
    }
    throw new TypeError(`${path} contains unsupported ${typeof value}`);
}

/** Stable, indented JSON used by manifests, rubrics, and package entries. */
export function canonicalJSONStringify(value, space = 2) {
    if (!(Number.isInteger(space) && space >= 0 && space <= 10)) {
        throw new TypeError(`space must be an integer from 0 to 10, received ${space}`);
    }
    return `${JSON.stringify(canonicalize(value), null, space)}\n`;
}

/** A deep clone with the same representability guarantees as package JSON. */
export function cloneCanonical(value) {
    return canonicalize(value);
}

