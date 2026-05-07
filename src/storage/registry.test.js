import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORAGE_REGISTRY, isRegisteredKey, registeredKeyPrefixes } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');

// Walk every src/**.{js,jsx} file and pull out literal `rohy_*` strings.
// We use grep over execSync because Vitest can't reliably traverse the
// repo from inside its worker (jsdom env, restricted fs).
function findRohyLiteralsInSource() {
    // --include matches js/jsx; tests and the registry itself are excluded so
    // sentinel strings used in assertions don't pollute the literal census.
    const out = execSync(
        `grep -rohE "['\\\`]rohy_[a-zA-Z_]+" ${path.join(REPO_ROOT, 'src')} --include='*.js' --include='*.jsx' --exclude='*.test.js' --exclude='*.test.jsx' --exclude='registry.js' || true`,
        { encoding: 'utf8' }
    );
    const stripped = out
        .split('\n')
        .map(l => l.replace(/^['`]/, ''))
        .filter(Boolean);
    return Array.from(new Set(stripped));
}

describe('localStorage namespace registry', () => {
    it('every entry has owner, purpose, and lifetime', () => {
        for (const [key, entry] of Object.entries(STORAGE_REGISTRY)) {
            expect(entry.owner, `${key}.owner`).toBeTypeOf('string');
            expect(entry.owner.length, `${key}.owner non-empty`).toBeGreaterThan(0);
            expect(entry.purpose, `${key}.purpose`).toBeTypeOf('string');
            expect(['session', 'logout', 'forever', 'derived'], `${key}.lifetime`)
                .toContain(entry.lifetime);
        }
    });

    it('keyBuilder entries produce distinct prefixes for distinct args', () => {
        for (const [key, entry] of Object.entries(STORAGE_REGISTRY)) {
            if (typeof entry.keyBuilder !== 'function') continue;
            const a = entry.keyBuilder('alpha');
            const b = entry.keyBuilder('beta');
            expect(a, `${key} keyBuilder('alpha') non-empty`).toBeTruthy();
            expect(a, `${key} keyBuilder distinct outputs`).not.toBe(b);
        }
    });

    it('isRegisteredKey accepts every static entry name', () => {
        for (const key of Object.keys(STORAGE_REGISTRY)) {
            // Skip entries that are ONLY exposed via keyBuilder — the literal
            // prefix isn't a usable key on its own.
            if (typeof STORAGE_REGISTRY[key].keyBuilder === 'function') continue;
            expect(isRegisteredKey(key), `${key} should be recognised`).toBe(true);
        }
    });

    it('isRegisteredKey accepts keyBuilder outputs', () => {
        // Pick a few representative builders.
        expect(isRegisteredKey('rohy_discussion_history_42')).toBe(true);
        expect(isRegisteredKey('rohy_notification_prefs:user-7')).toBe(true);
        expect(isRegisteredKey('rohy_diag_bar_enabled_admin')).toBe(true);
    });

    it('isRegisteredKey rejects unrelated keys', () => {
        expect(isRegisteredKey(null)).toBe(false);
        expect(isRegisteredKey('')).toBe(false);
        expect(isRegisteredKey('token')).toBe(false);
        expect(isRegisteredKey('rohy_unknown_key')).toBe(false);
    });

    it('every literal rohy_* key in src/ is declared in the registry', () => {
        // CONTRACT: this is the regression-lock that catches "someone
        // localStorage.setItem'd a new rohy_* key without registering it."
        // When this fails, you've added a key without declaring its owner /
        // purpose / lifetime — please add the entry to STORAGE_REGISTRY in
        // registry.js so future cleanup paths know about it.
        const literals = findRohyLiteralsInSource();
        expect(literals.length, 'expected at least one rohy_* literal in src/').toBeGreaterThan(0);

        const unregistered = [];
        for (const lit of literals) {
            // For keyBuilder entries the literal in source is the BARE
            // prefix (e.g. `rohy_discussion_history_`). Match by prefix.
            const matchesStatic = STORAGE_REGISTRY[lit] !== undefined;
            const matchesPrefix = registeredKeyPrefixes().some(prefix => {
                const entry = STORAGE_REGISTRY[prefix];
                if (typeof entry.keyBuilder !== 'function') return false;
                const probe = entry.keyBuilder('');
                return lit === probe || lit.startsWith(probe);
            });
            if (!matchesStatic && !matchesPrefix) unregistered.push(lit);
        }

        expect(
            unregistered,
            `Unregistered rohy_* keys found in source: ${unregistered.join(', ')}`,
        ).toEqual([]);
    });
});
