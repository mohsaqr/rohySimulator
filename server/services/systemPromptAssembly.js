// Server-side system-prompt assembly. Pulled into its own helper so the
// ordering invariant is unit-testable in isolation, without spinning up
// the full /proxy/llm route (auth, DB, fetch, audit chain, …).
//
// Ordering invariant (changed 2026-05, extended 2026-07-10):
//   1. A one-line output-language lead, when the request carries a case
//      language (primacy — the model reads it before the long persona).
//   2. Case-specific `system_prompt` (assembled by the client — ChatInterface
//      builds persona, instructions, case design context, vitals, etc.).
//   3. Platform-wide `systemPromptTemplate`, if an admin has set one
//      explicitly, as a behavioral reminder.
//   4. The RESPONSE CONTRACT trails everything (recency keeps it dominant
//      over long English case prompts — the drift risk in I18N_PLAN.md §10):
//      the registry's full language directive (case language is immutable,
//      English included) plus the always-on plain-speech rules — replies are
//      spoken dialogue rendered verbatim in chat bubbles and fed to TTS, so
//      markdown is banned at the source (the client also strips residue,
//      src/utils/plainText.js).
//
// Prior to the 2026-05 change the platform template was *prepended*, which
// shadowed the case persona and was the root cause of "the model ignores my
// case" reports. The shipped default systemPromptTemplate is now empty.
// Directive text comes from the language registry only; this module must not
// know language codes.

import { LANGUAGES, llmDirectiveFor } from '../shared/languages.js';

const SEPARATOR = '\n\n---\n\n';

// Always-on: every reply is spoken dialogue — shown verbatim in the chat
// bubble and synthesized by TTS — so formatting markup has no surface to
// render on and must not be produced.
export const PLAIN_SPEECH_RULES =
    'You are speaking aloud in a live conversation. Reply in plain conversational sentences only — ' +
    'never use markdown or any formatting markup: no asterisks, no bold or italics, no headings, ' +
    'no bullet or numbered lists, no tables, no code blocks. Your words are read and heard exactly as written.';

// Coerce route-body inputs to a trimmed string. system_prompt and
// systemPromptTemplate can technically arrive as anything (object, number,
// null) from req.body if a buggy client / test sends them that way — fall
// back to '' rather than crashing in .trim().
function toTrimmedString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    return String(value).trim();
}

/**
 * Assemble the final system prompt sent to the LLM.
 *
 * @param {object} parts
 * @param {string} [parts.system_prompt]         The case-built prompt.
 * @param {string} [parts.systemPromptTemplate]  Optional platform reminder.
 * @param {string} [parts.caseLanguage]          Registry language code for the
 *   patient dialogue ('en', 'it', …). A known code adds a leading language
 *   line and the full directive inside the trailing response contract.
 *   Unknown/missing codes add no language blocks (body-sourced value —
 *   never trusted to be valid); the plain-speech rules apply regardless.
 * @returns {string}
 */
export function assembleSystemPrompt({ system_prompt = '', systemPromptTemplate = '', caseLanguage = '' } = {}) {
    const directive = llmDirectiveFor(caseLanguage);
    // A non-null directive implies a known registry code.
    let languageLead = '';
    if (directive) {
        const lang = LANGUAGES[caseLanguage];
        languageLead = lang.native !== lang.name
            ? `Respond only in ${lang.name} (${lang.native}).`
            : `Respond only in ${lang.name}.`;
    }
    const responseContract = [directive, PLAIN_SPEECH_RULES].filter(Boolean).join(' ');
    const blocks = [
        languageLead,
        toTrimmedString(system_prompt),
        toTrimmedString(systemPromptTemplate),
        responseContract
    ].filter(Boolean);
    return blocks.join(SEPARATOR);
}
