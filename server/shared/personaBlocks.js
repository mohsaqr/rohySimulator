// Persona blocks — the dos/donts portion of an agent's system prompt.
//
// Lives in server/shared/ for the same reason as roleAnchor.js: BOTH sides
// assemble personas now, and the Docker runtime stage copies server/ but not
// src/. The client re-exports it from src/utils/personaBlocks.js.
//
// Each agent template stores `config.dos` and `config.donts` as arrays of
// short strings (one bullet each), authored in the persona editor.
//
// WHERE THEY LAND. Two assembly paths, and the block sits just after the
// authored persona text in both:
//   - client (patient, discussant): ChatInterface emits it after the patient
//     template's systemPrompt, which itself trails the case-specific
//     `## INSTRUCTIONS` — case content anchors first, template baseline +
//     dos/donts read as the shared behavioural reminder (2026-05 patient-
//     prompt pass). useDiscussionEngine does the same for the debrief tutor.
//   - server (nurse, consultant, relative, the on-call specialists):
//     services/agentPersona.js, after the authored prompt and BEFORE a
//     specialist's case brief, so the brief stays the last word on what may
//     be disclosed.
//
// Until 2026-09-18 only the client path called this, so an educator could
// author dos/donts for a nurse or a specialist and nothing read them.

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
