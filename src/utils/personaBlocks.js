// Persona blocks — shared helper for assembling the dos/donts portion of an
// agent's system prompt at LLM-call time.
//
// Each agent template stores `config.dos` and `config.donts` as arrays of
// short strings (one bullet each). For the patient prompt, these are emitted
// immediately after the patient agent template's systemPrompt, which itself
// trails the case-specific `## INSTRUCTIONS` (the ordering was reversed in
// the 2026-05 patient-prompt pass — case content anchors first, template
// baseline + dos/donts read as the shared behavioural reminder).

function pickArray(value) {
    if (Array.isArray(value)) {
        return value.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    }
    if (typeof value === 'string') {
        // Editor saves as one-bullet-per-line; split + clean up.
        return value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Build a "You should: / You must not:" block from a config object that may
 * carry `dos` and `donts` arrays. Returns an empty string when neither is set.
 *
 * Accepts either a raw config object or anything with `dos` / `donts` keys.
 */
export function buildPersonaBlocks(source) {
    if (!source || typeof source !== 'object') return '';
    const dos = pickArray(source.dos);
    const donts = pickArray(source.donts);
    if (dos.length === 0 && donts.length === 0) return '';

    const parts = [];
    if (dos.length > 0) {
        parts.push('You should:\n' + dos.map(d => `- ${d}`).join('\n'));
    }
    if (donts.length > 0) {
        parts.push('You must not:\n' + donts.map(d => `- ${d}`).join('\n'));
    }
    return '\n\n' + parts.join('\n\n') + '\n';
}
