// Kokoro's voice catalogue, read WITHOUT loading the model.
//
// kokoro-js bundles its voice map as an object literal in its dist file:
//   af_heart:{name:"Heart",language:"en-us",gender:"Female",traits:"❤️",…}
// The package also ships 54 `<id>.bin` voice packs, but only the 28 ids in
// that map are synthesizable at runtime (verified against a live load,
// 2026-07-10) — a .bin file is not a voice. Parsing the bundled map gives
// the exact runtime set, and it updates itself when the package is upgraded.
//
// Two readers share this: ttsProviders.js (engine derivation and listing
// before the model loads) and kokoroTts.js (remote mode, which must never
// load the local model just to validate a voice). The remote Kokoro host
// knows more voices than these 28; the catalogue stays at what the LOCAL
// engine can play, so every voice accepted remotely survives a fallback.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { logger } from '../logger.js';

const voicesLog = logger('kokoro');

const ENTRY_RX = /\b([a-z][fm]_[a-z]+):\{([^{}]*)\}/g;
const FIELD_RX = /\b(name|language|gender|traits):"([^"]*)"/g;

let _catalogue = null;

/**
 * Map of voice id → { name, language, gender, traits } exactly as kokoro-js
 * ships it (gender is Title-Case there; callers normalise). Returns null
 * when the bundle cannot be read or parsed; a failure is not cached, so a
 * later call may succeed.
 */
export function kokoroCatalogue() {
    if (_catalogue) return _catalogue;
    try {
        const req = createRequire(import.meta.url);
        const src = fs.readFileSync(req.resolve('kokoro-js'), 'utf8');
        const map = new Map();
        for (const [, id, body] of src.matchAll(ENTRY_RX)) {
            const meta = {};
            for (const [, key, value] of body.matchAll(FIELD_RX)) meta[key] = value;
            map.set(id, meta);
        }
        if (map.size > 0) {
            _catalogue = map;
            return _catalogue;
        }
        voicesLog.warn('kokoro voice catalogue empty: bundle format changed?');
    } catch (err) {
        voicesLog.warn('kokoro static voice listing failed', { error: err.message });
    }
    return null;
}

/** Set of synthesizable voice ids, or null when the catalogue is unreadable. */
export function kokoroStaticIds() {
    const catalogue = kokoroCatalogue();
    return catalogue ? new Set(catalogue.keys()) : null;
}
