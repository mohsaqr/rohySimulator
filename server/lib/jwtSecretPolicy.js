/**
 * What makes a JWT_SECRET unfit for production, as a dependency-free module.
 *
 * Kept free of imports on purpose: deploy/preflight.sh loads it with plain
 * `node` on a production host, and server/config/validateEnv.js pulls in
 * modules that open (and migrate) the database at import time.
 *
 * The shipped deploy/env.example placeholder is 36 characters, so the length
 * rule alone passed it and preflight printed "ok" (security audit 2026-10-26,
 * F-28): an operator who copied the file and missed that line ran production
 * on a secret printed in a public repository. Word fragments catch the
 * template family (REPLACE_ME…, change-me, your_secret…, …example…); the
 * distinct-character floor catches `aaaa…`, `abcabc…` and keyboard runs. The
 * floor is 10, not 16: `openssl rand -hex 32` draws from exactly 16 symbols,
 * and 64 of them miss at least one symbol about 2.6% of the time, which would
 * refuse a genuinely random secret.
 */

export const MIN_JWT_SECRET_LENGTH = 32;
export const MIN_JWT_DISTINCT_CHARS = 10;
export const JWT_PLACEHOLDER_WORDS = Object.freeze([
    'replace', 'change', 'example', 'your_', 'your-', 'placeholder', 'secret_here', 'secret-here', 'xxxxxx',
]);

/**
 * Why a JWT secret is unfit for production, or null when it is acceptable.
 * Length is checked separately (MIN_JWT_SECRET_LENGTH).
 *
 * @param {string} secret
 * @returns {string|null}
 */
export function jwtSecretWeakness(secret) {
    const value = String(secret ?? '');
    const lower = value.toLowerCase();
    const word = JWT_PLACEHOLDER_WORDS.find((w) => lower.includes(w));
    if (word) return `it contains the placeholder fragment "${word}"`;
    const distinct = new Set(value).size;
    if (distinct < MIN_JWT_DISTINCT_CHARS) {
        return `it uses only ${distinct} distinct character(s); a random secret uses many more`;
    }
    return null;
}
