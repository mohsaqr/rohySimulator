const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Is a value a portable, non-empty entity identifier? */
export function isStableId(value) {
    return typeof value === 'string' && value.length <= 200 && ID_PATTERN.test(value);
}

/** Raise at an ID-construction boundary instead of minting an unusable key. */
export function assertStableId(value, label = 'id') {
    if (!isStableId(value)) {
        throw new TypeError(`${label} must be a portable non-empty identifier, received ${JSON.stringify(value)}`);
    }
    return value;
}

function assertKind(kind) {
    if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
        throw new TypeError(`id kind must match ${KIND_PATTERN}, received ${JSON.stringify(kind)}`);
    }
    return kind;
}

/**
 * Default ID source for newly authored entities.
 *
 * The random source is injectable so every constructor is deterministic in a
 * test and so a host can supply its own UUID policy.
 */
export function createId(kind, randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
    assertKind(kind);
    if (typeof randomUUID !== 'function') {
        throw new Error('createId(): crypto.randomUUID() is unavailable; inject an id factory');
    }
    return `${kind}-${assertStableId(randomUUID(), 'random UUID')}`;
}

/** Return a `(kind) => id` factory suitable for the lifecycle constructors. */
export function createIdFactory(randomUUID) {
    return (kind) => createId(kind, randomUUID);
}

/**
 * Stable FNV-1a/64 identifier for legacy migration.
 *
 * Migration IDs must not change each time the same old JSON is imported.
 * FNV is used as a deterministic namespace key, not as a security checksum.
 */
export function deterministicId(kind, ...parts) {
    assertKind(kind);
    const text = parts.map((part) => String(part ?? '')).join('\u001f');
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    Array.from(new TextEncoder().encode(text)).forEach((byte) => {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * prime);
    });
    return `${kind}-${hash.toString(16).padStart(16, '0')}`;
}

/** Preserve a usable legacy ID, otherwise derive one from stable context. */
export function preserveOrDeriveId(value, kind, ...seed) {
    return isStableId(value) ? value : deterministicId(kind, ...seed);
}

